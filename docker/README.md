# PachocloSystem en Docker Compose

Despliegue multicontenedor del sistema: 5 servicios, 2 redes y 3 volúmenes definidos en
[`docker-compose.yml`](../docker-compose.yml). Las imágenes se construyen desde los Dockerfiles de
cada carpeta (`frontend/`, `PachocloSystem/`, `MedicamentosService/`) y las bases usan la imagen
oficial `postgres:18`.

## Arquitectura

```
                      host (Windows/Linux)
                              │  único puerto publicado: 4200 → 8080
 ┌────────────────────────────┼──────────────────────────────────────────────┐
 │  red "publica"  172.28.10.0/24                                            │
 │                            ▼                                              │
 │                   ┌──────────────────┐                                    │
 │                   │ frontend (nginx) │  172.28.10.10 (IP fija)            │
 │                   │ SPA Angular      │                                    │
 │                   └────────┬─────────┘                                    │
 │                            │ /api/*  (X-Forwarded-For)                    │
 │                            ▼                                              │
 │                   ┌──────────────────┐                                    │
 │                   │   pachoclo-api   │  Spring Boot :8080                 │
 │                   │ JWT, roles, API  │  volumen pachoclo-logs             │
 │                   └───┬──────────┬───┘                                    │
 └───────────────────────┼──────────┼────────────────────────────────────────┘
 ┌───────────────────────┼──────────┼────────────────────────────────────────┐
 │  red "interna"  (internal: true, sin salida a internet ni al host)        │
 │                       │          │ X-Api-Key                              │
 │                       ▼          ▼                                        │
 │              ┌─────────────┐  ┌──────────────────────┐                    │
 │              │ db-pachoclo │  │ medicamentos-service │ Spring Boot :8081  │
 │              │ PostgreSQL  │  └──────────┬───────────┘                    │
 │              └──────┬──────┘             ▼                                │
 │            vol. pachoclo-datos    ┌────────────────┐                      │
 │                                   │ db-medicamentos│ PostgreSQL           │
 │                                   └───────┬────────┘                      │
 │                                  vol. medicamentos-datos                  │
 └───────────────────────────────────────────────────────────────────────────┘
```

| Servicio | Imagen | Red(es) | Puerto al host | Volumen |
|---|---|---|---|---|
| `frontend` | build `./frontend` (nginx sin privilegios) | publica | **4200** → 8080 | — |
| `pachoclo-api` | build `./PachocloSystem` (Java 25) | publica + interna | no | `pachoclo-logs` |
| `medicamentos-service` | build `./MedicamentosService` (Java 25) | interna | no | — |
| `db-pachoclo` | `postgres:18` | interna | no | `pachoclo-datos` |
| `db-medicamentos` | `postgres:18` | interna | no | `medicamentos-datos` |

Flujo: el navegador solo habla con nginx. nginx sirve la SPA y reenvía `/api/*` a `pachoclo-api`
(mismo origen, por eso no hace falta CORS). `pachoclo-api` es la única que habla con
`medicamentos-service`, usando la clave compartida en la cabecera `X-Api-Key`.

## Cómo levantarlo

Requisitos: Docker Desktop (o Docker Engine) con Compose v2. No hace falta Java ni Node: todo se
compila dentro de las imágenes.

```bash
cp .env.example .env        # y cambie los valores (en PowerShell: Copy-Item .env.example .env)
docker compose build        # construye las 3 imágenes (la primera vez tarda unos minutos)
docker compose up -d        # arranca los 5 servicios en el orden de depends_on
docker compose ps           # los 5 deben quedar "healthy"
```

Abra <http://localhost:4200> e inicie sesión como `admin` con el valor de `ADMIN_PASSWORD`.
El administrador se crea solo en el primer arranque.

```bash
docker compose logs -f pachoclo-api     # logs de un servicio
docker compose stop                     # detiene sin borrar nada
docker compose down                     # elimina contenedores y redes; los volúmenes (datos) se conservan
docker compose down -v                  # ¡borra también los volúmenes: se pierden todos los datos!
```

## Variables de `.env`

Plantilla en [`.env.example`](../.env.example). `.env` está en `.gitignore` y nunca se sube. Las
marcadas como obligatorias hacen fallar el compose con un mensaje claro si faltan.

| Variable | Obligatoria | Ejemplo | Para qué sirve |
|---|---|---|---|
| `DOCKERHUB_USER` | no | `tu-usuario-dockerhub` | Prefijo del nombre de las imágenes (para publicarlas). |
| `IMAGE_TAG` | no | `latest` | Etiqueta de las imágenes. |
| `FRONTEND_PORT` | no | `4200` | Puerto del host donde se abre la aplicación. |
| `SPRING_PROFILES_ACTIVE` | no | *(vacío)* | Vacío = desarrollo. Con `prod` exige `CORS_ORIGENES` con https (ver limitaciones). |
| `JWT_SECRET` | **sí** | 32 bytes o más | Clave de firma de los tokens JWT. |
| `MEDICAMENTOS_API_KEY` | **sí** | 32 caracteres o más | Clave compartida entre las dos APIs (`X-Api-Key`). |
| `ADMIN_USERNAME` | no | `admin` | Usuario del administrador inicial. |
| `ADMIN_PASSWORD` | **sí** | 10 caracteres o más | Contraseña del admin; solo se aplica al crearlo. |
| `PACHOCLO_DB_NAME` / `_USER` | no | `pachoclosystem` / `pachoclosystem_app` | Base y rol de PachocloSystem. |
| `PACHOCLO_DB_PASSWORD` | **sí** | — | Contraseña de ese rol. |
| `MEDICAMENTOS_DB_NAME` / `_USER` | no | `medicamentos` / `medicamentos_app` | Base y rol de MedicamentosService. |
| `MEDICAMENTOS_DB_PASSWORD` | **sí** | — | Contraseña de ese rol. |
| `CORS_ORIGENES` | no | *(vacío)* | Orígenes permitidos. No se necesita: nginx hace de proxy en el mismo origen. |
| `NGINX_IP` | no | `172.28.10.10` | IP fija de nginx; es el único proxy de confianza para el límite de login. |

`API_BASE_URL` no se usa aquí: solo la necesita el build de Vercel. En Docker el frontend llama a
`/api` en su propio origen.

## Criterios de la rúbrica → fragmento del compose

| Criterio | Dónde se cumple |
|---|---|
| **1. Archivo `docker-compose.yml`** con extensión `.yml` | [`docker-compose.yml`](../docker-compose.yml) en la raíz; `docker compose config` lo valida. |
| **2. Servicios** (mínimo 3) | 5 servicios bajo `services:` (ver abajo). |
| **3. Enlaces entre servicios** | Variables que apuntan al nombre del servicio + `depends_on` con `service_healthy` (ver abajo). |
| **4. Volúmenes** | Bloque `volumes:` y su uso en 3 servicios (ver abajo). |
| **5. Puertos** | `ports:` solo en `frontend` (ver abajo). |
| **6. Redes** | Bloque `networks:` con `publica` e `interna` (ver abajo). |
| 7. Publicación en Docker Hub y GitHub | Imágenes en `twcfine/pachoclo-*` ([`docker-compose.hub.yml`](../docker-compose.hub.yml)) y código en GitHub; ver la sección [Publicación](#publicación). |

### Servicios

```yaml
services:
  frontend:             # build: ./frontend              (nginx + SPA Angular)
  pachoclo-api:         # build: ./PachocloSystem        (Spring Boot, JWT, roles)
  medicamentos-service: # build: ./MedicamentosService   (Spring Boot, inventario)
  db-pachoclo:          # image: postgres:18
  db-medicamentos:      # image: postgres:18
```

Los 5 tienen `healthcheck` y `restart: unless-stopped`.

### Enlaces entre servicios

El nombre del servicio es su nombre de host dentro de la red (DNS interno de Docker):

```yaml
  pachoclo-api:
    environment:
      MEDICAMENTOS_URL: http://medicamentos-service:8081          # API → microservicio
      PACHOCLOSYSTEM_DB_URL: jdbc:postgresql://db-pachoclo:5432/${PACHOCLO_DB_NAME:-pachoclosystem}
    depends_on:
      db-pachoclo:
        condition: service_healthy
      medicamentos-service:
        condition: service_healthy

  medicamentos-service:
    environment:
      MEDICAMENTOS_DB_URL: jdbc:postgresql://db-medicamentos:5432/${MEDICAMENTOS_DB_NAME:-medicamentos}
    depends_on:
      db-medicamentos:
        condition: service_healthy

  frontend:
    depends_on:
      pachoclo-api:
        condition: service_healthy
```

Además, [`frontend/nginx.conf`](../frontend/nginx.conf) reenvía `/api/` a `http://pachoclo-api:8080`.

### Volúmenes

```yaml
  db-pachoclo:
    volumes:
      - pachoclo-datos:/var/lib/postgresql        # datos de PachocloSystem
  db-medicamentos:
    volumes:
      - medicamentos-datos:/var/lib/postgresql    # datos de MedicamentosService
  pachoclo-api:
    volumes:
      - pachoclo-logs:/var/log/pachoclo           # log de la aplicación (LOGGING_FILE_NAME)

volumes:
  pachoclo-datos:
  medicamentos-datos:
  pachoclo-logs:
```

### Puertos

```yaml
  frontend:
    ports:
      - "${FRONTEND_PORT:-4200}:8080"    # único puerto publicado al host
```

Los demás servicios no tienen `ports:`; sus puertos (8080, 8081, 5432) solo existen dentro de las
redes de Docker.

### Redes

```yaml
networks:
  publica:                         # frontend y pachoclo-api
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.10.0/24
  interna:                         # bases de datos y medicamentos-service
    driver: bridge
    internal: true                 # sin salida a internet ni al host
```

`pachoclo-api` está en las dos redes (`publica:` e `interna:`); `frontend` solo en `publica`;
`medicamentos-service` y las bases solo en `interna`. Así el frontend no puede alcanzar las bases
ni el microservicio.

## Publicación

Las 3 imágenes propias están publicadas (públicas) en Docker Hub con los tags `1.0` y `latest`.
Las bases usan la imagen oficial `postgres:18`, que no se republica.

| Imagen | Docker Hub | Digest de `1.0` y `latest` |
|---|---|---|
| `twcfine/pachoclo-frontend` | <https://hub.docker.com/r/twcfine/pachoclo-frontend> | `sha256:efd8ca32533b9a6d0a7de6ee95482c817bc0b7f482e90d5500de9dee21d8c53f` |
| `twcfine/pachoclo-api` | <https://hub.docker.com/r/twcfine/pachoclo-api> | `sha256:5a66b1e378ac2ba113802ab2a0f9c79fc0d12459e01aad61f6d4914ce7b3a63c` |
| `twcfine/pachoclo-medicamentos` | <https://hub.docker.com/r/twcfine/pachoclo-medicamentos> | `sha256:494e202b2b017f915b07aa481bb2b2187e34ef3c956bc21d91fd26154a09f541` |

Perfil: <https://hub.docker.com/u/twcfine>. Código: <https://github.com/TWC-FINE/PachocloSystem>.

### Comandos usados

Con la sesión de Docker Hub ya abierta (Docker Desktop guarda la credencial; no se escribió ninguna
contraseña ni token). Para abrirla en otra máquina: `docker login` y escribir las credenciales en el
aviso interactivo.

```bash
# 1. Construir con el tag de versión (DOCKERHUB_USER e IMAGE_TAG dan el nombre de cada imagen)
DOCKERHUB_USER=twcfine IMAGE_TAG=1.0 docker compose build

# 2. Añadir el tag "latest" a la misma imagen
for i in api medicamentos frontend; do
  docker tag twcfine/pachoclo-$i:1.0 twcfine/pachoclo-$i:latest
done

# 3. Publicar los dos tags de cada imagen
for i in api medicamentos frontend; do
  docker push twcfine/pachoclo-$i:1.0
  docker push twcfine/pachoclo-$i:latest
done
```

Antes de publicar se comprobó que las imágenes no contienen `.env`, claves privadas ni secretos
(solo el bundle de certificados raíz de Alpine), y después, sin autenticación, que los 3
repositorios son públicos (`is_private: false`).

### Ejecutarlo solo con Docker Hub

[`docker-compose.hub.yml`](../docker-compose.hub.yml) es igual que `docker-compose.yml` salvo que
las 3 imágenes propias se **descargan** (`image:`) en vez de construirse (`build:`). Solo hacen falta
ese archivo y un `.env` copiado de `.env.example`; no hace falta el código fuente.

```bash
cp .env.example .env
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d      # luego: http://localhost:4200
docker compose -f docker-compose.hub.yml down       # (con -v también borra los datos)
```

Se probó en una carpeta con solo esos dos archivos y sin imágenes locales de `twcfine/*`: el `pull`
las descargó, los 5 servicios quedaron `healthy`, el login del admin respondió 200 y los digests de
las imágenes en ejecución coincidían con los publicados.

## Seguridad aplicada

- **Contenedores sin root:** los backends corren como `app` (uid 10001) y nginx como `nginx` (uid 101).
- **Sin secretos en las imágenes:** `.dockerignore` excluye `.env`; todo llega por variables en ejecución.
- **Aislamiento de red:** bases de datos y `medicamentos-service` en una red `internal`, sin puertos al host.
- **Límite de intentos de login con la IP real:** `APP_LOGIN_PROXIES_CONFIABLES` es **solo la IP de nginx**
  (`172.28.10.10`), no toda la subred. Si fuera `172.28.10.0/24`, la puerta de enlace
  (`172.28.10.1`, que es la IP con la que nginx ve al cliente) quedaría como "proxy" y un cliente
  podría falsificar `X-Forwarded-For` para esquivar el bloqueo.
- **Cabeceras en nginx:** `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`.

## Limitaciones conocidas

- **Sin HTTPS.** Se sirve por `http://localhost:4200`. Con `SPRING_PROFILES_ACTIVE=prod`,
  PachocloSystem exige `CORS_ORIGENES` con al menos un origen `https`, así que este despliegue
  corre en modo desarrollo (perfil vacío). Añadir TLS en nginx es la mejora prevista.
- **La IP del cliente depende de la plataforma.** Desde el mismo equipo (Docker Desktop) todos los
  clientes llegan con la IP de la puerta de enlace de la red, así que comparten límite de intentos.
  Solo se probó desde el mismo equipo: no se verificó cómo se ve un cliente remoto real.
- **Una sola instancia de `pachoclo-api`:** el límite de login y la idempotencia del historial viven
  en su memoria.
- **El rol de PostgreSQL es el superusuario de su propio contenedor** (`POSTGRES_USER`).
- **No se incluyen** contenedores de Python, Node (servidor), Redis ni MongoDB: el sistema no los usa.
