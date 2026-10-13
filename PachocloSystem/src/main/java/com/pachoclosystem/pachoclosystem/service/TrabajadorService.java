package com.pachoclosystem.pachoclosystem.service;

import com.pachoclosystem.pachoclosystem.exception.NotFoundException;
import com.pachoclosystem.pachoclosystem.exception.SolicitudInvalidaException;
import com.pachoclosystem.pachoclosystem.model.Doctor;
import com.pachoclosystem.pachoclosystem.model.Enfermero;
import com.pachoclosystem.pachoclosystem.model.NivelExperiencia;
import com.pachoclosystem.pachoclosystem.model.TrabajadorHospital;
import com.pachoclosystem.pachoclosystem.model.Usuario;
import com.pachoclosystem.pachoclosystem.repository.ITrabajadoresRepository;
import com.pachoclosystem.pachoclosystem.repository.IUsuarioRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class TrabajadorService {

    private static final Pattern PATRON_CONTIENE_TEXTO = Pattern.compile(".*[A-Za-zÁÉÍÓÚÑÜáéíóúñü].*");

    private final ITrabajadoresRepository repositorio;

    /**
     * Repositorio de usuarios para la cascada de desactivación. Se inyecta por
     * constructor y es obligatorio: sin él no hay cascada posible y el servicio
     * no debe poder construirse.
     */
    private final IUsuarioRepository usuarioRepository;

    public TrabajadorService(ITrabajadoresRepository repositorio, IUsuarioRepository usuarioRepository) {
        this.repositorio = Objects.requireNonNull(repositorio,
                "El repositorio de trabajadores es obligatorio.");
        this.usuarioRepository = Objects.requireNonNull(usuarioRepository,
                "El repositorio de usuarios es obligatorio para la cascada de desactivación.");
    }

    // El servicio genera el ID (con prefijo según el rol) y construye el objeto correcto.
    public TrabajadorHospital registrarTrabajador(String nombre, String rol, String especialidad,
                                                  NivelExperiencia nivel) {
        validarDatosDeRol(rol, especialidad, nivel);

        String prefijo = "Doctor".equals(rol) ? "DOC" : "ENF";
        String id = repositorio.generarNuevoId(prefijo);

        TrabajadorHospital trabajador = "Doctor".equals(rol)
                ? new Doctor(id, nombre.trim(), especialidad.trim())
                : new Enfermero(id, nombre.trim(), nivel);

        repositorio.guardarTrabajador(trabajador);
        return trabajador;
    }

    // En edición el id y el rol no cambian. Se lee bloqueando la fila: una edición
    // y un borrado simultáneos se aplican uno detrás de otro.
    @Transactional
    public TrabajadorHospital editarTrabajador(String id, String nombre, String rol, String especialidad,
                                               NivelExperiencia nivel) {
        TrabajadorHospital existente = repositorio.buscarPorIdParaActualizar(id);
        if (existente == null) {
            throw noEncontrado(id);
        }

        String rolActual = existente instanceof Doctor ? "Doctor" : "Enfermero";
        if (!rolActual.equals(rol)) {
            throw new SolicitudInvalidaException("El rol de un trabajador no puede cambiar (actual: " + rolActual + ").");
        }
        validarDatosDeRol(rol, especialidad, nivel);

        existente.setNombreCompleto(nombre.trim());
        if (existente instanceof Doctor d) {
            d.setEspecialidad(especialidad.trim());
        } else if (existente instanceof Enfermero e) {
            e.setNivelExperiencia(nivel);
        }
        if (!repositorio.actualizarTrabajador(existente)) {
            throw noEncontrado(id);
        }
        return existente;
    }

    @Transactional
    public void eliminarTrabajador(String id) {
        // Cascada y borrado en la misma transacción: si el borrado no encuentra el
        // trabajador (404) o algo falla, la desactivación del usuario también se
        // deshace. Si el trabajador no existe, la cascada no encuentra usuario.
        desactivarUsuarioVinculado(id);
        if (!repositorio.eliminarTrabajador(id)) {
            throw noEncontrado(id);
        }
    }

    /**
     * Cascada de desactivación: al eliminar un trabajador, su usuario
     * vinculado (si lo tiene) queda {@code activo=false} y su versión de
     * token se incrementa, de modo que sus tokens dejan de ser válidos de
     * inmediato y no vuelven a valer aunque alguien intente reactivar la
     * cuenta (el trabajador ya no existe, así que la reactivación se
     * rechaza). Si el trabajador no tiene usuario, no se toca nada.
     */
    private void desactivarUsuarioVinculado(String idTrabajador) {
        Usuario usuario = usuarioRepository.buscarPorIdTrabajador(idTrabajador);
        if (usuario != null) {
            // Idempotente: si ya estaba inactivo no cambia nada (ni la versión de token).
            usuarioRepository.desactivar(usuario.getIdUsuario());
        }
    }

    public TrabajadorHospital obtenerTrabajador(String id) {
        TrabajadorHospital t = repositorio.buscarPorId(id);
        if (t == null) {
            throw noEncontrado(id);
        }
        return t;
    }

    /** Lista trabajadores; si hay texto, filtra por id o nombre (sin distinguir mayúsculas). */
    public List<TrabajadorHospital> listarTrabajadores(String texto) {
        String filtro = texto == null ? "" : texto.trim().toLowerCase(Locale.ROOT);
        return repositorio.obtenerTodos().stream()
                .filter(t -> filtro.isEmpty()
                        || t.getNombreCompleto().toLowerCase(Locale.ROOT).contains(filtro)
                        || t.getIdTrabajador().toLowerCase(Locale.ROOT).contains(filtro))
                .toList();
    }

    /**
     * Nombres de los trabajadores indicados, indexados por su id, en
     * <strong>una sola</strong> lectura: se traen todos (igual que
     * {@link #listarTrabajadores(String)}; la plantilla de un hospital es pequeña)
     * y se filtran en memoria. Sirve para rellenar el nombre del trabajador de
     * varios usuarios sin una consulta por usuario (N+1).
     *
     * <p>Un id que ya no exista sencillamente no aparece en el mapa: el vínculo de
     * un usuario sobrevive a la baja de su trabajador (lo deja inactivo), así que
     * resolver su nombre no puede fallar.</p>
     */
    public Map<String, String> nombresPorId(Collection<String> idsTrabajador) {
        Set<String> buscados = idsTrabajador.stream().filter(Objects::nonNull).collect(Collectors.toSet());
        if (buscados.isEmpty()) {
            return Map.of();
        }
        // A propósito: se lee la plantilla completa (una sola consulta) y se filtra
        // en memoria, para resolver todos los ids de golpe. No lo "optimices" a una
        // consulta por id: eso sería N+1. La plantilla de un hospital es pequeña.
        return repositorio.obtenerTodos().stream()
                .filter(t -> buscados.contains(t.getIdTrabajador()))
                .collect(Collectors.toMap(TrabajadorHospital::getIdTrabajador,
                        TrabajadorHospital::getNombreCompleto));
    }

    private void validarDatosDeRol(String rol, String especialidad, NivelExperiencia nivel) {
        List<String> errores = new ArrayList<>();
        if ("Doctor".equals(rol)) {
            String esp = especialidad == null ? "" : especialidad.trim();
            if (esp.isEmpty()) {
                errores.add("La especialidad es obligatoria.");
            } else if (esp.length() < 3 || !PATRON_CONTIENE_TEXTO.matcher(esp).matches()) {
                errores.add("La especialidad debe ser un texto descriptivo (mínimo 3 caracteres).");
            }
        } else if ("Enfermero".equals(rol)) {
            if (nivel == null) {
                errores.add("Debe seleccionar un nivel de experiencia.");
            }
        } else {
            errores.add("Debe seleccionar un rol (Doctor o Enfermero).");
        }
        if (!errores.isEmpty()) {
            throw new SolicitudInvalidaException(errores);
        }
    }

    private NotFoundException noEncontrado(String id) {
        return new NotFoundException("No se encontró el trabajador " + id + ".");
    }
}
