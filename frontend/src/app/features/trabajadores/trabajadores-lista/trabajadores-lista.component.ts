import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, switchMap } from 'rxjs';
import { mensajesDeError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { PermisosService } from '../../../core/permisos';
import { etiquetaRol } from '../../../core/roles';
import { confirmar } from '../../../shared/confirmacion-dialogo/confirmacion-dialogo.component';
import { crearListaRemota, textoBuscado } from '../../../shared/listas';
import {
  DatosTrabajadorDialogo,
  TrabajadorDialogoComponent,
} from '../trabajador-dialogo/trabajador-dialogo.component';
import { ETIQUETAS_NIVEL, Trabajador } from '../trabajador.models';
import { TrabajadorService } from '../trabajador.service';

/** Lista de trabajadores; mismo patrón que la de pacientes (ver README). */
@Component({
  selector: 'app-trabajadores-lista',
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
  templateUrl: './trabajadores-lista.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrabajadoresListaComponent {
  private readonly servicio = inject(TrabajadorService);
  private readonly dialogo = inject(MatDialog);
  private readonly notificaciones = inject(NotificacionService);
  /** Qué acciones mostrar según el rol (el backend sigue siendo quien decide). */
  protected readonly permisos = inject(PermisosService);

  protected readonly columnas = computed(() => [
    'idTrabajador',
    'nombreCompleto',
    'rol',
    'detalle',
    ...(this.permisos.puede('trabajadores.escribir') ? ['acciones'] : []),
  ]);

  protected readonly busqueda = new FormControl('', { nonNullable: true });
  private readonly lista = crearListaRemota({
    inicial: '',
    cambios: textoBuscado(this.busqueda),
    cargar: (texto: string) => this.servicio.listar(texto),
  });
  protected readonly trabajadores = this.lista.elementos;
  protected readonly cargando = this.lista.cargando;
  protected readonly errores = this.lista.errores;
  /** Filtro de la última carga, para el mensaje de lista vacía. */
  protected readonly filtro = this.lista.consulta;
  protected readonly etiquetaRol = etiquetaRol;

  /** Especialidad del doctor o nivel del enfermero. */
  protected detalle(trabajador: Trabajador): string {
    return trabajador.nivelExperiencia
      ? `Nivel ${ETIQUETAS_NIVEL[trabajador.nivelExperiencia].toLowerCase()}`
      : (trabajador.especialidad ?? '');
  }

  protected recargar(): void {
    this.lista.recargar();
  }

  protected nuevo(): void {
    this.abrirDialogo({}, (t) => `Trabajador ${t.idTrabajador} registrado.`);
  }

  protected editar(trabajador: Trabajador): void {
    this.abrirDialogo({ trabajador }, (t) => `Trabajador ${t.idTrabajador} actualizado.`);
  }

  protected eliminar(trabajador: Trabajador): void {
    confirmar(this.dialogo, {
      titulo: 'Eliminar trabajador',
      mensaje:
        `Se eliminará a ${trabajador.nombreCompleto} (${trabajador.idTrabajador}). Si tiene un ` +
        'usuario de acceso, también quedará desactivado y no podrá volver a iniciar sesión. ' +
        'Esta acción no se puede deshacer.',
      accion: 'Eliminar',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.servicio.eliminar(trabajador.idTrabajador)),
      )
      .subscribe({
        next: () => {
          this.notificaciones.exito(`Trabajador ${trabajador.idTrabajador} eliminado.`);
          this.recargar();
        },
        error: (error: unknown) => {
          this.notificaciones.error(mensajesDeError(error));
          this.recargar();
        },
      });
  }

  /** Abre el diálogo, que guarda por su cuenta; si se cierra con un trabajador, avisa y recarga. */
  private abrirDialogo(
    datos: DatosTrabajadorDialogo,
    mensajeExito: (guardado: Trabajador) => string,
  ): void {
    this.dialogo
      .open<TrabajadorDialogoComponent, DatosTrabajadorDialogo, Trabajador>(
        TrabajadorDialogoComponent,
        { data: datos, width: '480px', maxWidth: '95vw' },
      )
      .afterClosed()
      // Solo un trabajador cuenta: cerrar sin guardar no avisa nada.
      .pipe(
        filter(
          (guardado): guardado is Trabajador => typeof guardado === 'object' && guardado !== null,
        ),
      )
      .subscribe((guardado) => {
        this.notificaciones.exito(mensajeExito(guardado));
        this.recargar();
      });
  }
}
