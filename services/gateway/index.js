import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'

const PORT = Number(process.env.PORT || process.env.GATEWAY_PORT || 4000)
const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:4001'
const PLACES_URL = process.env.PLACES_SERVICE_URL || 'http://localhost:4002'
const GEO_URL = process.env.GEO_SERVICE_URL || 'http://localhost:4003'
const TRIPS_URL = process.env.TRIPS_SERVICE_URL || 'http://localhost:4004'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.resolve(__dirname, '../..', 'dist')

const app = express()
app.use(cors())
// Sin express.json(): el body debe reenviarse intacto a los microservicios.

const services = [
  { name: 'auth', url: AUTH_URL },
  { name: 'places', url: PLACES_URL },
  { name: 'geo', url: GEO_URL },
  { name: 'trips', url: TRIPS_URL },
]

app.get('/api/health', async (_req, res) => {
  const checks = await Promise.all(
    services.map(async ({ name, url }) => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
        const data = await r.json()
        return { name, ok: r.ok && data.ok === true }
      } catch {
        return { name, ok: false }
      }
    }),
  )
  const ok = checks.every((c) => c.ok)
  res.status(ok ? 200 : 503).json({
    ok,
    architecture: 'microservices',
    services: checks,
    features: { calles: true, callesPuntos: true, eventLocation: true },
  })
})

/** Express quita el prefijo del mount; path llega como "/" o "/by-ids". */
function proxyMount(mountPath, target, servicePath) {
  app.use(
    mountPath,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (path) => {
        if (path === '/' || path === '') return servicePath || '/'
        if (path.startsWith('/')) return `${servicePath}${path}`
        return `${servicePath}/${path}`
      },
    }),
  )
}

proxyMount('/api/auth', AUTH_URL, '')
proxyMount('/api/places', PLACES_URL, '/places')
proxyMount('/api/quick-search', PLACES_URL, '/quick-search')
proxyMount('/api/areas', PLACES_URL, '/areas')
proxyMount('/api/admin/places', PLACES_URL, '/admin/places')
proxyMount('/api/geo', GEO_URL, '/geo')
proxyMount('/api/geocode', GEO_URL, '/geocode')
proxyMount('/api/locations', GEO_URL, '/locations')
proxyMount('/api/favorites', TRIPS_URL, '/favorites')
proxyMount('/api/routes', TRIPS_URL, '/routes')

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`[gateway] http://localhost:${PORT}`)
  console.log(`  auth   -> ${AUTH_URL}`)
  console.log(`  places -> ${PLACES_URL}`)
  console.log(`  geo    -> ${GEO_URL}`)
  console.log(`  trips  -> ${TRIPS_URL}`)
})
