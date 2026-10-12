import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { mensajesDeError } from '../../../core/http/api-error';
import { ErroresFormularioComponent } from '../../../shared/errores-formulario/errores-formulario.component';
import {
  edad,
  habitacion,
  nombrePersona,
  obligatorio,
  primerError,
} from '../../../shared/validadores';
import { Paciente } from '../paciente.models';
import { PacienteService } from '../paciente.service';

export interface DatosPacienteDialogo {
  /** Sin paciente: alta. Con paciente: edición. */
  paciente?: Paciente;
}

/**
 * Alta y edición de un paciente. Guarda él mismo para mostrar dentro del
 * formulario los errores del servidor; se cierra con el paciente guardado.
 */
@Component({
  selector: 'app-paciente-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  templateUrl: './paciente-dialogo.component.html',
  styleUrl: './paciente-dialogo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PacienteDialogoComponent {
  private readonly servicio = inject(PacienteService);
  private readonly dialogo = inject<MatDialogRef<PacienteDialogoComponent, Paciente>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly paciente = inject<DatosPacienteDialogo>(MAT_DIALOG_DATA).paciente;
  protected readonly formulario = this.fb.group({
    nombre: [
      this.paciente?.nombre ?? '',
      [obligatorio('El nombre completo es obligatorio.'), nombrePersona()],
    ],
    edad: this.fb.control<number | null>(this.paciente?.edad ?? null, [
      obligatorio('La edad es obligatoria.'),
      edad,
    ]),
    habitacion: this.fb.control<number | null>(this.paciente?.habitacion ?? null, [
      obligatorio('El número de habitación es obligatorio.'),
      habitacion,
    ]),
  });
  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  protected readonly primerError = primerError;

  protected guardar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const valores = this.formulario.getRawValue();
    const datos = {
      nombre: valores.nombre.trim(),
      edad: valores.edad!,
      habitacion: valores.habitacion!,
    };
    this.enviando.set(true);
    this.errores.set([]);
    const peticion = this.paciente
      ? this.servicio.editar(this.paciente.idPaciente, datos)
      : this.servicio.registrar(datos);
    peticion.subscribe({
      next: (guardado) => this.dialogo.close(guardado),
      error: (error: unknown) => {
        this.errores.set(mensajesDeError(error));
        this.enviando.set(false);
      },
    });
  }
}
