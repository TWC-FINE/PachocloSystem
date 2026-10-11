import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { CABECERA_IDEMPOTENCIA } from '../../shared/idempotencia';
import { FiltroHistorial, Registro, RegistroRequest } from './historial.models';

/** Cabecera con la que el backend reconoce la repetición de un mismo alta. */
export { CABECERA_IDEMPOTENCIA };

/** Acceso al historial clínico. Los errores llegan como `ApiError` (errorInterceptor). */
/**
 * El backend devuelve el historial del más antiguo al más reciente; se muestra
 * al revés. `fecha` es "AAAA-MM-DDTHH:mm:ss.fffffff" sin zona: como texto se
 * ordena igual que como fecha (un segundo sin decimales va antes que con
 * ellos), así que no hace falta pasar por `Date`. El orden es estable.
 */
function masRecientesPrimero(registros: Registro[]): Registro[] {
  // Comparación por código de carácter, no localeCompare: no depende del idioma.
  return [...registros].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
}

@Injectable({ providedIn: 'root' })
export class HistorialService {
  private readonly http = inject(HttpClient);

  /** Todos los registros, del más reciente al más antiguo; `texto` busca según `filtro`. */
  listar(filtro: FiltroHistorial, texto = ''): Observable<Registro[]> {
    let params = new HttpParams().set('filtro', filtro);
    if (texto.trim()) {
      params = params.set('q', texto.trim());
    }
    return this.http.get<Registro[]>('/api/historial', { params }).pipe(map(masRecientesPrimero));
  }

  /** Registros de un paciente, del más reciente al más antiguo; `texto` filtra por autor. */
  listarDePaciente(idPaciente: string, texto = ''): Observable<Registro[]> {
    const q = texto.trim();
    return this.http
      .get<Registro[]>(this.url(idPaciente), { params: q ? new HttpParams().set('q', q) : {} })
      .pipe(map(masRecientesPrimero));
  }

  /**
   * Crea un registro. Si descuenta stock, el backend hace antes la salida en
   * MedicamentosService y, si falla, no guarda el registro.
   *
   * `claveIdempotencia` va en la cabecera `Idempotency-Key` (solo en esta
   * petición): repetirla con la misma clave y el mismo cuerpo devuelve el mismo
   * registro (201 con `Idempotency-Replayed: true`, que es un alta normal) sin
   * crear otro ni descontar dos veces. Ver el README del backend, "Registros
   * idempotentes".
   */
  crear(
    idPaciente: string,
    registro: RegistroRequest,
    claveIdempotencia: string,
  ): Observable<Registro> {
    return this.http.post<Registro>(this.url(idPaciente), registro, {
      headers: { [CABECERA_IDEMPOTENCIA]: claveIdempotencia },
    });
  }

  private url(idPaciente: string): string {
    return `/api/pacientes/${encodeURIComponent(idPaciente)}/historial`;
  }
}
