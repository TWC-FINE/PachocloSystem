import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CABECERA_IDEMPOTENCIA } from '../../shared/idempotencia';
import { DatosMedicamento } from './medicamento.models';
import { MedicamentoService } from './medicamento.service';

describe('MedicamentoService', () => {
  let servicio: MedicamentoService;
  let http: HttpTestingController;
  const datos: DatosMedicamento = {
    nombre: 'Dolex',
    principioActivo: 'Paracetamol',
    presentacion: 'TABLETA',
    concentracion: '500 mg',
    laboratorio: 'GSK',
    lote: 'L-1',
    stockMinimo: 10,
    fechaVencimiento: '2027-01-31',
    ubicacion: 'Estante A',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servicio = TestBed.inject(MedicamentoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista con filtro recortado y omite el filtro en blanco', () => {
    servicio.listar(' dolex ').subscribe();
    servicio.listar(' ').subscribe();

    http.expectOne('/api/medicamentos?q=dolex').flush([]);
    http.expectOne('/api/medicamentos').flush([]);
  });

  it('consulta stock bajo, por vencer con días y vencidos', () => {
    servicio.listarStockBajo().subscribe();
    servicio.listarPorVencer(15).subscribe();
    servicio.listarVencidos().subscribe();

    http.expectOne('/api/medicamentos/stock-bajo').flush([]);
    http.expectOne('/api/medicamentos/por-vencer?dias=15').flush([]);
    http.expectOne('/api/medicamentos/vencidos').flush([]);
  });

  it('registra con el stock inicial y edita sin stock, con la fecha como texto', () => {
    servicio.registrar({ ...datos, cantidadStock: 100 }).subscribe();
    servicio.editar('MED-0001', datos).subscribe();

    const alta = http.expectOne((r) => r.method === 'POST' && r.url === '/api/medicamentos');
    expect(alta.request.body).toEqual({ ...datos, cantidadStock: 100 });
    alta.flush({});
    const edicion = http.expectOne('/api/medicamentos/MED-0001');
    expect(edicion.request.method).toBe('PUT');
    expect(edicion.request.body).toEqual(datos);
    expect(edicion.request.body.fechaVencimiento).toBe('2027-01-31');
    edicion.flush({});
  });

  it('elimina con DELETE', () => {
    servicio.eliminar('MED-0001').subscribe();

    const peticion = http.expectOne('/api/medicamentos/MED-0001');
    expect(peticion.request.method).toBe('DELETE');
    peticion.flush(null, { status: 204, statusText: 'No Content' });
  });

  it.each([
    ['entrada', '/api/medicamentos/MED-0001/entradas'],
    ['salida', '/api/medicamentos/MED-0001/salidas'],
  ] as const)('registra una %s de stock', (tipo, url) => {
    servicio.moverStock('MED-0001', tipo, 5).subscribe();

    const peticion = http.expectOne(url);
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({ cantidad: 5 });
    peticion.flush({});
  });

  it('las salidas con clave llevan la cabecera de idempotencia', () => {
    servicio.moverStock('MED-0001', 'salida', 5, 'clave-de-prueba').subscribe();

    const peticion = http.expectOne('/api/medicamentos/MED-0001/salidas');
    expect(peticion.request.headers.get(CABECERA_IDEMPOTENCIA)).toBe('clave-de-prueba');
    peticion.flush({});
  });

  it('sin clave, la salida no lleva la cabecera', () => {
    servicio.moverStock('MED-0001', 'salida', 5).subscribe();

    const peticion = http.expectOne('/api/medicamentos/MED-0001/salidas');
    expect(peticion.request.headers.has(CABECERA_IDEMPOTENCIA)).toBe(false);
    peticion.flush({});
  });

  it('nunca envía la cabecera en /entradas, que no la acepta', () => {
    servicio.moverStock('MED-0001', 'entrada', 5, 'clave-de-prueba').subscribe();

    const peticion = http.expectOne('/api/medicamentos/MED-0001/entradas');
    expect(peticion.request.headers.has(CABECERA_IDEMPOTENCIA)).toBe(false);
    peticion.flush({});
  });
});
