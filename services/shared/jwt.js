import jwt from 'jsonwebtoken'

export const JWT_SECRET = process.env.JWT_SECRET || 'wayturismo-dev-secret'

export function createToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '8h' },
  )
}

export function authMiddleware(req, res, next) {
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

export function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Solo admin' })
    return
  }
  next()
}
