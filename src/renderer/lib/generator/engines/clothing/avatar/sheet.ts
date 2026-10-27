/**
 * The review image: the garment on an avatar, four panels.
 *
 * Ported 1:1 from RobloxKit's `renderClothingSheet` and
 * `renderClothingThumbnail` (`avatarRender-DVeE1evW.js`). This is the piece that
 * makes the review turn worth having: the model is asked "does this match the
 * request" and shown the garment worn on a body, so it can judge drape,
 * proportion and whether a motif sits where it should — none of which is visible
 * in a flat UV atlas.
 *
 * The layout is three 3D poses (front, back, left side) then the flat template
 * letterboxed into the fourth cell, on a `#101113` background, JPEG at 0.85.
 *
 * Rendering needs a real WebGL context, so this cannot run under jsdom: the
 * vitest suite covers the atlas maths and the compositor, and this module is
 * verified in the app.
 */

import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three'

import type { GarmentTextures } from './avatar'
import { buildAvatar } from './avatar'
import type { Rig } from './rig'

/** The camera directions upstream uses, as unit-ish vectors. */
const VIEWS = {
  front: [0, 0.12, 1],
  back: [0, 0.12, -1],
  left: [1, 0.12, 0.15],
  right: [-1, 0.12, 0.15],
  '3/4': [0.75, 0.25, 1]
} as const

/** The look-at point: chest height on the R15 rig. */
const TARGET = [0, 2.75, 0] as const
/** How far the camera sits from the target. */
const DISTANCE = 12.5
/** Vertical field of view. */
const FOV = 30
/** The background the panel strip is painted on. */
const BACKDROP = '#101113'
/** Cell width in the strip; the strip is four cells wide. */
const CELL = 256
/** Strip height, `CELL * 1.4`. */
const STRIP_H = Math.round(CELL * 1.4)
const STRIP_W = CELL * 4
/** JPEG quality for the review image. */
const JPEG_QUALITY = 0.85
/** The single-view thumbnail's size. */
const THUMB = 256

let sharedRenderer: WebGLRenderer | null = null

/** One renderer per window: creating a WebGL context is expensive. */
function renderer(width: number, height: number): WebGLRenderer {
  if (!sharedRenderer) {
    sharedRenderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    })
    sharedRenderer.outputColorSpace = 'srgb'
  }
  sharedRenderer.setPixelRatio(1)
  sharedRenderer.setSize(width, height, false)
  return sharedRenderer
}

/** The lighting rig, identical for every view. */
function sceneFor(avatar: ReturnType<typeof buildAvatar>): Scene {
  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.8))

  const key = new DirectionalLight(0xffffff, 1.9)
  key.position.set(3, 8, 7)
  scene.add(key)

  const fill = new DirectionalLight(0xffffff, 0.9)
  fill.position.set(-3, 5, -7)
  scene.add(fill)

  scene.add(avatar.group)
  return scene
}

/** Render one camera direction to a canvas. */
function renderView(
  scene: Scene,
  direction: readonly [number, number, number],
  width: number,
  height: number
): HTMLCanvasElement {
  const gl = renderer(width, height)
  const camera = new PerspectiveCamera(FOV, width / height, 0.1, 100)

  const [tx, ty, tz] = TARGET
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1
  camera.position.set(
    tx + (direction[0] / length) * DISTANCE,
    ty + (direction[1] / length) * DISTANCE,
    tz + (direction[2] / length) * DISTANCE
  )
  camera.lookAt(tx, ty, tz)

  gl.render(scene, camera)
  return gl.domElement
}

/**
 * The four-panel review strip, as a JPEG data URL.
 *
 * `template` is the flat atlas the engine rendered; it is letterboxed into the
 * last cell so the model sees both the garment and the sheet it came from.
 */
export function renderClothingSheet(
  clothes: GarmentTextures,
  template: HTMLCanvasElement | null,
  { rig = 'R15', skin }: { rig?: Rig; skin?: string } = {}
): string {
  const avatar = buildAvatar({ rig, skin, clothes })
  const scene = sceneFor(avatar)

  const strip = document.createElement('canvas')
  strip.width = STRIP_W
  strip.height = STRIP_H
  const ctx = strip.getContext('2d')
  if (!ctx) throw new Error('a 2D canvas is unavailable, so the review sheet cannot be composited')

  ctx.fillStyle = BACKDROP
  ctx.fillRect(0, 0, STRIP_W, STRIP_H)

  const poses: Array<[string, readonly [number, number, number]]> = [
    ['front', VIEWS.front],
    ['back', VIEWS.back],
    ['left side', VIEWS.left]
  ]

  poses.forEach(([label, direction], index) => {
    const cell = renderView(scene, direction, CELL, STRIP_H)
    ctx.drawImage(cell, index * CELL, 0)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '14px sans-serif'
    ctx.fillText(label, index * CELL + 8, 18)
  })

  if (template) {
    const scale = Math.min(CELL / template.width, STRIP_H / template.height)
    const width = template.width * scale
    const height = template.height * scale
    ctx.drawImage(template, CELL * 3 + (CELL - width) / 2, (STRIP_H - height) / 2, width, height)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '14px sans-serif'
    ctx.fillText('template', CELL * 3 + 8, 18)
  }

  avatar.dispose()
  return strip.toDataURL('image/jpeg', JPEG_QUALITY)
}

/**
 * A single three-quarter view on a transparent background, as a PNG data URL.
 *
 * This is the collection thumbnail: one square cell, no labels, no backdrop.
 */
export function renderClothingThumbnail(
  clothes: GarmentTextures,
  { rig = 'R15', skin }: { rig?: Rig; skin?: string } = {}
): string {
  const avatar = buildAvatar({ rig, skin, clothes })
  const scene = sceneFor(avatar)
  const view = renderView(scene, VIEWS['3/4'], THUMB, THUMB)

  const out = document.createElement('canvas')
  out.width = THUMB
  out.height = THUMB
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('a 2D canvas is unavailable, so the thumbnail cannot be composited')
  ctx.drawImage(view, 0, 0)

  avatar.dispose()
  return out.toDataURL('image/png')
}

/** Release the shared WebGL context, for a window that is going away. */
export function disposeRenderer(): void {
  sharedRenderer?.dispose()
  sharedRenderer = null
}
