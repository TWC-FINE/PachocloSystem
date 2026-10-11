import { FuenteAleatoria, generarUuid } from './uuid';

/** Formato que valida el backend para `Idempotency-Key`. */
const FORMATO_BACKEND = /^[A-Za-z0-9_-]{16,100}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generarUuid', () => {
  it('usa crypto.randomUUID cuando existe', () => {
    const randomUUID = vi.fn(() => '8f14e45f-ceea-4672-a5b1-7a0c3c9e2f01' as const);
    const getRandomValues = vi.fn();
    const fuente = { randomUUID, getRandomValues } as unknown as FuenteAleatoria;

    expect(generarUuid(fuente)).toBe('8f14e45f-ceea-4672-a5b1-7a0c3c9e2f01');
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('por defecto usa el crypto del navegador', () => {
    expect(generarUuid()).toMatch(UUID_V4);
  });

  it('las claves del generador por defecto cumplen el formato que exige el backend', () => {
    const claves = Array.from({ length: 200 }, () => generarUuid());

    for (const clave of claves) {
      expect(clave).toMatch(FORMATO_BACKEND);
    }
    expect(new Set(claves).size).toBe(claves.length);
  });

  describe('sin randomUUID (contexto HTTP no seguro)', () => {
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto));
    const sinRandomUUID: FuenteAleatoria = {
      getRandomValues: getRandomValues as Crypto['getRandomValues'],
    };

    it('arma un UUID v4 con getRandomValues que cumple el formato del backend', () => {
      const claves = Array.from({ length: 200 }, () => generarUuid(sinRandomUUID));

      for (const clave of claves) {
        expect(clave).toMatch(UUID_V4);
        expect(clave).toMatch(FORMATO_BACKEND);
      }
      expect(new Set(claves).size).toBe(claves.length);
      expect(getRandomValues).toHaveBeenCalledTimes(200);
    });

    it.each([
      ['todo a cero', 0x00, '00000000-0000-4000-8000-000000000000'],
      ['todo a uno', 0xff, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
    ])('fija los bits de versión y variante (%s)', (_caso, byte, esperado) => {
      const fija: FuenteAleatoria = {
        getRandomValues: ((array: Uint8Array) => array.fill(byte)) as Crypto['getRandomValues'],
      };

      expect(generarUuid(fija)).toBe(esperado);
    });
  });
});
