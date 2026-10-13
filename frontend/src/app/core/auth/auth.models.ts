import { Rol } from '../roles';

export interface LoginRequest {
  username: string;
  password: string;
}

/** `POST /api/auth/login`. */
export interface LoginResponse {
  token: string;
  tipo: string;
  expiraEnSegundos: number;
  rol: Rol;
  debeCambiarPassword: boolean;
}

/** `POST /api/auth/password`: cambio de la contraseña propia. */
export interface CambiarPasswordRequest {
  passwordActual: string;
  passwordNueva: string;
}

/**
 * `UsuarioResponse` (`GET /api/auth/me` y `/api/usuarios`). `idTrabajador` es
 * `null` para el administrador. Nunca trae el hash de la contraseña.
 * `debeCambiarPassword`: tras un alta o un restablecimiento, el usuario solo
 * puede cambiar su contraseña; el backend responde 403 a todo lo demás.
 */
export interface Usuario {
  idUsuario: string;
  username: string;
  rol: Rol;
  idTrabajador: string | null;
  /**
   * Nombre completo del trabajador vinculado (el que firma sus registros), o
   * `null` si no tiene (el administrador) o si su trabajador ya no existe.
   * Opcional porque las sesiones guardadas antes de que el backend lo enviara
   * no lo traen: trátalo como texto ausente, nunca como el texto «null».
   */
  nombreCompleto?: string | null;
  activo: boolean;
  debeCambiarPassword: boolean;
}
