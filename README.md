# WayTurismo

Aplicacion web de turismo para Argentina con mapa interactivo, autenticacion segura y gestion de lugares.

## Stack

- Frontend: React + Vite + Leaflet
- Backend: Node.js + Express
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

## Docker

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
