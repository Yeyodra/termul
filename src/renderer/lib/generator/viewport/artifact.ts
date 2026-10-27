/**
 * What the viewport is currently showing, as a value rather than a component.
 *
 * A generated artifact is not clothing-shaped: today a garment, later a model,
 * a skybox or a cutscene. The viewport therefore takes a *scene builder* — a
 * function that returns an `Object3D` group and a disposer — instead of taking
 * a garment. Clothing is the first implementation of that interface, not a
 * special case inside the viewport.
 *
 * This module is the registry and the one built-in builder. Adding a second
 * artifact kind means adding a builder here, not touching the viewport.
 */

import type { Group } from 'three'
import { buildAvatar } from '../engines/clothing/avatar/avatar'
import type { Rig } from '../engines/clothing/avatar/rig'
import type { DesignType } from '../engines/clothing/schema'
import type { ImageLoader } from '../engines/clothing/vector'

/** A built scene, plus the teardown for whatever it allocated. */
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
  /** The design's name, when it had one. */
  name?: string
  rig?: Rig
  skin?: string
}

/** Anything the viewport can show. Grows as engines land. */
export type Artifact = ClothingArtifact

/** Decode a data URL into a canvas `CanvasTexture` accepts. */
function loadAtlas(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('the garment atlas did not decode'))
    image.src = src
  })
}

/** Build the avatar wearing the garment. */
async function buildClothingScene(
  artifact: ClothingArtifact,
  loadImage: ImageLoader
): Promise<ArtifactScene> {
  const atlas = await loadImage(artifact.atlas)
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

/**
 * Turn an artifact into a scene the viewport can show.
 *
 * Async because a garment atlas has to decode before it can become a texture.
 * Throws when the artifact kind has no builder, which the caller shows as a
 * message rather than an empty viewport.
 */
export async function buildArtifactScene(
  artifact: Artifact,
  loadImage: ImageLoader = loadAtlas
): Promise<ArtifactScene> {
  switch (artifact.kind) {
    case 'clothing':
      return buildClothingScene(artifact, loadImage)
    default: {
      const unreachable: never = artifact.kind
      throw new Error(`no viewport builder for a ${String(unreachable)} artifact`)
    }
  }
}
