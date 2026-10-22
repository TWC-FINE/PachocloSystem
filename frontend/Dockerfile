# syntax=docker/dockerfile:1
# Frontend Angular. Etapa Node para `ng build` y etapa nginx (sin privilegios) para
# servir. El build usa environment.ts (apiBaseUrl vacía): el navegador llama a /api en
# el mismo origen y nginx lo reenvía a PachocloSystem (ver nginx.conf).

# ---- Etapa 1: compilar ----
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

# ---- Etapa 2: servir ----
# nginx-unprivileged corre como usuario no root (uid 101) y escucha en el 8080.
FROM nginxinc/nginx-unprivileged:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO /dev/null http://127.0.0.1:8080/ || exit 1
