package com.pachoclosystem.pachoclosystem.service;

import com.pachoclosystem.pachoclosystem.exception.ConflictoException;
import com.pachoclosystem.pachoclosystem.exception.NotFoundException;
import com.pachoclosystem.pachoclosystem.exception.SolicitudInvalidaException;
import com.pachoclosystem.pachoclosystem.model.Doctor;
import com.pachoclosystem.pachoclosystem.model.Enfermero;
import com.pachoclosystem.pachoclosystem.model.NivelExperiencia;
import com.pachoclosystem.pachoclosystem.model.Rol;
import com.pachoclosystem.pachoclosystem.model.Usuario;
import com.pachoclosystem.pachoclosystem.repository.TrabajadorRepositoryEnMemoria;
import com.pachoclosystem.pachoclosystem.repository.UsuarioRepositoryEnMemoria;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

/**
 * Cambio de contraseña obligatorio, versión de token, cambio de rol y cambio
 * de la contraseña propia, sin contexto Spring. El alta, la política de
 * contraseña y activar/desactivar están en {@link UsuarioServiceTest}.
 */
class UsuarioServiceGestionTest {

    private static final String PASSWORD_VALIDA = "clave-de-pruebas-10";

    /** Solicitante ficticio de los cambios de rol: nunca es el usuario destino. */
    private static final String SOLICITANTE = "admin.solicitante";

    private UsuarioRepositoryEnMemoria repositorio;
    private TrabajadorService trabajadorService;
    private PasswordEncoder encoder;
    private UsuarioService servicio;

    @BeforeEach
    void preparar() {
        repositorio = new UsuarioRepositoryEnMemoria();
        trabajadorService = new TrabajadorService(new TrabajadorRepositoryEnMemoria(), repositorio);
        encoder = new BCryptPasswordEncoder();
        servicio = new UsuarioService(repositorio, trabajadorService, encoder);
    }

    // ------------------------------------------------------- creación con flag

    @Test
    void elAltaPorApiPuedeExigirElCambioDePasswordManteniendoLaVersionInicial() {
        Usuario usuario = servicio.crearUsuario("ana.torres", PASSWORD_VALIDA, Rol.ADMIN, null, true);

        assertThat(usuario.isDebeCambiarPassword()).isTrue();
        assertThat(usuario.getVersionToken()).isZero();
        assertThat(encoder.matches(PASSWORD_VALIDA, usuario.getPasswordHash())).isTrue();
    }

    @Test
    void laSobrecargaDeCuatroArgumentosNoExigeCambio() {
        Usuario usuario = servicio.crearUsuario("ana.torres", PASSWORD_VALIDA, Rol.ADMIN, null);

        assertThat(usuario.isDebeCambiarPassword()).isFalse();
        assertThat(usuario.getVersionToken()).isZero();
    }

    // --------------------------------------------------------- cambio de rol

    @Test
    void cambiarRolDoctorAEnfermeroActualizaVinculoEIndice() {
        Doctor doctor = (Doctor) trabajadorService.registrarTrabajador(
                "Carlos Mena", "Doctor", "Cardiologia", null);
        Enfermero enfermero = (Enfermero) trabajadorService.registrarTrabajador(
                "Lucia Vidal", "Enfermero", null, NivelExperiencia.NOVATO);
        Usuario usuario = servicio.crearUsuario("carlos.mena", PASSWORD_VALIDA, Rol.DOCTOR,
                doctor.getIdTrabajador());

        servicio.cambiarRol(usuario.getIdUsuario(), Rol.ENFERMERO, enfermero.getIdTrabajador(),
                SOLICITANTE);

        assertThat(usuario.getRol()).isEqualTo(Rol.ENFERMERO);
        assertThat(usuario.getIdTrabajador()).isEqualTo(enfermero.getIdTrabajador());
        assertThat(repositorio.buscarPorIdTrabajador(doctor.getIdTrabajador())).isNull();
        assertThat(repositorio.buscarPorIdTrabajador(enfermero.getIdTrabajador())).isSameAs(usuario);
    }

    @Test
    void cambiarRolAAdminExigeNoTenerTrabajador() {
        Doctor doctor = (Doctor) trabajadorService.registrarTrabajador(
                "Carlos Mena", "Doctor", "Cardiologia", null);
        Usuario usuario = servicio.crearUsuario("carlos.mena", PASSWORD_VALIDA, Rol.DOCTOR,
                doctor.getIdTrabajador());

        assertThatExceptionOfType(SolicitudInvalidaException.class)
                .isThrownBy(() -> servicio.cambiarRol(usuario.getIdUsuario(), Rol.ADMIN,
                        doctor.getIdTrabajador(), SOLICITANTE))
                .withMessage("El usuario administrador no puede estar vinculado a un trabajador.");
    }

    @Test
    void cambiarRolAOtroRolExigeTrabajadorExistenteYDelTipoCorrecto() {
        Usuario admin = servicio.crearUsuario("ana.torres", PASSWORD_VALIDA, Rol.ADMIN, null);
        servicio.crearUsuario("otro.admin", PASSWORD_VALIDA, Rol.ADMIN, null);
        Doctor doctor = (Doctor) trabajadorService.registrarTrabajador(
                "Carlos Mena", "Doctor", "Cardiologia", null);

        assertThatExceptionOfType(SolicitudInvalidaException.class)
                .isThrownBy(() -> servicio.cambiarRol(admin.getIdUsuario(), Rol.DOCTOR, null,
                        SOLICITANTE))
                .withMessage("El usuario con rol DOCTOR debe estar vinculado a un trabajador.");

        assertThatExceptionOfType(NotFoundException.class)
                .isThrownBy(() -> servicio.cambiarRol(admin.getIdUsuario(), Rol.DOCTOR, "DOC-9999",
                        SOLICITANTE))
                .withMessage("No se encontró el trabajador DOC-9999.");

        assertThatExceptionOfType(SolicitudInvalidaException.class)
                .isThrownBy(() -> servicio.cambiarRol(admin.getIdUsuario(), Rol.ENFERMERO,
                        doctor.getIdTrabajador(), SOLICITANTE))
                .withMessage("El trabajador DOC-0001 no es un Enfermero.");
        assertThat(admin.getRol()).isEqualTo(Rol.ADMIN);
    }

    @Test
    void cambiarRolAUnTrabajadorYaOcupadoPorOtroUsuarioDevuelveConflicto() {
        Doctor doctor = (Doctor) trabajadorService.registrarTrabajador(
                "Carlos Mena", "Doctor", "Cardiologia", null);
        Doctor otroDoctor = (Doctor) trabajadorService.registrarTrabajador(
                "Jorge Ruiz", "Doctor", "Neurologia", null);
        servicio.crearUsuario("carlos.mena", PASSWORD_VALIDA, Rol.DOCTOR, doctor.getIdTrabajador());
        Usuario segundo = servicio.crearUsuario("jorge.ruiz", PASSWORD_VALIDA, Rol.DOCTOR,
                otroDoctor.getIdTrabajador());

        assertThatExceptionOfType(ConflictoException.class)
                .isThrownBy(() -> servicio.cambiarRol(segundo.getIdUsuario(), Rol.DOCTOR,
                        doctor.getIdTrabajador(), SOLICITANTE))
                .withMessage("El trabajador DOC-0001 ya tiene un usuario.");
    }

    @Test
    void cambiarRolDeUsuarioInexistenteLanzaNotFound() {
        assertThatExceptionOfType(NotFoundException.class)
                .isThrownBy(() -> servicio.cambiarRol("USR-9999", Rol.ADMIN, null, SOLICITANTE))
                .withMessage("No se encontró el usuario USR-9999.");
    }

    @Test
    void noSePuedeQuitarElRolAdminAlUltimoAdministradorActivo() {
        Usuario admin = servicio.crearUsuario("admin.uno", PASSWORD_VALIDA, Rol.ADMIN, null);
        Doctor doctor = (Doctor) trabajadorService.registrarTrabajador(
                "Carlos Mena", "Doctor", "Cardiologia", null);

        // Por la API este caso no se alcanza: quien pide es un ADMIN activo, así
        // que el único administrador activo sería él mismo y lo atrapa antes la
        // regla del propio rol; la guarda se conserva como defensa del servicio.
        assertThatExceptionOfType(ConflictoException.class)
                .isThrownBy(() -> servicio.cambiarRol(admin.getIdUsuario(), Rol.DOCTOR,
                        doctor.getIdTrabajador(), SOLICITANTE))
                .withMessage("No se puede quitar el rol ADMIN al último administrador activo.");
        assertThat(admin.getRol()).isEqualTo(Rol.ADMIN);
        assertThat(repositorio.buscarPorIdTrabajador(doctor.getIdTrabajador())).isNull();
    }

    @Test
    void noSePuedeCambiarElPropioRol() {
        Usuario admin = servicio.crearUsuario("admin.uno", PASSWORD_VALIDA, Rol.ADMIN, null);
        // Con otro administrador activo: lo que rechaza no es la regla del último.
        servicio.crearUsuario("admin.dos", PASSWORD_VALIDA, Rol.ADMIN, null);
        Doctor doctor = (Doctor) trabajadorService.registrarTrabajador(
                "Carlos Mena", "Doctor", "Cardiologia", null);

        assertThatExceptionOfType(ConflictoException.class)
                .isThrownBy(() -> servicio.cambiarRol(admin.getIdUsuario(), Rol.DOCTOR,
                        doctor.getIdTrabajador(), admin.getUsername()))
                .withMessage("No puede cambiar su propio rol.");

        // La regla del propio rol se aplica antes de validar el trabajador: con un
        // trabajador inexistente también es 409 (y no el 404 de la validación).
        assertThatExceptionOfType(ConflictoException.class)
                .isThrownBy(() -> servicio.cambiarRol(admin.getIdUsuario(), Rol.DOCTOR,
                        "DOC-9999", admin.getUsername()))
                .withMessage("No puede cambiar su propio rol.");

        assertThat(admin.getRol()).isEqualTo(Rol.ADMIN);
        assertThat(admin.getIdTrabajador()).isNull();
        assertThat(repositorio.buscarPorIdTrabajador(doctor.getIdTrabajador())).isNull();
    }

    // ------------------------------------------------------- versión de token

    @Test
    void desactivarIncrementaLaVersionYReactivarNoLaToca() {
        servicio.crearUsuario("admin.uno", PASSWORD_VALIDA, Rol.ADMIN, null);
        Usuario adminDos = servicio.crearUsuario("admin.dos", PASSWORD_VALIDA, Rol.ADMIN, null);

        servicio.desactivar(adminDos.getIdUsuario(), "admin.uno");
        servicio.desactivar(adminDos.getIdUsuario(), "admin.uno");
        assertThat(adminDos.getVersionToken()).isEqualTo(1);

        // Reactivar devuelve el acceso, no la versión: los tokens anteriores siguen revocados.
        servicio.activar(adminDos.getIdUsuario());
        assertThat(adminDos.isActivo()).isTrue();
        assertThat(adminDos.getVersionToken()).isEqualTo(1);
    }

    @Test
    void restablecerPasswordIncrementaLaVersionYDejaElCambioPendiente() {
        Usuario usuario = servicio.crearUsuario("ana.torres", PASSWORD_VALIDA, Rol.ADMIN, null);

        String nueva = "temporal-clave-12345";
        servicio.restablecerPassword(usuario.getIdUsuario(), nueva);

        assertThat(usuario.getVersionToken()).isEqualTo(1);
        assertThat(usuario.isDebeCambiarPassword()).isTrue();
        assertThat(encoder.matches(nueva, usuario.getPasswordHash())).isTrue();
    }

    // ------------------------------------------------- cambio de password propia

    @Test
    void cambiarPasswordPropiaExigeLaActualYDifiereDeLaNueva() {
        Usuario usuario = servicio.crearUsuario("ana.torres", PASSWORD_VALIDA, Rol.ADMIN, null, true);

        assertThatExceptionOfType(SolicitudInvalidaException.class)
                .isThrownBy(() -> servicio.cambiarPasswordPropia(usuario.getIdUsuario(),
                        "equivocada", "otra-clave-larga"))
                .withMessage("La contraseña actual no es correcta.")
                .satisfies(ex -> assertThat(ex.getMessage()).doesNotContain("equivocada"));

        assertThatExceptionOfType(SolicitudInvalidaException.class)
                .isThrownBy(() -> servicio.cambiarPasswordPropia(usuario.getIdUsuario(),
                        PASSWORD_VALIDA, PASSWORD_VALIDA))
                .withMessage("La nueva contraseña debe ser diferente de la actual.");
        assertThat(usuario.getVersionToken()).isZero();
    }

    @Test
    void cambiarPasswordPropiaAplicaLaPoliticaCompleta() {
        Usuario usuario = servicio.crearUsuario("ana.torres.gil", PASSWORD_VALIDA, Rol.ADMIN, null);

        assertThatExceptionOfType(SolicitudInvalidaException.class)
                .isThrownBy(() -> servicio.cambiarPasswordPropia(usuario.getIdUsuario(),
                        PASSWORD_VALIDA, "corta"))
                .withMessage("La contraseña debe tener al menos 10 caracteres.");
        assertThatExceptionOfType(SolicitudInvalidaException.class)
                .isThrownBy(() -> servicio.cambiarPasswordPropia(usuario.getIdUsuario(),
                        PASSWORD_VALIDA, "ANA.TORRES.GIL"))
                .withMessage("La contraseña no puede ser igual al username.");
    }

    @Test
    void cambiarPasswordPropiaIncrementaLaVersionYQuitaElCambioPendiente() {
        Usuario usuario = servicio.crearUsuario("ana.torres", PASSWORD_VALIDA, Rol.ADMIN, null, true);

        String nueva = "nueva-clave-segura-10";
        servicio.cambiarPasswordPropia(usuario.getIdUsuario(), PASSWORD_VALIDA, nueva);

        assertThat(usuario.getVersionToken()).isEqualTo(1);
        assertThat(usuario.isDebeCambiarPassword()).isFalse();
        assertThat(encoder.matches(nueva, usuario.getPasswordHash())).isTrue();
        assertThat(encoder.matches(PASSWORD_VALIDA, usuario.getPasswordHash())).isFalse();
    }
}
