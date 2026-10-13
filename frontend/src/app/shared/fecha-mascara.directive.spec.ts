import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FechaMascaraDirectiva } from './fecha-mascara.directive';

@Component({
  imports: [ReactiveFormsModule, FechaMascaraDirectiva],
  template: `<input appFechaDdMmAaaa [formControl]="fecha" />`,
})
class Anfitrion {
  readonly fecha = new FormControl('', { nonNullable: true });
}

describe('FechaMascaraDirectiva', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let input: HTMLInputElement;

  const control = () => fixture.componentInstance.fecha;

  /**
   * Un `input` con el valor ya puesto es lo que ve la máscara tanto al teclear
   * (el carácter nuevo sobre el texto anterior) como al pegar (todo de golpe).
   */
  async function escribir(valor: string, cursor = valor.length): Promise<void> {
    input.value = valor;
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Anfitrion] });
    fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    input = fixture.nativeElement.querySelector('input')!;
  });

  it('enmascara lo que se teclea: "12321" queda como "12/32/1"', async () => {
    await escribir('12321');

    expect(input.value).toBe('12/32/1');
    expect(control().value).toBe('12/32/1');
  });

  it('solo admite dígitos y corta a 10 caracteres', async () => {
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('maxlength')).toBe('10');

    await escribir('12a/03-2027');
    expect(input.value).toBe('12/03/2027');

    await escribir('123456789');
    expect(input.value).toBe('12/34/5678');
    expect(input.value).toHaveLength(10);
  });

  it('al borrar una "/" la repone sin perder dígitos ni mover el cursor', async () => {
    await escribir('12/32/1');
    expect(input.value).toBe('12/32/1');

    // Backspace detrás de la segunda "/": el navegador deja "12/321".
    await escribir('12/321', 5);

    expect(input.value).toBe('12/32/1');
    expect(input.value.replace(/\D/g, '')).toBe('12321');
    expect(input.selectionStart).toBe(5);
    expect(control().value).toBe('12/32/1');
  });

  it('acepta el pegado con y sin separadores', async () => {
    await escribir('12032027');
    expect(input.value).toBe('12/03/2027');
    expect(control().value).toBe('12/03/2027');

    await escribir('12/03/2027');
    expect(input.value).toBe('12/03/2027');
    expect(control().value).toBe('12/03/2027');
  });

  it('repite el suceso input como mucho una vez por pulsación', async () => {
    let sucesos = 0;
    input.addEventListener('input', () => sucesos++);

    // "12032027" cambia de forma al enmascararse: el suceso original más una
    // única repetición (la que hace releer el valor ya enmascarado).
    await escribir('12032027');
    expect(sucesos).toBe(2);
    expect(input.value).toBe('12/03/2027');

    // Ya enmascarado no cambia nada, así que no repite: no hay bucle.
    sucesos = 0;
    await escribir('12/03/2027');
    expect(sucesos).toBe(1);
    expect(input.value).toBe('12/03/2027');
  });
});
