import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { Usuario } from './auth.models';
import {
  AVISO_EXPIRACION_MS,
  AuthService,
  URL_CAMBIAR_PASSWORD,
  URL_LOGIN,
  URL_USUARIO_ACTUAL,
} from './auth.service';

const CLAVE = 'pachoclosystem.sesion';
const ADMIN: Usuario = {
  idUsuario: 'USR-0001',
  username: 'admin',
  rol: 'ADMIN',
  idTrabajador: null,
  activo: true,
  debeCambiarPassword: false,
};

describe('AuthService', () => {
  let http: HttpTestingController;
  let router: Router;
  const snackBar = { open: vi.fn() };

  function crear(): AuthService {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    return TestBed.inject(AuthService);
  }

  function iniciarSesion(auth: AuthService, expiraEnSegundos = 1800): void {
    auth.iniciarSesion({ username: 'admin', password: 'secreto' }).subscribe();
    http.expectOne(URL_LOGIN).flush({
      token: 'tkn',
      tipo: 'Bearer',
      expiraEnSegundos,
      rol: 'ADMIN',
      debeCambiarPassword: false,
    });
    http.expectOne(URL_USUARIO_ACTUAL).flush(ADMIN);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    sessionStorage.clear();
    snackBar.open.mockReset();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('al iniciar sesión guarda el token y el usuario en memoria y en sessionStorage', () => {
    const auth = crear();

    iniciarSesion(auth);

    expect(auth.autenticado()).toBe(true);
    expect(auth.token()).toBe('tkn');
    expect(auth.usuario()).toEqual(ADMIN);
    expect(JSON.parse(sessionStorage.getItem(CLAVE)!)).toEqual({
      token: 'tkn',
      expiraEn: Date.now() + 1800_000,
      usuario: ADMIN,
    });
  });

  it('cambiar la contraseña propia la envía y cierra la sesión explicando el motivo', () => {
    const auth = crear();
    iniciarSesion(auth);

    auth
      .cambiarPassword({ passwordActual: 'actual-123456', passwordNueva: 'nueva-1234567' })
      .subscribe();
    const peticion = http.expectOne(URL_CAMBIAR_PASSWORD);
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({
      passwordActual: 'actual-123456',
      passwordNueva: 'nueva-1234567',
    });
    peticion.flush(null, { status: 204, statusText: 'No Content' });

    expect(auth.autenticado()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { motivo: 'password-cambiada', returnUrl: undefined },
    });
  });

  it('si cambiar la contraseña falla, la sesión sigue abierta', () => {
    const auth = crear();
    iniciarSesion(auth);
    const error = vi.fn();

    auth
      .cambiarPassword({ passwordActual: 'mala', passwordNueva: 'nueva-1234567' })
      .subscribe({ error });
    http
      .expectOne(URL_CAMBIAR_PASSWORD)
      .flush(
        { status: 400, error: 'Bad Request', mensajes: ['La contraseña actual no es correcta.'] },
        { status: 400, statusText: 'Bad Request' },
      );

    expect(error).toHaveBeenCalled();
    expect(auth.autenticado()).toBe(true);
  });

  it('expone si el usuario debe cambiar la contraseña', () => {
    const auth = crear();
    auth.iniciarSesion({ username: 'eva', password: 'temporal' }).subscribe();
    http.expectOne(URL_LOGIN).flush({
      token: 'tkn',
      tipo: 'Bearer',
      expiraEnSegundos: 1800,
      rol: 'DOCTOR',
      debeCambiarPassword: true,
    });
    http.expectOne(URL_USUARIO_ACTUAL).flush({ ...ADMIN, debeCambiarPassword: true });

    expect(auth.debeCambiarPassword()).toBe(true);
  });

  it('si el login falla no queda sesión y propaga el error', () => {
    const auth = crear();
    const error = vi.fn();

    auth.iniciarSesion({ username: 'admin', password: 'mala' }).subscribe({ error });
    http.expectOne(URL_LOGIN).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(error).toHaveBeenCalled();
    expect(auth.autenticado()).toBe(false);
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
  });

  it('si falla /me tras el login tampoco queda sesión', () => {
    const auth = crear();

    auth.iniciarSesion({ username: 'admin', password: 'secreto' }).subscribe({ error: vi.fn() });
    http
      .expectOne(URL_LOGIN)
      .flush({ token: 'tkn', tipo: 'Bearer', expiraEnSegundos: 1800, rol: 'ADMIN' });
    http.expectOne(URL_USUARIO_ACTUAL).flush(null, { status: 500, statusText: 'Error' });

    expect(auth.autenticado()).toBe(false);
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
  });

  it('recupera una sesión vigente de sessionStorage', () => {
    sessionStorage.setItem(
      CLAVE,
      JSON.stringify({ token: 'guardado', expiraEn: Date.now() + 60_000, usuario: ADMIN }),
    );

    const auth = crear();

    expect(auth.token()).toBe('guardado');
    expect(auth.usuario()).toEqual(ADMIN);
  });

  it('recupera una sesión guardada sin nombreCompleto: la app sigue funcionando', () => {
    // Sesión de una versión anterior: el usuario guardado no traía el campo.
    sessionStorage.setItem(
      CLAVE,
      JSON.stringify({
        token: 'guardado',
        expiraEn: Date.now() + 60_000,
        usuario: {
          idUsuario: 'USR-0002',
          username: 'eva',
          rol: 'DOCTOR',
          idTrabajador: 'DOC-0001',
          activo: true,
          debeCambiarPassword: false,
        },
      }),
    );

    const auth = crear();

    expect(auth.autenticado()).toBe(true);
    expect(auth.usuario()?.idTrabajador).toBe('DOC-0001');
    expect(auth.usuario()?.nombreCompleto).toBeUndefined();
  });

  it.each([
    ['expirada', JSON.stringify({ token: 't', expiraEn: Date.parse('2026-10-06T09:59:59Z') })],
    ['corrupta', '{no es json'],
    ['sin token', JSON.stringify({ expiraEn: Date.parse('2026-10-06T11:00:00Z') })],
  ])('descarta una sesión guardada %s', (_caso, valor) => {
    sessionStorage.setItem(CLAVE, valor);

    const auth = crear();

    expect(auth.autenticado()).toBe(false);
  });

  it('avisa antes de expirar y, al expirar, cierra la sesión recordando la ruta', async () => {
    const auth = crear();
    iniciarSesion(auth);

    await vi.advanceTimersByTimeAsync(1800_000 - AVISO_EXPIRACION_MS - 1);
    expect(snackBar.open).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(snackBar.open).toHaveBeenCalledWith(
      expect.stringContaining('Su sesión expira en 5 minutos'),
      'Entendido',
      expect.anything(),
    );
    expect(auth.autenticado()).toBe(true);

    await vi.advanceTimersByTimeAsync(AVISO_EXPIRACION_MS);
    expect(auth.autenticado()).toBe(false);
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { motivo: 'expirada', returnUrl: '/' },
    });
  });

  it('si quedan menos minutos que la antelación del aviso, avisa en seguida con lo que queda', async () => {
    sessionStorage.setItem(
      CLAVE,
      JSON.stringify({ token: 't', expiraEn: Date.now() + 90_000, usuario: ADMIN }),
    );
    crear();

    await vi.advanceTimersByTimeAsync(0);

    expect(snackBar.open).toHaveBeenCalledWith(
      expect.stringContaining('Su sesión expira en 2 minutos'),
      'Entendido',
      expect.anything(),
    );
  });

  it('cerrar sesión borra todo, cancela los temporizadores y lleva al login', async () => {
    const auth = crear();
    iniciarSesion(auth);

    auth.cerrarSesion();

    expect(auth.autenticado()).toBe(false);
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { motivo: undefined, returnUrl: undefined },
    });

    await vi.runAllTimersAsync();
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});
