import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const E2E_PORTS = {
  gateway: 15900,
  auth: 15901,
  places: 15902,
  geo: 15903,
  trips: 15904,
}

const children = []

function startNode(script, env) {
  const child = spawn(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'ignore',
    windowsHide: true,
  })
  children.push(child)
  return child
}

async function waitForOk(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* servicio aun no listo */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timeout esperando ${url}`)
}

export async function startBackendStack() {
  const { gateway, auth, places, geo, trips } = E2E_PORTS
  const shared = {
    JWT_SECRET: 'e2e-test-secret',
    NODE_ENV: 'test',
  }

  startNode('services/auth-service/index.js', {
    ...shared,
    AUTH_SERVICE_PORT: String(auth),
  })
  startNode('services/places-service/index.js', {
    ...shared,
    PLACES_SERVICE_PORT: String(places),
  })
  startNode('services/geo-service/index.js', {
    ...shared,
    GEO_SERVICE_PORT: String(geo),
  })
  startNode('services/trips-service/index.js', {
    ...shared,
    TRIPS_SERVICE_PORT: String(trips),
  })

  await waitForOk(`http://127.0.0.1:${auth}/health`)
  await waitForOk(`http://127.0.0.1:${places}/health`)
  await waitForOk(`http://127.0.0.1:${geo}/health`)
  await waitForOk(`http://127.0.0.1:${trips}/health`)

  startNode('services/gateway/index.js', {
    ...shared,
    PORT: String(gateway),
    GATEWAY_PORT: String(gateway),
    AUTH_SERVICE_URL: `http://127.0.0.1:${auth}`,
    PLACES_SERVICE_URL: `http://127.0.0.1:${places}`,
    GEO_SERVICE_URL: `http://127.0.0.1:${geo}`,
    TRIPS_SERVICE_URL: `http://127.0.0.1:${trips}`,
  })

  await waitForOk(`http://127.0.0.1:${gateway}/api/health`)

  return `http://127.0.0.1:${gateway}`
}

export function stopBackendStack() {
  for (const child of children) {
    child.kill('SIGTERM')
  }
  children.length = 0
}
