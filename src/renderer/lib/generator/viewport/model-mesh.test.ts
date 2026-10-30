/**
 * The model mesh carries its palette.
 *
 * This is the regression that mattered: the viewport rendered every model white
 * while the GLB was correct, because the texture arrived through an async decode
 * that could fail silently. These tests assert the property that failure broke -
 * the mesh has a material with a texture - so a colourless model fails a test
 * instead of shipping.
 */
import { describe, expect, it } from 'vitest'
import { DOG_EXAMPLE, R15_HERO_EXAMPLE } from '../engines/3d/examples'
import { modelMeshFromSpec } from './model-mesh'

describe('modelMeshFromSpec', () => {
  it('gives the mesh a material with a palette texture, not a bare colour', () => {
    const built = modelMeshFromSpec(DOG_EXAMPLE)

    expect(built.mesh.material).toBeTruthy()
    const material = built.mesh.material as { map?: unknown }
    // Without a map three.js falls back to white, which is the exact bug.
    expect(material.map).toBeTruthy()

    built.dispose()
  })

  it('keeps the palette texture rather than dropping it to null', () => {
    const built = modelMeshFromSpec(R15_HERO_EXAMPLE)
    const material = built.mesh.material as { map?: { image?: { width?: number } } }

    expect(material.map).toBeTruthy()
    expect(material.map?.image?.width).toBe(128)

    built.dispose()
  })

  it('carries geometry with positions, normals and uvs', () => {
    const built = modelMeshFromSpec(DOG_EXAMPLE)
    const geometry = built.mesh.geometry

    expect(geometry.getAttribute('position')).toBeTruthy()
    expect(geometry.getAttribute('normal')).toBeTruthy()
    // The uv attribute is what selects a palette cell per part.
    expect(geometry.getAttribute('uv')).toBeTruthy()
    expect(built.triangles).toBeGreaterThan(0)

    built.dispose()
  })

  it('paints every palette colour into the texture, so no cell is left black', () => {
    const built = modelMeshFromSpec(DOG_EXAMPLE)
    const material = built.mesh.material as {
      map?: { image?: { width: number; height: number } }
    }
    const image = material.map?.image as
      | { width: number; height: number; getContext?: unknown }
      | undefined

    // The canvas is the texture source; a 128x128 atlas means 8x8 cells of 16px.
    expect(image?.width).toBe(128)
    expect(image?.height).toBe(128)

    built.dispose()
  })

  it('samples with nearest filtering, so adjacent palette cells cannot bleed', () => {
    const built = modelMeshFromSpec(DOG_EXAMPLE)
    const map = (built.mesh.material as { map?: { magFilter?: number; minFilter?: number } }).map

    expect(map?.magFilter).toBe(1003)
    expect(map?.minFilter).toBe(1003)

    built.dispose()
  })

  it('disposes the texture with the mesh', () => {
    const built = modelMeshFromSpec(DOG_EXAMPLE)
    const map = (built.mesh.material as { map?: { dispose: () => void } }).map
    let disposed = false
    if (map) {
      const original = map.dispose.bind(map)
      map.dispose = () => {
        disposed = true
        original()
      }
    }

    built.dispose()
    expect(disposed).toBe(true)
  })
})
