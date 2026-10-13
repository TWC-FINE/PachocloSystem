# PachocloSystem

API REST (Spring Boot 4.1.1) para gestionar pacientes, trabajadores y el historial clínico de un hospital.
Migrada desde una aplicación Swing con arquitectura MVC.

## Requisitos

- **Java 25** (`JAVA_HOME` debe apuntar a un JDK 25; el `pom.xml` fija `java.version=25`).
- No hace falta instalar Maven: se usa el wrapper incluido.
- **PostgreSQL** (probado con la 18) con las bases `pachoclosystem` y `pachoclosystem_test` (ver
  [Base de datos](#base-de-datos)).

## Cómo arrancar

```bash
./mvnw spring-boot:run        # Linux / macOS / Git Bash
mvnw.cmd spring-boot:run      # Windows (cmd / PowerShell)
```

La API queda en `http://localhost:8080`. Otros comandos útiles:

```bash
./mvnw clean compile          # compilar
./mvnw test                   # ejecutar pruebas
```

Sin `PACHOCLOSYSTEM_DB_PASSWORD` (o sin PostgreSQL) la aplicación no arranca.

## Base de datos

PostgreSQL, con las tablas creadas por **Flyway** al arrancar (`src/main/resources/db/migration`):

| Migración | Tabla | Contenido |
|---|---|---|
| `V1` | `pacientes` | Un paciente por fila; `activo = false` es la baja lógica. Ids `PAC-0001` de la secuencia `pacientes_id_seq` |
| `V2` | `trabajadores` | Doctores y enfermeros en una tabla con la columna `tipo`. Ids `DOC-0001` y `ENF-0001` de sus propias secuencias |
| `V3` | `usuarios` | Username único, hash BCrypt, versión de token, cambio de contraseña pendiente, rol y trabajador vinculado (único, sin clave foránea). Ids `USR-0001` |
| `V4` | `registros_clinicos` | El historial. Cada registro guarda una **copia del autor** tal como era al firmarlo (sin clave foránea al trabajador) |
| `V5` | `historial_idempotencia` | Claves `Idempotency-Key` del historial con el registro creado (JSONB) o sin él si el resultado fue incierto |

| Variable de entorno | Propiedad | Por defecto |
|---|---|---|
| `PACHOCLOSYSTEM_DB_URL` | `spring.datasource.url` | `jdbc:postgresql://localhost:5432/pachoclosystem` |
| `PACHOCLOSYSTEM_DB_USER` | `spring.datasource.username` | `pachoclosystem_app` |
| `PACHOCLOSYSTEM_DB_PASSWORD` | `spring.datasource.password` | *(sin valor en el repo)* |
| `PACHOCLOSYSTEM_DB_POOL` | `spring.datasource.hikari.maximum-pool-size` | `10` |

Los tests usan **otra base**, `pachoclosystem_test` (`PACHOCLOSYSTEM_TEST_DB_URL`,
`PACHOCLOSYSTEM_TEST_DB_USER` y `PACHOCLOSYSTEM_TEST_DB_PASSWORD`, en
`src/test/resources/config/application.properties`, que se suma a la configuración principal).
Cada contexto de Spring de los tests arranca con el esquema recreado y los tests MockMvc la vacían
antes de cada prueba. Por seguridad se niegan a
tocar una base cuyo nombre no termine en `_test`.

Para crear las dos bases en un PostgreSQL local, como superusuario (cambie la contraseña):

```sql
CREATE ROLE pachoclosystem_app LOGIN PASSWORD '<contraseña>';
CREATE DATABASE pachoclosystem OWNER pachoclosystem_app ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE pachoclosystem_test OWNER pachoclosystem_app ENCODING 'UTF8' TEMPLATE template0;
```

**Transacciones y concurrencia.** Las reglas que antes dependían de cerrojos en memoria las aplica
ahora la base:

- Username y trabajador vinculado únicos: restricciones `UNIQUE` (dos altas simultáneas, un `409`).
- Último administrador activo: desactivar, activar y cambiar de rol van en una transacción con un
  *advisory lock* de PostgreSQL y el usuario bloqueado (`FOR UPDATE`).
- Cambios de contraseña: el usuario se bloquea (`FOR UPDATE`) y hash y versión de token cambian en un
  solo `UPDATE`; el login lee hash y versión en una sola consulta, así que un login simultáneo con la
  contraseña anterior nunca deja un token válido.
- Editar, cambiar de habitación y dar de baja un paciente son un único `UPDATE ... WHERE activo`.
- El registro clínico y su clave de idempotencia se guardan en la **misma transacción**; la salida de
  stock en MedicamentosService se pide antes, fuera de la transacción.
- Esperas acotadas: `connection-timeout` de 3 s y `lock_timeout` de 3 s.

**Base de datos no disponible.** Con la aplicación en marcha, cualquier petición responde `503`
"El servicio no puede acceder a sus datos en este momento. Vuelva a intentarlo más tarde.", también
las que llevan un token válido (nunca `401`, que cerraría la sesión en el frontend).

## Producción

Los valores por defecto son de **desarrollo**. En producción se arranca con el perfil `prod`
(`SPRING_PROFILES_ACTIVE=prod`, archivo `application-prod.properties`), que:

- **No arranca sin su configuración** (`ValidacionProduccion`, antes de conectar con la base). El
  error enumera todo lo que falta, con el nombre de cada variable y nunca su valor:
  - `JWT_SECRET` (mínimo 32 bytes);
  - `MEDICAMENTOS_API_KEY` (mínimo 32 caracteres, la misma en MedicamentosService);
  - `MEDICAMENTOS_URL` y `PACHOCLOSYSTEM_DB_URL` que no apunten a localhost;
  - `PACHOCLOSYSTEM_DB_PASSWORD`;
  - `CORS_ORIGENES` con el origen https del frontend;
  - `ADMIN_PASSWORD` mientras el administrador no exista (no se genera una aleatoria que quedaría
    en el log).
- Escribe los **logs en JSON** (formato ECS) por la salida estándar.

Sin el perfil, todo funciona como siempre (desarrollo y tests).

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP (lo asigna la plataforma) |
| `APP_ZONA_HORARIA` | `America/Bogota` | Zona horaria oficial: la fecha de los registros clínicos sale de ella, no de la del servidor. Una zona inválida impide arrancar |
| `SPRING_PROFILES_ACTIVE` | *(ninguno)* | `prod` en producción |

**Health checks** (públicos, sin token y sin detalles; ningún otro endpoint de Actuator está
expuesto):

| Ruta | Responde |
|---|---|
| `GET /actuator/health` | `200 {"status":"UP"}`, o `503 {"status":"DOWN"}` si la base no está disponible |
| `GET /actuator/health/liveness` | `200` mientras el proceso responda (no depende de la base) |
| `GET /actuator/health/readiness` | `200` si puede atender peticiones; `503` sin base de datos |

**Una sola instancia.** El límite de intentos de login y el orden de las peticiones con la misma
`Idempotency-Key` viven en la memoria del proceso: hay que desplegar **una réplica**.

## Estructura

```
src/main/java/com/pachoclosystem/pachoclosystem/
├── controller/   endpoints REST
├── service/      lógica de negocio y validaciones
├── repository/   acceso a PostgreSQL (JdbcClient)
├── model/        entidades (Paciente, Doctor, Enfermero, RegistroClinico, Usuario, Rol, ...)
├── dto/          requests y responses
├── config/       configuración (seguridad, JWT, PasswordEncoder, admin inicial y cliente de medicamentos)
├── security/     JWT, entry point 401/403 y login
├── client/       cliente HTTP de MedicamentosService
└── exception/    errores y @RestControllerAdvice
```

## Endpoints

### Pacientes — `/api/pacientes`

| Método | Ruta | Descripción | Rol | Respuestas |
|---|---|---|---|---|
| GET | `/api/pacientes?q=` | Lista pacientes; `q` filtra por id o nombre | Cualquiera | 200 |
| GET | `/api/pacientes/{id}` | Obtiene un paciente | Cualquiera | 200 / 404 |
| POST | `/api/pacientes` | Registra un paciente `{nombre, edad, habitacion}` | ADMIN / DOCTOR | 201 / 400 / 403 |
| PUT | `/api/pacientes/{id}` | Edita nombre, edad y habitación | ADMIN / DOCTOR | 200 / 400 / 403 / 404 |
| PATCH | `/api/pacientes/{id}/habitacion` | Cambia solo la habitación `{habitacion}` | Cualquiera | 200 / 400 / 404 |
| DELETE | `/api/pacientes/{id}` | Baja lógica de un paciente (ver abajo) | ADMIN | 204 / 403 / 404 |

**Baja lógica de pacientes.** `DELETE /api/pacientes/{id}` marca al paciente
como inactivo en lugar de borrarlo: el paciente y su historial clínico se
conservan en la base de datos. A partir de ahí el paciente se comporta como
inexistente (404 en `GET`/`PUT`/`PATCH`/historial y en un segundo `DELETE`) y
no se reactiva. Las bajas dobles devuelven 404. Sus registros dejan de
aparecer en el historial general. Si se da de baja mientras se espera la salida
de stock de un registro de `MEDICACION`, el registro se añade al paciente, que
sigue de baja.

### Trabajadores — `/api/trabajadores`

| Método | Ruta | Descripción | Rol | Respuestas |
|---|---|---|---|---|
| GET | `/api/trabajadores?q=` | Lista trabajadores; `q` filtra por id o nombre | ADMIN / DOCTOR | 200 / 403 |
| GET | `/api/trabajadores/{id}` | Obtiene un trabajador | ADMIN / DOCTOR | 200 / 403 / 404 |
| POST | `/api/trabajadores` | Registra `{nombre, rol: "Doctor"\|"Enfermero", especialidad?, nivelExperiencia?}` | ADMIN | 201 / 400 / 403 |
| PUT | `/api/trabajadores/{id}` | Edita un trabajador (el rol no puede cambiar) | ADMIN | 200 / 400 / 403 / 404 |
| DELETE | `/api/trabajadores/{id}` | Elimina un trabajador y desactiva su usuario | ADMIN | 204 / 403 / 404 |

Un Doctor requiere `especialidad`; un Enfermero requiere `nivelExperiencia` (`NOVATO`, `PRINCIPIANTE`, `AVANZADO`).

### Historial clínico

| Método | Ruta | Descripción | Rol | Respuestas |
|---|---|---|---|---|
| GET | `/api/historial?filtro=&q=` | Todos los registros ordenados por fecha. `filtro`: `todos` (defecto), `paciente` o `autor` | Cualquiera | 200 / 400 |
| GET | `/api/pacientes/{id}/historial?q=` | Registros de un paciente; `q` filtra por autor | Cualquiera | 200 / 404 |
| POST | `/api/pacientes/{id}/historial` | Agrega un registro firmado por el usuario autenticado. Cabecera opcional `Idempotency-Key` (ver [Registros idempotentes](#registros-idempotentes-idempotency-key)) | DOCTOR / ENFERMERO (ver abajo) | 201 / 400 / 403 / 404 / 409 / 502 / 503 |

Cuerpo de `POST /api/pacientes/{id}/historial`:

```json
{ "tipo": "DIAGNOSTICO", "contenido": "Hipertensión leve" }
```

**El autor es siempre el trabajador del usuario autenticado** (se relee del
repositorio en cada petición, nunca de los claims del token):

- `idAutor` es opcional y se acepta por compatibilidad: si viene y no es el
  trabajador del usuario, `400`.
- Un usuario sin trabajador vinculado (el ADMIN) no puede crear registros: `403`
  "Solo un usuario vinculado a un trabajador puede crear registros."
- El rol limita el tipo: el doctor crea los cuatro; el enfermero, todos menos
  `DIAGNOSTICO` (`403` "Su rol no puede crear registros de tipo DIAGNOSTICO.").

`tipo` puede ser `DIAGNOSTICO`, `EVOLUCION`, `MEDICACION` o `SIGNOS_VITALES`. Para `SIGNOS_VITALES` se envía `signosVitales` en lugar de `contenido`:

```json
{
  "tipo": "SIGNOS_VITALES",
  "signosVitales": {
    "temperatura": 36.5, "frecCardiaca": 80,
    "presionSistolica": 120, "presionDiastolica": 80,
    "frecRespiratoria": 16, "saturacion": 98, "observaciones": "estable"
  }
}
```

Un registro `MEDICACION` puede además descontar stock del inventario indicando `idMedicamento` y
`cantidad` (los dos juntos; ver [Integración con MedicamentosService](#integración-con-medicamentosservice)).
Lo puede pedir cualquiera que pueda crear el registro (doctor o enfermero), aunque no tenga acceso a
`/api/medicamentos/{id}/salidas`: el descuento lo hace el servicio con su cliente interno.

```json
{ "tipo": "MEDICACION", "contenido": "Paracetamol 500 mg vía oral",
  "idMedicamento": "MED-0001", "cantidad": 2 }
```

#### Registros idempotentes (`Idempotency-Key`)

Si la respuesta de un `POST /api/pacientes/{id}/historial` se pierde (red, doble clic, timeout),
repetirlo crearía un segundo registro y, en `MEDICACION` con descuento, descontaría dos veces. Con la
cabecera opcional `Idempotency-Key` la repetición es segura, **para cualquier tipo de registro**:

```bash
curl -X POST localhost:8080/api/pacientes/PAC-0001/historial \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 8f14e45f-ceea-4672-a5b1-7a0c3c9e2f01" \
  -d '{"tipo":"MEDICACION","contenido":"Paracetamol 500 mg vía oral","idMedicamento":"MED-0001","cantidad":2}'
```

- **Formato:** de 16 a 100 caracteres: letras sin tilde, dígitos, guion o guion bajo (un UUID
  sirve), el mismo que MedicamentosService. Si no cumple: `400`.
- **Misma clave, mismo usuario, mismo paciente y mismo cuerpo:** `201` con el **mismo registro**
  que la primera vez y la cabecera `Idempotency-Replayed: true`, sin crear otro ni volver a
  descontar stock. Es el registro de entonces, aunque después haya cambiado algo.
- **Misma clave con otro cuerpo, otro paciente u otro usuario:** `409` "La clave de idempotencia ya
  se usó para otra petición.", sin ningún dato del registro original.
- El cuerpo se compara ya interpretado: los espacios o el orden de los campos del JSON no cuentan;
  cualquier valor distinto (incluido enviar u omitir `idAutor`) sí.
- **Peticiones simultáneas con la misma clave:** se atienden de una en una; se crea un solo
  registro y todas reciben ese registro.
- **Con descuento de stock**, la misma clave se reenvía a la salida de MedicamentosService (que
  tampoco descuenta dos veces con ella). Si la salida no responde (timeout o error de E/S, también
  cuando las cabeceras llegan a tiempo pero el cuerpo no), se reintenta **una vez** con la misma
  clave. Si tampoco responde: `503` "No se pudo confirmar; puede reintentar sin riesgo de descontar
  dos veces.". Una respuesta con el cuerpo mal formado no se reintenta: `502`.
- **Un fallo que no cambió nada** (`400`, `403`, `404` o `409`, propios o de MedicamentosService,
  como stock insuficiente) **no consume la clave**: el reintento se vuelve a evaluar.
- **Un fallo con resultado incierto** (el `503` anterior, un `502` de MedicamentosService o un
  error interno después de una salida hecha) deja la clave ligada a esa petición, sin registro:
  repetir **la misma petición con la misma clave** vuelve a intentarlo sin descontar dos veces;
  cualquier otra combinación recibe `409`.
- **Sin la cabecera**, todo funciona exactamente como antes (sin reintentos y con los mismos
  mensajes).

Las claves se guardan en **PostgreSQL** (tabla `historial_idempotencia`), así que sobreviven a los
reinicios; el registro y su clave se guardan juntos o no se guarda ninguno. Las peticiones con la
misma clave se ordenan con un cerrojo en la JVM, por lo que se asume **una sola instancia** de
PachocloSystem.

| Propiedad | Por defecto | Para qué |
|---|---|---|
| `historial.idempotencia.caducidad` | `24h` | Cuánto tiempo se recuerda cada clave |

No hay tope de claves: las caducadas se borran al guardar una nueva. Una clave caducada se trata
como nueva. "Sin riesgo de descontar dos veces" se cumple
mientras MedicamentosService recuerde la clave: 24 h por defecto. MedicamentosService las guarda en
PostgreSQL, así que sobreviven a sus reinicios.

**Para el frontend (cliente de la API), lo que cambia:**

1. `POST /api/pacientes/{id}/historial` acepta la cabecera opcional `Idempotency-Key`. Generar una
   clave nueva (p. ej. `crypto.randomUUID()`) por cada registro que el usuario quiere crear
   (al abrir el formulario o al pulsar Guardar por primera vez) y **reutilizarla** en los
   reintentos y dobles envíos de ese mismo registro. Una clave nueva solo cuando el usuario empieza
   otro registro o cambia los datos.
2. Respuesta nueva `201` con `Idempotency-Replayed: true`: el registro ya existía. El cuerpo es el
   mismo `RegistroResponse`; se trata como un alta correcta.
3. Código nuevo `409` "La clave de idempotencia ya se usó para otra petición.": la clave se reutilizó
   con otros datos. Generar una clave nueva si el usuario cambió los datos a propósito.
4. Mensaje nuevo en `503` (solo con clave): "No se pudo confirmar; puede reintentar sin riesgo de
   descontar dos veces." Ofrecer reintentar **con la misma clave y el mismo cuerpo**.
5. Código nuevo `400` "La cabecera Idempotency-Key debe tener entre 16 y 100 caracteres: letras sin
   tilde, dígitos, guion o guion bajo (por ejemplo, un UUID)." si la clave no tiene el formato.
6. Sin enviar la cabecera no cambia nada: mismos códigos, cuerpos y mensajes que antes.
7. El frontend usa el proxy de desarrollo (mismo origen), así que no hace falta configurar CORS
   para enviar `Idempotency-Key` ni para leer `Idempotency-Replayed`. Si algún día se sirve desde
   otro origen, [CORS](#cors) ya permite la primera y expone la segunda.

### Medicamentos — `/api/medicamentos`

Los datos viven en **MedicamentosService** (otro proceso); estos endpoints los reenvían por HTTP.
Exigen token como el resto de la API.

| Método | Ruta | Descripción | Respuestas |
|---|---|---|---|
| GET | `/api/medicamentos?q=` | Lista; `q` filtra por id, nombre o principio activo | 200 / 503 |
| GET | `/api/medicamentos/{id}` | Obtiene un medicamento | 200 / 404 / 503 |
| POST | `/api/medicamentos` | Registra un medicamento (con `cantidadStock` inicial) | 201 / 400 / 409 / 503 |
| PUT | `/api/medicamentos/{id}` | Edita los datos (todo menos el stock) | 200 / 400 / 404 / 409 / 503 |
| DELETE | `/api/medicamentos/{id}` | Elimina un medicamento | 204 / 404 / 503 |
| POST | `/api/medicamentos/{id}/entradas` | Suma `{cantidad}` al stock | 200 / 400 / 404 / 503 |
| POST | `/api/medicamentos/{id}/salidas` | Resta `{cantidad}`; 400 si no alcanza o está vencido | 200 / 400 / 404 / 503 |
| GET | `/api/medicamentos/stock-bajo` | Stock igual o menor que el mínimo | 200 / 503 |
| GET | `/api/medicamentos/por-vencer?dias=` | Vencen en los próximos `dias` (1–365, por defecto 30) | 200 / 400 / 503 |
| GET | `/api/medicamentos/vencidos` | Ya vencidos | 200 / 503 |

Los cuerpos y campos son los de MedicamentosService (ver su README).

## Errores

Los errores devuelven un cuerpo uniforme:

```json
{ "status": 400, "error": "Bad Request", "mensajes": ["La especialidad es obligatoria."] }
```

## Integración con MedicamentosService

El servicio principal es la única puerta de entrada (con JWT) al inventario de medicamentos,
que vive en `MedicamentosService` (puerto 8081). Se comunican solo por HTTP; no comparten código.

Configuración (`application.properties`):

| Propiedad | Variable de entorno | Por defecto | Para qué |
|---|---|---|---|
| `medicamentos.url` | `MEDICAMENTOS_URL` | `http://localhost:8081` | URL base del servicio |
| `medicamentos.timeout-conexion` | — | `2s` | Tiempo máximo para conectar |
| `medicamentos.timeout-lectura` | — | `5s` | Tiempo máximo de espera de la respuesta |
| `medicamentos.api-key` | `MEDICAMENTOS_API_KEY` | vacía | Clave compartida que se envía en `X-Api-Key` |

**Autenticación entre servicios.** El usuario se autentica con JWT aquí; MedicamentosService solo
comprueba que quien llama es este servicio, con una clave compartida en la cabecera `X-Api-Key`.
`MEDICAMENTOS_API_KEY` debe tener **el mismo valor en los dos servicios**. Si MedicamentosService
la tiene definida, rechaza (401) cualquier llamada directa sin ella.

**Cómo llegan los errores al cliente:**

| MedicamentosService responde | Este servicio responde |
|---|---|
| 404, 400 o 409 | El mismo código y los mismos mensajes |
| 401/403 (clave distinta), 5xx o una respuesta ilegible | 502 "El servicio de medicamentos respondió de forma inesperada." |
| No responde (caído, conexión rechazada o timeout) | 503 "El servicio de medicamentos no está disponible. Vuelva a intentarlo más tarde." |
| Salida de un registro con `Idempotency-Key` que no responde ni al reintento | 503 "No se pudo confirmar; puede reintentar sin riesgo de descontar dos veces." |

**Registros de medicación.** Con `idMedicamento` y `cantidad`, primero se hace la salida de stock
en MedicamentosService y solo si sale bien se guarda el registro; si la salida falla (medicamento
inexistente, stock insuficiente, vencido o servicio caído) no se crea el registro.

Si la salida se hace pero su respuesta no llega a tiempo (timeout de lectura), el stock queda
descontado sin registro:

- **Con `Idempotency-Key`** se resuelve: la clave viaja a MedicamentosService, el registro se
  reintenta una vez con ella y, si aun así no hay respuesta, el `503` invita a repetir la petición
  con la misma clave, que crea el registro sin un segundo descuento. Lo mismo si el registro no se
  pudiera guardar después de una salida hecha (ver
  [Registros idempotentes](#registros-idempotentes-idempotency-key)).
- **Sin la cabecera** sigue siendo un límite conocido: el cliente recibe `503`, el stock queda
  descontado sin registro y un reintento descontaría otra vez.

> **Límite conocido (sin `Idempotency-Key`):** si el tiempo de lectura se agota cuando las
> cabeceras de la respuesta ya llegaron pero el cuerpo no, el cliente recibe `502` "El servicio de
> medicamentos respondió de forma inesperada." en lugar de `503`, sin reintento. Es el
> comportamiento de siempre y no se ha cambiado; con clave ese caso se trata como un timeout.

> **Baja durante la salida:** el paciente se lee antes de la salida de stock y se vuelve a guardar
> después. Si un ADMIN lo da de baja mientras se espera la salida (con clave puede tardar el doble
> por el reintento: hasta 2 × (`timeout-conexion` + `timeout-lectura`)), el registro se añade a su
> historial pero el paciente **sigue de baja**: la baja es lógica y no se deshace al guardarlo.

**Prueba manual con los dos servicios** (Git Bash, dos terminales):

```bash
# Terminal 1
cd MedicamentosService && MEDICAMENTOS_API_KEY=<clave-del-servicio> MEDICAMENTOS_DB_PASSWORD=<contraseña> \
  ./mvnw spring-boot:run
# Terminal 2
cd PachocloSystem && MEDICAMENTOS_API_KEY=<clave-del-servicio> ADMIN_PASSWORD=<contraseña-admin> \
  JWT_SECRET=<secreto-jwt-32-bytes> PACHOCLOSYSTEM_DB_PASSWORD=<contraseña> ./mvnw spring-boot:run

# Terminal 3: login y llamadas
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<contraseña-admin>"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl localhost:8080/api/medicamentos -H "Authorization: Bearer $TOKEN"   # 200
curl localhost:8081/api/medicamentos                                     # 401: falta X-Api-Key
```

> Los valores entre `<...>` son marcadores: sustitúyalos por los suyos. Este ejemplo es solo para
> desarrollo; en producción no use valores de ejemplo, genere claves y contraseñas propias y no las
> guarde en el repositorio.

## Usuarios, roles y autenticación

Modelo de usuarios (`Rol`: `ADMIN`, `DOCTOR`, `ENFERMERO`; entidad `Usuario`,
repositorio en PostgreSQL, servicio con reglas de negocio) y creación de un
administrador inicial al arrancar. La autenticación es **stateless con JWT**:
todos los endpoints de `/api/**`, salvo el login, exigen un token bearer
válido, y cada operación exige un rol (ver [Permisos por rol](#permisos-por-rol)).

### Permisos por rol

Sin token, cualquier operación responde `401`; con un rol sin permiso, `403`. Los
dos con el cuerpo de error uniforme. La tabla se comprueba en
`AutorizacionPorRolTest`, fila a fila, para cada rol, sin token, con un token
mal firmado y con la contraseña pendiente de cambio. Ese test también falla si
algún endpoint mapeado no recibe ninguna fila, y comprueba que `POST
/api/auth/login` es el único público y que las rutas sin endpoint no quedan
abiertas.

| Operación | ADMIN | DOCTOR | ENFERMERO |
|---|:-:|:-:|:-:|
| `GET /api/auth/me` y `POST /api/auth/password` (cambio propio) | ✓ | ✓ | ✓ |
| Leer pacientes (`GET /api/pacientes/**`) | ✓ | ✓ | ✓ |
| Registrar y editar pacientes (`POST /api/pacientes`, `PUT /api/pacientes/{id}`) | ✓ | ✓ | ✗ |
| Cambiar habitación (`PATCH /api/pacientes/{id}/habitacion`) | ✓ | ✓ | ✓ |
| Dar de baja pacientes (baja lógica: se conserva el historial) | ✓ | ✗ | ✗ |
| Leer el historial (general y de un paciente) | ✓ | ✓ | ✓ |
| Crear registros de historial | ✗ ¹ | ✓ los 4 tipos | ✓ todos menos `DIAGNOSTICO` |
| Leer trabajadores | ✓ | ✓ | ✗ |
| Registrar, editar y eliminar trabajadores | ✓ | ✗ | ✗ |
| Leer medicamentos (incl. stock bajo, por vencer y vencidos) | ✓ | ✓ | ✓ |
| Salidas de stock (`POST /api/medicamentos/{id}/salidas`) | ✓ | ✗ ² | ✓ |
| Alta, edición, borrado y entradas de medicamentos | ✓ | ✗ | ✗ |
| Gestión de usuarios (`/api/usuarios/**`, incluido el cambio de rol) | ✓ | ✗ | ✗ |

1. El ADMIN no tiene trabajador vinculado y los registros se firman con el
   trabajador del usuario autenticado.
2. El doctor sí descuenta stock desde un registro de `MEDICACION`.

Quien **aún debe cambiar su contraseña** (alta por la API, restablecimiento
por un ADMIN o admin inicial con contraseña aleatoria) solo puede llamar a
`GET /api/auth/me` y a `POST /api/auth/password`: el resto responde `403`
"Debe cambiar su contraseña antes de continuar." hasta que la cambie.

Las reglas por ruta están en `SecurityConfig`. Cada recurso termina en una
regla solo-ADMIN, así que un endpoint nuevo sin regla propia queda cerrado
para los demás roles. Las reglas que dependen del cuerpo (autor y tipo de
registro) están en `HistorialClinicoService`.

### Autenticación (JWT)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Público. `{ "username", "password" }` → JWT bearer |
| GET | `/api/auth/me` | Autenticado. Devuelve `{ idUsuario, username, rol, idTrabajador, nombreCompleto, activo, debeCambiarPassword }` (`nombreCompleto` es `null` para el ADMIN o si su trabajador ya no existe) |
| POST | `/api/auth/password` | Autenticado. Cambia la contraseña del propio usuario: `{ "passwordActual", "passwordNueva" }` → `204`. El token usado queda revocado de inmediato y hay que volver a iniciar sesión. |

Login correcto:

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"tu-contrasena"}'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9.…",
  "tipo": "Bearer",
  "expiraEnSegundos": 1800,
  "rol": "ADMIN",
  "debeCambiarPassword": false
}
```

El resto de endpoints se llaman con el token en `Authorization`:

```bash
curl http://localhost:8080/api/pacientes -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.…"
```

- El 401 del login es siempre `401 "Credenciales inválidas."`, indistinguible
  cuando el usuario no existe, la contraseña es incorrecta o el usuario está
  desactivado (las tres causas se evalúan con el mismo coste de BCrypt).
- El 401 de una petición sin token válido (ausente, malformado, expirado, con
  firma inválida, de un usuario desactivado o con una versión de token
  obsoleta) responde el cuerpo de error uniforme junto con
  `WWW-Authenticate: Bearer`; nunca se exponen detalles internos del token. El
  403 responde `"No tiene permisos para realizar esta operación."`.
- El token (HS256) contiene `sub`, `username`, `rol`, `ver` e `idTrabajador`
  (si aplica), pero la autorización **se relee del repositorio en cada
  petición**: los permisos son los del rol actual del usuario.
- `ver` es la **versión del token**. Sube con cada cambio de contraseña (propio
  o restablecido por un ADMIN) y al desactivar al usuario (también al eliminar
  su trabajador); reactivarlo no la restaura. Un token con otra versión, o sin
  ella, responde `401`: los tokens emitidos antes del cambio quedan revocados de
  inmediato y no vuelven a valer. El login comprueba la contraseña y pone la
  versión leyendo ambas a la vez, así que un cambio simultáneo no produce un
  token nuevo validado con la contraseña anterior.

### Gestión de usuarios — `/api/usuarios` (solo ADMIN)

| Método | Ruta | Descripción | Respuestas |
|---|---|---|---|
| POST | `/api/usuarios` | Crea `{username, password, rol, idTrabajador?}`; nace con el cambio de contraseña obligatorio | 201 / 400 / 404 / 409 |
| GET | `/api/usuarios?q=` | Lista activos e inactivos; `q` filtra por ID, username o trabajador | 200 |
| GET | `/api/usuarios/{id}` | Obtiene un usuario | 200 / 404 |
| PATCH | `/api/usuarios/{id}/rol` | Cambia rol y trabajador vinculado `{rol, idTrabajador?}` | 200 / 400 / 404 / 409 |
| PATCH | `/api/usuarios/{id}/desactivar` | Desactiva (idempotente) | 200 / 404 / 409 |
| PATCH | `/api/usuarios/{id}/activar` | Reactiva (idempotente) | 200 / 404 / 409 |
| PATCH | `/api/usuarios/{id}/password` | Restablece la contraseña `{password}`; deja el cambio obligatorio | 204 / 400 / 404 |

Las respuestas son `{ idUsuario, username, rol, idTrabajador, nombreCompleto, activo, debeCambiarPassword }`
(`nombreCompleto` es `null` para el ADMIN o si su trabajador ya no existe) y
**nunca incluyen el hash** de la contraseña ni la versión del token. Un
usuario que no es ADMIN recibe `403` y una petición sin token, `401`, ambos
con el cuerpo de error uniforme.

```bash
curl -X POST http://localhost:8080/api/usuarios   -H "Authorization: Bearer <token-de-admin>" -H "Content-Type: application/json"   -d '{"username":"eva.mora","password":"<contraseña>","rol":"DOCTOR","idTrabajador":"DOC-0001"}'
```

- **Rol y vínculo:** `ADMIN` no se vincula a ningún trabajador; `DOCTOR` y
  `ENFERMERO` se vinculan a un trabajador existente de su tipo (si no existe,
  `404`; si es de otro tipo, `400`). Un trabajador solo puede tener un usuario,
  aunque esté desactivado.
- **Conflictos (`409`):** username ya usado (sin distinguir mayúsculas) o
  trabajador que ya tiene usuario.
- **Contraseña temporal:** el alta y el restablecimiento dejan
  `debeCambiarPassword=true`. El usuario inicia sesión con esa contraseña, se ve
  a sí mismo (`/api/auth/me`) y la cambia (`POST /api/auth/password`); hasta
  entonces, el resto de la API le responde `403` (ver
  [Permisos por rol](#permisos-por-rol)).
- **Cambio de rol:** mismas reglas de vínculo que el alta; libera el trabajador
  anterior. `409` si el trabajador nuevo ya tiene usuario o si se quitaría el
  rol ADMIN al último administrador activo. Se aplica en la siguiente petición
  (los permisos se releen siempre).
- **Desactivar:** el usuario pierde el acceso de inmediato y sus tokens quedan
  revocados. `409` si un admin intenta desactivarse a sí mismo o desactivar al
  último administrador activo. Eliminar un trabajador sigue desactivando su
  usuario.
- **Activar:** un doctor o enfermero solo se reactiva si su trabajador sigue
  existiendo, es de su tipo y sigue vinculado a él; si no, `409`. Los tokens de
  antes de la desactivación no vuelven a valer: hay que iniciar sesión.
- **Restablecer contraseña:** el ADMIN fija una nueva para cualquier usuario
  (activo o no), con la misma política. **Todos los tokens emitidos antes del
  cambio dejan de valer** (`401`), incluido el del propio ADMIN si restablece la
  suya.
- **Cambio propio (`POST /api/auth/password`):** exige la contraseña actual, que
  la nueva sea distinta y cumpla la política (`400` si no); responde `204`,
  quita el cambio pendiente y revoca el token usado: hay que volver a iniciar
  sesión.
- Los usuarios se guardan en PostgreSQL y sobreviven a los reinicios; un
  token sigue valiendo tras un reinicio si `JWT_SECRET` no cambia.

### Variables de entorno del administrador inicial

| Variable | Propiedad | Por defecto | Descripción |
|---|---|---|---|
| `ADMIN_USERNAME` | `app.admin.username` | `admin` | Username del administrador inicial (se normaliza a minúsculas; debe cumplir `^[a-z0-9._-]{3,30}$`). |
| `ADMIN_PASSWORD` | `app.admin.password` | *(sin valor en el repo)* | Contraseña en claro del administrador. |

- El administrador solo se crea si **no existe** en la base: `ADMIN_PASSWORD`
  se aplica únicamente la primera vez. Después, cambiarla en el entorno no
  cambia la contraseña guardada (se cambia desde la aplicación).
- Si `ADMIN_PASSWORD` **está definida**, se usa tal cual y **nunca se escribe en
  el log**. Si no cumple la política de contraseña (menos de 10 caracteres, más
  de 72 bytes o igual al username), la aplicación **no arranca** y muestra un
  mensaje claro con la regla incumplida. La cuenta nace
  operativa (sin cambio de contraseña obligatorio).
- Si `ADMIN_PASSWORD` **no está definida**, se genera una contraseña aleatoria
  de 20 caracteres (alfanumérico sin caracteres ambiguos) con `SecureRandom` y se
  escribe **una sola vez** en el log a nivel `WARN`. Como esa contraseña ha
  quedado escrita en el log, la cuenta nace **bloqueada**: el cambio de
  contraseña es obligatorio en el primer acceso antes de poder operar.

### Política de contraseña

- De **10 caracteres** a **72 bytes en UTF-8** (el límite de BCrypt; las letras
  con tilde y la ñ ocupan 2 bytes), y **distinta del username** (sin distinguir
  mayúsculas). No se exige ningún requisito de composición. El mensaje de error
  nunca incluye la contraseña.
- Solo se almacena el **hash BCrypt**: la contraseña en claro no se guarda ni
  aparece en `toString()`, en la serialización JSON ni en los logs.
- Se aplica igual al crear usuarios, al restablecer contraseñas, al cambiar la
  propia (que además debe ser distinta de la actual) y a `ADMIN_PASSWORD`.

### Clave de firma JWT

| Variable | Propiedad | Por defecto | Descripción |
|---|---|---|---|
| `JWT_SECRET` | `app.jwt.secret` | *(sin valor en el repo)* | Clave simétrica de firma HS256, mín. **32 bytes** codificados en UTF-8. |
| — | `app.jwt.emisor` | `pachoclosystem` | `iss` esperado en los tokens. |
| — | `app.jwt.expiracion-minutos` | `30` | Validez del token, en minutos (número entero). |

- Si `JWT_SECRET` **no está definida**, se genera una clave aleatoria de 32
  bytes con `SecureRandom` solo para desarrollo y se escribe **un único WARN**
  en el log (sin el valor). Los tokens firmados así **no sobreviven a un
  reinicio**.
- Si `JWT_SECRET` tiene menos de 32 bytes, la aplicación **no arranca** y
  muestra un mensaje claro con la política; el valor nunca aparece en el log.

> El secreto y las contraseñas nunca se escriben en el log, en los errores ni en
> los `toString()`. Los tokens se validan contra el repositorio en cada petición:
> no hay sesiones en servidor ni tokens de refresco.

## Límite de intentos de login

Protección contra fuerza bruta en `POST /api/auth/login`. Un
`LimitadorIntentosLogin` en memoria cuenta los fallos en **tres contadores**,
con la misma ventana:

| Contador | Umbral por defecto | Para qué |
|---|---|---|
| **Usuario + IP** | 5 | La protección principal. Solo bloquea a quien falla, desde su IP. |
| **IP** (con cualquier usuario) | 50 | Frena a una sola fuente que prueba muchos usernames (*password spraying*). |
| **Usuario** (desde cualquier IP) | 100 | Frena la fuerza bruta distribuida contra una cuenta. |

| Variable | Propiedad | Por defecto | Descripción |
|---|---|---|---|
| `APP_LOGIN_MAX_INTENTOS` | `app.login.max-intentos` | `5` | Fallos de un usuario desde una IP que bloquean ese par. |
| `APP_LOGIN_MAX_INTENTOS_IP` | `app.login.max-intentos-ip` | `50` | Fallos desde una IP que la bloquean. No puede ser menor que el anterior. |
| `APP_LOGIN_MAX_INTENTOS_USUARIO` | `app.login.max-intentos-usuario` | `100` | Fallos de una cuenta, desde cualquier IP, que la bloquean. No puede ser menor que el primero. |
| `APP_LOGIN_BLOQUEO_MINUTOS` | `app.login.bloqueo-minutos` | `15` | Ventana de conteo y duración del bloqueo. |
| `APP_LOGIN_MAX_ENTRADAS` | `app.login.max-entradas` | `10000` | Tope de entradas en memoria (purga defensiva). |
| `APP_LOGIN_PROXIES_CONFIABLES` | `app.login.proxies-confiables` | *(vacío)* | IPs o rangos CIDR de los proxies inversos propios, separados por comas (ver abajo). |

**Por qué tres contadores.** Antes se bloqueaba por usuario y por IP con el mismo
umbral de 5. Eso permitía a cualquiera bloquear al `admin` durante 15 minutos
con 5 contraseñas malas, y detrás de un proxy (todos con la misma IP) 5 fallos
de una persona bloqueaban el login de todos. Ahora:

- Quien ataca una cuenta desde su IP **se bloquea a sí mismo**: el titular sigue
  entrando desde la suya, y los demás usuarios de la IP del atacante también.
- Bloquear una cuenta para todos exige fallar desde **al menos 20 IPs
  distintas** (100 fallos con un máximo de 5 por IP).
- Una IP compartida solo se bloquea si acumula **50 fallos** en la ventana.

Comportamiento:

- Al llegar a un umbral, el siguiente intento responde **`429 Too Many
  Requests`** con el cuerpo de error uniforme y `Retry-After` en segundos (el
  del bloqueo más largo que le afecte). El bloqueo se comprueba **antes** de
  evaluar las credenciales, así que durante el bloqueo una contraseña correcta
  también responde 429.
- Un **acierto reinicia solo el contador de ese usuario desde esa IP**. Los de
  la IP y de la cuenta no se reinician: un acierto no da más intentos a quien
  prueba otros usernames ni a quien ataca la cuenta desde otras IPs.
- Un **429 no registra un fallo**: no extiende la cuenta atrás, y el bloqueo se
  deshace solo al agotarse la ventana. Un **400 por body inválido no cuenta ni
  comprueba el bloqueo**.
- El fallo se registra en las tres causas de 401 (usuario inexistente,
  contraseña incorrecta, usuario inactivo) y el 429 es **idéntico** exista o no
  el usuario (sin revelar su existencia). El username del log se normaliza a
  minúsculas, se truncan los caracteres de control y se limita a 30 caracteres;
  ninguna contraseña, hash ni token se escribe en el log.

**IP del cliente y proxies.** Por defecto la IP es la del socket
(`getRemoteAddr()`) y `X-Forwarded-For` **se ignora**, porque cualquiera puede
escribir esa cabecera. Si la aplicación está detrás de un proxy inverso propio,
hay que poner su IP en `APP_LOGIN_PROXIES_CONFIABLES` (tal como la ve el
servidor, p. ej. `10.0.0.5` o `::1`), o un rango CIDR si la plataforma no da a sus
proxies una IP fija (p. ej. `100.64.0.0/10`). Entonces, solo para peticiones que
llegan desde esas IPs, se lee `X-Forwarded-For` de derecha a izquierda saltando
los proxies de confianza y se usa la primera IP que no lo es: la que añadió el
proxy, no la que pudiera haber escrito el cliente. Las IPs se comparan por su
valor y nunca se consulta DNS; un valor que no sea una IP o un rango válido
impide arrancar. Un rango demasiado amplio dejaría que clientes de ese rango
falsificaran su IP: hay que poner solo el de los proxies de la plataforma.

Sin esa configuración detrás de un proxy (como el de desarrollo del frontend,
que no envía `X-Forwarded-For`), todos llegan con la IP del proxy: cada usuario
solo se bloquea a sí mismo, pero 50 fallos entre todos bloquean esa IP, es decir,
el login de todos durante la ventana.

## CORS

| Variable | Propiedad | Por defecto | Descripción |
|---|---|---|---|
| `CORS_ORIGENES` | `app.cors.origenes` | *(vacío)* | Lista de orígenes permitidos separada por comas. |

Comportamiento:

- Con el valor por defecto (vacío) el CORS está **desactivado**: ninguna
  respuesta lleva cabeceras `Access-Control-Allow-*`.
- Cada origen debe ser una **URL absoluta `http(s)`, sin barra final y sin
  comodines**: un `*`, una URL con barra final o una URL no http(s) abortan el
  arranque con un mensaje claro.
- La configuración se aplica en la cadena de seguridad mediante
  `http.cors(...)`: los métodos permitidos son `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE` y `OPTIONS`; las cabeceras permitidas `Authorization`,
  `Content-Type` e `Idempotency-Key`; las expuestas `Retry-After`, `Location` e
  `Idempotency-Replayed`. Nunca se usan
  credenciales (`allowCredentials=false`) y `maxAge` es de 1 hora.
- La **preflight OPTIONS de un origen permitido** se responde con 200 y sus
  cabeceras **sin exigir token**; la de un origen no permitido no recibe
  cabeceras CORS. Las respuestas (incluidos los 401/403/429) de un origen
  permitido llevan `Access-Control-Allow-Origin`.

### Advertencia

> Si no se define `ADMIN_PASSWORD` al crear el administrador, la contraseña
> aleatoria **queda registrada en el log**; esa contraseña solo debe usarse en
> **desarrollo** y el log no debe compartirse. Para cualquier otro entorno,
> define `ADMIN_PASSWORD` antes del primer arranque.
