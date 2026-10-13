import { ComponentType } from '@angular/cdk/portal';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  Observable,
  Subject,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  merge,
  switchMap,
} from 'rxjs';
import { mensajesDeError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { PermisosService } from '../../../core/permisos';
import { confirmar } from '../../../shared/confirmacion-dialogo/confirmacion-dialogo.component';
import { formatearFecha } from '../../../shared/fechas';
import { SIN_CONFIRMAR } from '../../../shared/idempotencia';
import { ESPERA_BUSQUEDA_MS, crearListaRemota, textoBuscado } from '../../../shared/listas';
import { enteroEntre, obligatorio, primerError } from '../../../shared/validadores';
import { MedicamentoDialogoComponent } from '../medicamento-dialogo/medicamento-dialogo.component';
import { ETIQUETAS_PRESENTACION, Medicamento, TipoMovimiento } from '../medicamento.models';
import { MedicamentoService } from '../medicamento.service';
import {
  DatosMovimientoDialogo,
  MovimientoDialogoComponent,
  ResultadoMovimientoDialogo,
} from '../movimiento-dialogo/movimiento-dialogo.component';

type Vista = 'todos' | 'stock-bajo' | 'por-vencer' | 'vencidos';

/** Lo que se pide al servidor según la pestaña. */
type Consulta =
  | { vista: 'todos'; texto: string }
  | { vista: 'stock-bajo' }
  | { vista: 'por-vencer'; dias: number }
  | { vista: 'vencidos' };

export const DIAS_POR_VENCER_INICIAL = 30;

/**
 * Inventario de medicamentos con cuatro pestañas (todos, stock bajo, por
 * vencer y vencidos) sobre una sola lista remota. Si MedicamentosService no
 * responde, el error se muestra como aviso dentro del módulo sin bloquearlo.
 */
@Component({
  selector: 'app-medicamentos-lista',
  imports: [
    ReactiveFormsModule,
    MatTabsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './medicamentos-lista.component.html',
  styleUrl: './medicamentos-lista.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MedicamentosListaComponent {
  private readonly servicio = inject(MedicamentoService);
  private readonly dialogo = inject(MatDialog);
  private readonly notificaciones = inject(NotificacionService);
  /** Qué acciones mostrar según el rol (el backend sigue siendo quien decide). */
  protected readonly permisos = inject(PermisosService);

  protected readonly columnas = computed(() => [
    'idMedicamento',
    'medicamento',
    'lote',
    'stock',
    'vencimiento',
    'estado',
    ...(this.permisos.puede('medicamentos.escribir') || this.permisos.puede('medicamentos.salidas')
      ? ['acciones']
      : []),
  ]);
  private readonly cambiosDeVista = new Subject<void>();

  protected readonly pestanas: readonly { vista: Vista; etiqueta: string }[] = [
    { vista: 'todos', etiqueta: 'Todos' },
    { vista: 'stock-bajo', etiqueta: 'Stock bajo' },
    { vista: 'por-vencer', etiqueta: 'Por vencer' },
    { vista: 'vencidos', etiqueta: 'Vencidos' },
  ];
  protected readonly vista = signal<Vista>('todos');
  protected readonly busqueda = new FormControl('', { nonNullable: true });
  protected readonly dias = new FormControl<number | null>(DIAS_POR_VENCER_INICIAL, [
    obligatorio('Indique el número de días.'),
    enteroEntre(1, 365, 'Los días deben ser un entero entre 1 y 365.'),
  ]);

  private readonly lista = crearListaRemota<Medicamento, Consulta>({
    inicial: { vista: 'todos', texto: '' },
    cambios: merge(
      this.cambiosDeVista,
      textoBuscado(this.busqueda).pipe(filter(() => this.vista() === 'todos')),
      this.dias.valueChanges.pipe(
        debounceTime(ESPERA_BUSQUEDA_MS),
        filter(() => this.dias.valid && this.vista() === 'por-vencer'),
        distinctUntilChanged(),
      ),
    ).pipe(map(() => this.consultaActual())),
    cargar: (consulta) => this.cargar(consulta),
  });
  protected readonly cargando = this.lista.cargando;
  protected readonly errores = this.lista.errores;
  /** Solo los resultados de la pestaña activa: al cambiar no se ven los de la anterior. */
  protected readonly medicamentos = computed(() =>
    this.lista.consulta().vista === this.vista() ? this.lista.elementos() : [],
  );
  protected readonly mensajeVacio = computed(() => {
    const consulta = this.lista.consulta();
    if (consulta.vista !== this.vista() || this.cargando() || this.errores().length > 0) {
      return null;
    }
    if (this.medicamentos().length > 0) {
      return null;
    }
    switch (consulta.vista) {
      case 'todos':
        return consulta.texto
          ? `Ningún medicamento coincide con «${consulta.texto}».`
          : 'Todavía no hay medicamentos registrados.';
      case 'stock-bajo':
        return 'Ningún medicamento tiene el stock en su mínimo o por debajo.';
      case 'por-vencer':
        return `Ningún medicamento vence en los próximos ${consulta.dias} días.`;
      case 'vencidos':
        return 'No hay medicamentos vencidos.';
    }
  });

  protected readonly formatearFecha = formatearFecha;
  protected readonly primerError = primerError;

  protected cambiarVista(vista: Vista): void {
    if (vista === this.vista()) {
      return;
    }
    if (vista === 'por-vencer' && this.dias.invalid) {
      this.dias.setValue(DIAS_POR_VENCER_INICIAL, { emitEvent: false });
    }
    this.vista.set(vista);
    this.cambiosDeVista.next();
  }

  protected recargar(): void {
    this.lista.recargar();
  }

  protected descripcion(m: Medicamento): string {
    return `${m.nombre} ${m.concentracion}`;
  }

  protected etiquetaPresentacion(m: Medicamento): string {
    return ETIQUETAS_PRESENTACION[m.presentacion];
  }

  protected nuevo(): void {
    this.abrirDialogo(
      MedicamentoDialogoComponent,
      {},
      '640px',
      (m) => `Medicamento ${m.idMedicamento} registrado.`,
    );
  }

  protected editar(medicamento: Medicamento): void {
    this.abrirDialogo(
      MedicamentoDialogoComponent,
      { medicamento },
      '640px',
      (m) => `Medicamento ${m.idMedicamento} actualizado.`,
    );
  }

  protected moverStock(medicamento: Medicamento, tipo: TipoMovimiento): void {
    this.dialogo
      .open<MovimientoDialogoComponent, DatosMovimientoDialogo, ResultadoMovimientoDialogo>(
        MovimientoDialogoComponent,
        { data: { medicamento, tipo }, width: '440px', maxWidth: '95vw' },
      )
      .afterClosed()
      // Solo un medicamento o SIN_CONFIRMAR cuentan: cerrar sin guardar no avisa nada.
      .pipe(
        filter(
          (resultado): resultado is ResultadoMovimientoDialogo =>
            resultado === SIN_CONFIRMAR || (typeof resultado === 'object' && resultado !== null),
        ),
      )
      .subscribe((resultado) => {
        // Sin confirmar, el diálogo ya avisó; se recarga para ver el stock real.
        if (resultado !== SIN_CONFIRMAR) {
          this.notificaciones.exito(
            `${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada: ${this.descripcion(resultado)} ` +
              `queda con ${resultado.cantidadStock} unidades.`,
          );
        }
        this.recargar();
      });
  }

  protected eliminar(medicamento: Medicamento): void {
    confirmar(this.dialogo, {
      titulo: 'Eliminar medicamento',
      mensaje:
        `Se eliminará ${this.descripcion(medicamento)} (${medicamento.idMedicamento}, ` +
        `lote ${medicamento.lote}) del inventario. Esta acción no se puede deshacer.`,
      accion: 'Eliminar',
    })
      .pipe(
        filter(Boolean),
        switchMap(() => this.servicio.eliminar(medicamento.idMedicamento)),
      )
      .subscribe({
        next: () => {
          this.notificaciones.exito(`Medicamento ${medicamento.idMedicamento} eliminado.`);
          this.recargar();
        },
        error: (error: unknown) => {
          this.notificaciones.error(mensajesDeError(error));
          this.recargar();
        },
      });
  }

  private consultaActual(): Consulta {
    const vista = this.vista();
    switch (vista) {
      case 'todos':
        return { vista, texto: this.busqueda.value.trim() };
      case 'por-vencer':
        return { vista, dias: this.dias.value ?? DIAS_POR_VENCER_INICIAL };
      default:
        return { vista };
    }
  }

  private cargar(consulta: Consulta): Observable<Medicamento[]> {
    switch (consulta.vista) {
      case 'todos':
        return this.servicio.listar(consulta.texto);
      case 'stock-bajo':
        return this.servicio.listarStockBajo();
      case 'por-vencer':
        return this.servicio.listarPorVencer(consulta.dias);
      case 'vencidos':
        return this.servicio.listarVencidos();
    }
  }

  /** Abre un diálogo que guarda por su cuenta; si se cierra con un medicamento, avisa y recarga. */
  private abrirDialogo<C, D>(
    componente: ComponentType<C>,
    datos: D,
    ancho: string,
    mensajeExito: (guardado: Medicamento) => string,
  ): void {
    this.dialogo
      .open<C, D, Medicamento>(componente, { data: datos, width: ancho, maxWidth: '95vw' })
      .afterClosed()
      // Solo un medicamento cuenta: cerrar sin guardar no avisa nada.
      .pipe(
        filter(
          (guardado): guardado is Medicamento => typeof guardado === 'object' && guardado !== null,
        ),
      )
      .subscribe((guardado) => {
        this.notificaciones.exito(mensajeExito(guardado));
        this.recargar();
      });
  }
}
