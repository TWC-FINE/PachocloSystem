import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { forkJoin, startWith } from 'rxjs';
import { Usuario } from '../../../core/auth/auth.models';
import { mensajesDeError } from '../../../core/http/api-error';
import { Rol, etiquetaRol, rolDeUsuario } from '../../../core/roles';
import { ErroresFormularioComponent } from '../../../shared/errores-formulario/errores-formulario.component';
import { obligatorio, primerError } from '../../../shared/validadores';
import { Trabajador } from '../../trabajadores/trabajador.models';
import { TrabajadorService } from '../../trabajadores/trabajador.service';
import { normalizarUsername, passwordValida, repiteA, usernameValido } from '../politica';
import { ROLES_USUARIO } from '../usuario.models';
import { UsuarioService } from '../usuario.service';

/** Como el backend: un doctor o enfermero debe estar vinculado a un trabajador. */
function trabajadorDelRol(rol: () => Rol | null): ValidatorFn {
  return (control) =>
    control.value
      ? null
      : { obligatorio: `El usuario con rol ${rol()} debe estar vinculado a un trabajador.` };
}

/**
 * Alta de un usuario (solo ADMIN). Un doctor o enfermero se vincula a un
 * trabajador de su tipo que aún no tenga usuario (ni siquiera desactivado: el
 * vínculo no se libera). Los 400, 404 y 409 se muestran dentro del formulario.
 */
@Component({
  selector: 'app-usuario-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  templateUrl: './usuario-dialogo.component.html',
  styleUrl: './usuario-dialogo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuarioDialogoComponent {
  private readonly usuarios = inject(UsuarioService);
  private readonly dialogo = inject<MatDialogRef<UsuarioDialogoComponent, Usuario>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  // Controles sueltos antes del grupo: unos validadores leen a otros.
  private readonly rolControl = this.fb.control<Rol | null>(
    null,
    obligatorio('Debe seleccionar un rol (ADMIN, DOCTOR o ENFERMERO).'),
  );
  private readonly usernameControl = this.fb.control('', usernameValido);
  private readonly passwordControl = this.fb.control(
    '',
    passwordValida(() => this.usernameControl.value),
  );
  protected readonly formulario = this.fb.group({
    username: this.usernameControl,
    password: this.passwordControl,
    repeticion: ['', repiteA(() => this.passwordControl.value)],
    rol: this.rolControl,
    idTrabajador: ['', trabajadorDelRol(() => this.rolControl.value)],
  });
  protected readonly rol = toSignal(
    this.formulario.controls.rol.valueChanges.pipe(startWith(this.formulario.controls.rol.value)),
    { requireSync: true },
  );

  /** Trabajadores y usuarios existentes, para ofrecer solo trabajadores libres. */
  private readonly trabajadores = signal<readonly Trabajador[]>([]);
  private readonly vinculados = signal<ReadonlySet<string>>(new Set());
  protected readonly erroresCarga = signal<readonly string[]>([]);
  protected readonly cargandoTrabajadores = signal(true);
  /** Trabajadores del tipo del rol elegido que aún no tienen usuario. */
  protected readonly disponibles = computed(() => {
    const rol = this.rol();
    return this.trabajadores().filter(
      (t) => rol !== null && rolDeUsuario(t.rol) === rol && !this.vinculados().has(t.idTrabajador),
    );
  });

  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  protected readonly roles = ROLES_USUARIO;
  protected readonly etiquetaRol = etiquetaRol;
  protected readonly primerError = primerError;

  constructor() {
    const { username, password, repeticion, rol } = this.formulario.controls;
    // La contraseña depende del username y la repetición de la contraseña.
    username.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => password.updateValueAndValidity({ emitEvent: false }));
    password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => repeticion.updateValueAndValidity({ emitEvent: false }));
    rol.valueChanges
      .pipe(startWith(rol.value), takeUntilDestroyed())
      .subscribe((valor) => this.habilitarTrabajador(valor));

    forkJoin({
      trabajadores: inject(TrabajadorService).listar(),
      usuarios: this.usuarios.listar(),
    }).subscribe({
      next: ({ trabajadores, usuarios }) => {
        this.trabajadores.set(trabajadores);
        this.vinculados.set(
          new Set(usuarios.map((u) => u.idTrabajador).filter((id): id is string => id !== null)),
        );
        this.cargandoTrabajadores.set(false);
      },
      error: (error: unknown) => {
        this.erroresCarga.set(mensajesDeError(error));
        this.cargandoTrabajadores.set(false);
      },
    });
  }

  protected guardar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const v = this.formulario.getRawValue();
    const rol = v.rol!;
    this.enviando.set(true);
    this.errores.set([]);
    this.usuarios
      .crear({
        username: normalizarUsername(v.username)!,
        password: v.password,
        rol,
        idTrabajador: rol === 'ADMIN' ? null : v.idTrabajador,
      })
      .subscribe({
        next: (creado) => this.dialogo.close(creado),
        error: (error: unknown) => {
          this.errores.set(mensajesDeError(error));
          this.enviando.set(false);
        },
      });
  }

  /** El trabajador solo cuenta para doctores y enfermeros; al cambiar de rol se vacía. */
  private habilitarTrabajador(rol: Rol | null): void {
    const { idTrabajador } = this.formulario.controls;
    idTrabajador.setValue('', { emitEvent: false });
    if (rol === 'DOCTOR' || rol === 'ENFERMERO') {
      idTrabajador.enable({ emitEvent: false });
    } else {
      idTrabajador.disable({ emitEvent: false });
    }
  }
}
