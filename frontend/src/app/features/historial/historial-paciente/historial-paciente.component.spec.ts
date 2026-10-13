import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { Usuario } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { Paciente } from '../../pacientes/paciente.models';
import { PacienteService } from '../../pacientes/paciente.service';
import { Registro } from '../historial.models';
import { HistorialService } from '../historial.service';
import {
  RegistroDialogoComponent,
  SIN_CONFIRMAR,
} from '../registro-dialogo/registro-dialogo.component';
import { HistorialPacienteComponent } from './historial-paciente.component';

describe('HistorialPacienteComponent', () => {
  const ana: Paciente = { idPaciente: 'PAC-0001', nombre: 'Ana Ruiz', edad: 40, habitacion: 12 };
  const registro = {
    idRegistro: 'r1',
    idPaciente: 'PAC-0001',
    nombrePaciente: 'Ana Ruiz',
    fecha: '2026-10-06T20:21:00',
    tipo: 'DIAGNOSTICO',
    autor: {
      idTrabajador: 'DOC-0001',
      nombreCompleto: 'Eva Mora',
      rol: 'Doctor',
      especialidad: 'Cardiología',
      nivelExperiencia: null,
    },
    contenido: 'Hipertensión leve',
  } as Registro;
  const doctora: Usuario = {
    idUsuario: 'USR-0002',
    username: 'eva',
    rol: 'DOCTOR',
    idTrabajador: 'DOC-0001',
    nombreCompleto: 'Eva Mora',
    activo: true,
    debeCambiarPassword: false,
  };
  const admin: Usuario = {
    idUsuario: 'USR-0001',
    username: 'admin',
    rol: 'ADMIN',
    idTrabajador: null,
    activo: true,
    debeCambiarPassword: false,
  };

  const historial = {
    listarDePaciente: vi.fn<(id: string, q?: string) => Observable<Registro[]>>(),
  };
  const pacientes = { obtener: vi.fn<(id: string) => Observable<Paciente>>() };
  const dialogo = { open: vi.fn() };
  const notificaciones = { exito: vi.fn(), error: vi.fn() };
  const usuario = signal<Usuario | null>(doctora);
  const parametros = new BehaviorSubject(convertToParamMap({ id: 'PAC-0001' }));

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [HistorialPacienteComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: parametros } },
        { provide: HistorialService, useValue: historial },
        { provide: PacienteService, useValue: pacientes },
        { provide: MatDialog, useValue: dialogo },
        { provide: NotificacionService, useValue: notificaciones },
        { provide: AuthService, useValue: { usuario } },
      ],
    });
    const fixture = TestBed.createComponent(HistorialPacienteComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      elemento,
      botonNuevo: () =>
        Array.from(elemento.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
          b.textContent?.includes('Nuevo registro'),
        ),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    usuario.set(doctora);
    parametros.next(convertToParamMap({ id: 'PAC-0001' }));
    pacientes.obtener.mockReturnValue(of(ana));
    historial.listarDePaciente.mockReturnValue(of([registro]));
  });

  it('muestra el paciente y su historial', async () => {
    const { elemento } = await renderizar();

    expect(pacientes.obtener).toHaveBeenCalledWith('PAC-0001');
    expect(historial.listarDePaciente).toHaveBeenCalledWith('PAC-0001', '');
    expect(elemento.querySelector('h1')?.textContent).toContain('Historial de Ana Ruiz');
    expect(elemento.querySelectorAll('li.registro')).toHaveLength(1);
  });

  it('con trabajador vinculado deja crear registros firmados por él', async () => {
    dialogo.open.mockReturnValue({ afterClosed: () => of(registro) });
    const { fixture, elemento, botonNuevo } = await renderizar();

    expect(elemento.querySelector('.solo-consulta')).toBeNull();
    botonNuevo()!.click();
    await fixture.whenStable();

    expect(dialogo.open).toHaveBeenCalledWith(
      RegistroDialogoComponent,
      expect.objectContaining({
        data: { paciente: ana, autor: { idTrabajador: 'DOC-0001', nombreCompleto: 'Eva Mora' } },
      }),
    );
    expect(notificaciones.exito).toHaveBeenCalledWith('Registro añadido al historial.');
    expect(historial.listarDePaciente).toHaveBeenCalledTimes(2);
  });

  it('si la sesión no trae nombre, pasa el autor solo con su ID y deja crear igual', async () => {
    usuario.set({ ...doctora, nombreCompleto: null });
    dialogo.open.mockReturnValue({ afterClosed: () => of(registro) });
    const { fixture, botonNuevo } = await renderizar();

    botonNuevo()!.click();
    await fixture.whenStable();

    expect(dialogo.open).toHaveBeenCalledWith(
      RegistroDialogoComponent,
      expect.objectContaining({
        data: { paciente: ana, autor: { idTrabajador: 'DOC-0001', nombreCompleto: null } },
      }),
    );
    expect(notificaciones.exito).toHaveBeenCalledWith('Registro añadido al historial.');
  });

  it('al cancelar tras un resultado incierto recarga la lista, sin aviso de éxito', async () => {
    dialogo.open.mockReturnValue({ afterClosed: () => of(SIN_CONFIRMAR) });
    const { fixture, botonNuevo } = await renderizar();
    expect(historial.listarDePaciente).toHaveBeenCalledTimes(1);

    botonNuevo()!.click();
    await fixture.whenStable();

    // El aviso de revisar historial y stock lo da el diálogo; aquí solo se recarga.
    expect(historial.listarDePaciente).toHaveBeenCalledTimes(2);
    expect(notificaciones.exito).not.toHaveBeenCalled();
  });

  it('al cerrar el diálogo sin enviar nada no recarga ni avisa', async () => {
    dialogo.open.mockReturnValue({ afterClosed: () => of(undefined) });
    const { fixture, botonNuevo } = await renderizar();

    botonNuevo()!.click();
    await fixture.whenStable();

    expect(historial.listarDePaciente).toHaveBeenCalledTimes(1);
    expect(notificaciones.exito).not.toHaveBeenCalled();
  });

  it('sin trabajador vinculado (admin) queda en modo consulta y explica por qué', async () => {
    usuario.set(admin);

    const { elemento, botonNuevo } = await renderizar();

    expect(botonNuevo()).toBeUndefined();
    expect(elemento.querySelector('.solo-consulta')?.textContent).toContain(
      'su usuario no está vinculado a ningún trabajador',
    );
    expect(elemento.querySelectorAll('li.registro')).toHaveLength(1);
  });

  it('si el paciente no existe muestra el error', async () => {
    pacientes.obtener.mockReturnValue(
      throwError(() => new ApiError(404, ['No se encontró el paciente PAC-0001.'])),
    );

    const { elemento } = await renderizar();

    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
      'No se encontró el paciente PAC-0001.',
    );
    expect(elemento.querySelector('h1')).toBeNull();
  });

  it('al cambiar de paciente en la misma pantalla recarga paciente e historial', async () => {
    const { fixture } = await renderizar();
    pacientes.obtener.mockReturnValue(of({ ...ana, idPaciente: 'PAC-0002' }));

    parametros.next(convertToParamMap({ id: 'PAC-0002' }));
    await fixture.whenStable();

    expect(pacientes.obtener).toHaveBeenLastCalledWith('PAC-0002');
    expect(historial.listarDePaciente).toHaveBeenLastCalledWith('PAC-0002', '');
  });
});
