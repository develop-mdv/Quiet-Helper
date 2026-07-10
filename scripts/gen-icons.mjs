// Генерирует простые PNG-иконки (иконка приложения и трея) без внешних зависимостей.
// Рисуем скруглённый квадрат с кружком-«глазом» — намёк на «незаметного помощника».
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'resources')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makePng(size, draw) {
  const bytesPerPixel = 4
  const stride = size * bytesPerPixel
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter type 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size)
      const off = y * (stride + 1) + 1 + x * bytesPerPixel
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = a
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const idat = deflateSync(raw)
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// Палитра
const BG = [37, 99, 235] // синий
const EYE = [244, 246, 255]
const PUPIL = [17, 24, 39]

function draw(x, y, size) {
  const r = size * 0.22 // радиус скругления
  const inset = size * 0.06
  const cx = size / 2
  const cy = size / 2
  // скруглённый квадрат
  const inRounded = (() => {
    const minX = inset
    const maxX = size - inset
    const minY = inset
    const maxY = size - inset
    if (x < minX || x > maxX || y < minY || y > maxY) return false
    const dx = Math.max(minX + r - x, x - (maxX - r), 0)
    const dy = Math.max(minY + r - y, y - (maxY - r), 0)
    return dx * dx + dy * dy <= r * r
  })()
  if (!inRounded) return [0, 0, 0, 0]

  // «глаз» — эллипс
  const ex = (x - cx) / (size * 0.30)
  const ey = (y - cy) / (size * 0.18)
  const inEye = ex * ex + ey * ey <= 1
  if (inEye) {
    const px = (x - cx) / (size * 0.09)
    const py = (y - cy) / (size * 0.09)
    if (px * px + py * py <= 1) return [...PUPIL, 255]
    return [...EYE, 255]
  }
  return [...BG, 255]
}

for (const size of [16, 32, 256]) {
  const png = makePng(size, draw)
  const name = size === 256 ? 'icon.png' : size === 32 ? 'tray.png' : 'tray-16.png'
  writeFileSync(join(outDir, name), png)
  console.log('wrote', name, png.length, 'bytes')
}
