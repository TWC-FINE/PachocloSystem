import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { mensajesDeError } from '../../../core/http/api-error';
import { ErroresFormularioComponent } from '../../../shared/errores-formulario/errores-formulario.component';
import {
  enteroEntre,
  longitudMaxima,
  obligatorio,
  primerError,
  unoDe,
} from '../../../shared/validadores';
import {
  DatosMedicamento,
  ETIQUETAS_PRESENTACION,
  Medicamento,
  PRESENTACIONES,
  Presentacion,
} from '../medicamento.models';
import { MedicamentoService } from '../medicamento.service';

export interface DatosMedicamentoDialogo {
  /** Sin medicamento: alta (con stock inicial). Con medicamento: edición (sin stock). */
  medicamento?: Medicamento;
}

/** Texto obligatorio con longitud máxima, como `@NotBlank` + `@Size(max)` del backend. */
function texto(obligatorioMensaje: string, maximo: number, maximoMensaje: string): ValidatorFn[] {
  return [obligatorio(obligatorioMensaje), longitudMaxima(maximo, maximoMensaje)];
}

/**
 * Alta y edición de un medicamento, con las validaciones de
 * `CrearMedicamentoRequest` / `ActualizarMedicamentoRequest` de
 * MedicamentosService. El stock solo se fija en el alta; después cambia con
 * entradas y salidas.
 */
@Component({
  selector: 'app-medicamento-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  templateUrl: './medicamento-dialogo.component.html',
  styleUrl: './medicamento-dialogo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MedicamentoDialogoComponent {
  private readonly servicio = inject(MedicamentoService);
  private readonly dialogo =
    inject<MatDialogRef<MedicamentoDialogoComponent, Medicamento>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly medicamento = inject<DatosMedicamentoDialogo>(MAT_DIALOG_DATA).medicamento;
  protected readonly formulario = this.fb.group({
    nombre: [
      this.medicamento?.nombre ?? '',
      texto('El nombre es obligatorio.', 80, 'El nombre no puede superar 80 caracteres.'),
    ],
    principioActivo: [
      this.medicamento?.principioActivo ?? '',
      texto(
        'El principio activo es obligatorio.',
        80,
        'El principio activo no puede superar 80 caracteres.',
      ),
    ],
    presentacion: this.fb.control<Presentacion | ''>(this.medicamento?.presentacion ?? '', [
      obligatorio('La presentación es obligatoria.'),
      unoDe(PRESENTACIONES, 'La presentación no es válida.'),
    ]),
    concentracion: [
      this.medicamento?.concentracion ?? '',
      texto(
        'La concentración es obligatoria.',
        40,
        'La concentración no puede superar 40 caracteres.',
      ),
    ],
    laboratorio: [
      this.medicamento?.laboratorio ?? '',
      texto('El laboratorio es obligatorio.', 80, 'El laboratorio no puede superar 80 caracteres.'),
    ],
    lote: [
      this.medicamento?.lote ?? '',
      texto('El lote es obligatorio.', 40, 'El lote no puede superar 40 caracteres.'),
    ],
    cantidadStock: this.fb.control<number | null>(
      { value: null, disabled: this.medicamento !== undefined },
      [
        obligatorio('La cantidad en stock es obligatoria.'),
        enteroEntre(0, 1_000_000, 'La cantidad en stock debe estar entre 0 y 1000000.'),
      ],
    ),
    stockMinimo: this.fb.control<number | null>(this.medicamento?.stockMinimo ?? null, [
      obligatorio('El stock mínimo es obligatorio.'),
      enteroEntre(0, 1_000_000, 'El stock mínimo debe estar entre 0 y 1000000.'),
    ]),
    /** Texto "AAAA-MM-DD" del `<input type="date">`; nunca pasa por `Date`. */
    fechaVencimiento: [
      this.medicamento?.fechaVencimiento ?? '',
      obligatorio('La fecha de vencimiento es obligatoria.'),
    ],
    ubicacion: [
      this.medicamento?.ubicacion ?? '',
      texto(
        'La ubicación de almacenamiento es obligatoria.',
        80,
        'La ubicación no puede superar 80 caracteres.',
      ),
    ],
  });
  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  protected readonly presentaciones = PRESENTACIONES;
  protected readonly etiquetasPresentacion = ETIQUETAS_PRESENTACION;
  protected readonly primerError = primerError;

  protected guardar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const v = this.formulario.getRawValue();
    const datos: DatosMedicamento = {
      nombre: v.nombre.trim(),
      principioActivo: v.principioActivo.trim(),
      presentacion: v.presentacion as Presentacion,
      concentracion: v.concentracion.trim(),
      laboratorio: v.laboratorio.trim(),
      lote: v.lote.trim(),
      stockMinimo: v.stockMinimo!,
      fechaVencimiento: v.fechaVencimiento,
      ubicacion: v.ubicacion.trim(),
    };
    this.enviando.set(true);
    this.errores.set([]);
    const peticion = this.medicamento
      ? this.servicio.editar(this.medicamento.idMedicamento, datos)
      : this.servicio.registrar({ ...datos, cantidadStock: v.cantidadStock! });
    peticion.subscribe({
      next: (guardado) => this.dialogo.close(guardado),
      error: (error: unknown) => {
        this.errores.set(mensajesDeError(error));
        this.enviando.set(false);
      },
    });
  }
}
