package com.pachoclosystem.pachoclosystem.controller;

import com.pachoclosystem.pachoclosystem.model.NivelExperiencia;
import com.pachoclosystem.pachoclosystem.model.Rol;
import com.pachoclosystem.pachoclosystem.model.Usuario;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Gestión de usuarios por la API, de extremo a extremo y con tokens JWT
 * reales: privilegios de administrador, alta con cambio obligatorio, bloqueo
 * hasta cambiar la contraseña, revocación de tokens, cambio de rol, activar y desactivar,
 * reset administrativo y ausencia total de secretos en las respuestas.
 */
class UsuarioApiGestionTest extends MockMvcBaseTest {

    private static final String PASSWORD_ADMIN = "pwd-de-prueba-solo-tests-12345";
    private static final String MENSAJE_CAMBIO_PENDIENTE =
            "Debe cambiar su contraseña antes de continuar.";
    private static final String MENSAJE_403 =
            "No tiene permisos para realizar esta operación.";

    @Autowired
    private JwtDecoder jwtDecoder;

    // ------------------------------------------------------------------
    // Privilegios: la gestión de usuarios es solo de administradores
    // ------------------------------------------------------------------

    @Test
    void laGestionDeUsuariosEsSoloDeAdministradores() throws Exception {
        mockMvc.perform(get("/api/usuarios"))
                .andExpect(status().isUnauthorized());

        performComo(Rol.DOCTOR, get("/api/usuarios"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.mensajes[0]").value(MENSAJE_403));
        performComo(Rol.ENFERMERO, get("/api/usuarios"))
                .andExpect(status().isForbidden());

        perform(get("/api/usuarios"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rol").value("ADMIN"));
    }

    // ------------------------------------------------------------------
    // Alta con cambio obligatorio y bloqueo hasta cambiar la contraseña
    // ------------------------------------------------------------------

    @Test
    void elAltaNaceConCambioObligatorioBloqueaYElCambioPropioDesbloqueaYRevoca() throws Exception {
        String doctor = registrarDoctor("Carlos Mena", "Cardiologia");
        String username = "nuevo.doc" + sufijo();
        String temporal = "temporal-doc-1234567";
        String definitiva = "definitiva-doc-98765";

        // Alta por API.
        MvcResult alta = perform(post("/api/usuarios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s","rol":"DOCTOR","idTrabajador":"%s"}"""
                                .formatted(username, temporal, doctor)))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", containsString("/api/usuarios/")))
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.rol").value("DOCTOR"))
                .andExpect(jsonPath("$.activo").value(true))
                .andExpect(jsonPath("$.debeCambiarPassword").value(true))
                .andExpect(content().string(not(containsString(temporal))))
                .andReturn();
        String idUsuario = leer(alta, "$.idUsuario");

        // La contraseña tampoco aparece en ningún otro punto de la gestión.
        perform(get("/api/usuarios/{id}", idUsuario))
                .andExpect(content().string(not(containsString(temporal))));
        perform(get("/api/usuarios"))
                .andExpect(content().string(not(containsString(temporal))));

        // El usuario entra con la temporal, ve su identidad y su estado pendiente,
        // pero cualquier ruta de negocio le responde 403 con el aviso.
        String tokenTemporal = leer(login(username, temporal), "$.token");

        mockMvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenTemporal))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.debeCambiarPassword").value(true));

        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenTemporal))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.mensajes[0]").value(MENSAJE_CAMBIO_PENDIENTE));

        // Cambia su contraseña: el token que acaba de usar queda revocado.
        mockMvc.perform(post("/api/auth/password")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenTemporal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"passwordActual":"%s","passwordNueva":"%s"}"""
                                .formatted(temporal, definitiva)))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenTemporal))
                .andExpect(status().isUnauthorized());

        // Con la definitiva vuelve a entrar, ya sin pendiente, y sus tokens valen.
        MvcResult segundoLogin = login(username, definitiva);
        String tokenDefinitivo = leer(segundoLogin, "$.token");

        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenDefinitivo))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenDefinitivo))
                .andExpect(jsonPath("$.debeCambiarPassword").value(false));

        // La versión del token cambió con la contraseña (revocación por diseño).
        assertThat(versionDe(tokenTemporal)).isZero();
        assertThat(versionDe(tokenDefinitivo)).isEqualTo(1L);

        // La gestión sigue sin mostrar el hash ni la contraseña definitiva.
        perform(get("/api/usuarios/{id}", idUsuario))
                .andExpect(content().string(not(containsString(definitiva))))
                .andExpect(content().string(not(containsString("$2"))));
    }

    @Test
    void elCambioDePasswordPropioRechazaActualErroneaIgualOCortaSinRevelarNada() throws Exception {
        String nueva = "nueva-clave-segura-10";
        String token = leer(login("admin", PASSWORD_ADMIN), "$.token");

        for (String cuerpo : new String[]{
                // Actual errónea.
                "{\"passwordActual\":\"incorrecta\",\"passwordNueva\":\"" + nueva + "\"}",
                // Nueva igual a la actual.
                "{\"passwordActual\":\"" + PASSWORD_ADMIN + "\",\"passwordNueva\":\"" + PASSWORD_ADMIN + "\"}",
                // Nueva demasiado corta.
                "{\"passwordActual\":\"" + PASSWORD_ADMIN + "\",\"passwordNueva\":\"corta\"}"}) {
            mockMvc.perform(post("/api/auth/password")
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(cuerpo))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.mensajes", hasSize(1)))
                    .andExpect(content().string(not(containsString(PASSWORD_ADMIN))))
                    .andExpect(content().string(not(containsString(nueva))))
                    .andExpect(content().string(not(containsString("corta"))));
        }
    }

    @Test
    void elCambioDePasswordExigeEstarAutenticado() throws Exception {
        mockMvc.perform(post("/api/auth/password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passwordActual\":\"cualquiera\",\"passwordNueva\":\"nueva-clave-segura\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------
    // Reset administrativo: pendiente + revocación inmediata
    // ------------------------------------------------------------------

    @Test
    void elResetAdministrativoDejaElCambioPendienteYRevocaLosTokensExistentes() throws Exception {
        String enfermera = registrarEnfermero("Lucia Vidal", NivelExperiencia.NOVATO);
        String username = "enfermera.rev" + sufijo();
        String inicial = "inicial-clave-12345";
        String temporal = "temporal-reset-12345";

        // Alta directa por el servicio (sin pendiente), como las altas de
        // bootstrap: el reset administrativo debe ser quien fije la pendiente.
        usuarioService.crearUsuario(username, inicial, Rol.ENFERMERO, enfermera);
        String idUsuario = idDe(username);

        // Con su contraseña actual circula con normalidad.
        String tokenAntiguo = leer(login(username, inicial), "$.token");
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenAntiguo))
                .andExpect(status().isOk());

        // Reset administrativo: la cuenta queda pendiente y el token anterior muere.
        perform(patch("/api/usuarios/{id}/password", idUsuario)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"" + temporal + "\"}"))
                .andExpect(status().isNoContent());
        perform(get("/api/usuarios/{id}", idUsuario))
                .andExpect(jsonPath("$.debeCambiarPassword").value(true));

        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenAntiguo))
                .andExpect(status().isUnauthorized());

        // Con la temporal entra, pero queda bloqueada hasta cambiarla.
        String tokenTemporal = leer(login(username, temporal), "$.token");
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenTemporal))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.mensajes[0]").value(MENSAJE_CAMBIO_PENDIENTE));

        // Hasta que la cambia y recupera el acceso.
        mockMvc.perform(post("/api/auth/password")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenTemporal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passwordActual\":\"" + temporal
                                + "\",\"passwordNueva\":\"definitiva-final-10\"}"))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"definitiva-final-10\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.debeCambiarPassword").value(false));

        // Ninguna respuesta ha expuesto las contraseñas ni el hash.
        perform(get("/api/usuarios"))
                .andExpect(content().string(not(containsString(inicial))))
                .andExpect(content().string(not(containsString(temporal))))
                .andExpect(content().string(not(containsString("definitiva-final-10"))))
                .andExpect(content().string(not(containsString("$2"))));
    }

    // ------------------------------------------------------------------
    // Cambio de rol y de estado
    // ------------------------------------------------------------------

    @Test
    void elCambioDeRolPorApiActualizaElVinculoYLiberaElTrabajadorAnterior() throws Exception {
        String doctor = registrarDoctor("Carlos Mena", "Cardiologia");
        String enfermera = registrarEnfermero("Lucia Vidal", NivelExperiencia.NOVATO);
        String username = "rol.cambio" + sufijo();
        performsAlta(username, "DOCTOR", doctor, "password-rol-12345");
        String idUsuario = idDe(username);

        perform(patch("/api/usuarios/{id}/rol", idUsuario)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rol\":\"ENFERMERO\",\"idTrabajador\":\"" + enfermera + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rol").value("ENFERMERO"))
                .andExpect(jsonPath("$.idTrabajador").value(enfermera));

        // El trabajador anterior queda libre.
        assertThat(repositorioUsuarios.buscarPorIdTrabajador(doctor)).isNull();
        assertThat(repositorioUsuarios.buscarPorIdTrabajador(enfermera))
                .extracting(Usuario::getIdUsuario)
                .isEqualTo(idUsuario);
    }

    @Test
    void elCambioDeRolIlegalSeRechazaConMensajeUniforme() throws Exception {
        String doctor = registrarDoctor("Carlos Mena", "Cardiologia");
        String username = "rol.invalido" + sufijo();
        performsAlta(username, "DOCTOR", doctor, "password-rol-12345");
        String idUsuario = idDe(username);

        perform(patch("/api/usuarios/{id}/rol", idUsuario)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rol\":\"FANTASMA\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.mensajes[0]")
                        .value("Debe seleccionar un rol (ADMIN, DOCTOR o ENFERMERO)."));
    }

    @Test
    void elAdminNoPuedeDesactivarseNiCambiarseElRolASiMismo() throws Exception {
        String idAdmin = repositorioUsuarios.buscarPorUsername("admin").getIdUsuario();

        perform(patch("/api/usuarios/{id}/desactivar", idAdmin))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.mensajes[0]").value("No puede desactivar su propio usuario."));

        // El cambio de rol sobre uno mismo también se rechaza. La guarda del
        // último administrador activo es inalcanzable por la API (quien pide es un
        // ADMIN activo, así que el único activo sería él mismo y salta antes la
        // regla del propio rol): se cubre en UsuarioServiceGestionTest.
        String doctor = registrarDoctor("Carlos Mena", "Cardiologia");
        perform(patch("/api/usuarios/{id}/rol", idAdmin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rol\":\"DOCTOR\",\"idTrabajador\":\"" + doctor + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.mensajes[0]").value("No puede cambiar su propio rol."));

        // Sigue intacto y operativo.
        assertThat(repositorioUsuarios.buscarPorId(idAdmin).getRol()).isEqualTo(Rol.ADMIN);
        perform(get("/api/usuarios")).andExpect(status().isOk());
    }

    @Test
    void elAdminNoPuedeCambiarSuPropioRolAunqueHayaOtrosAdministradores() throws Exception {
        // Segundo ADMIN activo: lo que rechaza es la regla del propio rol, no la
        // del último administrador activo.
        Usuario segundo = usuarioService.crearUsuario("admin.dos" + sufijo(),
                "password-segunda-10", Rol.ADMIN, null);
        String doctor = registrarDoctor("Carlos Mena", "Cardiologia");

        performConToken(tokenService.generarToken(segundo),
                patch("/api/usuarios/{id}/rol", segundo.getIdUsuario())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rol\":\"DOCTOR\",\"idTrabajador\":\"" + doctor + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.mensajes[0]").value("No puede cambiar su propio rol."));

        assertThat(repositorioUsuarios.buscarPorId(segundo.getIdUsuario()).getRol())
                .isEqualTo(Rol.ADMIN);
    }

    @Test
    void desactivarPorLaApiDejaAlUsuarioFueraYReactivarloLoDevuelve() throws Exception {
        String enfermera = registrarEnfermero("Lucia Vidal", NivelExperiencia.NOVATO);
        String username = "estado.ciclo" + sufijo();
        // Alta directa por el servicio (sin pendiente): este test cubre el ciclo
        // de estado, no el flag de cambio de contraseña.
        usuarioService.crearUsuario(username, "password-estado-123", Rol.ENFERMERO, enfermera);
        String idUsuario = idDe(username);
        String token = leer(login(username, "password-estado-123"), "$.token");

        perform(patch("/api/usuarios/{id}/desactivar", idUsuario))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activo").value(false));

        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"password-estado-123\"}"))
                .andExpect(status().isUnauthorized());

        perform(patch("/api/usuarios/{id}/activar", idUsuario))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activo").value(true));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"password-estado-123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.debeCambiarPassword").value(false));
    }

    @Test
    void desactivarRevocaElTokenYReactivarNoLoResucita() throws Exception {
        String doctor = registrarDoctor("Carlos Mena", "Cardiologia");
        String username = "token.revoca" + sufijo();
        // Alta directa por el servicio (sin pendiente): solo cubre el ciclo de
        // estado y la revocación de tokens, no el flag de cambio de contraseña.
        usuarioService.crearUsuario(username, "password-estado-123", Rol.DOCTOR, doctor);
        String idUsuario = idDe(username);
        String tokenA = leer(login(username, "password-estado-123"), "$.token");

        // El token A vale antes de la desactivación.
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk());

        // ADMIN desactiva: la cuenta queda inactiva y el token A se revoca.
        perform(patch("/api/usuarios/{id}/desactivar", idUsuario))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activo").value(false));
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isUnauthorized());

        // ADMIN reactiva: la cuenta vuelve, pero el token A NO se resucita
        // (la versión no se restaura).
        perform(patch("/api/usuarios/{id}/activar", idUsuario))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activo").value(true));
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isUnauthorized());

        // Un login nuevo emite el token B con versión mayor, y ese sí funciona.
        String tokenB = leer(login(username, "password-estado-123"), "$.token");
        assertThat(versionDe(tokenB)).isEqualTo(versionDe(tokenA) + 1L);
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                .andExpect(status().isOk());
    }

    @Test
    void eliminarElTrabajadorDesactivaAlUsuarioYSuTokenNoVuelveNunca() throws Exception {
        String doctor = registrarDoctor("Carlos Mena", "Cardiologia");
        String username = "cascada.token" + sufijo();
        usuarioService.crearUsuario(username, "password-estado-123", Rol.DOCTOR, doctor);
        String idUsuario = idDe(username);
        String tokenA = leer(login(username, "password-estado-123"), "$.token");

        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk());

        // El ADMIN elimina el trabajador: la cascada desactiva al usuario con
        // versión +1 (revocación permanente, verificable en el repositorio).
        perform(delete("/api/trabajadores/{id}", doctor))
                .andExpect(status().isNoContent());

        Usuario usuario = repositorioUsuarios.buscarPorUsername(username);
        assertThat(usuario).isNotNull();
        assertThat(usuario.isActivo()).isFalse();
        assertThat(usuario.getVersionToken()).isEqualTo(1);

        // El token A queda muerto.
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isUnauthorized());

        // Se intenta reactivar por API: se rechaza por huérfano y el token A
        // sigue sin valer (aunque el estado se hubiera revertido, la versión
        // no se restaura).
        perform(patch("/api/usuarios/{id}/activar", idUsuario))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.mensajes[0]")
                        .value("No se puede activar el usuario " + username + ": su trabajador "
                                + doctor + " ya no existe."));
        mockMvc.perform(get("/api/pacientes").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------
    // Reglas de alta y formularios uniformes
    // ------------------------------------------------------------------

    @Test
    void elAltaAplicaLasMismasReglasQueElServicioYNuncaRevelaLaPassword() throws Exception {
        String username = "reglas.alta" + sufijo();
        String passwordCorta = "corto";

        perform(post("/api/usuarios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username
                                + "\",\"password\":\"" + passwordCorta + "\",\"rol\":\"ADMIN\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.mensajes[0]")
                        .value("La contraseña debe tener al menos 10 caracteres."))
                .andExpect(content().string(not(containsString(passwordCorta))));

        perform(post("/api/usuarios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"password-larga-10\",\"rol\":\"DOCTOR\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.mensajes[0]")
                        .value("El usuario con rol DOCTOR debe estar vinculado a un trabajador."));

        perform(post("/api/usuarios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"password-larga-10\",\"rol\":\"NO_EXISTE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.mensajes[0]")
                        .value("Debe seleccionar un rol (ADMIN, DOCTOR o ENFERMERO)."));

        // Alta duplicada.
        performsAlta(username, "ADMIN", null, "password-larga-10");
        perform(post("/api/usuarios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"password-larga-10\",\"rol\":\"ADMIN\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.mensajes[0]")
                        .value("Ya existe un usuario con el username " + username + "."));
    }

    // ------------------------------------------------------------------
    // Apoyo
    // ------------------------------------------------------------------

    private void performsAlta(String username, String rol, String idTrabajador, String password) throws Exception {
        String trabajador = idTrabajador == null ? "" : ",\"idTrabajador\":\"" + idTrabajador + "\"";
        perform(post("/api/usuarios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"" + password
                                + "\",\"rol\":\"" + rol + "\"" + trabajador + "}"))
                .andExpect(status().isCreated());
    }

    private String idDe(String username) {
        Usuario usuario = repositorioUsuarios.buscarPorUsername(username);
        assertThat(usuario).as("usuario %s creado", username).isNotNull();
        return usuario.getIdUsuario();
    }

    private MvcResult login(String username, String password) throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
    }

    private long versionDe(String token) {
        return jwtDecoder.decode(token).getClaim("ver");
    }

    private static String sufijo() {
        return "." + Long.toHexString(System.nanoTime());
    }
}