import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ApiError, mensajesDeError } from './api-error';

describe('ApiError.desde', () => {
  it('usa los mensajes del ErrorResponse del backend', () => {
    const error = ApiError.desde(
      new HttpErrorResponse({
        status: 400,
        error: { status: 400, error: 'Bad Request', mensajes: ['A.', 'B.'] },
      }),
    );

    expect(error.status).toBe(400);
    expect(error.mensajes).toEqual(['A.', 'B.']);
  });

  it('conserva los segundos del Retry-After de un 429', () => {
    const error = ApiError.desde(
      new HttpErrorResponse({
        status: 429,
        headers: new HttpHeaders({ 'Retry-After': '45' }),
        error: {
          status: 429,
          error: 'Too Many Requests',
          mensajes: ['Demasiados intentos.'],
        },
      }),
    );

    expect(error.status).toBe(429);
    expect(error.mensajes).toEqual(['Demasiados intentos.']);
    expect(error.retryAfterSegundos).toBe(45);
  });

  it.each([
    ['entero con espacios', ' 120 ', 120],
    ['por encima del tope', '7200', 3600],
    ['el tope exacto', '3600', 3600],
  ])('acepta el Retry-After %s', (_caso, cabecera, esperado) => {
    const error = ApiError.desde(
      new HttpErrorResponse({
        status: 429,
        headers: new HttpHeaders({ 'Retry-After': cabecera }),
      }),
    );

    expect(error.retryAfterSegundos).toBe(esperado);
  });

  it.each([
    ['sin cabecera', null],
    ['cero', '0'],
    ['negativo', '-5'],
    ['texto', 'pronto'],
    ['número con basura', '5abc'],
    ['fecha HTTP', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['vacío', '   '],
  ])('ignora el Retry-After %s', (_caso, cabecera) => {
    const error = ApiError.desde(
      new HttpErrorResponse({
        status: 429,
        headers: cabecera === null ? undefined : new HttpHeaders({ 'Retry-After': cabecera }),
      }),
    );

    expect(error.retryAfterSegundos).toBeUndefined();
  });

  it('también lo conserva si el cuerpo no es el ErrorResponse uniforme', () => {
    const error = ApiError.desde(
      new HttpErrorResponse({
        status: 503,
        headers: new HttpHeaders({ 'Retry-After': '30' }),
        error: null,
      }),
    );

    expect(error.mensajes).toEqual([
      'No se pudo conectar con el servidor. Compruebe su conexión y vuelva a intentarlo.',
    ]);
    expect(error.retryAfterSegundos).toBe(30);
  });

  it.each([502, 503])('conserva los mensajes del backend también en un %i', (status) => {
    const error = ApiError.desde(
      new HttpErrorResponse({
        status,
        error: {
          status,
          error: 'x',
          mensajes: ['El servicio de medicamentos no está disponible.'],
        },
      }),
    );

    expect(error.status).toBe(status);
    expect(error.mensajes).toEqual(['El servicio de medicamentos no está disponible.']);
  });

  it.each([
    ['estado 0 (sin red)', 0, null],
    ['502 vacío del proxy con el backend apagado', 502, null],
    ['504 con HTML de un intermediario', 504, '<html>Gateway Timeout</html>'],
    ['cuerpo con mensajes vacíos', 500, { status: 500, error: 'x', mensajes: [] }],
  ])('sin el cuerpo uniforme (%s) indica que no se pudo conectar', (_caso, status, cuerpo) => {
    const error = ApiError.desde(new HttpErrorResponse({ status, error: cuerpo }));

    expect(error.status).toBe(status);
    expect(error.mensajes).toEqual([
      'No se pudo conectar con el servidor. Compruebe su conexión y vuelva a intentarlo.',
    ]);
  });
});

describe('mensajesDeError', () => {
  it('devuelve los mensajes de un ApiError', () => {
    expect(mensajesDeError(new ApiError(409, ['Duplicado.']))).toEqual(['Duplicado.']);
  });

  it('devuelve un mensaje genérico para cualquier otro error', () => {
    expect(mensajesDeError(new Error('x'))).toEqual([
      'Se produjo un error inesperado. Vuelva a intentarlo más tarde.',
    ]);
  });
});
