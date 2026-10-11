import { ApiError } from '../core/http/api-error';
import { generarUuid } from './uuid';

/**
 * Piezas comunes a las operaciones que la API sabe repetir sin duplicar efectos:
 * la clave `Idempotency-Key` de cada intento y el criterio para saber cuándo el
 * resultado de una petición quedó en el aire.
 *
 * `registro-dialogo` (historial) todavía guarda sus propias copias de la clave y
 * del criterio; se unificarán cuando se apruebe el refactor de ese diálogo.
 */

/** Cabecera con la que el backend reconoce la repetición de una misma petición. */
export const CABECERA_IDEMPOTENCIA = 'Idempotency-Key';

/**
 * Resultado de un diálogo que no puede confirmar si la operación llegó a
 * aplicarse: quien lo abrió debería recargar antes de dar nada por hecho.
 */
export const SIN_CONFIRMAR = 'sin-confirmar';

/**
 * Clave `Idempotency-Key` de un intento: la misma en sus reintentos (dobles
 * clics, errores de red, 5xx), nueva para cada operación distinta. El UUID v4 de
 * `generarUuid` cumple el formato que exige el backend (16 a 100 caracteres:
 * letras sin tilde, dígitos, guion o guion bajo).
 */
export function nuevaClaveIdempotencia(): string {
  return generarUuid();
}

/**
 * Errores tras los que no se sabe si la petición llegó a aplicarse: sin respuesta
 * de la API (red o proxy: estado 0 o 5xx sin cuerpo), cualquier 5xx o un error
 * que ni siquiera es HTTP. Los 4xx son definitivos: el backend no aplicó nada y
 * no consumió la clave.
 */
export function esResultadoIncierto(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}
