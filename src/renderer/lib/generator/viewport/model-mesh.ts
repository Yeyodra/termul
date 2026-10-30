/**
 * A stored model, drawn straight from its spec.
 *
 * The viewport used to read a record's GLB: export the bytes, write them, read
 * them back as a `data:` URL, and let `GLTFLoader` decode the embedded palette
 * PNG asynchronously. That chain has a silent failure mode - when the texture
 * does not resolve, three.js keeps the material's default white base colour, so
 * a model renders correctly shaped and completely colourless with no error
 * anywhere. That is exactly what happened.
 *
 * RobloxKit never takes that path. Its `toMesh` builds a `BufferGeometry` from
 * the model it already holds and attaches the palette as a texture directly
 * (`model-C3l0LP6n.js:849`). Geometry and colour are then produced in one
 * synchronous step, so there is no window in which a model can exist without
 * its palette.
 *
 * This module is that path: rebuild the model from the spec, flatten it, and
 * hand three.js a textured mesh. It is also cheaper - no GLB round trip and no
 * async decode - and a model on screen is then always the model the spec
 * describes rather than whatever bytes happened to be on disk.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  NearestFilter
} from 'three'
import { buildSpec, type Model } from '../engines/3d/build'
import { ATLAS_SIZE, flatten, palettePixels } from '../engines/3d/export'
import type { ModelSpec } from '../engines/3d/schema'

/**
 * The palette as a texture three.js can sample immediately.
 *
 * A `CanvasTexture` rather than a `TextureLoader`: the pixels are already in
 * memory, and going through an `<img>` would reintroduce the async decode that
 * left the model grey.
 */
function paletteTexture(model: Model): CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_SIZE
  canvas.height = ATLAS_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null

  const image = context.createImageData(ATLAS_SIZE, ATLAS_SIZE)
  image.data.set(palettePixels(Object.keys(model.palette), model.palette))
  context.putImageData(image, 0, 0)

  const texture = new CanvasTexture(canvas)
  // Nearest sampling: a palette is flat colour, so filtering between cells would
  // bleed one colour into the next along every edge.
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

export interface BuiltModelMesh {
  mesh: Mesh
  triangles: number
  dispose: () => void
}

/**
 * Build one mesh for a whole spec.
 *
 * Every part shares the palette texture and carries its colour through UVs, so
 * one material covers the model - the same single-material layout the GLB export
 * writes, and the same one RobloxKit's viewport uses.
 */
export function modelMeshFromSpec(spec: ModelSpec): BuiltModelMesh {
  const model = buildSpec(spec)
  const stream = flatten(model.parts, model.palette)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(stream.position, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(stream.normal, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(stream.uv, 2))

  const texture = paletteTexture(model)
  const material = new MeshStandardMaterial({
    map: texture,
    roughness: 0.55,
    metalness: 0.05
  })
  const mesh = new Mesh(geometry, material)

  return {
    mesh,
    triangles: stream.count / 3,
    dispose: () => {
      geometry.dispose()
      material.dispose()
      texture?.dispose()
    }
  }
}
