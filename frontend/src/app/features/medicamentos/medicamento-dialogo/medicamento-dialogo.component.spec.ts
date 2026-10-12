import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, of, throwError } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { ETIQUETAS_PRESENTACION, Medicamento } from '../medicamento.models';
import { MedicamentoService } from '../medicamento.service';
import {
  DatosMedicamentoDialogo,
  MedicamentoDialogoComponent,
} from './medicamento-dialogo.component';

describe('MedicamentoDialogoComponent', () => {
  const dolex: Medicamento = {
    idMedicamento: 'MED-0001',
    nombre: 'Dolex',
    principioActivo: 'Paracetamol',
    presentacion: 'TABLETA',
    concentracion: '500 mg',
    laboratorio: 'GSK',
    lote: 'L-1',
    cantidadStock: 120,
    stockMinimo: 10,
    fechaVencimiento: '2027-01-31',
    ubicacion: 'Estante A',
    stockBajo: false,
    vencido: false,
  };
  const servicio = {
    registrar: vi.fn<() => Observable<Medicamento>>(),
    editar: vi.fn<() => Observable<Medicamento>>(),
  };
  const dialogo = { close: vi.fn() };

  async function renderizar(datos: DatosMedicamentoDialogo) {
    TestBed.configureTestingModule({
      imports: [MedicamentoDialogoComponent],
      providers: [
        { provide: MedicamentoService, useValue: servicio },
        { provide: MatDialogRef, useValue: dialogo },
        { provide: MAT_DIALOG_DATA, useValue: datos },
      ],
    });
    const fixture = TestBed.createComponent(MedicamentoDialogoComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    const campo = (nombre: string) =>
      elemento.querySelector<HTMLElement>(`[formControlName="${nombre}"]`);
    const establecer = () => fixture.whenStable();
    return {
      elemento,
      campo,
      rellenar: async (valores: Record<string, string>) => {
        for (const [nombre, valor] of Object.entries(valores)) {
          const control = campo(nombre)!;
          if (control.tagName === 'MAT-SELECT') {
            control.click();
            fixture.detectChanges();
            await establecer();
            const etiqueta = (ETIQUETAS_PRESENTACION as Record<string, string>)[valor];
            Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'))
              .find((o) => o.textContent?.trim() === etiqueta)!
              .click();
            await establecer();
          } else {
            (control as HTMLInputElement).value = valor;
            control.dispatchEvent(new Event('input'));
          }
        }
      },
      enviar: async () => {
        elemento.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await fixture.whenStable();
      },
      erroresCampos: () =>
        Array.from(elemento.querySelectorAll('mat-error')).map((e) => e.textContent?.trim()),
    };
  }

  const completo = {
    nombre: ' Dolex ',
    principioActivo: 'Paracetamol',
    presentacion: 'TABLETA',
    concentracion: '500 mg',
    laboratorio: 'GSK',
    lote: 'L-1',
    cantidadStock: '120',
    stockMinimo: '10',
    fechaVencimiento: '2027-01-31',
    ubicacion: 'Estante A',
  };

  beforeEach(() => vi.resetAllMocks());

  it('exige todos los campos con los mensajes del backend', async () => {
    const { enviar, erroresCampos } = await renderizar({});

    await enviar();

    expect(servicio.registrar).not.toHaveBeenCalled();
    expect(erroresCampos()).toEqual([
      'El nombre es obligatorio.',
      'El principio activo es obligatorio.',
      'La presentación es obligatoria.',
      'La concentración es obligatoria.',
      'El laboratorio es obligatorio.',
      'El lote es obligatorio.',
      'La cantidad en stock es obligatoria.',
      'El stock mínimo es obligatorio.',
      'La fecha de vencimiento es obligatoria.',
      'La ubicación de almacenamiento es obligatoria.',
    ]);
  });

  it('valida los rangos de stock', async () => {
    const { rellenar, enviar, erroresCampos } = await renderizar({});

    await rellenar({ ...completo, cantidadStock: '-1', stockMinimo: '1000001' });
    await enviar();

    expect(servicio.registrar).not.toHaveBeenCalled();
    expect(erroresCampos()).toEqual([
      'La cantidad en stock debe estar entre 0 y 1000000.',
      'El stock mínimo debe estar entre 0 y 1000000.',
    ]);
  });

  it('registra con el stock inicial, los textos recortados y la fecha tal cual', async () => {
    servicio.registrar.mockReturnValue(of(dolex));
    const { rellenar, enviar } = await renderizar({});

    await rellenar(completo);
    await enviar();

    expect(servicio.registrar).toHaveBeenCalledWith({
      nombre: 'Dolex',
      principioActivo: 'Paracetamol',
      presentacion: 'TABLETA',
      concentracion: '500 mg',
      laboratorio: 'GSK',
      lote: 'L-1',
      cantidadStock: 120,
      stockMinimo: 10,
      fechaVencimiento: '2027-01-31',
      ubicacion: 'Estante A',
    });
    expect(dialogo.close).toHaveBeenCalledWith(dolex);
  });

  it('al editar no deja tocar el stock y no lo envía', async () => {
    servicio.editar.mockReturnValue(of(dolex));
    const { elemento, campo, rellenar, enviar } = await renderizar({ medicamento: dolex });

    expect(campo('cantidadStock')).toBeNull();
    const stockActual = Array.from(elemento.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.value === '120',
    )!;
    expect(stockActual.disabled).toBe(true);
    expect(campo('presentacion')?.textContent).toContain('Tableta');
    expect((campo('fechaVencimiento') as HTMLInputElement)!.value).toBe('2027-01-31');

    await rellenar({ fechaVencimiento: '2026-12-31' });
    await enviar();

    const [id, datos] = servicio.editar.mock.calls[0] as unknown as [string, object];
    expect(id).toBe('MED-0001');
    expect(datos).not.toHaveProperty('cantidadStock');
    expect(datos).toMatchObject({ stockMinimo: 10, fechaVencimiento: '2026-12-31' });
  });

  it('muestra el 409 de duplicado dentro del formulario y sigue abierto', async () => {
    servicio.registrar.mockReturnValue(
      throwError(
        () =>
          new ApiError(409, [
            'Ya existe un medicamento con el mismo nombre, concentración, presentación y lote.',
          ]),
      ),
    );
    const { elemento, rellenar, enviar } = await renderizar({});

    await rellenar(completo);
    await enviar();

    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
      'Ya existe un medicamento con el mismo nombre',
    );
    expect(dialogo.close).not.toHaveBeenCalled();
  });
});
