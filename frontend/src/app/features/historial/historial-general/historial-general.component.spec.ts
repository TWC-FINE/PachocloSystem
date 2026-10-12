import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { ESPERA_BUSQUEDA_MS } from '../../../shared/listas';
import { FiltroHistorial, Registro } from '../historial.models';
import { HistorialService } from '../historial.service';
import { HistorialGeneralComponent } from './historial-general.component';

describe('HistorialGeneralComponent', () => {
  const registro: Registro = {
    idRegistro: 'r1',
    idPaciente: 'PAC-0001',
    nombrePaciente: 'Ana Ruiz',
    fecha: '2026-10-06T20:21:00',
    tipo: 'DIAGNOSTICO',
    autor: {
      idTrabajador: 'DOC-0001',
      nombreCompleto: 'Eva Mora',
      rol: 'Doctor',
      especialidad: 'Cardiología',
      nivelExperiencia: null,
    },
    contenido: 'Hipertensión leve',
  };
  const servicio = { listar: vi.fn<(f: FiltroHistorial, q?: string) => Observable<Registro[]>>() };

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [HistorialGeneralComponent],
      providers: [provideRouter([]), { provide: HistorialService, useValue: servicio }],
    });
    const fixture = TestBed.createComponent(HistorialGeneralComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    return { fixture, elemento };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    servicio.listar.mockReturnValue(of([registro]));
  });

  it('carga todo el historial y muestra cada registro con su paciente', async () => {
    const { elemento } = await renderizar();

    expect(servicio.listar).toHaveBeenCalledWith('todos', '');
    expect(elemento.querySelectorAll('li.registro')).toHaveLength(1);
    expect(elemento.querySelector('.paciente a')?.textContent).toContain('Ana Ruiz (PAC-0001)');
  });

  it('busca con el filtro elegido', async () => {
    const { fixture, elemento } = await renderizar();
    servicio.listar.mockReturnValue(of([]));

    const select = elemento.querySelector<HTMLElement>('mat-select')!;
    select.click();
    fixture.detectChanges();
    await fixture.whenStable();
    Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'))
      .find((o) => o.textContent?.trim() === 'Autor')!
      .click();
    await fixture.whenStable();
    const input = elemento.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = ' eva ';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, ESPERA_BUSQUEDA_MS + 50));
    await fixture.whenStable();

    expect(servicio.listar).toHaveBeenCalledWith('autor', '');
    expect(servicio.listar).toHaveBeenLastCalledWith('autor', 'eva');
    expect(elemento.querySelector('.lista-estado')?.textContent).toContain(
      'Ningún registro coincide con «eva».',
    );
  });

  it('muestra el error de carga con opción de reintentar', async () => {
    servicio.listar.mockReturnValueOnce(
      throwError(() => new ApiError(0, ['No se pudo conectar con el servidor.'])),
    );
    const { fixture, elemento } = await renderizar();

    elemento.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await fixture.whenStable();

    expect(servicio.listar).toHaveBeenCalledTimes(2);
    expect(elemento.querySelectorAll('li.registro')).toHaveLength(1);
  });
});
