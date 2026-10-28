# RobloxKit 3D Viewport — A Reusable, Global Rendering System

**Source analysed (read-only):** `C:\Users\Novella\Documents\Github\Robloxkit\artifacts\frontend_unmin\`
**Secondary source (CSS only, minified build has no `.css`):** `C:\Users\Novella\Documents\Github\Robloxkit\artifacts\frontend_src\assets\*.css`
**Three.js build used:** `three.module-Bt_xI7Zm.js` (963,993 bytes; exports mangled names, resolved below by matching the `export {…}` table at offset 962,957 against class declarations).

> All `file:line` citations are 1-based line numbers in the `frontend_unmin` bundle.
> Decimal integers in `three` colour arguments are `0xRRGGBB`; both hex and decimal are given throughout.

---

## 0. TL;DR

RobloxKit has **one** 3D viewport engine. It lives in `Viewport-D1Bi_VWL.js` as a **plain ES class** (`ht`, 482 lines, `Viewport-D1Bi_VWL.js:1922-2403`) wrapped by **one** React component (`_t`, `Viewport-D1Bi_VWL.js:2407-2544`). A thin React convenience wrapper `Preview3D` (`Preview3D-CIiMrTBA.js:7-73`) adds the mannequin and the "spin" behaviour.

The engine is **not clothing-specific**: it knows nothing about avatars. It accepts an arbitrary `Object3D` graph through a `content` prop, auto-frames it, and offers orbit/zoom/pan, grid, floor, wireframe, bounds, selection outlines, raycast picking/hover, and a transform gizmo. Six panels plus the clothing panel use it.

| Layer | File | Kind | Size |
|---|---|---|---|
| Engine class `ViewportCore` | `Viewport-D1Bi_VWL.js:1922` | plain `class` | 482 lines |
| React wrapper `Viewport` | `Viewport-D1Bi_VWL.js:2407` | `forwardRef` fn component | 137 lines |
| React wrapper `Preview3D` | `Preview3D-CIiMrTBA.js:7` | `forwardRef` fn component | 67 lines |
| Mannequin builder `buildAvatar` | `avatar-CSK-yHJ2.js:157` | pure function | 164 lines |
| Offscreen capture | `avatarRender-DVeE1evW.js:1-97` | module functions | 97 lines |

---

## 1. Component hierarchy

### 1.1 The three layers

```
Panel (React, e.g. ClothingPanel)
  └── <Preview3D object mannequin target radius direction viewKey spin label version onFrame selection outlines onPick onHover gizmo …/>
        └── <Viewport content frameKey frameDirection animate selection outlines onPick onHover gizmo version label/>
              └── <div class="vp vp--dark preview3d" tabindex=0 role=application>
                    ├── <div class="vp__canvas" ref={hostRef}/>     ← the WebGL canvas is appended here imperatively
                    └── <div class="vp__toolbar"> … built-in buttons … </div>
                          └── ViewportCore (plain class, owns renderer/scene/camera/controls/gizmo)
```

Panels that need deeper access (Skybox, VFX, Cutscene, Animation, Texture) **bypass `Preview3D` and mount `Viewport` directly**, then reach the class instance through the imperative handle:

```js
// Viewport-D1Bi_VWL.js:2478-2483
(0, M.useImperativeHandle)(ee, () => ({
  frame: e => b.current?.frame(e),
  frameSelected: () => T(),
  view: e => b.current?.view(e),
  core: () => b.current
}));
```

`core()` is the escape hatch used by 6 files (`grep '\.core\(\)'`): `AnimationPanel` ×1, `CutscenePanel` ×2, `Preview3D` ×2, `SkyboxPanel` ×1, `TexturePanel` ×1, `VfxPanel` ×4.

### 1.2 What is React and what is not

* **Not React:** everything that touches WebGL. `ViewportCore` (`Viewport-D1Bi_VWL.js:1922`) is a plain class constructed once in a `useEffect` with an empty dependency array (`:2442-2454`). It owns the renderer, scene, camera, controls, gizmo, ResizeObserver, rAF handles, and all event listeners. It never re-renders on React state.
* **React:** the `<div class="vp">` chrome, the toolbar buttons, the keyboard handler, and the declarative prop→method synchronisation (each prop gets its own `useEffect` calling a setter on the core).

```js
// Viewport-D1Bi_VWL.js:2442-2454  — core created exactly once per mount
(0, M.useEffect)(() => {
  let e = new ht(y.current, {
    onPick: (e, t) => x.current.onPick?.(e, t),
    onHover: (e, t) => x.current.onHover?.(e, t),
    onTransform: e => x.current.onTransform?.(e),
    onTransformEnd: e => x.current.onTransformEnd?.(e)
  });
  b.current = e;
  return () => {
    e.dispose();
    b.current = null;
  };
}, []);
```

Note the **callback indirection**: `x.current` is re-assigned on every render (`Viewport-D1Bi_VWL.js:2429-2434`), so the class always calls the *latest* prop callbacks without being recreated. This is the key trick that makes the class long-lived and the React layer cheap.

### 1.3 The prop→method synchronisation table

Every declarative prop maps to one imperative setter. This table *is* the public API contract:

| Prop | Effect body | Line |
|---|---|---|
| `content` | `b.current?.setContent(e)` | `2455-2457` |
| `frameKey` | `b.current?.frame(null, Array.isArray(n) ? n : ct[n] ?? null)` | `2458-2462` |
| `animate` | `b.current?.setAnimation(a)` | `2463-2465` |
| `selection` / `outlines` | `b.current?.setSelection(s ? o : [])` | `2466-2468` |
| `gizmo` | `b.current?.setGizmo(u?.object ?? null, u ?? {})` | `2469-2471` |
| `viewport.options` (persisted) | `b.current?.setOptions(S)` | `2472-2474` |
| `version` | `b.current?.requestRender()` | `2475-2477` |
---

## 2. Constructor — `ViewportCore` (`Viewport-D1Bi_VWL.js:1922-2047`)

### 2.1 Renderer

```js
// Viewport-D1Bi_VWL.js:1938-1947
let o = new de({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true
});
o.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
o.outputColorSpace = D;      // D === `srgb`  (three export `kt` -> Ze = "srgb", three.module:13516)
o.autoClear = false;
e.appendChild(o.domElement);
this.renderer = o;
```

| Option | Value | Why it matters |
|---|---|---|
| `antialias` | `true` | MSAA on the default framebuffer |
| `alpha` | `true` | The CSS `.vp` background (`--color-viewport: #0e0f13`, `.vp--light`, `.vp--checker`) shows through — **there is no `scene.background`** |
| `preserveDrawingBuffer` | `true` | Allows `canvas.toDataURL()` / `toBlob()` screen capture from the live canvas |
| `setPixelRatio` | `min(devicePixelRatio, 2)` | Hard DPR cap at 2 |
| `outputColorSpace` | `'srgb'` | sRGB output transform |
| `autoClear` | `false` | **Required**: the render loop draws the scene, then `clearDepth()` + a second `render()` for the axis widget (see §5.3). If `autoClear` were true the second pass would wipe the first. |
| `toneMapping` | *not set* | Default `NoToneMapping`. Offscreen capture (`avatarRender`) also leaves it default. |
| `shadowMap` | *not enabled* | Enabled only by `SkyboxPanel` at runtime (`SkyboxPanel-Dol3AjLh.js:215-216`) |

**Scene background:** never assigned. `grep '\.background'` over `Viewport-D1Bi_VWL.js` returns nothing. The backdrop is a **CSS** concern:

```css
/* frontend_src/assets/Viewport-Dok-fWD-.css:1 */
.vp{…background:var(--vp-bg);--vp-bg:var(--color-viewport);…}
.vp--light{--vp-bg:var(--color-viewport-light)}
.vp--checker{--vp-bg:var(--color-checker-b);background-image:linear-gradient(45deg, var(--color-checker-a) 25%, transparent 25%), …}
```
with tokens from `index-BYCtJRfu.css`: `--color-viewport:#0e0f13; --color-viewport-light:#dfe2e7; --color-viewport-light-ink:#3a3d44; --color-checker-a:#1f2025; --color-checker-b:#16171b;`

### 2.2 Camera

```js
// Viewport-D1Bi_VWL.js:1950-1952
let l = new ae(38, 1, 0.05, 2000);   // ae === PerspectiveCamera
l.position.set(6, 4, 10);
this.camera = l;
```

| Field | Value |
|---|---|
| type | `PerspectiveCamera` |
| `fov` | **38°** |
| `aspect` | `1` (overwritten immediately by `resize()`) |
| `near` | `0.05` |
| `far` | `2000` |
| `position` | `(6, 4, 10)` |
| `lookAt` / target | *not set here* — `OrbitControls.update()` at `:149` of the vendored controls (`Viewport-D1Bi_VWL.js:2010`, `De` ctor calls `this.update()`) aims the camera at `controls.target`, which is `(0,0,0)` |

Both `near` and `far` are **mutated later** by `frame()` (`:2227-2228`) and can be overridden by consumers (`CutscenePanel-vZ21pbBO.js:302-305` sets `near = 0.1`, `far = max(far, 5000)`).

### 2.3 Lights — exactly two

```js
// Viewport-D1Bi_VWL.js:1953-1958
s.add(new m(16053493, 1447963, 1.6));       // HemisphereLight(skyColor, groundColor, intensity)
let f = new d(16777215, 2.2);               // DirectionalLight(color, intensity)
f.position.set(4, 9, 6);
let p = new d(10466559, 0.6);               // DirectionalLight(color, intensity)
p.position.set(-6, 4, -5);
s.add(f, p);
```

| # | Class | Colour (dec) | Colour (hex) | Intensity | Position |
|---|---|---|---|---|---|
| 1 | `HemisphereLight` (`m` → three `zf`) | sky `16053493` / ground `1447963` | sky `#F4F4F5` / ground `#16181B` | `1.6` | n/a (uses world up) |
| 2 | `DirectionalLight` (`d` → three `Qf`) | `16777215` | `#FFFFFF` | `2.2` | `(4, 9, 6)` |
| 3 | `DirectionalLight` (`d` → three `Qf`) | `10466559` | `#9FB4FF` (cool blue rim) | `0.6` | `(-6, 4, -5)` |

There is **no** `AmbientLight`, **no** shadow-casting light, and **no** `scene.environment` in the base engine. `SkyboxPanel` adds its own (`SkyboxPanel-Dol3AjLh.js:225-242`): `HemisphereLight(16777215, 4473924, 1)`, `AmbientLight(16777215, 0.2)`, and a shadow-casting `DirectionalLight(16777215, 2)` with a 512² shadow map, ±12 ortho frustum, `bias = -0.0005`.

### 2.4 Infinite grid — custom `ShaderMaterial`

Geometry is a single 1×1 `PlaneGeometry` (`S` → three `aa`), scaled at render time to fill the fade radius. This is the whole trick: **the grid is not tiled geometry, it is a procedural shader on one quad**.

```js
// Viewport-D1Bi_VWL.js:1959-1984
this.grid = new O(new S(1, 1), new u({
  vertexShader: lt,
  fragmentShader: ut,
  transparent: true,
  depthWrite: false,
  side: 2,
  uniforms: {
    uSize:   { value: 1 },
    uFade:   { value: 60 },
    uColor:  { value: new x(9080729) },   // Color(#8A8F99)
    uCenter: { value: new b() }           // Vector3
  }
}));
this.grid.rotation.x = -Math.PI / 2;
this.grid.renderOrder = -100;
this.grid.frustumCulled = false;
this.grid.name = `viewport-grid`;
s.add(this.grid);
```

**Vertex shader (verbatim, `Viewport-D1Bi_VWL.js:1831-1837`):**

```glsl
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
```

**Fragment shader (verbatim, `Viewport-D1Bi_VWL.js:1838-1861`):**

```glsl
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
```

Design notes an implementer must preserve:

1. **Screen-space derivative lines.** `fwidth(r)` gives a constant ~1px line width at any zoom/distance. `abs(fract(r-0.5)-0.5)` is the anti-aliased "distance to nearest integer" trick.
2. **Two octaves.** `lines(uSize)*0.28` (minor, 28% alpha) and `lines(uSize*10)*0.55` (major, 55% alpha) — a 10× grid ratio.
3. **Radial fade** around `uCenter.xz` from `0.35*uFade` to `uFade`.
4. **Coloured world axes** drawn *inside* the grid shader: X axis (where `vWorld.z ≈ 0`) → `vec3(0.93, 0.27, 0.33)` ≈ `#ED4554`; Z axis (where `vWorld.x ≈ 0`) → `vec3(0.27, 0.52, 0.98)` ≈ `#4585FA`. Alpha is boosted to `0.9 * fade` on the axis.
5. **`discard` when `a < 0.01`** to avoid blending invisible fragments.
6. `side: 2` = `DoubleSide` so the plane is visible from below; `depthWrite: false` + `renderOrder: -100` means it never occludes and always draws first.

**Uniforms are driven per-frame from the camera distance** (`:2087-2093`):

```js
let r = n.position.distanceTo(this.controls.target);
let i = this.grid.material.uniforms;
i.uSize.value  = dt(r);                          // power-of-ten step
i.uFade.value  = Math.max(20, r * 6);
i.uCenter.value.copy(this.controls.target);
this.grid.scale.setScalar(i.uFade.value * 2.2);
this.grid.position.set(this.controls.target.x, 0, this.controls.target.z);
this.grid.visible = this.options.grid;
```

with the LOD step function (`:1862-1864`):

```js
function dt(e) {
  return 10 ** Math.floor(Math.log10(Math.max(0.5, e) / 6));
}
```

So at camera distance 10 the minor cell is `10^floor(log10(1.667)) = 10^0 = 1` unit; at distance 100 it becomes `10^1 = 10`. The grid *snaps* in decades — that is the "infinite" behaviour: geometry stays 1×1, scale grows, `uSize` grows, and `fwidth` keeps lines hairline-thin.

### 2.5 Floor

```js
// Viewport-D1Bi_VWL.js:1985-1996
this.floor = new O(new ie(1, 64), new ue({
  color: 1776929,
  roughness: 1,
  transparent: true,
  opacity: 0.85,
  depthWrite: false
}));
this.floor.rotation.x = -Math.PI / 2;
this.floor.position.y = -0.002;
this.floor.renderOrder = -101;
this.floor.visible = false;
s.add(this.floor);
```

| Field | Value |
|---|---|
| Geometry | `CircleGeometry(radius = 1, segments = 64)` (`ie` → three `Lu`) |
| Material | `MeshStandardMaterial` (`ue` → three `qd`) |
| Colour | `1776929` = `#1B1D21` |
| Roughness | `1` (fully diffuse) |
| Opacity | `0.85`, `transparent: true` |
| `depthWrite` | `false` |
| Y | `-0.002` (just under the grid so no z-fight) |
| `renderOrder` | `-101` (behind the grid's `-100`) |
| Default visibility | `false` |

Scaled by `frame()` (`:2231`): `this.floor.scale.setScalar(Math.max(4, i * 2.2));` where `i` is the bounding-sphere radius. Toggled by the `floor` option (`:2192`).

### 2.6 The three scene groups

```js
// Viewport-D1Bi_VWL.js:1997-2001
this.content = new c();      // Group — user content only
this.content.name = `content`;
s.add(this.content);
this.helpers = new c();      // Group — outlines, bounds helper
s.add(this.helpers);
```

`content` is deliberately separated so that:
* raycasting only tests user geometry (`this.content.children`, `:2355`),
* framing only measures user geometry (`ft(this.content.children)`, `:2099`),
* outlines/bounds are not pickable and not framed.

### 2.7 The axis/orientation widget (corner gizmo)

```js
// Viewport-D1Bi_VWL.js:1892-1921
function mt() {
  let e = new se();                                    // Scene
  let t = [[`X`, [1, 0, 0], 15615316], [`Y`, [0, 1, 0], 7128938], [`Z`, [0, 0, 1], 4556282]];
  let n = [];
  for (let [r, i, a] of t) {
    let t = new b(...i);
    let o = new g(new pe().setFromPoints([new b(), t.clone().multiplyScalar(0.8)]), new ee({ color: a }));
    let s = new O(new h(0.17, 16, 12), new k({ color: a }));   // SphereGeometry(0.17, 16, 12) + MeshBasicMaterial
    s.position.copy(t);
    s.userData.view = r === `X` ? `right` : r === `Y` ? `top` : `front`;
    let c = new O(new h(0.11, 12, 8), new k({ color: a, transparent: true, opacity: 0.45 }));
    c.position.copy(t).multiplyScalar(-1);
    c.userData.view = r === `X` ? `left` : r === `Y` ? `bottom` : `back`;
    e.add(o, s, c);
    n.push(s, c);
  }
  return {
    scene: e,
    camera: new ne(-1.4, 1.4, 1.4, -1.4, 0.1, 10),   // OrthographicCamera
    pick: n
  };
}
```

| Axis | Positive colour | Negative colour |
|---|---|---|
| X | `15615316` = `#EE4554` (red) | same, `opacity 0.45` |
| Y | `7128938` = `#6CC76A` (green) | same, `opacity 0.45` |
| Z | `4556282` = `#4585FA` (blue) | same, `opacity 0.45` |

Note the X/Z colours match the grid shader axis colours exactly (`#ED4554`/`#4585FA` in GLSL float form vs `#EE4554`/`#4585FA` here). Sphere radius `0.17` for the positive cap, `0.11` for the negative cap; line stubs to `0.8`.

Ortho camera frustum: `left -1.4, right 1.4, top 1.4, bottom -1.4, near 0.1, far 10`. `this.axisSize = 76`, `this.axisTop = 48` (`:2040-2041`) — the widget is a **76×76 px square inset 8 px from the right edge and `48+76` px from the top**.

Clicking it raycasts against `axes.pick` and calls `this.view(userData.view)` (`:2288-2299`).

### 2.8 Selection outline

`te` → three `Im` = **`BoxHelper`** (`three.module` 951,970). Not a post-process outline — a wireframe bounding box per selected object:

```js
// Viewport-D1Bi_VWL.js:2155-2166
for (let n of e) {
  let e = t.get(n);
  if (!e) { continue; }
  let r = new te(e, 16753981);         // BoxHelper(object, 0xFFA53D)
  r.material.depthTest = false;
  r.material.transparent = true;
  r.renderOrder = 999;
  this.helpers.add(r);
  this.outlines.push(r);
}
```

Outline colour `16753981` = **`#FFA53D`** (amber). `depthTest: false` + `renderOrder: 999` → the box draws on top of everything, always visible. Updated every frame: `for (let e of this.outlines) { e.update?.(); }` (`:2095-2097`).

### 2.9 Bounds helper

```js
// Viewport-D1Bi_VWL.js:2193-2200
if (this.options.bounds && !this.boundsHelper) {
  this.boundsHelper = new le(new C(), 8226708);   // Box3Helper(Box3, 0x7D8794)
  this.helpers.add(this.boundsHelper);
} else if (!this.options.bounds && this.boundsHelper) {
  this.helpers.remove(this.boundsHelper);
  this.boundsHelper.dispose?.();
  this.boundsHelper = null;
}
```
Colour `8226708` = **`#7D8794`**. Its box is recomputed each frame from live content bounds (`:2098-2100`).

### 2.10 Full constructor field order

For reimplementation, the exact construction order matters (controls are created *after* the camera and *before* `resize()`):

1. renderer → append canvas
2. scene
3. camera (38/1/0.05/2000 @ 6,4,10)
4. hemisphere + 2 directional lights
5. grid mesh + material
6. floor mesh + material
7. `content` group
8. `helpers` group
9. `outlines = []`, `boundsHelper = null`, `options = {grid:true, floor:false, wireframe:false, bounds:false}`
10. `OrbitControls(camera, renderer.domElement)` — `enableZoom=false`, `enablePan=true`, `change` → `requestRender()`
11. `limits = { min: 0.05, max: 1000 }`
12. `TransformControls(camera, renderer.domElement)` — `setSize(0.85)`, `dragging-changed` → disable orbit, `objectChange` → `onTransform` + render
13. `gizmoHelper = gizmo.getHelper()` added to scene
14. `axes = mt()`, `axisSize = 76`, `axisTop = 48`
15. `_listen()` — pointer/wheel/dblclick handlers
16. `ResizeObserver` → `resize()`
17. `resize()`
---

## 3. Controls

### 3.1 OrbitControls — which build and every setting

`De` (`Viewport-D1Bi_VWL.js:61`) extends `w` (three `Gm` = `Controls` base) and is a **vendored copy of three.js `examples/jsm/controls/OrbitControls.js`** (modern pointer-events version — it has `_pointers`, `_pointerPositions`, `zoomToCursor`, `minTargetRadius`/`maxTargetRadius`, `_interceptControlDown`, i.e. r160+).

Construction (`Viewport-D1Bi_VWL.js:2010-2017`):

```js
let h = new De(l, o.domElement);
h.enableZoom = false;
h.enablePan = true;
h.addEventListener(`change`, () => {
  this.requestRender();
  this.cb.onViewChange?.();
});
this.controls = h;
```

**Only two properties are overridden from defaults.** Everything else is stock. The stock defaults are listed here because they are the effective configuration:

| Property | Value | Overridden? | Line (default decl.) |
|---|---|---|---|
| `enabled` | `true` | no | `:65` |
| `target` | `Vector3(0,0,0)` | no | `:66` |
| `minDistance` | `0` | no | `:68` |
| `maxDistance` | `Infinity` | no | `:69` |
| `minZoom` / `maxZoom` | `0` / `Infinity` | no | `:70-71` |
| `minTargetRadius` | `0` | no | `:72` |
| `maxTargetRadius` | `Infinity` | no | `:73` |
| `minPolarAngle` | `0` | no | `:74` |
| `maxPolarAngle` | `Math.PI` | no | `:75` |
| `minAzimuthAngle` | `-Infinity` | no | `:76` |
| `maxAzimuthAngle` | `Infinity` | no | `:77` |
| **`enableDamping`** | **`false`** | no | `:78` |
| `dampingFactor` | `0.05` (unused while damping off) | no | `:79` |
| **`enableZoom`** | **`false`** | **YES** | `:2011` |
| `zoomSpeed` | `1` | no | `:81` |
| `enableRotate` | `true` | no | `:82` |
| `rotateSpeed` | `1` | no | `:83` |
| **`enablePan`** | `true` | **YES (redundant)** | `:2012` |
| `panSpeed` | `1` | no | `:85` |
| `screenSpacePanning` | `true` | no | `:86` |
| `keyPanSpeed` | `7` | no | `:87` |
| `zoomToCursor` | `false` | no | `:88` |
| `autoRotate` | `false` | no (set by `Preview3D` for `spin`) | `:89` |
| `autoRotateSpeed` | `2` | no (overridden to `1.6` by `Preview3D`) | `:90` |
| `keys` | `{LEFT:'ArrowLeft', UP:'ArrowUp', RIGHT:'ArrowRight', BOTTOM:'ArrowDown'}` | no | `:91-96` |
| `mouseButtons` | `{LEFT: ROTATE, MIDDLE: DOLLY, RIGHT: PAN}` | no | `:97-101` |
| `touches` | `{ONE: ROTATE, TWO: DOLLY_PAN}` | no | `:102-105` |

**Critical consequences of these settings:**

1. **`enableDamping = false`** → rotation is instantaneous (no inertia). `update()` sets `_sphericalDelta` to zero after each apply (`:274-275`).
2. **`enableZoom = false`** → the built-in wheel dolly is dead. Zoom is handled by the viewport's own wheel listener (`:2257-2266`), which calls `zoomTo()` → moves `camera.position` along the target→camera vector. This gives **absolute distance clamping** (`limits.min/max`) that `minDistance`/`maxDistance` alone cannot do, and lets the viewport know the new distance to recompute grid LOD.
3. **`enablePan = true`** with `screenSpacePanning = true` → right-drag pans in screen space.
4. `enableRotate` left on → **left-drag rotates**; but `_handleMouseDownRotate` is bypassed when `ctrlKey || metaKey || shiftKey` (`:726-731`), in which case LEFT becomes PAN. Right button (PAN) does the inverse (`:740-753`). So the modifiers *swap* left/right semantics.
5. `minPolarAngle = 0` / `maxPolarAngle = Math.PI` → **no gimbal clamp**; you can go fully over the top and under the floor.
6. `change` event fires only when the camera actually moved, using an epsilon test (`:326-334`): `distanceToSquared > 1e-6` on position, `(1 - quaternion.dot)*8 > 1e-6`, or target moved. That is what gates `requestRender()` — the render loop is on-demand.

### 3.2 Wheel / pinch zoom (viewport-owned)

```js
// Viewport-D1Bi_VWL.js:1799-1815
function at(e, t) {                                   // limits from radius
  return {
    min: Math.max(0.05, Math.min(e * 0.25, t * 1.2)),
    max: e * 6
  };
}
function ot(e, t, { min: n, max: r }, { pinch: i = false, deltaMode: a = 0 } = {}) {
  let o = a === 1 ? t * 16 : a === 2 ? t * 400 : t;
  let s = Math.exp(o * (i ? 0.01 : 0.0015));
  return Math.min(r, Math.max(n, e * s));
}
function st(e, { min: t, max: n }) { return Math.min(n, Math.max(t, e)); }
```

```js
// Viewport-D1Bi_VWL.js:2256-2266
this._wheel = e => {
  e.preventDefault();
  this.zoomTo(ot(this.distance(), e.deltaY, this.limits, {
    pinch: e.ctrlKey,
    deltaMode: e.deltaMode
  }));
};
e.addEventListener(`wheel`, this._wheel, { passive: false });
```

| Behaviour | Value |
|---|---|
| Exponential zoom factor | `exp(deltaY * 0.0015)` for wheel; `exp(deltaY * 0.01)` when `ctrlKey` (pinch) |
| `deltaMode` normalisation | `0` → raw; `1` (LINE) → `×16`; `2` (PAGE) → `×400` |
| Zoom limits | `min = max(0.05, min(radius*0.25, fovDistance*1.2))`, `max = radius * 6` |

Note `at(e, t)` is called as `at(a, i)` at `:2223` where `a` is the *distance* and `i` the *radius*, so it reads `min = max(0.05, min(distance*0.25, radius*1.2))`, `max = distance*6`. Despite the param names, `min` is distance-derived and `max` is distance-derived. **The net effect: you can never zoom closer than 25% of the framed distance nor farther than 6×.**

### 3.3 TransformControls (the gizmo)

`Ge` (`Viewport-D1Bi_VWL.js:927`) is a vendored `TransformControls`. Root/gizmo/plane subclasses at `:1359` (`tt`, root), `:1399` (`nt`, gizmo), `:1728` (`rt`, plane).

```js
// Viewport-D1Bi_VWL.js:2022-2038
let g = new Ge(l, o.domElement);
g.setSize(0.85);
g.addEventListener(`dragging-changed`, e => {
  h.enabled = !e.value;
  this.dragging = e.value;
  if (!e.value && g.object) {
    this.cb.onTransformEnd?.(g.object);
  }
});
g.addEventListener(`objectChange`, () => {
  this.cb.onTransform?.(g.object);
  this.requestRender();
});
g.addEventListener(`change`, () => this.requestRender());
this.gizmo = g;
this.gizmoHelper = g.getHelper ? g.getHelper() : g;
s.add(this.gizmoHelper);
```

* `setSize(0.85)` — gizmo scaled to 85% of default.
* `dragging-changed` **disables OrbitControls while dragging** (`h.enabled = !e.value`). Without this, dragging a handle would also orbit.
* The gizmo *helper* (a `Group`) is added to the scene; the controls object itself is not an `Object3D` in the graph.
* Gizmo size in world units is recomputed per-frame from camera distance (`:1597`):
  `worldPos.distanceTo(cameraPosition) * min(tan(fov/2 in rad) * 1.9 / zoom, 7)` — a screen-constant-size gizmo.
* Gizmo plane (`rt`, `:1728-1737`): `PlaneGeometry(100000, 100000, 2, 2)` + `MeshBasicMaterial({ visible:false, wireframe:true, side:2, transparent:true, opacity:0.1, toneMapped:false })` — an invisible 100k-unit picking plane.
* Exposed via `setGizmo` (§4).

### 3.4 Keyboard

Handled by React, not the class (`Viewport-D1Bi_VWL.js:2511-2542`):

```js
onKeyDown={e => {
  let t = b.current;
  if (!t || e.target.closest?.(`input, textarea, select`)) return;
  let n = e.key.toLowerCase();
  let r = { front: `back`, right: `left`, top: `bottom`, persp: `persp` };
  let i = gt.find(([,, t]) => t === e.key);
  if (i) {
    t.view(e.ctrlKey ? r[i[0]] : i[0]);
  } else if (n === `f`) {
    T();                                   // frame selected
  } else if (n === `home` || n === `a` && !e.metaKey && !e.ctrlKey) {
    t.frame();                             // frame all
  } else if ((n === `g` || n === `w`) && d) { d(`translate`); }
  else if ((n === `r` || n === `e`) && d) { d(`rotate`); }
  else if (n === `s` && !e.metaKey && !e.ctrlKey && d) { d(`scale`); }
  else if (n === `escape`) { c?.(null, {}); }
  else { m?.(e); return; }
  e.preventDefault();
}}
```

with `gt` (`:2406`):

```js
var gt = [[`front`, `Front`, `1`], [`right`, `Right`, `3`], [`top`, `Top`, `7`], [`persp`, `Persp`, `5`]];
```

| Key | Action | Notes |
|---|---|---|
| `1` / `3` / `7` / `5` | front / right / top / persp | **Ctrl inverts**: front↔back, right↔left, top↔bottom |
| `f` | frame selection | `frameSelected()` |
| `Home` or `a` | frame all | `a` blocked with Cmd/Ctrl |
| `g` / `w` | gizmo translate | only if `onGizmoMode` supplied |
| `r` / `e` | gizmo rotate | ditto |
| `s` | gizmo scale | blocked with Cmd/Ctrl |
| `Escape` | clear pick (`onPick(null, {})`) | |
| anything else | forwarded to `onKey(e)` | |

`preventDefault()` only fires for recognised keys, so typing in the panel is unaffected. Also guarded by `e.target.closest('input, textarea, select')`.

The `div` is `tabIndex={0}` `role="application"` `aria-label={label}` (`:2511`), so it must be focused to receive keys.

---

## 4. Public API surface

### 4.1 `<Viewport>` props (`Viewport-D1Bi_VWL.js:2407-2425`)

| Prop | Type | Default | Effect |
|---|---|---|---|
| `content` | `Object3D \| Object3D[] \| null` | — | `setContent()`: clears `content` group, detaches gizmo, adds new objects, re-applies wireframe, re-applies selection |
| `frameKey` | `any` | — | When `!== undefined && !== null`, calls `frame(null, direction)`. **This is the auto-frame trigger.** |
| `frameDirection` | `'front'\|'back'\|'right'\|'left'\|'top'\|'bottom'\|'persp'` **or** `[x,y,z]` | `'persp'` | Direction vector used by `frame()`; array passes through verbatim |
| `animate` | `((dt, elapsed) => void) \| null` | `null` | Installs/removes the continuous render loop |
| `selection` | `Array<string\|number>` | `[]` | pickIds to outline |
| `outlines` | `boolean` | `true` | Master switch: `setSelection(outlines ? selection : [])` |
| `onPick` | `(id, {additive, hit, ray}) => void` | — | click on content |
| `onHover` | `(id, {hit, ray}) => void` | — | hover; `id === null` on leave |
| `gizmo` | `{object, mode?, space?, snap?} \| null` | `null` | attach transform gizmo |
| `onGizmoMode` | `(mode) => void` | — | enables keyboard g/w/r/e/s; receives `'translate'\|'rotate'\|'scale'` |
| `onTransform` | `(object) => void` | — | live during gizmo drag |
| `onTransformEnd` | `(object) => void` | — | on gizmo release |
| `onKey` | `(KeyboardEvent) => void` | — | unrecognised keys |
| `version` | `any` | — | **`requestRender()` whenever it changes identity.** Force-a-redraw escape hatch. |
| `label` | `string` | `'3D view'` | `aria-label` on the container |
| `className` | `string` | `''` | appended to `vp vp--<backdrop>` |

Plus a persisted pair read from `usePersistentState` (`ge`, imported from `index-DPVV2ya5.js` as `a`):

```js
// Viewport-D1Bi_VWL.js:2435-2441
let [S, C] = ge(`viewport.options`, { grid: true, floor: false, wireframe: false, bounds: false });
let [w, te] = ge(`viewport.backdrop`, `dark`);
```
`ge` = `ED` in `index-DPVV2ya5.js` → `useSyncExternalStore` over a **localStorage-backed global store** (`yD = 'robloxkit-panel-prefs'`, `xD` = parsed object, `SD` = subscriber Set, `wD` = write + notify). So grid/floor/wireframe/bounds and backdrop are **global user preferences shared across every viewport in the app**, persisted in `localStorage`.

Backdrop options (`:2405`): `var $ = ['dark', 'light', 'checker'];`

### 4.2 Imperative handle (`:2478-2492`)

```js
(0, M.useImperativeHandle)(ee, () => ({
  frame: e => b.current?.frame(e),          // frame(objects?) — omit to frame all
  frameSelected: () => T(),                 // frame only `selection`
  view: e => b.current?.view(e),            // snap camera to a named direction
  core: () => b.current                     // the raw class
}));
```

`core()` is what every advanced panel uses.

### 4.3 `ViewportCore` methods

#### `setContent(objs)` — `:2128-2137`

```js
setContent(e) {
  this.gizmo.detach();
  this.content.clear();
  for (let t of [e].flat().filter(Boolean)) {
    this.content.add(t);
  }
  this._applyWireframe();
  this.setSelection(this.selection ?? []);
  this.requestRender();
}
```
Note: **does not dispose** the old children — the caller owns their lifecycle. `Preview3D` handles this with its own cleanup `useEffect` (`Preview3D-CIiMrTBA.js:34-41`). `[e].flat()` means an array of arrays also works.

#### `frame(objects?, direction?)` → `{center, radius}` — `:2215-2237`

```js
frame(e = null, t = null) {
  let n = ft(e ?? this.content.children);
  if (n.isEmpty()) {
    n = new C(new b(-1, 0, -1), new b(1, 2, 1));   // fallback AABB
  }
  let r = n.getBoundingSphere(new l());
  let i = Math.max(0.25, r.radius);
  let a = it(i, this.camera.fov, this.camera.aspect || 1);
  this.limits = at(a, i);
  let o = t ? new b(...t).normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
  this.controls.target.copy(r.center);
  this.camera.position.copy(r.center).add(o.multiplyScalar(a));
  this.camera.near = Math.max(0.01, a / 500);
  this.camera.far  = Math.max(2000, a * 40);
  this.camera.updateProjectionMatrix();
  this.controls.update();
  this.floor.scale.setScalar(Math.max(4, i * 2.2));
  this.requestRender();
  return { center: r.center.toArray(), radius: i };
}
```

The fit-distance formula (`:1794-1798`):

```js
function it(e, t, n, r = 1.12) {
  let i = t * Math.PI / 360;                 // half-fov in radians
  let a = Math.atan(Math.tan(i) * n);        // half-fov adjusted for aspect
  return e / Math.sin(Math.min(i, a)) * r;   // distance, 1.12× padding
}
```

This is the **correct sphere-fit**: use the *narrower* of the vertical and horizontal half-angles so the sphere fits both ways, then apply 12% padding.

Side effects to replicate:
* `controls.target` ← sphere centre
* `camera.position` ← centre + normalised direction × distance
* `camera.near = max(0.01, distance/500)` — dynamic near plane, prevents z-fighting on tiny objects
* `camera.far = max(2000, distance*40)`
* `limits` recomputed
* `floor.scale = max(4, radius * 2.2)`

Default direction: the **current** camera→target vector (so re-framing preserves the viewing angle). If `direction` is given, it replaces that vector.

Bounding-box source (`:1865-1879`):

```js
function ft(e) {
  let t = new C();
  for (let n of e) {
    if (!n || n.visible === false) continue;
    let e = n.userData?.liveBounds?.();
    if (e && !e.isEmpty()) {
      t.union(e);
    } else {
      t.union(new C().setFromObject(n));
    }
  }
  return t;
}
```
The `userData.liveBounds()` hook lets a dynamic object (a particle system) supply exact bounds without `setFromObject` traversal. `scene-BcDA6opp.js:504-520` implements it for the VFX scene (`c.userData.liveBounds = U`).

#### `view(name)` — `:2238-2244`

```js
view(e) {
  let t = ct[e] ?? ct.persp;
  let n = this.camera.position.distanceTo(this.controls.target);
  this.camera.position.copy(this.controls.target).add(new b(...t).normalize().multiplyScalar(n));
  this.controls.update();
  this.requestRender();
}
```
Preserves the current distance, only changes direction.

Direction table (`:1822-1830`):

```js
var ct = {
  front:  [ 0,       0.0001,  1],
  back:   [ 0,       0.0001, -1],
  right:  [ 1,       0.0001,  0],
  left:   [ -1,      0.0001,  0],
  top:    [ 0,       1,       0.0001],
  bottom: [ 0,      -1,       0.0001],
  persp:  [ 0.55,    0.38,    1]
};
```
The `0.0001` on the orthogonal axes is a deliberate epsilon so `.normalize()` never produces a degenerate `lookAt` (camera up × view direction = 0).

#### `zoomTo(distance)` — `:2245-2251`
```js
zoomTo(e) {
  let t = this.camera.position.clone().sub(this.controls.target);
  t.setLength(st(e, this.limits));
  this.camera.position.copy(this.controls.target).add(t);
  this.controls.update();
  this.requestRender();
}
```

#### `distance()` — `:2252-2254`
```js
distance() { return this.camera.position.distanceTo(this.controls.target); }
```

#### `setSelection(ids)` — `:2147-2168`
Disposes all previous `BoxHelper`s, resolves ids via `pickables()`, rebuilds outlines. Always `requestRender()`.

#### `pickables()` — `:2138-2146`
```js
pickables() {
  let e = new Map();
  this.content.traverse(t => {
    if (t.userData?.pickId != null && !e.has(t.userData.pickId)) {
      e.set(t.userData.pickId, t);
    }
  });
  return e;
}
```
Map from `pickId` → **first** object carrying it (first wins on duplicate ids).

#### `setGizmo(object, {mode, space, snap})` — `:2169-2189`
```js
setGizmo(e, { mode: t = `translate`, space: n = `world`, snap: r = null } = {}) {
  let i = this.gizmo;
  if (!e) { i.detach(); this.requestRender(); return; }
  if (i.object !== e) { i.attach(e); }
  i.setMode(t);
  i.setSpace(n);
  i.setTranslationSnap(r?.move ?? null);
  i.setRotationSnap(r?.rotate ? E.degToRad(r.rotate) : null);
  i.setScaleSnap(r?.scale ?? null);
  this.requestRender();
}
```
`snap.rotate` is in **degrees** and converted via `degToRad`. `snap.move`/`snap.scale` are world units / scale factors.

#### `setOptions(opts)` — `:2190-2203`
Merges into `this.options`; toggles floor visibility, creates/destroys the `Box3Helper`, re-applies wireframe, renders. The 4 keys are `grid`, `floor`, `wireframe`, `bounds`.

#### `_applyWireframe()` — `:2204-2214`
```js
_applyWireframe() {
  let e = this.options.wireframe;
  this.content.traverse(t => {
    let n = Array.isArray(t.material) ? t.material : t.material ? [t.material] : [];
    for (let t of n) {
      if (`wireframe` in t && !t.isShaderMaterial) {
        t.wireframe = e;
      }
    }
  });
}
```
The `!t.isShaderMaterial` guard is essential — setting `.wireframe` on a `ShaderMaterial` is meaningless and the `'wireframe' in t` check avoids throwing on materials without the property.

#### `requestRender()` — `:2048-2055`
```js
requestRender() {
  if (!this._raf && !this._loop) {
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }
}
```

#### `setAnimation(fn|null)` — `:2056-2080`
See §5.2.

#### `render()` — `:2081-2119`
See §5.3.

#### `resize()` — `:2120-2127`
See §5.1.

#### `dispose()` — `:2372-2402`
See §5.4.
---

## 5. Resize, DPR, render loop, teardown

### 5.1 Resize + DPR

```js
// Viewport-D1Bi_VWL.js:2043-2046
let _ = new ResizeObserver(() => this.resize());
_.observe(e);          // e === the host <div class="vp__canvas">
this._ro = _;
this.resize();
```

```js
// Viewport-D1Bi_VWL.js:2120-2127
resize() {
  let e = this.host.clientWidth || 1;
  let t = this.host.clientHeight || 1;
  this.renderer.setSize(e, t, false);
  this.camera.aspect = e / t;
  this.camera.updateProjectionMatrix();
  this.requestRender();
}
```

| Detail | Value | Why |
|---|---|---|
| Observer | `ResizeObserver` on the **host div**, not the canvas | Canvas is sized by CSS `width:100%;height:100%` (`.vp__canvas canvas`), so observing it would be circular |
| `setSize(w, h, false)` | third arg `updateStyle = false` | **Do not** let three write `canvas.style.width/height`; CSS owns layout |
| `\|\| 1` fallback | guards divide-by-zero / zero-size initial layout | |
| DPR | set **once** in the constructor: `min(devicePixelRatio, 2)` | **Never re-applied** on resize. A monitor change (1× → 2×) is *not* picked up until remount. Worth fixing in a reimplementation. |
| CSS container query | `.vp{container:vp/size}` | the toolbar reflows at `height<=440px` and `height<=300px` (`Viewport-Dok-fWD-.css`) |

### 5.2 Render loop — on-demand by default, continuous when `animate` is set

**On demand:**

```js
// Viewport-D1Bi_VWL.js:2048-2055
requestRender() {
  if (!this._raf && !this._loop) {
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }
}
```
Coalesces any number of calls within a frame into one `render()`. Note `!this._loop` — a continuous loop already renders, so `requestRender` is a no-op while animating.

**Continuous:**

```js
// Viewport-D1Bi_VWL.js:2056-2080
setAnimation(e) {
  this._anim = e;
  if (e && !this._loop) {
    let e = performance.now();
    let t = e;
    let n = r => {
      if (!this._anim) {
        this._loop = 0;
        return;
      }
      this._loop = requestAnimationFrame(n);
      if (document.hidden || !this.host.isConnected) {
        return;
      }
      let i = Math.min(0.05, (r - e) / 1000);   // clamped dt
      e = r;
      this._anim(i, (r - t) / 1000);            // (dt, elapsed)
      this.render();
    };
    this._loop = requestAnimationFrame(n);
  }
  if (!e) {
    this.requestRender();
  }
}
```

Reimplementation-critical details:

1. **`dt` is clamped to 50 ms** — protects against tab-suspend / long-task jumps.
2. **`document.hidden || !this.host.isConnected`** — skips the *work* but keeps the rAF chain alive, so it resumes automatically when the tab returns or the node is reattached.
3. **`_loop` is set to `0` before returning** when `_anim` was cleared — this is the "cancellation" path (it does not `cancelAnimationFrame`, it lets the chain die naturally on the next tick).
4. `elapsed` accumulates from `t` which is *never* reset, so `elapsed` is wall-clock since `setAnimation` was called, **not** integrated `dt` — a hidden tab makes `elapsed` jump.
5. When `animate` goes `null`, one final `requestRender()` guarantees a static frame.
6. `setAnimation` is idempotent for the same non-null fn only in the sense that it early-returns if `_loop` already exists — **but `this._anim` is replaced**, so a new closure takes effect immediately.

`Preview3D` uses this for `spin` and `onFrame` (`Preview3D-CIiMrTBA.js:46-56`, see §7.1).

### 5.3 `render()` — two-pass, scissored

```js
// Viewport-D1Bi_VWL.js:2081-2119
render() {
  let { renderer: e, scene: t, camera: n } = this;
  let r = n.position.distanceTo(this.controls.target);
  let i = this.grid.material.uniforms;
  i.uSize.value = dt(r);
  i.uFade.value = Math.max(20, r * 6);
  i.uCenter.value.copy(this.controls.target);
  this.grid.scale.setScalar(i.uFade.value * 2.2);
  this.grid.position.set(this.controls.target.x, 0, this.controls.target.z);
  this.grid.visible = this.options.grid;
  for (let e of this.outlines) { e.update?.(); }
  if (this.boundsHelper) {
    this.boundsHelper.box.copy(ft(this.content.children));
  }
  let a = this.host.clientWidth || 1;
  let o = this.host.clientHeight || 1;
  e.setViewport(0, 0, a, o);
  e.setScissorTest(false);
  e.clear();
  e.render(t, n);
  // ---- second pass: corner axis widget ----
  let s = this.axisSize;                                  // 76
  let c = this.axes.camera;
  c.position.copy(n.position).sub(this.controls.target).setLength(4);
  c.quaternion.copy(n.quaternion);
  e.clearDepth();
  e.setScissorTest(true);
  let l = this.axisTop;                                   // 48
  e.setScissor(a - s - 8, o - s - l, s, s);
  e.setViewport(a - s - 8, o - s - l, s, s);
  e.render(this.axes.scene, c);
  e.setScissorTest(false);
  e.setViewport(0, 0, a, o);
}
```

Pass 2 rationale: the axis widget reuses the *same* renderer with a scissor rect in the top-right. The ortho camera copies the main camera's **orientation** but sits at distance 4 from the origin, so the widget always shows the current viewing direction. `clearDepth()` is required so the widget is not occluded by the main scene's depth buffer, and `autoClear = false` (§2.1) is required so the main scene survives into pass 2.

**Per-frame work before drawing:**
1. Grid LOD (`uSize`, `uFade`, `uCenter`, `scale`, `position`, `visible`)
2. Outline `BoxHelper.update()` for each selection
3. Bounds helper box recomputation
4. (implicit) `TransformControls` `updateMatrixWorld` handles gizmo scale

**Note:** `this.grid.visible = this.options.grid` is applied every frame — a cheap way to make the option always authoritative even if something else toggles visibility.

### 5.4 `dispose()` — exact teardown order

```js
// Viewport-D1Bi_VWL.js:2372-2402
dispose() {
  if (typeof window < `u`) {
    window.__viewports?.delete(this);
  }
  this.setAnimation(null);
  cancelAnimationFrame(this._raf);
  this._ro.disconnect();
  let e = this.renderer.domElement;
  e.removeEventListener(`wheel`, this._wheel);
  e.removeEventListener(`pointerdown`, this._down);
  e.removeEventListener(`pointerup`, this._up);
  e.removeEventListener(`pointermove`, this._move);
  e.removeEventListener(`pointerleave`, this._leave);
  e.removeEventListener(`dblclick`, this._dbl);
  this.gizmo.detach();
  this.gizmo.dispose();
  this.controls.dispose();
  for (let e of this.outlines) {
    e.dispose?.();
  }
  this.grid.geometry.dispose();
  this.grid.material.dispose();
  this.floor.geometry.dispose();
  this.floor.material.dispose();
  this.axes.scene.traverse(e => {
    e.geometry?.dispose?.();
    e.material?.dispose?.();
  });
  this.renderer.dispose();
  e.remove();
}
```

Ordered rationale:

| # | Step | Why this position |
|---|---|---|
| 1 | `window.__viewports?.delete(this)` | registry cleanup; `window.__viewports` is only *read* here (`grep` shows exactly one occurrence), never populated in this bundle — a leftover/debug hook |
| 2 | `setAnimation(null)` | kills the rAF chain first so nothing renders during teardown |
| 3 | `cancelAnimationFrame(this._raf)` | kills any pending one-shot render |
| 4 | `this._ro.disconnect()` | stop resize callbacks before we destroy the renderer |
| 5 | remove 6 DOM listeners | before the canvas is detached |
| 6 | `gizmo.detach()` + `gizmo.dispose()` | gizmo's `dispose` traverses and disposes its own geometry/materials (`:1388-1397`) |
| 7 | `controls.dispose()` | OrbitControls `disconnect()` — removes pointerdown/pointermove/pointerup/wheel/contextmenu/keydown |
| 8 | dispose outlines | `BoxHelper`s (geometry + material) |
| 9 | grid geo+mat | |
| 10 | floor geo+mat | |
| 11 | `axes.scene.traverse` | axis widget geometries and materials |
| 12 | `renderer.dispose()` | releases the WebGL context resources |
| 13 | `e.remove()` | finally detaches the canvas from the DOM |

**What is NOT disposed:** `this.content` children and `this.helpers` (bounds helper). The contract is that the **caller owns content**. `Preview3D` implements this (`Preview3D-CIiMrTBA.js:34-41`); panels using `Viewport` directly each have their own cleanup.

---

## 6. Selection, hover, picking

### 6.1 The `pickId` convention

Any `Object3D` in `content` may carry `userData.pickId` (string or number) and optionally `userData.locked`. Resolution walks **up** the parent chain and stops at the first ancestor with a `pickId`:

```js
// Viewport-D1Bi_VWL.js:1880-1891
function pt(e) {
  for (let t = e; t; t = t.parent) {
    if (t.userData?.pickId != null) {
      if (t.userData.locked) {
        return null;
      } else {
        return t.userData.pickId;
      }
    }
  }
  return null;
}
```

This is what lets a part be a `Group` with many child meshes: only the group needs the `pickId`. `locked` returns `null` — the object is invisible to picking *and* to selection outlines, but still renders.

### 6.2 Raycast

```js
// Viewport-D1Bi_VWL.js:2352-2371
_hitAt(e, t) {
  let n = new o();                                          // Raycaster
  n.setFromCamera(new y(e * 2 - 1, -t * 2 + 1), this.camera);
  let r = n.intersectObjects(this.content.children, true)
           .filter(e => e.object.visible !== false);
  for (let e of r) {
    let t = pt(e.object);
    if (t != null) {
      return { id: t, hit: e, ray: n.ray.clone() };
    }
  }
  return { id: null, hit: null, ray: n.ray.clone() };
}
```

* Input is **normalised UV** `[0..1]` — converted to NDC internally.
* `intersectObjects(content.children, true)` — recursive, but only `content`, never `helpers`.
* `.filter(e => e.object.visible !== false)` — invisible meshes are skipped **but still in the hit list order**, so a visible object behind an invisible one is found.
* Returns the **nearest hit whose ancestor chain yields a non-null `pickId`** — so a `locked` object is transparent to the ray (you pick what is behind it).
* Returns the `Ray` clone so the consumer can do its own plane intersection (used by `GeneratorPanel` for placement).

### 6.3 Click vs drag discrimination

```js
// Viewport-D1Bi_VWL.js:2267-2310
let t = null;
this._down = e => {
  if (e.button === 0) { t = { x: e.clientX, y: e.clientY }; }
};
this._up = n => {
  if (!t || n.button !== 0) return;
  let r = Math.hypot(n.clientX - t.x, n.clientY - t.y);
  t = null;
  if (r > 4 || this.dragging) return;        // <-- 4px slop, and not mid-gizmo-drag
  let i = e.getBoundingClientRect();
  let a = n.clientX - i.left;
  let s = n.clientY - i.top;
  // --- axis widget hit test first ---
  let c = this.axisSize;    // 76
  let l = this.axisTop;     // 48
  if (a > i.width - c - 8 && s > l && s < c + l) {
    let e = new y((a - (i.width - c - 8)) / c * 2 - 1, -((s - l) / c * 2 - 1));
    let t = new o();
    t.setFromCamera(e, this.axes.camera);
    let n = t.intersectObjects(this.axes.pick)[0];
    if (n) { this.view(n.object.userData.view); return; }
  }
  let { id: u, hit: d, ray: f } = this._hitAt(a / i.width, s / i.height);
  this.cb.onPick?.(u, {
    additive: n.shiftKey || n.metaKey || n.ctrlKey,
    hit: d,
    ray: f
  });
};
```

* **4 px movement threshold** distinguishes click from orbit-drag.
* `this.dragging` (set by the gizmo's `dragging-changed`) suppresses picks during gizmo interaction.
* The **axis widget is tested first**; a hit there consumes the click (no `onPick`).
* `additive` = `shiftKey || metaKey || ctrlKey` — lets the caller implement multi-select. `VfxPanel` uses it (`VfxPanel-WhOgBy41.js:2599-2601`): `additive ? [...i, e] : [e]`.

### 6.4 Hover with deduplication

```js
// Viewport-D1Bi_VWL.js:2311-2348
let n = null;
let r = 0;
let i = null;
this._move = t => {
  if (!this.cb.onHover || t.buttons) return;        // skip while any button held
  let a = e.getBoundingClientRect();
  n = [(t.clientX - a.left) / a.width, (t.clientY - a.top) / a.height];
  if (!r) {
    r = requestAnimationFrame(() => {
      r = 0;
      let { id: e, hit: t, ray: a } = this._hitAt(...n);
      let o = e == null ? null : `${e}:${t?.object?.uuid}:${t?.faceIndex}`;
      if (o !== i) {
        i = o;
        this.cb.onHover?.(e, { hit: t, ray: a });
      }
    });
  }
};
this._leave = () => {
  if (i != null) {
    i = null;
    this.cb.onHover?.(null, {});
  }
};
```

* **rAF-throttled** — at most one raycast per frame.
* **Change key** is `id:objectUuid:faceIndex`, so moving across a face boundary of the same object still fires (useful for per-face highlight).
* No `onHover` prop → the whole path is skipped (zero cost).
* `t.buttons` truthy → no hover while dragging.

### 6.5 Double-click = frame all

```js
// Viewport-D1Bi_VWL.js:2349-2350
this._dbl = () => this.frame();
e.addEventListener(`dblclick`, this._dbl);
```

### 6.6 Outline rendering — BoxHelper, not a post-process

As established in §2.8, "outlines" are per-selection `BoxHelper` line-segments with `depthTest:false`, `transparent:true`, `renderOrder:999`, colour `#FFA53D`. There is **no** `OutlinePass`, no `EffectComposer`, no normal/depth edge detection anywhere in the bundle. If you want silhouette-accurate outlines in a reimplementation you must add that yourself; the current approach only communicates *which object* is selected.
---

## 7. Mannequin injection & clothing textures

### 7.1 `Preview3D` — the mannequin layer (`Preview3D-CIiMrTBA.js:7-73`)

Full source, verbatim:

```js
var o = (0, i.forwardRef)(function ({
  object: e,
  mannequin: t = true,
  target: o,
  distance: s,
  radius: c,
  direction: l,
  viewKey: u = 0,
  spin: d = false,
  label: f,
  version: p,
  onFrame: m = null,
  selection: h,
  outlines: g,
  onPick: _,
  onHover: v,
  gizmo: y,
  onGizmoMode: b,
  onTransform: x,
  onTransformEnd: S,
  onKey: C,
  children: w
}, T) {
  let E = (0, i.useMemo)(() => t === true ? r() : null, [t]);
  (0, i.useEffect)(() => () => E?.dispose(), [E]);
  let D = t === true ? E?.group : t || null;
  let O = (0, i.useMemo)(() => [e, D].filter(Boolean), [e, D]);
  (0, i.useEffect)(() => () => e?.traverse?.(e => {
    e.geometry?.dispose?.();
    let t = Array.isArray(e.material) ? e.material : e.material ? [e.material] : [];
    for (let e of t) {
      e.map?.dispose?.();
      e.dispose?.();
    }
  }), [e]);
  let k = JSON.stringify([o ?? null, c ?? null, s ?? null, u, l ?? null]);
  let A = (0, i.useRef)(null);
  let j = (0, i.useRef)(m);
  j.current = m;
  let M = (0, i.useCallback)((e, t) => {
    if (d) {
      let e = A.current?.core();
      if (e) {
        e.controls.autoRotate = true;
        e.controls.autoRotateSpeed = 1.6;
        e.controls.update();
      }
    }
    j.current?.(t);
  }, [d]);
  (0, i.useEffect)(() => {
    if (!d) {
      let e = A.current?.core();
      if (e) {
        e.controls.autoRotate = false;
      }
    }
  }, [d]);
  return <_Component ref={e => {
    A.current = e;
    if (typeof T == `function`) {
      T(e);
    } else if (T) {
      T.current = e;
    }
  }} className={`preview3d`} content={O} frameKey={k} frameDirection={l ?? `persp`} animate={d || m ? M : null} selection={h} outlines={g} onHover={v} onPick={_} gizmo={y} onGizmoMode={b} onTransform={x} onTransformEnd={S} onKey={C} version={p} label={f ?? `3D preview`}>{w}</_Component>;
});
```

**Three ways `mannequin` behaves:**

| `mannequin` | Result |
|---|---|
| `true` (default) | Calls `buildAvatar()` with **no arguments** → R15 rig, skin `SKIN_TONES[0].hex = '#eab892'`, no clothes. Added to `content` as the second element. |
| an `Object3D` (a `Group`) | Used directly. `ClothingPanel` passes `k.group` where `k = buildAvatar({rig, skin})` it built itself. |
| `false` / `null` / `undefined`… | `D = t \|\| null` → `null`, filtered out. No mannequin. |

**Content array:** `[object, mannequinGroup].filter(Boolean)` — so a panel can show a mesh *and* a mannequin simultaneously (e.g. an accessory on a body).

**The `spin` implementation is subtle and slightly odd.** It is not a plain `autoRotate = spin`:

* `animate={d || m ? M : null}` — the continuous loop is installed if **either** `spin` or `onFrame` is present.
* Inside the animation callback, `autoRotate` is only forced `true` **when `spin` is true**; if `spin` is false but `onFrame` is set, `autoRotate` is left alone (so it stays `false` from the effect at `:57-64`).
* `autoRotateSpeed = 1.6` (not the OrbitControls default `2`).
* `controls.update()` is called manually each animation tick so the auto-rotation advances.
* The effect at `:57-64` sets `autoRotate = false` when `spin` goes false.

Because `autoRotate` only advances inside `OrbitControls.update()` **and only when `state === NONE`** (`Viewport-D1Bi_VWL.js:218`), spinning pauses automatically while the user drags. That is the desired behaviour and comes for free.

**The `frameKey` cache-buster (`:42`):**

```js
let k = JSON.stringify([o ?? null, c ?? null, s ?? null, u, l ?? null]);
```

> ### ⚠️ Important finding: `target`, `radius`, `distance` do **not** control framing
>
> `target` (`o`), `radius` (`c`) and `distance` (`s`) are **only** serialised into `frameKey`. They are never passed to `Viewport` and never used to compute a camera position. Passing `radius={3.1}` does not place the camera 3.1 units away — it merely makes `frameKey` change identity, which triggers `frame(null, direction)`, which fits the **bounding sphere** of the content with the 1.12 padding factor from §4.3.
>
> Consequence: for a fixed content graph, changing `radius` re-frames to *the same* camera position. These props are effectively no-ops except as "re-frame now" triggers.
>
> **Do not replicate this.** In a reimplementation, either make `radius`/`target`/`distance` real overrides on the framing computation, or drop them and use an explicit `frameToken`.

`viewKey` is likewise only in `frameKey` — a dedicated re-frame token.

**`onFrame` signature:** `(dt, elapsed) => void` — matches `setAnimation`'s `this._anim(i, (r - t) / 1000)` (§5.2). It is called *after* the `autoRotate` bookkeeping.

**Ref forwarding** handles both callback refs and object refs (`:65-72`), so `ref.current.core()` works from any panel.

### 7.2 `buildAvatar` — the mannequin (`avatar-CSK-yHJ2.js:157-320`)

Signature:

```js
function P({ rig: e = `R15`, skin: u = C[0].hex, clothes: S = {} } = {}) {
```

Exported as `r` (`avatar-CSK-yHJ2.js:321`), re-exported by `avatar-CNritt1g.js:2` as `buildAvatar`.

**Skin tones (`avatar-CSK-yHJ2.js:13-34`):**

```js
var C = [
  { name: `Light orange`,     hex: `#eab892` },
  { name: `Pastel brown`,     hex: `#ffcc99` },
  { name: `Nougat`,           hex: `#cc8e69` },
  { name: `Brown`,            hex: `#7c5c46` },
  { name: `Reddish brown`,    hex: `#694028` },
  { name: `Bright yellow`,    hex: `#f5cd30` },
  { name: `Medium stone grey`,hex: `#a3a2a5` }
];
```

**Rig skeleton** comes from `rig-P29m_B-3.js` (`h` imported as `_`... actually imported as `n`→`_`; concretely `import { … n as _ … } from "./rig-P29m_B-3.js"` then `h[e] ?? h.R15` at `:169`). R15 has 15 parts, R6 has 6; each is `{part, parent, pivot}`. R15 pivots:

```
LowerTorso [0,2,0] → UpperTorso [0,2.4,0] → Head [0,4,0]
                                        → Left/RightUpperArm [±1.5,3.6,0] → LowerArm [±1.5,3.1,0] → Hand [±1.5,2.3,0]
LowerTorso → Left/RightUpperLeg [±0.5,2,0] → LowerLeg [±0.5,1.14,0] → Foot [±0.5,0.3,0]
```

**Body-part geometry table (`:42-72`)** — 5 "wears" regions:

```js
var D = [
  { name:`Torso`,    wears:`torso`,     split:`torso`, size:[2,2,1], center:[ 0,   3, 0] },
  { name:`LeftArm`,  wears:`left_arm`,  split:`arm`,   size:[1,2,1], center:[ 1.5, 3, 0] },
  { name:`RightArm`, wears:`right_arm`, split:`arm`,   size:[1,2,1], center:[-1.5, 3, 0] },
  { name:`LeftLeg`,  wears:`left_leg`,  split:`leg`,   size:[1,2,1], center:[ 0.5, 1, 0] },
  { name:`RightLeg`, wears:`right_leg`, split:`leg`,   size:[1,2,1], center:[-0.5, 1, 0] }
];
```

**Segment split ratios (`:36-40`)** — how a limb is divided into stacked boxes:

```js
var w = 2;   // limb length in studs
var T = {
  torso: [[`UpperTorso`, 0.8], [`LowerTorso`, 0.2]],
  arm:   [[`UpperArm`, 0.45], [`LowerArm`, 0.4], [`Hand`, 0.15]],
  leg:   [[`UpperLeg`, 0.43], [`LowerLeg`, 0.42], [`Foot`, 0.15]]
};
var E = 0.015;   // seam gap between segments (studs)
```

**Texture atlas → UV mapping.** Three canvases (torso / arms / legs), each 585×559:

```js
// avatar-CSK-yHJ2.js:141-156
function N(e, t, n) {                     // composite()
  e.width = 585;
  e.height = 559;
  let r = e.getContext(`2d`);
  if (!r) return e;
  r.fillStyle = t;                        // skin colour fills the whole sheet
  r.fillRect(0, 0, 585, 559);
  for (let e of n) {
    if (e) { r.drawImage(e, 0, 0, 585, 559); }
  }
  return e;
}
```

```js
// avatar-CSK-yHJ2.js:74-80
function k(e) {                           // rectUvs(rect) -> 8 floats (4 uv pairs)
  let t = e.x / 585;
  let n = (e.x + e.w) / 585;
  let r = 1 - e.y / 559;
  let i = 1 - (e.y + e.h) / 559;
  return [t, r, n, r, t, i, n, i];
}
```

```js
// avatar-CSK-yHJ2.js:81-105
function A(e, t, n, r) {                  // segmentRect(faces, face, from, to)
  let i = t => e.find(e => e.face === t);
  if (t === `up` || t === `down`) {
    if (t === `up` ? n === 0 : r === 1) { return i(t); }   // first/last slice keeps the cap
    let e = i(`front`);
    let a = e.y + Math.round(e.h * (t === `up` ? n : r));
    return { x: e.x, y: Math.min(e.y + e.h - 1, a), w: e.w, h: 1 };
  }
  let a = i(t);
  let o = a.y + Math.round(a.h * n);
  let s = a.y + Math.round(a.h * r);
  return { x: a.x, y: o, w: a.w, h: Math.max(1, s - o) };
}
```

```js
// avatar-CSK-yHJ2.js:106-117
function j(e, t, n, r) {                  // build segmented box with custom UVs
  let i = new u(...e);                    // BoxGeometry(w,h,d)
  let a = i.attributes.uv;
  O.forEach((e, i) => {                   // O = ['left','right','up','down','front','back']
    let o = k(A(t, e, n, r));
    for (let e = 0; e < 4; e++) {
      a.setXY(i * 4 + e, o[e * 2], o[e * 2 + 1]);
    }
  });
  a.needsUpdate = true;
  return i;
}
```

> The **face order `['left','right','up','down','front','back']`** is the BoxGeometry vertex order used by three.js (6 faces × 4 verts = 24 uv pairs). Each face's 4 vertices get the 4 corners of its atlas rect in the order `(x0,y1),(x1,y1),(x0,y0),(x1,y0)` — top-left, top-right, bottom-left, bottom-right in UV space, which matches BoxGeometry's per-face vertex winding.

**Material set (`:183-205`):**

```js
let I = { torso: canvas, arms: canvas, legs: canvas };   // 3 shared canvases
let L = {};   // textures
let R = {};   // materials
for (let [e, t] of Object.entries(I)) {
  N(t, u, []);                             // start as pure skin
  let n = new a(t);                        // CanvasTexture
  n.colorSpace = o;                        // SRGBColorSpace
  n.magFilter = i;                         // NearestFilter
  n.anisotropy = 4;
  L[e] = n;
  R[e] = new d({ map: n, roughness: 0.82 });   // MeshStandardMaterial
}
let z = new d({ color: new n(u), roughness: 0.75 });   // head material, flat skin colour
```

`NearestFilter` is deliberate: the atlas is a pixel-art Roblox template and linear filtering would smear the seams.

**Part assembly (`:208-225`):**

```js
for (let t of D) {
  let n = (t.wears.endsWith(`leg`) ? V : B).filter(e => e.part === t.wears);   // atlas face rects
  let r = t.wears === `torso` ? R.torso : t.wears.endsWith(`arm`) ? R.arms : R.legs;
  let i = e === `R6` ? [[t.name, 1]] : T[t.split];     // R6 = one box, R15 = segmented
  let a = 0;
  let o = t.center[1] + t.size[1] / 2;                 // top of the limb
  for (let [s, l] of i) {
    let i = a + l;
    let u = e === `R6` || i === 1 ? 0 : E;             // seam gap, none on the last segment
    let d = w * l - u;
    let f = j([t.size[0], d, t.size[2]], n, a, i);
    let p = new c(f, r);                               // Mesh
    p.name = e === `R6` ? t.name : t.name.replace(/Arm|Leg|Torso/, ``) + s;
    p.position.set(t.center[0], o - w * a - d / 2, t.center[2]);
    F(p, e === `R6` ? t.name : p.name);                // re-parent to the joint
    a = i;
  }
}
```

`B = x('shirt')`, `V = x('pants')` (`:206-207`) are `segments(kind)` from `layout-yFs0_M_2.js:59-73`, producing the atlas rect list. `x` is imported as `n` from `layout-yFs0_M_2.js`.

**Head, face, t-shirt decal (`:226-245`):**

```js
let H = new c(new f(1.2, 1.2, 1.2, 4, 0.28), z);       // RoundedBoxGeometry(1.2 x 1.2 x 1.2, seg 4, radius 0.28)
H.name = `Head`;
H.position.set(0, 4.62, 0);
F(H, `Head`);

let U = new c(new r(0.9, 0.9), new l({ map: M(), transparent: true }));   // CircleGeometry + face texture
U.position.set(0, 4.62, 0.605);
F(U, `Head`);

let W = new a(document.createElement(`canvas`));       // t-shirt decal texture
W.colorSpace = o;
let G = new c(new r(1.7, 1.7), new d({ map: W, transparent: true, roughness: 0.82 }));
G.position.set(0, 3.08, 0.506);
G.visible = false;
F(G, e === `R6` ? `Torso` : `UpperTorso`);
```

Face texture generator (`:118-140`) — a 128×128 canvas with two filled ellipses for eyes at `(44,52)` and `(84,52)` radius `7×11`, and an arc smile `arc(64,70,24, π*0.18, π*0.82)` stroked at `lineWidth 6`, all in `#1b1b1f`.

**Clothing application (`:287-301`):**

```js
let X = (e = {}, t = u) => {              // update(clothes, skin)
  u = t;
  z.color.set(u);                          // head recolour
  N(I.torso, u, [e.pants, e.shirt]);       // torso = skin + pants + shirt (in that z-order)
  N(I.arms,  u, [e.shirt]);                // arms  = skin + shirt
  N(I.legs,  u, [e.pants]);                // legs  = skin + pants
  for (let e of Object.values(L)) { e.needsUpdate = true; }
  G.visible = !!e.tshirt;
  if (e.tshirt) {
    W.image = e.tshirt;
    W.needsUpdate = true;
  }
};
X(S, u);
```

`clothes` shape: `{ shirt?: CanvasImageSource, pants?: CanvasImageSource, tshirt?: CanvasImageSource }`.

**Key insight:** the clothing atlas is **one shared 585×559 image per body region**, and the skin is *painted underneath* it. There is no per-part material; 15 R15 parts share 3 materials. That is why re-dressing is cheap: 3 `drawImage` calls + 3 `needsUpdate` flags.

**Returned API (`:304-319`):**

```js
return {
  group: O,              // Object3D root named `Avatar ${rig}`
  rig: e,                // 'R15' | 'R6'
  joints: A,             // name -> Object3D for each part
  attachments: K,        // name -> Object3D (19 Roblox attachments + r6 aliases)
  setPose: J,            // (pose: string|{joints,root,turn}) => void
  animate: Y,            // (clip, t, basePose?) => void
  update: X,             // (clothes, skin) => void
  dispose: () => O.traverse(…)
};
```

`dispose` (`:312-318`) traverses and disposes geometry, `material.map`, and `material` — note it disposes `map` for **every** material, which is correct here because the 3 canvases are unique per avatar.

### 7.3 Offscreen capture (`avatarRender-DVeE1evW.js`)

A **completely separate** renderer from the viewport — same idea, different configuration. This is the "render without a DOM canvas" path.

```js
// avatarRender-DVeE1evW.js:4-17
var l = null;
function u(e, t) {
  if (!l) {
    l = new s({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    l.outputColorSpace = o;     // srgb
  }
  l.setPixelRatio(1);
  l.setSize(e, t, false);
  return l;
}
```

A **module-level singleton renderer** reused across all captures (WebGL contexts are expensive; browsers cap them at ~16).

```js
// avatarRender-DVeE1evW.js:18-32
function d(n, i) {
  let o = new a();                        // Scene
  if (i) { o.background = new r(i); }     // optional Color background
  o.add(new t(16777215, 2763306, 1.8));   // HemisphereLight(#FFFFFF, #2A2A2A, 1.8)
  let s = new e(16777215, 1.9);           // DirectionalLight(#FFFFFF, 1.9)
  s.position.set(3, 8, 7);
  o.add(s);
  let c = new e(16777215, 0.9);           // DirectionalLight(#FFFFFF, 0.9)
  c.position.set(-3, 5, -7);
  o.add(c);
  o.add(n.group);
  return o;
}
```

Note the different lighting from the viewport: hemisphere `(#FFFFFF, #2A2A2A, 1.8)`, two white directionals at `(3,8,7)@1.9` and `(-3,5,-7)@0.9`. No grid, no floor.

```js
// avatarRender-DVeE1evW.js:33-48
var f = {
  front: [0, 0.12, 1],
  back:  [0, 0.12, -1],
  left:  [1, 0.12, 0.15],
  right: [-1, 0.12, 0.15],
  "3/4": [0.75, 0.25, 1]
};
function p(e, t, r, a) {
  let o = u(r, a);
  let s = new i(30, r / a, 0.1, 100);      // PerspectiveCamera(30, aspect, 0.1, 100)
  let c = new n(0, 2.75, 0);               // target Vector3(0, 2.75, 0)
  s.position.copy(c).add(new n(...t).normalize().multiplyScalar(12.5));
  s.lookAt(c);
  o.render(e, s);
  return o.domElement;
}
```

`fov 30` (vs 38 in the viewport), fixed distance `12.5`, fixed target `(0, 2.75, 0)` — i.e. the avatar's chest. Because the renderer is a singleton, `domElement` is the *same canvas* each time, so it must be consumed synchronously (`toBlob`/`drawImage`) before the next render.

```js
// avatarRender-DVeE1evW.js:49-62  — renderClothingThumbnail
async function m(e, { rig: t = `R15`, skin: n } = {}, r = 256) {
  let i = c({ rig: t, skin: n, clothes: e });
  let a = p(d(i, null), f[`3/4`], r, r);
  let o = await new Promise(e => a.toBlob(e, `image/png`));
  i.dispose();
  return new Uint8Array(await o.arrayBuffer());
}
```

```js
// avatarRender-DVeE1evW.js:63-96  — renderClothingSheet
function h(e, t, { rig: n = `R15`, skin: r } = {}, i = 256) {
  let a = c({ rig: n, skin: r, clothes: e });
  let o = d(a, 1447963);                   // scene with #16181B background
  let s = document.createElement(`canvas`);
  s.width = i * 4;
  s.height = Math.round(i * 1.4);
  let l = s.getContext(`2d`);
  l.fillStyle = `#101113`;
  l.fillRect(0, 0, s.width, s.height);
  [[`front`, f.front], [`back`, f.back], [`left side`, f.left]].forEach(([e, t], n) => {
    let r = p(o, t, i, s.height);
    l.drawImage(r, n * i, 0);
    l.fillStyle = `rgba(255,255,255,0.85)`;
    l.font = `14px sans-serif`;
    l.fillText(e, n * i + 8, 18);
  });
  if (t) {
    let e = Math.min(i / t.width, s.height / t.height);
    let n = t.width * e;
    let r = t.height * e;
    l.drawImage(t, i * 3 + (i - n) / 2, (s.height - r) / 2, n, r);
    l.fillStyle = `rgba(255,255,255,0.85)`;
    l.fillText(`template`, i * 3 + 8, 18);
  }
  a.dispose();
  return s.toDataURL(`image/jpeg`, 0.85);
}
```

The sheet is **3 rendered views + the raw template**, composited on a 2D canvas with `#101113` background, exported as JPEG q=0.85.

**Differences vs. the live viewport worth noting for reimplementation:**

| | Live viewport | Offscreen capture |
|---|---|---|
| Renderer | per-instance, DPR ≤ 2 | module singleton, DPR 1 |
| fov | 38 | 30 |
| Framing | bounding-sphere auto-fit | hardcoded direction × 12.5, target (0,2.75,0) |
| Lights | Hemi(#F4F4F5,#16181B,1.6) + Dir(#FFFFFF,2.2) + Dir(#9FB4FF,0.6) | Hemi(#FFFFFF,#2A2A2A,1.8) + Dir(#FFFFFF,1.9) + Dir(#FFFFFF,0.9) |
| Background | CSS | `scene.background = Color` |
| Grid/floor | yes/no | none |
| Output | screen | `toBlob('image/png')` / `toDataURL('image/jpeg',0.85)` |
---

## 8. Every panel that reuses the viewport

Exhaustive grep over the bundle for `Preview3D-CIiMrTBA` and `Viewport-D1Bi_VWL` imports:

| File | Imports | Layer used |
|---|---|---|
| `ClothingPanel-CEM_quBl.js` | `Preview3D` | Preview3D |
| `GeneratorPanel-BNGBBwll.js` | `Preview3D` | Preview3D |
| `TexturePanel-D8uJ3dDt.js` | `Preview3D` | Preview3D |
| `AnimationPanel-CfAluouO.js` | `Viewport` | Viewport (direct) |
| `CutscenePanel-vZ21pbBO.js` | `Viewport` | Viewport (direct) |
| `SkyboxPanel-Dol3AjLh.js` | `Viewport` | Viewport (direct) |
| `VfxPanel-WhOgBy41.js` | `Viewport` | Viewport (direct) |
| `Preview3D-CIiMrTBA.js` | `Viewport` | wrapper |

**Not** users of the 3D viewport (they use a 2D canvas + `FitView-DiFtCxZn.js`): `IconPanel-B9gwP3wl.js`, `GfxPanel-DxR67E8C.js` (`GfxPanel-DxR67E8C.js:1084-1087` renders into a plain `<canvas>`), `SfxPanel`, `MusicPanel`, `gen3d-BAdfthxw.js` (a spec/library module, no UI).

`index-DPVV2ya5.js` references both bundles only in its `__vite__mapDeps` preload manifest (line 1) — it is the route/lazy-load table, not a consumer.

---

### 8.1 `ClothingPanel-CEM_quBl.js` — Preview3D, the canonical panel use

**Avatar/Template segmented control** (`ClothingPanel-CEM_quBl.js:351`):

```jsx
{view === `avatar`
  ? <Pe object={null} mannequin={k.group} version={ee} target={[0, 2.75, 0]} radius={3.1}
        direction={He[_.dir]} viewKey={_.key} floor={2.6} spin={y} label={`${e.name} on the avatar`} />
  : <Component20 className={`cloth-flat`}>
      <O width={T.canvas.width} height={T.canvas.height} resetKey={`${e.id}:${t.type}`} label={`Template`}>
        <Component19 ref={j} className={`cloth-flat__canvas`} onClick={M} title={`Click a region to pick it`} />
      </O>
    </Component20>}
```

| Prop | Value | Notes |
|---|---|---|
| `object` | `null` | Only the mannequin is shown |
| `mannequin` | `k.group` (an `Object3D`) | Built by the panel, **not** by `Preview3D` |
| `version` | `` `${T.version}:${E?.id ?? ``}:${D.version}:${u}` `` (`:294-306`) | composite of design version, paired-item id, paired-item version, skin — any change forces a redraw |
| `target` | `[0, 2.75, 0]` | **inert** (only feeds `frameKey`) |
| `radius` | `3.1` | **inert** |
| `direction` | `He[_.dir]` | `{front:[0,0.12,1], back:[0,0.12,-1], "3/4":[0.65,0.22,1]}` (`:257-261`) |
| `viewKey` | `_.key` | incremented on every facing-button press (`:352-357`) |
| `floor` | `2.6` | **not a `Preview3D` prop** — silently ignored (no `floor` in the destructuring at `Preview3D-CIiMrTBA.js:7-29`). Floor is controlled by the global `viewport.options.floor` preference instead. |
| `spin` | `y` | "Turn slowly" toggle |
| `label` | `` `${e.name} on the avatar` `` | |

**R15/R6 + skin** come from a hook, not from the viewport:

```js
// ClothingPanel-CEM_quBl.js:273-293
let { rig: l, skin: u } = d();                    // d = useAvatarSettings (Outliner-DFI9rtU3.js:109-148)
let k = (0, U.useMemo)(() => he({ rig: l, skin: u }), [l]);   // he = buildAvatar
(0, U.useEffect)(() => () => k.dispose(), [k]);
```

`d` is `T` from `Outliner-DFI9rtU3.js:109` — a `useSyncExternalStore` over `avatarStore-D42IDExD.js`, whose defaults are:

```js
// avatarStore-D42IDExD.js:3-9
var n = { rig: `R15`, skin: e[0].hex, shirt: null, pants: null, source: `blocky` };
```
persisted under `localStorage['robloxkit-avatar']`.

The R15/R6 and skin-tone UI itself is `_Component7` → `k()` in `Outliner-DFI9rtU3.js:158-260` (`<Component7 className="avatar-controls">` with a `segmented` R15/R6 tablist and an `avatar-skins` radiogroup of 7 swatches).

**Front/Back facing** (`:351`, `:352-357`):

```jsx
<Component28 className={`segmented`} role={`group`} aria-label={`Facing`}>
  {[`front`, `back`].map(e => (
    <Component27 type={`button`}
      className={`segmented__option ${_.dir === e ? `segmented__option--active` : ``}`}
      onClick={() => { b(false); v(t => ({ dir: e, key: t.key + 1 })); }}
      key={e}>{e === `front` ? `Front` : `Back`}</Component27>
  ))}
</Component28>
```

State is `const [_, v] = useState({ dir: `3/4`, key: 0 })` (`:280-283`). Pressing a facing button **stops the spin** (`b(false)`) and bumps `key` → `frameKey` changes → re-frame from the new direction.

**"Turn slowly" toggle** (`:284`, `:357`): `const [y, b] = useState(false)` → `spin={y}`.

**Mannequin re-dress** (`:289-306`):

```js
let k = useMemo(() => he({ rig: l, skin: u }), [l]);
useEffect(() => () => k.dispose(), [k]);
let ee = useMemo(() => {
  if (!t) return ``;
  let e = { [t.type]: T.canvas };      // t.type is 'shirt' | 'pants' | 'tshirt'
  if (E) { e[E.type] = D.canvas; }     // paired garment ("wear with a shirt/pants")
  k.update(e, u);                      // <-- mutate the shared avatar in place
  return `${T.version}:${E?.id ?? ``}:${D.version}:${u}`;
}, [k, t, T.version, E, D.version, u, T.canvas, D.canvas]);
```

The `version` string is *produced by* the same `useMemo` that calls `k.update(...)` — so `update` runs and `version` changes in the same pass, guaranteeing exactly one redraw per dress.

**Avatar/Template switch** (`:351`): `view === 'avatar'` renders `Preview3D`; anything else renders the 2D template canvas inside `<O>` (`FitView`).

---

### 8.2 `GeneratorPanel-BNGBBwll.js` — Preview3D, the richest use

```jsx
// GeneratorPanel-BNGBBwll.js:1550
<Dt object={I}
    mannequin={N ? se.avatar?.group ?? false : false}
    version={`${se.version ?? 0}:${pe}:${Ie}`}
    onFrame={de || U ? Te : null}
    floor={N || !M ? Oe.floor : false}
    target={Oe.target} distance={Oe.distance} radius={Oe.radius}
    label={e.name}
    selection={c.map(S).filter(e => e != null)}
    outlines={false}
    onPick={He} onHover={Ge}
    gizmo={J} onGizmoMode={ke ? undefined : T}
    onTransform={qe} onTransformEnd={Ye} onKey={f} />
```

| Prop | Value | Notes |
|---|---|---|
| `object` | `I` | The generated model group |
| `mannequin` | `avatar?.group ?? false` | `false` when no avatar wanted |
| `version` | `` `${se.version ?? 0}:${pe}:${Ie}` `` | avatar version : pose : replay counter |
| `onFrame` | `de \|\| U ? Te : null` | **the only panel that uses `onFrame`** — drives an animation while a build sequence plays |
| `floor` | `Oe.floor` | **ignored** (not a `Preview3D` prop) |
| `target` / `distance` / `radius` | `Oe.*` | all **inert** (only in `frameKey`) |
| `selection` | pickIds | |
| `outlines` | **`false`** | no BoxHelpers — the model's own part meshes carry a coloured `MeshBasicMaterial` duplicate instead (`:1575-1580`: `new Ie({ color: 16722517, side: 1 })` — `#FF2A55`, `FrontSide`) |
| `gizmo` | `J` | `{object, mode, space, snap, bone}` — includes a `bone` hint for rigs |
| `onGizmoMode` | `ke ? undefined : T` | undefined disables the keyboard gizmo shortcuts |
| `onHover` | `Ge` | the only panel using hover |

**Framing is computed by the panel, not by the viewport** — see `Tn` (`:1586-1662`) and `En` (`:1663-1691`), which produce:

```js
// GeneratorPanel-BNGBBwll.js:1588-1595, 1644-1660, 1685-1689
{ target: [0, 1, 0], distance: 8, floor: 4 }                         // empty model
{ target: [0, 0, 0], radius: f, floor: false }                       // accessory
{ target: [0, d[1]/2, 0], radius: f, floor: Math.max(2, f*1.6) }     // free model
{ target: [0, c[1]/2, 0], radius: u, floor: Math.max(2, u*1.6) }     // rigged
```
where `f = max(0.3, hypot(size)/2)` and `u = f * 1.15`.

The result is cached against a key so the frame only changes when the model changes (`:1357-1368`):

```js
let Ee = e ? `${e.id}:${e.current}:${e.updatedAt}:${N}` : null;
let [De, G] = useState({ key: null, frame: null });
if (n && !n.stale && De.key !== Ee) { G({ key: Ee, frame: ce }); }
let Oe = De.key === Ee && De.frame ? De.frame : ce;
```

**Because `target`/`radius`/`distance` are inert, this elaborate framing machinery currently only serves to change `frameKey`.** The camera ends up wherever bounding-sphere auto-fit puts it. This is a live bug worth *not* reproducing.

---

### 8.3 `TexturePanel-D8uJ3dDt.js` — Preview3D, minimal

```jsx
// TexturePanel-D8uJ3dDt.js:478
<Ge ref={i} object={f} mannequin={false} target={p.target} radius={p.radius}
    viewKey={n} version={`${n}:${t}:${e?.size ?? 0}`} label={`Texture preview`} />
```

| Prop | Value |
|---|---|
| `object` | `f` — `Group` containing one `Mesh(geometry, material)` |
| `mannequin` | **`false`** — no avatar at all |
| `target` / `radius` | from `st[n]` (`:361-371`): `plane {target:[0,0,0], radius:6}`, `cube {target:[0,2,0], radius:3.6}`, `sphere {target:[0,2.5,0], radius:2.8}`; for a loaded model, `{target:[0, size[1]/2, 0], radius: max(1, hypot(...size)/2)}` (`:474-477`) |
| `viewKey` | `n` — the shape id, so switching plane→cube re-frames |
| `version` | shape : params : `size` |

This is the **purest demonstration that the viewport is global**: a single arbitrary mesh, no avatar, no gizmo, no picking. It also uses `core()` to build a PMREM environment from the live renderer (`:406-414`):

```js
let t = i.current?.core();
if (!e || !t?.renderer) return;
if (!c.current) {
  let e = new le(t.renderer);                        // PMREMGenerator(renderer)
  c.current = e.fromScene(new rt(), 0.04).texture;   // fromScene(envScene, sigma=0.04)
  e.dispose();
}
```

---

### 8.4 `AnimationPanel-CfAluouO.js` — Viewport direct

```jsx
// AnimationPanel-CfAluouO.js:745
<P ref={f} className={`anim-preview__canvas`} content={b} frameKey={d}
   animate={y} selection={s ? [s] : []} outlines={false}
   onPick={e => c?.(e ?? null)} gizmo={S}
   onTransform={() => { p.current = s; }}
   onTransformEnd={e => { … l?.(t, [e.rotation.x*vt, e.rotation.y*vt, e.rotation.z*vt].map(…)); }}
   label={`Animation preview`} />
```

| Prop | Value | Notes |
|---|---|---|
| `content` | `b = useMemo(() => [h.root], [h])` | a `Group` holding three posed avatars: `main` + `before` ghost + `after` ghost |
| `frameKey` | `d` (from the caller's `${e.id}:${n.rig}`) | |
| `animate` | `y` | the timeline stepper; **calls `core().requestRender()` itself** (`:714`) |
| `selection` | `[s]` — the selected joint id | |
| `outlines` | **`false`** | joints are highlighted by ghost colour instead |
| `onPick` | joint id | |
| `gizmo` | `{object, mode:'rotate', space:'local', snap:{rotate:5}}` (`:737-744`) | **rotate-only, 5° snap, local space** — the only panel using local space + snap |

Ghost colours (`:655-673`): main `#4a7dff`, before `#5b9bff` @ opacity `0.22`, after `#ff8a5b` @ `0.22`.

The gizmo→animation write-back converts radians to degrees and rounds to 0.1 (`:751`): `[e.rotation.x*vt, e.rotation.y*vt, e.rotation.z*vt].map(e => Math.round(e*10)/10)` where `vt = 180/Math.PI`.

---

### 8.5 `CutscenePanel-vZ21pbBO.js` — Viewport direct, cinematic mode

```jsx
// CutscenePanel-vZ21pbBO.js:420
<_Component ref={_} className={`cut-preview__canvas`} content={ee}
            frameKey={null} animate={C} label={`Cutscene preview`} />
```

| Prop | Value | Notes |
|---|---|---|
| `content` | `ee = useMemo(() => [v.root], [v])` | the whole cutscene scene (actors, set, helper) |
| `frameKey` | **`null`** | **never auto-frames** — the camera is driven by the cutscene's own shot camera |
| `animate` | `C` | the playback tick |
| `label` | `'Cutscene preview'` | |

It reaches deep into the core and **takes over the camera**:

```js
// CutscenePanel-vZ21pbBO.js:291-311
let r = _.current?.core();
if (n) {
  t.scene.shotCam.position.set(...n.pos);
  t.scene.shotCam.lookAt(...n.look);
  t.scene.shotCam.fov = n.fov;
  t.scene.shotCam.updateProjectionMatrix();
  t.scene.shotCam.updateMatrixWorld(true);
  t.scene.helper.update();
  t.scene.helper.visible = t.view === `free`;
  if (r && t.view === `camera`) {
    r.controls.enabled = false;
    if (r.camera.near !== 0.1 || r.camera.far < 5000) {
      r.camera.near = 0.1;
      r.camera.far = Math.max(r.camera.far, 5000);
    }
    r.camera.position.set(...n.pos);
    r.camera.lookAt(...n.look);
    r.camera.fov = n.fov;
    r.camera.updateProjectionMatrix();
  }
}
```

and back to free orbit (`:364-375`):

```js
let e = _.current?.core();
if (e) {
  if (f === `free`) {
    e.controls.enabled = true;
    e.camera.fov = 38;
    e.camera.updateProjectionMatrix();
    e.frame(v.root.children.filter(e => e.name !== `ground` && e !== v.helper && !e.isPoints && !e.isCamera));
  }
  S(b.current.t);
}
```

Note it **restores `fov = 38`** — confirming 38 is the engine's contract value. It also calls `frame()` with a *filtered child list*, which is exactly why `frame()` accepts an explicit array.

---

### 8.6 `SkyboxPanel-Dol3AjLh.js` — Viewport direct, environment authoring

```jsx
// SkyboxPanel-Dol3AjLh.js:325
<_Component ref={s} className={`preview3d sky-preview`} content={l}
            frameKey={i} frameDirection={[0.95, 0.16, 1]} label={a}>{o}</_Component>
```

| Prop | Value | Notes |
|---|---|---|
| `content` | `l = useMemo(() => [c], [c])` | `c = it()` — a sample scene: `MeshStandardMaterial` box `4³` at `(0,2,0)` colour `10724005` = `#A3A2A5`, sphere `r=1.5` at `(3.6,1.5,1.6)` colour `12855324` = `#C4281C`… plus a `BoxGeometry(2,1,4)` at `(-3.4,0.5,1.2)` colour `879020` = `#0D69AC`; all `castShadow`+`receiveShadow` (`:168-188`) |
| `frameKey` | `i` (the spec id) | |
| `frameDirection` | **`[0.95, 0.16, 1]`** (array form) | proves the array branch of `frameDirection` |
| `className` | `'preview3d sky-preview'` | **reuses the `preview3d` class** on top of `vp` |
| `children` | `o` | extra overlay DOM |

It **reconfigures the core from the outside** in an effect with `[]` deps (`:203-264`):

```js
let e = s.current?.core();
let t = [];
e.scene.traverse(e => { if (e.isLight && e.visible) { t.push(e); e.visible = false; } });  // hide base lights
e.renderer.shadowMap.enabled = true;
e.renderer.shadowMap.type = 1;                        // PCFShadowMap
let n = new L(new de(160, 72), new _e({ color: 7304056, roughness: 0.9 }));  // CircleGeometry(160,72) #6F7378
n.rotation.x = -Math.PI/2; n.position.y = -0.01; n.receiveShadow = true; n.name = `ground`;
let r = new F(16777215, 4473924, 1);                  // HemisphereLight(#FFFFFF, #444444, 1)
let i = new ve(16777215, 0.2);                        // AmbientLight(#FFFFFF, 0.2)
let a = new P(16777215, 2);                           // DirectionalLight(#FFFFFF, 2)
a.castShadow = true;
a.shadow.mapSize.set(512, 512);
Object.assign(a.shadow.camera, { left:-12, right:12, top:12, bottom:-12, near:1, far:80 });
a.shadow.bias = -0.0005;
let o = new pe();                                     // Object3D target
a.target = o;
e.scene.add(n, r, i, a, o);
```

with a cleanup that removes them, restores `visible = true` on the hidden base lights, and nulls `scene.fog` (`:251-263`). Fog is then driven per-spec (`:317-322`).

The skybox itself is 6 `Mesh(PlaneGeometry(2,2), MeshBasicMaterial{map, depthWrite:false, depthTest:false, fog:false, toneMapped:false})` with `matrixAutoUpdate = false` and hand-built `makeBasis(...).scale(900).setPosition(dir*900)`, `renderOrder = -1000`, `frustumCulled = false` (`:136-167`), plus an `onBeforeRender` that re-pins each face to the camera position (`:271-278`):

```js
e.onBeforeRender = (t, n, r) => {
  e.matrixWorld.copy(e.matrix);
  e.matrixWorld.elements[12] += r.position.x;
  e.matrixWorld.elements[13] += r.position.y;
  e.matrixWorld.elements[14] += r.position.z;
};
```

---

### 8.7 `VfxPanel-WhOgBy41.js` — Viewport direct, most `core()` usage

```jsx
// VfxPanel-WhOgBy41.js:662
<_Component ref={L} className={`vfx-preview__canvas`}
  content={Te} frameKey={`${t ?? ``}:${me ? `m:${ue}` : +!!k}`}
  animate={xe} selection={i} onPick={a} gizmo={o}
  onGizmoMode={s} onTransform={c} onTransformEnd={l} onKey={f}
  version={ge} label={`Effect preview`}>{p}</_Component>
```

| Prop | Value |
|---|---|
| `content` | `Te = useMemo(() => [P?.group, me ? de.group : k && he ? he.group : null].filter(Boolean), …)` — **effect group + optional avatar/model group**, the clearest proof that content is an arbitrary list |
| `frameKey` | `` `${specId}:${modelMode ? 'm:'+modelId : +!!avatarOn}` `` |
| `animate` | `xe` — the particle ticker |
| `selection` / `onPick` | emitter/attachment ids, `additive` supported at the caller |
| `gizmo` | translate/scale, world space |
| `version` | `ge` — the avatar's version, so re-dressing redraws |

Uses `core().camera` four times (`:585, :600, :619`) because the particle simulation is **camera-facing** (`scene.step(dt, camera, …)`) — the effect builder needs the live camera for billboarding. And `core().requestRender()` at `:624`.

The effect scene implements the `liveBounds` hook (`scene-BcDA6opp.js:504-520`) so that `frame()` gets exact particle bounds rather than a stale static AABB.

---

### 8.8 Cross-panel comparison

| Panel | Layer | `object` | `mannequin` | `frameKey` | `frameDirection` | `animate` | `outlines` | `gizmo` | `onPick` | `onHover` | `version` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Clothing | Preview3D | `null` | built group | JSON tuple | `He[dir]` | via `spin`/`onFrame` | default | — | — | — | yes |
| Generator | Preview3D | model | avatar group or `false` | — | default | `onFrame` | **`false`** | yes | yes | **yes** | yes |
| Texture | Preview3D | mesh group | **`false`** | — | default | — | default | — | — | — | yes |
| Animation | Viewport | — | — | rig key | default | yes | **`false`** | rotate/local/5° | yes | — | — |
| Cutscene | Viewport | — | — | **`null`** | — | yes | default | — | — | — | — |
| Skybox | Viewport | — | — | spec id | **`[0.95,0.16,1]`** | — | default | — | — | — | — |
| VFX | Viewport | — | — | spec+mode | default | yes | default | yes | yes | — | yes |

**What is identical everywhere:** renderer settings, camera fov/near/far, lights, grid shader, floor, orbit configuration, axis widget, `dispose()` order, `requestRender` semantics. **What varies:** only `content`, framing triggers, and which optional features are switched on.

That is the definition of a global, reusable system.
---

## 9. Reimplementation checklist

Minimum set of pieces to build an equivalent global viewport elsewhere, **in dependency order**, with complexity estimates.

Complexity scale: **S** ≈ <100 LOC / trivial; **M** ≈ 100–250 LOC / one careful pass; **L** ≈ 250–600 LOC / several passes + testing; **XL** ≈ vendor or hand-port.

### Phase 1 — Foundation (do first, nothing else works without it)

| # | Piece | What it must do | Cx | Notes |
|---|---|---|---|---|
| 1.1 | **Host container contract** | A `<div>` with `position:relative; overflow:hidden; width:100%; height:100%` and an absolutely-positioned child `<div>` that the renderer's canvas is appended into. CSS owns all sizing. | **S** | `.vp` / `.vp__canvas` (`Viewport-Dok-fWD-.css`). `container-type: size` enables container queries for toolbar reflow. |
| 1.2 | **Renderer bootstrap** | `WebGLRenderer({antialias:true, alpha:true, preserveDrawingBuffer:true})`, `setPixelRatio(min(dpr,2))`, `outputColorSpace='srgb'`, `autoClear=false`, `appendChild` into host. | **S** | `autoClear=false` is mandatory for the two-pass render (§5.3). `preserveDrawingBuffer` only if you need canvas capture. |
| 1.3 | **Scene + camera** | `Scene` (no background), `PerspectiveCamera(38, aspect, 0.05, 2000)` at `(6,4,10)`. | **S** | fov 38 is a house style; any value works but match it for consistency. |
| 1.4 | **Lighting rig** | `HemisphereLight(#F4F4F5, #16181B, 1.6)` + `DirectionalLight(#FFFFFF, 2.2)@(4,9,6)` + `DirectionalLight(#9FB4FF, 0.6)@(-6,4,-5)`. | **S** | Three lights, no ambient, no shadows. Copy exactly — the cool rim light is what makes it read as a product render. |
| 1.5 | **Content / helpers groups** | Two `Group`s: `content` (user geometry, only thing raycast/framed) and `helpers` (outlines, bounds). | **S** | The separation is load-bearing; do not put user content in `scene` directly. |

**Phase 1 total: ~80 LOC, S.**

### Phase 2 — The grid (highest visual payoff per line)

| # | Piece | Cx | Notes |
|---|---|---|---|
| 2.1 | **Infinite-grid shader** | **M** | 30 lines of GLSL + `ShaderMaterial`. Copy `lt`/`ut` verbatim (`Viewport-D1Bi_VWL.js:1831-1861`). One `PlaneGeometry(1,1)`, `rotation.x = -π/2`, `renderOrder=-100`, `depthWrite=false`, `frustumCulled=false`, `side=DoubleSide`. |
| 2.2 | **LOD + recentring** | **S** | Per frame: `uSize = 10^floor(log10(max(0.5,dist)/6))`, `uFade = max(20, dist*6)`, `uCenter = controls.target`, `scale = uFade*2.2`, `position = (target.x, 0, target.z)`. |
| 2.3 | **Axis colouring in-shader** | **S** | X → `vec3(0.93,0.27,0.33)`, Z → `vec3(0.27,0.52,0.98)`, alpha `0.9*fade`. |

**Phase 2 total: ~70 LOC, M.** This is the piece that makes the viewport look "infinite" and it is worth doing early.

### Phase 3 — Interaction

| # | Piece | Cx | Notes |
|---|---|---|---|
| 3.1 | **OrbitControls** | **XL** | Vendor `three/examples/jsm/controls/OrbitControls.js` (r160+). Do not hand-roll. |
| 3.2 | **Orbit config** | **S** | `enableZoom=false`, `enablePan=true`, `enableDamping=false`; defaults for everything else. **Do not set `minDistance`/`maxDistance`** — the viewport owns zoom. |
| 3.3 | **Custom wheel zoom** | **M** | Exponential `exp(deltaY*0.0015)` (×`0.01` on ctrl/pinch), `deltaMode` 1→×16, 2→×400, clamp to `limits`. Move `camera.position` along the target→camera ray; never use `controls.dolly`. | 
| 3.4 | **Zoom limits derivation** | **S** | `min = max(0.05, min(dist*0.25, radius*1.2))`, `max = dist*6`. |
| 3.5 | **Change → render** | **S** | `controls.addEventListener('change', requestRender)`. OrbitControls already epsilon-gates the event. |
| 3.6 | **ResizeObserver** | **S** | Observe host, `setSize(w,h,false)`, update `camera.aspect`. **Also re-apply DPR here** (RobloxKit does not — fix that). |
| 3.7 | **Keyboard layer** | **M** | 1/3/7/5 view snaps (ctrl = opposite), F = frame selected, Home/A = frame all, Esc = clear pick, forward the rest. Guard with `e.target.closest('input,textarea,select')`. |

**Phase 3 total: ~150 LOC + vendored controls, M–XL.**

### Phase 4 — Framing

| # | Piece | Cx | Notes |
|---|---|---|---|
| 4.1 | **Bounding box union** | **S** | Union `Box3.setFromObject` over visible children; skip invisible. |
| 4.2 | **`liveBounds` hook** | **S** | If `obj.userData.liveBounds?.()` returns a non-empty `Box3`, use it instead of `setFromObject`. Essential for particles/dynamic scenes. |
| 4.3 | **Sphere-fit distance** | **S** | `d = r / sin(min(halfFovV, halfFovH)) * 1.12`, `halfFovH = atan(tan(halfFovV) * aspect)`. **Must use the narrower axis.** |
| 4.4 | **`frame(objects?, direction?)`** | **M** | Set `controls.target = sphere.center`, `camera.position = center + dir*d`, `near = max(0.01, d/500)`, `far = max(2000, d*40)`, `floor.scale = max(4, r*2.2)`, recompute limits, `controls.update()`. Return `{center, radius}`. |
| 4.5 | **Direction table** | **S** | front/back/right/left/top/bottom/persp with the `0.0001` epsilon on orthogonal axes. |
| 4.6 | **`view(name)`** | **S** | Preserve distance, change direction only. |
| 4.7 | **Re-frame token** | **S** | A single `frameKey`/`frameToken` prop. **Use one token, not four** — see the `target`/`radius`/`distance` bug in §7.1. |

**Phase 4 total: ~110 LOC, M.**

### Phase 5 — Render loop

| # | Piece | Cx | Notes |
|---|---|---|---|
| 5.1 | **`requestRender()`** | **S** | Coalesce into one rAF; no-op while the continuous loop runs. |
| 5.2 | **`setAnimation(fn\|null)`** | **M** | rAF chain, `dt = min(0.05, Δ)`, skip work when `document.hidden \|\| !host.isConnected` (but keep the chain), final `requestRender()` on null. |
| 5.3 | **`render()`** | **M** | Update grid uniforms → update outlines → update bounds → `clear()` → `render(scene, camera)` → (optional) axis widget pass with `clearDepth()` + scissor. |
| 5.4 | **Corner axis widget** *(optional)* | **L** | Separate `Scene` + `OrthographicCamera(-1.4,1.4,1.4,-1.4,0.1,10)`, 6 spheres + 3 line stubs, second scissored pass, click → `view(dir)`. Nice-to-have; skip in v1. |

**Phase 5 total: ~90 LOC (without axis widget), M.**

### Phase 6 — Picking & selection

| # | Piece | Cx | Notes |
|---|---|---|---|
| 6.1 | **`pickId` convention** | **S** | `userData.pickId` + `userData.locked`; resolve by walking up parents, first hit wins, `locked` → `null`. |
| 6.2 | **`pickables()` map** | **S** | `Map<pickId, Object3D>`, first-wins. |
| 6.3 | **`_hitAt(u, v)`** | **M** | `Raycaster.setFromCamera(NDC, camera)` on `content.children` recursive, filter invisible, return nearest hit with a resolvable `pickId` + cloned ray. |
| 6.4 | **Click vs drag** | **S** | Record pointerdown position; on pointerup require `< 4 px` movement and `!dragging`. |
| 6.5 | **Hover, rAF-throttled** | **M** | One raycast per frame max; change key `id:uuid:faceIndex`; skip while `event.buttons`; emit `null` on leave. |
| 6.6 | **Selection outlines** | **M** | `BoxHelper(obj, #FFA53D)` with `depthTest=false`, `transparent=true`, `renderOrder=999`; dispose and rebuild on selection change; `update()` each frame. | 
| 6.7 | *(optional)* **Silhouette outlines** | **XL** | If you need real outlines, add `EffectComposer` + `OutlinePass` (or a normal/depth edge shader). Not present in RobloxKit. |

**Phase 6 total: ~130 LOC, M.**

### Phase 7 — Transform gizmo

| # | Piece | Cx | Notes |
|---|---|---|---|
| 7.1 | **TransformControls** | **XL** | Vendor from three examples. |
| 7.2 | **Wiring** | **M** | `setSize(0.85)`; `dragging-changed` → `orbit.enabled = !value` and emit `onTransformEnd` on release; `objectChange` → `onTransform` + render; add `getHelper()` to scene. |
| 7.3 | **`setGizmo(obj, {mode, space, snap})`** | **S** | `detach()` when null; `attach()` only if different object; convert `snap.rotate` degrees→radians. |

**Phase 7 total: ~50 LOC + vendored controls, M–XL.** Skippable if you have no authoring use case.

### Phase 8 — React layer

| # | Piece | Cx | Notes |
|---|---|---|---|
| 8.1 | **Mount core once** | **S** | `useEffect(() => { const c = new Core(hostRef.current, cb); return () => c.dispose(); }, [])`. |
| 8.2 | **Latest-callback ref** | **S** | `const cbRef = useRef(cb); cbRef.current = cb;` and hand the core a stable shim. This is the trick that keeps the class long-lived. |
| 8.3 | **One `useEffect` per prop** | **S** | `useEffect(() => core?.setContent(content), [content])` etc. Declarative → imperative. |
| 8.4 | **`useImperativeHandle`** | **S** | `{ frame, frameSelected, view, core }`. `core()` is the escape hatch every advanced panel needs. |
| 8.5 | **Persisted viewport options** | **M** | A localStorage-backed `useSyncExternalStore` for `{grid, floor, wireframe, bounds}` + `backdrop`. Global across all viewports. |
| 8.6 | **Toolbar chrome** | **M** | View-snap buttons, frame-all, frame-selected, 4 option toggles, backdrop cycler. Pure React over `core` methods. |

**Phase 8 total: ~200 LOC, M.**

### Phase 9 — Content adapters (per use case, not core)

| # | Piece | Cx | Notes |
|---|---|---|---|
| 9.1 | **`Preview3D` wrapper** *(if you need a mannequin)* | **M** | `[object, mannequinGroup].filter(Boolean)` + `spin`/`onFrame` animate wiring + content disposal. |
| 9.2 | **Avatar builder** *(if you need a mannequin)* | **L** | Rig skeleton, segmented box UV remapping, 3 shared atlases, `update(clothes, skin)`, `setPose`, `animate`, `dispose`. |
| 9.3 | **Offscreen capture** *(if you need thumbnails)* | **M** | Singleton renderer at DPR 1, own lighting rig, own fixed framing, `toBlob`/`toDataURL`. |

### Total estimate

| Phase | Complexity | Rough LOC |
|---|---|---|
| 1 Foundation | S | 80 |
| 2 Grid | M | 70 |
| 3 Interaction | M–XL | 150 + vendored OrbitControls |
| 4 Framing | M | 110 |
| 5 Render loop | M | 90 (+120 for axis widget) |
| 6 Picking/selection | M | 130 |
| 7 Gizmo | M–XL | 50 + vendored TransformControls |
| 8 React layer | M | 200 |
| **Core subtotal** | | **~880 LOC + 2 vendored files** |
| 9 Adapters | M–L | 400+ |

**A minimal-but-faithful global viewport (phases 1–5 + 6.1–6.6 + 8) is ~700 LOC.** That is the number to quote.

### Ordered "do this, then this" list

1. Container + CSS (1.1)
2. Renderer + scene + camera + lights (1.2–1.4)
3. Grid shader (2.1–2.3) — **verify visually before going further**
4. Resize + DPR (3.6)
5. `requestRender` + `render()` (5.1, 5.3 without axis pass)
6. OrbitControls + config (3.1–3.2, 3.5)
7. Framing (4.1–4.4) — **verify auto-fit on a known box**
8. Wheel zoom + limits (3.3–3.4)
9. `view()` + direction table (4.5–4.6)
10. `setAnimation` (5.2)
11. Content/helpers separation + `setContent` (1.5)
12. `pickId` + `_hitAt` + click (6.1–6.4)
13. Hover (6.5)
14. Selection outlines (6.6)
15. Options (grid/floor/wireframe/bounds) + floor mesh (2.x + `setOptions`)
16. React layer (8.1–8.4)
17. Keyboard (3.7)
18. Toolbar (8.6) + persisted options (8.5)
19. `dispose()` (5.4 teardown)
20. Axis widget (5.4 optional)
21. Gizmo (7.x)
22. Adapters (9.x)

---

## 10. Gotchas and deviations to NOT reproduce

These are real defects or oddities found in the RobloxKit implementation. A reimplementation should fix them.

| # | Issue | Where | Impact | Fix |
|---|---|---|---|---|
| 1 | **`target` / `radius` / `distance` on `Preview3D` are inert** | `Preview3D-CIiMrTBA.js:42` | Every panel that passes them (`ClothingPanel`, `GeneratorPanel`, `TexturePanel`) believes it controls framing; it does not. Changing `radius` re-frames to the *same* position. | Either implement them as real overrides on `frame()`, or delete them and expose one explicit `frameToken`. |
| 2 | **`floor` is passed but never destructured** | `Preview3D-CIiMrTBA.js:7-29` has no `floor`; `ClothingPanel:351` passes `floor={2.6}`, `GeneratorPanel:1550` passes `floor={Oe.floor}` | Silently ignored. The floor radius is `max(4, radius*2.2)` from `frame()`. | Wire it: `floor` prop → `floor.scale.setScalar(floor)` and/or visibility. |
| 3 | **DPR never refreshed on resize** | `Viewport-D1Bi_VWL.js:1943` sets it once | Dragging a window between a 1× and 2× monitor leaves the canvas blurry/aliased until remount. | Re-apply `setPixelRatio` inside `resize()`, guarded by a change check. |
| 4 | **`setContent` does not dispose old content** | `Viewport-D1Bi_VWL.js:2128-2137` | Callers must own it. `Preview3D` does (`:34-41`); a careless panel leaks GPU memory. | Either dispose in `setContent` (with an opt-out) or make ownership explicit in the type signature. |
| 5 | **`window.__viewports` is deleted but never populated** | `Viewport-D1Bi_VWL.js:2373-2375` | Dead code / debugging leftover. `grep` confirms exactly one occurrence in the whole bundle. | Drop it, or actually register instances for devtools. |
| 6 | **`autoRotateSpeed` in `Preview3D` is applied inside the animation callback every frame** | `Preview3D-CIiMrTBA.js:48-53` | Redundant assignment per frame (cheap, but noisy). Also `controls.update()` is called *and* the loop then calls `render()` — the update is needed but the coupling is implicit. | Set `autoRotate`/`autoRotateSpeed` in a `useEffect` keyed on `spin`, and let the animation loop only call `controls.update()`. |
| 7 | **`_move` hover handler ignores `onHover` identity changes** | `Viewport-D1Bi_VWL.js:2314-2338` reads `this.cb.onHover` | Fine because `cb` is a stable shim from the React layer (`:2443-2448`), but a direct consumer of the class that mutates `cb.onHover` after construction gets stale behaviour on the *first* check (`if (!this.cb.onHover) return;`) while subsequent calls use the new one. Inconsistent. | Read the callback into a local at the top of the handler. |
| 8 | **`elapsed` in `setAnimation` is wall-clock, not integrated `dt`** | `Viewport-D1Bi_VWL.js:2059, 2072` | A hidden tab makes `elapsed` jump on return, which breaks animations that assume monotonic accumulation. `dt` is correctly clamped; `elapsed` is not. | Accumulate `elapsed += dt` instead of `(now - start)/1000`. |
| 9 | **`frame()` reads `this.camera.aspect \|\| 1`** | `Viewport-D1Bi_VWL.js:2222` | If `frame()` is called before `resize()` (aspect still 1), horizontal fit is wrong for wide viewports. | Always call `resize()` in the constructor *before* any `frame()` — it does (`:2046`), but a caller invoking `frame()` from a `useEffect` that runs before the ResizeObserver fires can hit aspect=1. |
| 10 | **Selection outlines are bounding boxes, not silhouettes** | `Viewport-D1Bi_VWL.js:2160` | A rotated object gets a large axis-aligned-ish box that over-reports its extent; visually ambiguous for thin objects. | Acceptable, but document it. If you need silhouettes, add a real outline pass. |
| 11 | **`getHelper ? g.getHelper() : g`** | `Viewport-D1Bi_VWL.js:2037` | Defensive check for a method that always exists on the vendored class. Harmless, but signals the code was written against two different TransformControls versions. | Just call `g.getHelper()`. |
| 12 | **`at(e, t)` parameter names are misleading** | `Viewport-D1Bi_VWL.js:1799-1804` declares `at(e, t)` but is called as `at(distance, radius)` (`:2223`) | A reader will assume `min` is radius-derived. It is distance-derived. | Rename to `at(distance, radius)`. |

---

## 11. Quick-reference appendix

### 11.1 Every numeric constant

| Constant | Value | Meaning | Line |
|---|---|---|---|
| fov | `38` | camera vertical fov (deg) | `1950` |
| near / far (initial) | `0.05` / `2000` | | `1950` |
| camera position | `(6, 4, 10)` | | `1951` |
| near / far (framed) | `max(0.01, d/500)` / `max(2000, d*40)` | | `2227-2228` |
| fit padding | `1.12` | | `1794` |
| min sphere radius | `0.25` | frame() clamp | `2221` |
| fallback AABB | `min(-1,0,-1)` `max(1,2,1)` | empty content | `2218` |
| zoom min | `max(0.05, min(d*0.25, r*1.2))` | | `1801` |
| zoom max | `d * 6` | | `1802` |
| wheel exponent | `0.0015` (wheel) / `0.01` (pinch) | | `1813` |
| deltaMode mult | `1→16`, `2→400` | | `1812` |
| click slop | `4` px | | `2282` |
| grid LOD base | `10^floor(log10(max(0.5,d)/6))` | | `1863` |
| grid fade | `max(20, d*6)` | | `2090` |
| grid scale | `uFade * 2.2` | | `2092` |
| floor scale | `max(4, r*2.2)` | | `2231` |
| floor y | `-0.002` | | `1993` |
| axis widget size | `76` px | | `2040` |
| axis widget top | `48` px | | `2041` |
| axis widget inset | `8` px | | `2114` |
| axis ortho cam | `(-1.4, 1.4, 1.4, -1.4, 0.1, 10)` | | `1918` |
| axis cam distance | `4` | | `2109` |
| gizmo size | `0.85` | | `2023` |
| gizmo world scale cap | `7` | | `1597` |
| spin speed | `1.6` | | `Preview3D-CIiMrTBA.js:51` |
| max dt | `0.05` s | | `2070` |
| DPR cap | `2` | | `1943` |
| offscreen fov | `30` | | `42` |
| offscreen distance | `12.5` | | `44` |
| offscreen target | `(0, 2.75, 0)` | | `43` |

### 11.2 Every colour

| Purpose | Decimal | Hex | Line |
|---|---|---|---|
| Hemi sky | `16053493` | `#F4F4F5` | `1953` |
| Hemi ground | `1447963` | `#16181B` | `1953` |
| Key light | `16777215` | `#FFFFFF` | `1954` |
| Rim light | `10466559` | `#9FB4FF` | `1956` |
| Grid lines | `9080729` | `#8A8F99` | `1973` |
| Grid X axis (GLSL) | — | `vec3(0.93,0.27,0.33)` ≈ `#ED4554` | `1857` |
| Grid Z axis (GLSL) | — | `vec3(0.27,0.52,0.98)` ≈ `#4585FA` | `1858` |
| Floor | `1776929` | `#1B1D21` | `1986` |
| Selection outline | `16753981` | `#FFA53D` | `2160` |
| Bounds helper | `8226708` | `#7D8794` | `2194` |
| Axis X | `15615316` | `#EE4554` | `1894` |
| Axis Y | `7128938` | `#6CC76A` | `1894` |
| Axis Z | `4556282` | `#4585FA` | `1894` |
| Offscreen hemi ground | `2763306` | `#2A2A2A` | `23` |
| Offscreen sheet bg | `1447963` | `#16181B` | `72` |
| Offscreen 2D fill | — | `#101113` | `77` |
| Skybox ground | `7304056` | `#6F7378` | `218` |
| Skybox hemi ground | `4473924` | `#444444` | `225` |
| CSS viewport bg | — | `#0e0f13` | `index-BYCtJRfu.css` |
| CSS viewport light | — | `#dfe2e7` | `index-BYCtJRfu.css` |
| CSS checker a / b | — | `#1f2025` / `#16171b` | `index-BYCtJRfu.css` |

### 11.3 Event listener inventory

**On `renderer.domElement` (viewport-owned, removed in `dispose`):**

| Event | Handler | Purpose | Line |
|---|---|---|---|
| `wheel` | `_wheel` | custom zoom | `2264` |
| `pointerdown` | `_down` | record click origin | `2347` |
| `pointerup` | `_up` | click / axis-widget pick | `2348` |
| `pointermove` | `_move` | hover raycast (rAF-throttled) | `2345` |
| `pointerleave` | `_leave` | clear hover | `2346` |
| `dblclick` | `_dbl` | frame all | `2350` |

**Added by vendored OrbitControls (`connect()`, `:151-163`):** `pointerdown`, `pointercancel`, `contextmenu`, `wheel` (passive:false), `keydown` on root node (capture, passive), `pointermove`/`pointerup` on drag start.

**Added by vendored TransformControls (`connect()`, `:1030-1035`):** `pointerdown`, `pointermove` (hover), `pointerup`, and `pointermove` during drag.

**React:** `onKeyDown` on the container div (`:2511`).

### 11.4 The complete `Viewport` JSX shell

```jsx
<div className={`vp vp--${backdrop} ${className}`} tabIndex={0} role="application"
     aria-label={label} onKeyDown={…}>
  <div ref={hostRef} className="vp__canvas" />
  <div className="vp__toolbar" role="toolbar" aria-label="View">
    <div className="vp__group">
      {[['front','Front','1'],['right','Right','3'],['top','Top','7'],['persp','Persp','5']].map(…)}
    </div>
    <div className="vp__group">
      <button title="Frame all (Home)" onClick={() => core.frame()}>…</button>
      <button title="Frame selected (F)" disabled={!selection.length} onClick={frameSelected}>…</button>
    </div>
    <div className="vp__group">
      <button className={grid ? 'is-on' : ''} onClick={() => toggle('grid')}>…</button>
      <button className={floor ? 'is-on' : ''} onClick={() => toggle('floor')}>…</button>
      <button className={wireframe ? 'is-on' : ''} onClick={() => toggle('wireframe')}>…</button>
      <button className={bounds ? 'is-on' : ''} onClick={() => toggle('bounds')}>…</button>
      <button title={`Backdrop: ${backdrop}`} onClick={cycleBackdrop}>…</button>
    </div>
  </div>
  {children}
</div>
```

---

*Report generated from static analysis of the unminified bundle. No files in `artifacts/frontend_unmin/` were modified.*
