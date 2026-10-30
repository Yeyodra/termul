/**
 * What the viewport is showing, and how each artifact kind becomes a scene.
 *
 * The viewport core knows nothing about artifacts: it takes `Group`s, frames
 * them, and draws. This module is the only place that knows a garment is worn by
 * an avatar or that a model arrives as a GLB. Adding a kind means adding an
 * interface, a union member and one builder â€” the viewport, the store, the tab
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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import type { ModelSpec } from '../engines/3d/schema'
import { buildAvatar, type GarmentTextures } from '../engines/clothing/avatar/avatar'
import type { Rig } from '../engines/clothing/avatar/rig'
import type { DesignType } from '../engines/clothing/schema'
import { modelMeshFromSpec } from './model-mesh'

export interface ArtifactScene {
  /** The object graph to frame and show. */
  objects: Group[]
  /** Release GPU resources. Called when the viewport swaps artifacts. */
  dispose: () => void
  /** What the artifact is, for the caption. */
  label: string
}

/**
 * One avatar wearing one or more garments.
 *
 * An outfit rather than a single garment, because Roblox itself dresses a
 * character from several assets at once: a shirt, a pair of pants and a T-shirt
 * are three uploads worn together. `atlases` is therefore a map, and every slot
 * that has a picture is filled.
 *
 * `primary` names the garment the page is *about* - the row the user picked. The
 * node pipeline, the Inspector and the facts bar all read that one record, so an
 * outfit stays a view of one item even when it is drawn with others.
 */
export interface OutfitArtifact {
  kind: 'clothing'
  /** One atlas per garment worn. `shirt` and `tshirt` are separate layers. */
  atlases: Partial<Record<DesignType, string>>
  /** The garment the page describes; the rest are worn for context. */
  primary: DesignType
  name?: string
  rig?: Rig
  skin?: string
}

/** A generated model, already serialised to a mesh format. */
export interface MeshArtifact {
  kind: 'mesh'
  /**
   * `glb` is binary and arrives as a `data:model/gltf-binary;base64,â€¦` URL;
   * `obj` and `stl` are text and arrive as `data:` or `blob:` URLs. Adding it
   * is additive - the obj and stl paths are unchanged.
   */
  format: 'obj' | 'stl' | 'glb'
  /** URL or data URL of the mesh. */
  url: string
  name?: string
}

/**
 * A generated model carried as its spec rather than as a serialised file.
 *
 * A GLB round trip is the reason every model rendered white: the palette PNG
 * inside the file is decoded asynchronously, and when that decode fails three.js
 * keeps the material's default white base colour and reports nothing. Holding the
 * spec instead lets the mesh be built with its texture in one synchronous step,
 * which is what RobloxKit does.
 */
export interface SpecModelArtifact {
  kind: 'model'
  /** The authored document, exactly as the record stores it. */
  spec: unknown
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

export type Artifact =
  | OutfitArtifact
  | MeshArtifact
  | SpecModelArtifact
  | SkyboxArtifact
  | TextureArtifact

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
  artifact: OutfitArtifact,
  decode: Decode = loadImage
): Promise<ArtifactScene> {
  const worn = Object.entries(artifact.atlases).filter(
    (entry): entry is [DesignType, string] => typeof entry[1] === 'string' && entry[1].length > 0
  )
  const decoded = await Promise.all(
    worn.map(async ([type, src]) => [type, (await decode(src)) as HTMLCanvasElement] as const)
  )
  const clothes: GarmentTextures = {}
  for (const [type, canvas] of decoded) clothes[type] = canvas

  const avatar = buildAvatar({
    rig: artifact.rig ?? 'R15',
    skin: artifact.skin,
    clothes
  })
  return {
    objects: [avatar.group],
    dispose: () => avatar.dispose(),
    label:
      artifact.name?.trim() ||
      outfitLabel(
        worn.map(([type]) => type),
        artifact.primary
      )
  }
}

/** `primary` leads: the caption answers "what am I looking at", not "what else is on". */
function outfitLabel(worn: DesignType[], primary: DesignType): string {
  const ordered = [primary, ...worn.filter((type) => type !== primary)]
  return `${ordered.join(' + ')} on the avatar`
}

/**
 * Meshes arrive as a URL; the loaders return a group the viewport can frame.
 *
 * GLB is binary, so it is fetched as an `ArrayBuffer` and parsed by
 * `GLTFLoader`; OBJ and STL are text and keep their existing path. The GLB
 * branch is additive â€” nothing about the other two changed.
 */
async function buildMesh(artifact: MeshArtifact): Promise<ArtifactScene> {
  const loaded = await loadMeshGroup(artifact)

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
        const material = mesh.material as MeshStandardMaterial | undefined
        material?.map?.dispose()
      })
      for (const material of materials) material.dispose()
    },
    label: artifact.name?.trim() || `the generated ${artifact.format.toUpperCase()} model`
  }
}

/** Parse one mesh artifact into a `Group`, per format. */
async function loadMeshGroup(artifact: MeshArtifact): Promise<Group> {
  if (artifact.format === 'glb') {
    const buffer = await fetch(artifact.url).then(async (response) => {
      if (!response.ok) throw new Error(`the model did not download (${response.status})`)
      return response.arrayBuffer()
    })
    const gltf = await new GLTFLoader().parseAsync(buffer, '')
    return gltf.scene as unknown as Group
  }

  const source = await fetch(artifact.url).then((response) => {
    if (!response.ok) throw new Error(`the model did not download (${response.status})`)
    return response.text()
  })

  if (artifact.format === 'stl') {
    return new Group().add(new Mesh(new STLLoader().parse(source), new MeshStandardMaterial()))
  }
  return new OBJLoader().parse(source)
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

/** A model drawn from its spec, with its palette attached in the same step. */
async function buildSpecModel(artifact: SpecModelArtifact): Promise<ArtifactScene> {
  const built = modelMeshFromSpec(artifact.spec as ModelSpec)
  const group = new Group()
  group.add(built.mesh)
  return {
    objects: [group],
    dispose: () => built.dispose(),
    label: artifact.name?.trim() || 'the generated model'
  }
}

const BUILDERS: { [K in Artifact['kind']]: Builder<K> } = {
  clothing: buildClothing,
  mesh: buildMesh,
  model: buildSpecModel,
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
