import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { etiquetaRol } from '../../../core/roles';
import { formatearFechaHora } from '../../../shared/fechas';
import { ETIQUETAS_TIPO, Registro } from '../historial.models';
import { RegistroDetalleDialogoComponent } from '../registro-detalle-dialogo/registro-detalle-dialogo.component';

/** Lista de registros del historial (solo presentación). */
@Component({
  selector: 'app-registros',
  imports: [RouterLink],
  templateUrl: './registros.component.html',
  styleUrl: './registros.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistrosComponent {
  private readonly dialogo = inject(MatDialog);

  readonly registros = input.required<readonly Registro[]>();
  /** En el historial general cada registro muestra su paciente, con enlace a su historial. */
  readonly mostrarPaciente = input(false);

  protected readonly etiquetasTipo = ETIQUETAS_TIPO;
  protected readonly etiquetaRol = etiquetaRol;
  protected readonly formatearFechaHora = formatearFechaHora;

  /** Abre el detalle; al cerrarlo, el foco vuelve al botón que lo abrió. */
  protected abrir(registro: Registro, evento: Event): void {
    const disparador =
      evento.currentTarget instanceof HTMLElement ? evento.currentTarget : undefined;
    this.dialogo.open<RegistroDetalleDialogoComponent, Registro>(RegistroDetalleDialogoComponent, {
      data: registro,
      width: '560px',
      restoreFocus: disparador,
    });
  }
}
