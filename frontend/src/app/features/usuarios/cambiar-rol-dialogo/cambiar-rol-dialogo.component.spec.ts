import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, of, throwError } from 'rxjs';
import { Usuario } from '../../../core/auth/auth.models';
import { ApiError } from '../../../core/http/api-error';
import { Trabajador } from '../../trabajadores/trabajador.models';
import { TrabajadorService } from '../../trabajadores/trabajador.service';
import { CambiarRolRequest } from '../usuario.models';
import { UsuarioService } from '../usuario.service';
import { CambiarRolDialogoComponent } from './cambiar-rol-dialogo.component';

describe('CambiarRolDialogoComponent', () => {
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
    doctor('DOC-0003', 'Pedro Gil'),
    {
      idTrabajador: 'ENF-0001',
      nombreCompleto: 'Luis Gil',
      rol: 'Enfermero',
      especialidad: null,
      nivelExperiencia: 'NOVATO',
    },
  ];
  /** Usuario al que se le cambia el rol: doctor con DOC-0001. */
  const eva: Usuario = {
    idUsuario: 'USR-0002',
    username: 'eva.mora',
    rol: 'DOCTOR',
    idTrabajador: 'DOC-0001',
    activo: true,
    debeCambiarPassword: false,
  };
  /** DOC-0003 lo tiene otro usuario: no se ofrece, aunque esté libre no lo está. */
  const existentes: Usuario[] = [
    {
      idUsuario: 'USR-0001',
      username: 'admin',
      rol: 'ADMIN',
      idTrabajador: null,
      activo: true,
      debeCambiarPassword: false,
    },
    eva,
    {
      idUsuario: 'USR-0003',
      username: 'pedro.gil',
      rol: 'DOCTOR',
      idTrabajador: 'DOC-0003',
      activo: true,
      debeCambiarPassword: false,
    },
  ];
  const usuarios = {
    listar: vi.fn<() => Observable<Usuario[]>>(),
    cambiarRol: vi.fn<(id: string, d: CambiarRolRequest) => Observable<Usuario>>(),
  };
  const servicioTrabajadores = { listar: vi.fn<() => Observable<Trabajador[]>>() };
  const dialogo = { close: vi.fn() };

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [CambiarRolDialogoComponent],
      providers: [
        { provide: UsuarioService, useValue: usuarios },
        { provide: TrabajadorService, useValue: servicioTrabajadores },
        { provide: MatDialogRef, useValue: dialogo },
        { provide: MAT_DIALOG_DATA, useValue: { usuario: eva } },
      ],
    });
    const fixture = TestBed.createComponent(CambiarRolDialogoComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    const estable = () => fixture.whenStable();
    return {
      elemento,
      estable,
      /** El trabajador que muestra el select (su etiqueta, o vacío). */
      trabajadorElegido: () =>
        elemento.querySelector('[formControlName="idTrabajador"]')?.textContent?.trim() ?? '',
      /** El valor del rol marcado, tal como se envía. */
      rolElegido: () =>
        elemento.querySelector<HTMLInputElement>('mat-radio-group input:checked')?.value ?? null,
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

  it('precarga el rol y el trabajador actuales', async () => {
    const { rolElegido, trabajadorElegido } = await renderizar();

    expect(rolElegido()).toBe('DOCTOR');
    expect(trabajadorElegido()).toContain('Eva Mora (DOC-0001)');
  });

  it('ofrece los trabajadores libres del tipo y, aunque ya tenga usuario, el suyo', async () => {
    const { elegirRol, opcionesTrabajador } = await renderizar();

    // DOC-0001 es suyo (se ofrece), DOC-0002 está libre y DOC-0003 es de otro.
    expect(await opcionesTrabajador()).toEqual(['DOC-0001', 'DOC-0002']);

    await elegirRol('Enfermero');
    expect(await opcionesTrabajador()).toEqual(['ENF-0001']);
  });

  it('el trabajador solo cuenta para doctor o enfermero', async () => {
    usuarios.cambiarRol.mockReturnValue(of({ ...eva, rol: 'ADMIN', idTrabajador: null }));
    const { elemento, elegirRol, enviar, errores } = await renderizar();

    // Con doctor o enfermero, sin trabajador no se envía: lo valida en local.
    await elegirRol('Enfermero');
    await enviar();

    expect(usuarios.cambiarRol).not.toHaveBeenCalled();
    expect(errores()).toEqual([
      'El usuario con rol ENFERMERO debe estar vinculado a un trabajador.',
    ]);

    // Para un administrador ni hay select ni viaja `idTrabajador`.
    await elegirRol('Administrador');
    expect(elemento.querySelector('[formControlName="idTrabajador"]')).toBeNull();

    await enviar();

    expect(usuarios.cambiarRol).toHaveBeenCalledWith('USR-0002', {
      rol: 'ADMIN',
      idTrabajador: null,
    });
  });

  it('envía el rol nuevo con su trabajador y cierra con el usuario actualizado', async () => {
    const actualizado: Usuario = { ...eva, rol: 'ENFERMERO', idTrabajador: 'ENF-0001' };
    usuarios.cambiarRol.mockReturnValue(of(actualizado));
    const { elegirRol, rellenar, enviar } = await renderizar();

    await elegirRol('Enfermero');
    await rellenar({ idTrabajador: 'ENF-0001' });
    await enviar();

    expect(usuarios.cambiarRol).toHaveBeenCalledWith('USR-0002', {
      rol: 'ENFERMERO',
      idTrabajador: 'ENF-0001',
    });
    expect(dialogo.close).toHaveBeenCalledWith(actualizado);
  });

  it.each([
    [404, 'El trabajador no existe.'],
    [409, 'El trabajador ya está vinculado a otro usuario.'],
  ])('muestra dentro el %i del servidor sin cerrarse', async (status, mensaje) => {
    usuarios.cambiarRol.mockReturnValue(throwError(() => new ApiError(status, [mensaje])));
    const { elemento, elegirRol, rellenar, enviar } = await renderizar();

    await elegirRol('Enfermero');
    await rellenar({ idTrabajador: 'ENF-0001' });
    await enviar();

    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(mensaje);
    expect(dialogo.close).not.toHaveBeenCalled();
  });

  it('si no cargan los trabajadores lo indica dentro y deja reintentar', async () => {
    servicioTrabajadores.listar.mockReturnValueOnce(
      throwError(() => new ApiError(0, ['No se pudo conectar con el servidor.'])),
    );
    const { elemento, estable, opcionesTrabajador } = await renderizar();

    expect(elemento.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudo conectar con el servidor.',
    );

    elemento.querySelector<HTMLButtonElement>('.reintentar')!.click();
    await estable();

    expect(await opcionesTrabajador()).toEqual(['DOC-0001', 'DOC-0002']);
    expect(elemento.querySelector('[role="alert"]')).toBeNull();
  });
});
