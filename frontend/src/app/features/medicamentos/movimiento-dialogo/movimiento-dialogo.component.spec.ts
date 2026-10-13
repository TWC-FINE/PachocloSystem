import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, of, throwError } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { SIN_CONFIRMAR } from '../../../shared/idempotencia';
import { Medicamento, TipoMovimiento } from '../medicamento.models';
import { MedicamentoService } from '../medicamento.service';
import { MovimientoDialogoComponent } from './movimiento-dialogo.component';

type Uuid = ReturnType<Crypto['randomUUID']>;

/** Claves generadas desde la última llamada a {@link simularClaves}. */
let clavesGeneradas = 0;

/** `crypto.randomUUID` predecible: clave-1, clave-2... en el orden en que se generan. */
function simularClaves(): void {
  clavesGeneradas = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `clave-${++clavesGeneradas}` as Uuid);
}

describe('MovimientoDialogoComponent', () => {
  const dolex = {
    idMedicamento: 'MED-0001',
    nombre: 'Dolex',
    concentracion: '500 mg',
    lote: 'L-1',
    cantidadStock: 5,
  } as Medicamento;
  const servicio = {
    moverStock:
      vi.fn<
        (
          id: string,
          tipo: TipoMovimiento,
          cantidad: number,
          clave?: string,
        ) => Observable<Medicamento>
      >(),
  };
  const dialogo: { close: ReturnType<typeof vi.fn>; disableClose?: boolean } = { close: vi.fn() };
  const notificaciones = { exito: vi.fn(), error: vi.fn() };

  async function renderizar(tipo: TipoMovimiento) {
    TestBed.configureTestingModule({
      imports: [MovimientoDialogoComponent],
      providers: [
        { provide: MedicamentoService, useValue: servicio },
        { provide: MatDialogRef, useValue: dialogo },
        { provide: MAT_DIALOG_DATA, useValue: { medicamento: dolex, tipo } },
        { provide: NotificacionService, useValue: notificaciones },
      ],
    });
    const fixture = TestBed.createComponent(MovimientoDialogoComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    return {
      elemento,
      registrar: async (cantidad: string) => {
        const input = elemento.querySelector<HTMLInputElement>('input')!;
        input.value = cantidad;
        input.dispatchEvent(new Event('input'));
        elemento.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await fixture.whenStable();
      },
      /** Pulsa el botón de acción con ese texto (Cancelar / Reintentar). */
      pulsar: async (texto: string) => {
        Array.from(elemento.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'))
          .find((boton) => boton.textContent?.trim() === texto)!
          .click();
        await fixture.whenStable();
      },
      botones: () =>
        Array.from(elemento.querySelectorAll('mat-dialog-actions button')).map((boton) =>
          boton.textContent?.trim(),
        ),
      campos: () => Array.from(elemento.querySelectorAll<HTMLInputElement>('input')),
      alerta: () =>
        Array.from(elemento.querySelectorAll('app-errores-formulario [role="alert"] p')).map((p) =>
          p.textContent?.trim(),
        ),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    simularClaves();
    delete dialogo.disableClose;
  });

  it('registra una entrada y se cierra con el medicamento actualizado', async () => {
    servicio.moverStock.mockReturnValue(of({ ...dolex, cantidadStock: 15 }));
    const { elemento, registrar } = await renderizar('entrada');

    expect(elemento.querySelector('[mat-dialog-title]')?.textContent).toBe('Entrada de stock');
    expect(elemento.textContent).toContain('Stock disponible: 5.');
    await registrar('10');

    expect(servicio.moverStock).toHaveBeenCalledWith('MED-0001', 'entrada', 10);
    expect(dialogo.close).toHaveBeenCalledWith({ ...dolex, cantidadStock: 15 });
  });

  it('las entradas no llevan clave: el backend no la acepta en /entradas', async () => {
    servicio.moverStock.mockReturnValue(of({ ...dolex, cantidadStock: 15 }));
    const { registrar } = await renderizar('entrada');

    await registrar('10');

    const [llamada] = servicio.moverStock.mock.calls;
    expect(llamada).toEqual(['MED-0001', 'entrada', 10]);
  });

  it('las salidas sí llevan clave de idempotencia', async () => {
    servicio.moverStock.mockReturnValue(of({ ...dolex, cantidadStock: 4 }));
    const { registrar } = await renderizar('salida');

    await registrar('1');

    expect(servicio.moverStock).toHaveBeenCalledWith('MED-0001', 'salida', 1, 'clave-1');
    expect(dialogo.close).toHaveBeenCalledWith({ ...dolex, cantidadStock: 4 });
  });

  it('tras una salida correcta se prepara una clave nueva', async () => {
    servicio.moverStock.mockReturnValue(of({ ...dolex, cantidadStock: 4 }));
    const { registrar } = await renderizar('salida');

    // Una al abrir el diálogo y otra al cerrarse con éxito.
    expect(clavesGeneradas).toBe(1);
    await registrar('1');
    expect(clavesGeneradas).toBe(2);
  });

  it('Cancelar cierra sin resultado, igual que Esc o un clic fuera', async () => {
    const { pulsar } = await renderizar('entrada');

    await pulsar('Cancelar');

    expect(servicio.moverStock).not.toHaveBeenCalled();
    expect(dialogo.close).toHaveBeenCalledWith(undefined);
  });

  it.each(['0', '1000001', '2.5'])('rechaza en local la cantidad %s', async (cantidad) => {
    const { elemento, registrar } = await renderizar('salida');

    await registrar(cantidad);

    expect(servicio.moverStock).not.toHaveBeenCalled();
    expect(elemento.querySelector('mat-error')?.textContent?.trim()).toBe(
      'La cantidad debe ser un entero entre 1 y 1000000.',
    );
  });

  it('deja al servidor decidir si hay stock y muestra su error', async () => {
    servicio.moverStock.mockReturnValue(
      throwError(() => new ApiError(400, ['Stock insuficiente: disponible 5, solicitado 8.'])),
    );
    const { elemento, registrar } = await renderizar('salida');

    await registrar('8');

    expect(servicio.moverStock).toHaveBeenCalledWith('MED-0001', 'salida', 8, 'clave-1');
    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
      'Stock insuficiente: disponible 5, solicitado 8.',
    );
    expect(dialogo.close).not.toHaveBeenCalled();
  });

  describe('resultado incierto de una salida', () => {
    const CAIDO = 'El servicio de medicamentos no está disponible.';
    const NOTA = 'No se pudo confirmar si la salida se registró';
    const sinConfirmar = (error: unknown) => throwError(() => error);

    /** Salida cuyo primer intento queda en el aire (nadie sabe si descontó). */
    async function salidaSinConfirmar(error: unknown = new ApiError(503, [CAIDO])) {
      servicio.moverStock.mockReturnValueOnce(sinConfirmar(error));
      const vista = await renderizar('salida');
      await vista.registrar('2');
      return vista;
    }

    it('bloquea los campos y solo ofrece Reintentar o Cancelar', async () => {
      const { elemento, botones, campos, alerta } = await salidaSinConfirmar();

      expect(botones()).toEqual(['Cancelar', 'Reintentar']);
      expect(elemento.querySelector('button[type="submit"]')).toBeNull();
      expect(campos().every((campo) => campo.disabled)).toBe(true);
      expect(alerta()).toEqual([CAIDO, expect.stringContaining(NOTA)]);
      expect(dialogo.disableClose).toBe(true);
      expect(dialogo.close).not.toHaveBeenCalled();
    });

    it.each([
      ['un 500', new ApiError(500, [CAIDO])],
      ['un 502', new ApiError(502, [CAIDO])],
      ['una petición sin respuesta (estado 0)', new ApiError(0, [CAIDO])],
      ['un error que no es de la API', new Error('boom')],
    ])('%s también deja la salida por confirmar', async (_caso, error) => {
      const { botones } = await salidaSinConfirmar(error);

      expect(botones()).toEqual(['Cancelar', 'Reintentar']);
      expect(dialogo.close).not.toHaveBeenCalled();
    });

    it('Reintentar repite la misma cantidad y la misma clave, y el éxito cierra', async () => {
      const { pulsar } = await salidaSinConfirmar();
      servicio.moverStock.mockReturnValueOnce(of({ ...dolex, cantidadStock: 3 }));

      await pulsar('Reintentar');

      expect(servicio.moverStock).toHaveBeenCalledTimes(2);
      expect(servicio.moverStock).toHaveBeenNthCalledWith(1, 'MED-0001', 'salida', 2, 'clave-1');
      expect(servicio.moverStock).toHaveBeenNthCalledWith(2, 'MED-0001', 'salida', 2, 'clave-1');
      expect(dialogo.close).toHaveBeenCalledWith({ ...dolex, cantidadStock: 3 });
    });

    it('si el reintento falla de forma definitiva sigue bloqueado y con la misma clave', async () => {
      const { pulsar, botones, alerta } = await salidaSinConfirmar();
      servicio.moverStock.mockReturnValueOnce(
        throwError(() => new ApiError(400, ['Stock insuficiente: disponible 5, solicitado 8.'])),
      );

      await pulsar('Reintentar');

      expect(botones()).toEqual(['Cancelar', 'Reintentar']);
      expect(alerta()).toEqual([
        'Stock insuficiente: disponible 5, solicitado 8.',
        expect.stringContaining(NOTA),
      ]);
      expect(servicio.moverStock).toHaveBeenNthCalledWith(2, 'MED-0001', 'salida', 2, 'clave-1');
    });

    it('Cancelar cierra sin confirmar y avisa de revisar el stock', async () => {
      const { pulsar } = await salidaSinConfirmar();

      await pulsar('Cancelar');

      expect(dialogo.close).toHaveBeenCalledWith(SIN_CONFIRMAR);
      expect(notificaciones.error).toHaveBeenCalledWith([
        'No se confirmó la salida. Revise el stock del medicamento antes de volver a registrarla.',
      ]);
    });
  });

  describe('fallo definitivo (4xx) de una salida', () => {
    it.each([400, 409])(
      'un %i deja corregir y estrena clave en el siguiente intento',
      async (status) => {
        servicio.moverStock
          .mockReturnValueOnce(throwError(() => new ApiError(status, ['No se pudo registrar.'])))
          .mockReturnValueOnce(of({ ...dolex, cantidadStock: 2 }));
        const { elemento, campos, registrar, botones } = await renderizar('salida');

        await registrar('8');

        expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
          'No se pudo registrar.',
        );
        expect(botones()).toEqual(['Cancelar', 'Registrar salida']);
        expect(campos().every((campo) => campo.disabled)).toBe(false);
        expect(dialogo.disableClose).toBe(false);

        await registrar('3');

        expect(servicio.moverStock.mock.calls.map(([, , , clave]) => clave)).toEqual([
          'clave-1',
          'clave-2',
        ]);
      },
    );
  });

  it('una entrada sin respuesta no bloquea: no hay clave con la que repetir sin riesgo', async () => {
    servicio.moverStock.mockReturnValue(
      throwError(() => new ApiError(503, ['El servicio de medicamentos no está disponible.'])),
    );
    const { elemento, campos, registrar, botones } = await renderizar('entrada');

    await registrar('5');

    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
      'El servicio de medicamentos no está disponible.',
    );
    expect(botones()).toEqual(['Cancelar', 'Registrar entrada']);
    expect(campos().every((campo) => campo.disabled)).toBe(false);
    expect(dialogo.disableClose).toBeUndefined();
  });
});
