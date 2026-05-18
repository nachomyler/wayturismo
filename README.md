# WayTurismo

Aplicacion web de turismo para Argentina con mapa interactivo, autenticacion segura y gestion de lugares.

## Stack

- Frontend: React + Vite + Leaflet
- Backend: Node.js + Express
- Base de datos: SQLite
- Auth: JWT + bcryptjs

## Ejecutar en local

1. Instalar dependencias:

```bash
npm install
```

2. Crear archivo `.env` desde `.env.example` (opcional para desarrollo rapido).

3. Levantar cliente y servidor:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`

## Ejecutar en produccion local

1. Compilar frontend:

```bash
npm run build
```

2. Iniciar servidor Express en modo produccion:

```bash
npm run start
```

La app y la API quedaran en `http://localhost:4000`.

## Docker

Construir y ejecutar con Docker Compose:

```bash
docker compose up --build
```

La aplicacion quedara en `http://localhost:4000`.
La base SQLite se persiste en `server/data`.
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

- `PORT`: puerto de Express (default `4000`)
- `JWT_SECRET`: secreto para firmar tokens JWT (obligatorio en produccion)
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
