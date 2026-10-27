/**
 * What the viewport is showing, and how each artifact kind becomes a scene.
 *
 * The viewport core knows nothing about artifacts: it takes `Group`s, frames
 * them, and draws. This module is the only place that knows a garment is worn by
 * an avatar or that a model arrives as a GLB. Adding a kind means adding an
 * interface, a union member and one builder — the viewport, the store, the tab
 * and the layer stay untouched.
 *
 * Builders are a `Record` over the union, not a `switch`: a new member fails
 * typecheck here until it has a builder, which is the whole point.
 */

import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry
} from 'three'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { buildAvatar } from '../engines/clothing/avatar/avatar'
import type { Rig } from '../engines/clothing/avatar/rig'
import type { DesignType } from '../engines/clothing/schema'

export interface ArtifactScene {
  /** The object graph to frame and show. */
  objects: Group[]
  /** Release GPU resources. Called when the viewport swaps artifacts. */
  dispose: () => void
  /** What the artifact is, for the caption. */
  label: string
}

export interface ClothingArtifact {
  kind: 'clothing'
  type: DesignType
  /** The flat atlas the engine rendered, as a data URL. */
  atlas: string
  name?: string
  rig?: Rig
  skin?: string
}

/** A generated model, already serialised to a mesh format. */
export interface MeshArtifact {
  kind: 'mesh'
  format: 'obj' | 'stl'
  /** URL or data URL of the mesh. */
  url: string
  name?: string
}

/** Six cube faces, in the order a cube map expects them. */
export interface SkyboxArtifact {
  kind: 'skybox'
  faces: { px: string; nx: string; py: string; ny: string; pz: string; nz: string }
  name?: string
}

/** One picture on a lit quad: the cheapest thing worth orbiting around. */
export interface TextureArtifact {
  kind: 'texture'
  image: string
  name?: string
}

export type Artifact = ClothingArtifact | MeshArtifact | SkyboxArtifact | TextureArtifact

/** Decoding is injectable so the registry can be tested without real pixels. */
export type Decode = (src: string) => Promise<CanvasImageSource>

function loadImage(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('the artifact picture did not decode'))
    image.src = src
  })
}

async function buildClothing(
  artifact: ClothingArtifact,
  decode: Decode = loadImage
): Promise<ArtifactScene> {
  const atlas = await decode(artifact.atlas)
  const avatar = buildAvatar({
    rig: artifact.rig ?? 'R15',
    skin: artifact.skin,
    clothes: { [artifact.type]: atlas as HTMLCanvasElement }
  })
  return {
    objects: [avatar.group],
    dispose: () => avatar.dispose(),
    label: artifact.name?.trim() || `${artifact.type} on the avatar`
  }
}

/** Meshes arrive as text; the loaders return a group the viewport can frame. */
async function buildMesh(artifact: MeshArtifact): Promise<ArtifactScene> {
  const source = await fetch(artifact.url).then((response) => {
    if (!response.ok) throw new Error(`the model did not download (${response.status})`)
    return response.text()
  })
  const loaded =
    artifact.format === 'stl'
      ? new Group().add(new Mesh(new STLLoader().parse(source), new MeshStandardMaterial()))
      : new OBJLoader().parse(source)

  const group = new Group()
  for (const child of [...loaded.children]) group.add(child)
  const materials: MeshStandardMaterial[] = []
  group.traverse((child) => {
    if ((child as Mesh).isMesh) materials.push((child as Mesh).material as MeshStandardMaterial)
  })
  return {
    objects: [group],
    dispose: () => {
      group.traverse((child) => {
        const mesh = child as Mesh
        mesh.geometry?.dispose()
      })
      for (const material of materials) material.dispose()
    },
    label: artifact.name?.trim() || `the generated ${artifact.format.toUpperCase()} model`
  }
}

/** The skybox is drawn on the inside of a box, so it is unlit and double-sided. */
async function buildSkybox(artifact: SkyboxArtifact): Promise<ArtifactScene> {
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const
  const images = await Promise.all(order.map((face) => loadImage(artifact.faces[face])))
  const materials = images.map(
    (image) =>
      new MeshBasicMaterial({
        map: textureOf(image),
        side: DoubleSide,
        depthWrite: false
      })
  )
  const box = new Mesh(new BoxGeometry(20, 20, 20), materials)
  const group = new Group()
  group.add(box)
  return {
    objects: [group],
    dispose: () => {
      box.geometry.dispose()
      for (const material of materials) {
        material.map?.dispose()
        material.dispose()
      }
    },
    label: artifact.name?.trim() || 'the generated skybox'
  }
}

/** A texture is shown on a quad tall enough to read at a distance. */
async function buildTexture(artifact: TextureArtifact): Promise<ArtifactScene> {
  const image = await loadImage(artifact.image)
  const material = new MeshBasicMaterial({ map: textureOf(image), side: DoubleSide })
  const plane = new Mesh(new PlaneGeometry(4, 4), material)
  const group = new Group()
  group.add(plane)
  return {
    objects: [group],
    dispose: () => {
      plane.geometry.dispose()
      material.map?.dispose()
      material.dispose()
    },
    label: artifact.name?.trim() || 'the generated texture'
  }
}

function textureOf(image: CanvasImageSource): CanvasTexture {
  return new CanvasTexture(image as HTMLCanvasElement)
}

type Builder<K extends Artifact['kind']> = (
  artifact: Extract<Artifact, { kind: K }>,
  decode: Decode
) => Promise<ArtifactScene>

const BUILDERS: { [K in Artifact['kind']]: Builder<K> } = {
  clothing: buildClothing,
  mesh: buildMesh,
  skybox: buildSkybox,
  texture: buildTexture
}

export async function buildArtifactScene(
  artifact: Artifact,
  decode: Decode = loadImage
): Promise<ArtifactScene> {
  const builder = BUILDERS[artifact.kind] as Builder<Artifact['kind']> | undefined
  if (!builder) throw new Error(`no viewport builder for a ${String(artifact.kind)} artifact`)
  return builder(artifact, decode)
}
