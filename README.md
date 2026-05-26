# WayTurismo

Aplicacion web de turismo para Argentina con mapa interactivo, autenticacion segura y gestion de lugares.

## Arquitectura del proyecto

### Frontend

SPA desarrollada con **React**, **Vite** y **Leaflet** (mapa interactivo).

- **Ubicacion:** `src/`, `public/`, `index.html`
- **Puerto en desarrollo:** `http://localhost:5173`
- **Comando:** `npm run dev:client` (o `npm run dev` para levantar todo)
- **Entrada:** `src/main.jsx` → `src/App.jsx` (mapa, login, favoritos, rutas, panel admin)

El frontend consume la API a traves de `/api` (en desarrollo Vite hace proxy al gateway en el puerto 4000).

### Backend

API en **Node.js** con **Express**. La arquitectura activa son **microservicios** detras de un **API Gateway**.

- **Ubicacion:** `services/`
- **Puerto publico (gateway):** `http://localhost:4000`
- **Comando:** `npm run dev` (gateway + microservicios + cliente)

Codigo compartido entre servicios: `services/shared/` (JWT, SQLite, utilidades Express).

> **Legacy:** existe un backend monolitico en `server/index.js` (`npm run dev:monolith`). Solo para pruebas; el flujo normal es microservicios.

### Base de datos

**SQLite** (un archivo por dominio de datos). No usa Prisma ni MySQL.

| Base de datos | Ruta | Usada por | Tablas principales |
|---------------|------|-----------|-------------------|
| Auth | `services/data/auth/service.sqlite` | auth-service | `users` |
| Places | `services/data/places/service.sqlite` | places-service | `areas`, `places` |
| Trips | `services/data/trips/service.sqlite` | trips-service | `favorites`, `routes` |

- **Acceso:** `services/shared/db.js` → `createDatabase('auth' | 'places' | 'trips')`
- **Inicializacion:** `npm install` o `npm run setup` crean las carpetas en `services/data/`

El monolito legacy usa una sola BD: `server/data/wayturismo.sqlite`.

### Microservicios

Este proyecto contiene **microservicios independientes** desarrollados en **Node.js con Express**. Se ejecutan en local con `npm run dev` y usan **SQLite** como base de datos (auth, places y trips; geo no persiste datos propios).

- **gateway** – Punto de entrada de la API. Reenvia peticiones a los demas servicios y expone `/api/health`. Puerto **4000**. Carpeta: `services/gateway/`

- **auth-service** – Gestion de usuarios (registro, login, roles). Puerto **4001**. Carpeta: `services/auth-service/`. Base de datos: `services/data/auth/`

- **places-service** – Gestion de lugares turisticos, areas del mapa, busqueda rapida y ABM admin. Puerto **4002**. Carpeta: `services/places-service/`. Base de datos: `services/data/places/`

- **geo-service** – Geografia: provincias, departamentos, GeoJSON, calles, geocoding (API Georef). Puerto **4003**. Carpeta: `services/geo-service/`

- **trips-service** – Favoritos y rutas guardadas por usuario. Puerto **4004**. Carpeta: `services/trips-service/`. Base de datos: `services/data/trips/`

El frontend solo habla con el **gateway** (`/api/...`); el gateway enruta a cada microservicio.

Mas detalle (arbol de carpetas, rutas): [README-ESTRUCTURA.md](./README-ESTRUCTURA.md).

## Cumplimiento de requisitos

| Requisito | Estado | Detalle |
|-----------|--------|---------|
| Frontend | Cumple | `src/`, React + Vite + Leaflet |
| Backend | Cumple | `services/` (microservicios + gateway) |
| Microservicios | Cumple | auth, places, geo, trips + gateway |
| Docker (contenerizacion) | Cumple | `Dockerfile` multi-stage (build + runtime) |
| docker-compose | Cumple | `docker-compose.yml` — 5 servicios |
| 2 pruebas unitarias (backend) | Cumple | `tests/unit/geoNormalize.test.js`, `tests/unit/jwt.test.js` |
| 2 pruebas e2e (backend) | Cumple | `tests/e2e/backend.e2e.test.js` (health + login) |
| Infraestructura / despliegue | Cumple | Docker, Compose, Render, Railway, CI |

## Infraestructura y despliegue

Archivos principales:

- `Dockerfile` — imagen de producción
- `docker-compose.yml` — auth, places, geo, trips, gateway

### Docker (contenerizacion)

- **`Dockerfile`**: imagen Node 22 Alpine; etapa `build` compila el frontend (`npm run build`); etapa `runtime` ejecuta el gateway con `dist/` y los microservicios copiados.
- Cada microservicio puede usar la misma imagen con distinto `command` (ver Compose).

### docker-compose

Archivo **`docker-compose.yml`** define **5 contenedores**:

| Servicio | Contenedor | Comando | Puerto interno |
|----------|------------|---------|----------------|
| auth | auth | `node services/auth-service/index.js` | 4001 |
| places | places | `node services/places-service/index.js` | 4002 |
| geo | geo | `node services/geo-service/index.js` | 4003 |
| trips | trips | `node services/trips-service/index.js` | 4004 |
| gateway | wayturismo | `node services/gateway/index.js` | 4000 → host **4010** |

- Volumenes persistentes: `services/data/auth`, `places`, `trips`.
- Variables de red entre servicios: `AUTH_SERVICE_URL`, `PLACES_SERVICE_URL`, etc.
- Levantar: `docker compose up --build` → app en `http://localhost:4010`

### Otros despliegues

- **Render:** `render.yaml` (Blueprint)
- **Railway:** `railway.json` + `Dockerfile`
- **CI:** `.github/workflows/ci.yml` (lint, build, tests)

## Calidad y testing

Pruebas del **backend** con el runner nativo de Node (`node:test`), sin dependencias extra.

| Tipo | Carpeta | Comando |
|------|---------|---------|
| Unit (2) | `tests/unit/` | `npm run test:unit` |
| E2E (2) | `tests/e2e/` | `npm run test:e2e` |

### Pruebas unitarias (2)

| Archivo | Que prueba |
|---------|------------|
| `tests/unit/geoNormalize.test.js` | Normalizacion de nombres geograficos y filtros por provincia/departamento |
| `tests/unit/jwt.test.js` | Generacion de JWT y middlewares `auth` / `admin` |

```bash
npm run test:unit
```

### Pruebas end-to-end (2)

| Archivo | Que prueba |
|---------|------------|
| `tests/e2e/backend.e2e.test.js` | `GET /api/health` (gateway + microservicios) |
| | `POST /api/auth/login` (flujo real contra auth-service) |

Los e2e levantan auth, places, geo, trips y gateway en puertos **15900–15904** (no chocan con `npm run dev`).

```bash
npm run test:e2e
npm run test          # unit + e2e
```

> Detené `npm run dev` si los puertos 15900–15904 estuvieran ocupados por otro proceso.

## Comandos útiles

| Qué levantar | Comando |
|--------------|---------|
| Todo (recomendado) | `npm run dev` |
| Solo frontend | `npm run dev:client` |
| Solo gateway | `npm run dev:gateway` |
| Monolito legacy | `npm run dev:monolith` |
| Tests backend | `npm run test` |

## Stack

- Frontend: React + Vite + Leaflet
- Backend: Node.js + Express (microservicios + gateway)
- Base de datos: SQLite
- Auth: JWT + bcryptjs

## Visual Studio Code (recomendado)

1. Abrir la carpeta del proyecto en VS Code, o el archivo `wayturismo.code-workspace`.
2. Instalar las extensiones recomendadas cuando VS Code lo pida (ESLint, JavaScript Debugger, etc.).
3. Abrir la terminal integrada (Ctrl+`) y ejecutar:

```bash
npm install
```

El script `postinstall` crea `.env` y la carpeta `server/data` automaticamente.

4. **Iniciar la app** (elige una opcion):
   - **F5** → configuracion **"Iniciar app (npm run dev)"** en la barra de depuracion.
   - **Ctrl+Shift+B** → tarea **"Desarrollo: API + cliente (npm run dev)"**.
   - Terminal: `npm run dev`.

5. Abrir en el navegador: `http://localhost:5173`

### Atajos utiles en VS Code

| Accion | Como |
|--------|------|
| Ejecutar en desarrollo | F5 → *Iniciar app (npm run dev)* |
| Depurar solo la API | Panel Depurar → *Depurar API (Express)* |
| Abrir con depuracion en Chrome | *Frontend en Chrome* (levanta dev antes) |
| Lint | Terminal → `npm run lint` o tarea *Lint (ESLint)* |
| Build | Tarea *Build produccion* |

### Requisitos

- [Node.js](https://nodejs.org/) 20 o superior
- npm (incluido con Node)

## Ejecutar en local (terminal)

1. Instalar dependencias:

```bash
npm install
```

2. Configuracion inicial (opcional si ya corrio `npm install`):

```bash
npm run setup
```

Crea `.env` desde `.env.example` y las carpetas de datos en `services/data/`.

3. Levantar microservicios y cliente:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API (gateway): `http://localhost:4000` — reenvía a auth (4001), places (4002), geo (4003), trips (4004)

Monolito anterior (solo pruebas): `npm run dev:monolith`

## Ejecutar en produccion local

1. Compilar frontend:

```bash
npm run build
```

2. Iniciar gateway (y en otro terminal los 4 servicios, o usar Docker):

```bash
npm run start
```

En produccion local conviene `docker compose up` (levanta los 5 contenedores). La app queda en `http://localhost:4000` si solo corres el gateway con `dist/` ya compilado.

## Docker (inicio rapido)

Construir y ejecutar con Docker Compose:

```bash
docker compose up --build
```

La aplicacion quedara en `http://localhost:4010` (mapeo del gateway en compose).
Las bases SQLite se persisten en `services/data/` (auth, places, trips).
Si aparece un error de `dockerDesktopLinuxEngine`, abrir Docker Desktop y esperar a que quede en estado running.
Si el puerto `4000` esta ocupado, usar el mapeo actual de compose en `http://localhost:4010`.

## Deploy cloud

### Opcion 1: Render (recomendada)

1. Subir el repo a GitHub.
2. En Render, crear **New + > Blueprint** y seleccionar el repo.
3. Render detecta `render.yaml` y despliega automaticamente.
4. Verificar salud en `https://<tu-app>.onrender.com/api/health`.

### Opcion 2: Railway

1. Subir el repo a GitHub.
2. En Railway, crear nuevo proyecto desde GitHub repo.
3. Railway usa el `Dockerfile` para build/deploy.
4. Configurar variable `JWT_SECRET` en Railway.

## CI

El workflow en `.github/workflows/ci.yml` valida en cada push/PR:

- instalacion (`npm ci`)
- lint (`npm run lint`)
- build (`npm run build`)
- pruebas unitarias (`npm run test:unit`)
- pruebas e2e (`npm run test:e2e`)

## Variables de entorno

- `PORT` / `GATEWAY_PORT`: puerto del gateway (default `4000`)
- `AUTH_SERVICE_PORT`, `PLACES_SERVICE_PORT`, `GEO_SERVICE_PORT`, `TRIPS_SERVICE_PORT`: puertos en desarrollo
- `AUTH_SERVICE_URL`, `PLACES_SERVICE_URL`, `GEO_SERVICE_URL`, `TRIPS_SERVICE_URL`: URLs internas (Docker)
- `JWT_SECRET`: secreto compartido para JWT (obligatorio en produccion; auth y trips lo usan)
- `VITE_API_URL`: URL base de API para frontend en desarrollo (opcional; por defecto `/api`)

## Credenciales admin por defecto

- Email: `admin@wayturismo.app`
- Password: `admin123`

## Funcionalidades principales

- Registro e inicio de sesion
- Mapa por niveles (pais, provincia, departamento)
- Busqueda y filtros por categoria
- Favoritos por usuario
- Planificacion y guardado de recorridos
- ABM de lugares para admin
