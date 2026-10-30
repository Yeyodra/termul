/**
 * The review sheets: what the model is shown when asked "does this match?".
 *
 * Ported from `render-D__CO5co.js` (262 lines: `renderThumbnail`,
 * `renderViewSheet`, `renderReviewSheets`) with the compositor structure taken
 * from Termul's `clothing/avatar/sheet.ts`, which already solves the offscreen
 * singleton, the backdrop and the JPEG conversion.
 *
 * **This is not the clothing sheet.** Clothing is 1024 x 358, three poses plus
 * the flat template, JPEG 0.85. This is 768 px tiles, two sheets, JPEG 0.88 for
 * the first and 0.85 for the second. Two different strips; they must not be
 * unified (`15/04` §7 M3).
 *
 * Sheet 1 is always four tiles: front, right side, back, three-quarter.
 * Sheet 2 exists only for a model with bones, and shows close-ups plus a test
 * walk. A model with no rig gets one sheet.
 *
 * Rendering needs a real WebGL context, so this cannot run under jsdom: the
 * vitest suite covers the tile maths, the labels and the data-URL contract, and
 * the rendered pixels are verified in the app.
 */
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three'
import { type Model, modelBounds } from './build'

/** Tile size in pixels, the original's `tile` default (`render-D__CO5co.js:137`). */
export const TILE = 768
/** Sheet 1's JPEG quality (`:175`). */
export const SHEET1_QUALITY = 0.88
/** Sheet 2's JPEG quality, the `renderViewSheet` path (`:133`). */
export const SHEET2_QUALITY = 0.85
/** Sheet 1's backdrop, `0x7d800a` (`:143`). */
export const SHEET1_BACKDROP = '#7d800a'
/** Sheet 2's backdrop, `0x101113` (`:28`). */
export const SHEET2_BACKDROP = '#101113'

/** One camera direction plus whether it uses a fitted projection. */
interface View {
  name: string
  direction: [number, number, number]
  orthographic: boolean
}

/**
 * Sheet 1's four views, in order (`render-D__CO5co.js:177`).
 *
 * The first three are fitted so a reviewer can judge symmetry and proportion;
 * the three-quarter is a plain perspective shot so it reads as a product photo.
 */
export const SHEET1_VIEWS: View[] = [
  { name: 'front', direction: [0, 0, 1], orthographic: true },
  { name: 'right side', direction: [1, 0, 0], orthographic: true },
  { name: 'back', direction: [0, 0, -1], orthographic: true },
  { name: 'three-quarter', direction: [0.8, 0.45, 1], orthographic: false }
]

/** Sheet 2's close-up views, for a model with bones (`:186-204`). */
export const SHEET2_CLOSEUPS: View[] = [
  { name: 'upper part, front', direction: [0, 0, 1], orthographic: true },
  { name: 'upper part, three-quarter', direction: [0.8, 0.3, 1], orthographic: false }
]

/** The walk view on sheet 2 (`:217`). */
export const SHEET2_WALK: View = {
  name: 'test walk, side',
  direction: [1, 0.1, 0.3],
  orthographic: false
}

let sharedRenderer: WebGLRenderer | null = null

/**
 * One renderer per window: creating a WebGL context is expensive.
 *
 * Deliberately not global across pages — the same rule `ArtifactViewport`
 * follows after `640ed56e`, where a shared surface caused three bugs.
 */
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

/**
 * A model as one group of per-colour meshes.
 *
 * The original renders `model.toMesh(atlasTexture)`, i.e. the whole model with
 * the palette atlas mapped on. Termul's model is a list of geometries tagged
 * with a palette key, so this makes one mesh per key with that key's flat
 * colour. The silhouette and the colour blocking are therefore the same as what
 * gets exported; only per-texel detail differs, and none of it is visible at
 * 768 px.
 */
function meshFor(model: Model): Group {
  const group = new Group()
  for (const part of model.parts) {
    const hex = model.palette[part.color] ?? '#9a9a9a'
    const geometry = part.geometry.clone()
    geometry.computeVertexNormals()
    group.add(new Mesh(geometry, new MeshLambertMaterial({ color: hex })))
  }
  return group
}

/** The lighting rig for sheet 1 (`render-D__CO5co.js:144-152`). */
function sheet1Scene(model: Model): { scene: Scene; mesh: Object3D } {
  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.3))

  const key = new DirectionalLight(0xffffff, 2.4)
  key.position.set(5, 9, 8)
  scene.add(key)

  const fill = new DirectionalLight(0xdfd7bf, 0.9)
  fill.position.set(-7, 3, 4)
  scene.add(fill)

  const rim = new DirectionalLight(0xffffff, 1.1)
  rim.position.set(0, 6, -9)
  scene.add(rim)

  const mesh = meshFor(model)
  scene.add(mesh)
  return { scene, mesh }
}

/** The simpler rig for sheet 2 (`render-D__CO5co.js:28-31`). */
function sheet2Scene(model: Model): { scene: Scene; mesh: Object3D } {
  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 2.2))

  const key = new DirectionalLight(0xffffff, 1.7)
  key.position.set(4, 9, 6)
  scene.add(key)

  const mesh = meshFor(model)
  scene.add(mesh)
  return { scene, mesh }
}

/**
 * Render one view of a box to a canvas.
 *
 * The fitted path projects the box's eight corners onto the camera's own axes
 * and takes the largest half-extent, with the original's 0.85 margin
 * (`render-D__CO5co.js:243-249`). That is what keeps a wide model from being
 * cropped, and it is expressed here as a 90-degree perspective at exactly that
 * distance, which covers the same box.
 */
function renderView(
  scene: Scene,
  focus: Box3,
  direction: [number, number, number],
  size: number,
  orthographic: boolean
): HTMLCanvasElement {
  const gl = renderer(size, size)
  const centre = focus.getCenter(new Vector3())
  const radius = focus.getSize(new Vector3()).length() / 2 || 1
  const forward = new Vector3(...direction).normalize()

  const camera = new PerspectiveCamera(30, 1, 0.01, radius * 20)
  camera.position.copy(centre).addScaledVector(forward, radius * 4)
  camera.lookAt(centre)

  if (orthographic) {
    camera.updateMatrixWorld(true)
    const inverseRotation = camera.matrixWorld.clone().invert()

    let halfWidth = 0
    let halfHeight = 0
    for (let corner = 0; corner < 8; corner++) {
      const point = new Vector3(
        corner & 1 ? focus.max.x : focus.min.x,
        corner & 2 ? focus.max.y : focus.min.y,
        corner & 4 ? focus.max.z : focus.min.z
      )
        .sub(centre)
        .applyMatrix4(inverseRotation)
      halfWidth = Math.max(halfWidth, Math.abs(point.x))
      halfHeight = Math.max(halfHeight, Math.abs(point.y))
    }

    // 0.05 keeps a flat model from collapsing to a zero-height frustum.
    const half = Math.max(halfWidth, halfHeight, 0.05) / 0.85
    const fitted = new PerspectiveCamera(90, 1, 0.01, radius * 20)
    fitted.position.copy(centre).addScaledVector(forward, half)
    fitted.lookAt(centre)
    gl.render(scene, fitted)
  } else {
    gl.render(scene, camera)
  }

  return gl.domElement
}

/** Release every geometry and material in a scene. */
function disposeScene(scene: Scene): void {
  scene.traverse((object) => {
    const mesh = object as unknown as {
      geometry?: { dispose?: () => void }
      material?: { map?: { dispose?: () => void }; dispose?: () => void }
    }
    mesh.geometry?.dispose?.()
    mesh.material?.map?.dispose?.()
    mesh.material?.dispose?.()
  })
}

/** A canvas of tiles, two per row, painted on `backdrop`. */
function composeSheet(
  tiles: { name: string; draw: () => HTMLCanvasElement }[],
  { backdrop, quality }: { backdrop: string; quality: number }
): string {
  const columns = tiles.length > 1 ? 2 : 1
  const rows = Math.ceil(tiles.length / columns)

  const sheet = document.createElement('canvas')
  sheet.width = TILE * columns
  sheet.height = TILE * rows
  const ctx = sheet.getContext('2d')
  if (!ctx) throw new Error('a 2D canvas is unavailable, so the review sheet cannot be composited')

  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, sheet.width, sheet.height)

  tiles.forEach((tile, index) => {
    const x = (index % columns) * TILE
    const y = Math.floor(index / columns) * TILE
    ctx.drawImage(tile.draw(), x, y)

    // The label plate: `12 + length*13` by 34 at 22 px, then the text
    // (`render-D__CO5co.js:169-173`).
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(x, y, 12 + tile.name.length * 13, 34)
    ctx.fillStyle = '#ffffff'
    ctx.font = '22px sans-serif'
    ctx.fillText(tile.name, x + 8, y + 25)
  })

  return sheet.toDataURL('image/jpeg', quality)
}

/** The framing box for a model, in world space. */
function focusBox(model: Model): Box3 {
  const { min, max } = modelBounds(model)
  return new Box3(new Vector3(...min), new Vector3(...max))
}

/**
 * The upper-part close-up box (`render-D__CO5co.js:193-204`): the top 35 % of
 * the model's height.
 */
function upperPartBox(focus: Box3): Box3 {
  const size = focus.getSize(new Vector3())
  return new Box3(
    new Vector3(focus.min.x, focus.max.y - size.y * 0.35, focus.min.z),
    focus.max.clone()
  )
}

/**
 * The single-view thumbnail as a canvas (`T`, `:78-91`).
 *
 * This is the collection thumbnail: one square cell, three-quarter view, no
 * labels and no backdrop.
 */
export function renderThumbnail(model: Model, size = 256): HTMLCanvasElement {
  const { scene } = sheet2Scene(model)
  const view = renderView(scene, focusBox(model), [0.9, 0.55, 1.1], size, false)

  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('a 2D canvas is unavailable, so the thumbnail cannot be composited')
  ctx.drawImage(view, 0, 0)

  disposeScene(scene)
  return out
}

/**
 * How many sheets a model gets, without rendering.
 *
 * Lets a caller decide whether to expect a second image before paying for the
 * first render.
 */
export function sheetCount(model: Model): number {
  return (model.rigSpec?.skeleton ?? []).length ? 2 : 1
}

/**
 * The review sheets, as JPEG data URLs.
 *
 * Returns one sheet for a model with no bones, two when `model.rigSpec` is set.
 * Sheet 1 is the four canonical views; sheet 2 is close-ups plus a test walk.
 */
export function renderReviewSheets(
  model: Model,
  { tile = TILE }: { tile?: number } = {}
): string[] {
  const focus = focusBox(model)

  const first = sheet1Scene(model)
  const sheet1 = composeSheet(
    SHEET1_VIEWS.map((view) => ({
      name: view.name,
      draw: () => renderView(first.scene, focus, view.direction, tile, view.orthographic)
    })),
    { backdrop: SHEET1_BACKDROP, quality: SHEET1_QUALITY }
  )
  disposeScene(first.scene)

  if (sheetCount(model) < 2) return [sheet1]

  // Sheet 2: close-ups of the upper part, then a walk view. The original leaves
  // one slot empty on a rigged sheet (`08` §G7); it is a cosmetic gap and is
  // reproduced rather than filled with an invented fifth view.
  const second = sheet2Scene(model)
  const upper = upperPartBox(focus)
  const tiles = [
    ...SHEET2_CLOSEUPS.map((view) => ({
      name: view.name,
      draw: () => renderView(second.scene, upper, view.direction, tile, view.orthographic)
    })),
    {
      name: SHEET2_WALK.name,
      draw: () =>
        renderView(second.scene, focus, SHEET2_WALK.direction, tile, SHEET2_WALK.orthographic)
    }
  ]

  const sheet2 = composeSheet(tiles, {
    backdrop: SHEET2_BACKDROP,
    quality: SHEET2_QUALITY
  })
  disposeScene(second.scene)

  return [sheet1, sheet2]
}

/** Release the shared WebGL context, for a window that is going away. */
export function disposeRenderer(): void {
  sharedRenderer?.dispose()
  sharedRenderer = null
}

/**
 * The tile grid a sheet occupies, for layout assertions that do not need WebGL.
 *
 * Sheet 1 is always four tiles, so 2 x 2. Sheet 2 is three, so 2 x 2 with one
 * slot empty — the cosmetic gap noted above.
 */
export function sheetLayout(tiles: number): {
  columns: number
  rows: number
  width: number
  height: number
} {
  const columns = tiles > 1 ? 2 : 1
  const rows = Math.ceil(tiles / columns)
  return { columns, rows, width: TILE * columns, height: TILE * rows }
}
