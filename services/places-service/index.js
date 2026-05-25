import 'dotenv/config'
import { createDatabase } from '../shared/db.js'
import { authMiddleware, adminMiddleware } from '../shared/jwt.js'
import { createServiceApp, startService } from '../shared/http.js'
import { famousPlaces, quickSearchGroups } from '../../server/famousPlaces.js'
import { mendozaPlaces, mendozaQuickSearchGroups } from '../../server/mendozaPlaces.js'
import { argentinaPlaces, argentinaQuickSearchGroups } from '../../server/argentinaPlaces.js'
import { filterPlacesByDepartment, filterPlacesByProvince } from '../../server/geoNormalize.js'
import { geoAreas, places as seedPlaces } from '../../server/seedData.js'

const PORT = Number(process.env.PLACES_SERVICE_PORT || 4002)
const { run, get, all } = createDatabase('places')
const app = createServiceApp()

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'places-service' })
})

async function ensureSchema() {
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

app.get('/quick-search', (_req, res) => {
  res.json({
    national: mergeQuickSearchGroups(quickSearchGroups, argentinaQuickSearchGroups),
    mendoza: mendozaQuickSearchGroups,
  })
})

app.get('/areas', async (_req, res) => {
  const rows = await all('SELECT * FROM areas ORDER BY id')
  const formatted = rows.map((row) => ({ ...row, geojson: JSON.parse(row.geojson) }))
  res.json(formatted)
})

app.get('/places', async (req, res) => {
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

app.get('/places/by-ids', async (req, res) => {
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

app.post('/admin/places', authMiddleware, adminMiddleware, async (req, res) => {
  const place = req.body
  await run(
    `INSERT INTO places (name, description, image, category, phone, province, department, areaKey, lat, lng, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [place.name, place.description, place.image, place.category, place.phone, place.province, place.department, place.areaKey, place.lat, place.lng, req.user.sub],
  )
  const rows = await all('SELECT * FROM places ORDER BY id')
  res.status(201).json(rows)
})

app.put('/admin/places/:id', authMiddleware, adminMiddleware, async (req, res) => {
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

app.delete('/admin/places/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  await run('DELETE FROM places WHERE id = ?', [id])
  const rows = await all('SELECT * FROM places ORDER BY id')
  res.json(rows)
})

ensureSchema()
  .then(() => startService(app, PORT, 'places-service'))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
