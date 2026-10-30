/**
 * Export a model as GLB, OBJ, MTL and a palette PNG.
 *
 * Ported from `engine-DoiMMBHL.js:9-251` (`A` = OBJ/MTL, `j` = GLB,
 * `U` = `exportFiles`) plus the palette atlas and PNG encoder from
 * `palette-CdyFZUx0.js` and `png-D9MD6Y0w.js`. The byte layout is documented in
 * `re/full-reverse/08-3d-polyforge/REPORT.md` §7.1-§7.3.
 *
 * **The GLB writer is hand-rolled on purpose.** `three` ships a `GLTFExporter`,
 * but it produces none of the five properties this format needs: one material,
 * one NEAREST-sampled palette texture, a flipped UV V, vertices re-based to each
 * part's pivot, and a rig expressed as a node hierarchy rather than a glTF
 * `skin`. Calling the exporter would produce a file Roblox imports differently.
 *
 * **The X/Z mirror happens in exactly one place here** — `flatten()` negates X
 * and Z — and `partsForStudio` in `studio.ts` mirrors the part centres and
 * pivots the same way. Doing one and not the other yields a model that looks
 * right in the viewport and is inside-out in Studio (`15/04` §7 R4).
 */
import { type Model, modelTriangles } from './build'
import { partGroups } from './check'

/** Sanitise a model name to a file stem (`W`, `engine-DoiMMBHL.js:609-611`). */
export function sanitizeName(name: string | undefined): string {
  return (
    String(name || 'model')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'model'
  )
}

/** Format a number for OBJ, normalising `-0` to `0` (`O`, `:9`). */
function objNumber(value: number, decimals: number): string {
  return Math.abs(value) < 1e-9 ? '0' : value.toFixed(decimals)
}

/** The Roblox front mirror: negate X and Z, keep Y (`k`, `:10`). */
function mirrorFront(vector: readonly number[]): [number, number, number] {
  return [-vector[0], vector[1], -vector[2]]
}

/**
 * The palette atlas: 8 x 8 cells of 16 px on a 128 x 128 grid
 * (`palette-CdyFZUx0.js:2-3`).
 */
export const ATLAS_SIZE = 128
const ATLAS_TILE = 16
const ATLAS_GRID = 8

/** Parse `#rrggbb` (and `#rgb`) to bytes (`r`, `palette-CdyFZUx0.js:4-8`). */
export function parseHexColor(value: string): [number, number, number] {
  const hex = String(value).replace('#', '')
  const expanded = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
  const parsed = Number.parseInt(expanded, 16)
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255]
}

/**
 * The UV a palette key occupies: the centre of its 16 px cell
 * (`uv`, `palette-CdyFZUx0.js:45-50`).
 *
 * The V is `1 - (row + 0.5) / 8`, i.e. bottom-up, which is three.js's origin.
 * `flatten` passes this through and the GLB writer flips V again for glTF.
 */
export function paletteUv(index: number): [number, number] {
  const column = (index % ATLAS_GRID) + 0.5
  const row = Math.floor(index / ATLAS_GRID) + 0.5
  return [column / ATLAS_GRID, 1 - row / ATLAS_GRID]
}

/** The 128 x 128 RGBA pixel buffer for a palette (`pixels`, `:51-64`). */
export function palettePixels(names: string[], colors: Record<string, string>): Uint8Array {
  const pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4)
  names.forEach((name, index) => {
    const [r, g, b] = parseHexColor(colors[name] ?? '#9a9a9a')
    const left = (index % ATLAS_GRID) * ATLAS_TILE
    const top = Math.floor(index / ATLAS_GRID) * ATLAS_TILE
    for (let y = top; y < top + ATLAS_TILE; y++) {
      for (let x = left; x < left + ATLAS_TILE; x++) {
        pixels.set([r, g, b, 255], (y * ATLAS_SIZE + x) * 4)
      }
    }
  })
  return pixels
}

/* ── The PNG encoder (png-D9MD6Y0w.js, whole file) ───────────────────────── */

/** CRC32 table, built once (`png-D9MD6Y0w.js:1-11`). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? (value >>> 1) ^ -306674912 : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

/** CRC32 of a byte range (`t`, `:12-17`). */
function crc32(bytes: Uint8Array, seed = 0xffffffff): number {
  let crc = seed
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8)
  }
  return crc
}

/** Adler32, for the zlib stream trailer (`n`, `:18-26`). */
function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/**
 * A zlib stream using **stored** (uncompressed) deflate blocks (`r`, `:27-50`).
 *
 * No compression: the palette is a flat grid, so the encoder stays tiny and the
 * output is deterministic, which is what makes two builds byte-identical.
 */
function zlibStored(bytes: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535))
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4)
  let at = 0
  out[at++] = 120
  out[at++] = 1

  for (let block = 0; block < blocks; block++) {
    const start = block * 65535
    const length = Math.min(65535, bytes.length - start)
    out[at++] = +(block === blocks - 1)
    out[at++] = length & 255
    out[at++] = length >>> 8
    out[at++] = ~length & 255
    out[at++] = (~length >>> 8) & 255
    out.set(bytes.subarray(start, start + length), at)
    at += length
  }

  const checksum = adler32(bytes)
  out[at++] = checksum >>> 24
  out[at++] = (checksum >>> 16) & 255
  out[at++] = (checksum >>> 8) & 255
  out[at++] = checksum & 255
  return out
}

/** One PNG chunk: length, type, data, CRC (`i`, `:51-61`). */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i)
  chunk.set(data, 8)
  view.setUint32(8 + data.length, (crc32(chunk.subarray(4, 8 + data.length)) ^ -1) >>> 0)
  return chunk
}

/** A truecolour RGBA PNG (`a`, `:62-83`). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  // Each scanline is prefixed with filter byte 0 (None).
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }

  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  // bytes 10-12 are compression, filter and interlace: all 0.

  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibStored(raw)),
    pngChunk('IEND', new Uint8Array())
  ]

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const png = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    png.set(chunk, at)
    at += chunk.length
  }
  return png
}

/** The palette atlas as a PNG (`atlas().png()`, `palette-CdyFZUx0.js:65-67`). */
export function palettePng(model: Model): Uint8Array {
  const names = Object.keys(model.palette)
  return encodePng(ATLAS_SIZE, ATLAS_SIZE, palettePixels(names, model.palette))
}

/* ── The flattened vertex stream (Model.flatten) ─────────────────────────── */

/** One part group's flattened, mirror-corrected vertex stream. */
export interface FlatStream {
  position: Float32Array
  normal: Float32Array
  uv: Float32Array
  count: number
}

/**
 * Flatten one group of parts into parallel position/normal/uv arrays
 * (`Model.flatten`, `model-C3l0LP6n.js:806-848`).
 *
 * `robloxFront` negates X and Z on both position and normal, which is the
 * export-space mirror. UVs come from the palette cell centre per vertex.
 */
export function flatten(
  parts: Model['parts'],
  palette: Model['palette'],
  robloxFront = true
): FlatStream {
  const names = Object.keys(palette)
  const triangles = parts.reduce(
    (sum, part) => sum + part.geometry.attributes.position.count / 3,
    0
  )
  const vertices = triangles * 3

  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const uv = new Float32Array(vertices * 2)

  let at = 0
  for (const part of parts) {
    const source = part.geometry
    const sourcePosition = source.attributes.position
    let sourceNormal = source.attributes.normal
    if (!sourceNormal) {
      source.computeVertexNormals()
      sourceNormal = source.attributes.normal
    }

    const [u, v] = paletteUv(Math.max(0, names.indexOf(part.color)))
    const sign = robloxFront ? -1 : 1

    for (let i = 0; i < sourcePosition.count; i++) {
      position[at * 3] = sourcePosition.getX(i) * sign
      position[at * 3 + 1] = sourcePosition.getY(i)
      position[at * 3 + 2] = sourcePosition.getZ(i) * sign

      normal[at * 3] = sourceNormal.getX(i) * sign
      normal[at * 3 + 1] = sourceNormal.getY(i)
      normal[at * 3 + 2] = sourceNormal.getZ(i) * sign

      uv[at * 2] = u
      uv[at * 2 + 1] = v
      at++
    }
  }

  return { position, normal, uv, count: vertices }
}

/* ── OBJ + MTL (A, engine-DoiMMBHL.js:11-51) ─────────────────────────────── */

/** The three text files an OBJ export produces. */
export interface ObjFiles {
  obj: string
  mtl: string
  png: Uint8Array
  textureName: string
}

/**
 * OBJ, MTL and the palette PNG (`A`, `engine-DoiMMBHL.js:11-51`).
 *
 * One `o`/`usemtl` per part group, all sharing the single `<name>_palette`
 * material. Faces are `v/vt/vn` with the same index for all three, emitted per
 * triangle with no index reuse. `v` is 5 dp, `vn` is 4 dp, and `-0` becomes `0`.
 */
export function toObj(model: Model, { name = model.name, merge = false } = {}): ObjFiles {
  const stem = sanitizeName(name)
  const header = [
    `# ${stem} — Termul procedural model, units: studs, front: -Z`,
    `mtllib ${stem}.mtl`
  ]

  const vertices: string[] = []
  const uvs: string[] = []
  const normals: string[] = []
  const faces: string[] = []
  let emitted = 0

  for (const group of partGroups(model, { merge })) {
    const flat = flatten(group.parts, model.palette, true)

    for (let i = 0; i < flat.count; i++) {
      vertices.push(
        `v ${objNumber(flat.position[i * 3], 5)} ${objNumber(flat.position[i * 3 + 1], 5)} ${objNumber(flat.position[i * 3 + 2], 5)}`
      )
      uvs.push(`vt ${objNumber(flat.uv[i * 2], 5)} ${objNumber(flat.uv[i * 2 + 1], 5)}`)
      normals.push(
        `vn ${objNumber(flat.normal[i * 3], 4)} ${objNumber(flat.normal[i * 3 + 1], 4)} ${objNumber(flat.normal[i * 3 + 2], 4)}`
      )
    }

    faces.push(`o ${merge ? stem : group.name}`, `usemtl ${stem}_palette`)
    for (let index = emitted + 1; index <= emitted + flat.count; index += 3) {
      faces.push(
        `f ${index}/${index}/${index} ${index + 1}/${index + 1}/${index + 1} ` +
          `${index + 2}/${index + 2}/${index + 2}`
      )
    }
    emitted += flat.count
  }

  return {
    obj: `${[...header, ...vertices, ...uvs, ...normals, ...faces].join('\n')}\n`,
    mtl:
      `newmtl ${stem}_palette\nKa 0 0 0\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 1\n` +
      `map_Kd ${stem}_palette.png\n`,
    png: palettePng(model),
    textureName: `${stem}_palette.png`
  }
}

/* ── GLB (j, engine-DoiMMBHL.js:52-251) ──────────────────────────────────── */

/** A glTF JSON node. */
interface GltfNode {
  name: string
  children?: number[]
  mesh?: number
  translation?: number[]
}

/** A glTF bufferView. */
interface GltfBufferView {
  buffer: number
  byteOffset: number
  byteLength: number
  target?: number
}

/** A glTF accessor. */
interface GltfAccessor {
  bufferView: number
  componentType: number
  count: number
  type: string
  min?: number[]
  max?: number[]
}

/** Align a length up to a multiple of 4 (`s`, `:64`). */
const align4 = (value: number) => (value + 3) & -4

/** glTF's per-vertex attribute target. */
const ARRAY_BUFFER = 34962
/** glTF `FLOAT`. */
const FLOAT = 5126
/** glTF `TRIANGLES`. */
const TRIANGLES_MODE = 4

/**
 * The GLB writer (`j`, `engine-DoiMMBHL.js:52-251`).
 *
 * Byte layout, all little-endian:
 *
 * ```
 * 0   u32  0x46546C67 "glTF"
 * 4   u32  2
 * 8   u32  total = 20 + jsonPadded + 8 + binLength
 * 12  u32  jsonPadded
 * 16  u32  0x4E4F534A "JSON"
 * 20  ...  JSON, right-padded with 0x20 to jsonPadded
 * +   u32  binLength
 * +   u32  0x004E4942 "BIN\0"
 * +   ...  binary blob
 * ```
 *
 * One material and one texture for the whole model — the palette atlas. The
 * sampler is NEAREST for a flat palette, which is critical: the atlas is a grid
 * of 16 px cells, and any filtering would bleed neighbouring colours into a
 * part.
 *
 * A rigged, unmerged model gets a real node hierarchy instead of a flat list:
 * each part's translation becomes relative to its parent joint. It is a node
 * tree, not a glTF `skin` — there is no `skins` entry, and Roblox's importer
 * rebuilds the Motor6Ds from the tree.
 */
export function toGlb(model: Model, { name = model.name, merge = false } = {}): Uint8Array {
  const stem = sanitizeName(name)
  const groups = partGroups(model, { merge })
  // A single group collapses to one node when merging or when the model has no
  // explicit groups.
  const single = groups.length === 1 && (merge || !model.groups.length)

  const atlas = palettePng(model)
  const chunkData: { data: Uint8Array; target?: number }[] = []
  const accessors: GltfAccessor[] = []
  const meshes: {
    name: string
    primitives: {
      attributes: Record<string, number>
      material: number
      mode: number
    }[]
  }[] = []
  const nodes: GltfNode[] = [{ name: stem, children: [] }]

  for (const group of groups) {
    const flat = flatten(group.parts, model.palette, true)

    // Re-base vertices to the part pivot so the node transform places the part.
    // `mirrorFront` gives the same [-x, y, -z] the vertices already went through.
    const pivot = single ? [0, 0, 0] : mirrorFront(group.pivot)
    for (let i = 0; i < flat.count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        flat.position[i * 3 + axis] -= pivot[axis]
      }
    }

    // glTF's UV origin is top-left, three.js's is bottom-left.
    const flippedUv = new Float32Array(flat.uv.length)
    for (let i = 0; i < flat.uv.length; i += 2) {
      flippedUv[i] = flat.uv[i]
      flippedUv[i + 1] = 1 - flat.uv[i + 1]
    }

    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < flat.count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], flat.position[i * 3 + axis])
        max[axis] = Math.max(max[axis], flat.position[i * 3 + axis])
      }
    }

    const viewStart = chunkData.length
    chunkData.push(
      {
        data: new Uint8Array(
          flat.position.buffer,
          flat.position.byteOffset,
          flat.position.byteLength
        ),
        target: ARRAY_BUFFER
      },
      {
        data: new Uint8Array(flat.normal.buffer, flat.normal.byteOffset, flat.normal.byteLength),
        target: ARRAY_BUFFER
      },
      {
        data: new Uint8Array(flippedUv.buffer, flippedUv.byteOffset, flippedUv.byteLength),
        target: ARRAY_BUFFER
      }
    )

    const accessorStart = accessors.length
    accessors.push(
      {
        bufferView: viewStart,
        componentType: FLOAT,
        count: flat.count,
        type: 'VEC3',
        min,
        max
      },
      { bufferView: viewStart + 1, componentType: FLOAT, count: flat.count, type: 'VEC3' },
      { bufferView: viewStart + 2, componentType: FLOAT, count: flat.count, type: 'VEC2' }
    )

    const meshName = single ? stem : group.name
    meshes.push({
      name: meshName,
      primitives: [
        {
          attributes: {
            POSITION: accessorStart,
            NORMAL: accessorStart + 1,
            TEXCOORD_0: accessorStart + 2
          },
          material: 0,
          mode: TRIANGLES_MODE
        }
      ]
    })

    nodes.push({
      name: meshName,
      mesh: meshes.length - 1,
      ...(single ? {} : { translation: pivot })
    })
    ;(nodes[0].children as number[]).push(nodes.length - 1)
  }

  // A rigged, unmerged model replaces the flat list with a bone hierarchy.
  if (model.rigSpec && !single) {
    const indexByName = Object.fromEntries(nodes.map((node, index) => [node.name, index]))
    const joints = model.rigSpec.skeleton as { part: string; parent?: string }[]
    if (joints.length) {
      nodes[0].children = []
      const pivotByName = Object.fromEntries(
        model.groups.map((group) => [group.name, mirrorFront(group.pivot)])
      )
      for (const joint of joints) {
        const nodeIndex = indexByName[joint.part]
        if (nodeIndex == null) continue

        const parentPivot =
          joint.parent === 'HumanoidRootPart' || pivotByName[joint.parent ?? ''] == null
            ? [0, 0, 0]
            : pivotByName[joint.parent as string]
        nodes[nodeIndex].translation = pivotByName[joint.part].map(
          (value, axis) => value - parentPivot[axis]
        )

        const parentIndex =
          joint.parent === 'HumanoidRootPart' ? 0 : (indexByName[joint.parent ?? ''] ?? 0)
        const parentNode = nodes[parentIndex]
        parentNode.children ??= []
        parentNode.children.push(nodeIndex)
      }
    }
  }

  // The palette PNG gets the last bufferView, with no target: it is not a
  // vertex buffer.
  const imageView = chunkData.length
  chunkData.push({ data: atlas })

  let offset = 0
  const bufferViews: GltfBufferView[] = chunkData.map((entry) => {
    const view: GltfBufferView = {
      buffer: 0,
      byteOffset: offset,
      byteLength: entry.data.length,
      ...(entry.target ? { target: entry.target } : {})
    }
    offset = align4(offset + entry.data.length)
    return view
  })

  const binary = new Uint8Array(offset)
  chunkData.forEach((entry, index) => {
    binary.set(entry.data, bufferViews[index].byteOffset)
  })

  const textured = false
  const json = {
    asset: { version: '2.0', generator: 'Termul procedural engine' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: single ? [{ name: stem, mesh: 0 }] : nodes,
    meshes,
    materials: [
      {
        name: `${stem}_palette`,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.6
        }
      }
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [
      textured ? { magFilter: 9729, minFilter: 9987 } : { magFilter: 9728, minFilter: 9728 }
    ],
    images: [{ bufferView: imageView, mimeType: 'image/png', name: `${stem}_palette` }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }]
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPadded = align4(jsonBytes.length)
  const total = 20 + jsonPadded + 8 + binary.length

  const glb = new Uint8Array(total)
  const view = new DataView(glb.buffer)
  view.setUint32(0, 0x46546c67, true) // "glTF"
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonPadded, true)
  view.setUint32(16, 0x4e4f534a, true) // "JSON"
  glb.set(jsonBytes, 20)
  for (let i = 20 + jsonBytes.length; i < 20 + jsonPadded; i++) glb[i] = 0x20
  view.setUint32(20 + jsonPadded, binary.length, true)
  view.setUint32(24 + jsonPadded, 0x004e4942, true) // "BIN\0"
  glb.set(binary, 28 + jsonPadded)

  return glb
}

/**
 * Every export file, keyed by name (`U`, `engine-DoiMMBHL.js:588-608`).
 *
 * Four files: `<name>.glb`, `<name>.obj`, `<name>.mtl` and `<name>_palette.png`.
 */
export function exportFiles(
  model: Model,
  { name = model.name, merge }: { name?: string; merge?: boolean } = {}
): Record<string, Uint8Array> {
  const stem = sanitizeName(name)
  const obj = toObj(model, { name: stem, merge })

  return {
    [`${stem}.glb`]: toGlb(model, { name: stem, merge }),
    [`${stem}.obj`]: new TextEncoder().encode(obj.obj),
    [`${stem}.mtl`]: new TextEncoder().encode(obj.mtl),
    [obj.textureName]: obj.png
  }
}

/**
 * Whether a model's export should merge its parts into one.
 *
 * A rigged model is **always** split, because a Motor6D needs a part to bind
 * to. An accessory defaults to merged; everything else defaults to split
 * (`generator-BkAchkKU.js:517-536`, `15/01` §1.1 I3-I4).
 */
export function shouldMerge(model: Model, category?: string, requested?: boolean): boolean {
  if (model.rigSpec) return false
  return requested ?? category === 'accessory'
}

/**
 * A short human description of what an export contains, for the report.
 */
export function describeExport(model: Model): {
  triangles: number
  parts: number
  bytes: { glb: number; obj: number; mtl: number; png: number }
} {
  const files = exportFiles(model)
  const names = Object.keys(files)
  const size = (suffix: string) => {
    const key = names.find((name) => name.endsWith(suffix))
    return key ? files[key].length : 0
  }
  return {
    triangles: modelTriangles(model),
    parts: partGroups(model).length,
    bytes: {
      glb: size('.glb'),
      obj: size('.obj'),
      mtl: size('.mtl'),
      png: size('.png')
    }
  }
}
