// Renders static/icon.png (256x256): a blue rounded tile with three linked nodes.
// Dependency-free: rasterises with distance functions and encodes the PNG by hand.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const N = 256
const px = Buffer.alloc(N * N * 4)
const nodes = [[78, 178], [128, 76], [178, 178]]
const edges = [[0, 1], [1, 2], [2, 0]]

const segDist = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}
const cover = (d, r) => Math.max(0, Math.min(1, r - d + 0.5)) // 1px anti-aliased edge

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4
    // rounded square, radius 52
    const qx = Math.abs(x - N / 2 + 0.5) - (N / 2 - 52)
    const qy = Math.abs(y - N / 2 + 0.5) - (N / 2 - 52)
    const tile = cover(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0), 52)
    const g = y / N
    let r = 47 + 20 * g, gr = 107 - 30 * g, b = 255 - 40 * g
    let ink = 0
    for (const [a, c] of edges) ink = Math.max(ink, cover(segDist(x, y, nodes[a], nodes[c]), 5))
    for (const n of nodes) ink = Math.max(ink, cover(Math.hypot(x - n[0], y - n[1]), 22))
    r += (255 - r) * ink; gr += (255 - gr) * ink; b += (255 - b) * ink
    px[i] = r; px[i + 1] = gr; px[i + 2] = b; px[i + 3] = Math.round(255 * tile)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
const raw = Buffer.alloc((N * 4 + 1) * N)
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4)
writeFileSync(new URL('../static/icon.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]))
