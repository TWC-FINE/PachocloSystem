import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Observable, Subject, of, throwError } from 'rxjs';
import { Permiso, PermisosService, tienePermiso } from '../../../core/permisos';
import { Rol } from '../../../core/roles';
import { ApiError } from '../../../core/http/api-error';
import { NotificacionService } from '../../../core/notificacion.service';
import { SIN_CONFIRMAR } from '../../../shared/idempotencia';
import { ESPERA_BUSQUEDA_MS } from '../../../shared/listas';
import { Medicamento } from '../medicamento.models';
import { MedicamentoService } from '../medicamento.service';
import { MovimientoDialogoComponent } from '../movimiento-dialogo/movimiento-dialogo.component';
import { MedicamentosListaComponent } from './medicamentos-lista.component';

/** Texto de una celda; si tiene varios `span` (línea secundaria, insignias), separados por espacio. */
function textoCelda(celda: Element): string {
  const partes = Array.from(celda.querySelectorAll('span'));
  const textos = partes.length > 0 ? partes.map((p) => p.textContent) : [celda.textContent];
  return textos
    .map((t) => (t ?? '').replace(/\s+/g, ' ').trim())
    .join(' ')
    .trim();
}

describe('MedicamentosListaComponent', () => {
  /** Rol de los permisos simulados; ADMIN (todo) salvo en los tests de rol. */
  let rol: Rol = 'ADMIN';
  const dolex: Medicamento = {
    idMedicamento: 'MED-0001',
    nombre: 'Dolex',
    principioActivo: 'Paracetamol',
    presentacion: 'TABLETA',
    concentracion: '500 mg',
    laboratorio: 'GSK',
    lote: 'L-1',
    cantidadStock: 5,
    stockMinimo: 10,
    fechaVencimiento: '2026-01-01',
    ubicacion: 'Estante A',
    stockBajo: true,
    vencido: true,
  };
  const amoxil: Medicamento = {
    ...dolex,
    idMedicamento: 'MED-0002',
    nombre: 'Amoxil',
    principioActivo: 'Amoxicilina',
    presentacion: 'SUSPENSION',
    concentracion: '250 mg/5 ml',
    cantidadStock: 40,
    fechaVencimiento: '2027-01-31',
    stockBajo: false,
    vencido: false,
  };
  const caido = () =>
    throwError(
      () =>
        new ApiError(503, [
          'El servicio de medicamentos no está disponible. Vuelva a intentarlo más tarde.',
        ]),
    );

  const servicio = {
    listar: vi.fn<(q?: string) => Observable<Medicamento[]>>(),
    listarStockBajo: vi.fn<() => Observable<Medicamento[]>>(),
    listarPorVencer: vi.fn<(dias: number) => Observable<Medicamento[]>>(),
    listarVencidos: vi.fn<() => Observable<Medicamento[]>>(),
    eliminar: vi.fn<(id: string) => Observable<void>>(),
  };
  const dialogo = { open: vi.fn() };
  const notificaciones = { exito: vi.fn(), error: vi.fn() };
  const alCerrarDialogo = (resultado: unknown) =>
    dialogo.open.mockReturnValueOnce({ afterClosed: () => of(resultado) });

  async function renderizar() {
    TestBed.configureTestingModule({
      imports: [MedicamentosListaComponent],
      providers: [
        { provide: MedicamentoService, useValue: servicio },
        { provide: MatDialog, useValue: dialogo },
        { provide: NotificacionService, useValue: notificaciones },
        { provide: PermisosService, useValue: { puede: (p: Permiso) => tienePermiso(rol, p) } },
      ],
    });
    const fixture = TestBed.createComponent(MedicamentosListaComponent);
    await fixture.whenStable();
    const elemento = fixture.nativeElement as HTMLElement;
    const estable = () => fixture.whenStable();
    return {
      elemento,
      estable,
      filas: () =>
        Array.from(elemento.querySelectorAll('tr[mat-row]')).map((f) =>
          Array.from(f.querySelectorAll('td')).slice(0, 6).map(textoCelda),
        ),
      pestana: async (etiqueta: string) => {
        Array.from(elemento.querySelectorAll<HTMLElement>('[mat-tab-link]'))
          .find((p) => p.textContent?.trim() === etiqueta)!
          .click();
        await estable();
      },
      boton: (etiqueta: string) =>
        elemento.querySelector<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`)!,
      escribir: async (selector: string, valor: string) => {
        const input = elemento.querySelector<HTMLInputElement>(selector)!;
        input.value = valor;
        input.dispatchEvent(new Event('input'));
        await new Promise((r) => setTimeout(r, ESPERA_BUSQUEDA_MS + 50));
        await estable();
      },
      aviso: () => elemento.querySelector('.aviso-servicio'),
      textoEstado: () => elemento.querySelector('.lista-estado')?.textContent?.trim(),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    rol = 'ADMIN';
    servicio.listar.mockReturnValue(of([dolex, amoxil]));
  });

  it('muestra los medicamentos con la fecha sin desplazar e insignias de estado', async () => {
    const { filas } = await renderizar();

    expect(servicio.listar).toHaveBeenCalledWith('');
    expect(filas()).toEqual([
      [
        'MED-0001',
        'Dolex 500 mg Paracetamol · Tableta · GSK',
        'L-1 Estante A',
        '5 mín. 10',
        '01/01/2026',
        'Vencido Stock bajo',
      ],
      [
        'MED-0002',
        'Amoxil 250 mg/5 ml Amoxicilina · Suspensión · GSK',
        'L-1 Estante A',
        '40 mín. 10',
        '31/01/2027',
        '',
      ],
    ]);
  });

  it('el enfermero solo ve las salidas de stock', async () => {
    rol = 'ENFERMERO';
    const { elemento, boton } = await renderizar();

    expect(elemento.querySelector('.lista-encabezado button')).toBeNull();
    expect(boton('Salida de stock de Dolex 500 mg')).not.toBeNull();
    expect(boton('Entrada de stock de Dolex 500 mg')).toBeNull();
    expect(boton('Editar Dolex 500 mg')).toBeNull();
    expect(boton('Eliminar Dolex 500 mg')).toBeNull();
  });

  it('el doctor solo consulta: sin alta ni columna de acciones', async () => {
    rol = 'DOCTOR';
    const { elemento, filas } = await renderizar();

    expect(filas()).toHaveLength(2);
    expect(elemento.querySelector('.lista-encabezado button')).toBeNull();
    expect(elemento.querySelector('.celda-acciones')).toBeNull();
  });

  it('busca en el servidor desde la pestaña Todos', async () => {
    const { escribir, textoEstado } = await renderizar();
    servicio.listar.mockReturnValue(of([]));

    await escribir('input[type="search"]', 'zz');

    expect(servicio.listar).toHaveBeenLastCalledWith('zz');
    expect(textoEstado()).toBe('Ningún medicamento coincide con «zz».');
  });

  it('las pestañas consultan stock bajo y vencidos, sin mostrar datos de la anterior', async () => {
    const respuestaStockBajo = new Subject<Medicamento[]>();
    servicio.listarStockBajo.mockReturnValue(respuestaStockBajo);
    servicio.listarVencidos.mockReturnValue(of([]));
    const { pestana, filas, estable, textoEstado } = await renderizar();

    await pestana('Stock bajo');
    expect(servicio.listarStockBajo).toHaveBeenCalled();
    expect(filas()).toEqual([]);

    respuestaStockBajo.next([dolex]);
    await estable();
    expect(filas().map((f) => f[0])).toEqual(['MED-0001']);

    await pestana('Vencidos');
    expect(textoEstado()).toBe('No hay medicamentos vencidos.');
  });

  it('por vencer pide 30 días por defecto y vuelve a consultar al cambiarlos', async () => {
    servicio.listarPorVencer.mockReturnValue(of([]));
    const { pestana, escribir, textoEstado } = await renderizar();

    await pestana('Por vencer');
    expect(servicio.listarPorVencer).toHaveBeenLastCalledWith(30);
    expect(textoEstado()).toBe('Ningún medicamento vence en los próximos 30 días.');

    await escribir('input[type="number"]', '7');
    expect(servicio.listarPorVencer).toHaveBeenLastCalledWith(7);
  });

  it('no consulta con días fuera de 1 a 365 y lo indica', async () => {
    servicio.listarPorVencer.mockReturnValue(of([]));
    const { elemento, pestana, escribir } = await renderizar();
    await pestana('Por vencer');
    const input = elemento.querySelector<HTMLInputElement>('input[type="number"]')!;

    await escribir('input[type="number"]', '400');
    input.dispatchEvent(new Event('blur'));
    await new Promise((r) => setTimeout(r));

    expect(servicio.listarPorVencer).toHaveBeenCalledTimes(1);
    expect(elemento.querySelector('mat-error')?.textContent?.trim()).toBe(
      'Los días deben ser un entero entre 1 y 365.',
    );
  });

  it('si el servicio de medicamentos cae, avisa sin bloquear y conserva lo ya cargado', async () => {
    const { pestana, escribir, aviso, filas, estable } = await renderizar();
    servicio.listar.mockReturnValueOnce(caido());

    await escribir('input[type="search"]', 'amo');

    expect(aviso()?.textContent).toContain('El servicio de medicamentos no está disponible.');
    expect(filas()).toHaveLength(2);

    servicio.listarVencidos.mockReturnValue(of([dolex]));
    await pestana('Vencidos');
    expect(aviso()).toBeNull();
    expect(filas()).toHaveLength(1);

    servicio.listarVencidos.mockReturnValueOnce(caido()).mockReturnValueOnce(of([]));
    await pestana('Todos');
    await pestana('Vencidos');
    expect(aviso()).not.toBeNull();
    aviso()!.querySelector('button')!.click();
    await estable();
    expect(aviso()).toBeNull();
  });

  it('una salida abre el diálogo de movimiento y al cerrarse avisa y recarga', async () => {
    alCerrarDialogo({ ...amoxil, cantidadStock: 30 });
    const { boton, estable } = await renderizar();

    boton('Salida de stock de Amoxil 250 mg/5 ml').click();
    await estable();

    expect(dialogo.open).toHaveBeenCalledWith(
      MovimientoDialogoComponent,
      expect.objectContaining({ data: { medicamento: amoxil, tipo: 'salida' } }),
    );
    expect(notificaciones.exito).toHaveBeenCalledWith(
      'Salida registrada: Amoxil 250 mg/5 ml queda con 30 unidades.',
    );
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  it('si la salida queda sin confirmar no avisa de éxito, pero recarga por si se aplicó', async () => {
    alCerrarDialogo(SIN_CONFIRMAR);
    const { boton, estable } = await renderizar();

    boton('Salida de stock de Amoxil 250 mg/5 ml').click();
    await estable();

    expect(notificaciones.exito).not.toHaveBeenCalled();
    expect(notificaciones.error).not.toHaveBeenCalled();
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  // '' es lo que devolvía «Cancelar» con `mat-dialog-close` sin valor.
  for (const cerrado of [undefined, '']) {
    it(`cerrar la entrada sin registrar (${JSON.stringify(cerrado)}) no avisa ni recarga`, async () => {
      alCerrarDialogo(cerrado);
      const { boton, estable } = await renderizar();

      boton('Entrada de stock de Amoxil 250 mg/5 ml').click();
      await estable();

      expect(notificaciones.exito).not.toHaveBeenCalled();
      expect(servicio.listar).toHaveBeenCalledTimes(1);
    });

    it(`cerrar la edición sin guardar (${JSON.stringify(cerrado)}) no avisa ni recarga`, async () => {
      alCerrarDialogo(cerrado);
      const { boton, estable } = await renderizar();

      boton('Editar Amoxil 250 mg/5 ml').click();
      await estable();

      expect(notificaciones.exito).not.toHaveBeenCalled();
      expect(servicio.listar).toHaveBeenCalledTimes(1);
    });
  }

  it('al eliminar, un 404 se muestra como mensaje y la lista se recarga', async () => {
    servicio.eliminar.mockReturnValue(
      throwError(() => new ApiError(404, ['No se encontró el medicamento MED-0001.'])),
    );
    alCerrarDialogo(true);
    const { boton, estable } = await renderizar();

    boton('Eliminar Dolex 500 mg').click();
    await estable();

    expect(dialogo.open.mock.calls[0][1].data.mensaje).toContain('(MED-0001, lote L-1)');
    expect(notificaciones.error).toHaveBeenCalledWith(['No se encontró el medicamento MED-0001.']);
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });
});
