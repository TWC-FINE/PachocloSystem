import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { mensajesDeError } from '../../../core/http/api-error';
import { ErroresFormularioComponent } from '../../../shared/errores-formulario/errores-formulario.component';
import { habitacion, obligatorio, primerError } from '../../../shared/validadores';
import { Paciente } from '../paciente.models';
import { PacienteService } from '../paciente.service';

export interface DatosHabitacionDialogo {
  paciente: Paciente;
}

/** Cambia solo la habitación (`PATCH`); se cierra con el paciente actualizado. */
@Component({
  selector: 'app-habitacion-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  template: `
    <h2 mat-dialog-title>Cambiar habitación</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content>
        <app-errores-formulario [mensajes]="errores()" />
        <p>
          {{ paciente.nombre }} ({{ paciente.idPaciente }}) está en la habitación
          {{ paciente.habitacion }}.
        </p>
        <mat-form-field class="campo-completo">
          <mat-label>Nueva habitación</mat-label>
          <input
            matInput
            type="number"
            formControlName="habitacion"
            min="1"
            max="999"
            step="1"
            required
            cdkFocusInitial
          />
          <mat-error>{{ primerError(formulario.controls.habitacion) }}</mat-error>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [mat-dialog-close]="undefined" [disabled]="enviando()">
          Cancelar
        </button>
        <button mat-flat-button type="submit" [disabled]="enviando()">Cambiar</button>
      </mat-dialog-actions>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HabitacionDialogoComponent {
  private readonly servicio = inject(PacienteService);
  private readonly dialogo =
    inject<MatDialogRef<HabitacionDialogoComponent, Paciente>>(MatDialogRef);

  protected readonly paciente = inject<DatosHabitacionDialogo>(MAT_DIALOG_DATA).paciente;
  protected readonly formulario = inject(NonNullableFormBuilder).group({
    habitacion: [
      this.paciente.habitacion as number | null,
      [obligatorio('El número de habitación es obligatorio.'), habitacion],
    ],
  });
  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  protected readonly primerError = primerError;

  protected guardar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    this.enviando.set(true);
    this.errores.set([]);
    this.servicio
      .cambiarHabitacion(this.paciente.idPaciente, this.formulario.getRawValue().habitacion!)
      .subscribe({
        next: (actualizado) => this.dialogo.close(actualizado),
        error: (error: unknown) => {
          this.errores.set(mensajesDeError(error));
          this.enviando.set(false);
        },
      });
  }
}
