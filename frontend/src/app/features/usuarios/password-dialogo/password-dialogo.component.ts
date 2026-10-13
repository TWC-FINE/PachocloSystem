import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Usuario } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { mensajesDeError } from '../../../core/http/api-error';
import { ErroresFormularioComponent } from '../../../shared/errores-formulario/errores-formulario.component';
import { primerError } from '../../../shared/validadores';
import { passwordValida, repiteA } from '../politica';
import { UsuarioService } from '../usuario.service';

export interface DatosPasswordDialogo {
  usuario: Usuario;
}

/**
 * Restablece la contraseña de un usuario (solo ADMIN), con la política del
 * backend. El backend invalida los tokens anteriores de ese usuario y le obliga
 * a cambiarla al entrar: si es el propio admin, se cierra su sesión explicando
 * por qué.
 */
@Component({
  selector: 'app-password-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  template: `
    <h2 mat-dialog-title>Restablecer contraseña</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content>
        <app-errores-formulario [mensajes]="errores()" />
        <p>Nueva contraseña para {{ usuario.username }} ({{ usuario.idUsuario }}).</p>
        @if (propio) {
          <p class="aviso" role="note">
            Es su propia contraseña: al guardarla, su sesión actual dejará de valer y tendrá que
            iniciar sesión con la nueva y cambiarla.
          </p>
        } @else {
          <p class="nota">
            Las sesiones abiertas de este usuario dejarán de valer y tendrá que cambiar esta
            contraseña al iniciar sesión.
          </p>
        }
        <mat-form-field class="campo-completo">
          <mat-label>Nueva contraseña</mat-label>
          <input
            matInput
            type="password"
            formControlName="password"
            autocomplete="new-password"
            required
            cdkFocusInitial
          />
          <mat-hint>Al menos 10 caracteres y distinta del usuario.</mat-hint>
          <mat-error>{{ primerError(formulario.controls.password) }}</mat-error>
        </mat-form-field>
        <mat-form-field class="campo-completo">
          <mat-label>Repita la contraseña</mat-label>
          <input
            matInput
            type="password"
            formControlName="repeticion"
            autocomplete="new-password"
            required
          />
          <mat-error>{{ primerError(formulario.controls.repeticion) }}</mat-error>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [mat-dialog-close]="undefined" [disabled]="enviando()">
          Cancelar
        </button>
        <button mat-flat-button type="submit" [disabled]="enviando()">Restablecer</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .aviso {
      padding: 8px 16px;
      border-radius: 8px;
      background-color: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }

    .nota {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordDialogoComponent {
  private readonly usuarios = inject(UsuarioService);
  private readonly auth = inject(AuthService);
  private readonly dialogo = inject<MatDialogRef<PasswordDialogoComponent, boolean>>(MatDialogRef);

  protected readonly usuario = inject<DatosPasswordDialogo>(MAT_DIALOG_DATA).usuario;
  /** ¿Restablece el admin su propia contraseña? */
  protected readonly propio = this.usuario.idUsuario === this.auth.usuario()?.idUsuario;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly passwordControl = this.fb.control(
    '',
    passwordValida(() => this.usuario.username),
  );
  protected readonly formulario = this.fb.group({
    password: this.passwordControl,
    repeticion: ['', repiteA(() => this.passwordControl.value)],
  });
  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  protected readonly primerError = primerError;

  constructor() {
    const { password, repeticion } = this.formulario.controls;
    password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => repeticion.updateValueAndValidity({ emitEvent: false }));
  }

  protected guardar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    this.enviando.set(true);
    this.errores.set([]);
    this.usuarios
      .restablecerPassword(this.usuario.idUsuario, this.formulario.getRawValue().password)
      .subscribe({
        next: () => {
          this.dialogo.close(true);
          if (this.propio) {
            // Su token ya no vale: sin esto, la próxima petición daría un 401
            // con el aviso genérico de sesión expirada.
            this.auth.cerrarSesion({ motivo: 'password-cambiada' });
          }
        },
        error: (error: unknown) => {
          this.errores.set(mensajesDeError(error));
          this.enviando.set(false);
        },
      });
  }
}
