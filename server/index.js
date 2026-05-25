/**
 * API monolito (legacy). Desarrollo y produccion usan microservicios:
 * npm run dev  -> gateway + auth + places + geo + trips
 * npm run start:monolith  -> solo este archivo
 */
import 'dotenv/config'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { all, get, run } from './db.js'
import { famousPlaces, quickSearchGroups } from './famousPlaces.js'
import { mendozaPlaces, mendozaQuickSearchGroups } from './mendozaPlaces.js'
import { argentinaPlaces, argentinaQuickSearchGroups } from './argentinaPlaces.js'
import { filterAntarcticaFromGeoJson } from './geoFilter.js'
import { filterPlacesByDepartment, filterPlacesByProvince } from './geoNormalize.js'
import { geoAreas, places as seedPlaces } from './seedData.js'

const app = express()
const PORT = process.env.PORT || 4000
const JWT_SECRET = process.env.JWT_SECRET || 'wayturismo-dev-secret'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.resolve(__dirname, '..', 'dist')

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, features: { calles: true, callesPuntos: true, eventLocation: true } })
})

function createToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '8h' },
  )
}

async function ensureSchema() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    country TEXT NOT NULL,
    province TEXT NOT NULL,
    locality TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'tourist',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)

  await run(`CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    level TEXT NOT NULL,
    parentKey TEXT,
    centerLat REAL NOT NULL,
    centerLng REAL NOT NULL,
    zoom REAL NOT NULL,
    geojson TEXT NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    image TEXT NOT NULL,
    category TEXT NOT NULL,
    phone TEXT NOT NULL,
    province TEXT NOT NULL,
    department TEXT NOT NULL,
    areaKey TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    createdBy INTEGER,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_places_name_area ON places(name, areaKey)')
  await run("UPDATE places SET category = 'hospitales' WHERE category = 'salud'")
  await run("UPDATE places SET category = 'hoteles' WHERE category = 'eventos'")

  await run(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    placeId INTEGER NOT NULL,
    UNIQUE(userId, placeId)
  )`)

  await run(`CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    name TEXT NOT NULL,
    placeIds TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)

  const admin = await get('SELECT id FROM users WHERE email = ?', ['admin@wayturismo.app'])
  if (!admin) {
    const passwordHash = await bcrypt.hash('admin123', 10)
    await run(
      'INSERT INTO users (name, email, passwordHash, country, province, locality, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['Admin', 'admin@wayturismo.app', passwordHash, 'Argentina', 'Mendoza', 'Capital', 'admin'],
    )
  }

  for (const area of geoAreas) {
    await run(
      'INSERT OR IGNORE INTO areas (key, name, level, parentKey, centerLat, centerLng, zoom, geojson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [area.key, area.name, area.level, area.parentKey, area.centerLat, area.centerLng, area.zoom, area.geojson],
    )
  }

  await run("DELETE FROM places WHERE province = 'Mendoza' AND areaKey LIKE 'famous-%'")
  const famousOutsideMendoza = famousPlaces.filter((p) => p.province !== 'Mendoza')
  const allSeedPlaces = [...seedPlaces, ...famousOutsideMendoza, ...mendozaPlaces, ...argentinaPlaces]
  for (const place of allSeedPlaces) {
    await run(
      'INSERT OR IGNORE INTO places (name, description, image, category, phone, province, department, areaKey, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [place.name, place.description, place.image, place.category, place.phone, place.province, place.department, place.areaKey, place.lat, place.lng],
    )
  }
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    res.status(401).json({ error: 'No autenticado' })
    return
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token invalido' })
  }
}

function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Solo admin' })
    return
  }
  next()
}

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, country, province, locality } = req.body
  if (!name || !email || !password || !country || !province || !locality) {
    res.status(400).json({ error: 'Faltan campos obligatorios' })
    return
  }

  const existing = await get('SELECT id FROM users WHERE email = ?', [email])
  if (existing) {
    res.status(409).json({ error: 'Email ya registrado' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const result = await run(
    'INSERT INTO users (name, email, passwordHash, country, province, locality, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, email, passwordHash, country, province, locality, 'tourist'],
  )
  const user = { id: result.lastID, name, email, role: 'tourist' }
  res.status(201).json({ token: createToken(user), user })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    res.status(400).json({ error: 'Email y password son obligatorios' })
    return
  }

  const user = await get('SELECT * FROM users WHERE email = ?', [email])
  if (!user) {
    res.status(401).json({ error: 'Credenciales invalidas' })
    return
  }
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) {
    res.status(401).json({ error: 'Credenciales invalidas' })
    return
  }

  res.json({
    token: createToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  })
})

function mergeQuickSearchGroups(...groupLists) {
  const merged = new Map()
  for (const groups of groupLists) {
    for (const group of groups) {
      const bucket = merged.get(group.category) || { ...group, items: [] }
      const seen = new Set(bucket.items.map((item) => item.id))
      for (const item of group.items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        bucket.items.push(item)
      }
      merged.set(group.category, bucket)
    }
  }
  return [...merged.values()]
}

app.get('/api/quick-search', (_req, res) => {
  res.json({
    national: mergeQuickSearchGroups(quickSearchGroups, argentinaQuickSearchGroups),
    mendoza: mendozaQuickSearchGroups,
  })
})

app.get('/api/areas', async (_req, res) => {
  const rows = await all('SELECT * FROM areas ORDER BY id')
  const formatted = rows.map((row) => ({ ...row, geojson: JSON.parse(row.geojson) }))
  res.json(formatted)
})

app.get('/api/locations/provinces', async (req, res) => {
  const country = String(req.query.country || 'Argentina').toLowerCase()
  if (country !== 'argentina') {
    res.json([])
    return
  }
  const response = await fetch('https://apis.datos.gob.ar/georef/api/provincias?campos=nombre,centroide&max=100')
  if (!response.ok) {
    res.status(502).json({ error: 'No se pudo obtener provincias' })
    return
  }
  const data = await response.json()
  const provinces = (data.provincias || [])
    .map((p) => ({
      name: p.nombre,
      lat: p.centroide?.lat ?? null,
      lng: p.centroide?.lon ?? null,
    }))
    .filter((p) => p.lat != null && p.lng != null)
    .sort((a, b) => a.name.localeCompare(b.name))
  res.json(provinces)
})

app.get('/api/locations/departments', async (req, res) => {
  const province = String(req.query.province || '')
  if (!province.trim()) {
    res.status(400).json({ error: 'province es obligatorio' })
    return
  }
  const query = new URLSearchParams({
    provincia: province,
    campos: 'nombre,centroide',
    max: '1000',
  })
  const response = await fetch(`https://apis.datos.gob.ar/georef/api/departamentos?${query.toString()}`)
  if (!response.ok) {
    res.status(502).json({ error: 'No se pudo obtener departamentos' })
    return
  }
  const data = await response.json()
  const departments = (data.departamentos || [])
    .map((d) => ({
      name: d.nombre,
      lat: d.centroide?.lat ?? null,
      lng: d.centroide?.lon ?? null,
    }))
    .filter((d) => d.lat != null && d.lng != null)
    .sort((a, b) => a.name.localeCompare(b.name))
  res.json(departments)
})

const GEO_CACHE_TTL_MS = 60 * 60 * 1000
const geoCache = {
  provincias: { data: null, ts: 0 },
  departamentos: { data: null, ts: 0 },
}

async function fetchGeoJsonFollowRedirects(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`GeoJSON ${response.status}`)
  }
  return response.json()
}

app.get('/api/geo/provincias', async (_req, res) => {
  try {
    const now = Date.now()
    if (!geoCache.provincias.data || now - geoCache.provincias.ts > GEO_CACHE_TTL_MS) {
      geoCache.provincias.data = await fetchGeoJsonFollowRedirects('https://apis.datos.gob.ar/georef/api/v2.0/provincias.geojson')
      geoCache.provincias.ts = now
    }
    res.json(filterAntarcticaFromGeoJson(geoCache.provincias.data))
  } catch {
    res.status(502).json({ error: 'No se pudo cargar geometrias de provincias' })
  }
})

app.get('/api/geo/departamentos', async (req, res) => {
  const provinciaNombre = String(req.query.provincia || '').trim()
  if (!provinciaNombre) {
    res.status(400).json({ error: 'provincia es obligatorio' })
    return
  }
  try {
    const pr = await fetch(`https://apis.datos.gob.ar/georef/api/provincias?nombre=${encodeURIComponent(provinciaNombre)}&exacto=true&campos=id,nombre`)
    const prData = await pr.json()
    const provinciaId = prData.provincias?.[0]?.id
    if (!provinciaId) {
      res.json({ type: 'FeatureCollection', features: [] })
      return
    }
    const now = Date.now()
    if (!geoCache.departamentos.data || now - geoCache.departamentos.ts > GEO_CACHE_TTL_MS) {
      geoCache.departamentos.data = await fetchGeoJsonFollowRedirects('https://apis.datos.gob.ar/georef/api/v2.0/departamentos.geojson?max=1000')
      geoCache.departamentos.ts = now
    }
    const all = geoCache.departamentos.data
    const filtered = {
      type: 'FeatureCollection',
      features: (all.features || []).filter((f) => f.properties?.provincia?.id === provinciaId),
    }
    res.json(filtered)
  } catch {
    res.status(502).json({ error: 'No se pudo cargar geometrias de departamentos' })
  }
})

app.get('/api/geo/localidades', async (req, res) => {
  const provincia = String(req.query.provincia || '').trim()
  const departamento = String(req.query.departamento || '').trim()
  if (!provincia || !departamento) {
    res.status(400).json({ error: 'provincia y departamento son obligatorios' })
    return
  }
  try {
    const deptUrl = `https://apis.datos.gob.ar/georef/api/departamentos?provincia=${encodeURIComponent(provincia)}&nombre=${encodeURIComponent(departamento)}&exacto=true&campos=id,nombre`
    const dr = await fetch(deptUrl)
    const dd = await dr.json()
    const deptId = dd.departamentos?.[0]?.id
    if (!deptId) {
      res.json({ type: 'FeatureCollection', features: [] })
      return
    }
    const maxRaw = Number(req.query.max)
    const maxLoc = Math.min(5000, Math.max(50, Number.isFinite(maxRaw) ? maxRaw : 2500))
    const locUrl = `https://apis.datos.gob.ar/georef/api/localidades?departamento=${deptId}&max=${maxLoc}&campos=id,nombre,centroide`
    const lr = await fetch(locUrl)
    const ld = await lr.json()
    const features = (ld.localidades || [])
      .filter((loc) => loc.centroide?.lat != null && loc.centroide?.lon != null)
      .map((loc) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [loc.centroide.lon, loc.centroide.lat],
        },
        properties: { id: loc.id, nombre: loc.nombre },
      }))
    res.json({ type: 'FeatureCollection', features })
  } catch {
    res.status(502).json({ error: 'No se pudo cargar localidades' })
  }
})

async function resolveDepartamentoId(provincia, departamento) {
  const tryFetch = async (exacto) => {
    const deptUrl = `https://apis.datos.gob.ar/georef/api/departamentos?provincia=${encodeURIComponent(provincia)}&nombre=${encodeURIComponent(departamento)}&exacto=${exacto}&campos=id,nombre`
    const dr = await fetch(deptUrl)
    if (!dr.ok) return null
    const dd = await dr.json()
    return dd.departamentos?.[0]?.id ?? null
  }
  const exactId = await tryFetch(true)
  if (exactId) return exactId
  return tryFetch(false)
}

async function fetchCallesByDepartamentoId(deptId) {
  const names = new Set()
  const pageSize = 5000
  let inicio = 0
  let total = Number.POSITIVE_INFINITY

  while (inicio < total) {
    const callesUrl = new URL('https://apis.datos.gob.ar/georef/api/calles')
    callesUrl.searchParams.set('departamento', String(deptId))
    callesUrl.searchParams.set('max', String(pageSize))
    callesUrl.searchParams.set('inicio', String(inicio))
    callesUrl.searchParams.set('campos', 'nombre')
    const callesRes = await fetch(callesUrl)
    if (!callesRes.ok) break
    const callesData = await callesRes.json()
    const batch = callesData.calles || []
    total = Number(callesData.total ?? batch.length)
    for (const calle of batch) {
      if (calle?.nombre) names.add(String(calle.nombre).trim())
    }
    if (batch.length === 0) break
    inicio += batch.length
  }

  return names
}

const CALLES_PUNTOS_CACHE_MS = 24 * 60 * 60 * 1000
const callesPuntosCache = new Map()

function sampleStreetNames(names, max) {
  const list = [...names].sort((a, b) => a.localeCompare(b, 'es'))
  if (list.length <= max) return list
  const step = list.length / max
  const picked = []
  for (let i = 0; i < max; i += 1) {
    picked.push(list[Math.min(list.length - 1, Math.floor(i * step))])
  }
  return picked
}

app.get('/api/geo/calles-puntos', async (req, res) => {
  const provincia = String(req.query.provincia || '').trim()
  const departamento = String(req.query.departamento || '').trim()
  const maxRaw = Number(req.query.max)
  const max = Math.min(180, Math.max(40, Number.isFinite(maxRaw) ? maxRaw : 120))
  if (!provincia || !departamento) {
    res.status(400).json({ error: 'provincia y departamento son obligatorios' })
    return
  }
  const cacheKey = `${provincia}|${departamento}|${max}`
  const cached = callesPuntosCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CALLES_PUNTOS_CACHE_MS) {
    res.json(cached.data)
    return
  }
  try {
    const deptId = await resolveDepartamentoId(provincia, departamento)
    if (!deptId) {
      res.json({ type: 'FeatureCollection', features: [] })
      return
    }
    const allNames = await fetchCallesByDepartamentoId(deptId)
    const sample = sampleStreetNames(allNames, max)
    const features = []
    const batchSize = 12
    for (let i = 0; i < sample.length; i += batchSize) {
      const batch = sample.slice(i, i + batchSize)
      const hits = await Promise.all(
        batch.map(async (nombre) => {
          const point = await georefDireccionResolve(provincia, departamento, nombre)
          if (!point) return null
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
            properties: { nombre, tipo: 'calle' },
          }
        }),
      )
      for (const feature of hits) {
        if (feature) features.push(feature)
      }
    }
    const data = { type: 'FeatureCollection', features }
    callesPuntosCache.set(cacheKey, { ts: Date.now(), data })
    res.json(data)
  } catch {
    res.status(502).json({ error: 'No se pudieron ubicar calles del departamento' })
  }
})

app.get('/api/geo/calles', async (req, res) => {
  const provincia = String(req.query.provincia || '').trim()
  const departamento = String(req.query.departamento || '').trim()
  const exclude = String(req.query.exclude || '').trim()
  if (!provincia || !departamento) {
    res.status(400).json({ error: 'provincia y departamento son obligatorios' })
    return
  }
  try {
    const deptId = await resolveDepartamentoId(provincia, departamento)
    const names = deptId ? await fetchCallesByDepartamentoId(deptId) : new Set()

    if (names.size < 5) {
      const locUrl = deptId
        ? `https://apis.datos.gob.ar/georef/api/localidades?departamento=${deptId}&max=500&campos=nombre`
        : null
      if (locUrl) {
        const lr = await fetch(locUrl)
        const ld = await lr.json()
        for (const loc of ld.localidades || []) {
          if (loc?.nombre) names.add(String(loc.nombre).trim())
        }
      }
    }

    let list = [...names].sort((a, b) => a.localeCompare(b, 'es'))
    if (exclude) {
      const ex = exclude.toLowerCase()
      list = list.filter((n) => n.toLowerCase() !== ex)
    }
    res.json(list)
  } catch {
    res.status(502).json({ error: 'No se pudo cargar calles del departamento' })
  }
})

app.get('/api/places', async (req, res) => {
  const { category, q, areaKey, country, province, department, scope } = req.query
  const conditions = []
  const params = []
  const searchQuery = String(q || '').trim()
  const isNationalSearch = searchQuery.length > 0
  const scopeProvince = scope === 'province'
  const scopeDepartment = scope === 'department'

  if (category && category !== 'all') {
    if (category === 'hospitales') {
      conditions.push("(category = 'hospitales' OR category = 'salud')")
    } else if (category === 'hoteles') {
      conditions.push("(category = 'hoteles' OR category = 'eventos')")
    } else {
      conditions.push('category = ?')
      params.push(category)
    }
  }
  if (isNationalSearch) {
    conditions.push('LOWER(name) LIKE ?')
    params.push(`%${searchQuery.toLowerCase()}%`)
  }
  if (country && String(country).toLowerCase() !== 'argentina') {
    res.json([])
    return
  }
  if (!isNationalSearch && !scopeProvince && !scopeDepartment) {
    if (areaKey && areaKey !== 'argentina') {
      const area = await get('SELECT * FROM areas WHERE key = ?', [areaKey])
      if (area?.level === 'department') {
        conditions.push('(areaKey = ?)')
        params.push(area.key)
      }
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  let rows = await all(`SELECT * FROM places ${where} ORDER BY id`, params)

  if (!isNationalSearch) {
    if (scopeProvince && province) {
      rows = filterPlacesByProvince(rows, province)
    } else if (scopeDepartment && province && department) {
      rows = filterPlacesByProvince(rows, province)
      rows = filterPlacesByDepartment(rows, department)
    } else if (province && String(province).toLowerCase() !== 'all') {
      rows = filterPlacesByProvince(rows, province)
      if (department && String(department).toLowerCase() !== 'all') {
        rows = filterPlacesByDepartment(rows, department)
      }
    } else if (areaKey && areaKey !== 'argentina' && !scopeProvince && !scopeDepartment) {
      const area = await get('SELECT * FROM areas WHERE key = ?', [areaKey])
      if (area?.level === 'province') {
        rows = filterPlacesByProvince(rows, area.name)
      }
    }
  }

  res.json(rows)
})

app.get('/api/places/by-ids', async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (!ids.length) {
    res.json([])
    return
  }
  const placeholders = ids.map(() => '?').join(',')
  const rows = await all(`SELECT * FROM places WHERE id IN (${placeholders})`, ids)
  res.json(rows)
})

async function georefDireccionResolve(provincia, departamento, direccion) {
  const line = String(direccion || '').trim()
  if (!line || !provincia || !departamento) return null
  const url = new URL('https://apis.datos.gob.ar/georef/api/direcciones')
  url.searchParams.set('direccion', line)
  url.searchParams.set('provincia', provincia)
  url.searchParams.set('departamento', departamento)
  url.searchParams.set('max', '1')
  const response = await fetch(url)
  if (!response.ok) return null
  const data = await response.json()
  const ubicacion = data.direcciones?.[0]?.ubicacion
  if (ubicacion?.lat == null || ubicacion?.lon == null) return null
  return { lat: Number(ubicacion.lat), lng: Number(ubicacion.lon) }
}

async function nominatimSearch(query, viewbox) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('countrycodes', 'ar')
  url.searchParams.set('limit', '5')
  if (viewbox) {
    url.searchParams.set('viewbox', viewbox)
    url.searchParams.set('bounded', '1')
  }
  const response = await fetch(url, {
    headers: { 'User-Agent': 'WayTurismo/1.0 (wayturismo@local.dev)' },
  })
  if (!response.ok) return null
  const data = await response.json()
  const first = data?.[0]
  if (!first?.lat || !first?.lon) return null
  return { lat: Number(first.lat), lng: Number(first.lon) }
}

async function departmentNominatimViewbox(provincia, departamento) {
  const deptId = await resolveDepartamentoId(provincia, departamento)
  if (!deptId) return null
  const dr = await fetch(
    `https://apis.datos.gob.ar/georef/api/departamentos?id=${deptId}&campos=centroide`,
  )
  if (!dr.ok) return null
  const dd = await dr.json()
  const c = dd.departamentos?.[0]?.centroide
  if (c?.lat == null || c?.lon == null) return null
  const lat = Number(c.lat)
  const lon = Number(c.lon)
  const pad = 0.35
  const left = lon - pad
  const right = lon + pad
  const top = lat + pad
  const bottom = lat - pad
  return `${left},${top},${right},${bottom}`
}

async function departmentCentroid(provincia, departamento) {
  const deptId = await resolveDepartamentoId(provincia, departamento)
  if (!deptId) return null
  const dr = await fetch(`https://apis.datos.gob.ar/georef/api/departamentos?id=${deptId}&campos=centroide`)
  if (!dr.ok) return null
  const dd = await dr.json()
  const centroide = dd.departamentos?.[0]?.centroide
  if (centroide?.lat == null || centroide?.lon == null) return null
  return { lat: Number(centroide.lat), lng: Number(centroide.lon) }
}

app.get('/api/geo/event-location', async (req, res) => {
  const provincia = String(req.query.provincia || '').trim()
  const departamento = String(req.query.departamento || '').trim()
  const calle1 = String(req.query.calle1 || '').trim()
  const calle2 = String(req.query.calle2 || '').trim()
  const sitio = String(req.query.sitio || '').trim()
  if (!provincia || !departamento) {
    res.status(400).json({ error: 'provincia y departamento son obligatorios' })
    return
  }
  try {
    const streetLine = calle1 && calle2 ? `${calle1} y ${calle2}` : calle1 || calle2
    const georefLines = [
      streetLine,
      calle1 && calle2 ? null : calle1,
      calle1 && calle2 ? null : calle2,
    ].filter(Boolean)

    for (const line of georefLines) {
      const hit = await georefDireccionResolve(provincia, departamento, line)
      if (hit) {
        res.json({ ...hit, precision: 'intersection' })
        return
      }
    }

    const viewbox = await departmentNominatimViewbox(provincia, departamento)
    const queries = [
      streetLine ? `${streetLine}, ${departamento}, ${provincia}, Argentina` : null,
      sitio && streetLine ? `${sitio}, ${streetLine}, ${departamento}, ${provincia}, Argentina` : null,
      calle1 ? `${calle1}, ${departamento}, ${provincia}, Argentina` : null,
    ].filter(Boolean)

    for (const query of queries) {
      const hit = await nominatimSearch(query, viewbox)
      if (hit) {
        res.json({ ...hit, precision: 'address' })
        return
      }
    }

    const center = await departmentCentroid(provincia, departamento)
    if (center) {
      res.json({ ...center, precision: 'department' })
      return
    }
    res.status(404).json({ error: 'No se pudo ubicar el evento' })
  } catch {
    res.status(502).json({ error: 'No se pudo ubicar el evento' })
  }
})

app.get('/api/geocode', async (req, res) => {
  const query = String(req.query.q || '').trim()
  if (query.length < 2) {
    res.json([])
    return
  }
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('countrycodes', 'ar')
    url.searchParams.set('limit', '6')
    url.searchParams.set('addressdetails', '0')
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WayTurismo/1.0 (wayturismo@local.dev)' },
    })
    if (!response.ok) {
      res.status(502).json({ error: 'No se pudo geocodificar' })
      return
    }
    const data = await response.json()
    res.json(
      data.map((item) => ({
        id: `geo-${item.place_id}`,
        name: String(item.display_name).split(',')[0].trim(),
        displayName: item.display_name,
        lat: Number(item.lat),
        lng: Number(item.lon),
        kind: 'geocode',
        placeType: item.type || item.class || '',
      })),
    )
  } catch {
    res.status(502).json({ error: 'No se pudo geocodificar' })
  }
})

app.post('/api/favorites/:placeId/toggle', auth, async (req, res) => {
  const placeId = Number(req.params.placeId)
  const existing = await get('SELECT * FROM favorites WHERE userId = ? AND placeId = ?', [req.user.sub, placeId])
  if (existing) {
    await run('DELETE FROM favorites WHERE id = ?', [existing.id])
  } else {
    await run('INSERT INTO favorites (userId, placeId) VALUES (?, ?)', [req.user.sub, placeId])
  }
  const rows = await all('SELECT placeId FROM favorites WHERE userId = ?', [req.user.sub])
  res.json(rows.map((x) => x.placeId))
})

app.get('/api/favorites', auth, async (req, res) => {
  const rows = await all('SELECT placeId FROM favorites WHERE userId = ?', [req.user.sub])
  res.json(rows.map((x) => x.placeId))
})

app.post('/api/routes', auth, async (req, res) => {
  const { name, placeIds } = req.body
  if (!name || !Array.isArray(placeIds) || placeIds.length < 2) {
    res.status(400).json({ error: 'Ruta invalida' })
    return
  }
  await run('INSERT INTO routes (userId, name, placeIds) VALUES (?, ?, ?)', [req.user.sub, name, JSON.stringify(placeIds)])
  const rows = await all('SELECT id, name, placeIds, createdAt FROM routes WHERE userId = ? ORDER BY id DESC', [req.user.sub])
  res.json(rows.map((r) => ({ ...r, placeIds: JSON.parse(r.placeIds) })))
})

app.get('/api/routes', auth, async (req, res) => {
  const rows = await all('SELECT id, name, placeIds, createdAt FROM routes WHERE userId = ? ORDER BY id DESC', [req.user.sub])
  res.json(rows.map((r) => ({ ...r, placeIds: JSON.parse(r.placeIds) })))
})

app.delete('/api/routes/:id', auth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Ruta invalida' })
    return
  }
  await run('DELETE FROM routes WHERE id = ? AND userId = ?', [id, req.user.sub])
  const rows = await all('SELECT id, name, placeIds, createdAt FROM routes WHERE userId = ? ORDER BY id DESC', [req.user.sub])
  res.json(rows.map((r) => ({ ...r, placeIds: JSON.parse(r.placeIds) })))
})

app.post('/api/admin/places', auth, isAdmin, async (req, res) => {
  const place = req.body
  await run(
    `INSERT INTO places (name, description, image, category, phone, province, department, areaKey, lat, lng, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [place.name, place.description, place.image, place.category, place.phone, place.province, place.department, place.areaKey, place.lat, place.lng, req.user.sub],
  )
  const rows = await all('SELECT * FROM places ORDER BY id')
  res.status(201).json(rows)
})

app.put('/api/admin/places/:id', auth, isAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const place = req.body
  await run(
    `UPDATE places
     SET name = ?, description = ?, image = ?, category = ?, phone = ?, province = ?, department = ?, areaKey = ?, lat = ?, lng = ?
     WHERE id = ?`,
    [place.name, place.description, place.image, place.category, place.phone, place.province, place.department, place.areaKey, place.lat, place.lng, id],
  )
  const rows = await all('SELECT * FROM places ORDER BY id')
  res.json(rows)
})

app.delete('/api/admin/places/:id', auth, isAdmin, async (req, res) => {
  const id = Number(req.params.id)
  await run('DELETE FROM places WHERE id = ?', [id])
  await run('DELETE FROM favorites WHERE placeId = ?', [id])
  const rows = await all('SELECT * FROM places ORDER BY id')
  res.json(rows)
})

app.use((err, _req, res, next) => {
  console.error(err)
  void next
  res.status(500).json({ error: 'Error interno del servidor' })
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`WayTurismo escuchando en http://localhost:${PORT}`)
    })
  })
  .catch((error) => {
    console.error('No se pudo iniciar la API', error)
    process.exit(1)
  })
