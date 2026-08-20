/* Generate a multi-size Windows .ico from the community application's SVG.
 * Plain Node (no display): @resvg/resvg-js rasterizes the SVG to PNG at each
 * size, then the PNGs are packed into a PNG-encoded ICO container.
 *   node apps/desktop/build/generate-icon.cjs <in.svg> <out.ico>
 */
const { Resvg } = require('@resvg/resvg-js')
const fs = require('fs')
const path = require('path')

const sizes = [16, 24, 32, 48, 64, 128, 256]

function buildIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const chunks = []
  pngs.forEach((png, i) => {
    const size = sizes[i]
    const b = size >= 256 ? 0 : size
    const e = 16 * i
    entries.writeUInt8(b, e)
    entries.writeUInt8(b, e + 1)
    entries.writeUInt8(0, e + 2)
    entries.writeUInt8(0, e + 3)
    entries.writeUInt16LE(1, e + 4)
    entries.writeUInt16LE(32, e + 6)
    entries.writeUInt32LE(png.length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    chunks.push(png)
    offset += png.length
  })
  return Buffer.concat([header, entries, ...chunks])
}

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: node generate-icon.cjs <in.svg> <out.ico>')
  process.exit(2)
}

const svg = fs.readFileSync(inPath, 'utf8')
const pngs = sizes.map((size) => {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  return resvg.render().asPng()
})
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, buildIco(pngs))
console.log('wrote', outPath)
