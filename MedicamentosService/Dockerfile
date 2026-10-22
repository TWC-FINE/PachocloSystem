# syntax=docker/dockerfile:1
# MedicamentosService (microservicio de inventario, puerto 8081). Build multietapa:
# JDK para compilar, JRE mínimo (Alpine) para ejecutar. Los secretos llegan por
# variables de entorno en tiempo de ejecución; no se copia ningún .env a la imagen.

# ---- Etapa 1: compilar ----
FROM eclipse-temurin:25-jdk AS build
WORKDIR /build

# Primero lo que cambia poco (wrapper y pom) para aprovechar la caché de capas.
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN --mount=type=cache,target=/root/.m2 chmod +x mvnw && ./mvnw -B -ntp dependency:go-offline

COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp -DskipTests package \
    && cp target/*.jar app.jar

# ---- Etapa 2: ejecutar ----
FROM eclipse-temurin:25-jre-alpine

RUN addgroup -g 10001 -S app \
    && adduser -u 10001 -S -G app -h /app app

WORKDIR /app
COPY --from=build --chown=app:app /build/app.jar app.jar

USER app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
EXPOSE 8081

# Readiness incluye la base de datos: healthy = puede atender peticiones.
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=5 \
    CMD wget -qO /dev/null http://127.0.0.1:8081/actuator/health/readiness || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
