/**
 * `buildSpec` — a JSON spec in, a `Model` out.
 *
 * Ported from `spec-D11M_y_m.js:706-912` (the recursive emitter `R`, the sink
 * `L`, the transform `N`, the primitives `M` and the shape factory `j`), with
 * the container from `model-C3l0LP6n.js:684-866` and the repair pass from
 * `model-C3l0LP6n.js:557-683`. The CSG is a csg.js-lineage BSP from
 * `spec-D11M_y_m.js:138-404`.
 *
 * See `re/full-reverse/08-3d-polyforge/REPORT.md` §1, §8 and §12. `build.ts` is
 * where invalidity becomes an exception: `designLoop` reads `.problems` off a
 * thrown error, so `ModelRejected` carries the validator's strings unchanged
 * (`loop.ts:10-11`).
 *
 * Order matters and is the original's: validate, then build, then repair each
 * primitive, then fit the triangle budget. A boolean's children are built into
 * their own polygon lists before the CSG runs, and the CSG output skips repair
 * because it is already manifold.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js'
import type { BuildResult } from '../../types'
import { evaluate, type ParamValues } from './expr'
import helvetikerBold from './helvetiker-bold.typeface.json'
import {
  LIMITS,
  type ModelSpec,
  paramValues,
  type ShapeSpec,
  type SpecNode,
  validateSpec
} from './schema'

/**
 * The error `build()` throws for an invalid spec.
 *
 * `designLoop` pulls `problems` off whatever `build` throws and echoes the
 * strings to the model, so this mirrors RobloxKit's `SpecError`
 * (`spec-D11M_y_m.js:434-440`) exactly: the message is the problems joined by
 * newlines, and `.problems` is the array itself.
 */
export class ModelRejected extends Error {
  problems: string[]

  constructor(problems: string[]) {
    super(problems.join('\n'))
    this.name = 'ModelRejected'
    this.problems = problems
  }
}

/** One emitted part: a non-indexed geometry plus the palette key it draws with. */
export interface ModelPart {
  geometry: THREE.BufferGeometry
  /** Palette key. Falls back to the spec's first colour when a node names none. */
  color: string
  /** Index of the top-level `parts[i]` node this came from. */
  node: number
}

/** One top-level part group: the unit export and validation work on. */
export interface ModelGroup {
  node: number
  name: string
  pivot: number[]
}

/**
 * What the repair pass counted, per the original's `model.health`
 * (`spec-D11M_y_m.js:905-912`).
 */
export interface ModelHealth {
  /** Parts whose winding was reversed. */
  flipped: number
  /** Degenerate triangles dropped. */
  dropped: number
  /** Open-edge counts, keyed by the `parts[i]` node index. */
  open: Map<number, number>
}

/**
 * A built model: the container `check`, `sheet` and `export` all read.
 *
 * This mirrors `model-C3l0LP6n.js`'s `Model` closely enough that the ported
 * algorithms translate one-for-one, but it is plain data plus three geometries
 * rather than a class hierarchy, because Termul only needs the four operations
 * below.
 */
export interface Model {
  name: string
  parts: ModelPart[]
  groups: ModelGroup[]
  palette: Record<string, string>
  health: ModelHealth
  /** Set for `category: 'character'`; `check` reads it for the rig rules. */
  rigSpec?: { rig: string; skeleton: unknown[] }
  /** Carried through from the spec when present. */
  motion?: unknown
  /** True once `fitBudget` had to simplify anything. */
  simplified: boolean
}

/** Options `buildSpec` accepts. */
export interface BuildSpecOptions {
  /** Slider overrides; clamped into each param's range before binding. */
  params?: Record<string, unknown>
  /** Drop `hidden: true` nodes from the output. */
  skipHidden?: boolean
}

/* ── The shape sub-language (`j`, spec-D11M_y_m.js:721-740) ──────────────── */

/** The shared `T` helper: evaluate, or take a default. */
function makeScalar(params: ParamValues) {
  return (value: unknown, fallback = 0): number =>
    value === undefined ? fallback : evaluate(value, params)
}

/** The shared `E` helper: evaluate an array, or take a default array. */
function makeTuple(params: ParamValues) {
  const scalar = makeScalar(params)
  return (value: unknown, fallback: number[]): number[] =>
    value ? (value as unknown[]).map((item) => scalar(item)) : fallback
}

/** A rounded rectangle path. `radius` is clamped to half the smaller side. */
function roundedRectPath(w: number, h: number, radius: number): THREE.Shape {
  const r = Math.min(radius, w / 2, h / 2)
  const path = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  path.lineTo(x + w, y + h - r)
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  path.lineTo(x + r, y + h)
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  path.lineTo(x, y + r)
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return path
}

/** The parametric heart, 28 samples (`templates-Cm7rjk-r.js:202-217`). */
function heartPath(size: number, samples = 28): THREE.Shape {
  const path = new THREE.Shape()
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2
    const x = Math.sin(t) ** 3 * 16
    const y = Math.cos(t) * 13 - Math.cos(t * 2) * 5 - Math.cos(t * 3) * 2 - Math.cos(t * 4)
    const px = (x / 17) * size
    const py = (y / 17) * size
    if (i === 0) path.moveTo(px, py)
    else path.lineTo(px, py)
  }
  return path
}

/** An alternating-radius star, starting at 90 degrees. */
function starPath(points: number, outer: number, inner: number): THREE.Shape {
  const path = new THREE.Shape()
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  }
  path.closePath()
  return path
}

/** A regular n-gon starting at +X. */
function polygonPath(sides: number, radius: number, rotation = 0): THREE.Shape {
  const path = new THREE.Shape()
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 + rotation
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  }
  path.closePath()
  return path
}

/** A circle. */
function circlePath(radius: number): THREE.Shape {
  const path = new THREE.Shape()
  path.absarc(0, 0, radius, 0, Math.PI * 2, false)
  return path
}

/** A closed polyline. */
function pointsPath(points: number[][]): THREE.Shape {
  const path = new THREE.Shape()
  points.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  })
  path.closePath()
  return path
}

/** A ring: a circle with a circular hole. */
function ringPath(outer: number, inner: number, steps = 32): THREE.Shape {
  const path = new THREE.Shape()
  path.absarc(0, 0, outer, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true)
  path.holes.push(hole)
  // `userData` is not on the three type, but ExtrudeGeometry reads it for the
  // ring's curve resolution. The original sets it the same way.
  ;(path as unknown as { userData: unknown }).userData = { steps }
  return path
}

/** Resolve a shape node to a `Shape` (`j`, `spec-D11M_y_m.js:721-740`). */
function buildShape(shape: ShapeSpec, params: ParamValues): THREE.Shape {
  const scalar = makeScalar(params)
  switch (shape.type) {
    case 'rect':
      // A sharp rect is a rounded rect with a negligible radius.
      return roundedRectPath(scalar(shape.w, 1), scalar(shape.h, 1), 0.0001)
    case 'roundedRect':
      return roundedRectPath(scalar(shape.w, 1), scalar(shape.h, 1), scalar(shape.radius, 0.1))
    case 'circle':
      return circlePath(scalar(shape.radius, 0.5))
    case 'polygon':
      return polygonPath(Math.max(3, Math.round(scalar(shape.sides, 6))), scalar(shape.radius, 0.5))
    case 'star':
      return starPath(
        Math.max(3, Math.round(scalar(shape.points, 5))),
        scalar(shape.outer, 0.5),
        scalar(shape.inner, 0.25)
      )
    case 'heart':
      return heartPath(scalar(shape.size, 0.5))
    case 'ring':
      return ringPath(scalar(shape.outer, 0.5), scalar(shape.inner, 0.3))
    case 'points':
      return pointsPath(
        (shape.points as unknown[][]).map(([x, y]) => [scalar(x), scalar(y)] as [number, number])
      )
    default:
      throw new ModelRejected([`shape.type: "${shape.type}" is not a known outline`])
  }
}

/* ── The 12 primitives (`M`, spec-D11M_y_m.js:741-780) ───────────────────── */

/**
 * The Helvetiker-Bold typeface, parsed once.
 *
 * RobloxKit inlines this JSON in `templates-Cm7rjk-r.js:139-185`; the copy here
 * is that payload extracted verbatim, because `three` no longer ships the
 * example fonts and `text` is a kit primitive that must work.
 */
const helvetikerBoldFont = new Font(
  helvetikerBold as unknown as ConstructorParameters<typeof Font>[0]
)

/** Extrude a shape, centred on the node origin (`templates-Cm7rjk-r.js:269-284`). */
function extrudeShape(
  shape: THREE.Shape,
  depth: number,
  { bevel = 0, segments = 8, bevelSegments = 1 } = {}
): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: segments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

/**
 * A tube along a Catmull-Rom curve, with hand-built end caps
 * (`templates-Cm7rjk-r.js:311-363`).
 *
 * The caps are triangle fans built from the curve's Frenet frames, which is why
 * a tube never trips the open-shell warning: it is watertight by construction.
 */
function tubeGeometry(path: number[][], radius: number, { segments = 24, radial = 8 } = {}) {
  const curve = new THREE.CatmullRomCurve3(
    path.map((point) => new THREE.Vector3(...point)),
    false
  )
  const geometry = new THREE.TubeGeometry(curve, segments, radius, radial, false).toNonIndexed()

  const positions = geometry.attributes.position
  const capFor = (at: number) => {
    const centre = curve.getPointAt(at)
    const frames = curve.computeFrenetFrames(segments, false)
    const index = at === 0 ? 0 : segments
    const normal = frames.normals[index]
    const binormal = frames.binormals[index]
    const ring: THREE.Vector3[] = []
    for (let i = 0; i < radial; i++) {
      const angle = (i / radial) * Math.PI * 2
      const sin = Math.sin(angle)
      const cos = -Math.cos(angle)
      ring.push(
        new THREE.Vector3(
          centre.x + radius * (cos * normal.x + sin * binormal.x),
          centre.y + radius * (cos * normal.y + sin * binormal.y),
          centre.z + radius * (cos * normal.z + sin * binormal.z)
        )
      )
    }
    return { centre, ring }
  }

  const extra: THREE.Vector3[] = []
  for (const at of [0, 1]) {
    const { centre, ring } = capFor(at)
    for (let i = 0; i < radial; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % radial]
      if (at === 0) extra.push(centre, b, a)
      else extra.push(centre, a, b)
    }
  }

  const merged = new Float32Array((positions.count + extra.length) * 3)
  merged.set(positions.array.slice(0, positions.count * 3) as Float32Array)
  extra.forEach((point, index) => {
    merged.set([point.x, point.y, point.z], (positions.count + index) * 3)
  })

  const capped = new THREE.BufferGeometry()
  capped.setAttribute('position', new THREE.BufferAttribute(merged, 3))
  return capped
}

/** Sweep a shape along a path. `bevelEnabled` is hard-coded off. */
function sweepGeometry(shape: THREE.Shape, path: number[][], { steps = 24 } = {}) {
  const curve = new THREE.CatmullRomCurve3(
    path.map((point) => new THREE.Vector3(...point)),
    false
  )
  return new THREE.ExtrudeGeometry(shape, {
    steps,
    extrudePath: curve,
    bevelEnabled: false,
    curveSegments: 6
  })
}

/** Lathe a `[radius, y]` profile, clamping radius to >= 0 and capping the ends. */
function latheGeometry(profile: [number, number][], segments = 24, { cap = true } = {}) {
  const points = profile.map(([r, y]) => [Math.max(0, r), y] as [number, number])
  if (cap && points.length >= 2) {
    if (points[0][0] > 0.000001) points.unshift([0, points[0][1]])
    if (points[points.length - 1][0] > 0.000001) points.push([0, points[points.length - 1][1]])
  }
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments
  )
}

/** Extruded 3D text, centred on its bounding box (`templates-Cm7rjk-r.js:365-385`). */
function textGeometry(text: string, { size = 0.4, depth = 0.08, bevel = 0.01, segments = 3 } = {}) {
  const geometry = new TextGeometry(String(text || ' '), {
    font: helvetikerBoldFont,
    size,
    depth,
    curveSegments: segments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 1
  })
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  geometry.translate(
    -(box.max.x + box.min.x) / 2,
    -(box.max.y + box.min.y) / 2,
    -(box.max.z + box.min.z) / 2
  )
  return geometry
}

/**
 * Build one primitive node's geometry (`M`, `spec-D11M_y_m.js:741-780`).
 *
 * Segment counts are fixed, not authorable — that is the kit's contract, and
 * changing them would change the triangle counts the UGC limits are tuned to.
 */
function buildPrimitive(node: SpecNode, params: ParamValues): THREE.BufferGeometry {
  const scalar = makeScalar(params)
  const tuple = makeTuple(params)

  switch (node.type) {
    case 'box': {
      const [w, h, d] = tuple(node.size, [0, 0, 0])
      return new THREE.BoxGeometry(w, h, d)
    }
    case 'roundedBox': {
      const [w, h, d] = tuple(node.size, [0, 0, 0])
      // 2 subdivision steps per edge, radius clamped to half the smallest side.
      return new RoundedBoxGeometry(w, h, d, 2, scalar(node.radius, 0.1))
    }
    case 'sphere':
      return new THREE.SphereGeometry(scalar(node.radius), 16, 12)
    case 'cylinder':
      return new THREE.CylinderGeometry(
        scalar(node.radiusTop ?? node.radius),
        scalar(node.radiusBottom ?? node.radius),
        scalar(node.height),
        20
      )
    case 'cone':
      return new THREE.ConeGeometry(scalar(node.radius), scalar(node.height), 20)
    case 'torus':
      return new THREE.TorusGeometry(scalar(node.radius), scalar(node.tube, 0.1), 8, 32)
    case 'capsule':
      // `length` is never validated, so an absent one silently becomes 0.5.
      // Quirk reproduced from `spec-D11M_y_m.js:755-756` (08 15 B2).
      return new THREE.CapsuleGeometry(scalar(node.radius), scalar(node.length, 0.5), 4, 10)
    case 'extrude':
      return extrudeShape(buildShape(node.shape as ShapeSpec, params), scalar(node.depth, 0.1), {
        bevel: scalar(node.bevel, 0),
        segments: 8
      })
    case 'lathe':
      return latheGeometry(
        (node.profile as unknown[][]).map(
          ([r, y]) => [Math.max(0, scalar(r)), scalar(y)] as [number, number]
        ),
        24
      )
    case 'tube':
      return tubeGeometry(
        (node.path as unknown[][]).map((point) => point.map((item) => scalar(item))),
        scalar(node.radius, 0.05),
        { segments: 24, radial: 8 }
      )
    case 'sweep':
      return sweepGeometry(
        buildShape(node.shape as ShapeSpec, params),
        (node.path as unknown[][]).map((point) => point.map((item) => scalar(item))),
        { steps: 24 }
      )
    case 'text':
      return textGeometry(node.text ?? '', {
        size: scalar(node.size, 0.5),
        depth: scalar(node.depth, 0.1),
        segments: 3
      })
    default:
      throw new ModelRejected([`parts: "${node.type}" is not a primitive`])
  }
}

/* ── Geometry repair (model-C3l0LP6n.js:557-683) ─────────────────────────── */

/** Vertex quantisation used by every topology test here (`V`, `:557`). */
const QUANT = 0.0001

/** Quantise a coordinate to a string key, so near-coincident vertices merge. */
function vertexKey(x: number, y: number, z: number): string {
  return `${Math.round(x / QUANT)},${Math.round(y / QUANT)},${Math.round(z / QUANT)}`
}

/**
 * Count open edges: an edge used by exactly one triangle (`U`, `:559-578`).
 *
 * Zero means a closed manifold, which decides which winding test applies.
 */
export function countOpenEdges(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position
  const edges = new Map<string, number>()

  for (let i = 0; i + 2 < position.count; i += 3) {
    const keys = [0, 1, 2].map((offset) =>
      vertexKey(position.getX(i + offset), position.getY(i + offset), position.getZ(i + offset))
    )
    // A degenerate triangle contributes no edges at all.
    if (keys[0] !== keys[1] && keys[1] !== keys[2] && keys[0] !== keys[2]) {
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0]
      ]) {
        const key = keys[a] < keys[b] ? `${keys[a]}|${keys[b]}` : `${keys[b]}|${keys[a]}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
  }

  let open = 0
  for (const count of edges.values()) if (count === 1) open++
  return open
}

/** Signed volume of a closed mesh (`W`, `:579-595`). Negative means inside-out. */
export function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position
  let total = 0
  for (let i = 0; i + 2 < position.count; i += 3) {
    const ax = position.getX(i)
    const ay = position.getY(i)
    const az = position.getZ(i)
    const bx = position.getX(i + 1)
    const by = position.getY(i + 1)
    const bz = position.getZ(i + 1)
    const cx = position.getX(i + 2)
    const cy = position.getY(i + 2)
    const cz = position.getZ(i + 2)
    total += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return total / 6
}

/**
 * The area-weighted centroid test for an open mesh (`G`, `:596-617`).
 *
 * True means the faces already point outward. An open shell has no meaningful
 * volume, so the original falls back to "does the average face normal point
 * away from the centroid".
 */
export function facesOutward(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.attributes.position
  const centroid = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    centroid.add(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)))
  }
  centroid.multiplyScalar(1 / Math.max(1, position.count))

  let score = 0
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
    const mid = a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
      .sub(centroid)
    score += normal.dot(mid)
  }
  return score >= 0
}

/** Reverse every triangle's winding (`q`/`Z`, `:655-665` and `:889-899`). */
export function flipWinding(geometry: THREE.BufferGeometry): void {
  const position = geometry.attributes.position
  for (let i = 0; i + 2 < position.count; i += 3) {
    const x = position.getX(i + 1)
    const y = position.getY(i + 1)
    const z = position.getZ(i + 1)
    position.setXYZ(i + 1, position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2))
    position.setXYZ(i + 2, x, y, z)
  }
  position.needsUpdate = true
}

/** Drop triangles with two coincident vertices (`K`, `:618-654`). */
export function dropDegenerate(geometry: THREE.BufferGeometry): {
  geometry: THREE.BufferGeometry
  dropped: number
} {
  const position = geometry.attributes.position
  const keep: number[] = []
  let dropped = 0

  for (let i = 0; i + 2 < position.count; i += 3) {
    const keys = [0, 1, 2].map((offset) =>
      vertexKey(position.getX(i + offset), position.getY(i + offset), position.getZ(i + offset))
    )
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) {
      dropped++
      continue
    }
    keep.push(i)
  }

  if (!dropped) return { geometry, dropped }

  const compact = new THREE.BufferGeometry()
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name] as THREE.BufferAttribute
    const itemSize = attribute.itemSize
    const data = new Float32Array(keep.length * 3 * itemSize)
    keep.forEach((start, index) => {
      for (let vertex = 0; vertex < 3; vertex++) {
        for (let component = 0; component < itemSize; component++) {
          data[(index * 3 + vertex) * itemSize + component] =
            attribute.array[(start + vertex) * itemSize + component]
        }
      }
    })
    compact.setAttribute(name, new THREE.BufferAttribute(data, itemSize))
  }
  return { geometry: compact, dropped }
}

/** What one repair pass produced. */
export interface RepairResult {
  geometry: THREE.BufferGeometry
  flipped: boolean
  dropped: number
  open: number
}

/**
 * The repair pass every non-boolean primitive goes through (`J`, `:666-683`).
 *
 * 1. drop degenerate triangles,
 * 2. count open edges,
 * 3. flip the winding — by signed volume when the mesh is closed, by the
 *    centroid test when it is not.
 */
export function repairGeometry(input: THREE.BufferGeometry): RepairResult {
  const nonIndexed = input.index ? input.toNonIndexed() : input
  const { geometry, dropped } = dropDegenerate(nonIndexed)
  const open = countOpenEdges(geometry)
  let flipped = false

  const insideOut = open === 0 ? signedVolume(geometry) < 0 : !facesOutward(geometry)
  if (insideOut) {
    flipWinding(geometry)
    flipped = true
  }

  return { geometry, flipped, dropped, open }
}

/* ── CSG: a csg.js-lineage BSP (spec-D11M_y_m.js:138-404) ────────────────── */

/** Classification epsilon (`O`, `:138`). */
const CSG_EPSILON = 0.00001

const COPLANAR = 0
const FRONT = 1
const BACK = 2
const SPANNING = 3

/** A plane `{normal, w}` that can split polygons (`N`, `:143-215`). */
class CsgPlane {
  normal: THREE.Vector3
  w: number

  constructor(normal: THREE.Vector3, w: number) {
    this.normal = normal
    this.w = w
  }

  static from(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): CsgPlane | null {
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
    // A degenerate triangle has no plane, so it is dropped rather than kept.
    if (normal.lengthSq() < 1e-20) return null
    normal.normalize()
    return new CsgPlane(normal, normal.dot(a))
  }

  clone(): CsgPlane {
    return new CsgPlane(this.normal.clone(), this.w)
  }

  flip(): void {
    this.normal.negate()
    this.w = -this.w
  }

  /**
   * Split `polygon` into the four output buckets, cloning only what is cut.
   *
   * The buckets are `coplanarFront`, `coplanarBack`, `front` and `back`; a
   * coplanar polygon joins whichever side its own normal faces.
   */
  split(
    polygon: CsgPolygon,
    coplanarFront: CsgPolygon[],
    coplanarBack: CsgPolygon[],
    front: CsgPolygon[],
    back: CsgPolygon[]
  ): void {
    let polygonType = 0
    const types = polygon.vertices.map((vertex) => {
      const t = this.normal.dot(vertex) - this.w
      const type = t < -CSG_EPSILON ? BACK : t > CSG_EPSILON ? FRONT : COPLANAR
      polygonType |= type
      return type
    })

    switch (polygonType) {
      case COPLANAR:
        ;(this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon)
        break
      case FRONT:
        front.push(polygon)
        break
      case BACK:
        back.push(polygon)
        break
      default: {
        const f: THREE.Vector3[] = []
        const b: THREE.Vector3[] = []
        const vertices = polygon.vertices
        for (let i = 0; i < vertices.length; i++) {
          const j = (i + 1) % vertices.length
          const ti = types[i]
          const tj = types[j]
          const vi = vertices[i]
          const vj = vertices[j]
          if (ti !== BACK) f.push(vi)
          if (ti !== FRONT) b.push(ti === BACK ? vi : vi.clone())
          if ((ti | tj) === SPANNING) {
            const t =
              (this.w - this.normal.dot(vi)) /
              this.normal.dot(new THREE.Vector3().subVectors(vj, vi))
            const cut = vi.clone().lerp(vj, t)
            f.push(cut)
            b.push(cut.clone())
          }
        }
        if (f.length >= 3) front.push(new CsgPolygon(f, polygon.shared, polygon.plane))
        if (b.length >= 3) back.push(new CsgPolygon(b, polygon.shared, polygon.plane))
      }
    }
  }
}

/** A polygon with a plane and the palette key it belongs to (`P`, `:216-229`). */
class CsgPolygon {
  vertices: THREE.Vector3[]
  shared: string
  plane: CsgPlane

  constructor(vertices: THREE.Vector3[], shared: string, plane?: CsgPlane) {
    this.vertices = vertices
    this.shared = shared
    // The plane is derived from the first three vertices when not supplied.
    this.plane = plane ?? (CsgPlane.from(vertices[0], vertices[1], vertices[2]) as CsgPlane)
  }

  clone(): CsgPolygon {
    return new CsgPolygon(
      this.vertices.map((vertex) => vertex.clone()),
      this.shared,
      this.plane.clone()
    )
  }

  flip(): void {
    this.vertices.reverse()
    this.plane.flip()
  }
}

/** A BSP node (`F`, `:230-313`). */
class BspNode {
  plane: CsgPlane | null = null
  front: BspNode | null = null
  back: BspNode | null = null
  polygons: CsgPolygon[] = []

  constructor(polygons?: CsgPolygon[]) {
    if (polygons) this.build(polygons)
  }

  invert(): void {
    for (const polygon of this.polygons) polygon.flip()
    this.plane?.flip()
    this.front?.invert()
    this.back?.invert()
    const front = this.front
    this.front = this.back
    this.back = front
  }

  clipPolygons(polygons: CsgPolygon[]): CsgPolygon[] {
    if (!this.plane) return polygons.slice()

    let front: CsgPolygon[] = []
    let back: CsgPolygon[] = []
    for (const polygon of polygons) this.plane.split(polygon, front, back, front, back)

    if (this.front) front = this.front.clipPolygons(front)
    back = this.back ? this.back.clipPolygons(back) : []
    return front.concat(back)
  }

  clipTo(node: BspNode): void {
    this.polygons = node.clipPolygons(this.polygons)
    this.front?.clipTo(node)
    this.back?.clipTo(node)
  }

  allPolygons(): CsgPolygon[] {
    const out: CsgPolygon[] = []
    const stack: BspNode[] = [this]
    while (stack.length) {
      const node = stack.pop() as BspNode
      out.push(...node.polygons)
      if (node.front) stack.push(node.front)
      if (node.back) stack.push(node.back)
    }
    return out
  }

  /** Build the tree iteratively, so a deep tree cannot blow the call stack. */
  build(polygons: CsgPolygon[]): void {
    const stack: [BspNode, CsgPolygon[]][] = [[this, polygons]]
    while (stack.length) {
      const [node, list] = stack.pop() as [BspNode, CsgPolygon[]]
      if (!list.length) continue
      node.plane ||= list[0].plane.clone()

      const front: CsgPolygon[] = []
      const back: CsgPolygon[] = []
      for (const polygon of list)
        node.plane.split(polygon, node.polygons, node.polygons, front, back)

      if (front.length) {
        node.front ||= new BspNode()
        stack.push([node.front, front])
      }
      if (back.length) {
        node.back ||= new BspNode()
        stack.push([node.back, back])
      }
    }
  }
}

/** Turn part geometry into polygons, dropping degenerate triangles (`I`, `:314-332`). */
function geometryToPolygons(parts: { geometry: THREE.BufferGeometry; color: string }[]) {
  const polygons: CsgPolygon[] = []
  for (const { geometry, color } of parts) {
    const position = geometry.attributes.position
    for (let i = 0; i + 2 < position.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i)
      const b = new THREE.Vector3().fromBufferAttribute(position, i + 1)
      const c = new THREE.Vector3().fromBufferAttribute(position, i + 2)
      const plane = CsgPlane.from(a, b, c)
      if (plane) polygons.push(new CsgPolygon([a, b, c], color, plane))
    }
  }
  return polygons
}

/** Fan-triangulate polygons back into geometry, grouped by colour (`L`, `:333-353`). */
function polygonsToGeometry(polygons: CsgPolygon[]): {
  geometry: THREE.BufferGeometry
  color: string
}[] {
  const byColor = new Map<string, number[]>()
  for (const polygon of polygons) {
    if (!byColor.has(polygon.shared)) byColor.set(polygon.shared, [])
    const out = byColor.get(polygon.shared) as number[]
    const [first, ...rest] = polygon.vertices
    for (let i = 0; i + 1 < rest.length; i++) {
      out.push(first.x, first.y, first.z, rest[i].x, rest[i].y, rest[i].z)
      out.push(rest[i + 1].x, rest[i + 1].y, rest[i + 1].z)
    }
  }

  return [...byColor].map(([color, positions]) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
    return { geometry, color }
  })
}

/** `union` (`R`, `:354-361`). */
function csgUnion(a: BspNode, b: BspNode): BspNode {
  a.clipTo(b)
  b.clipTo(a)
  b.invert()
  b.clipTo(a)
  b.invert()
  a.build(b.allPolygons())
  return a
}

/** `subtract` (`z`, `:362-373`). */
function csgSubtract(a: BspNode, b: BspNode): BspNode {
  a.invert()
  a.clipTo(b)
  b.clipTo(a)
  b.invert()
  b.clipTo(a)
  b.invert()
  a.build(b.allPolygons())
  a.invert()
  return a
}

/** `intersect` (`B`, `:374-383`). */
function csgIntersect(a: BspNode, b: BspNode): BspNode {
  a.invert()
  b.clipTo(a)
  b.invert()
  a.clipTo(b)
  b.clipTo(a)
  a.build(b.allPolygons())
  a.invert()
  return a
}

const CSG_OPS = {
  union: csgUnion,
  subtract: csgSubtract,
  intersect: csgIntersect
} as const

/**
 * Run one boolean operation over per-child polygon lists (`U`, `:390-404`).
 *
 * The op folds left, empty children are filtered out, and a node whose children
 * all vanish produces nothing.
 */
function applyBoolean(
  op: string,
  children: { geometry: THREE.BufferGeometry; color: string }[][]
): { geometry: THREE.BufferGeometry; color: string }[] {
  const operation = CSG_OPS[op as keyof typeof CSG_OPS]
  if (!operation) throw Error(`unknown boolean operation "${op}"`)

  const lists = children.map((child) => geometryToPolygons(child)).filter((list) => list.length)
  if (!lists.length) return []

  let node = new BspNode(lists[0])
  for (const list of lists.slice(1)) node = operation(node, new BspNode(list))
  return polygonsToGeometry(node.allPolygons())
}

/* ── The model container ─────────────────────────────────────────────────── */

/** Count triangles in a geometry. */
function trianglesOf(geometry: THREE.BufferGeometry): number {
  return geometry.attributes.position.count / 3
}

/**
 * Fit a model under a triangle budget (`model-C3l0LP6n.js:777-805`).
 *
 * Merges vertices, then edge-collapses the **largest parts first**, at most
 * 8 passes. UVs are dropped on any simplified part, which is why a simplified
 * part renders flat-coloured — that is the documented behaviour (`08` §8.5),
 * not a bug, and `simplified` surfaces it on the report.
 *
 * Uses `three`'s `SimplifyModifier`, which is the same edge-collapse port the
 * original vendors (`model-C3l0LP6n.js:86-417`). `GLTFExporter` is what the
 * plan forbids, not this.
 */
export async function fitBudget(model: Model, limit: number): Promise<number> {
  const modifier = new SimplifyModifier()
  const trianglesNow = () => model.parts.reduce((n, p) => n + trianglesOf(p.geometry), 0)

  for (let pass = 0; pass < 8 && trianglesNow() > limit; pass++) {
    let remaining = trianglesNow() - limit + Math.ceil(limit * 0.01)
    const largestFirst = [...model.parts].sort(
      (a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count
    )

    for (const part of largestFirst) {
      if (remaining <= 0) break

      const source = part.geometry
      const vertices = source.attributes.position.count
      const count = Math.min(Math.ceil(remaining / 2) + 1, Math.floor(vertices * 0.5))
      if (count < 1) continue

      const simplified = await modifier.modify(source.clone(), count)
      const result = simplified.index ? simplified.toNonIndexed() : simplified
      if (countOpenEdges(result) === 0 && signedVolume(result) < 0) flipWinding(result)
      result.deleteAttribute('uv')
      result.computeVertexNormals()

      remaining -= trianglesOf(source) - trianglesOf(result)
      part.geometry = result
      model.simplified = true
    }
  }

  return trianglesNow()
}

/** `me(z, name)` — make a group name unique by suffixing a counter. */
function uniqueName(used: Map<string, number>, name: string): string {
  if (!used.has(name)) {
    used.set(name, 1)
    return name
  }
  let index = used.get(name) as number
  let candidate = `${name} ${index}`
  while (used.has(candidate)) {
    index++
    candidate = `${name} ${index}`
  }
  used.set(name, index + 1)
  used.set(candidate, 1)
  return candidate
}

/**
 * Build a model from a spec.
 *
 * Throws `ModelRejected` when the spec is invalid, and again when a boolean
 * exceeds the child-triangle cap. Both carry `.problems`, which is what the
 * design loop reads.
 */
export function buildSpec(spec: ModelSpec, options: BuildSpecOptions = {}): Model {
  const problems = validateSpec(spec)
  if (problems.length) throw new ModelRejected(problems)

  const params = paramValues(spec, options.params)
  const scalar = makeScalar(params)
  const tuple = makeTuple(params)
  const skipHidden = options.skipHidden ?? false

  const paletteNames = Object.keys(spec.palette)
  const palette: Record<string, string> = {}
  for (const [name, entry] of Object.entries(spec.palette)) {
    palette[name] = entry && typeof entry === 'object' ? (entry.tint ?? '#9a9a9a') : String(entry)
  }
  const fallbackColor = paletteNames[0]

  const model: Model = {
    name: spec.name ?? 'model',
    parts: [],
    groups: [],
    palette,
    health: { flipped: 0, dropped: 0, open: new Map() },
    simplified: false
  }
  if (spec.category === 'character') {
    model.rigSpec = { rig: spec.rig as string, skeleton: spec.skeleton ?? [] }
  }
  if (spec.motion?.clips) model.motion = spec.motion

  /** The sink `L`: repair (unless told not to) and append one part. */
  let currentNode = 0
  const sink = (
    geometry: THREE.BufferGeometry,
    color: string,
    { check = true }: { check?: boolean } = {}
  ) => {
    let out = geometry
    if (check) {
      const repaired = repairGeometry(geometry)
      out = repaired.geometry
      if (repaired.flipped) model.health.flipped++
      model.health.dropped += repaired.dropped
      if (repaired.open) {
        model.health.open.set(
          currentNode,
          (model.health.open.get(currentNode) ?? 0) + repaired.open
        )
      }
    }
    model.parts.push({
      geometry: out,
      color: paletteNames.includes(color) ? color : fallbackColor,
      node: currentNode
    })
  }

  /**
   * The recursive emitter `R`.
   *
   * `parent` is the accumulated matrix, `inherited` the colour a child takes
   * when it names none.
   */
  const emit = (
    node: SpecNode,
    parent: THREE.Matrix4,
    inherited: string | undefined,
    emitInto: (geometry: THREE.BufferGeometry, color: string, options?: { check?: boolean }) => void
  ) => {
    if (skipHidden && node.hidden) return

    const color = node.color ?? inherited
    const matrix = parent.clone().multiply(localMatrix(node, params))

    if (node.type === 'boolean') {
      // Each child is built into its own polygon list, not into the model.
      const children = (node.children ?? []).map((child) => {
        const collected: { geometry: THREE.BufferGeometry; color: string }[] = []
        emit(child, matrix, color, (geometry, childColor, options) => {
          collected.push({
            geometry: options?.check === false ? geometry : repairGeometry(geometry).geometry,
            color: childColor
          })
        })
        return collected
      })

      const childTriangles = children
        .flat()
        .reduce((total, child) => total + child.geometry.attributes.position.count / 3, 0)

      if (childTriangles > LIMITS.booleanTriangles) {
        throw new ModelRejected([
          `${node.op} boolean: its children have ${Math.round(childTriangles)} triangles, over the ` +
            `${LIMITS.booleanTriangles} a boolean can take; cut with boxes and cylinders, or move ` +
            'detail outside the boolean'
        ])
      }

      for (const part of applyBoolean(node.op as string, children)) {
        // CSG output is already manifold; re-winding it would be wrong.
        emitInto(part.geometry, part.color, { check: false })
      }
      return
    }

    if (node.type === 'mesh') {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(node.positions as number[]), 3)
      )
      emitInto(
        applyMatrix(geometry, matrix),
        color as string,
        node.open ? { check: false } : undefined
      )
      // A mesh's children take the *parent* matrix, not the mesh's own.
      for (const child of node.children ?? []) emit(child, parent, color, emitInto)
      return
    }

    if (node.type === 'template') {
      // Templates are built by the catalog, which needs the full palette. Until
      // it lands, a template node is rejected rather than silently skipped.
      throw new ModelRejected([
        `parts: template "${node.id}" is not available in this build; build it from primitives`
      ])
    }

    if (node.type !== 'group') {
      emitInto(applyMatrix(buildPrimitive(node, params), matrix), color as string)
      return
    }

    // A group: expand `array` then `mirror`, and recurse into children.
    const count = node.array ? Math.max(1, Math.round(scalar(node.array.count, 1))) : 1
    const placements: THREE.Matrix4[] = []
    for (let index = 0; index < count; index++) {
      let offset = new THREE.Matrix4()
      if (node.array?.radial) {
        offset = new THREE.Matrix4().makeRotationY((index / count) * Math.PI * 2)
      } else if (node.array) {
        const [x, y, z] = tuple(node.array.step, [0, 0, 0])
        offset = new THREE.Matrix4().makeTranslation(x * index, y * index, z * index)
      }
      placements.push(matrix.clone().multiply(offset))
    }

    const mirrors: (THREE.Vector3 | null)[] =
      node.mirror === 'x'
        ? [null, new THREE.Vector3(-1, 1, 1)]
        : node.mirror === 'z'
          ? [null, new THREE.Vector3(1, 1, -1)]
          : [null]

    for (const placement of placements) {
      for (const mirror of mirrors) {
        const next = mirror
          ? placement.clone().multiply(new THREE.Matrix4().makeScale(mirror.x, mirror.y, mirror.z))
          : placement
        for (const child of node.children ?? []) emit(child, next, color, emitInto)
      }
    }
  }

  const usedNames = new Map<string, number>()
  spec.parts.forEach((node, index) => {
    currentNode = index
    const first = model.parts.length
    emit(node, new THREE.Matrix4(), undefined, sink)
    for (const part of model.parts.slice(first)) part.node = index
    model.groups.push({
      node: index,
      name: uniqueName(usedNames, node.name ?? `Part ${index + 1}`),
      pivot: tuple(node.pivot ?? node.position, [0, 0, 0])
    })
  })

  return model
}

/**
 * The per-node local matrix `N` (`spec-D11M_y_m.js:781`): `T · R(XYZ, degrees) · S`.
 *
 * Rotation is **degrees** and Euler order is **XYZ**. A negative-determinant
 * scale flips the winding downstream, which `applyMatrix` handles.
 */
function localMatrix(node: SpecNode, params: ParamValues): THREE.Matrix4 {
  const scalar = makeScalar(params)
  const tuple = makeTuple(params)
  const degrees = Math.PI / 180

  const position = tuple(node.position, [0, 0, 0])
  const rotation = tuple(node.rotation, [0, 0, 0]).map((angle) => angle * degrees)
  const scale = Array.isArray(node.scale)
    ? tuple(node.scale, [1, 1, 1])
    : [scalar(node.scale, 1), scalar(node.scale, 1), scalar(node.scale, 1)]

  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(position as [number, number, number])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation as [number, number, number]))),
    new THREE.Vector3(...(scale as [number, number, number]))
  )
}

/**
 * Apply a matrix and normalise the result for the pipeline (`P`, `:782-789`).
 *
 * Always returns non-indexed geometry, and reverses the winding when the matrix
 * has a negative determinant — a mirror must not turn the model inside out.
 */
function applyMatrix(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const out = geometry.index ? geometry.toNonIndexed() : geometry
  out.applyMatrix4(matrix)
  if (matrix.determinant() < 0) flipWinding(out)
  return out
}

/**
 * Triangle-budget limits per category (`generator-BkAchkKU.js:111-121`).
 *
 * An accessory is capped at Roblox's 4000 with a 50-triangle margin; every
 * other category caps each part at the 20 000 per-mesh import limit.
 */
export const BUDGET_LIMITS = {
  accessory: 4000 - 50,
  other: 20000 - 50
} as const

/** Total triangles across a model. */
export function modelTriangles(model: Model): number {
  return model.parts.reduce((total, part) => total + trianglesOf(part.geometry), 0)
}

/** Bounding box of a model, in studs. */
export function modelBounds(model: Model): {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
} {
  const box = new THREE.Box3()
  for (const part of model.parts) {
    part.geometry.computeBoundingBox()
    if (part.geometry.boundingBox) box.union(part.geometry.boundingBox)
  }
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3())
  return {
    min: box.isEmpty() ? [0, 0, 0] : [box.min.x, box.min.y, box.min.z],
    max: box.isEmpty() ? [0, 0, 0] : [box.max.x, box.max.y, box.max.z],
    size: [size.x, size.y, size.z]
  }
}

/**
 * `build()` for the design loop: build, then fit the budget, then report.
 *
 * The `model` field is additive on `BuildResult`; `check` and `export` need the
 * built object, not the spec.
 */
export async function buildModel(
  spec: unknown,
  options: BuildSpecOptions = {}
): Promise<BuildResult & { model: Model }> {
  const model = buildSpec(spec as ModelSpec, options)

  const limit =
    (spec as ModelSpec).category === 'accessory' ? BUDGET_LIMITS.accessory : BUDGET_LIMITS.other
  await fitBudget(model, limit)

  const triangles = modelTriangles(model)
  const bounds = modelBounds(model)

  return {
    spec,
    model,
    report: {
      ok: true,
      issues: [],
      triangles,
      size: bounds.size,
      simplified: model.simplified,
      health: {
        flipped: model.health.flipped,
        dropped: model.health.dropped,
        open: [...model.health.open].map(([node, edges]) => ({ node, edges }))
      }
    }
  }
}
