/**
 * The Roblox avatar the review image is rendered on.
 *
 * Ported 1:1 from RobloxKit's `avatar-CSK-yHJ2.js` (`buildAvatar`, `composite`,
 * `rectUvs`, `segmentRect`). This is the piece that turns a flat clothing atlas
 * into something a model can judge: the atlas is applied as a texture per body
 * part, with each face of each box UV-mapped to its rectangle in the sheet.
 *
 * Three details are load-bearing and easy to get wrong:
 *
 *  - a part is a `BoxGeometry` whose six faces are assigned UVs by hand
 *    (`rectUvs`); the sheet is 585x559 for shirt/pants and the v axis is
 *    flipped, because Roblox's atlas has its origin top-left and three's is
 *    bottom-left
 *  - R15 splits the torso into UpperTorso (0.8) and LowerTorso (0.2), an arm into
 *    UpperArm 0.45 / LowerArm 0.4 / Hand 0.15, and a leg into UpperLeg 0.43 /
 *    LowerLeg 0.42 / Foot 0.15 â€” the garment has to be sliced across those
 *    segments or it stretches
 *  - a segment is inset by 0.015 of its height except the last, so adjacent
 *    segments do not share a seam pixel
 *
 * The shirt texture covers torso and arms, the pants texture covers torso and
 * legs, composited skin -> pants -> shirt, which is why bare regions show skin.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  type Object3D,
  SphereGeometry,
  SRGBColorSpace,
  type Texture
} from 'three'
import type { Region } from '../layout'
import { regionsFor } from '../layout'
import type { DesignType } from '../schema'
import { type JointPose, poseJoints, type Rig, rigParts } from './rig'

/** The skin tones upstream offers; the first is the default. */
export const SKIN_TONES = [
  { name: 'Light orange', hex: '#eab892' },
  { name: 'Pastel brown', hex: '#ffcc99' },
  { name: 'Nougat', hex: '#cc8e69' },
  { name: 'Brown', hex: '#7c5c46' },
  { name: 'Reddish brown', hex: '#694028' },
  { name: 'Bright yellow', hex: '#f5cd30' },
  { name: 'Medium stone grey', hex: '#a3a2a5' }
] as const

/** The atlas size a garment type is mapped with. */
const SHEET_W = 585
const SHEET_H = 559

/** How a body part is sliced into stacked segments. */
const SEGMENTS: Record<'torso' | 'arm' | 'leg', Array<[string, number]>> = {
  torso: [
    ['UpperTorso', 0.8],
    ['LowerTorso', 0.2]
  ],
  arm: [
    ['UpperArm', 0.45],
    ['LowerArm', 0.4],
    ['Hand', 0.15]
  ],
  leg: [
    ['UpperLeg', 0.43],
    ['LowerLeg', 0.42],
    ['Foot', 0.15]
  ]
}

/** The gap left between adjacent segments, as a fraction of a segment. */
const SEGMENT_INSET = 0.015

/** An atlas rectangle: the part of the sheet one face of one segment shows. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The six box faces, in the order `BoxGeometry` lays out its UV attribute. */
const FACES = ['left', 'right', 'up', 'down', 'front', 'back'] as const

interface BodyPart {
  name: string
  wears: string
  split: 'torso' | 'arm' | 'leg'
  size: [number, number, number]
  center: [number, number, number]
}

const BODY: BodyPart[] = [
  { name: 'Torso', wears: 'torso', split: 'torso', size: [2, 2, 1], center: [0, 3, 0] },
  { name: 'LeftArm', wears: 'left_arm', split: 'arm', size: [1, 2, 1], center: [1.5, 3, 0] },
  { name: 'RightArm', wears: 'right_arm', split: 'arm', size: [1, 2, 1], center: [-1.5, 3, 0] },
  { name: 'LeftLeg', wears: 'left_leg', split: 'leg', size: [1, 2, 1], center: [0.5, 1, 0] },
  { name: 'RightLeg', wears: 'right_leg', split: 'leg', size: [1, 2, 1], center: [-0.5, 1, 0] }
]

/**
 * The UV quad for one atlas rectangle, in `BoxGeometry`'s face order.
 *
 * `v` is flipped because the atlas is authored top-left-down while three's UV
 * origin is bottom-left-up. Getting this wrong puts the collar at the hem.
 */
export function rectUvs(region: Rect): number[] {
  const u0 = region.x / SHEET_W
  const u1 = (region.x + region.w) / SHEET_W
  const v1 = 1 - region.y / SHEET_H
  const v0 = 1 - (region.y + region.h) / SHEET_H
  return [u0, v1, u1, v1, u0, v0, u1, v0]
}

/**
 * The slice of a face that one stacked segment shows.
 *
 * `from`/`to` are 0..1 down the face. A segment is inset at its far edge so two
 * neighbours do not fight over the same row of pixels, except the last one,
 * which must reach the bottom.
 */
export function segmentRect(
  regions: Region[],
  face: string,
  from: number,
  to: number
): Rect | null {
  const byFace = (name: string): Region | undefined => regions.find((r) => r.face === name)

  if (face === 'up' || face === 'down') {
    if (face === 'up' ? from === 0 : to === 1) {
      return byFace(face) ?? null
    }
    const front = byFace('front')
    if (!front) return null
    const y = front.y + Math.round(front.h * (face === 'up' ? from : to))
    return {
      x: front.x,
      y: Math.min(front.y + front.h - 1, y),
      w: front.w,
      h: 1
    }
  }

  const base = byFace(face)
  if (!base) return null
  const start = base.y + Math.round(base.h * from)
  const end = base.y + Math.round(base.h * to)
  return { x: base.x, y: start, w: base.w, h: Math.max(1, end - start) }
}

/** A geometry whose six faces sample the given atlas rectangles. */
function geometryFor(
  size: [number, number, number],
  regions: Region[],
  from: number,
  to: number
): BoxGeometry {
  const geometry = new BoxGeometry(...size)
  const uv = geometry.attributes.uv

  FACES.forEach((face, index) => {
    const slice = segmentRect(regions, face, from, to)
    if (!slice) return
    const quad = rectUvs(slice)
    for (let corner = 0; corner < 4; corner += 1) {
      uv.setXY(index * 4 + corner, quad[corner * 2], quad[corner * 2 + 1])
    }
  })

  uv.needsUpdate = true
  return geometry
}

/** Composite skin, then pants, then shirt into one atlas-sized texture. */
export function composite(
  target: HTMLCanvasElement,
  skin: string,
  layers: Array<HTMLCanvasElement | null | undefined>
): HTMLCanvasElement {
  target.width = SHEET_W
  target.height = SHEET_H
  const ctx = target.getContext('2d')
  if (!ctx) return target

  ctx.fillStyle = skin
  ctx.fillRect(0, 0, SHEET_W, SHEET_H)
  for (const layer of layers) {
    if (layer) ctx.drawImage(layer, 0, 0, SHEET_W, SHEET_H)
  }
  return target
}

/** A neutral face, so the head is not a featureless box. */
function faceTexture(): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return new CanvasTexture(canvas)

  ctx.fillStyle = '#1b1b1f'
  for (const x of [44, 84]) {
    ctx.beginPath()
    ctx.ellipse(x, 52, 7, 11, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = '#1b1b1f'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(64, 70, 24, Math.PI * 0.18, Math.PI * 0.82)
  ctx.stroke()

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Which atlas a body part reads from. */
export type GarmentTextures = Partial<Record<DesignType, HTMLCanvasElement>>

/** The built avatar, plus the joints a caller may pose. */
export interface Avatar {
  group: Group
  rig: Rig
  joints: Record<string, Group>
  setPose(joints: JointPose): void
  dispose(): void
}

/**
 * Build a rigged avatar wearing the supplied garment atlases.
 *
 * Each body part becomes a group at its bone pivot, with the mesh offset so the
 * pivot sits where Roblox puts it. Garment textures are applied per segment, and
 * a missing texture falls back to skin.
 */
export function buildAvatar({
  rig = 'R15',
  skin = SKIN_TONES[0].hex,
  clothes = {}
}: {
  rig?: Rig
  skin?: string
  clothes?: GarmentTextures
} = {}): Avatar {
  const group = new Group()
  group.name = `Avatar ${rig}`

  const root = new Group()
  root.name = 'HumanoidRootPart'
  group.add(root)

  const joints: Record<string, Group> = {}
  const pivots: Record<string, [number, number, number]> = {}

  for (const part of rigParts(rig)) {
    const bone = new Group()
    bone.name = part.part
    const parentPivot = part.parent ? pivots[part.parent] : ([0, 0, 0] as const)
    bone.position.set(
      part.pivot[0] - parentPivot[0],
      part.pivot[1] - parentPivot[1],
      part.pivot[2] - parentPivot[2]
    )
    ;(part.parent ? joints[part.parent] : root).add(bone)
    joints[part.part] = bone
    pivots[part.part] = part.pivot
  }

  /** Reparent a mesh so it hangs from `bone` at `pivot`. */
  const attach = (mesh: Mesh, bone: string): void => {
    const pivot = pivots[bone] ?? [0, 0, 0]
    mesh.position.set(
      mesh.position.x - pivot[0],
      mesh.position.y - pivot[1],
      mesh.position.z - pivot[2]
    )
    joints[bone].add(mesh)
  }

  const shirt = clothes.shirt ?? clothes.tshirt
  const pants = clothes.pants

  /** One material per garment slot, sharing the atlas texture. */
  const materialFor = (canvas: HTMLCanvasElement | undefined): MeshStandardMaterial => {
    if (!canvas) return new MeshStandardMaterial({ color: skin, roughness: 0.75 })
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = NearestFilter
    texture.anisotropy = 4
    return new MeshStandardMaterial({ map: texture, roughness: 0.82 })
  }

  const shirtMaterial = materialFor(shirt)
  const pantsMaterial = materialFor(pants)
  const skinMaterial = new MeshStandardMaterial({ color: skin, roughness: 0.75 })

  for (const part of BODY) {
    const isLeg = part.wears.endsWith('leg')
    const atlas = isLeg ? pants : shirt
    const regions: Region[] = atlas ? regionsFor(isLeg ? 'pants' : 'shirt') : []
    const material = atlas ? (isLeg ? pantsMaterial : shirtMaterial) : skinMaterial

    const segments = rig === 'R6' ? [[part.name, 1] as const] : SEGMENTS[part.split]
    let from = 0
    const top = part.center[1] + part.size[1] / 2

    for (const [label, fraction] of segments) {
      const to = from + fraction
      const inset = rig === 'R6' || to === 1 ? 0 : SEGMENT_INSET
      const height = part.size[1] * fraction - inset

      const geometry = regions.length
        ? geometryFor([part.size[0], height, part.size[2]], regions, from, to)
        : new BoxGeometry(part.size[0], height, part.size[2])

      const mesh = new Mesh(geometry, material)
      mesh.name = rig === 'R6' ? part.name : `${part.name.replace(/Arm|Leg|Torso/, '')}${label}`
      mesh.position.set(part.center[0], top - part.size[1] * from - height / 2, part.center[2])
      attach(mesh, rig === 'R6' ? part.name : mesh.name)

      from = to
    }
  }

  const head = new Mesh(new SphereGeometry(0.9, 24, 18), skinMaterial)
  head.name = 'Head'
  head.scale.setScalar(1)
  head.position.set(0, 4.62, 0)
  attach(head, 'Head')

  const face = new Mesh(
    new SphereGeometry(0.92, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshStandardMaterial({ map: faceTexture(), transparent: true, roughness: 0.9 })
  )
  face.position.set(0, 4.62, 0.02)
  face.rotation.x = Math.PI / 2
  attach(face, 'Head')

  const setPose = (pose: JointPose): void => {
    const radians = Math.PI / 180
    for (const [bone, degrees] of Object.entries(pose)) {
      const joint = joints[bone]
      if (!joint) continue
      joint.rotation.set(degrees[0] * radians, degrees[1] * radians, degrees[2] * radians)
    }
    group.updateMatrixWorld(true)
  }

  setPose(poseJoints(rig, 'stand'))

  return {
    group,
    rig,
    joints,
    setPose,
    dispose: () => {
      group.traverse((object: Object3D) => {
        const mesh = object as Mesh
        mesh.geometry?.dispose?.()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          if (!material) continue
          ;(material as MeshStandardMaterial).map?.dispose?.()
          material.dispose?.()
        }
      })
    }
  }
}
