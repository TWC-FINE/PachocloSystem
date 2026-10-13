import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { Registro } from '../historial.models';
import { RegistrosComponent } from './registros.component';

describe('RegistrosComponent', () => {
  const signos: Registro = {
    idRegistro: 'r1',
    idPaciente: 'PAC-0001',
    nombrePaciente: 'Ana Ruiz',
    fecha: '2026-10-06T20:21:00.915452',
    tipo: 'SIGNOS_VITALES',
    autor: {
      idTrabajador: 'ENF-0001',
      nombreCompleto: 'Luis Gil',
      rol: 'Enfermero',
      especialidad: null,
      nivelExperiencia: 'NOVATO',
    },
    contenido:
      'Signos vitales - Temp: 36.5°C | FC: 80 lpm | PA: 120/80 mmHg | FR: 16 rpm | SpO2: 98%',
  };
  const medicacion: Registro = {
    ...signos,
    idRegistro: 'r2',
    tipo: 'MEDICACION',
    contenido: 'Paracetamol 500 mg vía oral',
    medicacion: { idMedicamento: 'MED-0001', cantidad: 2 },
  };

  async function renderizar(registros: Registro[], mostrarPaciente = false) {
    TestBed.configureTestingModule({
      imports: [RegistrosComponent],
      providers: [
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const fixture = TestBed.createComponent(RegistrosComponent);
    fixture.componentRef.setInput('registros', registros);
    fixture.componentRef.setInput('mostrarPaciente', mostrarPaciente);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const texto = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim();

  /** El detalle abierto, montado por `MatDialog` fuera del fixture. */
  const detalle = () => document.querySelector('app-registro-detalle-dialogo');
  const estable = () => TestBed.inject(ApplicationRef).whenStable();
  const registroDe = (elemento: HTMLElement) => elemento.querySelector<HTMLElement>('.registro')!;
  const botonDe = (elemento: HTMLElement) =>
    elemento.querySelector<HTMLButtonElement>('.ver-detalle')!;
  const botonCerrar = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('mat-dialog-container button')).find(
      (candidato) => texto(candidato) === 'Cerrar',
    )!;

  /**
   * El botón cubre toda la tarjeta con su `::after`, así que pulsarlo equivale a
   * pulsar cualquier punto de la tarjeta (jsdom no hace hit-testing de `::after`).
   */
  const pulsarTarjeta = (elemento: HTMLElement) => botonDe(elemento).click();

  /**
   * Un `<button>` real se activa con Enter (al pulsar la tecla) y con Espacio (al
   * soltarla), y es entonces cuando el navegador dispara el `click`. jsdom no
   * implementa esa acción por defecto, así que aquí se reproduce con el mismo
   * orden de eventos; la activación real se comprueba en el navegador.
   */
  const activarConTeclado = (boton: HTMLButtonElement, tecla: 'Enter' | ' '): void => {
    boton.dispatchEvent(new KeyboardEvent('keydown', { key: tecla, bubbles: true }));
    if (tecla === 'Enter') {
      boton.click();
    }
    boton.dispatchEvent(new KeyboardEvent('keyup', { key: tecla, bubbles: true }));
    if (tecla === ' ') {
      boton.click();
    }
  };

  /** `MatDialog` filtra el cierre por `keyCode` (27), que jsdom no acepta en el init. */
  const escape = (): KeyboardEvent => {
    const evento = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    Object.defineProperty(evento, 'keyCode', { value: 27 });
    return evento;
  };

  afterEach(() => TestBed.inject(MatDialog).closeAll());

  it('muestra tipo, fecha sin convertir, contenido tal cual y autor', async () => {
    const elemento = await renderizar([signos]);

    expect(texto(elemento.querySelector('.tipo'))).toBe('Signos vitales');
    expect(texto(elemento.querySelector('time'))).toBe('06/10/2026 20:21');
    expect(elemento.querySelector('time')?.getAttribute('datetime')).toBe(signos.fecha);
    expect(texto(elemento.querySelector('.contenido'))).toBe(signos.contenido);
    expect(texto(elemento.querySelector('.autor'))).toBe('Luis Gil (ENF-0001) · Enfermero');
    expect(elemento.querySelector('.paciente')).toBeNull();
    expect(elemento.querySelector('.medicacion')).toBeNull();
  });

  it('indica el stock descontado en una medicación', async () => {
    const elemento = await renderizar([medicacion]);

    expect(texto(elemento.querySelector('.medicacion'))).toBe(
      'Descontó 2 unidades de MED-0001 del inventario.',
    );
  });

  it('en el historial general enlaza al historial del paciente', async () => {
    const elemento = await renderizar([signos], true);

    const enlace = elemento.querySelector<HTMLAnchorElement>('.paciente a')!;
    expect(texto(enlace)).toBe('Ana Ruiz (PAC-0001)');
    expect(enlace.getAttribute('href')).toBe('/pacientes/PAC-0001/historial');
  });

  it('no marca la tarjeta como botón y expone un botón «Ver detalle» accesible', async () => {
    const elemento = await renderizar([signos]);
    const tarjeta = registroDe(elemento);
    const boton = botonDe(elemento);

    expect(tarjeta.getAttribute('role')).toBeNull();
    expect(tarjeta.getAttribute('tabindex')).toBeNull();
    expect(boton.tagName).toBe('BUTTON');
    expect(boton.getAttribute('type')).toBe('button');
    expect(texto(boton)).toBe('Ver detalle del registro de Signos vitales');
  });

  it('abre el detalle al pulsar la tarjeta', async () => {
    const elemento = await renderizar([signos]);

    pulsarTarjeta(elemento);
    await estable();

    expect(detalle()).not.toBeNull();
    expect(texto(detalle()!.querySelector('.contenido'))).toBe(signos.contenido);
  });

  it('abre el detalle con Enter sobre el botón', async () => {
    const elemento = await renderizar([signos]);

    activarConTeclado(botonDe(elemento), 'Enter');
    await estable();

    expect(detalle()).not.toBeNull();
    expect(texto(detalle()!.querySelector('.contenido'))).toBe(signos.contenido);
  });

  it('abre el detalle con Espacio sobre el botón', async () => {
    const elemento = await renderizar([signos]);

    activarConTeclado(botonDe(elemento), ' ');
    await estable();

    expect(detalle()).not.toBeNull();
    expect(texto(detalle()!.querySelector('.contenido'))).toBe(signos.contenido);
  });

  it('cierra el detalle con el botón Cerrar', async () => {
    const elemento = await renderizar([signos]);

    pulsarTarjeta(elemento);
    await estable();

    botonCerrar().click();
    await estable();

    expect(detalle()).toBeNull();
  });

  it('cierra el detalle con Escape', async () => {
    const elemento = await renderizar([signos]);

    pulsarTarjeta(elemento);
    await estable();

    document.querySelector('mat-dialog-container')!.dispatchEvent(escape());
    await estable();

    expect(detalle()).toBeNull();
  });

  it('devuelve el foco al botón al cerrar el detalle', async () => {
    const elemento = await renderizar([signos]);
    const boton = botonDe(elemento);

    pulsarTarjeta(elemento);
    await estable();

    botonCerrar().click();
    await estable();

    expect(document.activeElement).toBe(boton);
  });

  it('el enlace al paciente navega a su historial y no abre el detalle', async () => {
    const elemento = await renderizar([signos], true);
    const enlace = elemento.querySelector<HTMLAnchorElement>('.paciente a')!;
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    enlace.click();
    await estable();

    expect(navegar).toHaveBeenCalledTimes(1);
    expect(detalle()).toBeNull();
  });

  it('en un registro sin medicación, el detalle no muestra esa sección', async () => {
    const elemento = await renderizar([signos]);

    pulsarTarjeta(elemento);
    await estable();

    expect(detalle()!.textContent).not.toContain('Medicamento');
  });

  it('el detalle muestra el contenido completo aunque la lista lo recorte', async () => {
    const contenido = 'Línea 1\nLínea 2\nLínea 3\nLínea 4';
    const elemento = await renderizar([{ ...signos, contenido }]);

    pulsarTarjeta(elemento);
    await estable();

    expect(detalle()!.querySelector('.contenido')?.textContent).toBe(contenido);
  });
});
