import 'dotenv/config'
import { createDatabase } from '../shared/db.js'
import { authMiddleware } from '../shared/jwt.js'
import { createServiceApp, startService } from '../shared/http.js'

const PORT = Number(process.env.TRIPS_SERVICE_PORT || 4004)
const { run, get, all } = createDatabase('trips')
const app = createServiceApp()

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'trips-service' })
})

async function ensureSchema() {
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
}

app.post('/favorites/:placeId/toggle', authMiddleware, async (req, res) => {
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

app.get('/favorites', authMiddleware, async (req, res) => {
  const rows = await all('SELECT placeId FROM favorites WHERE userId = ?', [req.user.sub])
  res.json(rows.map((x) => x.placeId))
})

app.post('/routes', authMiddleware, async (req, res) => {
  const { name, placeIds } = req.body
  if (!name || !Array.isArray(placeIds) || placeIds.length < 2) {
    res.status(400).json({ error: 'Ruta invalida' })
    return
  }
  await run('INSERT INTO routes (userId, name, placeIds) VALUES (?, ?, ?)', [req.user.sub, name, JSON.stringify(placeIds)])
  const rows = await all('SELECT id, name, placeIds, createdAt FROM routes WHERE userId = ? ORDER BY id DESC', [req.user.sub])
  res.json(rows.map((r) => ({ ...r, placeIds: JSON.parse(r.placeIds) })))
})

app.get('/routes', authMiddleware, async (req, res) => {
  const rows = await all('SELECT id, name, placeIds, createdAt FROM routes WHERE userId = ? ORDER BY id DESC', [req.user.sub])
  res.json(rows.map((r) => ({ ...r, placeIds: JSON.parse(r.placeIds) })))
})

app.delete('/routes/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Ruta invalida' })
    return
  }
  await run('DELETE FROM routes WHERE id = ? AND userId = ?', [id, req.user.sub])
  const rows = await all('SELECT id, name, placeIds, createdAt FROM routes WHERE userId = ? ORDER BY id DESC', [req.user.sub])
  res.json(rows.map((r) => ({ ...r, placeIds: JSON.parse(r.placeIds) })))
})

ensureSchema()
  .then(() => startService(app, PORT, 'trips-service'))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
