import { Injectable, Provider } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, MatDateFormats } from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';

/*
 * Fecha del `mat-datepicker` como **texto** "AAAA-MM-DD": el mismo valor que el
 * formulario ya enviaba al backend (`LocalDate`) y que se guarda en el control.
 * Nunca se pasa por `Date`, así el día no se desplaza por la zona horaria (ver
 * shared/fechas.ts) y el payload no cambia. En pantalla se ve "dd/mm/aaaa" y la
 * semana empieza en lunes.
 */

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const FECHA_ES = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Valor de `invalid()`: no es un texto ISO, así `getValidDateOrNull` lo descarta. */
const INVALIDA = 'fecha-invalida';

const MESES_LARGOS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];
const MESES_INICIALES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Índice 0 = domingo, como espera `getDayOfWeekNames`. */
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_INICIALES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function dosDigitos(numero: number): string {
  return numero < 10 ? `0${numero}` : String(numero);
}

/** Día de la semana (0 = domingo) por congruencia de Sakamoto: solo enteros, sin `Date`. */
function diaDeLaSemana(anio: number, mes0: number, dia: number): number {
  const desplazamiento = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const ajustado = mes0 < 2 ? anio - 1 : anio;
  return (
    (ajustado +
      Math.floor(ajustado / 4) -
      Math.floor(ajustado / 100) +
      Math.floor(ajustado / 400) +
      desplazamiento[mes0] +
      dia) %
    7
  );
}

function bisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

function diasDelMes(anio: number, mes0: number): number {
  return [31, bisiesto(anio) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes0];
}

/** Días desde 1970-01-01 (algoritmo civil de Hinnant: solo enteros, sin zona horaria). */
function aDiasEpoch(anio: number, mes0: number, dia: number): number {
  const mes1 = mes0 + 1;
  const ajustado = mes1 <= 2 ? anio - 1 : anio;
  const era = Math.floor(ajustado / 400);
  const anioDeEra = ajustado - era * 400;
  const diaDelAnio = Math.floor((153 * (mes1 + (mes1 > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const diaDeEra =
    anioDeEra * 365 + Math.floor(anioDeEra / 4) - Math.floor(anioDeEra / 100) + diaDelAnio;
  return era * 146097 + diaDeEra - 719468;
}

/** Inversa de `aDiasEpoch` (devuelve el mes 0-11). */
function deDiasEpoch(dias: number): { anio: number; mes0: number; dia: number } {
  const desplazado = dias + 719468;
  const era = Math.floor(desplazado / 146097);
  const diaDeEra = desplazado - era * 146097;
  const anioDeEra = Math.floor(
    (diaDeEra -
      Math.floor(diaDeEra / 1460) +
      Math.floor(diaDeEra / 36524) -
      Math.floor(diaDeEra / 146096)) /
      365,
  );
  const anio = anioDeEra + era * 400;
  const diaDelAnio =
    diaDeEra - (365 * anioDeEra + Math.floor(anioDeEra / 4) - Math.floor(anioDeEra / 100));
  const mesParcial = Math.floor((5 * diaDelAnio + 2) / 153);
  const dia = diaDelAnio - Math.floor((153 * mesParcial + 2) / 5) + 1;
  const mes1 = mesParcial + (mesParcial < 10 ? 3 : -9);
  return { anio: mes1 <= 2 ? anio + 1 : anio, mes0: mes1 - 1, dia };
}

/**
 * `DateAdapter` del `mat-datepicker` cuyo valor es el texto "AAAA-MM-DD" (nunca
 * un `Date`). Se usa en vez del `NativeDateAdapter` por defecto.
 */
@Injectable()
export class FechaIsoAdapter extends DateAdapter<string> {
  constructor() {
    super();
    // La app es solo en español: las etiquetas van fijas, sin `MAT_DATE_LOCALE`.
    super.setLocale('es-ES');
  }

  getYear(fecha: string): number {
    return Number(fecha.slice(0, 4));
  }

  getMonth(fecha: string): number {
    return Number(fecha.slice(5, 7)) - 1;
  }

  getDate(fecha: string): number {
    return Number(fecha.slice(8, 10));
  }

  getDayOfWeek(fecha: string): number {
    return diaDeLaSemana(this.getYear(fecha), this.getMonth(fecha), this.getDate(fecha));
  }

  getMonthNames(estilo: 'long' | 'short' | 'narrow'): string[] {
    return estilo === 'long' ? MESES_LARGOS : estilo === 'short' ? MESES_CORTOS : MESES_INICIALES;
  }

  getDateNames(): string[] {
    return Array.from({ length: 31 }, (_valor, indice) => String(indice + 1));
  }

  getDayOfWeekNames(estilo: 'long' | 'short' | 'narrow'): string[] {
    return estilo === 'long' ? DIAS_LARGOS : estilo === 'short' ? DIAS_CORTOS : DIAS_INICIALES;
  }

  getYearName(fecha: string): string {
    return String(this.getYear(fecha));
  }

  /** Lunes, como en España. */
  getFirstDayOfWeek(): number {
    return 1;
  }

  getNumDaysInMonth(fecha: string): number {
    return diasDelMes(this.getYear(fecha), this.getMonth(fecha));
  }

  /** Los textos son inmutables: no hace falta copia. */
  clone(fecha: string): string {
    return fecha;
  }

  createDate(anio: number, mes0: number, dia: number): string {
    return `${anio}-${dosDigitos(mes0 + 1)}-${dosDigitos(dia)}`;
  }

  today(): string {
    const ahora = new Date();
    return this.createDate(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  }

  /**
   * Lo llama el `mat-datepicker` con el texto que se teclea. Vacío → `null`
   * (campo sin rellenar, como `deserialize`); texto que no es una fecha real →
   * `invalid()`, para que el datepicker marque el error de formato
   * (`matDatepickerParse`). Con `null` lo tomaría por un campo vacío y no
   * avisaría de nada.
   */
  parse(valor: unknown): string | null {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }
    return this._normalizar(valor) ?? this.invalid();
  }

  format(fecha: string, formato: unknown): string {
    if (!this.isValid(fecha)) {
      return '';
    }
    const anio = this.getYear(fecha);
    const dia = dosDigitos(this.getDate(fecha));
    const mes0 = this.getMonth(fecha);
    switch (formato) {
      case 'dd/mm/aaaa':
        return `${dia}/${dosDigitos(mes0 + 1)}/${anio}`;
      case 'MMM':
        return MESES_CORTOS[mes0];
      case 'MMMM yyyy':
        return `${MESES_LARGOS[mes0]} ${anio}`;
      case 'dd MMMM yyyy':
        return `${dia} de ${MESES_LARGOS[mes0]} de ${anio}`;
      default:
        return fecha;
    }
  }

  addCalendarYears(fecha: string, anios: number): string {
    return this.addCalendarMonths(fecha, anios * 12);
  }

  addCalendarMonths(fecha: string, meses: number): string {
    const total = this.getYear(fecha) * 12 + this.getMonth(fecha) + meses;
    const anio = Math.floor(total / 12);
    const mes0 = total - anio * 12;
    const dia = Math.min(this.getDate(fecha), diasDelMes(anio, mes0));
    return this.createDate(anio, mes0, dia);
  }

  addCalendarDays(fecha: string, dias: number): string {
    const { anio, mes0, dia } = deDiasEpoch(
      aDiasEpoch(this.getYear(fecha), this.getMonth(fecha), this.getDate(fecha)) + dias,
    );
    return this.createDate(anio, mes0, dia);
  }

  /** El valor ya es ISO: se devuelve tal cual (a diferencia del adaptador nativo, no pasa por UTC). */
  toIso8601(fecha: string): string {
    return fecha;
  }

  isDateInstance(valor: unknown): boolean {
    return typeof valor === 'string' && FECHA_ISO.test(valor);
  }

  isValid(fecha: string): boolean {
    if (typeof fecha !== 'string') {
      return false;
    }
    const partes = FECHA_ISO.exec(fecha);
    if (!partes) {
      return false;
    }
    const mes0 = Number(partes[2]) - 1;
    const dia = Number(partes[3]);
    return mes0 >= 0 && mes0 <= 11 && dia >= 1 && dia <= diasDelMes(Number(partes[1]), mes0);
  }

  invalid(): string {
    return INVALIDA;
  }

  override deserialize(valor: unknown): string | null {
    if (valor == null || valor === '') {
      return null;
    }
    return this._normalizar(valor) ?? this.invalid();
  }

  /** "AAAA-MM-DD" o "dd/mm/aaaa" → "AAAA-MM-DD"; `null` si no es una fecha real. */
  private _normalizar(valor: unknown): string | null {
    if (typeof valor !== 'string') {
      return null;
    }
    const texto = valor.trim();
    const iso = FECHA_ISO.exec(texto);
    if (iso) {
      const normalizada = `${iso[1]}-${iso[2]}-${iso[3]}`;
      return this.isValid(normalizada) ? normalizada : null;
    }
    const es = FECHA_ES.exec(texto);
    if (es) {
      const normalizada = `${es[3]}-${dosDigitos(Number(es[2]))}-${dosDigitos(Number(es[1]))}`;
      return this.isValid(normalizada) ? normalizada : null;
    }
    return null;
  }
}

/** Formatos que `format()`/`parse()` de `FechaIsoAdapter` saben interpretar. */
export const FORMATOS_FECHA_ISO: MatDateFormats = {
  parse: { dateInput: 'dd/mm/aaaa' },
  display: {
    dateInput: 'dd/mm/aaaa',
    monthLabel: 'MMM',
    monthYearLabel: 'MMMM yyyy',
    dateA11yLabel: 'dd MMMM yyyy',
    monthYearA11yLabel: 'MMMM yyyy',
  },
};

/** Etiquetas del calendario en español (`MatDatepickerIntl` viene en inglés). */
@Injectable()
export class IntlFechaEspanol extends MatDatepickerIntl {
  constructor() {
    super();
    this.calendarLabel = 'Calendario';
    this.openCalendarLabel = 'Abrir calendario';
    this.closeCalendarLabel = 'Cerrar calendario';
    this.prevMonthLabel = 'Mes anterior';
    this.nextMonthLabel = 'Mes siguiente';
    this.prevYearLabel = 'Año anterior';
    this.nextYearLabel = 'Año siguiente';
    this.prevMultiYearLabel = '24 años anteriores';
    this.nextMultiYearLabel = '24 años siguientes';
    this.switchToMonthViewLabel = 'Elegir fecha';
    this.switchToMultiYearViewLabel = 'Elegir mes y año';
  }

  override formatYearRange(inicio: string, fin: string): string {
    return `${inicio} \u2013 ${fin}`;
  }

  override formatYearRangeLabel(inicio: string, fin: string): string {
    return `${inicio} a ${fin}`;
  }
}

/**
 * Providers para usar `mat-datepicker` con fechas ISO de texto en español. Se
 * declaran en el componente que abre el calendario, no en toda la app.
 */
export const PROVEEDORES_FECHA_ISO: Provider[] = [
  { provide: DateAdapter, useClass: FechaIsoAdapter },
  { provide: MAT_DATE_FORMATS, useValue: FORMATOS_FECHA_ISO },
  { provide: MatDatepickerIntl, useClass: IntlFechaEspanol },
];
