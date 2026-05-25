import express from 'express'
import cors from 'cors'

export function createServiceApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())
  return app
}

export function startService(app, port, name) {
  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`[${name}] http://localhost:${port}`)
      resolve()
    })
  })
}
