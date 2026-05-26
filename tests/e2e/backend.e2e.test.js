import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startBackendStack, stopBackendStack } from './stack.mjs'

describe('backend API (e2e)', () => {
  /** @type {string} */
  let baseUrl

  before(async () => {
    baseUrl = await startBackendStack()
  })

  after(() => {
    stopBackendStack()
  })

  it('GET /api/health agrega estado de todos los microservicios', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(data.architecture, 'microservices')
    assert.ok(Array.isArray(data.services))
    assert.ok(data.services.every((s) => s.ok === true))
  })

  it('POST /api/auth/login con admin devuelve token JWT', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@wayturismo.app',
        password: 'admin123',
      }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.token)
    assert.equal(data.user.email, 'admin@wayturismo.app')
    assert.equal(data.user.role, 'admin')
  })
})
