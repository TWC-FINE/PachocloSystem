import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Usuario } from '../../core/auth/auth.models';
import { CambiarRolRequest, UsuarioRequest } from './usuario.models';

const URL = '/api/usuarios';

/** Gestión de usuarios (`/api/usuarios`, solo ADMIN). Las respuestas nunca traen el hash. */
@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private readonly http = inject(HttpClient);

  /** Activos e inactivos; `texto` filtra por ID, username o trabajador. */
  listar(texto = ''): Observable<Usuario[]> {
    const q = texto.trim();
    return this.http.get<Usuario[]>(URL, { params: q ? new HttpParams().set('q', q) : {} });
  }

  crear(datos: UsuarioRequest): Observable<Usuario> {
    return this.http.post<Usuario>(URL, datos);
  }

  /**
   * Cambia el rol y el trabajador vinculado. Los errores del backend: 400 si el
   * rol y el trabajador no encajan, 404 si el usuario o el trabajador no
   * existen, 409 si es su propio rol, si el trabajador ya tiene usuario o si se
   * quitaría el rol ADMIN al último administrador activo.
   */
  cambiarRol(id: string, datos: CambiarRolRequest): Observable<Usuario> {
    return this.http.patch<Usuario>(`${URL}/${encodeURIComponent(id)}/rol`, datos);
  }

  /** 409 si es el propio usuario o el último administrador activo. */
  desactivar(id: string): Observable<Usuario> {
    return this.http.patch<Usuario>(`${URL}/${encodeURIComponent(id)}/desactivar`, null);
  }

  /** 409 si su trabajador ya no existe o no es de su rol. */
  activar(id: string): Observable<Usuario> {
    return this.http.patch<Usuario>(`${URL}/${encodeURIComponent(id)}/activar`, null);
  }

  /** Invalida los tokens anteriores de ese usuario (también los propios). */
  restablecerPassword(id: string, password: string): Observable<void> {
    return this.http.patch<void>(`${URL}/${encodeURIComponent(id)}/password`, { password });
  }
}
