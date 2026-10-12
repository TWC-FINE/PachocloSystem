import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { PermisosService } from '../../../core/permisos';
import { Medicamento } from '../../medicamentos/medicamento.models';
import { MedicamentoService } from '../../medicamentos/medicamento.service';
import { Registro, RegistroRequest } from '../historial.models';
import { HistorialService } from '../historial.service';
import { DatosRegistroDialogo, RegistroDialogoComponent } from './registro-dialogo.component';

/** Si el rol simulado puede crear diagnósticos (el enfermero no). */
let diagnostica = true;

type Uuid = ReturnType<Crypto['randomUUID']>;

/** `crypto.randomUUID` predecible: clave-1, clave-2... en el orden en que se generan. */
function simularClaves(): void {
  let n = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `clave-${++n}` as Uuid);
}

describe('RegistroDialogoComponent', () => {
  const datos: DatosRegistroDialogo = {
    paciente: { idPaciente: 'PAC-0001', nombre: 'Ana Ruiz', edad: 40, habitacion: 12 },
    autor: 'DOC-0001',
  };
  const creado = { idRegistro: 'r1' } as Registro;
  const servicio = {
    crear: vi.fn<(id: string, r: RegistroRequest, clave: string) => Observable<Registro>>(),
  };
  const dialogo: { close: ReturnType<typeof vi.fn>; disableClose?: boolean } = { close: vi.fn() };
  const notificaciones = { exito: vi.fn(), error: vi.fn() };

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [RegistroDialogoComponent],
      providers: [
        { provide: HistorialService, useValue: servicio },
        { provide: MedicamentoService, useValue: { listar: vi.fn() } },
        { provide: MatDialogRef, useValue: dialogo },
        { provide: MAT_DIALOG_DATA, useValue: datos },
        { provide: PermisosService, useValue: { puede: () => diagnostica } },
        { provide: NotificacionService, useValue: notificaciones },
      ],
    });
    const fixture = TestBed.createComponent(RegistroDialogoComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    const estable = () => fixture.whenStable();
    return {
      elemento,
      elegirTipo: async (etiqueta: string) => {
        Array.from(elemento.querySelectorAll('mat-radio-button'))
          .find((r) => r.textContent?.trim() === etiqueta)!
          .querySelector('input')!
          .click();
        await estable();
      },
      rellenar: async (valores: Record<string, string>) => {
        for (const [nombre, valor] of Object.entries(valores)) {
          const campo = elemento.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            `[formControlName="${nombre}"]`,
          )!;
          campo.value = valor;
          campo.dispatchEvent(new Event('input'));
          campo.dispatchEvent(new Event('blur'));
        }
        await estable();
      },
      enviar: async () => {
        elemento.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await estable();
      },
      errores: () =>
        Array.from(elemento.querySelectorAll('mat-error')).map((e) => e.textContent?.trim()),
    };
  }

  const signosValidos = {
    temperatura: '36.5',
    frecCardiaca: '80',
    presionSistolica: '120',
    presionDiastolica: '80',
    frecRespiratoria: '16',
    saturacion: '98',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    simularClaves();
    diagnostica = true;
  });

  it('a quien no puede diagnosticar (enfermero) no se le ofrece el tipo DIAGNOSTICO', async () => {
    diagnostica = false;
    const { elemento } = await renderizar();

    const tipos = Array.from(elemento.querySelectorAll('mat-radio-button')).map((r) =>
      r.textContent?.trim(),
    );
    expect(tipos).toEqual(['Evolución', 'Medicación', 'Signos vitales']);
  });

  it('pide elegir el tipo antes de nada', async () => {
    const { enviar, errores } = await renderizar();

    await enviar();

    expect(servicio.crear).not.toHaveBeenCalled();
    expect(errores()).toEqual(['Debe seleccionar un tipo de registro.']);
  });

  it.each([
    ['', 'El contenido no puede estar vacío.'],
    ['Tos', 'El contenido es demasiado corto (mínimo 5 caracteres).'],
    ['12345', 'El contenido debe incluir texto descriptivo, no solo números.'],
  ])('valida el contenido %j como el backend', async (contenido, mensaje) => {
    const { elegirTipo, rellenar, enviar, errores } = await renderizar();

    await elegirTipo('Diagnóstico');
    await rellenar({ contenido });
    await enviar();

    expect(servicio.crear).not.toHaveBeenCalled();
    expect(errores()).toEqual([mensaje]);
  });

  it('crea un diagnóstico con el autor del usuario y el contenido recortado', async () => {
    servicio.crear.mockReturnValue(of(creado));
    const { elegirTipo, rellenar, enviar } = await renderizar();

    await elegirTipo('Diagnóstico');
    await rellenar({ contenido: '  Hipertensión leve  ' });
    await enviar();

    expect(servicio.crear).toHaveBeenCalledWith(
      'PAC-0001',
      {
        tipo: 'DIAGNOSTICO',
        contenido: 'Hipertensión leve',
        signosVitales: null,
        idMedicamento: null,
        cantidad: null,
      },
      'clave-1',
    );
    expect(dialogo.close).toHaveBeenCalledWith(creado);
  });

  it('signos vitales: campos estructurados con los rangos del backend', async () => {
    const { elegirTipo, rellenar, enviar, errores, elemento } = await renderizar();

    await elegirTipo('Signos vitales');
    expect(elemento.querySelector('[formControlName="contenido"]')).toBeNull();
    await rellenar({
      temperatura: '45.5',
      frecCardiaca: '10',
      presionSistolica: '300',
      presionDiastolica: '20',
      frecRespiratoria: '70',
      saturacion: '101',
      observaciones: '123',
    });
    await enviar();

    expect(servicio.crear).not.toHaveBeenCalled();
    expect(errores()).toEqual([
      'Temperatura: debe ser un número entre 30.0 y 45.0 °C.',
      'Frecuencia Cardíaca: debe ser entre 20 y 250 lpm.',
      'Presión Sistólica: debe ser entre 50 y 250 mmHg.',
      'Presión Diastólica: debe ser entre 30 y 150 mmHg.',
      'Frecuencia Respiratoria: debe ser entre 5 y 60 rpm.',
      'Saturación de Oxígeno: debe ser entre 0 y 100%.',
      'Las observaciones no pueden ser solo números.',
    ]);
  });

  it('signos vitales: la diastólica debe ser menor que la sistólica', async () => {
    const { elegirTipo, rellenar, enviar, errores } = await renderizar();

    await elegirTipo('Signos vitales');
    await rellenar({ ...signosValidos, presionSistolica: '80', presionDiastolica: '80' });
    await enviar();

    expect(servicio.crear).not.toHaveBeenCalled();
    expect(errores()).toEqual(['La presión diastólica debe ser menor que la sistólica.']);
  });

  it('crea signos vitales sin contenido y sin observaciones vacías', async () => {
    servicio.crear.mockReturnValue(of(creado));
    const { elegirTipo, rellenar, enviar } = await renderizar();

    await elegirTipo('Diagnóstico');
    await rellenar({ contenido: 'Esto no debe enviarse' });
    await elegirTipo('Signos vitales');
    await rellenar({ ...signosValidos, observaciones: '   ' });
    await enviar();

    expect(servicio.crear).toHaveBeenCalledWith(
      'PAC-0001',
      {
        tipo: 'SIGNOS_VITALES',
        contenido: null,
        signosVitales: {
          temperatura: 36.5,
          frecCardiaca: 80,
          presionSistolica: 120,
          presionDiastolica: 80,
          frecRespiratoria: 16,
          saturacion: 98,
          observaciones: null,
        },
        idMedicamento: null,
        cantidad: null,
      },
      'clave-1',
    );
  });

  it('muestra en el formulario todos los mensajes de un 400 y sigue abierto', async () => {
    servicio.crear.mockReturnValue(
      throwError(() => new ApiError(400, ['Mensaje uno.', 'Mensaje dos.'])),
    );
    const { elegirTipo, rellenar, enviar, elemento } = await renderizar();

    await elegirTipo('Evolución');
    await rellenar({ contenido: 'Mejora progresiva' });
    await enviar();

    const mensajes = Array.from(elemento.querySelectorAll('[role="alert"] p')).map(
      (p) => p.textContent,
    );
    expect(mensajes).toEqual(['Mensaje uno.', 'Mensaje dos.']);
    expect(dialogo.close).not.toHaveBeenCalled();
  });

  describe('clave de idempotencia', () => {
    const evolucion = {
      tipo: 'EVOLUCION',
      contenido: 'Mejora progresiva',
      signosVitales: null,
      idMedicamento: null,
      cantidad: null,
    };

    async function evolucionLista() {
      const vista = await renderizar();
      await vista.elegirTipo('Evolución');
      await vista.rellenar({ contenido: 'Mejora progresiva' });
      return vista;
    }

    it('cada registro nuevo (cada diálogo) tiene su propia clave', async () => {
      // Un 400 no renueva la clave: así se ve solo la clave con la que nace cada diálogo.
      servicio.crear.mockReturnValue(throwError(() => new ApiError(400, ['Mensaje.'])));

      await (await evolucionLista()).enviar();
      TestBed.resetTestingModule();
      await (await evolucionLista()).enviar();

      expect(servicio.crear.mock.calls.map(([, , clave]) => clave)).toEqual(['clave-1', 'clave-2']);
    });

    it('un doble clic mientras se envía no manda una segunda petición', async () => {
      const respuesta = new Subject<Registro>();
      servicio.crear.mockReturnValue(respuesta);
      const { enviar } = await evolucionLista();

      await enviar();
      await enviar();
      respuesta.next(creado);
      respuesta.complete();

      expect(servicio.crear).toHaveBeenCalledTimes(1);
      expect(dialogo.close).toHaveBeenCalledWith(creado);
    });

    it('tras un alta correcta la clave se renueva y no sale otra petición mientras se cierra', async () => {
      servicio.crear.mockReturnValue(of(creado));
      const { enviar } = await evolucionLista();

      await enviar();
      expect(crypto.randomUUID).toHaveBeenCalledTimes(2);

      // Un clic más antes de que se cierre el diálogo no crea un segundo registro con la clave nueva.
      await enviar();
      expect(servicio.crear).toHaveBeenCalledTimes(1);
      expect(servicio.crear).toHaveBeenCalledWith('PAC-0001', evolucion, 'clave-1');
    });

    it('una repetición del backend (201 replay) se trata como un alta normal', async () => {
      // El servicio entrega el mismo Registro con o sin Idempotency-Replayed.
      servicio.crear.mockReturnValue(of(creado));
      const { enviar, elemento } = await evolucionLista();

      await enviar();

      expect(dialogo.close).toHaveBeenCalledWith(creado);
      expect(elemento.querySelector('[role="alert"]')).toBeNull();
    });

    it('un error que no cambió nada (400) deja corregir y conserva la clave', async () => {
      servicio.crear
        .mockReturnValueOnce(throwError(() => new ApiError(400, ['Mensaje.'])))
        .mockReturnValueOnce(of(creado));
      const { enviar, rellenar } = await evolucionLista();

      await enviar();
      await rellenar({ contenido: 'Mejora progresiva, sin fiebre' });
      await enviar();

      expect(servicio.crear).toHaveBeenNthCalledWith(1, 'PAC-0001', evolucion, 'clave-1');
      expect(servicio.crear).toHaveBeenNthCalledWith(
        2,
        'PAC-0001',
        { ...evolucion, contenido: 'Mejora progresiva, sin fiebre' },
        'clave-1',
      );
    });

    it('un 409 de clave ya usada genera una clave nueva y deja revisar y reenviar', async () => {
      servicio.crear
        .mockReturnValueOnce(
          throwError(
            () => new ApiError(409, ['La clave de idempotencia ya se usó para otra petición.']),
          ),
        )
        .mockReturnValueOnce(of(creado));
      const { enviar, rellenar, elemento } = await evolucionLista();

      await enviar();
      const mensajes = Array.from(elemento.querySelectorAll('[role="alert"] p')).map(
        (p) => p.textContent,
      );
      expect(mensajes).toEqual([
        'La clave de idempotencia ya se usó para otra petición.',
        'Revise los datos y vuelva a guardar el registro.',
      ]);
      expect(
        elemento.querySelector<HTMLTextAreaElement>('[formControlName="contenido"]')!.disabled,
      ).toBe(false);

      await rellenar({ contenido: 'Mejora progresiva revisada' });
      await enviar();

      expect(servicio.crear.mock.calls.map(([, , clave]) => clave)).toEqual(['clave-1', 'clave-2']);
      expect(dialogo.close).toHaveBeenCalledWith(creado);
    });
  });
});

describe('RegistroDialogoComponent · medicación', () => {
  const datos: DatosRegistroDialogo = {
    paciente: { idPaciente: 'PAC-0001', nombre: 'Ana Ruiz', edad: 40, habitacion: 12 },
    autor: 'DOC-0001',
  };
  const creado = { idRegistro: 'r1' } as Registro;
  const servicio = {
    crear: vi.fn<(id: string, r: RegistroRequest, clave: string) => Observable<Registro>>(),
  };
  const dialogo: { close: ReturnType<typeof vi.fn>; disableClose?: boolean } = { close: vi.fn() };
  const notificaciones = { exito: vi.fn(), error: vi.fn() };
  const inventario = { listar: vi.fn<() => Observable<Medicamento[]>>() };
  const dolex = {
    idMedicamento: 'MED-0001',
    nombre: 'Dolex',
    concentracion: '500 mg',
    lote: 'L-1',
    cantidadStock: 15,
    vencido: false,
  } as Medicamento;
  const caducado = { ...dolex, idMedicamento: 'MED-0002', nombre: 'Amoxil', vencido: true };
  const caido = () =>
    throwError(
      () =>
        new ApiError(503, [
          'El servicio de medicamentos no está disponible. Vuelva a intentarlo más tarde.',
        ]),
    );
  const sinDescuento: RegistroRequest = {
    tipo: 'MEDICACION',
    contenido: 'Paracetamol 500 mg vía oral',
    signosVitales: null,
    idMedicamento: null,
    cantidad: null,
  };

  /** Raíz del diálogo abierto por `preparar`. */
  let raiz: HTMLElement;
  /** Todos los campos del formulario (tipo, contenido, casilla, medicamento, cantidad). */
  const campos = () =>
    Array.from(
      raiz.querySelectorAll<HTMLElement>('form input, form textarea, form select, form mat-select'),
    );
  /** ¿Está deshabilitado el campo? Un `mat-select` lo refleja con `aria-disabled`/clase. */
  const deshabilitado = (campo: HTMLElement) =>
    campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement
      ? campo.disabled
      : campo.getAttribute('aria-disabled') === 'true' ||
        campo.matches('.mat-mdc-select-disabled') ||
        campo.querySelector('[aria-disabled="true"], .mat-mdc-select-disabled') !== null ||
        campo.closest('mat-form-field')?.classList.contains('mat-form-field-disabled') === true ||
        campo.closest('mat-form-field')?.classList.contains('mat-mdc-form-field-disabled') === true;
  /** Textos de los botones de acción del diálogo. */
  const botones = () =>
    Array.from(raiz.querySelectorAll('mat-dialog-actions button')).map((b) =>
      b.textContent?.trim(),
    );

  /** Abre el diálogo con MEDICACION elegida y el contenido relleno. */
  async function preparar() {
    TestBed.configureTestingModule({
      imports: [RegistroDialogoComponent],
      providers: [
        { provide: HistorialService, useValue: servicio },
        { provide: MedicamentoService, useValue: inventario },
        { provide: MatDialogRef, useValue: dialogo },
        { provide: MAT_DIALOG_DATA, useValue: datos },
        { provide: PermisosService, useValue: { puede: () => diagnostica } },
        { provide: NotificacionService, useValue: notificaciones },
      ],
    });
    const fixture = TestBed.createComponent(RegistroDialogoComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    raiz = elemento;
    const estable = () => fixture.whenStable();
    const escribir = (selector: string, valor: string, evento = 'input') => {
      const campo = elemento.querySelector<HTMLInputElement>(selector)!;
      campo.value = valor;
      campo.dispatchEvent(new Event(evento));
    };
    Array.from(elemento.querySelectorAll('mat-radio-button'))
      .find((r) => r.textContent?.trim() === 'Medicación')!
      .querySelector('input')!
      .click();
    await estable();
    escribir('[formControlName="contenido"]', 'Paracetamol 500 mg vía oral');
    await estable();
    return {
      elemento,
      casilla: () => elemento.querySelector<HTMLInputElement>('mat-checkbox input')!,
      marcarDescuento: async () => {
        elemento.querySelector<HTMLInputElement>('mat-checkbox input')!.click();
        await estable();
      },
      /** Abre el desplegable de medicamentos y devuelve sus opciones (lo cierra después). */
      opcionesMedicamento: async () => {
        const select = elemento.querySelector<HTMLElement>('[formControlName="idMedicamento"]')!;
        select.click();
        fixture.detectChanges();
        await estable();
        const opciones = Array.from(
          document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'),
        );
        // Cierra el panel para no interferir con los pasos siguientes.
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await estable();
        return opciones;
      },
      elegir: async (id: string, cantidad: string) => {
        const select = elemento.querySelector<HTMLElement>('[formControlName="idMedicamento"]')!;
        select.click();
        fixture.detectChanges();
        await estable();
        const nombre = id === 'MED-0002' ? caducado.nombre : dolex.nombre;
        Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'))
          .find((o) => o.textContent?.includes(nombre))!
          .click();
        await estable();
        escribir('[formControlName="cantidad"]', cantidad);
        await estable();
      },
      enviar: async () => {
        elemento.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await estable();
      },
      /** Pulsa el botón de acción con ese texto. */
      pulsar: async (texto: string) => {
        Array.from(elemento.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'))
          .find((b) => b.textContent?.trim() === texto)!
          .click();
        await estable();
      },
      erroresCampos: () =>
        Array.from(elemento.querySelectorAll('mat-error')).map((e) => e.textContent?.trim()),
      alerta: () =>
        Array.from(elemento.querySelectorAll('app-errores-formulario [role="alert"] p')).map(
          (p) => p.textContent,
        ),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    simularClaves();
    delete dialogo.disableClose;
    inventario.listar.mockReturnValue(of([dolex, caducado]));
  });

  it('sin descuento no envía medicamento ni cantidad y no carga el inventario', async () => {
    servicio.crear.mockReturnValue(of(creado));
    const { enviar } = await preparar();

    await enviar();

    expect(inventario.listar).not.toHaveBeenCalled();
    expect(servicio.crear).toHaveBeenCalledWith('PAC-0001', sinDescuento, 'clave-1');
  });

  it('con descuento exige medicamento y cantidad, y envía los dos', async () => {
    servicio.crear.mockReturnValue(of(creado));
    const { elemento, marcarDescuento, opcionesMedicamento, elegir, enviar, erroresCampos } =
      await preparar();

    await marcarDescuento();
    expect(inventario.listar).toHaveBeenCalledTimes(1);
    const vencido = (await opcionesMedicamento()).find((o) =>
      o.textContent?.includes(caducado.nombre),
    );
    expect(
      vencido?.getAttribute('aria-disabled') === 'true' ||
        vencido?.classList.contains('mat-mdc-option-disabled'),
    ).toBe(true);

    await enviar();
    expect(servicio.crear).not.toHaveBeenCalled();
    expect(erroresCampos()).toEqual([
      'Seleccione el medicamento administrado.',
      'La cantidad administrada es obligatoria.',
    ]);

    await elegir('MED-0001', '2');
    expect(elemento.querySelector('mat-hint')?.textContent).toContain('Disponible: 15');
    await enviar();

    expect(servicio.crear).toHaveBeenCalledWith(
      'PAC-0001',
      {
        ...sinDescuento,
        idMedicamento: 'MED-0001',
        cantidad: 2,
      },
      'clave-1',
    );
  });

  it('si el inventario no carga, avisa y deja guardar la medicación sin descuento', async () => {
    inventario.listar.mockReturnValueOnce(caido()).mockReturnValueOnce(of([dolex]));
    servicio.crear.mockReturnValue(of(creado));
    const { elemento, casilla, marcarDescuento, enviar } = await preparar();

    await marcarDescuento();

    const aviso = elemento.querySelector('.aviso-inventario')!;
    expect(aviso.textContent).toContain('El servicio de medicamentos no está disponible.');
    expect(aviso.textContent).toContain('Puede guardar la medicación sin descontar stock.');
    expect(casilla().checked).toBe(false);

    await enviar();
    expect(servicio.crear).toHaveBeenCalledWith('PAC-0001', sinDescuento, 'clave-1');
  });

  it('desde el aviso se puede reintentar la carga del inventario', async () => {
    inventario.listar.mockReturnValueOnce(caido()).mockReturnValueOnce(of([dolex]));
    const { elemento, casilla, marcarDescuento, opcionesMedicamento } = await preparar();
    await marcarDescuento();

    elemento.querySelector<HTMLButtonElement>('.aviso-inventario button')!.click();
    await new Promise((r) => setTimeout(r));

    expect(inventario.listar).toHaveBeenCalledTimes(2);
    expect(casilla().checked).toBe(true);
    expect(elemento.querySelector('.aviso-inventario')).toBeNull();
    expect((await opcionesMedicamento()).some((o) => o.textContent?.includes(dolex.nombre))).toBe(
      true,
    );
  });

  it('si el descuento falla (stock insuficiente) explica que no se guardó nada', async () => {
    servicio.crear.mockReturnValue(
      throwError(() => new ApiError(400, ['Stock insuficiente: disponible 15, solicitado 20.'])),
    );
    const { marcarDescuento, elegir, enviar, alerta } = await preparar();

    await marcarDescuento();
    await elegir('MED-0001', '20');
    await enviar();

    expect(alerta()).toEqual([
      'Stock insuficiente: disponible 15, solicitado 20.',
      'No se guardó el registro ni se descontó stock.',
    ]);
    expect(dialogo.close).not.toHaveBeenCalled();
    // Un fallo definitivo no bloquea: se puede corregir y volver a guardar.
    expect(campos().every((c) => !deshabilitado(c))).toBe(true);
    expect(dialogo.disableClose).toBe(false);
  });

  describe('resultado incierto (503 sin confirmar, 502, 500, sin red)', () => {
    const MENSAJE_503 = 'No se pudo confirmar; puede reintentar sin riesgo de descontar dos veces.';
    const NOTA_INCIERTO =
      'No se pudo confirmar si el registro se guardó. Use «Reintentar» para enviar los mismos ' +
      'datos (no se duplicará el registro ni se descontará stock dos veces) o «Cancelar».';
    const conDescuento = { ...sinDescuento, idMedicamento: 'MED-0001', cantidad: 2 };
    const sinConfirmar = () => throwError(() => new ApiError(503, [MENSAJE_503]));

    async function medicacionSinConfirmar(primerFallo = sinConfirmar()) {
      servicio.crear.mockReturnValueOnce(primerFallo);
      const vista = await preparar();
      await vista.marcarDescuento();
      await vista.elegir('MED-0001', '2');
      await vista.enviar();
      return vista;
    }

    it('503: bloquea los campos y solo ofrece Reintentar o Cancelar', async () => {
      const { elemento, alerta } = await medicacionSinConfirmar();

      expect(alerta()).toEqual([MENSAJE_503, NOTA_INCIERTO]);
      expect(alerta().join(' ')).not.toContain('pudo registrarse igualmente');
      expect(campos()).not.toHaveLength(0);
      expect(campos().every((c) => deshabilitado(c))).toBe(true);
      expect(elemento.querySelector('button[type="submit"]')).toBeNull();
      expect(botones()).toEqual(['Cancelar', 'Reintentar']);
      // Tampoco se cierra con Esc ni clic fuera (se saltaría el aviso de Cancelar).
      expect(dialogo.disableClose).toBe(true);
      expect(dialogo.close).not.toHaveBeenCalled();
    });

    it('Reintentar repite la misma clave y el mismo cuerpo, y el alta cierra el diálogo', async () => {
      const { pulsar } = await medicacionSinConfirmar();
      servicio.crear.mockReturnValueOnce(of(creado));

      await pulsar('Reintentar');

      expect(servicio.crear).toHaveBeenCalledTimes(2);
      expect(servicio.crear).toHaveBeenNthCalledWith(1, 'PAC-0001', conDescuento, 'clave-1');
      expect(servicio.crear).toHaveBeenNthCalledWith(2, 'PAC-0001', conDescuento, 'clave-1');
      expect(dialogo.close).toHaveBeenCalledWith(creado);
    });

    it('si el reintento vuelve a fallar sigue bloqueado y con la misma clave', async () => {
      const { pulsar, alerta } = await medicacionSinConfirmar();
      servicio.crear
        .mockReturnValueOnce(throwError(() => new ApiError(400, ['Stock insuficiente.'])))
        .mockReturnValueOnce(of(creado));

      await pulsar('Reintentar');
      expect(alerta()).toEqual(['Stock insuficiente.', NOTA_INCIERTO]);
      expect(campos().every((c) => deshabilitado(c))).toBe(true);
      expect(botones()).toEqual(['Cancelar', 'Reintentar']);

      await pulsar('Reintentar');
      expect(servicio.crear.mock.calls.map(([, cuerpo, clave]) => [cuerpo, clave])).toEqual([
        [conDescuento, 'clave-1'],
        [conDescuento, 'clave-1'],
        [conDescuento, 'clave-1'],
      ]);
    });

    it('Cancelar cierra sin registro y avisa de revisar el historial y el stock', async () => {
      const { pulsar } = await medicacionSinConfirmar();

      await pulsar('Cancelar');

      expect(dialogo.close).toHaveBeenCalledWith('sin-confirmar');
      expect(notificaciones.error).toHaveBeenCalledWith([
        'No se confirmó el registro. Revise el historial del paciente y el stock del medicamento ' +
          'antes de volver a registrarlo.',
      ]);
      expect(servicio.crear).toHaveBeenCalledTimes(1);
    });

    it('sin descuento, Cancelar avisa solo de revisar el historial', async () => {
      servicio.crear.mockReturnValueOnce(sinConfirmar());
      const { enviar, pulsar } = await preparar();
      await enviar();

      await pulsar('Cancelar');

      expect(notificaciones.error).toHaveBeenCalledWith([
        'No se confirmó el registro. Revise el historial del paciente antes de volver a registrarlo.',
      ]);
    });

    it.each([
      ['502', new ApiError(502, ['El servicio de medicamentos respondió de forma inesperada.'])],
      ['500', new ApiError(500, ['Se produjo un error interno. Vuelva a intentarlo más tarde.'])],
      ['sin red (estado 0)', new ApiError(0, ['No se pudo conectar con el servidor.'])],
      ['un error no HTTP', new Error('x')],
    ])('%s también bloquea y el reintento usa la misma clave', async (_caso, fallo) => {
      const { pulsar } = await medicacionSinConfirmar(throwError(() => fallo));
      expect(campos().every((c) => deshabilitado(c))).toBe(true);
      servicio.crear.mockReturnValueOnce(of(creado));

      await pulsar('Reintentar');

      expect(servicio.crear).toHaveBeenNthCalledWith(2, 'PAC-0001', conDescuento, 'clave-1');
      expect(dialogo.close).toHaveBeenCalledWith(creado);
    });
  });

  it('un error sin descuento no añade notas sobre el stock', async () => {
    servicio.crear.mockReturnValue(throwError(() => new ApiError(400, ['Mensaje.'])));
    const { enviar, alerta } = await preparar();

    await enviar();

    expect(alerta()).toEqual(['Mensaje.']);
  });
});
