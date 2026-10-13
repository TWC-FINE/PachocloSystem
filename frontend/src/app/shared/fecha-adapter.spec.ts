import { FechaIsoAdapter } from './fecha-adapter';

describe('FechaIsoAdapter', () => {
  const adaptador = new FechaIsoAdapter();

  it('muestra la fecha en dd/mm/aaaa', () => {
    expect(adaptador.format('2027-01-31', 'dd/mm/aaaa')).toBe('31/01/2027');
  });

  it('interpreta dd/mm/aaaa y lo deja en ISO', () => {
    expect(adaptador.parse('31/01/2027')).toBe('2027-01-31');
    expect(adaptador.parse('1/1/2027')).toBe('2027-01-01');
  });

  it('deserializa el ISO que llega del backend', () => {
    expect(adaptador.deserialize('2027-01-31')).toBe('2027-01-31');
    expect(adaptador.deserialize('')).toBeNull();
    expect(adaptador.deserialize(null)).toBeNull();
    expect(adaptador.deserialize('no es una fecha')).toBe(adaptador.invalid());
  });

  it('no desplaza el día: toIso8601 devuelve el mismo texto', () => {
    expect(adaptador.toIso8601('2027-01-31')).toBe('2027-01-31');
  });

  it('rechaza fechas imposibles', () => {
    expect(adaptador.parse('31/02/2027')).toBe(adaptador.invalid());
    expect(adaptador.parse('')).toBeNull();
    expect(adaptador.parse('no es una fecha')).toBe(adaptador.invalid());
    expect(adaptador.isValid('2027-13-01')).toBe(false);
    expect(adaptador.isValid('2027-00-10')).toBe(false);
    expect(adaptador.isValid('2027-01-32')).toBe(false);
    expect(adaptador.isValid('2027-01-00')).toBe(false);
  });

  it('marca con invalid() el texto tecleado que no es una fecha', () => {
    expect(adaptador.parse('12321')).toBe(adaptador.invalid());
    expect(adaptador.parse('12/03')).toBe(adaptador.invalid());
  });

  it('parse() y deserialize() coinciden con el mismo texto inválido', () => {
    expect(adaptador.parse('12321')).toBe(adaptador.deserialize('12321'));
    expect(adaptador.parse('no es una fecha')).toBe(adaptador.deserialize('no es una fecha'));
  });

  it('parse() deja en null solo lo que está vacío', () => {
    expect(adaptador.parse('')).toBeNull();
    expect(adaptador.parse('   ')).toBeNull();
    expect(adaptador.parse(null)).toBeNull();
    expect(adaptador.parse(undefined)).toBeNull();
  });

  it('admite el 29 de febrero solo en años bisiestos', () => {
    expect(adaptador.parse('29/02/2028')).toBe('2028-02-29');
    expect(adaptador.parse('29/02/2027')).toBe(adaptador.invalid());
    expect(adaptador.isValid('2028-02-29')).toBe(true);
    expect(adaptador.isValid('2027-02-29')).toBe(false);
    // 2100 no es bisiesto (divisible por 100 pero no por 400).
    expect(adaptador.isValid('2100-02-29')).toBe(false);
  });

  it('admite el 30 y el 31 solo en los meses que los tienen', () => {
    expect(adaptador.parse('30/04/2027')).toBe('2027-04-30');
    expect(adaptador.parse('31/04/2027')).toBe(adaptador.invalid());
    expect(adaptador.parse('31/03/2027')).toBe('2027-03-31');
    expect(adaptador.parse('31/06/2027')).toBe(adaptador.invalid());
  });

  it('empieza la semana en lunes', () => {
    expect(adaptador.getFirstDayOfWeek()).toBe(1);
  });

  it('calcula el día de la semana sin Date', () => {
    expect(adaptador.getDayOfWeek('2027-01-31')).toBe(0); // domingo
    expect(adaptador.getDayOfWeek('2027-02-01')).toBe(1); // lunes
  });

  it('suma meses recortando el día al último del mes', () => {
    expect(adaptador.addCalendarMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(adaptador.addCalendarYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(adaptador.addCalendarDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(adaptador.addCalendarDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('pasa de diciembre a enero y de enero a febrero', () => {
    expect(adaptador.addCalendarDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(adaptador.addCalendarDays('2028-01-01', -1)).toBe('2027-12-31');
    expect(adaptador.addCalendarMonths('2027-12-15', 1)).toBe('2028-01-15');
    expect(adaptador.addCalendarMonths('2027-01-15', 1)).toBe('2027-02-15');
    expect(adaptador.addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('suma días igual que el calendario real (oráculo en UTC)', () => {
    const oraculo = (fecha: string, delta: number): string => {
      const [anio, mes, dia] = fecha.split('-').map(Number);
      const dias = Date.UTC(anio, mes - 1, dia) + delta * 86_400_000;
      return new Date(dias).toISOString().slice(0, 10);
    };
    for (const base of ['2027-02-28', '2027-04-30', '2027-12-31', '2028-02-29']) {
      for (const delta of [-400, -31, -1, 1, 31, 400]) {
        expect(adaptador.addCalendarDays(base, delta)).toBe(oraculo(base, delta));
      }
    }
  });

  it('los nombres van en español y empiezan en domingo', () => {
    expect(adaptador.getMonthNames('long')[0]).toBe('enero');
    expect(adaptador.getDayOfWeekNames('long')[0]).toBe('domingo');
    expect(adaptador.getDayOfWeekNames('narrow')[1]).toBe('L');
    expect(adaptador.getDateNames()).toHaveLength(31);
  });
});
