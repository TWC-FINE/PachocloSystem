import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Observable } from 'rxjs';
import { mensajesDeError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { ErroresFormularioComponent } from '../../../shared/errores-formulario/errores-formulario.component';
import {
  SIN_CONFIRMAR,
  esResultadoIncierto,
  nuevaClaveIdempotencia,
} from '../../../shared/idempotencia';
import { enteroEntre, obligatorio, primerError } from '../../../shared/validadores';
import { Medicamento, TipoMovimiento } from '../medicamento.models';
import { MedicamentoService } from '../medicamento.service';

export interface DatosMovimientoDialogo {
  medicamento: Medicamento;
  tipo: TipoMovimiento;
}

/**
 * Resultado del diálogo: el medicamento actualizado, {@link SIN_CONFIRMAR} o, si
 * se cerró sin enviar nada, `undefined`.
 */
export type ResultadoMovimientoDialogo = Medicamento | typeof SIN_CONFIRMAR;

/**
 * Tras un resultado incierto la salida pudo hacerse, así que el formulario queda
 * bloqueado: repetir la misma petición con la misma clave es seguro (el backend
 * devuelve la respuesta guardada y no descuenta dos veces), mientras que
 * cambiarla con otra clave podría descontar de más.
 */
const NOTA_INCIERTO =
  'No se pudo confirmar si la salida se registró. Use «Reintentar» para enviar los mismos ' +
  'datos (no se descontará el stock dos veces) o «Cancelar».';
const AVISO_CANCELADO =
  'No se confirmó la salida. Revise el stock del medicamento antes de volver a registrarla.';

/**
 * Entrada o salida de stock. Si una salida supera el stock disponible (o el
 * medicamento está vencido) lo decide el servidor, que tiene el stock real,
 * y su mensaje se muestra en el formulario.
 *
 * Las salidas llevan `Idempotency-Key` (ver {@link MedicamentoService.moverStock}):
 * un reintento del mismo intento no descuenta dos veces.
 */
@Component({
  selector: 'app-movimiento-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  template: `
    <h2 mat-dialog-title>{{ esEntrada ? 'Entrada de stock' : 'Salida de stock' }}</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content>
        <app-errores-formulario [mensajes]="errores()" />
        <p>
          {{ medicamento.nombre }} {{ medicamento.concentracion }} ({{ medicamento.idMedicamento }},
          lote {{ medicamento.lote }}). Stock disponible: {{ medicamento.cantidadStock }}.
        </p>
        <mat-form-field class="campo-completo">
          <mat-label>{{ esEntrada ? 'Unidades que entran' : 'Unidades que salen' }}</mat-label>
          <input
            matInput
            type="number"
            formControlName="cantidad"
            min="1"
            max="1000000"
            step="1"
            required
            cdkFocusInitial
          />
          <mat-error>{{ primerError(formulario.controls.cantidad) }}</mat-error>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        @if (incierto()) {
          <!-- Resultado incierto: solo repetir lo mismo o salir (con aviso). -->
          <button mat-button type="button" (click)="cancelar()" [disabled]="enviando()">
            Cancelar
          </button>
          <button mat-flat-button type="button" (click)="reintentar()" [disabled]="enviando()">
            Reintentar
          </button>
        } @else {
          <button mat-button type="button" mat-dialog-close [disabled]="enviando()">
            Cancelar
          </button>
          <button mat-flat-button type="submit" [disabled]="enviando()">
            {{ esEntrada ? 'Registrar entrada' : 'Registrar salida' }}
          </button>
        }
      </mat-dialog-actions>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MovimientoDialogoComponent {
  private readonly servicio = inject(MedicamentoService);
  private readonly dialogo =
    inject<MatDialogRef<MovimientoDialogoComponent, ResultadoMovimientoDialogo>>(MatDialogRef);
  private readonly datos = inject<DatosMovimientoDialogo>(MAT_DIALOG_DATA);
  private readonly notificaciones = inject(NotificacionService);

  protected readonly medicamento = this.datos.medicamento;
  protected readonly esEntrada = this.datos.tipo === 'entrada';
  /**
   * Solo las salidas se pueden repetir sin descuadrar el stock: el backend acepta
   * `Idempotency-Key` en `/salidas` y no en `/entradas`. Sin clave, un reintento
   * tras un resultado incierto sí podría sumar stock dos veces, así que en las
   * entradas se mantiene el comportamiento de siempre (avisar y dejar corregir).
   */
  private readonly idempotente = this.datos.tipo === 'salida';
  protected readonly formulario = inject(NonNullableFormBuilder).group({
    cantidad: [
      null as number | null,
      [
        obligatorio('La cantidad es obligatoria.'),
        enteroEntre(1, 1_000_000, 'La cantidad debe ser un entero entre 1 y 1000000.'),
      ],
    ],
  });
  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  /** Tras un resultado incierto: campos bloqueados; solo «Reintentar» o «Cancelar». */
  protected readonly incierto = signal(false);
  protected readonly primerError = primerError;
  /** Clave del intento actual: nueva al abrir el diálogo, tras un registro correcto y tras un 4xx. */
  private clave = nuevaClaveIdempotencia();
  /** Cantidad enviada con la clave actual: «Reintentar» repite exactamente lo mismo. */
  private cantidadEnviada: number | null = null;

  protected guardar(): void {
    if (this.enviando() || this.incierto()) {
      return;
    }
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    this.enviar(this.formulario.getRawValue().cantidad!);
  }

  /** Tras un resultado incierto: la misma cantidad con la misma clave. */
  protected reintentar(): void {
    if (!this.enviando() && this.incierto() && this.cantidadEnviada !== null) {
      this.enviar(this.cantidadEnviada);
    }
  }

  /**
   * Tras un resultado incierto: avisa de qué conviene revisar y cierra con
   * {@link SIN_CONFIRMAR}, para que la lista se recargue y muestre el stock real.
   */
  protected cancelar(): void {
    if (this.enviando()) {
      return;
    }
    this.notificaciones.error([AVISO_CANCELADO]);
    this.dialogo.close(SIN_CONFIRMAR);
  }

  private enviar(cantidad: number): void {
    this.cantidadEnviada = cantidad;
    this.enviando.set(true);
    if (this.idempotente) {
      // Mientras se envía (y si el resultado queda incierto) no se cierra con Esc ni clic fuera.
      this.dialogo.disableClose = true;
    }
    this.errores.set([]);
    this.pedirMovimiento(cantidad).subscribe({
      next: (actualizado) => {
        this.clave = nuevaClaveIdempotencia();
        this.dialogo.close(actualizado);
      },
      error: (error: unknown) => {
        if (this.idempotente && (this.incierto() || esResultadoIncierto(error))) {
          // Una vez incierto sigue siéndolo aunque el reintento falle de otra
          // forma: solo una salida correcta lo resuelve.
          this.bloquear();
          this.errores.set([...mensajesDeError(error), NOTA_INCIERTO]);
        } else {
          if (this.idempotente) {
            // 4xx definitivo: no se descontó nada, así que la clave se renueva
            // (aunque el 409 diga que ya se usó con otros datos).
            this.clave = nuevaClaveIdempotencia();
            this.dialogo.disableClose = false;
          }
          this.errores.set(mensajesDeError(error));
        }
        this.enviando.set(false);
      },
    });
  }

  /**
   * Las salidas llevan la clave del intento (el backend las sabe repetir); las
   * entradas se piden igual que siempre, sin clave: `/entradas` no la acepta.
   */
  private pedirMovimiento(cantidad: number): Observable<Medicamento> {
    const { idMedicamento } = this.medicamento;
    return this.idempotente
      ? this.servicio.moverStock(idMedicamento, this.datos.tipo, cantidad, this.clave)
      : this.servicio.moverStock(idMedicamento, this.datos.tipo, cantidad);
  }

  private bloquear(): void {
    this.incierto.set(true);
    this.formulario.disable({ emitEvent: false });
    this.dialogo.disableClose = true;
  }
}
