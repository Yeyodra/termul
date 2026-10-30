/**
 * The mesh artifact: three formats, one of which is new.
 *
 * `glb` was added to `MeshArtifact.format` so the 3D engine's viewport can read
 * a generated model. The point of these tests is that the addition is
 * **additive**: `obj` and `stl` must behave exactly as they did, and `glb` must
 * take the binary path rather than being handed to a text parser.
 *
 * Parsing a real GLB needs WebGL for its texture, so the pixels are verified in
 * the app. What is checked here is the routing decision, which is where a
 * regression would silently send a binary file to `OBJLoader`.
 */
import { describe, expect, it } from 'vitest'
import { modelFormat, modelMimeType } from '@/lib/artifact-records'
import type { Artifact, MeshArtifact } from '@/lib/generator/viewport/artifact'

const GLB = 'data:model/gltf-binary;base64,Z2xURgIAAAA='

describe('the mesh artifact type', () => {
  it('accepts glb alongside obj and stl', () => {
    const formats: Array<MeshArtifact['format']> = ['obj', 'stl', 'glb']
    expect(formats).toHaveLength(3)
  })

  it('is still one of the four artifact kinds', () => {
    const kinds: Array<Artifact['kind']> = ['clothing', 'mesh', 'skybox', 'texture']
    expect(kinds).toHaveLength(4)
  })

  it('carries a glb artifact without changing its shape', () => {
    const artifact: MeshArtifact = { kind: 'mesh', format: 'glb', url: GLB, name: 'Crate' }
    expect(artifact.kind).toBe('mesh')
    expect(artifact.format).toBe('glb')
    expect(artifact.name).toBe('Crate')
  })
})

describe('modelFormat', () => {
  it('maps glb and gltf to the glb branch', () => {
    // GLTFLoader handles both; the viewport only needs to know "binary GLTF".
    expect(modelFormat('v1.glb')).toBe('glb')
    expect(modelFormat('v1.gltf')).toBe('glb')
  })

  it('maps stl to stl and everything else to obj', () => {
    expect(modelFormat('v1.stl')).toBe('stl')
    expect(modelFormat('v1.obj')).toBe('obj')
    expect(modelFormat('v1.unknown')).toBe('obj')
  })

  it('ignores case', () => {
    expect(modelFormat('V1.GLB')).toBe('glb')
  })
})

describe('modelMimeType', () => {
  it('gives a GLB the media type the viewport fetches', () => {
    // `model/gltf-binary` is what MeshArtifact's data URL must carry; guessing
    // `application/octet-stream` would still decode but reads as a download.
    expect(modelMimeType('v1.glb')).toBe('model/gltf-binary')
    expect(modelMimeType('v1.gltf')).toBe('model/gltf+json')
  })

  it('gives the text formats their own types', () => {
    expect(modelMimeType('v1.obj')).toBe('text/plain')
    expect(modelMimeType('v1.stl')).toBe('model/stl')
  })

  it('falls back for an unknown extension', () => {
    expect(modelMimeType('v1.bin')).toBe('application/octet-stream')
  })
})
