import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, filter, map, merge, of, skip, startWith, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { mensajesDeError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { crearListaRemota, textoBuscado } from '../../../shared/listas';
import { Paciente } from '../../pacientes/paciente.models';
import { PacienteService } from '../../pacientes/paciente.service';
import { HistorialService } from '../historial.service';
import {
  AutorNuevoRegistro,
  DatosRegistroDialogo,
  RegistroDialogoComponent,
  ResultadoRegistroDialogo,
  SIN_CONFIRMAR,
} from '../registro-dialogo/registro-dialogo.component';
import { RegistrosComponent } from '../registros/registros.component';

interface CargaPaciente {
  paciente: Paciente | null;
  errores: readonly string[];
}

interface Consulta {
  idPaciente: string;
  texto: string;
}

/**
 * Historial de un paciente (`/pacientes/:id/historial`). Crear registros exige
 * que el usuario esté vinculado a un trabajador, que será el autor (regla
 * provisional hasta que el backend tome el autor del token, B3); si no lo
 * está (el administrador), la pantalla queda en modo consulta.
 */
@Component({
  selector: 'app-historial-paciente',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    RegistrosComponent,
  ],
  templateUrl: './historial-paciente.component.html',
  styleUrl: './historial-paciente.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistorialPacienteComponent {
  private readonly historial = inject(HistorialService);
  private readonly pacientes = inject(PacienteService);
  private readonly dialogo = inject(MatDialog);
  private readonly notificaciones = inject(NotificacionService);
  private readonly usuario = inject(AuthService).usuario;

  private readonly idPaciente$ = inject(ActivatedRoute).paramMap.pipe(
    map((parametros) => parametros.get('id') ?? ''),
  );
  protected readonly idPaciente = toSignal(this.idPaciente$, { requireSync: true });

  /** `null` mientras carga. */
  protected readonly carga = toSignal(
    this.idPaciente$.pipe(
      switchMap((id) =>
        this.pacientes.obtener(id).pipe(
          map((paciente): CargaPaciente => ({ paciente, errores: [] })),
          catchError((error: unknown) =>
            of<CargaPaciente>({ paciente: null, errores: mensajesDeError(error) }),
          ),
          startWith(null),
        ),
      ),
    ),
    { initialValue: null },
  );

  protected readonly busqueda = new FormControl('', { nonNullable: true });
  private readonly lista = crearListaRemota({
    inicial: { idPaciente: this.idPaciente(), texto: '' } as Consulta,
    cambios: merge(this.idPaciente$.pipe(skip(1)), textoBuscado(this.busqueda)).pipe(
      map((): Consulta => ({ idPaciente: this.idPaciente(), texto: this.busqueda.value.trim() })),
    ),
    cargar: ({ idPaciente, texto }: Consulta) => this.historial.listarDePaciente(idPaciente, texto),
  });
  protected readonly registros = this.lista.elementos;
  protected readonly cargando = this.lista.cargando;
  protected readonly errores = this.lista.errores;
  protected readonly filtro = computed(() => this.lista.consulta().texto);

  /**
   * Trabajador del usuario actual, que firma los registros y se muestra al
   * crearlos; `null` si no tiene (el administrador).
   */
  protected readonly autor = computed<AutorNuevoRegistro | null>(() => {
    const usuario = this.usuario();
    if (usuario?.idTrabajador == null) {
      return null;
    }
    return {
      idTrabajador: usuario.idTrabajador,
      // Una sesión guardada antes de que el backend enviara el nombre no lo trae.
      nombreCompleto: usuario.nombreCompleto ?? null,
    };
  });
  /** Por qué no se pueden crear registros, o `null` si se puede. */
  protected readonly motivoSoloConsulta = computed(() => {
    const usuario = this.usuario();
    if (usuario === null) {
      return 'No se pudieron cargar los datos de su usuario. Recargue la página para poder añadir registros.';
    }
    if (usuario.idTrabajador === null) {
      return (
        'Modo consulta: su usuario no está vinculado a ningún trabajador (como el ' +
        'administrador). Cada registro se firma con el trabajador que lo crea, así que puede ' +
        'consultar el historial, pero no añadir registros.'
      );
    }
    return null;
  });

  protected recargar(): void {
    this.lista.recargar();
  }

  protected nuevo(paciente: Paciente): void {
    const autor = this.autor();
    if (autor === null) {
      return;
    }
    this.dialogo
      .open<RegistroDialogoComponent, DatosRegistroDialogo, ResultadoRegistroDialogo>(
        RegistroDialogoComponent,
        { data: { paciente, autor }, width: '640px', maxWidth: '95vw' },
      )
      .afterClosed()
      .pipe(filter((resultado) => resultado !== undefined))
      .subscribe((resultado) => {
        // Sin confirmar, el diálogo ya avisó; se recarga para ver si el registro llegó a crearse.
        if (resultado !== SIN_CONFIRMAR) {
          this.notificaciones.exito('Registro añadido al historial.');
        }
        this.recargar();
      });
  }
}
