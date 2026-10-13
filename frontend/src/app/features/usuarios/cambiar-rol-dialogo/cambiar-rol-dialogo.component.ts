import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
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
import { ROLES_USUARIO } from '../usuario.models';
import { UsuarioService } from '../usuario.service';

export interface DatosCambiarRolDialogo {
  usuario: Usuario;
}

/**
 * Como el backend (y como el alta): un doctor o enfermero debe estar vinculado a
 * un trabajador. (Mismo validador que `usuario-dialogo`.)
 */
function trabajadorDelRol(rol: () => Rol | null): ValidatorFn {
  return (control) =>
    control.value
      ? null
      : { obligatorio: `El usuario con rol ${rol()} debe estar vinculado a un trabajador.` };
}

/**
 * Cambia el rol de un usuario y el trabajador al que queda vinculado (solo
 * ADMIN), con las mismas reglas que el alta. El rol y el trabajador actuales
 * llegan precargados y, al elegir doctor o enfermero, se ofrecen los
 * trabajadores libres de ese tipo **más el que ya tiene este usuario** (esté o no
 * ocupado: está ocupado por él), porque conservarlo es válido. Los 400, 404 y
 * 409 del servidor se muestran dentro del diálogo, sin cerrarlo.
 */
@Component({
  selector: 'app-cambiar-rol-dialogo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatRadioModule,
    MatSelectModule,
    MatButtonModule,
    ErroresFormularioComponent,
  ],
  templateUrl: './cambiar-rol-dialogo.component.html',
  styleUrl: './cambiar-rol-dialogo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CambiarRolDialogoComponent {
  private readonly usuarios = inject(UsuarioService);
  private readonly trabajadoresServicio = inject(TrabajadorService);
  private readonly dialogo =
    inject<MatDialogRef<CambiarRolDialogoComponent, Usuario>>(MatDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(NonNullableFormBuilder);

  /** Usuario al que se le cambia el rol (el de la fila). */
  protected readonly usuario = inject<DatosCambiarRolDialogo>(MAT_DIALOG_DATA).usuario;

  // Controles sueltos antes del grupo: el validador del trabajador lee el rol.
  private readonly rolControl = this.fb.control<Rol | null>(
    this.usuario.rol,
    obligatorio('Debe seleccionar un rol (ADMIN, DOCTOR o ENFERMERO).'),
  );
  protected readonly formulario = this.fb.group({
    rol: this.rolControl,
    idTrabajador: [this.usuario.idTrabajador ?? '', trabajadorDelRol(() => this.rolControl.value)],
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
  /** Trabajadores del tipo del rol elegido, incluido el que ya es suyo. */
  protected readonly disponibles = computed(() => {
    const rol = this.rol();
    if (rol === null) {
      return [];
    }
    return this.trabajadores().filter(
      (t) =>
        rolDeUsuario(t.rol) === rol &&
        (t.idTrabajador === this.usuario.idTrabajador || !this.vinculados().has(t.idTrabajador)),
    );
  });

  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  protected readonly roles = ROLES_USUARIO;
  protected readonly etiquetaRol = etiquetaRol;
  protected readonly primerError = primerError;

  constructor() {
    const { rol, idTrabajador } = this.formulario.controls;
    // Solo al cambiar de rol se vacía el trabajador (el del rol anterior no vale
    // para el nuevo); el que ya tenía se mantiene precargado.
    rol.valueChanges.pipe(takeUntilDestroyed()).subscribe((valor) => this.ajustarTrabajador(valor));
    if (rol.value === 'ADMIN') {
      // El administrador no lleva trabajador: el select ni se muestra.
      idTrabajador.disable({ emitEvent: false });
    }
    this.cargarTrabajadores();
  }

  protected cargarTrabajadores(): void {
    this.cargandoTrabajadores.set(true);
    this.erroresCarga.set([]);
    forkJoin({
      trabajadores: this.trabajadoresServicio.listar(),
      usuarios: this.usuarios.listar(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
      .cambiarRol(this.usuario.idUsuario, {
        rol,
        idTrabajador: rol === 'ADMIN' ? null : v.idTrabajador,
      })
      .subscribe({
        next: (actualizado) => this.dialogo.close(actualizado),
        error: (error: unknown) => {
          this.errores.set(mensajesDeError(error));
          this.enviando.set(false);
        },
      });
  }

  /** El trabajador solo cuenta para doctores y enfermeros; al cambiar de rol se vacía. */
  private ajustarTrabajador(rol: Rol | null): void {
    const { idTrabajador } = this.formulario.controls;
    idTrabajador.setValue('', { emitEvent: false });
    if (rol === 'DOCTOR' || rol === 'ENFERMERO') {
      idTrabajador.enable({ emitEvent: false });
    } else {
      idTrabajador.disable({ emitEvent: false });
    }
  }
}
