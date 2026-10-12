import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { map, merge } from 'rxjs';
import { crearListaRemota, textoBuscado } from '../../../shared/listas';
import { FiltroHistorial } from '../historial.models';
import { HistorialService } from '../historial.service';
import { RegistrosComponent } from '../registros/registros.component';

interface Consulta {
  filtro: FiltroHistorial;
  texto: string;
}

/** Historial de todos los pacientes, solo consulta (los registros se crean desde cada paciente). */
@Component({
  selector: 'app-historial-general',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatSelectModule,
    RegistrosComponent,
  ],
  templateUrl: './historial-general.component.html',
  styleUrl: './historial-general.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistorialGeneralComponent {
  private readonly servicio = inject(HistorialService);

  protected readonly filtros: readonly { valor: FiltroHistorial; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Paciente o autor' },
    { valor: 'paciente', etiqueta: 'Paciente' },
    { valor: 'autor', etiqueta: 'Autor' },
  ];
  protected readonly filtro = new FormControl<FiltroHistorial>('todos', { nonNullable: true });
  protected readonly busqueda = new FormControl('', { nonNullable: true });

  private readonly lista = crearListaRemota({
    inicial: { filtro: 'todos', texto: '' } as Consulta,
    cambios: merge(this.filtro.valueChanges, textoBuscado(this.busqueda)).pipe(
      map((): Consulta => ({ filtro: this.filtro.value, texto: this.busqueda.value.trim() })),
    ),
    cargar: ({ filtro, texto }: Consulta) => this.servicio.listar(filtro, texto),
  });
  protected readonly registros = this.lista.elementos;
  protected readonly cargando = this.lista.cargando;
  protected readonly errores = this.lista.errores;
  protected readonly mensajeVacio = computed(() => {
    const texto = this.lista.consulta().texto;
    return texto
      ? `Ningún registro coincide con «${texto}».`
      : 'Todavía no hay registros en el historial.';
  });

  protected recargar(): void {
    this.lista.recargar();
  }
}
