import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import sqlite3 from 'sqlite3'
import { createDatabase } from '../shared/db.js'
import { createToken } from '../shared/jwt.js'
import { createServiceApp, startService } from '../shared/http.js'

const PORT = Number(process.env.AUTH_SERVICE_PORT || 4001)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const legacyDbPath = path.join(rootDir, 'server', 'data', 'wayturismo.sqlite')
const { run, get } = createDatabase('auth')

const app = createServiceApp()

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'auth-service' })
})

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

  const admin = await get('SELECT id FROM users WHERE email = ?', ['admin@wayturismo.app'])
  if (!admin) {
    const passwordHash = await bcrypt.hash('admin123', 10)
    await run(
      'INSERT INTO users (name, email, passwordHash, country, province, locality, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['Admin', 'admin@wayturismo.app', passwordHash, 'Argentina', 'Mendoza', 'Capital', 'admin'],
    )
  }

  await migrateLegacyUsers()
}

/** Usuarios registrados antes de microservicios viven en server/data/wayturismo.sqlite */
async function migrateLegacyUsers() {
  if (!fs.existsSync(legacyDbPath)) return

  const legacyUsers = await new Promise((resolve, reject) => {
    const legacyDb = new sqlite3.Database(legacyDbPath)
    legacyDb.all(
      'SELECT name, email, passwordHash, country, province, locality, role FROM users',
      [],
      (err, rows) => {
        legacyDb.close()
        if (err) reject(err)
        else resolve(rows || [])
      },
    )
  })

  let imported = 0
  for (const user of legacyUsers) {
    const result = await run(
      `INSERT OR IGNORE INTO users (name, email, passwordHash, country, province, locality, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.name, user.email, user.passwordHash, user.country, user.province, user.locality, user.role],
    )
    if (result.changes > 0) imported += 1
  }
  if (imported > 0) {
    console.log(`[auth-service] Importados ${imported} usuario(s) desde ${path.relative(rootDir, legacyDbPath)}`)
  }
}

app.post('/register', async (req, res) => {
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

app.post('/login', async (req, res) => {
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

ensureSchema()
  .then(() => startService(app, PORT, 'auth-service'))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
