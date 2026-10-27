/**
 * The scene, camera, lights and grid every generated artifact is shown in.
 *
 * Ported from RobloxKit's `ViewportCore` (`Viewport-D1Bi_VWL.js:1922-2403`),
 * minus what a read-only review surface does not need (picking, outlines, the
 * transform gizmo, the corner axis widget). The numbers are RobloxKit's, not
 * invented: fov 38, three lights, one procedural grid quad. They are what makes
 * the render read as a product shot rather than a debug view, so changing them
 * changes the look of every artifact at once.
 *
 * The class owns GPU resources and a DOM canvas, so it is deliberately not a
 * React component: React mounts it once into a div and calls `dispose()` on the
 * way out. A second instance per chat message would exhaust WebGL contexts.
 */

import {
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/** RobloxKit's house field of view (`Viewport-D1Bi_VWL.js:1950`). */
const FOV = 38
const NEAR = 0.05
const FAR = 2000

/** The three lights, with RobloxKit's colours and intensities. */
const HEMI_SKY = 0xf4f4f5
const HEMI_GROUND = 0x16181b
const HEMI_INTENSITY = 1.6
const KEY_COLOR = 0xffffff
const KEY_INTENSITY = 2.2
const KEY_POSITION = [4, 9, 6] as const
const RIM_COLOR = 0x9fb4ff
const RIM_INTENSITY = 0.6
const RIM_POSITION = [-6, 4, -5] as const

/** The grid's base colour and fade radius. */
const GRID_COLOR = 0x8a8f99
const GRID_FADE = 60

/** The floor disc under the grid. */
const FLOOR_COLOR = 0x1b1d21
const FLOOR_OPACITY = 0.85

/**
 * The grid: one quad, lines drawn in the fragment shader.
 *
 * `fwidth` keeps every line one pixel wide at any zoom, which is the whole
 * reason this looks infinite without tiling geometry. Two octaves (1x at 28%
 * alpha, 10x at 55%) give the major/minor read, and the two world axes are
 * tinted inside the same shader so no extra geometry is needed.
 */
const GRID_VERTEX = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const GRID_FRAGMENT = `
uniform float uSize;
uniform float uFade;
uniform vec3 uColor;
uniform vec3 uCenter;
varying vec3 vWorld;
float lines(float size) {
  vec2 r = vWorld.xz / size;
  vec2 g = abs(fract(r - 0.5) - 0.5) / fwidth(r);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  float d = distance(uCenter.xz, vWorld.xz);
  float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
  float a = max(lines(uSize) * 0.28, lines(uSize * 10.0) * 0.55) * fade;
  vec3 col = uColor;
  vec2 fw = fwidth(vWorld.xz);
  float onX = 1.0 - min(abs(vWorld.z) / (fw.y * 1.5), 1.0);
  float onZ = 1.0 - min(abs(vWorld.x) / (fw.x * 1.5), 1.0);
  if (onX > 0.0) { col = mix(col, vec3(0.93, 0.27, 0.33), onX); a = max(a, onX * 0.9 * fade); }
  if (onZ > 0.0) { col = mix(col, vec3(0.27, 0.52, 0.98), onZ); a = max(a, onZ * 0.9 * fade); }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`

/** Where the camera looks from, by name (`Viewport-D1Bi_VWL.js` `f`/`He`). */
export const VIEW_DIRECTIONS = {
  front: [0, 0.12, 1],
  back: [0, 0.12, -1],
  left: [1, 0.12, 0.15],
  right: [-1, 0.12, 0.15],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  '3/4': [0.65, 0.22, 1]
} as const

export type ViewDirection = keyof typeof VIEW_DIRECTIONS

/** How far the camera may travel, relative to the framed distance. */
export interface ZoomLimits {
  min: number
  max: number
}

/**
 * The grid's cell size for a given camera distance.
 *
 * Snaps in decades, so the grid re-scales by 10x instead of continuously: the
 * quad stays 1x1 and the shader does the work.
 */
function gridStep(distance: number): number {
  return 10 ** Math.floor(Math.log10(Math.max(0.5, distance) / 6))
}

/** The sphere that encloses `objects`, skipping anything invisible. */
function boundsOf(objects: readonly Group[]): Sphere {
  const box = new Box3()
  let any = false
  for (const object of objects) {
    object.traverseVisible((child) => {
      if ((child as Mesh).isMesh) {
        box.expandByObject(child)
        any = true
      }
    })
  }
  if (!any) return new Sphere(new Vector3(0, 2, 0), 2)
  const sphere = box.getBoundingSphere(new Sphere())
  if (sphere.radius < 0.001) sphere.radius = 2
  return sphere
}

export interface ViewportOptions {
  /** The CSS class the host div carries, for the backdrop. */
  className?: string
}

/**
 * A live 3D view of whatever `Object3D` graph it is given.
 *
 * Construct it with a host `div`; it appends its own canvas. Everything it
 * allocates is released by `dispose()`, which the React wrapper calls.
 */
export class ArtifactViewport {
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controls: OrbitControls
  /** User geometry. Only this group is framed and (later) raycast. */
  readonly content = new Group()
  /** Overlays that must not be framed: the grid and the floor. */
  readonly helpers = new Group()

  private readonly renderer: WebGLRenderer
  private readonly host: HTMLElement
  private readonly grid: Mesh<PlaneGeometry, ShaderMaterial>
  private readonly floor: Mesh<CircleGeometry, MeshStandardMaterial>
  private readonly resize: ResizeObserver
  private frameHandle = 0
  private pending = false
  private disposed = false
  private limits: ZoomLimits = { min: 0.5, max: 100 }

  constructor(host: HTMLElement, options: ViewportOptions = {}) {
    this.host = host
    if (options.className) host.classList.add(options.className)

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = 'srgb'
    host.appendChild(this.renderer.domElement)

    this.camera = new PerspectiveCamera(FOV, 1, NEAR, FAR)
    this.camera.position.set(6, 4, 10)

    this.scene.add(new HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY))
    const key = new DirectionalLight(KEY_COLOR, KEY_INTENSITY)
    key.position.set(...KEY_POSITION)
    const rim = new DirectionalLight(RIM_COLOR, RIM_INTENSITY)
    rim.position.set(...RIM_POSITION)
    this.scene.add(key, rim)

    this.grid = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: GRID_VERTEX,
        fragmentShader: GRID_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uSize: { value: 1 },
          uFade: { value: GRID_FADE },
          uColor: { value: new Color(GRID_COLOR) },
          uCenter: { value: new Vector3() }
        }
      })
    )
    this.grid.rotation.x = -Math.PI / 2
    this.grid.renderOrder = -100
    this.grid.frustumCulled = false
    this.grid.name = 'viewport-grid'

    this.floor = new Mesh(
      new CircleGeometry(1, 64),
      new MeshStandardMaterial({
        color: FLOOR_COLOR,
        roughness: 1,
        transparent: true,
        opacity: FLOOR_OPACITY,
        depthWrite: false
      })
    )
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.y = -0.002
    this.floor.renderOrder = -101
    this.floor.visible = false

    this.scene.add(this.grid, this.floor, this.content, this.helpers)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableZoom = false
    this.controls.enablePan = true
    this.controls.addEventListener('change', () => this.requestRender())

    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false })

    this.resize = new ResizeObserver(() => this.applySize())
    this.resize.observe(host)
    this.applySize()
  }

  /** Replace what is on show and frame it. */
  show(objects: Group[], direction: ViewDirection = '3/4'): void {
    this.content.clear()
    for (const object of objects) this.content.add(object)
    this.frame(objects, direction)
  }

  /** Point the camera at `objects` from `direction`, at a fitting distance. */
  frame(objects: readonly Group[], direction: ViewDirection = '3/4'): void {
    const sphere = boundsOf(objects)
    const halfV = (FOV * Math.PI) / 360
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect)
    const distance = (sphere.radius / Math.sin(Math.min(halfV, halfH))) * 1.12

    const dir = new Vector3(...VIEW_DIRECTIONS[direction]).normalize()
    this.controls.target.copy(sphere.center)
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance)
    this.camera.near = Math.max(0.01, distance / 500)
    this.camera.far = Math.max(FAR, distance * 40)
    this.camera.updateProjectionMatrix()
    this.floor.scale.setScalar(Math.max(4, sphere.radius * 2.2))
    this.limits = {
      min: Math.max(0.05, Math.min(distance * 0.25, sphere.radius * 1.2)),
      max: distance * 6
    }
    this.controls.update()
    this.requestRender()
  }

  /** Look from `direction` without changing the distance. */
  view(direction: ViewDirection): void {
    const distance = this.distance()
    const dir = new Vector3(...VIEW_DIRECTIONS[direction]).normalize()
    this.camera.position.copy(this.controls.target).addScaledVector(dir, distance)
    this.controls.update()
    this.requestRender()
  }

  /** Turn the model slowly, the way RobloxKit's `spin` does. */
  setSpin(on: boolean): void {
    this.controls.autoRotate = on
    this.controls.autoRotateSpeed = 1.6
    if (on) this.startLoop()
    else this.requestRender()
  }

  /** Show or hide the grid. */
  setGrid(visible: boolean): void {
    this.grid.visible = visible
    this.requestRender()
  }

  /** Show or hide the floor disc. */
  setFloor(visible: boolean): void {
    this.floor.visible = visible
    this.requestRender()
  }

  /** The distance from the camera to what it is looking at. */
  distance(): number {
    return this.camera.position.distanceTo(this.controls.target)
  }

  /** Draw one frame, coalescing repeat requests into a single animation frame. */
  requestRender(): void {
    if (this.pending || this.disposed) return
    this.pending = true
    this.frameHandle = requestAnimationFrame(() => {
      this.pending = false
      this.render()
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameHandle)
    this.resize.disconnect()
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    this.controls.dispose()
    this.grid.geometry.dispose()
    this.grid.material.dispose()
    this.floor.geometry.dispose()
    this.floor.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.host.classList.remove('artifact-viewport')
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const step =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * 400
          : event.deltaY
    const scale = Math.exp(step * (event.ctrlKey ? 0.01 : 0.0015))
    const wanted = Math.min(this.limits.max, Math.max(this.limits.min, this.distance() * scale))
    const dir = new Vector3().subVectors(this.camera.position, this.controls.target).normalize()
    this.camera.position.copy(this.controls.target).addScaledVector(dir, wanted)
    this.controls.update()
    this.requestRender()
  }

  private startLoop(): void {
    const tick = (): void => {
      if (this.disposed || !this.controls.autoRotate) return
      this.controls.update()
      this.render()
      this.frameHandle = requestAnimationFrame(tick)
    }
    cancelAnimationFrame(this.frameHandle)
    this.frameHandle = requestAnimationFrame(tick)
  }

  private render(): void {
    if (this.disposed) return
    const distance = this.distance()
    const uniforms = this.grid.material.uniforms
    uniforms.uSize.value = gridStep(distance)
    uniforms.uFade.value = Math.max(20, distance * 6)
    uniforms.uCenter.value.copy(this.controls.target)
    this.grid.scale.setScalar(uniforms.uFade.value * 2.2)
    this.grid.position.set(this.controls.target.x, 0, this.controls.target.z)
    this.grid.visible = this.grid.visible && uniforms.uFade.value > 0
    this.renderer.render(this.scene, this.camera)
  }

  private applySize(): void {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }
}
