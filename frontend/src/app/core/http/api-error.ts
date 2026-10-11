import { HttpErrorResponse } from '@angular/common/http';

/** Cuerpo de error uniforme de la API (`ErrorResponse` del backend). */
export interface ErrorResponse {
  status: number;
  error: string;
  mensajes: string[];
}

const MENSAJE_INESPERADO = 'Se produjo un error inesperado. Vuelva a intentarlo más tarde.';
const MENSAJE_SIN_CONEXION =
  'No se pudo conectar con el servidor. Compruebe su conexión y vuelva a intentarlo.';

/** Tope de espera que se respeta de un `Retry-After` desmedido (una hora). */
export const ESPERA_MAXIMA_SEGUNDOS = 3600;

/**
 * Error de una petición a la API ya normalizado: el estado HTTP y los mensajes
 * listos para mostrar. Es lo único que reciben los componentes al fallar una
 * petición (lo produce `errorInterceptor`).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly mensajes: readonly string[],
    /**
     * Segundos que pidió esperar el servidor (`Retry-After`, típico de un 429).
     * `undefined` si la respuesta no lo traía o no era un entero positivo.
     */
    readonly retryAfterSegundos?: number,
  ) {
    super(mensajes.join(' '));
    this.name = 'ApiError';
  }

  /**
   * El backend responde siempre con el `ErrorResponse` uniforme (incluso en
   * 502/503): sus mensajes se conservan tal cual. Sin ese cuerpo (estado 0,
   * o un 502/504 vacío del proxy de desarrollo con el backend apagado) la
   * respuesta no viene de la API, así que no se pudo conectar con ella.
   */
  static desde(respuesta: HttpErrorResponse): ApiError {
    const retryAfter = segundosDeRetryAfter(respuesta.headers.get('Retry-After'));
    if (esErrorResponse(respuesta.error) && respuesta.error.mensajes.length > 0) {
      return new ApiError(respuesta.status, respuesta.error.mensajes, retryAfter);
    }
    return new ApiError(respuesta.status, [MENSAJE_SIN_CONEXION], retryAfter);
  }
}

/**
 * `Retry-After` en segundos, acotado a {@link ESPERA_MAXIMA_SEGUNDOS}. El
 * estándar también admite una fecha HTTP, pero aquí no se usa: cualquier valor
 * que no sea un entero positivo (ausente, 0, negativo, texto, fecha) se ignora.
 */
function segundosDeRetryAfter(cabecera: string | null): number | undefined {
  const texto = cabecera?.trim();
  if (!texto || !/^\d+$/.test(texto)) {
    return undefined;
  }
  const segundos = Number(texto);
  return segundos > 0 ? Math.min(segundos, ESPERA_MAXIMA_SEGUNDOS) : undefined;
}

/** Mensajes para mostrar de cualquier error recibido en un `subscribe`. */
export function mensajesDeError(error: unknown): readonly string[] {
  return error instanceof ApiError ? error.mensajes : [MENSAJE_INESPERADO];
}

function esErrorResponse(cuerpo: unknown): cuerpo is ErrorResponse {
  const mensajes = (cuerpo as Partial<ErrorResponse> | null)?.mensajes;
  return Array.isArray(mensajes) && mensajes.every((m) => typeof m === 'string');
}
