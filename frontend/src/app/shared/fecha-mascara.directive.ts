import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/*
 * Máscara "dd/mm/aaaa" del campo de fecha del `mat-datepicker`: solo deja
 * teclear dígitos e inserta las "/" al vuelo. Es el mismo formato que muestra
 * y espera `FechaIsoAdapter` (ver shared/fecha-adapter.ts), así lo que se ve y
 * lo que se guarda no se separan.
 */

/** Dígitos de una fecha completa: ddmmaaaa. */
const DIGITOS_FECHA = 8;
/** Longitud de "dd/mm/aaaa". */
const LONGITUD = 10;

/**
 * Reagrupa en "dd/mm/aaaa" los dígitos de lo que se lleve tecleado:
 * `"12321"` → `"12/32/1"`, `"12032027"` → `"12/03/2027"`,
 * `"12/03/2027"` → igual. Ignora lo que no sean dígitos y corta a 8.
 */
export function enmascararFecha(texto: string): string {
  const digitos = texto.replace(/\D/g, '').slice(0, DIGITOS_FECHA);
  return [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4)]
    .filter((parte) => parte !== '')
    .join('/');
}

/**
 * Posición del cursor contando solo dígitos: así no salta cuando la máscara
 * añade o quita una "/" por delante de él (p. ej. al borrar una "/").
 */
function posicionDelCursor(escrito: string, cursor: number, enmascarado: string): number {
  const digitosDelante = escrito.slice(0, cursor).replace(/\D/g, '').length;
  let indice = 0;
  for (let vistos = 0; indice < enmascarado.length && vistos < digitosDelante; indice++) {
    if (/\d/.test(enmascarado[indice])) {
      vistos++;
    }
  }
  return indice;
}

/**
 * Máscara del campo "Fecha de vencimiento" del `mat-datepicker`. Se apoya en el
 * suceso `input` (teclado y pegado entran por el mismo sitio) y no toca el valor
 * que escribe el calendario por su cuenta: eso no dispara `input`.
 */
@Directive({
  selector: 'input[appFechaDdMmAaaa]',
  host: {
    // Teclado numérico en móvil y tope de "dd/mm/aaaa" en el propio campo.
    '[attr.inputmode]': 'inputmode',
    '[attr.maxlength]': 'longitud',
  },
})
export class FechaMascaraDirectiva {
  private readonly elemento = inject<ElementRef<HTMLInputElement>>(ElementRef);

  readonly inputmode = 'numeric';
  readonly longitud = LONGITUD;

  @HostListener('input')
  alEscribir(): void {
    const input = this.elemento.nativeElement;
    const escrito = input.value;
    const enmascarado = enmascararFecha(escrito);
    if (enmascarado === escrito) {
      return;
    }
    const cursor = input.selectionStart ?? escrito.length;
    input.value = enmascarado;
    const posicion = posicionDelCursor(escrito, cursor, enmascarado);
    input.setSelectionRange(posicion, posicion);
    /*
     * El texto ya está enmascarado en el DOM, pero `MatDatepickerInput` puede
     * haber leído el suceso antes que esta máscara (p. ej. al pegar "12032027")
     * y haberse quedado con lo tecleado. Repetir el suceso se lo hace releer ya
     * enmascarado; no se repite más veces porque la máscara es idempotente.
     */
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
