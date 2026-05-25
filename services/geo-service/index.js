import 'dotenv/config'
import { filterAntarcticaFromGeoJson } from '../../server/geoFilter.js'
import { createServiceApp, startService } from '../shared/http.js'

const PORT = Number(process.env.GEO_SERVICE_PORT || 4003)
const app = createServiceApp()

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'geo-service' })
})

app.get('/locations/provinces', async (req, res) => {
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

app.get('/locations/departments', async (req, res) => {
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

app.get('/geo/provincias', async (_req, res) => {
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

app.get('/geo/departamentos', async (req, res) => {
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
    const allGeo = geoCache.departamentos.data
    const filtered = {
      type: 'FeatureCollection',
      features: (allGeo.features || []).filter((f) => f.properties?.provincia?.id === provinciaId),
    }
    res.json(filtered)
  } catch {
    res.status(502).json({ error: 'No se pudo cargar geometrias de departamentos' })
  }
})

app.get('/geo/localidades', async (req, res) => {
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

app.get('/geo/calles-puntos', async (req, res) => {
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

app.get('/geo/calles', async (req, res) => {
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

app.get('/geo/event-location', async (req, res) => {
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

app.get('/geocode', async (req, res) => {
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

startService(app, PORT, 'geo-service').catch((err) => {
  console.error(err)
  process.exit(1)
})
