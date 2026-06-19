// One-off: generate PWA PNG icons from the SVG favicon.
// Run: node scripts/gen-pwa-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')
const svg = readFileSync(join(publicDir, 'favicon.svg'))

const BG = '#ffffff'

async function make(size, name, { maskable = false } = {}) {
  const pad = maskable ? Math.round(size * 0.18) : Math.round(size * 0.12)
  const inner = size - pad * 2
  const logo = await sharp(svg)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(join(publicDir, name))
  console.log('wrote public/' + name)
}

await make(192, 'icon-192.png')
await make(512, 'icon-512.png')
await make(512, 'icon-512-maskable.png', { maskable: true })
await make(180, 'apple-touch-icon.png')
console.log('done')
