import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { CambiarPasswordRequest, Usuario } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { ApiError } from '../../core/http/api-error';
import { CambiarPasswordComponent } from './cambiar-password.component';

describe('CambiarPasswordComponent', () => {
  const eva: Usuario = {
    idUsuario: 'USR-0002',
    username: 'eva.morales',
    rol: 'DOCTOR',
    idTrabajador: 'DOC-0001',
    activo: true,
    debeCambiarPassword: true,
  };
  const usuario = signal<Usuario | null>(eva);
  const auth = {
    usuario,
    debeCambiarPassword: computed(() => usuario()?.debeCambiarPassword === true),
    cambiarPassword: vi.fn<(cambio: CambiarPasswordRequest) => Observable<void>>(),
    cerrarSesion: vi.fn(),
  };

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [CambiarPasswordComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(CambiarPasswordComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    return {
      elemento,
      cambiar: async (actual: string, nueva: string, repeticion = nueva) => {
        for (const [nombre, valor] of [
          ['actual', actual],
          ['nueva', nueva],
          ['repeticion', repeticion],
        ]) {
          const input = elemento.querySelector<HTMLInputElement>(`[formControlName="${nombre}"]`)!;
          input.value = valor;
          input.dispatchEvent(new Event('input'));
        }
        elemento.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await fixture.whenStable();
      },
      errores: () =>
        Array.from(elemento.querySelectorAll('mat-error')).map((e) => e.textContent?.trim()),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    usuario.set(eva);
  });

  it('muestra el logotipo de marca con su texto alternativo', async () => {
    const { elemento } = await renderizar();

    const logo = elemento.querySelector<HTMLImageElement>('img.marca-logo');
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute('alt')).toBe('PachocloSystem');
    expect(logo!.getAttribute('src')).toContain('logos/logo-sistema-160.png');
  });

  it('si el cambio es obligatorio lo avisa y solo deja cerrar sesión', async () => {
    const { elemento } = await renderizar();

    expect(elemento.querySelector('.aviso')?.textContent).toContain(
      'Debe cambiar su contraseña antes de continuar.',
    );
    expect(elemento.querySelector('a[routerLink="/"]')).toBeNull();
    const cerrar = Array.from(elemento.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Cerrar sesión'),
    )!;
    cerrar.click();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });

  it('si es voluntario no avisa y deja cancelar', async () => {
    usuario.set({ ...eva, debeCambiarPassword: false });
    const { elemento } = await renderizar();

    expect(elemento.querySelector('.aviso')).toBeNull();
    expect(elemento.querySelector('a[routerLink="/"]')?.textContent).toContain('Cancelar');
  });

  it('envía la actual y la nueva', async () => {
    auth.cambiarPassword.mockReturnValue(of(undefined));
    const { cambiar } = await renderizar();

    await cambiar('temporal-12345', 'definitiva-12345');

    expect(auth.cambiarPassword).toHaveBeenCalledWith({
      passwordActual: 'temporal-12345',
      passwordNueva: 'definitiva-12345',
    });
  });

  it('valida la política, que la nueva sea distinta de la actual y la repetición', async () => {
    const { cambiar, errores } = await renderizar();

    await cambiar('temporal-12345', 'corta');
    expect(errores()).toContain('La contraseña debe tener al menos 10 caracteres.');

    await cambiar('temporal-12345', 'EVA.MORALES');
    expect(errores()).toContain('La contraseña no puede ser igual al username.');

    await cambiar('temporal-12345', 'temporal-12345');
    expect(errores()).toContain('La nueva contraseña debe ser diferente de la actual.');

    await cambiar('temporal-12345', 'definitiva-12345', 'otra-12345678');
    expect(errores()).toContain('Las contraseñas no coinciden.');

    expect(auth.cambiarPassword).not.toHaveBeenCalled();
  });

  it('muestra los mensajes del backend si la rechaza', async () => {
    auth.cambiarPassword.mockReturnValue(
      throwError(() => new ApiError(400, ['La contraseña actual no es correcta.'])),
    );
    const { elemento, cambiar } = await renderizar();

    await cambiar('equivocada-123', 'definitiva-12345');

    expect(elemento.textContent).toContain('La contraseña actual no es correcta.');
    expect(elemento.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      false,
    );
  });
});
