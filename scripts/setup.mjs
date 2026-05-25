import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env')
const examplePath = path.join(root, '.env.example')
const dataDir = path.join(root, 'server', 'data')

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
  console.log('Creada carpeta server/data')
}

const gitkeep = path.join(dataDir, '.gitkeep')
if (!fs.existsSync(gitkeep)) {
  fs.writeFileSync(gitkeep, '')
}

if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, envPath)
  console.log('Creado .env desde .env.example')
}

console.log('WayTurismo listo para VS Code. Ejecuta: npm run dev')
