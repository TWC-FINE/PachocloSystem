import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ErrorStateMatcher } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { startWith } from 'rxjs';
import { NotificacionService } from '../../../core/notificacion.service';
import { PermisosService } from '../../../core/permisos';
import { ApiError, mensajesDeError } from '../../../core/http/api-error';
import { ErroresFormularioComponent } from '../../../shared/errores-formulario/errores-formulario.component';
import {
  contieneLetra,
  enteroEntre,
  longitudMinima,
  numeroEntre,
  obligatorio,
  primerError,
} from '../../../shared/validadores';
import { generarUuid } from '../../../shared/uuid';
import { Medicamento } from '../../medicamentos/medicamento.models';
import { MedicamentoService } from '../../medicamentos/medicamento.service';
import { Paciente } from '../../pacientes/paciente.models';
import {
  ETIQUETAS_TIPO,
  Registro,
  RegistroRequest,
  TIPOS_REGISTRO,
  TipoRegistro,
} from '../historial.models';
import { HistorialService } from '../historial.service';

/** Trabajador con el que se firmará el registro nuevo. */
export interface AutorNuevoRegistro {
  idTrabajador: string;
  /**
   * Nombre del trabajador, si se conoce. Opcional y `null` para que una sesión
   * guardada antes de que el backend enviara el nombre no rompa nada.
   */
  nombreCompleto?: string | null;
}

export interface DatosRegistroDialogo {
  paciente: Paciente;
  /** Trabajador del usuario actual, solo para mostrarlo: el backend firma con él. */
  autor: AutorNuevoRegistro;
}

/** Se canceló tras un resultado incierto: el registro pudo crearse, conviene recargar la lista. */
export const SIN_CONFIRMAR = 'sin-confirmar';

/**
 * Resultado del diálogo: el registro creado, {@link SIN_CONFIRMAR} o, si se
 * cerró sin enviar nada, `undefined`.
 */
export type ResultadoRegistroDialogo = Registro | typeof SIN_CONFIRMAR;

const MENSAJE_PRESION = 'La presión diastólica debe ser menor que la sistólica.';

/**
 * Si falla un registro con descuento, el backend no lo guarda: hace la salida
 * de stock antes y solo guarda si sale bien.
 */
const NOTA_SIN_GUARDAR = 'No se guardó el registro ni se descontó stock.';

/** 409 al crear: la clave ya se usó con otra petición. Con la clave nueva se puede reenviar. */
const NOTA_CLAVE_USADA = 'Revise los datos y vuelva a guardar el registro.';

/**
 * Tras un resultado incierto el formulario queda bloqueado: repetir la misma
 * petición con la misma clave es seguro (el backend devuelve el registro si ya
 * se creó y no descuenta dos veces); cambiar los datos con otra clave podría
 * duplicar el registro o el descuento.
 */
const NOTA_INCIERTO =
  'No se pudo confirmar si el registro se guardó. Use «Reintentar» para enviar los mismos ' +
  'datos (no se duplicará el registro ni se descontará stock dos veces) o «Cancelar».';
const AVISO_CANCELADO =
  'No se confirmó el registro. Revise el historial del paciente antes de volver a registrarlo.';
const AVISO_CANCELADO_CON_STOCK =
  'No se confirmó el registro. Revise el historial del paciente y el stock del medicamento ' +
  'antes de volver a registrarlo.';

/**
 * Clave `Idempotency-Key` de un intento de registro: la misma en sus reintentos
 * (dobles clics, errores de red, 503), nueva para cada registro distinto.
 */
function nuevaClave(): string {
  return generarUuid();
}

/**
 * Errores tras los que no se sabe si el alta llegó a hacerse: sin respuesta de
 * la API (red, proxy: estado 0 o 5xx sin cuerpo), cualquier 5xx (503 sin
 * confirmar, 502, 500) o un error que ni siquiera es HTTP. Los 4xx son
 * definitivos: el backend no hizo nada y no consumió la clave.
 */
function esIncierto(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

/** Estado del inventario para elegir el medicamento a descontar; se carga al pedirlo. */
type Inventario =
  | { estado: 'sin-cargar' | 'cargando' }
  | { estado: 'listo'; medicamentos: readonly Medicamento[] }
  | { estado: 'error'; mensajes: readonly string[] };

/** Como `HistorialClinicoService`: la diastólica debe ser menor que la sistólica. */
function diastolicaMenorQueSistolica(grupo: AbstractControl): ValidationErrors | null {
  const sistolica = grupo.get('presionSistolica')?.value as number | null;
  const diastolica = grupo.get('presionDiastolica')?.value as number | null;
  if (sistolica === null || diastolica === null) {
    return null;
  }
  return Number(diastolica) >= Number(sistolica) ? { presion: MENSAJE_PRESION } : null;
}

/**
 * Nuevo registro del historial de un paciente. Las validaciones son las de
 * `RegistroRequest`, `SignosVitalesRequest` y `HistorialClinicoService`, con sus
 * mensajes: SIGNOS_VITALES pide los signos estructurados; el resto, contenido.
 */
@Component({
  selector: 'app-registro-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatSelectModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  templateUrl: './registro-dialogo.component.html',
  styleUrl: './registro-dialogo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistroDialogoComponent {
  private readonly servicio = inject(HistorialService);
  private readonly medicamentos = inject(MedicamentoService);
  private readonly dialogo =
    inject<MatDialogRef<RegistroDialogoComponent, ResultadoRegistroDialogo>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly datos = inject<DatosRegistroDialogo>(MAT_DIALOG_DATA);

  /**
   * Autor tal y como se muestra: «Eva Mora (DOC-0001)» o solo el ID si el
   * nombre falta (`null`, vacío o ausente, p. ej. una sesión guardada antes de
   * que el backend lo enviara). Nunca «null», «undefined» ni unos paréntesis
   * vacíos.
   */
  protected readonly autor = computed(() => {
    const { idTrabajador, nombreCompleto } = this.datos.autor;
    const nombre = nombreCompleto?.trim();
    return nombre ? `${nombre} (${idTrabajador})` : idTrabajador;
  });

  protected readonly formulario = this.fb.group({
    tipo: this.fb.control<TipoRegistro | null>(
      null,
      obligatorio('Debe seleccionar un tipo de registro.'),
    ),
    contenido: [
      '',
      [
        obligatorio('El contenido no puede estar vacío.'),
        longitudMinima(5, 'El contenido es demasiado corto (mínimo 5 caracteres).'),
        contieneLetra('El contenido debe incluir texto descriptivo, no solo números.'),
      ],
    ],
    signos: this.fb.group(
      {
        temperatura: this.fb.control<number | null>(null, [
          obligatorio('Temperatura: es obligatoria.'),
          numeroEntre(30, 45, 'Temperatura: debe ser un número entre 30.0 y 45.0 °C.'),
        ]),
        frecCardiaca: this.fb.control<number | null>(null, [
          obligatorio('Frecuencia Cardíaca: es obligatoria.'),
          enteroEntre(20, 250, 'Frecuencia Cardíaca: debe ser entre 20 y 250 lpm.'),
        ]),
        presionSistolica: this.fb.control<number | null>(null, [
          obligatorio('Presión Sistólica: es obligatoria.'),
          enteroEntre(50, 250, 'Presión Sistólica: debe ser entre 50 y 250 mmHg.'),
        ]),
        presionDiastolica: this.fb.control<number | null>(null, [
          obligatorio('Presión Diastólica: es obligatoria.'),
          enteroEntre(30, 150, 'Presión Diastólica: debe ser entre 30 y 150 mmHg.'),
        ]),
        frecRespiratoria: this.fb.control<number | null>(null, [
          obligatorio('Frecuencia Respiratoria: es obligatoria.'),
          enteroEntre(5, 60, 'Frecuencia Respiratoria: debe ser entre 5 y 60 rpm.'),
        ]),
        saturacion: this.fb.control<number | null>(null, [
          obligatorio('Saturación de Oxígeno: es obligatoria.'),
          enteroEntre(0, 100, 'Saturación de Oxígeno: debe ser entre 0 y 100%.'),
        ]),
        observaciones: ['', contieneLetra('Las observaciones no pueden ser solo números.')],
      },
      { validators: diastolicaMenorQueSistolica },
    ),
    /** Solo MEDICACION: si se marca, se envían medicamento y cantidad (los dos o ninguno). */
    descontarStock: [false],
    idMedicamento: ['', obligatorio('Seleccione el medicamento administrado.')],
    cantidad: this.fb.control<number | null>(null, [
      obligatorio('La cantidad administrada es obligatoria.'),
      enteroEntre(1, 1_000_000, 'La cantidad administrada debe ser un entero entre 1 y 1000000.'),
    ]),
  });
  protected readonly tipo = toSignal(
    this.formulario.controls.tipo.valueChanges.pipe(startWith(this.formulario.controls.tipo.value)),
    { requireSync: true },
  );
  protected readonly descontar = toSignal(this.formulario.controls.descontarStock.valueChanges, {
    initialValue: false,
  });
  protected readonly inventario = signal<Inventario>({ estado: 'sin-cargar' });
  protected readonly medicamentosInventario = computed(() => {
    const inventario = this.inventario();
    return inventario.estado === 'listo' ? inventario.medicamentos : [];
  });
  protected readonly erroresInventario = computed(() => {
    const inventario = this.inventario();
    return inventario.estado === 'error' ? inventario.mensajes : [];
  });
  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  /** Tras pulsar «Guardar» con el formulario incompleto: solo entonces se muestran los avisos. */
  protected readonly intentado = signal(false);
  /** Tras un resultado incierto: campos bloqueados; solo «Reintentar» o «Cancelar». */
  protected readonly incierto = signal(false);
  /** Clave del intento actual: nueva al abrir el diálogo, tras un alta correcta y tras un 409. */
  private clave = nuevaClave();
  /** Cuerpo enviado con la clave actual: «Reintentar» lo repite tal cual. */
  private enviada: RegistroRequest | null = null;
  private readonly notificaciones = inject(NotificacionService);

  /** El enfermero no crea diagnósticos (403 en el backend): ni siquiera se ofrece. */
  protected readonly tipos = TIPOS_REGISTRO.filter(
    (tipo) => tipo !== 'DIAGNOSTICO' || inject(PermisosService).puede('historial.diagnosticar'),
  );
  protected readonly etiquetasTipo = ETIQUETAS_TIPO;
  protected readonly primerError = primerError;
  /**
   * El aviso del contenido aparece si el campo se tocó o si se intentó guardar. Al cambiar de
   * tipo se reinician ambos (ver constructor), así no arrastra el aviso del tipo anterior.
   */
  protected readonly matcherContenido: ErrorStateMatcher = {
    isErrorState: (control) =>
      !!control && control.invalid && (control.touched || this.intentado()),
  };
  protected readonly signos = this.formulario.controls.signos.controls;

  constructor() {
    const { tipo, contenido, descontarStock } = this.formulario.controls;
    tipo.valueChanges.pipe(startWith(null), takeUntilDestroyed()).subscribe(() => {
      // Al cambiar de tipo, el contenido y el intento de guardado vuelven a cero, para no
      // arrastrar el aviso del tipo anterior. El texto escrito se conserva (no se toca el
      // valor) igual que el medicamento y la cantidad, que solo se habilitan o deshabilitan.
      contenido.markAsPristine();
      contenido.markAsUntouched();
      this.intentado.set(false);
      this.habilitarCampos();
    });
    descontarStock.valueChanges
      .pipe(startWith(null), takeUntilDestroyed())
      .subscribe(() => this.habilitarCampos());
    descontarStock.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((descontar) => descontar && this.cargarInventario());
  }

  /** Stock del medicamento elegido, para orientar al elegir la cantidad. */
  protected stockElegido(): number | null {
    const id = this.formulario.controls.idMedicamento.value;
    return this.medicamentosInventario().find((m) => m.idMedicamento === id)?.cantidadStock ?? null;
  }

  /** Error de presión del grupo, cuando ya se tocó alguna de las dos. */
  protected errorPresion(): string | null {
    const grupo = this.formulario.controls.signos;
    const tocada = this.signos.presionSistolica.touched || this.signos.presionDiastolica.touched;
    return tocada && grupo.hasError('presion') ? MENSAJE_PRESION : null;
  }

  protected guardar(): void {
    if (this.enviando() || this.incierto()) {
      return;
    }
    if (this.formulario.invalid) {
      this.intentado.set(true);
      this.formulario.markAllAsTouched();
      return;
    }
    this.enviar(this.solicitud());
  }

  /** Tras un resultado incierto: la misma petición, con la misma clave y el mismo cuerpo. */
  protected reintentar(): void {
    if (!this.enviando() && this.incierto() && this.enviada !== null) {
      this.enviar(this.enviada);
    }
  }

  /**
   * Tras un resultado incierto: avisa de qué conviene revisar y cierra con
   * {@link SIN_CONFIRMAR}, para que la lista se recargue y se vea si el registro
   * llegó a crearse.
   */
  protected cancelar(): void {
    if (this.enviando()) {
      return;
    }
    const conStock = this.enviada?.idMedicamento != null;
    this.notificaciones.error([conStock ? AVISO_CANCELADO_CON_STOCK : AVISO_CANCELADO]);
    this.dialogo.close(SIN_CONFIRMAR);
  }

  private enviar(solicitud: RegistroRequest): void {
    this.enviada = solicitud;
    this.enviando.set(true);
    // Mientras se envía (y si el resultado queda incierto) no se cierra con Esc ni clic fuera.
    this.dialogo.disableClose = true;
    this.errores.set([]);
    this.servicio.crear(this.datos.paciente.idPaciente, solicitud, this.clave).subscribe({
      // Un 201 repetido (Idempotency-Replayed: true) es el mismo registro: un alta normal.
      next: (creado) => {
        this.clave = nuevaClave();
        this.dialogo.close(creado);
      },
      error: (error: unknown) => {
        if (this.incierto() || esIncierto(error)) {
          // Una vez incierto, sigue así aunque el reintento falle de otra forma: solo un
          // alta correcta lo resuelve.
          this.bloquear();
          this.errores.set([...mensajesDeError(error), NOTA_INCIERTO]);
        } else {
          const claveUsada = error instanceof ApiError && error.status === 409;
          if (claveUsada) {
            this.clave = nuevaClave();
          }
          this.errores.set([
            ...this.mensajesDeFallo(error, solicitud),
            ...(claveUsada ? [NOTA_CLAVE_USADA] : []),
          ]);
          this.dialogo.disableClose = false;
        }
        this.enviando.set(false);
      },
    });
  }

  private bloquear(): void {
    this.incierto.set(true);
    this.formulario.disable({ emitEvent: false });
    this.dialogo.disableClose = true;
  }

  /** Mensajes de un fallo definitivo (4xx) y, si se pidió descontar stock, que no se descontó. */
  private mensajesDeFallo(error: unknown, solicitud: RegistroRequest): readonly string[] {
    const mensajes = mensajesDeError(error);
    return solicitud.idMedicamento === null ? mensajes : [...mensajes, NOTA_SIN_GUARDAR];
  }

  private cargarInventario(): void {
    const estado = this.inventario().estado;
    if (estado === 'cargando' || estado === 'listo') {
      return;
    }
    this.inventario.set({ estado: 'cargando' });
    this.medicamentos.listar().subscribe({
      next: (medicamentos) => this.inventario.set({ estado: 'listo', medicamentos }),
      error: (error: unknown) => {
        // Sin inventario no se puede descontar, pero la medicación se puede guardar igual.
        this.inventario.set({ estado: 'error', mensajes: mensajesDeError(error) });
        this.formulario.controls.descontarStock.setValue(false);
      },
    });
  }

  private solicitud(): RegistroRequest {
    const v = this.formulario.getRawValue();
    const tipo = v.tipo!;
    const esSignos = tipo === 'SIGNOS_VITALES';
    const observaciones = v.signos.observaciones.trim();
    const descuenta = tipo === 'MEDICACION' && v.descontarStock;
    return {
      tipo,
      contenido: esSignos ? null : v.contenido.trim(),
      signosVitales: esSignos
        ? {
            temperatura: v.signos.temperatura!,
            frecCardiaca: v.signos.frecCardiaca!,
            presionSistolica: v.signos.presionSistolica!,
            presionDiastolica: v.signos.presionDiastolica!,
            frecRespiratoria: v.signos.frecRespiratoria!,
            saturacion: v.signos.saturacion!,
            observaciones: observaciones || null,
          }
        : null,
      idMedicamento: descuenta ? v.idMedicamento : null,
      cantidad: descuenta ? v.cantidad : null,
    };
  }

  /** Solo cuentan para la validación los campos del tipo elegido (y del descuento, si se pide). */
  private habilitarCampos(): void {
    if (this.incierto()) {
      return; // Bloqueado: nada vuelve a habilitar los campos.
    }
    const {
      tipo: control,
      contenido,
      signos,
      descontarStock,
      idMedicamento,
      cantidad,
    } = this.formulario.controls;
    const tipo = control.value;
    const opciones = { emitEvent: false };
    const esMedicacion = tipo === 'MEDICACION';
    for (const [campo, habilitado] of [
      [descontarStock, esMedicacion],
      [idMedicamento, esMedicacion && descontarStock.value],
      [cantidad, esMedicacion && descontarStock.value],
    ] as const) {
      if (habilitado) {
        campo.enable(opciones);
      } else {
        campo.disable(opciones);
      }
    }
    if (tipo !== null && tipo !== 'SIGNOS_VITALES') {
      contenido.enable(opciones);
    } else {
      contenido.disable(opciones);
    }
    if (tipo === 'SIGNOS_VITALES') {
      signos.enable(opciones);
    } else {
      signos.disable(opciones);
    }
  }
}
