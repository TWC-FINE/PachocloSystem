import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Registro } from '../historial.models';
import { RegistroDetalleDialogoComponent } from './registro-detalle-dialogo.component';

describe('RegistroDetalleDialogoComponent', () => {
  const sinMedicacion: Registro = {
    idRegistro: 'r1',
    idPaciente: 'PAC-0001',
    nombrePaciente: 'Ana Ruiz',
    fecha: '2026-10-06T20:21:00.915452',
    tipo: 'SIGNOS_VITALES',
    autor: {
      idTrabajador: 'ENF-0001',
      nombreCompleto: 'Luis Gil',
      rol: 'Enfermero',
      especialidad: null,
      nivelExperiencia: 'NOVATO',
    },
    contenido: 'Signos vitales - Temp: 36.5°C | FC: 80 lpm',
  };

  async function renderizar(registro: Registro) {
    TestBed.configureTestingModule({
      imports: [RegistroDetalleDialogoComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: registro },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(RegistroDetalleDialogoComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const texto = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim();

  /** El `<dd>` que sigue al `<dt>` con esa etiqueta. */
  const valorDe = (elemento: HTMLElement, etiqueta: string): HTMLElement | null => {
    const termino = Array.from(elemento.querySelectorAll('dt')).find(
      (dt) => dt.textContent?.trim() === etiqueta,
    );
    return (termino?.nextElementSibling as HTMLElement | undefined) ?? null;
  };

  it('muestra tipo, fecha, autor y contenido', async () => {
    const elemento = await renderizar(sinMedicacion);

    expect(texto(valorDe(elemento, 'Tipo'))).toBe('Signos vitales');
    expect(texto(valorDe(elemento, 'Fecha'))).toBe('06/10/2026 20:21');
    expect(valorDe(elemento, 'Fecha')?.querySelector('time')?.getAttribute('datetime')).toBe(
      sinMedicacion.fecha,
    );
    expect(texto(valorDe(elemento, 'Autor'))).toBe('Luis Gil (ENF-0001) · Enfermero');
    expect(valorDe(elemento, 'Contenido')?.textContent).toBe(sinMedicacion.contenido);
  });

  it('muestra el contenido entero, con sus saltos de línea', async () => {
    const contenido = 'Diagnóstico inicial\nControl a las 24 horas\nAlta con seguimiento';
    const elemento = await renderizar({ ...sinMedicacion, tipo: 'EVOLUCION', contenido });

    const dd = valorDe(elemento, 'Contenido')!;
    expect(dd.textContent).toBe(contenido);
    expect(dd.classList.contains('contenido')).toBe(true);
  });

  it('muestra el medicamento y la cantidad cuando la medicación descontó stock', async () => {
    const elemento = await renderizar({
      ...sinMedicacion,
      tipo: 'MEDICACION',
      medicacion: { idMedicamento: 'MED-0001', cantidad: 2 },
    });

    expect(texto(valorDe(elemento, 'Medicamento'))).toBe('MED-0001');
    expect(texto(valorDe(elemento, 'Cantidad'))).toBe('2 unidades');
  });

  it('usa el singular cuando la cantidad es una unidad', async () => {
    const elemento = await renderizar({
      ...sinMedicacion,
      tipo: 'MEDICACION',
      medicacion: { idMedicamento: 'MED-0001', cantidad: 1 },
    });

    expect(texto(valorDe(elemento, 'Cantidad'))).toBe('1 unidad');
  });

  it('sin medicación no muestra esa sección', async () => {
    const elemento = await renderizar(sinMedicacion);

    expect(valorDe(elemento, 'Medicamento')).toBeNull();
    expect(valorDe(elemento, 'Cantidad')).toBeNull();
  });

  it('cierra con el botón Cerrar', async () => {
    const elemento = await renderizar(sinMedicacion);

    const cerrar = Array.from(
      elemento.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'),
    ).find((boton) => boton.textContent?.trim() === 'Cerrar')!;
    expect(cerrar.getAttribute('mat-dialog-close')).not.toBeNull();
  });
});
