import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { Observable, of, throwError } from 'rxjs';
import { Usuario } from '../../../core/auth/auth.models';
import { ApiError } from '../../../core/http/api-error';
import { Trabajador } from '../../trabajadores/trabajador.models';
import { TrabajadorService } from '../../trabajadores/trabajador.service';
import { UsuarioRequest } from '../usuario.models';
import { UsuarioService } from '../usuario.service';
import { UsuarioDialogoComponent } from './usuario-dialogo.component';

describe('UsuarioDialogoComponent', () => {
  const doctor = (id: string, nombre: string): Trabajador => ({
    idTrabajador: id,
    nombreCompleto: nombre,
    rol: 'Doctor',
    especialidad: 'Cardiología',
    nivelExperiencia: null,
  });
  const trabajadores: Trabajador[] = [
    doctor('DOC-0001', 'Eva Mora'),
    doctor('DOC-0002', 'Carlos Mena'),
    {
      idTrabajador: 'ENF-0001',
      nombreCompleto: 'Luis Gil',
      rol: 'Enfermero',
      especialidad: null,
      nivelExperiencia: 'NOVATO',
    },
  ];
  /** DOC-0001 ya tiene usuario (desactivado): el vínculo no se libera. */
  const existentes: Usuario[] = [
    {
      idUsuario: 'USR-0001',
      username: 'admin',
      rol: 'ADMIN',
      idTrabajador: null,
      activo: true,
      debeCambiarPassword: false,
    },
    {
      idUsuario: 'USR-0002',
      username: 'eva.mora',
      rol: 'DOCTOR',
      idTrabajador: 'DOC-0001',
      activo: false,
      debeCambiarPassword: false,
    },
  ];
  const usuarios = {
    listar: vi.fn<() => Observable<Usuario[]>>(),
    crear: vi.fn<(d: UsuarioRequest) => Observable<Usuario>>(),
  };
  const servicioTrabajadores = { listar: vi.fn<() => Observable<Trabajador[]>>() };
  const dialogo = { close: vi.fn() };

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [UsuarioDialogoComponent],
      providers: [
        { provide: UsuarioService, useValue: usuarios },
        { provide: TrabajadorService, useValue: servicioTrabajadores },
        { provide: MatDialogRef, useValue: dialogo },
      ],
    });
    const fixture = TestBed.createComponent(UsuarioDialogoComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    const estable = () => fixture.whenStable();
    return {
      elemento,
      rellenar: async (valores: Record<string, string>) => {
        for (const [nombre, valor] of Object.entries(valores)) {
          const campo = elemento.querySelector<HTMLElement>(`[formControlName="${nombre}"]`);
          if (!campo) continue;
          if (campo.tagName === 'MAT-SELECT') {
            campo.click();
            fixture.detectChanges();
            await estable();
            const opcion = Array.from(
              document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'),
            ).find((o) => o.textContent?.includes('(' + valor + ')'));
            opcion?.click();
            await estable();
          } else {
            (campo as HTMLInputElement).value = valor;
            campo.dispatchEvent(new Event('input'));
          }
        }
        await estable();
      },
      elegirRol: async (etiqueta: string) => {
        Array.from(elemento.querySelectorAll('mat-radio-button'))
          .find((r) => r.textContent?.trim() === etiqueta)!
          .querySelector('input')!
          .click();
        await estable();
      },
      opcionesTrabajador: async () => {
        const select = elemento.querySelector<HTMLElement>('[formControlName="idTrabajador"]')!;
        select.click();
        fixture.detectChanges();
        await estable();
        const valores = Array.from(
          document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'),
        )
          .map((o) => o.textContent?.trim() ?? '')
          .filter((t) => /\([^)]+\)$/.test(t))
          .map((t) => t.slice(t.lastIndexOf('(') + 1, -1));
        // Cierra el panel para no interferir con los pasos siguientes.
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await estable();
        return valores;
      },
      enviar: async () => {
        elemento.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await estable();
      },
      errores: () =>
        Array.from(elemento.querySelectorAll('mat-error')).map((e) => e.textContent?.trim()),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    usuarios.listar.mockReturnValue(of(existentes));
    servicioTrabajadores.listar.mockReturnValue(of(trabajadores));
  });

  it('valida en local con los mensajes del backend', async () => {
    const { rellenar, enviar, errores } = await renderizar();

    await rellenar({ username: 'Ab', password: 'corta-123', repeticion: 'otra' });
    await enviar();

    expect(usuarios.crear).not.toHaveBeenCalled();
    expect(errores()).toEqual([
      'El username debe tener entre 3 y 30 caracteres y solo puede contener minúsculas, ' +
        'dígitos, punto, guion bajo o guion.',
      'La contraseña debe tener al menos 10 caracteres.',
      'Las contraseñas no coinciden.',
      'Debe seleccionar un rol (ADMIN, DOCTOR o ENFERMERO).',
    ]);
  });

  it('la contraseña se describe con la nota de requisitos vía aria-describedby', async () => {
    const { elemento } = await renderizar();

    const contrasena = elemento.querySelector('[formControlName="password"]');
    const nota = elemento.querySelector<HTMLElement>('#nota-contrasena');

    expect(nota?.textContent?.trim()).toBe(
      'Al menos 10 caracteres y distinta del usuario. La cambiará al entrar.',
    );
    expect(nota?.id).toBe('nota-contrasena');
    expect(contrasena?.getAttribute('aria-describedby')).toContain('nota-contrasena');
  });

  it('la contraseña no puede ser el username', async () => {
    const { rellenar, enviar, errores } = await renderizar();

    await rellenar({
      username: 'ana.torres.g',
      password: 'ANA.TORRES.G',
      repeticion: 'ANA.TORRES.G',
    });
    await enviar();

    expect(errores()).toContain('La contraseña no puede ser igual al username.');
  });

  it('un doctor solo puede vincularse a doctores sin usuario', async () => {
    usuarios.crear.mockReturnValue(of(existentes[1]));
    const { rellenar, elegirRol, opcionesTrabajador, enviar, errores } = await renderizar();

    await rellenar({
      username: '  Carlos.Mena ',
      password: 'clave-de-carlos',
      repeticion: 'clave-de-carlos',
    });
    await elegirRol('Doctor');
    expect(await opcionesTrabajador()).toEqual(['DOC-0002']);

    await enviar();
    expect(errores()).toEqual(['El usuario con rol DOCTOR debe estar vinculado a un trabajador.']);

    await rellenar({ idTrabajador: 'DOC-0002' });
    await enviar();

    expect(usuarios.crear).toHaveBeenCalledWith({
      username: 'carlos.mena',
      password: 'clave-de-carlos',
      rol: 'DOCTOR',
      idTrabajador: 'DOC-0002',
    });
    expect(dialogo.close).toHaveBeenCalledWith(existentes[1]);
  });

  it('un administrador no lleva trabajador', async () => {
    usuarios.crear.mockReturnValue(of(existentes[0]));
    const { elemento, rellenar, elegirRol, enviar } = await renderizar();

    await rellenar({
      username: 'otro.admin',
      password: 'clave-segura-1',
      repeticion: 'clave-segura-1',
    });
    await elegirRol('Administrador');
    expect(elemento.querySelector('[formControlName="idTrabajador"]')).toBeNull();
    await enviar();

    expect(usuarios.crear).toHaveBeenCalledWith(
      expect.objectContaining({ rol: 'ADMIN', idTrabajador: null }),
    );
  });

  it('muestra dentro del formulario el 409 del servidor', async () => {
    usuarios.crear.mockReturnValue(
      throwError(() => new ApiError(409, ['Ya existe un usuario con el username otro.admin.'])),
    );
    const { elemento, rellenar, elegirRol, enviar } = await renderizar();

    await rellenar({
      username: 'otro.admin',
      password: 'clave-segura-1',
      repeticion: 'clave-segura-1',
    });
    await elegirRol('Administrador');
    await enviar();

    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
      'Ya existe un usuario con el username otro.admin.',
    );
    expect(dialogo.close).not.toHaveBeenCalled();
  });

  it('si no cargan los trabajadores lo indica al elegir doctor o enfermero', async () => {
    servicioTrabajadores.listar.mockReturnValue(
      throwError(() => new ApiError(0, ['No se pudo conectar con el servidor.'])),
    );
    const { elemento, elegirRol } = await renderizar();

    await elegirRol('Enfermero');

    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudo conectar con el servidor.',
    );
  });
});
