import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CABECERA_IDEMPOTENCIA } from '../../shared/idempotencia';
import {
  DatosMedicamento,
  Medicamento,
  MedicamentoRequest,
  TipoMovimiento,
} from './medicamento.models';

const URL = '/api/medicamentos';

/**
 * Acceso a `/api/medicamentos` del servicio principal, que reenvía a
 * MedicamentosService (nunca se llama a este directamente). Si está caído
 * llega un `ApiError` 503 (o 502) con el mensaje del backend.
 */
@Injectable({ providedIn: 'root' })
export class MedicamentoService {
  private readonly http = inject(HttpClient);

  /** `texto` filtra por id, nombre o principio activo en el servidor. */
  listar(texto = ''): Observable<Medicamento[]> {
    const q = texto.trim();
    return this.http.get<Medicamento[]>(URL, { params: q ? new HttpParams().set('q', q) : {} });
  }

  listarStockBajo(): Observable<Medicamento[]> {
    return this.http.get<Medicamento[]>(`${URL}/stock-bajo`);
  }

  /** No vencidos que vencen en los próximos `dias` (1–365). */
  listarPorVencer(dias: number): Observable<Medicamento[]> {
    return this.http.get<Medicamento[]>(`${URL}/por-vencer`, {
      params: new HttpParams().set('dias', dias),
    });
  }

  listarVencidos(): Observable<Medicamento[]> {
    return this.http.get<Medicamento[]>(`${URL}/vencidos`);
  }

  registrar(datos: MedicamentoRequest): Observable<Medicamento> {
    return this.http.post<Medicamento>(URL, datos);
  }

  /** Edita los datos; el stock no se puede editar (solo entradas y salidas). */
  editar(id: string, datos: DatosMedicamento): Observable<Medicamento> {
    return this.http.put<Medicamento>(`${URL}/${encodeURIComponent(id)}`, datos);
  }

  eliminar(id: string): Observable<void> {
    return this.http.delete<void>(`${URL}/${encodeURIComponent(id)}`);
  }

  /**
   * Suma (`entrada`) o resta (`salida`) unidades; una salida falla si no alcanza
   * o está vencido.
   *
   * `claveIdempotencia` se envía **solo en las salidas**, el único movimiento que
   * el backend sabe repetir sin descuadrar el stock (`/entradas` no acepta la
   * cabecera): repetir la petición con la misma clave y la misma cantidad
   * devuelve la respuesta de la primera vez sin volver a descontar.
   */
  moverStock(
    id: string,
    tipo: TipoMovimiento,
    cantidad: number,
    claveIdempotencia?: string,
  ): Observable<Medicamento> {
    const ruta = tipo === 'entrada' ? 'entradas' : 'salidas';
    const cabecera =
      ruta === 'salidas' && claveIdempotencia
        ? { headers: { [CABECERA_IDEMPOTENCIA]: claveIdempotencia } }
        : {};
    return this.http.post<Medicamento>(
      `${URL}/${encodeURIComponent(id)}/${ruta}`,
      { cantidad },
      cabecera,
    );
  }
}
