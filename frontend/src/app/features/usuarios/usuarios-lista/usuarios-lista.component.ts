import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { Usuario } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificacionService } from '../../../core/notificacion.service';
import { etiquetaRol } from '../../../core/roles';
import { confirmar } from '../../../shared/confirmacion-dialogo/confirmacion-dialogo.component';
import { crearListaRemota, textoBuscado } from '../../../shared/listas';
import {
  CambiarRolDialogoComponent,
  DatosCambiarRolDialogo,
} from '../cambiar-rol-dialogo/cambiar-rol-dialogo.component';
import {
  DatosPasswordDialogo,
  PasswordDialogoComponent,
} from '../password-dialogo/password-dialogo.component';
import { UsuarioDialogoComponent } from '../usuario-dialogo/usuario-dialogo.component';
import { UsuarioService } from '../usuario.service';

/**
 * Gestión de usuarios (solo ADMIN; la ruta tiene permisoGuard). Activar y
 * desactivar se confirman en un diálogo que ejecuta la operación y muestra sus
 * 409 (autodesactivación, último admin, trabajador eliminado) sin cerrarse. El
 * cambio de rol se hace en su propio diálogo; sobre uno mismo el botón está
 * deshabilitado (el backend responde 409).
 */
@Component({
  selector: 'app-usuarios-lista',
  imports: [
    ReactiveFormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './usuarios-lista.component.html',
  styleUrl: './usuarios-lista.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuariosListaComponent {
  private readonly servicio = inject(UsuarioService);
  private readonly dialogo = inject(MatDialog);
  private readonly notificaciones = inject(NotificacionService);
  private readonly auth = inject(AuthService);

  /** El usuario de la sesión: su propia fila no ofrece cambiar el rol. */
  private readonly usuarioActual = this.auth.usuario;

  protected readonly columnas = ['username', 'rol', 'trabajador', 'estado', 'acciones'];
  protected readonly busqueda = new FormControl('', { nonNullable: true });
  private readonly lista = crearListaRemota({
    inicial: '',
    cambios: textoBuscado(this.busqueda),
    cargar: (texto: string) => this.servicio.listar(texto),
  });
  protected readonly usuarios = this.lista.elementos;
  protected readonly cargando = this.lista.cargando;
  protected readonly errores = this.lista.errores;
  protected readonly filtro = this.lista.consulta;
  protected readonly etiquetaRol = etiquetaRol;

  protected recargar(): void {
    this.lista.recargar();
  }

  protected nuevo(): void {
    this.dialogo
      .open<UsuarioDialogoComponent, void, Usuario>(UsuarioDialogoComponent, {
        width: '560px',
        maxWidth: '95vw',
      })
      .afterClosed()
      // Solo un usuario cuenta: cerrar sin guardar no avisa nada.
      .pipe(filter((creado): creado is Usuario => typeof creado === 'object' && creado !== null))
      .subscribe((creado) => {
        this.notificaciones.exito(`Usuario ${creado.username} creado.`);
        this.recargar();
      });
  }

  protected esPropio(usuario: Usuario): boolean {
    return usuario.idUsuario === this.usuarioActual()?.idUsuario;
  }

  protected cambiarRol(usuario: Usuario): void {
    if (this.esPropio(usuario)) {
      // El botón está deshabilitado, pero `disabledInteractive` (lo que hace
      // visible el tooltip) deja pasar el clic: aquí se descarta.
      return;
    }
    this.dialogo
      .open<CambiarRolDialogoComponent, DatosCambiarRolDialogo, Usuario>(
        CambiarRolDialogoComponent,
        {
          data: { usuario },
          width: '560px',
          maxWidth: '95vw',
        },
      )
      .afterClosed()
      // Solo un usuario cuenta: cerrar sin guardar no avisa nada.
      .pipe(
        filter(
          (actualizado): actualizado is Usuario =>
            typeof actualizado === 'object' && actualizado !== null,
        ),
      )
      .subscribe((actualizado) => {
        this.notificaciones.exito(`Rol de ${actualizado.username} actualizado.`);
        this.recargar();
      });
  }

  protected desactivar(usuario: Usuario): void {
    this.cambiarEstado(
      usuario,
      'Desactivar usuario',
      `${usuario.username} no podrá iniciar sesión y sus sesiones abiertas dejarán de valer. ` +
        'Podrá reactivarlo después.',
      'Desactivar',
      true,
    );
  }

  protected activar(usuario: Usuario): void {
    this.cambiarEstado(
      usuario,
      'Activar usuario',
      `${usuario.username} podrá volver a iniciar sesión.`,
      'Activar',
      false,
    );
  }

  protected restablecerPassword(usuario: Usuario): void {
    this.dialogo
      .open<PasswordDialogoComponent, DatosPasswordDialogo, boolean>(PasswordDialogoComponent, {
        data: { usuario },
        width: '480px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .pipe(filter(Boolean))
      .subscribe(() =>
        this.notificaciones.exito(`Contraseña de ${usuario.username} restablecida.`),
      );
  }

  private cambiarEstado(
    usuario: Usuario,
    titulo: string,
    mensaje: string,
    accion: string,
    desactivar: boolean,
  ): void {
    confirmar(this.dialogo, {
      titulo,
      mensaje,
      accion,
      peligro: desactivar,
      ejecutar: () =>
        desactivar
          ? this.servicio.desactivar(usuario.idUsuario)
          : this.servicio.activar(usuario.idUsuario),
    })
      .pipe(filter(Boolean))
      .subscribe(() => {
        this.notificaciones.exito(
          `Usuario ${usuario.username} ${desactivar ? 'desactivado' : 'activado'}.`,
        );
        this.recargar();
      });
  }
}
