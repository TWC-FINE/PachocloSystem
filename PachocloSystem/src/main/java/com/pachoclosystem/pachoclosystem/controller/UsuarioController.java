package com.pachoclosystem.pachoclosystem.controller;

import com.pachoclosystem.pachoclosystem.dto.CambiarRolRequest;
import com.pachoclosystem.pachoclosystem.dto.PasswordRequest;
import com.pachoclosystem.pachoclosystem.dto.UsuarioRequest;
import com.pachoclosystem.pachoclosystem.dto.UsuarioResponse;
import com.pachoclosystem.pachoclosystem.model.Rol;
import com.pachoclosystem.pachoclosystem.model.Usuario;
import com.pachoclosystem.pachoclosystem.service.UsuarioService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Gestión de usuarios, solo para ADMIN (regla en {@code SecurityConfig}).
 * Las respuestas nunca incluyen el hash de la contraseña. El alta y el
 * restablecimiento de contraseña dejan al usuario con el cambio obligatorio.
 */
@RestController
@RequestMapping("/api/usuarios")
public class UsuarioController {

    private final UsuarioService servicio;

    public UsuarioController(UsuarioService servicio) {
        this.servicio = servicio;
    }

    @PostMapping
    public ResponseEntity<UsuarioResponse> crear(@RequestBody UsuarioRequest request) {
        Usuario usuario = servicio.crearUsuario(request.username(), request.password(),
                rolDe(request.rol()), request.idTrabajador(), true);
        return ResponseEntity.created(URI.create("/api/usuarios/" + usuario.getIdUsuario()))
                .body(respuestaDe(usuario));
    }

    /** Activos e inactivos; {@code q} filtra por ID, username o trabajador vinculado. */
    @GetMapping
    public List<UsuarioResponse> listar(@RequestParam(required = false) String q) {
        List<Usuario> usuarios = servicio.listar(q);
        // Los nombres se resuelven de una vez para todo el listado (sin N+1).
        Map<String, String> nombres = servicio.nombresDeTrabajadores(usuarios);
        return usuarios.stream()
                .map(usuario -> UsuarioResponse.from(usuario, nombres.get(usuario.getIdUsuario())))
                .toList();
    }

    @GetMapping("/{id}")
    public UsuarioResponse obtener(@PathVariable String id) {
        return respuestaDe(servicio.obtener(id));
    }

    @PatchMapping("/{id}/rol")
    public UsuarioResponse cambiarRol(@PathVariable String id, @RequestBody CambiarRolRequest request) {
        return respuestaDe(servicio.cambiarRol(id, rolDe(request.rol()), request.idTrabajador()));
    }

    @PatchMapping("/{id}/desactivar")
    public UsuarioResponse desactivar(@PathVariable String id, Authentication autenticacion) {
        return respuestaDe(servicio.desactivar(id, autenticacion.getName()));
    }

    @PatchMapping("/{id}/activar")
    public UsuarioResponse activar(@PathVariable String id) {
        return respuestaDe(servicio.activar(id));
    }

    @PatchMapping("/{id}/password")
    public ResponseEntity<Void> restablecerPassword(@PathVariable String id,
                                                    @RequestBody PasswordRequest request) {
        servicio.restablecerPassword(id, request.password());
        return ResponseEntity.noContent().build();
    }

    /**
     * Respuesta de un usuario con el nombre completo de su trabajador vinculado
     * (una lectura; {@code null} si no tiene o si su trabajador ya no existe).
     */
    private UsuarioResponse respuestaDe(Usuario usuario) {
        return UsuarioResponse.from(usuario, servicio.nombreDelTrabajador(usuario));
    }

    /** Texto del rol a {@link Rol}; {@code null} si falta o no es válido (lo informa el servicio). */
    private static Rol rolDe(String texto) {
        if (texto == null || texto.isBlank()) {
            return null;
        }
        try {
            return Rol.valueOf(texto.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException desconocido) {
            return null;
        }
    }
}
