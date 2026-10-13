# PachocloSystem

Sistema de gestión de un hospital: pacientes, trabajadores (doctores y enfermeros), historial
clínico, inventario de medicamentos y usuarios con roles. Nació como una aplicación Swing con
arquitectura MVC y hoy son tres procesos que se hablan por HTTP.

> Proyecto de desarrollo y aprendizaje. Los dos servicios guardan sus datos en **PostgreSQL**
> (cada uno en su propia base), así que sobreviven a los reinicios (ver
> [Limitaciones conocidas](#limitaciones-conocidas)).

URL: [PachocloSystem](https://pachoclo-system-frontend.vercel.app/)

[![Logo](frontend/public/logos/logo-sistema-160.png)](https://pachoclo-system-frontend.vercel.app/)
## Arquitectura

```
 Navegador ──► Frontend Angular ──/api──► PachocloSystem ──X-Api-Key──► MedicamentosService
               (localhost:4200)           (localhost:8080)              (localhost:8081)
                                           JWT, roles, pacientes,        inventario y stock
                                           trabajadores, historial       de medicamentos
```

| Parte | Carpeta | Puerto | Qué hace |
|---|---|---|---|
| Frontend | [`frontend/`](frontend/) | 4200 | SPA Angular. Solo habla con PachocloSystem. |
| PachocloSystem | [`PachocloSystem/`](PachocloSystem/) | 8080 | API principal (Spring Boot): autenticación JWT, permisos por rol, pacientes, trabajadores, usuarios, historial clínico. Es la única puerta de entrada a los medicamentos. |
| MedicamentosService | [`MedicamentosService/`](MedicamentosService/) | 8081 | Microservicio de inventario (Spring Boot): stock, entradas y salidas, vencimientos. |

Cómo se comunican:

- **Navegador → PachocloSystem:** el frontend llama a rutas relativas `/api/**`. En desarrollo el
  proxy de Angular las reenvía al 8080, así que hay un único origen y no hace falta CORS. El
  usuario se autentica con un token JWT (`Authorization: Bearer`).
- **PachocloSystem → MedicamentosService:** HTTP directo con una clave compartida en la cabecera
  `X-Api-Key`. MedicamentosService no conoce a los usuarios, solo comprueba esa clave. Los dos
  servicios no comparten código.
- **El frontend nunca llama a MedicamentosService.** Si este está caído, PachocloSystem responde
  503 y solo el módulo de medicamentos muestra el aviso.

## Requisitos

- **Java 25** (`JAVA_HOME` apuntando a un JDK 25). No hace falta instalar Maven: cada servicio
  incluye su wrapper (`mvnw`).
- **PostgreSQL** (probado con la 18) con una base y un rol por servicio:
  - MedicamentosService: bases `medicamentos` y `medicamentos_test`, rol `medicamentos_app` (ver el
    [README de MedicamentosService](MedicamentosService/README.md#base-de-datos)).
  - PachocloSystem: bases `pachoclosystem` y `pachoclosystem_test`, rol `pachoclosystem_app` (ver el
    [README de PachocloSystem](PachocloSystem/README.md#base-de-datos)).
- **Node** `^22.22.3`, `^24.15.0` o `>=26` (lo exige Angular 22), con npm.
- Git Bash o PowerShell en Windows; también vale cualquier shell POSIX.

## Cómo levantar el sistema

Hacen falta **tres terminales**, en este orden. Los valores de abajo son **solo de ejemplo para
desarrollo**: use los suyos y no los guarde en el repositorio.

| Variable | Dónde | Ejemplo | Notas |
|---|---|---|---|
| `MEDICAMENTOS_API_KEY` | los dos servicios | `clave-servicio-ejemplo` | Debe ser **igual** en ambos. |
| `MEDICAMENTOS_DB_PASSWORD` | MedicamentosService | `<contraseña-de-medicamentos_app>` | Contraseña del rol de PostgreSQL. Sin ella el servicio no arranca. |
| `PACHOCLOSYSTEM_DB_PASSWORD` | PachocloSystem | `<contraseña-de-pachoclosystem_app>` | Contraseña del rol de PostgreSQL. Sin ella el servicio no arranca. |
| `ADMIN_PASSWORD` | PachocloSystem | `admin-ejemplo-2026` | Mínimo 10 caracteres. Solo se usa la primera vez, al crear el administrador en la base. Si se omite, se genera una aleatoria y se imprime una vez en el log (WARN). |
| `JWT_SECRET` | PachocloSystem | `secreto-jwt-ejemplo-solo-desarrollo` | Mínimo 32 bytes. Si se omite, los tokens no sobreviven a un reinicio. |

Opcionales de PachocloSystem: `CORS_ORIGENES` (orígenes permitidos si el frontend se sirve desde
otro origen; vacío por defecto, sin CORS), `APP_LOGIN_PROXIES_CONFIABLES` (IPs o rangos CIDR de los
proxies inversos propios, cuya `X-Forwarded-For` se acepta para el límite de intentos de login) y los
umbrales de ese límite. Detalle en el [README de PachocloSystem](PachocloSystem/README.md).
Los dos servicios aceptan además `PORT` y `APP_ZONA_HORARIA` (por defecto `America/Bogota`).

### Producción

En producción los dos servicios arrancan con `SPRING_PROFILES_ACTIVE=prod`, que **impide arrancar**
si falta un secreto o una configuración obligatoria (las claves, las URLs que no sean localhost,
`CORS_ORIGENES` en https, `ADMIN_PASSWORD` al crear el administrador) y escribe los logs en JSON.
Exponen health checks en `/actuator/health` (`/liveness` y `/readiness`). El frontend se compila
para Vercel con `npm run build:vercel` y `API_BASE_URL`. Detalle en la sección "Producción" de cada
README y en [Despliegue en Vercel](frontend/README.md#despliegue-en-vercel).

El despliegue actual (backends y PostgreSQL en Railway, frontend en Vercel), con sus variables y
verificaciones, está en [`docs/despliegue.md`](docs/despliegue.md).

### Git Bash

```bash
# Terminal 1: MedicamentosService (8081)
cd MedicamentosService
MEDICAMENTOS_API_KEY=clave-servicio-ejemplo MEDICAMENTOS_DB_PASSWORD=<contraseña> ./mvnw spring-boot:run

# Terminal 2: PachocloSystem (8080)
cd PachocloSystem
MEDICAMENTOS_API_KEY=clave-servicio-ejemplo ADMIN_PASSWORD=admin-ejemplo-2026 \
  JWT_SECRET=secreto-jwt-ejemplo-solo-desarrollo PACHOCLOSYSTEM_DB_PASSWORD=<contraseña> \
  ./mvnw spring-boot:run

# Terminal 3: frontend (4200)
cd frontend
npm install
npm start
```

### PowerShell

```powershell
# Terminal 1: MedicamentosService (8081)
cd MedicamentosService
$env:MEDICAMENTOS_API_KEY = "clave-servicio-ejemplo"
$env:MEDICAMENTOS_DB_PASSWORD = "<contraseña>"
.\mvnw.cmd spring-boot:run

# Terminal 2: PachocloSystem (8080)
cd PachocloSystem
$env:MEDICAMENTOS_API_KEY = "clave-servicio-ejemplo"
$env:ADMIN_PASSWORD = "admin-ejemplo-2026"
$env:JWT_SECRET = "secreto-jwt-ejemplo-solo-desarrollo"
$env:PACHOCLOSYSTEM_DB_PASSWORD = "<contraseña>"
.\mvnw.cmd spring-boot:run

# Terminal 3: frontend (4200)
cd frontend
npm install
npm start
```

Abra <http://localhost:4200>.

### Usuario inicial

El primer arranque de PachocloSystem crea un administrador en la base (en los siguientes ya
existe y no se toca):

- **Usuario:** `admin` (o el valor de `ADMIN_USERNAME`).
- **Contraseña:** la de `ADMIN_PASSWORD`. Con los ejemplos de arriba, `admin-ejemplo-2026`.

El administrador no tiene trabajador vinculado, así que puede consultar el historial pero no
crear registros. Doctores y enfermeros inician sesión con usuarios que el admin crea desde la
pantalla **Usuarios**.

## Recorrido corto

1. Entre como `admin`.
2. **Trabajadores:** registre un doctor (p. ej. nombre "Eva Mora", especialidad "Cardiología").
3. **Usuarios:** cree un usuario con rol `DOCTOR` vinculado a ese doctor (contraseña de 10
   caracteres o más). Es una contraseña temporal: el doctor la cambiará al entrar.
4. **Pacientes:** registre un paciente.
5. **Medicamentos:** registre uno con stock inicial (esto habla con MedicamentosService).
6. Cierre sesión y entre con el usuario del doctor. La aplicación le pide cambiar la contraseña;
   después vuelve al login y entra con la nueva.
7. **Pacientes → Historial:** agregue un registro de tipo `MEDICACION` indicando el medicamento y
   una cantidad. El registro queda firmado por el doctor y el stock baja.
8. En **Medicamentos** compruebe el nuevo stock; en **Historial** vea el registro.
9. Opcional: detenga MedicamentosService y recargue Medicamentos para ver el aviso 503 sin que
   caiga el resto de la app.

## Tests

Cada parte se prueba por separado, desde su carpeta:

```bash
cd PachocloSystem && ./mvnw test          # API principal (en PowerShell: .\mvnw.cmd test)
cd MedicamentosService && ./mvnw test     # microservicio de medicamentos
cd frontend && npm test                   # unitarios (Vitest)
cd frontend && npm run build              # build de producción en frontend/dist
```

El frontend también tiene `npm run lint` y `npm run format:check`. No hace falta arrancar nada
para ejecutar los tests.

## Documentación por módulo

- [`PachocloSystem/README.md`](PachocloSystem/README.md): endpoints, permisos por rol, JWT, usuarios, historial idempotente e integración con medicamentos.
- [`MedicamentosService/README.md`](MedicamentosService/README.md): modelo, endpoints, stock, vencimientos e idempotencia de las salidas.
- [`frontend/README.md`](frontend/README.md): estructura, patrón de los módulos, roles, sesión y errores.
- [`docs/plan-frontend.md`](docs/plan-frontend.md): plan y decisiones del frontend.
- [`docs/despliegue.md`](docs/despliegue.md): despliegue en Railway y Vercel.

## Limitaciones conocidas

Reúne lo que ya documentan los README de cada módulo (enlazados arriba). El detalle y el motivo
de cada punto están allí.

**Datos y sesión**

- **Todo se guarda en PostgreSQL** y sobrevive a los reinicios. `ADMIN_PASSWORD` solo se aplica al
  crear el administrador (primer arranque); sin ella la contraseña es aleatoria, queda en el log y
  hay que cambiarla en el primer acceso. Sin `JWT_SECRET` los tokens no sobreviven a un reinicio.
- **Sin PostgreSQL** los servicios no arrancan; si la base cae con ellos en marcha, responden `503`
  hasta que vuelva.
- **Una sola instancia de PachocloSystem.** El orden de las peticiones con la misma
  `Idempotency-Key` y el límite de intentos de login viven en la memoria del proceso.
- **Sesión de 30 minutos sin renovación.** No hay refresh token: el frontend avisa 5 minutos antes
  y, al expirar, vuelve al login. El token se guarda en `sessionStorage` y se pierde al cerrar la
  pestaña.
- **Sin paginación:** las listas llegan completas.
- **Límite de intentos de login en memoria.** 5 fallos de un usuario desde una IP bloquean ese
  par 15 minutos; 50 fallos desde una IP, esa IP; 100 de una cuenta desde cualquier IP, esa cuenta.
  Detrás de un proxy sin configurar `APP_LOGIN_PROXIES_CONFIABLES` (como el de desarrollo) todos
  comparten IP: 50 fallos entre todos bloquean el login de todos durante la ventana.

**Usuarios, trabajadores y pacientes**

- La **baja de un paciente es lógica**: deja de aparecer en listas e historial, pero sus datos se
  conservan en la base de datos y no se puede reactivar desde la API.
- Un trabajador solo puede tener **un usuario, aunque esté desactivado**: si su usuario se
  desactivó, no se le puede crear otro.
- Un doctor o enfermero desactivado solo se reactiva si su trabajador sigue existiendo, es de su
  tipo y sigue vinculado a él.

**Historial y stock de medicamentos**

- **Sin `Idempotency-Key`**, si la salida de stock se hace pero su respuesta no llega (timeout), el
  cliente recibe 503, el stock queda descontado sin registro y reintentar descontaría otra vez.
  Si el timeout salta con las cabeceras ya recibidas pero sin cuerpo, recibe **502** y no hay
  reintento. El frontend siempre envía la clave.
- **Las claves de idempotencia caducan a las 24 h.** "Reintentar sin riesgo de descontar dos
  veces" solo se cumple dentro de ese plazo. MedicamentosService las guarda en PostgreSQL y
  sobreviven a sus reinicios; las del historial de PachocloSystem, también (sin tope de claves).
- **Las claves del frontend viven en el diálogo.** Si se recarga la página tras un resultado
  incierto, el siguiente intento usa otra clave: hay que revisar el historial y el stock antes de
  repetirlo.
- Los **signos vitales** se guardan como texto en `contenido`, no como datos estructurados.

**Despliegue**

- En desarrollo el frontend y la API están en el **mismo origen** (proxy de `ng serve`). Si se
  sirven desde orígenes distintos (Vercel y Railway) hay que definir `CORS_ORIGENES` en
  PachocloSystem y `API_BASE_URL` en el build del frontend.
- En Railway los proxies no tienen IP fija: `APP_LOGIN_PROXIES_CONFIABLES` lleva rangos deducidos
  de los logs, y habría que ampliarlos si aparecen proxies nuevos (ver
  [`docs/despliegue.md`](docs/despliegue.md#proxies-confiables-límite-de-intentos-de-login)).
- Sin `MEDICAMENTOS_API_KEY`, MedicamentosService no exige autenticación (solo desarrollo; con el
  perfil `prod` no arranca sin ella).
- **Una réplica** de PachocloSystem (ver "Una sola instancia" arriba).

### Para una versión futura

- **Refresh token** para renovar la sesión sin volver a iniciar sesión.
- **Rol de farmacia** para gestionar el inventario sin ser ADMIN.
- **Tests E2E** con Playwright (previstos en el plan del frontend, fase F7).
- Paginación, y cambio de rol de un usuario desde la pantalla Usuarios (el backend ya lo admite).
