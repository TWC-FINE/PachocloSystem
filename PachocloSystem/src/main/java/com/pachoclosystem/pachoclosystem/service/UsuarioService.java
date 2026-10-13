package com.pachoclosystem.pachoclosystem.service;

import com.pachoclosystem.pachoclosystem.exception.ConflictoException;
import com.pachoclosystem.pachoclosystem.exception.NotFoundException;
import com.pachoclosystem.pachoclosystem.exception.SolicitudInvalidaException;
import com.pachoclosystem.pachoclosystem.model.Doctor;
import com.pachoclosystem.pachoclosystem.model.Enfermero;
import com.pachoclosystem.pachoclosystem.model.Rol;
import com.pachoclosystem.pachoclosystem.model.TrabajadorHospital;
import com.pachoclosystem.pachoclosystem.model.Usuario;
import com.pachoclosystem.pachoclosystem.repository.IUsuarioRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reglas de negocio de los usuarios.
 *
 * <p>La contraseña se guarda <strong>solo</strong> como hash BCrypt: el valor
 * en claro nunca se almacena ni aparece en mensajes de error ni en logs.</p>
 */
@Service
public class UsuarioService {

    public static final int LONGITUD_MINIMA_PASSWORD = 10;
    /** BCrypt solo admite hasta 72 bytes: con más, {@code encode} lanza una excepción (500). */
    public static final int MAXIMO_BYTES_PASSWORD = 72;

    private final IUsuarioRepository repositorio;
    private final TrabajadorService trabajadorService;
    private final PasswordEncoder passwordEncoder;

    public UsuarioService(IUsuarioRepository repositorio, TrabajadorService trabajadorService,
                          PasswordEncoder passwordEncoder) {
        this.repositorio = repositorio;
        this.trabajadorService = trabajadorService;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Crea un usuario sin cambio de contraseña obligatorio (arranque y tests).
     * Las altas por la API usan la sobrecarga con {@code debeCambiarPassword=true}.
     */
    public Usuario crearUsuario(String username, String passwordEnClaro, Rol rol, String idTrabajador) {
        return crearUsuario(username, passwordEnClaro, rol, idTrabajador, false);
    }

    /**
     * Crea un usuario con la contraseña hasheada con BCrypt.
     *
     * <p>Reglas: username válido y único (case-insensitive), contraseña que
     * cumpla la política (ver {@link #validarPassword}), los administradores no se vinculan a un trabajador y
     * los doctores/enfermeros sí, a un trabajador existente del tipo correcto y
     * que todavía no tenga usuario.</p>
     *
     * @param debeCambiarPassword {@code true} para que el usuario solo pueda
     *                            cambiar su contraseña hasta hacerlo
     */
    public Usuario crearUsuario(String username, String passwordEnClaro, Rol rol, String idTrabajador,
                                boolean debeCambiarPassword) {
        String usernameNormalizado = Usuario.normalizarUsername(username);
        String trabajador = normalizarTrabajador(idTrabajador);

        List<String> errores = new ArrayList<>();
        if (usernameNormalizado == null || !Usuario.PATRON_USERNAME.matcher(usernameNormalizado).matches()) {
            errores.add("El username debe tener entre 3 y 30 caracteres y solo puede contener "
                    + "minúsculas, dígitos, punto, guion bajo o guion.");
        }
        errores.addAll(validarPassword(passwordEnClaro, usernameNormalizado));
        errores.addAll(validarVinculo(rol, trabajador));
        if (!errores.isEmpty()) {
            throw new SolicitudInvalidaException(errores);
        }

        if (rol != Rol.ADMIN) {
            validarTrabajador(rol, trabajador, null);
        }

        // Aviso temprano para el caso habitual; la garantía de unicidad sigue siendo
        // atómica dentro de repositorio.guardar() (putIfAbsent), que es quien decide.
        if (repositorio.existePorUsername(usernameNormalizado)) {
            throw usuarioDuplicado(usernameNormalizado);
        }

        String id = repositorio.generarNuevoId();
        Usuario usuario = new Usuario(id, usernameNormalizado, passwordEncoder.encode(passwordEnClaro),
                rol, trabajador, debeCambiarPassword);
        if (!repositorio.guardar(usuario)) {
            throw usuarioDuplicado(usernameNormalizado);
        }
        return usuario;
    }

    /**
     * Política de contraseña: de {@value #LONGITUD_MINIMA_PASSWORD} caracteres
     * a {@value #MAXIMO_BYTES_PASSWORD} bytes en UTF-8, y distinta del username
     * (sin distinguir mayúsculas). Sin reglas de composición. Los mensajes
     * nunca incluyen la contraseña.
     */
    static List<String> validarPassword(String passwordEnClaro, String usernameNormalizado) {
        List<String> errores = new ArrayList<>();
        if (passwordEnClaro == null || passwordEnClaro.length() < LONGITUD_MINIMA_PASSWORD) {
            errores.add("La contraseña debe tener al menos " + LONGITUD_MINIMA_PASSWORD + " caracteres.");
            return errores;
        }
        if (passwordEnClaro.getBytes(StandardCharsets.UTF_8).length > MAXIMO_BYTES_PASSWORD) {
            errores.add("La contraseña no puede ocupar más de " + MAXIMO_BYTES_PASSWORD
                    + " bytes (las letras con tilde y la ñ ocupan 2).");
        }
        if (usernameNormalizado != null
                && passwordEnClaro.trim().toLowerCase(Locale.ROOT).equals(usernameNormalizado)) {
            errores.add("La contraseña no puede ser igual al username.");
        }
        return errores;
    }

    /** 409: el username ya pertenece a otro usuario (activo o no). */
    private ConflictoException usuarioDuplicado(String usernameNormalizado) {
        return new ConflictoException(
                "Ya existe un usuario con el username " + usernameNormalizado + ".");
    }

    /** Usuarios activos e inactivos, por ID; {@code texto} filtra por ID, username o trabajador. */
    public List<Usuario> listar(String texto) {
        String filtro = texto == null ? "" : texto.trim().toLowerCase(Locale.ROOT);
        return repositorio.listarTodos().stream()
                .filter(u -> filtro.isEmpty()
                        || u.getIdUsuario().toLowerCase(Locale.ROOT).contains(filtro)
                        || u.getUsername().contains(filtro)
                        || (u.getIdTrabajador() != null
                        && u.getIdTrabajador().toLowerCase(Locale.ROOT).contains(filtro)))
                .toList();
    }

    /**
     * Nombre completo del trabajador vinculado al usuario, o {@code null} si no
     * tiene (el ADMIN) o si su trabajador ya no existe.
     */
    public String nombreDelTrabajador(Usuario usuario) {
        return nombresDeTrabajadores(List.of(usuario)).get(usuario.getIdUsuario());
    }

    /**
     * Nombre completo del trabajador de cada usuario, indexado por
     * {@code idUsuario} ({@code null} para quien no tiene), en
     * <strong>una sola</strong> lectura de trabajadores
     * ({@link TrabajadorService#nombresPorId(Collection)}): listar usuarios no
     * hace una consulta por usuario (N+1). La clave es el usuario y no el
     * trabajador porque el ADMIN no tiene trabajador.
     */
    public Map<String, String> nombresDeTrabajadores(Collection<Usuario> usuarios) {
        Map<String, String> porTrabajador =
                trabajadorService.nombresPorId(usuarios.stream().map(Usuario::getIdTrabajador).toList());
        Map<String, String> nombres = new HashMap<>();
        for (Usuario usuario : usuarios) {
            nombres.put(usuario.getIdUsuario(),
                    usuario.getIdTrabajador() == null ? null : porTrabajador.get(usuario.getIdTrabajador()));
        }
        return nombres;
    }

    /** Devuelve el usuario; si no existe lanza {@link NotFoundException}. */
    public Usuario obtener(String idUsuario) {
        Usuario usuario = repositorio.buscarPorId(idUsuario);
        if (usuario == null) {
            throw new NotFoundException("No se encontró el usuario " + idUsuario + ".");
        }
        return usuario;
    }

    /**
     * Desactiva un usuario (idempotente). 409 si es el propio usuario que lo
     * pide o el último administrador activo. Sus tokens dejan de valer de
     * inmediato y no vuelven a valer aunque se reactive (sube la versión).
     */
    @Transactional
    public Usuario desactivar(String idUsuario, String usernameSolicitante) {
        // Las operaciones que pueden dejar el sistema sin administradores activos
        // (desactivar, activar, cambiar de rol) se serializan con un bloqueo de
        // PostgreSQL: dos administradores no pueden desactivarse a la vez el uno al otro.
        repositorio.bloquearAdministracion();
        Usuario usuario = obtenerParaActualizar(idUsuario);
        if (!usuario.isActivo()) {
            return usuario;
        }
        if (usuario.getUsername().equals(Usuario.normalizarUsername(usernameSolicitante))) {
            throw new ConflictoException("No puede desactivar su propio usuario.");
        }
        if (usuario.getRol() == Rol.ADMIN && repositorio.contarAdministradoresActivos() <= 1) {
            throw new ConflictoException("No se puede desactivar al último administrador activo.");
        }
        repositorio.desactivar(idUsuario);
        return obtener(idUsuario);
    }

    /**
     * Reactiva un usuario (idempotente) con las comprobaciones de consistencia
     * del alta: un doctor o enfermero necesita que su trabajador siga existiendo,
     * sea de su tipo y siga vinculado a él. Si no, 409.
     */
    @Transactional
    public Usuario activar(String idUsuario) {
        repositorio.bloquearAdministracion();
        Usuario usuario = obtenerParaActualizar(idUsuario);
        if (usuario.isActivo()) {
            return usuario;
        }
        if (usuario.getRol() != Rol.ADMIN) {
            comprobarTrabajadorVigente(usuario);
        }
        repositorio.reactivar(idUsuario);
        return obtener(idUsuario);
    }

    /**
     * Cambia el rol y el trabajador vinculado, con las mismas reglas de vínculo
     * que el alta (400 si son incoherentes, 404 si el trabajador no existe).
     * 409 si el solicitante se cambia su propio rol, si el trabajador ya es de
     * otro usuario o si se degradaría al último administrador activo. Los
     * permisos se releen en cada petición, así que el cambio se aplica de
     * inmediato sin revocar los tokens.
     */
    @Transactional
    public Usuario cambiarRol(String idUsuario, Rol nuevoRol, String idTrabajador,
                              String usernameSolicitante) {
        String trabajador = normalizarTrabajador(idTrabajador);
        // El cambio sobre uno mismo se descarta antes de serializar: no puede
        // dejar el sistema sin administradores, así que no toma el bloqueo (misma
        // regla que desactivar, pero sin necesidad de esperarlo).
        Usuario previo = obtener(idUsuario);
        if (previo.getUsername().equals(Usuario.normalizarUsername(usernameSolicitante))) {
            throw new ConflictoException("No puede cambiar su propio rol.");
        }
        repositorio.bloquearAdministracion();
        Usuario usuario = obtenerParaActualizar(idUsuario);
        List<String> errores = validarVinculo(nuevoRol, trabajador);
        if (!errores.isEmpty()) {
            throw new SolicitudInvalidaException(errores);
        }
        if (nuevoRol != Rol.ADMIN) {
            validarTrabajador(nuevoRol, trabajador, idUsuario);
        }
        // Guarda del último administrador activo, conservada como defensa del
        // servicio: hoy es inalcanzable por la API (quien pide es un ADMIN activo,
        // así que el único admin activo sería el propio solicitante y salta antes
        // la regla del propio rol).
        if (usuario.getRol() == Rol.ADMIN && nuevoRol != Rol.ADMIN && usuario.isActivo()
                && repositorio.contarAdministradoresActivos() <= 1) {
            throw new ConflictoException("No se puede quitar el rol ADMIN al último administrador activo.");
        }
        // La restricción UNIQUE de la base reserva el trabajador: si otro usuario lo
        // tomó a la vez, el cambio no se aplica.
        if (!repositorio.cambiarRol(idUsuario, nuevoRol, trabajador)) {
            throw trabajadorOcupado(trabajador);
        }
        return obtener(idUsuario);
    }

    /**
     * Restablecimiento por un ADMIN: sustituye la contraseña de un usuario
     * (activo o no) por una que cumpla la política y le obliga a cambiarla en
     * el siguiente acceso. Los tokens emitidos antes dejan de valer, también los
     * del propio solicitante si se restablece la suya.
     */
    @Transactional
    public Usuario restablecerPassword(String idUsuario, String nuevaPasswordEnClaro) {
        Usuario usuario = obtenerParaActualizar(idUsuario);
        List<String> errores = validarPassword(nuevaPasswordEnClaro, usuario.getUsername());
        if (!errores.isEmpty()) {
            throw new SolicitudInvalidaException(errores);
        }
        repositorio.cambiarPassword(idUsuario, passwordEncoder.encode(nuevaPasswordEnClaro), true);
        return obtener(idUsuario);
    }

    /**
     * Cambio de la contraseña propia: comprueba la actual, exige que la nueva
     * sea distinta y cumpla la política, y quita el cambio pendiente. Los tokens
     * emitidos antes (incluido el de esta petición) dejan de valer.
     */
    @Transactional
    public Usuario cambiarPasswordPropia(String idUsuario, String passwordActual, String passwordNueva) {
        // Bloqueo de la fila: la contraseña actual se comprueba contra el hash que
        // se va a sustituir, sin que otro cambio se cuele entre medias.
        Usuario usuario = obtenerParaActualizar(idUsuario);
        if (passwordActual == null || !passwordEncoder.matches(passwordActual, usuario.getPasswordHash())) {
            // Mensaje genérico: nunca reproduce la contraseña.
            throw new SolicitudInvalidaException("La contraseña actual no es correcta.");
        }
        if (passwordActual.equals(passwordNueva)) {
            throw new SolicitudInvalidaException("La nueva contraseña debe ser diferente de la actual.");
        }
        List<String> errores = validarPassword(passwordNueva, usuario.getUsername());
        if (!errores.isEmpty()) {
            throw new SolicitudInvalidaException(errores);
        }
        repositorio.cambiarPassword(idUsuario, passwordEncoder.encode(passwordNueva), false);
        return obtener(idUsuario);
    }

    /** Lee y bloquea al usuario hasta el final de la transacción; 404 si no existe. */
    private Usuario obtenerParaActualizar(String idUsuario) {
        Usuario usuario = repositorio.buscarPorIdParaActualizar(idUsuario);
        if (usuario == null) {
            throw new NotFoundException("No se encontró el usuario " + idUsuario + ".");
        }
        return usuario;
    }

    private void comprobarTrabajadorVigente(Usuario usuario) {
        String idTrabajador = usuario.getIdTrabajador();
        String motivo = null;
        TrabajadorHospital trabajador = null;
        try {
            trabajador = trabajadorService.obtenerTrabajador(idTrabajador);
        } catch (NotFoundException noExiste) {
            motivo = "su trabajador " + idTrabajador + " ya no existe";
        }
        if (trabajador != null) {
            boolean tipoCorrecto = usuario.getRol() == Rol.DOCTOR
                    ? trabajador instanceof Doctor
                    : trabajador instanceof Enfermero;
            if (!tipoCorrecto) {
                motivo = "su trabajador " + idTrabajador + " ya no es de su rol";
            } else if (!vinculadoA(idTrabajador, usuario)) {
                motivo = "su trabajador " + idTrabajador + " está vinculado a otro usuario";
            }
        }
        if (motivo != null) {
            throw new ConflictoException(
                    "No se puede activar el usuario " + usuario.getUsername() + ": " + motivo + ".");
        }
    }

    /** ¿El trabajador sigue vinculado a ese usuario? (se compara por id: cada lectura es un objeto nuevo) */
    private boolean vinculadoA(String idTrabajador, Usuario usuario) {
        Usuario vinculado = repositorio.buscarPorIdTrabajador(idTrabajador);
        return vinculado != null && vinculado.getIdUsuario().equals(usuario.getIdUsuario());
    }

    /** Devuelve el usuario; si no existe lanza {@link NotFoundException}. */
    public Usuario buscarPorUsername(String username) {
        Usuario usuario = repositorio.buscarPorUsername(username);
        if (usuario == null) {
            throw new NotFoundException("No se encontró el usuario "
                    + Usuario.normalizarUsername(username) + ".");
        }
        return usuario;
    }

    private static String normalizarTrabajador(String idTrabajador) {
        return (idTrabajador == null || idTrabajador.isBlank()) ? null : idTrabajador.trim();
    }

    /** Coherencia rol/trabajador: el ADMIN sin trabajador, los demás con uno. */
    private static List<String> validarVinculo(Rol rol, String trabajador) {
        if (rol == null) {
            return List.of("Debe seleccionar un rol (ADMIN, DOCTOR o ENFERMERO).");
        }
        if (rol == Rol.ADMIN && trabajador != null) {
            return List.of("El usuario administrador no puede estar vinculado a un trabajador.");
        }
        if (rol != Rol.ADMIN && trabajador == null) {
            return List.of("El usuario con rol " + rol + " debe estar vinculado a un trabajador.");
        }
        return List.of();
    }

    /**
     * Valida que el trabajador vinculado exista y sea del tipo que exige el rol,
     * y que no tenga ya <em>otro</em> usuario.
     *
     * @param idUsuarioPropietario usuario que puede conservar el trabajador
     *                             ({@code null} en el alta)
     */
    private void validarTrabajador(Rol rol, String idTrabajador, String idUsuarioPropietario) {
        // Reutiliza el servicio existente: si no existe, lanza NotFoundException
        // con su mensaje habitual ("No se encontró el trabajador X.").
        TrabajadorHospital trabajador = trabajadorService.obtenerTrabajador(idTrabajador);

        if (rol == Rol.DOCTOR && !(trabajador instanceof Doctor)) {
            throw new SolicitudInvalidaException(
                    "El trabajador " + idTrabajador + " no es un Doctor.");
        }
        if (rol == Rol.ENFERMERO && !(trabajador instanceof Enfermero)) {
            throw new SolicitudInvalidaException(
                    "El trabajador " + idTrabajador + " no es un Enfermero.");
        }
        Usuario ocupante = repositorio.buscarPorIdTrabajador(idTrabajador);
        if (ocupante != null && !ocupante.getIdUsuario().equals(idUsuarioPropietario)) {
            // 409: el vínculo es único y no se libera al desactivar (ver activar()).
            throw trabajadorOcupado(idTrabajador);
        }
    }

    private static ConflictoException trabajadorOcupado(String idTrabajador) {
        return new ConflictoException("El trabajador " + idTrabajador + " ya tiene un usuario.");
    }
}
