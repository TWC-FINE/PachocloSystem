package com.pachoclosystem.pachoclosystem.dto;

import com.pachoclosystem.pachoclosystem.model.Usuario;

/**
 * Usuario de acceso ({@code GET /api/auth/me} y {@code /api/usuarios}). Nunca
 * incluye el hash de la contraseña ni la versión del token (un detalle interno
 * del JWT). {@code debeCambiarPassword} avisa de que solo puede cambiar su
 * contraseña antes de operar.
 *
 * <p>{@code nombreCompleto} es el del trabajador vinculado, que es quien firma
 * sus registros clínicos, para que el cliente pueda mostrarlo sin otra petición.
 * Es {@code null} si el usuario no tiene trabajador (el ADMIN) y también si su
 * trabajador ya no existe: el vínculo sobrevive a la baja del trabajador, que
 * deja al usuario inactivo.</p>
 */
public record UsuarioResponse(String idUsuario, String username, String rol, String idTrabajador,
                              String nombreCompleto, boolean activo, boolean debeCambiarPassword) {

    /** @param nombreCompleto nombre del trabajador vinculado, o {@code null} si no tiene */
    public static UsuarioResponse from(Usuario usuario, String nombreCompleto) {
        return new UsuarioResponse(usuario.getIdUsuario(), usuario.getUsername(),
                usuario.getRol().name(), usuario.getIdTrabajador(), nombreCompleto,
                usuario.isActivo(), usuario.isDebeCambiarPassword());
    }
}
