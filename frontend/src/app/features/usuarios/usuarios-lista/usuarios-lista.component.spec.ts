import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { Usuario } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificacionService } from '../../../core/notificacion.service';
import { ConfirmacionDialogoComponent } from '../../../shared/confirmacion-dialogo/confirmacion-dialogo.component';
import { CambiarRolDialogoComponent } from '../cambiar-rol-dialogo/cambiar-rol-dialogo.component';
import { PasswordDialogoComponent } from '../password-dialogo/password-dialogo.component';
import { UsuarioDialogoComponent } from '../usuario-dialogo/usuario-dialogo.component';
import { UsuarioService } from '../usuario.service';
import { UsuariosListaComponent } from './usuarios-lista.component';

describe('UsuariosListaComponent', () => {
  const admin: Usuario = {
    idUsuario: 'USR-0001',
    username: 'admin',
    rol: 'ADMIN',
    idTrabajador: null,
    activo: true,
    debeCambiarPassword: false,
  };
  const eva: Usuario = {
    idUsuario: 'USR-0002',
    username: 'eva.mora',
    rol: 'DOCTOR',
    idTrabajador: 'DOC-0001',
    activo: false,
    debeCambiarPassword: false,
  };
  const servicio = {
    listar: vi.fn<(q?: string) => Observable<Usuario[]>>(),
    desactivar: vi.fn<(id: string) => Observable<Usuario>>(),
    activar: vi.fn<(id: string) => Observable<Usuario>>(),
  };
  const dialogo = { open: vi.fn() };
  const notificaciones = { exito: vi.fn(), error: vi.fn() };
  /** Sesión abierta: el admin de la lista (su fila no ofrece cambiar el rol). */
  const auth = { usuario: () => admin };
  const alCerrarDialogo = (resultado: unknown) =>
    dialogo.open.mockReturnValueOnce({ afterClosed: () => of(resultado) });

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [UsuariosListaComponent],
      providers: [
        { provide: UsuarioService, useValue: servicio },
        { provide: MatDialog, useValue: dialogo },
        { provide: NotificacionService, useValue: notificaciones },
        { provide: AuthService, useValue: auth },
      ],
    });
    const fixture = TestBed.createComponent(UsuariosListaComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      elemento,
      filas: () =>
        Array.from(elemento.querySelectorAll('tr[mat-row]')).map((f) =>
          Array.from(f.querySelectorAll('td'))
            .slice(0, 4)
            .map((c) => {
              // Los span (usuario e ID) se separan por estilo, no con espacios.
              const partes = Array.from(c.querySelectorAll('span'));
              const textos = partes.length ? partes.map((p) => p.textContent) : [c.textContent];
              return textos.map((t) => (t ?? '').trim()).join(' ');
            }),
        ),
      boton: (etiqueta: string) =>
        elemento.querySelector<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    servicio.listar.mockReturnValue(of([admin, eva]));
  });

  it('lista usuarios con rol, trabajador y estado, sin hashes', async () => {
    const { filas } = await renderizar();

    expect(filas()).toEqual([
      ['admin USR-0001', 'Administrador', '—', 'Activo'],
      ['eva.mora USR-0002', 'Doctor', 'DOC-0001', 'Inactivo'],
    ]);
  });

  it('ofrece desactivar a los activos y activar a los inactivos', async () => {
    const { boton } = await renderizar();

    expect(boton('Desactivar a admin')).not.toBeNull();
    expect(boton('Activar a admin')).toBeNull();
    expect(boton('Activar a eva.mora')).not.toBeNull();
    expect(boton('Desactivar a eva.mora')).toBeNull();
  });

  it('desactivar confirma en un diálogo que ejecuta la operación (y muestra sus 409)', async () => {
    servicio.desactivar.mockReturnValue(
      of({ ...admin, activo: false, debeCambiarPassword: false }),
    );
    alCerrarDialogo(true);
    const { fixture, boton } = await renderizar();

    boton('Desactivar a admin')!.click();
    await fixture.whenStable();

    const [componente, config] = dialogo.open.mock.calls[0];
    expect(componente).toBe(ConfirmacionDialogoComponent);
    // El diálogo recibe la operación y es él quien la ejecuta y muestra sus errores.
    config.data.ejecutar().subscribe();
    expect(servicio.desactivar).toHaveBeenCalledWith('USR-0001');
    expect(notificaciones.exito).toHaveBeenCalledWith('Usuario admin desactivado.');
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  it('activar usa la misma confirmación con su operación', async () => {
    servicio.activar.mockReturnValue(of({ ...eva, activo: true, debeCambiarPassword: false }));
    alCerrarDialogo(true);
    const { fixture, boton } = await renderizar();

    boton('Activar a eva.mora')!.click();
    await fixture.whenStable();

    dialogo.open.mock.calls[0][1].data.ejecutar().subscribe();
    expect(servicio.activar).toHaveBeenCalledWith('USR-0002');
    expect(notificaciones.exito).toHaveBeenCalledWith('Usuario eva.mora activado.');
  });

  it('abre el cambio de rol de la fila en su diálogo', async () => {
    alCerrarDialogo({ ...eva, rol: 'ENFERMERO', idTrabajador: 'ENF-0001' });
    const { fixture, boton } = await renderizar();

    boton('Cambiar rol de eva.mora')!.click();
    await fixture.whenStable();

    expect(dialogo.open.mock.calls[0][0]).toBe(CambiarRolDialogoComponent);
    expect(dialogo.open.mock.calls[0][1].data).toEqual({ usuario: eva });
  });

  it('al cambiar el rol notifica y recarga', async () => {
    alCerrarDialogo({ ...eva, rol: 'ENFERMERO', idTrabajador: 'ENF-0001' });
    const { fixture, boton } = await renderizar();

    boton('Cambiar rol de eva.mora')!.click();
    await fixture.whenStable();

    expect(notificaciones.exito).toHaveBeenCalledWith('Rol de eva.mora actualizado.');
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  it('sobre el propio usuario el botón está deshabilitado y no abre nada', async () => {
    const { fixture, boton } = await renderizar();

    const propio = boton('Cambiar rol de admin')!;
    expect(propio.getAttribute('aria-disabled')).toBe('true');
    expect(propio.classList).toContain('mat-mdc-button-disabled');
    expect(boton('Cambiar rol de eva.mora')!.getAttribute('aria-disabled')).toBeNull();

    // El tooltip necesita que el botón reciba el puntero (`disabledInteractive`),
    // así que el clic llega al componente: no debe hacer nada.
    propio.click();
    await fixture.whenStable();

    expect(dialogo.open).not.toHaveBeenCalled();
  });

  it('abre el alta y el restablecimiento de contraseña', async () => {
    alCerrarDialogo({ ...eva, username: 'nuevo.user' });
    alCerrarDialogo(true);
    const { fixture, elemento, boton } = await renderizar();

    elemento.querySelector<HTMLButtonElement>('.lista-encabezado button')!.click();
    await fixture.whenStable();
    boton('Restablecer la contraseña de eva.mora')!.click();
    await fixture.whenStable();

    expect(dialogo.open.mock.calls[0][0]).toBe(UsuarioDialogoComponent);
    expect(dialogo.open.mock.calls[1][0]).toBe(PasswordDialogoComponent);
    expect(dialogo.open.mock.calls[1][1].data).toEqual({ usuario: eva });
    expect(notificaciones.exito).toHaveBeenCalledWith('Usuario nuevo.user creado.');
    expect(notificaciones.exito).toHaveBeenCalledWith('Contraseña de eva.mora restablecida.');
  });
});
