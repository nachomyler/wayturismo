import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env')
const examplePath = path.join(root, '.env.example')

const dataDirs = [
  path.join(root, 'server', 'data'),
  path.join(root, 'services', 'data', 'auth'),
  path.join(root, 'services', 'data', 'places'),
  path.join(root, 'services', 'data', 'trips'),
]

for (const dataDir of dataDirs) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log(`Creada carpeta ${path.relative(root, dataDir)}`)
  }
  const gitkeep = path.join(dataDir, '.gitkeep')
  if (!fs.existsSync(gitkeep)) {
    fs.writeFileSync(gitkeep, '')
  }
}

if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, envPath)
  console.log('Creado .env desde .env.example')
}

console.log('WayTurismo listo. Microservicios: npm run dev')
