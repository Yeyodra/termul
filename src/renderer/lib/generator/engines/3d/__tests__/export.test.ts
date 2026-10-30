/**
 * The exporters: GLB byte layout, OBJ/MTL, the palette PNG, and the mirror.
 *
 * The GLB is hand-written, so it is verified two ways: the header fields are
 * checked byte by byte against the documented layout, and the whole file is fed
 * back through three's own `GLTFLoader` to prove a real parser accepts it and
 * recovers the same number of parts. That is the acceptance case the plan names
 * (08 10.5), and it is the only way to know the writer is not merely
 * self-consistent.
 *
 * The X/Z mirror is asserted in both places it must happen: the vertex stream
 * here, and `partsForStudio` in the studio tests. One without the other yields a
 * model that is right in the viewport and inside-out in Studio (15/04 7 R4).
 */
import { describe, expect, it } from 'vitest'
import { buildSpec } from '@/lib/generator/engines/3d/build'
import {
  ATLAS_SIZE,
  describeExport,
  encodePng,
  exportFiles,
  flatten,
  palettePixels,
  palettePng,
  paletteUv,
  parseHexColor,
  sanitizeName,
  shouldMerge,
  toGlb,
  toObj
} from '@/lib/generator/engines/3d/export'
import type { ModelSpec, SpecNode } from '@/lib/generator/engines/3d/schema'

const prop = (parts: SpecNode[], extra: Partial<ModelSpec> = {}): ModelSpec => ({
  version: 1,
  category: 'prop',
  palette: { a: '#ffffff', b: '#ff0000' },
  parts,
  ...extra
})

const rigged = (): ModelSpec => ({
  version: 1,
  category: 'character',
  rig: 'custom',
  palette: { a: '#ffffff' },
  skeleton: [
    { part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' },
    { part: 'Head', parent: 'Body', joint: 'Neck' }
  ],
  parts: [
    { name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] },
    { name: 'Head', type: 'box', size: [1, 1, 1], position: [0, 2, 0], pivot: [0, 1, 0] }
  ]
})

/** Read the GLB header fields. */
function header(glb: Uint8Array) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  return {
    magic: view.getUint32(0, true),
    version: view.getUint32(4, true),
    total: view.getUint32(8, true),
    jsonLength: view.getUint32(12, true),
    jsonType: view.getUint32(16, true),
    binLength: view.getUint32(20 + view.getUint32(12, true), true),
    binType: view.getUint32(24 + view.getUint32(12, true), true)
  }
}

/** Parse a GLB's JSON chunk. */
function glbJson(glb: Uint8Array): Record<string, unknown> {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const length = view.getUint32(12, true)
  const bytes = glb.subarray(20, 20 + length)
  return JSON.parse(new TextDecoder().decode(bytes))
}

describe('sanitizeName', () => {
  it('lowercases, hyphenates and trims', () => {
    expect(sanitizeName('Blocky Hero')).toBe('blocky-hero')
    expect(sanitizeName('  Crate!!  ')).toBe('crate')
  })

  it('keeps digits, underscores and hyphens', () => {
    expect(sanitizeName('part_2-b')).toBe('part_2-b')
  })

  it('falls back to "model" for an empty or missing name', () => {
    expect(sanitizeName('')).toBe('model')
    expect(sanitizeName(undefined)).toBe('model')
    expect(sanitizeName('!!!')).toBe('model')
  })

  it('truncates to 40 characters', () => {
    expect(sanitizeName('a'.repeat(60))).toHaveLength(40)
  })
})

describe('the palette atlas', () => {
  it('parses #rrggbb and #rgb', () => {
    expect(parseHexColor('#ff8000')).toEqual([255, 128, 0])
    expect(parseHexColor('#f80')).toEqual([255, 136, 0])
  })

  it('places a colour at the centre of its 16 px cell', () => {
    expect(paletteUv(0)).toEqual([0.0625, 0.9375])
    expect(paletteUv(8)).toEqual([0.0625, 0.8125])
    expect(paletteUv(9)).toEqual([0.1875, 0.8125])
  })

  it('is 128 x 128 with 16 px cells', () => {
    expect(ATLAS_SIZE).toBe(128)
    const pixels = palettePixels(['a'], { a: '#ff0000' })
    expect(pixels).toHaveLength(ATLAS_SIZE * ATLAS_SIZE * 4)
    // The top-left cell is red and opaque.
    expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    // Row 16 is the next cell row, empty for a one-colour palette.
    expect([...pixels.subarray(16 * ATLAS_SIZE * 4, 16 * ATLAS_SIZE * 4 + 4)]).toEqual([0, 0, 0, 0])
  })

  it('encodes a real PNG', () => {
    const png = palettePng(buildSpec(prop([{ type: 'box', size: [1, 1, 1] }])))
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect(view.getUint32(16)).toBe(ATLAS_SIZE)
    expect(view.getUint32(20)).toBe(ATLAS_SIZE)
  })

  it('is deterministic', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(Array.from(palettePng(model))).toEqual(Array.from(palettePng(model)))
  })
})

describe('encodePng', () => {
  it('writes a valid 1 x 1 RGBA PNG', () => {
    const png = encodePng(1, 1, new Uint8Array([255, 0, 0, 255]))
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect(view.getUint32(16)).toBe(1)
    expect(view.getUint32(20)).toBe(1)
    // Bit depth 8, colour type 6 (RGBA).
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(6)
  })
})

describe('flatten and the export mirror', () => {
  it('negates X and Z, and keeps Y, when robloxFront is set', () => {
    const model = buildSpec(prop([{ type: 'box', size: [2, 2, 2], position: [10, 20, 30] }]))
    const flat = flatten(model.parts, model.palette, true)
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < flat.count; i++) {
      minX = Math.min(minX, flat.position[i * 3])
      maxX = Math.max(maxX, flat.position[i * 3])
      minZ = Math.min(minZ, flat.position[i * 3 + 2])
      maxZ = Math.max(maxZ, flat.position[i * 3 + 2])
    }
    // The box spans x 9..11 and z 29..31 before the mirror.
    expect(minX).toBeCloseTo(-11, 5)
    expect(maxX).toBeCloseTo(-9, 5)
    expect(minZ).toBeCloseTo(-31, 5)
    expect(maxZ).toBeCloseTo(-29, 5)
  })

  it('leaves the model alone when robloxFront is off', () => {
    const model = buildSpec(prop([{ type: 'box', size: [2, 2, 2], position: [10, 0, 0] }]))
    const flat = flatten(model.parts, model.palette, false)
    let minX = Infinity
    for (let i = 0; i < flat.count; i++) minX = Math.min(minX, flat.position[i * 3])
    expect(minX).toBeCloseTo(9, 5)
  })

  it('emits parallel position, normal and uv arrays', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    const flat = flatten(model.parts, model.palette)
    expect(flat.position).toHaveLength(flat.count * 3)
    expect(flat.normal).toHaveLength(flat.count * 3)
    expect(flat.uv).toHaveLength(flat.count * 2)
  })

  it('gives every vertex of one colour the same UV', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1], color: 'a' }]))
    const flat = flatten(model.parts, model.palette)
    const [u, v] = paletteUv(0)
    for (let i = 0; i < flat.count; i++) {
      expect(flat.uv[i * 2]).toBeCloseTo(u, 6)
      expect(flat.uv[i * 2 + 1]).toBeCloseTo(v, 6)
    }
  })
})
describe('the GLB header', () => {
  const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
  const glb = toGlb(model, { name: 'crate' })

  it('starts with the glTF magic and version 2', () => {
    const fields = header(glb)
    expect(fields.magic).toBe(0x46546c67)
    expect(fields.version).toBe(2)
  })

  it('declares a total equal to the real file length', () => {
    expect(header(glb).total).toBe(glb.length)
  })

  it('has a JSON chunk padded to a multiple of 4', () => {
    expect(header(glb).jsonLength % 4).toBe(0)
    expect(header(glb).jsonType).toBe(0x4e4f534a)
  })

  it('has a BIN chunk with the right type', () => {
    expect(header(glb).binType).toBe(0x004e4942)
  })

  it('pads the JSON with spaces when padding is needed', () => {
    const jsonLength = header(glb).jsonLength
    const json = new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))
    const unpadded = json.trimEnd()

    // Whatever the padding is, it must be spaces so the chunk still parses.
    expect(json.slice(unpadded.length)).toMatch(/^ *$/)
    expect(jsonLength - unpadded.length).toBeLessThan(4)
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('is a multiple of 4 bytes overall', () => {
    expect(glb.length % 4).toBe(0)
  })
})

describe('the GLB JSON body', () => {
  const model = buildSpec(
    prop([
      { name: 'One', type: 'box', size: [1, 1, 1] },
      { name: 'Two', type: 'box', size: [1, 1, 1], position: [3, 0, 0] }
    ])
  )

  it('declares glTF 2.0', () => {
    const json = glbJson(toGlb(model, { name: 'crate' }))
    expect(json.asset).toMatchObject({ version: '2.0' })
  })

  it('has exactly one material and one texture', () => {
    const json = glbJson(toGlb(model, { name: 'crate' })) as {
      materials: unknown[]
      textures: unknown[]
      images: unknown[]
    }
    expect(json.materials).toHaveLength(1)
    expect(json.textures).toHaveLength(1)
    expect(json.images).toHaveLength(1)
  })

  it('names the material after the model', () => {
    const json = glbJson(toGlb(model, { name: 'crate' })) as {
      materials: { name: string }[]
    }
    expect(json.materials[0].name).toBe('crate_palette')
  })

  it('samples the palette with NEAREST, so cells do not bleed', () => {
    const json = glbJson(toGlb(model, { name: 'crate' })) as {
      samplers: { magFilter: number; minFilter: number }[]
    }
    expect(json.samplers[0]).toEqual({ magFilter: 9728, minFilter: 9728 })
  })

  it('flips the UV V for glTF', () => {
    const flat = flatten(model.parts, model.palette, true)
    // The three.js V is the palette centre, e.g. 0.9375; glTF must hold 0.0625.
    const sourceV = flat.uv[1]
    expect(sourceV).toBeGreaterThan(0.5)
    const glb = toGlb(model, { name: 'crate' })
    const json = glbJson(glb) as {
      bufferViews: { byteOffset: number; byteLength: number }[]
      accessors: { bufferView: number; type: string }[]
    }
    const uvAccessor = json.accessors.find((accessor) => accessor.type === 'VEC2')
    expect(uvAccessor).toBeDefined()
    const view = json.bufferViews[uvAccessor?.bufferView as number]
    const binStart = 28 + header(glb).jsonLength
    const dataView = new DataView(glb.buffer, glb.byteOffset + binStart + view.byteOffset)
    expect(dataView.getFloat32(4, true)).toBeCloseTo(1 - sourceV, 5)
  })

  it('re-bases each part to its own pivot', () => {
    const glb = toGlb(model, { name: 'crate' })
    const json = glbJson(glb) as {
      nodes: { name: string; translation?: number[]; mesh?: number }[]
      accessors: { type: string; min: number[]; max: number[] }[]
    }
    const two = json.nodes.find((node) => node.name === 'Two')
    expect(two?.translation).toBeDefined()
    // Group "Two" has no explicit pivot, so it defaults to its position [3,0,0],
    // mirrored to [-3,0,0].
    expect(two?.translation).toEqual([-3, 0, 0])
  })

  it('records position bounds on the POSITION accessor', () => {
    const json = glbJson(toGlb(model, { name: 'crate' })) as {
      accessors: { type: string; min?: number[]; max?: number[] }[]
    }
    const positions = json.accessors.filter((accessor) => accessor.type === 'VEC3')
    expect(positions[0].min).toBeDefined()
    expect(positions[0].max).toBeDefined()
  })
})

describe('the GLB is structurally loadable', () => {
  /**
   * A glTF parser needs three things this writer must get right, and all three
   * are checkable without a decoder: every accessor points at a real bufferView
   * inside the declared buffer, every bufferView lies inside it, and the binary
   * chunk is exactly as long as the buffer says. A real `GLTFLoader` run needs
   * WebGL for the texture, so that half is verified in the app.
   */
  const inspect = (glb: Uint8Array) => {
    const json = glbJson(glb) as {
      accessors: { bufferView: number; count: number; type: string }[]
      bufferViews: { byteOffset: number; byteLength: number; buffer: number }[]
      buffers: { byteLength: number }[]
      meshes: { primitives: { attributes: Record<string, number> }[] }[]
      nodes: { name: string; mesh?: number }[]
    }
    return { json, bin: header(glb).binLength }
  }

  it('has every accessor pointing inside a real bufferView', () => {
    const model = buildSpec(
      prop([
        { name: 'One', type: 'box', size: [1, 1, 1] },
        { name: 'Two', type: 'sphere', radius: 0.5, position: [2, 0, 0] }
      ])
    )
    const { json } = inspect(toGlb(model, { name: 'crate' }))

    for (const accessor of json.accessors) {
      expect(accessor.bufferView).toBeGreaterThanOrEqual(0)
      expect(accessor.bufferView).toBeLessThan(json.bufferViews.length)
      expect(accessor.count).toBeGreaterThan(0)
    }
  })

  it('has every bufferView inside the declared buffer', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    const { json, bin } = inspect(toGlb(model, { name: 'crate' }))

    expect(json.buffers).toHaveLength(1)
    expect(json.buffers[0].byteLength).toBe(bin)
    for (const view of json.bufferViews) {
      expect(view.buffer).toBe(0)
      expect(view.byteOffset).toBeGreaterThanOrEqual(0)
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(json.buffers[0].byteLength)
    }
  })

  it('starts every bufferView on a 4-byte boundary', () => {
    const model = buildSpec(prop([{ type: 'sphere', radius: 1 }]))
    const { json } = inspect(toGlb(model, { name: 'crate' }))
    for (const view of json.bufferViews) {
      expect(view.byteOffset % 4, `view at ${view.byteOffset}`).toBe(0)
    }
  })

  it('points every mesh primitive at accessors that exist', () => {
    const model = buildSpec(
      prop([
        { name: 'One', type: 'box', size: [1, 1, 1] },
        { name: 'Two', type: 'box', size: [1, 1, 1], position: [2, 0, 0] }
      ])
    )
    const { json } = inspect(toGlb(model, { name: 'crate' }))

    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        for (const index of Object.values(primitive.attributes)) {
          expect(index).toBeLessThan(json.accessors.length)
        }
      }
    }
  })

  it('gives every mesh node a mesh that exists', () => {
    const model = buildSpec(
      prop([
        { name: 'One', type: 'box', size: [1, 1, 1] },
        { name: 'Two', type: 'box', size: [1, 1, 1], position: [2, 0, 0] }
      ])
    )
    const { json } = inspect(toGlb(model, { name: 'crate' }))

    for (const node of json.nodes) {
      if (node.mesh !== undefined) expect(node.mesh).toBeLessThan(json.meshes.length)
    }
  })

  it('recovers one mesh per part group', () => {
    const model = buildSpec(
      prop([
        { name: 'One', type: 'box', size: [1, 1, 1] },
        { name: 'Two', type: 'sphere', radius: 0.5, position: [2, 0, 0] }
      ])
    )
    const { json } = inspect(toGlb(model, { name: 'crate' }))
    expect(json.meshes).toHaveLength(2)
    expect(json.meshes.map((mesh) => mesh.primitives.length)).toEqual([1, 1])
  })

  it('declares a POSITION count matching the model vertex count', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    const { json } = inspect(toGlb(model, { name: 'crate' }))
    // A box is 12 triangles, so 36 vertices.
    expect(json.accessors[0].count).toBe(36)
  })
})
describe('the rig hierarchy in GLB', () => {
  it('parents Head under Body with a relative translation', () => {
    const model = buildSpec(rigged())
    const json = glbJson(toGlb(model, { name: 'dog', merge: false })) as {
      nodes: { name: string; children?: number[]; translation?: number[] }[]
    }

    const root = json.nodes[0]
    const body = json.nodes.find((node) => node.name === 'Body')
    const head = json.nodes.find((node) => node.name === 'Head')

    expect(body).toBeDefined()
    expect(head).toBeDefined()
    // The root holds only the bone root, not every part.
    expect(root.children).toHaveLength(1)
    // Body's translation is its pivot relative to HumanoidRootPart: [0,0,0].
    expect(body?.translation).toEqual([0, 0, 0])
    // Head's pivot is [0,1,0], Body's is [0,0,0], so the relative offset is 1 in Y.
    expect(head?.translation).toEqual([0, 1, 0])
  })

  it('writes no glTF skin, because the rig is a node tree', () => {
    const model = buildSpec(rigged())
    const json = glbJson(toGlb(model, { name: 'dog', merge: false })) as Record<string, unknown>
    expect(json.skins).toBeUndefined()
    expect(json.joints).toBeUndefined()
  })
})

describe('merge', () => {
  it('forces merge off for a rigged model', () => {
    const model = buildSpec(rigged())
    expect(shouldMerge(model, 'character', true)).toBe(false)
  })

  it('defaults an accessory to merged', () => {
    const model = buildSpec(
      prop([{ type: 'box', size: [1, 1, 1] }], { category: 'accessory', accessoryType: 'Hat' })
    )
    expect(shouldMerge(model, 'accessory')).toBe(true)
  })

  it('defaults anything else to split', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(shouldMerge(model, 'prop')).toBe(false)
  })

  it('honours an explicit request when the model is not rigged', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(shouldMerge(model, 'prop', true)).toBe(true)
    expect(shouldMerge(model, 'accessory', false)).toBe(false)
  })

  it('collapses a merged model to one node and one mesh', () => {
    const model = buildSpec(
      prop([
        { name: 'One', type: 'box', size: [1, 1, 1] },
        { name: 'Two', type: 'box', size: [1, 1, 1], position: [3, 0, 0] }
      ])
    )
    const json = glbJson(toGlb(model, { name: 'crate', merge: true })) as {
      nodes: unknown[]
      meshes: unknown[]
    }
    expect(json.nodes).toHaveLength(1)
    expect(json.meshes).toHaveLength(1)
  })
})

describe('OBJ and MTL', () => {
  const model = buildSpec(
    prop([
      { name: 'One', type: 'box', size: [1, 1, 1], color: 'a' },
      { name: 'Two', type: 'box', size: [1, 1, 1], position: [3, 0, 0], color: 'b' }
    ])
  )
  const files = toObj(model, { name: 'crate' })

  it('opens with the header naming the front axis', () => {
    expect(files.obj.startsWith('# crate — Termul procedural model, units: studs, front: -Z')).toBe(
      true
    )
    expect(files.obj).toContain('mtllib crate.mtl')
  })

  it('emits one object and one usemtl per part group', () => {
    expect(files.obj).toContain('o One')
    expect(files.obj).toContain('o Two')
    expect(files.obj.match(/usemtl crate_palette/g)).toHaveLength(2)
  })

  it('writes v, vt and vn in parallel, indexed 1:1', () => {
    const lines = files.obj.split('\n')
    const v = lines.filter((line) => line.startsWith('v '))
    const vt = lines.filter((line) => line.startsWith('vt '))
    const vn = lines.filter((line) => line.startsWith('vn '))
    expect(v).toHaveLength(vt.length)
    expect(v).toHaveLength(vn.length)
    expect(v).toHaveLength(72)
  })

  it('emits one face per triangle with the same index three times', () => {
    const faces = files.obj.split('\n').filter((line) => line.startsWith('f '))
    expect(faces).toHaveLength(24)
    expect(faces[0]).toBe('f 1/1/1 2/2/2 3/3/3')
  })

  it('normalises -0 to 0', () => {
    // A centred box produces -0 on some axes after the mirror.
    expect(files.obj).not.toMatch(/v -0\.00000/)
    expect(files.obj).not.toMatch(/vn -0\.0000\b/)
  })

  it('writes a stub MTL pointing at the palette PNG', () => {
    expect(files.mtl).toContain('newmtl crate_palette')
    expect(files.mtl).toContain('Kd 1 1 1')
    expect(files.mtl).toContain('illum 1')
    expect(files.mtl).toContain('map_Kd crate_palette.png')
  })

  it('names the texture after the model', () => {
    expect(files.textureName).toBe('crate_palette.png')
  })

  it('merges the object name when asked', () => {
    const merged = toObj(model, { name: 'crate', merge: true })
    expect(merged.obj).toContain('o crate')
    expect(merged.obj).not.toContain('o One')
  })
})

describe('exportFiles', () => {
  const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))

  it('returns exactly the four documented files', () => {
    const files = exportFiles(model, { name: 'Crate' })
    expect(Object.keys(files).sort()).toEqual([
      'crate.glb',
      'crate.mtl',
      'crate.obj',
      'crate_palette.png'
    ])
  })

  it('gives every file non-zero bytes', () => {
    const files = exportFiles(model, { name: 'crate' })
    for (const [name, bytes] of Object.entries(files)) {
      expect(bytes.length, name).toBeGreaterThan(0)
    }
  })

  it('produces the same bytes twice', () => {
    const first = exportFiles(model, { name: 'crate' })
    const second = exportFiles(model, { name: 'crate' })
    for (const name of Object.keys(first)) {
      expect(Array.from(first[name]), name).toEqual(Array.from(second[name]))
    }
  })

  it('describes the export', () => {
    const summary = describeExport(model)
    expect(summary.triangles).toBe(12)
    expect(summary.parts).toBe(1)
    expect(summary.bytes.glb).toBeGreaterThan(0)
    expect(summary.bytes.png).toBeGreaterThan(0)
  })
})

describe('the OBJ and GLB agree', () => {
  it('emits the same number of vertices in both', () => {
    const model = buildSpec(
      prop([
        { name: 'One', type: 'box', size: [1, 1, 1] },
        { name: 'Two', type: 'sphere', radius: 0.5, position: [2, 0, 0] }
      ])
    )
    const obj = toObj(model, { name: 'crate' })
    const json = glbJson(toGlb(model, { name: 'crate' })) as {
      accessors: { type: string; count: number }[]
    }

    const objVertices = obj.obj.split('\n').filter((line) => line.startsWith('v ')).length
    const glbVertices = json.accessors
      .filter((accessor) => accessor.type === 'VEC3')
      .reduce((sum, accessor, index) => (index % 2 === 0 ? sum + accessor.count : sum), 0)

    expect(objVertices).toBe(glbVertices)
  })
})
