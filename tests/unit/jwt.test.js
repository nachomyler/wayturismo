import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'unit-test-secret'
const { createToken, authMiddleware, adminMiddleware } = await import('../../services/shared/jwt.js')

describe('jwt (unit)', () => {
  it('createToken genera un JWT valido con claims del usuario', () => {
    const user = { id: 42, email: 'test@example.com', role: 'tourist', name: 'Test' }
    const token = createToken(user)
    const decoded = jwt.verify(token, 'unit-test-secret')
    assert.equal(decoded.sub, 42)
    assert.equal(decoded.email, 'test@example.com')
    assert.equal(decoded.role, 'tourist')
  })

  it('authMiddleware y adminMiddleware responden segun token y rol', () => {
    const token = createToken({ id: 1, email: 'a@b.com', role: 'admin', name: 'Admin' })

    let statusCode
    let body
    const res = {
      status(code) {
        statusCode = code
        return this
      },
      json(payload) {
        body = payload
      },
    }

    const reqNoToken = { headers: {} }
    authMiddleware(reqNoToken, res, () => {})
    assert.equal(statusCode, 401)
    assert.equal(body.error, 'No autenticado')

    const reqAdmin = { headers: { authorization: `Bearer ${token}` } }
    let nextCalled = false
    authMiddleware(reqAdmin, res, () => {
      adminMiddleware(reqAdmin, res, () => {
        nextCalled = true
      })
    })
    assert.equal(reqAdmin.user.role, 'admin')
    assert.equal(nextCalled, true)
  })
})
