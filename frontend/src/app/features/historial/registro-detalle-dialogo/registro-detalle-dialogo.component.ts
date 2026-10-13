import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { etiquetaRol } from '../../../core/roles';
import { formatearFechaHora } from '../../../shared/fechas';
import { ETIQUETAS_TIPO, Registro } from '../historial.models';

/** Detalle de solo lectura de un registro del historial clínico. */
@Component({
  selector: 'app-registro-detalle-dialogo',
  imports: [MatDialogModule, MatButtonModule],
  templateUrl: './registro-detalle-dialogo.component.html',
  styleUrl: './registro-detalle-dialogo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistroDetalleDialogoComponent {
  protected readonly registro = inject<Registro>(MAT_DIALOG_DATA);

  protected readonly etiquetasTipo = ETIQUETAS_TIPO;
  protected readonly etiquetaRol = etiquetaRol;
  protected readonly formatearFechaHora = formatearFechaHora;
}
