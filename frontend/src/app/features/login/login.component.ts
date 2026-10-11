import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiError, mensajesDeError } from '../../core/http/api-error';
import { ErroresFormularioComponent } from '../../shared/errores-formulario/errores-formulario.component';
import { obligatorio, primerError } from '../../shared/validadores';

const AVISOS_CIERRE: Readonly<Record<string, string>> = {
  expirada: 'Su sesión expiró o ya no es válida. Inicie sesión de nuevo.',
  'password-cambiada':
    'Su contraseña ha cambiado y la sesión anterior ya no es válida. Inicie sesión con la nueva.',
};

/** Segundos en formato `m:ss` (p. ej. 45 → "0:45"). */
function minutosYSegundos(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ErroresFormularioComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly parametros = inject(ActivatedRoute).snapshot.queryParamMap;
  private readonly destroyRef = inject(DestroyRef);

  protected readonly formulario = inject(NonNullableFormBuilder).group({
    username: ['', obligatorio('El usuario es obligatorio.')],
    password: ['', obligatorio('La contraseña es obligatoria.')],
  });
  protected readonly primerError = primerError;
  protected readonly enviando = signal(false);
  protected readonly errores = signal<readonly string[]>([]);
  protected readonly verPassword = signal(false);
  /** Por qué se llegó al login, si fue por un cierre de sesión. */
  protected readonly avisoCierre = AVISOS_CIERRE[this.parametros.get('motivo') ?? ''] ?? null;
  /** Segundos que aún hay que esperar tras un 429; `null` si no hay espera. */
  protected readonly esperaSegundos = signal<number | null>(null);
  /** Texto visible de la cuenta atrás. */
  protected readonly esperaTexto = computed(() => minutosYSegundos(this.esperaSegundos() ?? 0));
  /**
   * Anuncio para lectores de pantalla: cambia al empezar la espera y al terminar,
   * no en cada segundo (el aviso visible se actualiza sin volver a anunciarse).
   */
  protected readonly avisoEspera = signal<string | null>(null);

  private temporizador: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.detenerEspera());
  }

  protected iniciarSesion(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    if (this.esperaSegundos() !== null) {
      return;
    }
    this.enviando.set(true);
    this.errores.set([]);
    this.auth.iniciarSesion(this.formulario.getRawValue()).subscribe({
      next: () => void this.router.navigateByUrl(destinoSeguro(this.parametros.get('returnUrl'))),
      error: (error: unknown) => {
        this.errores.set(mensajesDeError(error));
        this.enviando.set(false);
        this.empezarEspera(error);
      },
    });
  }

  /**
   * Tras un 429, bloquea el reintento durante los segundos que pidió el servidor
   * (`Retry-After`). Sin esa cabecera legible —por ejemplo si CORS no la expone—
   * no hay cuenta atrás y se mantiene el comportamiento de siempre.
   */
  private empezarEspera(error: unknown): void {
    const segundos = error instanceof ApiError ? error.retryAfterSegundos : undefined;
    // Sin cabecera, o con un valor no utilizable (0, negativo, no numérico), no hay espera.
    if (segundos === undefined || Number.isNaN(segundos) || segundos <= 0) {
      return;
    }
    this.avisoEspera.set(`Podrá reintentar en ${minutosYSegundos(segundos)}.`);
    this.esperaSegundos.set(segundos);
    this.detenerTemporizador();
    this.temporizador = setInterval(() => this.descontarSegundo(), 1000);
  }

  private descontarSegundo(): void {
    const restantes = (this.esperaSegundos() ?? 0) - 1;
    if (restantes > 0) {
      this.esperaSegundos.set(restantes);
      return;
    }
    this.detenerEspera();
    this.avisoEspera.set('Ya puede reintentar.');
  }

  private detenerEspera(): void {
    this.detenerTemporizador();
    this.esperaSegundos.set(null);
  }

  private detenerTemporizador(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }
}

/** Solo rutas internas: evita redirecciones abiertas con `?returnUrl=//otro.sitio`. */
export function destinoSeguro(url: string | null): string {
  const interna = url?.startsWith('/') && !url.startsWith('//') && !url.startsWith('/login');
  return interna ? url! : '/';
}
