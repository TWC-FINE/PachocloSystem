package com.pachoclosystem.pachoclosystem.security;

import com.pachoclosystem.pachoclosystem.controller.MockMvcBaseTest;
import com.pachoclosystem.pachoclosystem.model.NivelExperiencia;
import com.pachoclosystem.pachoclosystem.model.Rol;
import com.pachoclosystem.pachoclosystem.service.UsuarioService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MvcResult;

import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Login y /api/auth/me: emisión del token con los claims correctos, 401
 * uniforme para credenciales inválidas (indistinguible entre inexistente,
 * contraseña incorrecta y usuario desactivado) y 400 por Bean Validation.
 */
class AuthControllerTest extends MockMvcBaseTest {

    private static final String PASSWORD_ADMIN = "pwd-de-prueba-solo-tests-12345";
    private static final String PASSWORD_USUARIO = "password-segura-12345";
    private static final String PASSWORD_INCORRECTA = "la-contrasena-equivocada";

    @Autowired
    private JwtDecoder decodificador;

    @Autowired
    private UsuarioService usuarioService;

    @Test
    void loginValidoDevuelve200ConClaimsDelToken() throws Exception {
        MvcResult resultado = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"admin","password":"%s"}""".formatted(PASSWORD_ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tipo").value("Bearer"))
                .andExpect(jsonPath("$.rol").value("ADMIN"))
                .andExpect(jsonPath("$.expiraEnSegundos").value(1800L))
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andReturn();

        // El token se valida con el decodificador real de la aplicación.
        Jwt jwt = decodificador.decode(leer(resultado, "$.token"));
        assertThat(jwt.getSubject())
                .isEqualTo(repositorioUsuarios.buscarPorUsername("admin").getIdUsuario());
        assertThat(jwt.getClaimAsString("username")).isEqualTo("admin");
        assertThat(jwt.getClaimAsString("rol")).isEqualTo("ADMIN");
        assertThat(jwt.getClaimAsString("iss")).isEqualTo("pachoclosystem");
        long vigencia = ChronoUnit.SECONDS.between(jwt.getIssuedAt(), jwt.getExpiresAt());
        assertThat(vigencia).isBetween(1799L, 1801L);
    }

    @Test
    void loginConPasswordIncorrectaDevuelve401ConCuerpoUniforme() throws Exception {
        MvcResult resultado = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"admin","password":"%s"}""".formatted(PASSWORD_INCORRECTA)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.error").value("Unauthorized"))
                .andExpect(jsonPath("$.mensajes", hasSize(1)))
                .andExpect(jsonPath("$.mensajes[0]").value("Credenciales inválidas."))
                .andReturn();

        assertThat(resultado.getResponse().getContentAsString())
                .doesNotContain("Exception")
                .doesNotContain("trace")
                .doesNotContain("BadCredentials");
    }

    @Test
    void loginDeUsuarioInexistenteDevuelveElMismoCuerpo401() throws Exception {
        MvcResult resultado = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"nadie.registrado","password":"%s"}""".formatted(PASSWORD_INCORRECTA)))
                .andExpect(status().isUnauthorized())
                .andReturn();

        assertThat(resultado.getResponse().getContentAsString())
                .isEqualTo(cuerpo401ConPasswordIncorrecta());
    }

    @Test
    void loginDeUsuarioInactivoDevuelveElMismoCuerpo401() throws Exception {
        String enfermera = registrarEnfermero("Maria Lopez", NivelExperiencia.AVANZADO);
        String username = "inactiva." + System.nanoTime();
        usuarioService.crearUsuario(username, PASSWORD_USUARIO, Rol.ENFERMERO, enfermera);
        repositorioUsuarios.desactivar(repositorioUsuarios.buscarPorUsername(username).getIdUsuario());

        MvcResult resultado = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s"}""".formatted(username, PASSWORD_USUARIO)))
                .andExpect(status().isUnauthorized())
                .andReturn();

        assertThat(resultado.getResponse().getContentAsString())
                .isEqualTo(cuerpo401ConPasswordIncorrecta());
    }

    @Test
    void loginSinPasswordDevuelve400Uniforme() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"admin"}"""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.mensajes[0]").value("La contraseña es obligatoria."));
    }

    @Test
    void loginConPasswordEnBlancoDevuelve400() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"admin","password":"   "}"""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void meConTokenValidoDevuelveElUsuarioSinRastroDelHash() throws Exception {
        String token = tokenDelLogin("admin", PASSWORD_ADMIN);
        String idAdmin = repositorioUsuarios.buscarPorUsername("admin").getIdUsuario();

        MvcResult resultado = mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idUsuario").value(idAdmin))
                .andExpect(jsonPath("$.username").value("admin"))
                .andExpect(jsonPath("$.rol").value("ADMIN"))
                .andExpect(jsonPath("$.activo").value(true))
                .andReturn();

        assertThat(resultado.getResponse().getContentAsString())
                .doesNotContain("passwordHash")
                .doesNotContain("getPasswordHash")
                .doesNotContain("$2a$10$");
    }

    @Test
    void meDevuelveElNombreCompletoDelTrabajadorVinculadoYNullSinVinculo() throws Exception {
        String idDoctor = registrarDoctor("Ana Gil", "Cardiologia");
        String tokenDoctor = tokenDeTrabajador(Rol.DOCTOR, idDoctor);

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + tokenDoctor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idTrabajador").value(idDoctor))
                .andExpect(jsonPath("$.nombreCompleto").value("Ana Gil"));

        // El administrador no está vinculado a ningún trabajador: null, no inventado.
        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + tokenAdmin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idTrabajador", nullValue()))
                .andExpect(jsonPath("$.nombreCompleto", nullValue()));
    }

    @Test
    void meSinTokenDevuelve401Uniforme() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.error").value("Unauthorized"))
                .andExpect(jsonPath("$.mensajes[0]")
                        .value("Debe autenticarse para acceder a este recurso."));
    }

    private String cuerpo401ConPasswordIncorrecta() throws Exception {
        MvcResult resultado = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"admin","password":"%s"}""".formatted(PASSWORD_INCORRECTA)))
                .andExpect(status().isUnauthorized())
                .andReturn();
        return resultado.getResponse().getContentAsString();
    }

    private String tokenDelLogin(String username, String password) throws Exception {
        MvcResult resultado = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s"}""".formatted(username, password)))
                .andExpect(status().isOk())
                .andReturn();
        return leer(resultado, "$.token");
    }
}