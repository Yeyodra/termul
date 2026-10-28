# The generator feature in Termul, as it stands on `dev`

**Scope.** The `generate_clothing` pipeline end to end: the design schema, the pixel renderer, the
prompt, the design loop, the tool envelope, the MCP tool surface, the Rust frame plumbing, and which
agent answers a generation turn.

**Method.** Every claim below is read out of the working tree at
`C:\Users\Novella\Documents\Github\termul` on branch `dev`, HEAD `31901d7c`
(`fix(generator): give the tool the argument its validator requires`). Nothing was built, nothing was
run, no source file was modified. Line numbers are 1-based.

**Comparison baseline.** Where this file says "RobloxKit does X", X is read from
`.omo/roblox-fix/01-robloxkit-clothing-design.md`, which is itself a de-minified read of the shipping
RobloxKit SPA. That file is the authority for the reference implementation in this repo.

**Headline.** The geometry is a faithful port. The review pipeline is not: the review image is the
raw UV atlas rather than the avatar sheet, and that image is then dropped on the way to the model,
so the render, review and fix loop is structurally blind. The agent that answers a generation turn
is also chosen by a lookup that can never match. Details and `file:line` in section 9.

---

## READ THIS FIRST - the working tree moved while this report was written

This report was compiled against HEAD `31901d7c`. **While the session was running, an uncommitted
change landed in the working tree** that rewrites large parts of the clothing engine. `git status`
at the end of the session:

```
 M src-tauri/src/acp/host_mcp/child.rs
 M src-tauri/src/acp/host_mcp/generator_e2e_tests.rs
 M src-tauri/src/acp/host_mcp/generator_tools.rs
 M src/renderer/lib/generator/engines/clothing/__tests__/clothing.test.ts
 M src/renderer/lib/generator/engines/clothing/build.ts
 M src/renderer/lib/generator/engines/clothing/render.ts
 M src/renderer/lib/generator/tools/generate-clothing.ts
 M vitest.setup.ts
?? src/renderer/lib/generator/engines/clothing/check.ts
?? src/renderer/lib/generator/engines/clothing/png.ts
?? src/renderer/lib/generator/engines/clothing/report.ts
?? src/renderer/lib/generator/engines/clothing/shapes.ts
?? src/renderer/lib/generator/engines/clothing/vector.ts
```

Five new modules appeared (`check.ts`, `report.ts`, `vector.ts`, `shapes.ts`, and a rewritten
`png.ts`); `build.ts` went from 98 to 139 lines and `render.ts` from 143 to 234. The sections below
describe the **committed** state at `31901d7c` - what `git show HEAD:<path>` yields - and every
affected finding carries a note saying whether the in-flight change fixes it. Re-verified against the
working tree at the end of the session:

| Finding | Status at end of session |
|---|---|
| G3 - vector kinds paint nothing | **fixed in the working tree**: new `vector.ts` + `shapes.ts` draw all four |
| G7 - `report.ok` always true | **still true**, now documented as deliberate at `check.ts:13-15` |
| G8 - `background` masks coverage | **fixed in the working tree**: `check.ts` samples per region |
| G9 - `layout` is a static atlas dump | **fixed in the working tree**: new `report.ts` builds a layer inventory |
| G19 - `render.ts` header lies about batching | **fixed in the working tree**: the batch is now real |
| G4 - `image` cannot validate | **half-fixed**: `buildClothing` takes `images: string[]`, but no caller passes it |
| G1, G2, G5, G6, G11-G18, G20-G24 | **unchanged**: still present in the working tree |

Everything in section 9 not marked fixed was re-checked against the working tree and is still
accurate.

---

# 1. Design schema

## 1.1 Where it lives

| Concern | File |
|---|---|
| Types, constants, validator | `src/renderer/lib/generator/engines/clothing/schema.ts` |
| Region atlas, target resolution | `src/renderer/lib/generator/engines/clothing/layout.ts` |
| Per-pixel pattern functions | `src/renderer/lib/generator/engines/clothing/pattern.ts` |
| Design → RGBA buffer | `src/renderer/lib/generator/engines/clothing/render.ts` |
| RGBA buffer → PNG data URL | `src/renderer/lib/generator/engines/clothing/png.ts` |
| Validate + render + describe | `src/renderer/lib/generator/engines/clothing/build.ts` |
| System prompt | `src/renderer/lib/generator/engines/clothing/prompt.ts` |
| Barrel | `src/renderer/lib/generator/engines/clothing/index.ts` |

## 1.2 The enumerations, verbatim

`schema.ts:12-37`:

```ts
export const DESIGN_TYPES = ['shirt', 'pants', 'tshirt'] as const
export type DesignType = (typeof DESIGN_TYPES)[number]

export const LAYER_KINDS = [
  'solid',
  'gradient',
  'stripes',
  'checks',
  'plaid',
  'polka',
  'zigzag',
  'camo',
  'noise',
  'text',
  'image',
  'shape',
  'trim'
] as const

export const SHAPES = ['rect', 'circle', 'star', 'heart', 'diamond', 'triangle'] as const
export const FONTS = ['sans', 'serif', 'mono', 'display'] as const
export const EDGES = ['top', 'bottom', 'left', 'right', 'all', 'sides'] as const

export const LIMITS = { layers: 40, text: 60 } as const

const COLOR_RE = /^#[0-9a-f]{6}$/i
```

Thirteen layer kinds. Nine of them are procedural patterns (`solid` … `noise`), four are "vector" kinds
(`text`, `image`, `shape`, `trim`). §3 shows that only the nine procedural kinds actually paint.

## 1.3 Parts and sides

`schema.ts:39-46`:

```ts
/** The parts each garment type has, used to answer "does this target exist". */
const PARTS: Record<DesignType, string[]> = {
  shirt: ['torso', 'right_arm', 'left_arm'],
  pants: ['torso', 'right_leg', 'left_leg'],
  tshirt: ['torso']
}

const SIDES = ['front', 'back', 'left', 'right', 'up', 'down']
```

## 1.4 The accepted JSON — every field

`schema.ts:48-92`, verbatim:

```ts
/** A design as the model authors it. Only `type` and `layers` are required. */
export interface ClothingDesign {
  type: DesignType
  background?: string | null
  name?: string
  layers: ClothingLayer[]
}

export interface ClothingLayer {
  id?: string
  name?: string
  kind: string
  target?: string
  color?: string | null
  color2?: string | null
  color3?: string | null
  from?: string | null
  to?: string | null
  outline?: string | null
  outlineWidth?: number
  x?: number
  y?: number
  w?: number
  h?: number
  opacity?: number
  size?: number
  gap?: number
  angle?: number
  seed?: number
  text?: string
  font?: string
  weight?: number
  offsetX?: number
  offsetY?: number
  shape?: string
  edge?: string
  width?: number
  image?: number
  src?: string
  fit?: string
  scale?: number
  hidden?: boolean
  locked?: boolean
  [key: string]: unknown
}
```

Note `[key: string]: unknown` — the validator is open, so an unknown field is accepted and ignored.

**Fields that are declared but read by nothing in the render path** (§3 proves this): `id`, `name`,
`outline`, `outlineWidth`, `x`, `y`, `w`, `h`, `text`, `font`, `weight`, `offsetX`, `offsetY`,
`shape`, `edge`, `width`, `image`, `src`, `fit`, `scale`, `locked`. `ClothingLayer` declares **34** fields. Only **13** are read by the render path; the other **21** are validated (or not) and then ignored.

**Fields the renderer actually consumes:** `kind`, `target`, `hidden`, `opacity`, `color`, `color2`,
`color3`, `from`, `to`, `size`, `gap`, `angle`, `seed`. Nine of those 13 are pattern-only.

## 1.5 Target resolution — the validator's rule

`schema.ts:94-114`, verbatim:

```ts
/** The region ids a design type exposes. */
export function regionIds(type: DesignType): string[] {
  return PARTS[type]
}

/**
 * Does `target` name at least one region of `type`?
 *
 * Static targets are `all`, a part name, or a side. A region id counts too,
 * because the full atlas is per-garment and resolved at render time.
 */
export function targetResolves(type: DesignType, target: string): boolean {
  if (target === 'all') return true
  if (PARTS[type].includes(target)) return true
  if (SIDES.includes(target)) return true
  return target.includes('_') && PARTS[type].some((part) => target.startsWith(part))
}

function partList(type: DesignType): string {
  return [...new Set(PARTS[type])].join(', ')
}
```

The last clause is a prefix test, not a membership test. `torso_zzz` passes validation (it contains
`_` and starts with `torso`), then `resolveTarget` returns `[]` and the layer paints nothing. See §9.

## 1.6 The validator, verbatim

`schema.ts:116-235`:

```ts
/**
 * Every problem with a design, in the order the original reports them.
 *
 * Returns `[]` when the design is valid. The strings are echoed to the model
 * verbatim, so do not reword them.
 */
export function validateDesign(
  design: unknown,
  { images = 0 }: { images?: number } = {}
): string[] {
  const problems: string[] = []
  const fail = (field: string, message: string) => problems.push(`${field}: ${message}`)

  if (!design || typeof design !== 'object') {
    return ['the design is not an object']
  }

  const candidate = design as Partial<ClothingDesign>

  if (!DESIGN_TYPES.includes(candidate.type as DesignType)) {
    fail('type', `must be one of ${DESIGN_TYPES.join(', ')}`)
  }
  if (candidate.background != null && !COLOR_RE.test(String(candidate.background))) {
    fail('background', 'must be #rrggbb or null')
  }
  if (!Array.isArray(candidate.layers) || !candidate.layers.length) {
    fail('layers', 'needs at least one layer')
  }
  if ((candidate.layers?.length ?? 0) > LIMITS.layers) {
    fail('layers', `at most ${LIMITS.layers}`)
  }

  const type = (
    DESIGN_TYPES.includes(candidate.type as DesignType) ? candidate.type : 'shirt'
  ) as DesignType

  const checkColor = (field: string, value: unknown) => {
    if (value != null && !COLOR_RE.test(String(value))) {
      fail(field, `"${value}" is not a #rrggbb colour`)
    }
  }
  const checkUnit = (field: string, value: unknown) => {
    if (value != null && (!(Number(value) >= 0) || !(Number(value) <= 1))) {
      fail(field, 'must be a number from 0 to 1')
    }
  }
  const checkRange = (field: string, value: unknown, low: number, high: number) => {
    if (value != null && (!(Number(value) >= low) || !(Number(value) <= high))) {
      fail(field, `must be a number from ${low} to ${high}`)
    }
  }

  const layers = Array.isArray(candidate.layers) ? candidate.layers : []

  layers.forEach((layer, index) => {
    const at = `layers[${index}]`

    if (!layer || typeof layer !== 'object') {
      fail(at, 'is not an object')
      return
    }

    if (!LAYER_KINDS.includes(layer.kind as (typeof LAYER_KINDS)[number])) {
      fail(`${at}.kind`, `"${layer.kind}" is not one of ${LAYER_KINDS.join(', ')}`)
      return
    }

    const target = layer.target ?? 'all'
    if (!targetResolves(type, String(target))) {
      fail(
        `${at}.target`,
        `"${layer.target}" names no region of a ${type}; use all, a part (${partList(type)}), a side (${SIDES.join(', ')}) or a region id`
      )
    }

    for (const field of ['color', 'color2', 'color3', 'from', 'to', 'outline']) {
      checkColor(`${at}.${field}`, layer[field])
    }
    for (const field of ['x', 'y', 'w', 'h', 'opacity']) {
      checkUnit(`${at}.${field}`, layer[field])
    }
    checkRange(`${at}.size`, layer.size, 1, 400)
    checkRange(`${at}.gap`, layer.gap, 0, 400)
    checkRange(`${at}.angle`, layer.angle, -360, 360)

    if (layer.kind === 'text') {
      if (!layer.text || String(layer.text).length > LIMITS.text) {
        fail(`${at}.text`, `1 to ${LIMITS.text} characters`)
      }
      if (layer.font && !FONTS.includes(layer.font as (typeof FONTS)[number])) {
        fail(`${at}.font`, `one of ${FONTS.join(', ')}`)
      }
    }

    if (layer.kind === 'shape' && layer.shape && !SHAPES.includes(layer.shape as never)) {
      fail(`${at}.shape`, `one of ${SHAPES.join(', ')}`)
    }

    if (layer.kind === 'trim' && layer.edge && !EDGES.includes(layer.edge as never)) {
      fail(`${at}.edge`, 'one of top, bottom, left, right, sides, all')
    }

    if (layer.kind === 'image') {
      if (layer.image == null && !layer.src) {
        const range = images > 1 ? `0..${images - 1}` : '0'
        fail(at, `an image layer needs "image": the number of an attached picture (${range})`)
      } else if (
        layer.image != null &&
        (!Number.isInteger(layer.image) || layer.image < 0 || layer.image >= images)
      ) {
        fail(
          `${at}.image`,
          images ? `must be 0..${images - 1}` : 'no pictures are attached; remove this layer'
        )
      }
    }
  })

  return problems
}
```

And the loop's normalize hook, `schema.ts:237-243`:

```ts
/**
 * The loop's `normalize` hook: the garment type is decided by the tool call, so
 * the model can never change it (`clothing-62l72JIa.js:125-128`).
 */
export function normalizeDesign(design: ClothingDesign, type: DesignType): ClothingDesign {
  return { ...design, type }
}
```

## 1.7 Numeric limits — the complete table

| Field | Rule | Where | Message on failure |
|---|---|---|---|
| `layers` count | `>= 1` | `schema.ts:141-143` | `layers: needs at least one layer` |
| `layers` count | `<= 40` (`LIMITS.layers`) | `schema.ts:144-146` | `layers: at most 40` |
| `layers[i].text` | length `1..60` (`LIMITS.text`) | `schema.ts:202-204` | `layers[i].text: 1 to 60 characters` |
| `size` | `1..400` | `schema.ts:197` | `...size: must be a number from 1 to 400` |
| `gap` | `0..400` | `schema.ts:198` | `...gap: must be a number from 0 to 400` |
| `angle` | `-360..360` | `schema.ts:199` | `...angle: must be a number from -360 to 360` |
| `x`,`y`,`w`,`h`,`opacity` | `0..1` | `schema.ts:194-196` | `...opacity: must be a number from 0 to 1` |
| any colour field | `/^#[0-9a-f]{6}$/i` | `schema.ts:37`, `:191-193` | `...color: "#xyz" is not a #rrggbb colour` |
| `background` | `#rrggbb` or `null` | `schema.ts:138-140` | `background: must be #rrggbb or null` |
| `image` | integer, `0..images-1` | `schema.ts:222-230` | `...image: must be 0..N` / `no pictures are attached; remove this layer` |

The validator is a pure collector: it never clamps and never stops early, except that a bad `kind`
`return`s from that layer's callback (`schema.ts:178-181`), skipping that layer's remaining checks.

`checkUnit` / `checkRange` use `!(Number(value) >= low)` rather than `<`, so `NaN` is rejected as
well. Good.

## 1.8 How the type is forced

`build.ts:53-59`:

```ts
export function buildClothing(
  spec: unknown,
  { type, images = 0 }: ClothingBuildOptions
): BuildResult {
  const normalized = normalizeDesign(spec as ClothingDesign, type)
  const problems = validateDesign(normalized, { images })
  if (problems.length) throw new DesignRejected(problems)
```

`normalizeDesign` overwrites `type` with the tool-call's type *before* validation, so a model that
writes `"type": "pants"` into a `shirt` call is silently corrected. Matches RobloxKit's
`normalize` hook.

---

# 2. Renderer geometry

## 2.1 Canvas dimensions, verbatim

`layout.ts:25-33`:

```ts
/** Sheet edge length for the full-body garments. */
export const SHEET_SIZE = 512

/** PNG dimensions per garment type. */
export const SHEET_DIMENSIONS: Record<DesignType, { width: number; height: number }> = {
  shirt: { width: 585, height: 559 },
  pants: { width: 585, height: 559 },
  tshirt: { width: 512, height: 512 }
}
```

- `shirt`, `pants`: **585 × 559** = 327,015 px.
- `tshirt`: **512 × 512** = 262,144 px.

These match RobloxKit exactly (`01-robloxkit-clothing-design.md` §2.2). `SHEET_SIZE = 512` is
exported from `index.ts:13` and referenced nowhere else in the tree — dead constant that happens to
equal only the t-shirt size, so it is actively misleading.

## 2.2 The torso rects, verbatim

`layout.ts:35-42`:

```ts
const TORSO: Region[] = [
  { id: 'torso_right', part: 'torso', face: 'right', x: 165, y: 74, w: 64, h: 128 },
  { id: 'torso_front', part: 'torso', face: 'front', x: 231, y: 74, w: 128, h: 128 },
  { id: 'torso_left', part: 'torso', face: 'left', x: 361, y: 74, w: 64, h: 128 },
  { id: 'torso_back', part: 'torso', face: 'back', x: 427, y: 74, w: 128, h: 128 },
  { id: 'torso_up', part: 'torso', face: 'up', x: 231, y: 8, w: 128, h: 64 },
  { id: 'torso_down', part: 'torso', face: 'down', x: 231, y: 204, w: 128, h: 64 }
]
```

## 2.3 The limb builder, verbatim

`layout.ts:44-62`:

```ts
function limb(part: string, x0: number, faces: string[], upX: number): Region[] {
  const side = faces.map((face, index) => ({
    id: `${part}_${face}`,
    part,
    face,
    x: x0 + index * 66,
    y: 355,
    w: 64,
    h: 128
  }))
  return [
    ...side,
    { id: `${part}_up`, part, face: 'up', x: upX, y: 289, w: 64, h: 64 },
    { id: `${part}_down`, part, face: 'down', x: upX, y: 485, w: 64, h: 64 }
  ]
}

const RIGHT = (part: string) => limb(part, 19, ['left', 'back', 'right', 'front'], 217)
const LEFT = (part: string) => limb(part, 308, ['front', 'left', 'back', 'right'], 308)
```

Stride 66, face width 64 → a 2 px gutter between consecutive faces. Face order differs per side:
the right limb runs `left, back, right, front`; the left limb runs `front, left, back, right`. This
is the actual Roblox R6 unwrap order and it is reproduced correctly.

## 2.4 The t-shirt region, verbatim

`layout.ts:64-66`:

```ts
const TSHIRT: Region[] = [
  { id: 'graphic', part: 'torso', face: 'front', x: 0, y: 0, w: 512, h: 512 }
]
```

## 2.5 Every rect, resolved

**Torso (all three garment types):**

| id | part | face | x | y | w | h |
|---|---|---|---|---|---|---|
| `torso_right` | torso | right | 165 | 74 | 64 | 128 |
| `torso_front` | torso | front | 231 | 74 | 128 | 128 |
| `torso_left` | torso | left | 361 | 74 | 64 | 128 |
| `torso_back` | torso | back | 427 | 74 | 128 | 128 |
| `torso_up` | torso | up | 231 | 8 | 128 | 64 |
| `torso_down` | torso | down | 231 | 204 | 128 | 64 |

**Right limb — `right_arm` on a shirt, `right_leg` on pants** (`x0 = 19`, `upX = 217`):

| id | x | y | w | h |
|---|---|---|---|---|
| `<part>_left` | 19 | 355 | 64 | 128 |
| `<part>_back` | 85 | 355 | 64 | 128 |
| `<part>_right` | 151 | 355 | 64 | 128 |
| `<part>_front` | 217 | 355 | 64 | 128 |
| `<part>_up` | 217 | 289 | 64 | 64 |
| `<part>_down` | 217 | 485 | 64 | 64 |

**Left limb — `left_arm` on a shirt, `left_leg` on pants** (`x0 = 308`, `upX = 308`):

| id | x | y | w | h |
|---|---|---|---|---|
| `<part>_front` | 308 | 355 | 64 | 128 |
| `<part>_left` | 374 | 355 | 64 | 128 |
| `<part>_back` | 440 | 355 | 64 | 128 |
| `<part>_right` | 506 | 355 | 64 | 128 |
| `<part>_up` | 308 | 289 | 64 | 64 |
| `<part>_down` | 308 | 485 | 64 | 64 |

**T-shirt:** one region, `graphic`, `(0,0,512,512)`.

## 2.6 Region counts and coverage

`layout.ts:68-78`:

```ts
/** Every region a garment type has, in sheet order. */
export function regionsFor(type: DesignType): Region[] {
  switch (type) {
    case 'tshirt':
      return TSHIRT
    case 'pants':
      return [...TORSO, ...RIGHT('right_leg'), ...LEFT('left_leg')]
    default:
      return [...TORSO, ...RIGHT('right_arm'), ...LEFT('left_arm')]
  }
}
```

18 regions for shirt and pants, 1 for t-shirt. The pinned test
(`engines/clothing/__tests__/clothing.test.ts:200-204`) asserts exactly this.

Region area: 6 torso faces = 2x(64x128) + 2x(128x128) + 2x(128x64) = 16,384 + 32,768 + 16,384 =
65,536 px. Each limb = 4x(64x128) + 2x(64x64) = 32,768 + 8,192 = 40,960 px. Shirt total =
65,536 + 2x40,960 = **147,456 px of 327,015 = 45.1 %** of the sheet, matching
`01-robloxkit-clothing-design.md` §2.3. The other 54.9 % is margin, gutter between limb faces (the
2 px at a 66 px stride), and the inter-limb gap.

## 2.7 Target resolution at render time, verbatim

`layout.ts:80-97`:

```ts
/**
 * Resolve a layer target to the regions it paints.
 *
 * Precedence: exact region id, then part name, then face name. The middle step
 * is why `"torso"` covers six regions while `"left"` covers three.
 */
export function resolveTarget(type: DesignType, target = 'all'): Region[] {
  const regions = regionsFor(type)
  if (target === 'all') return regions

  const byId = regions.filter((region) => region.id === target)
  if (byId.length) return byId

  const byPart = regions.filter((region) => region.part === target)
  if (byPart.length) return byPart

  return regions.filter((region) => region.face === target)
}
```

Precedence: exact id → part → face. `target: "torso"` paints 6 regions. `target: "left"` paints 3
regions (every left-facing face, *not* the left arm). `target: "right_arm"` paints 6.

If nothing matches, this returns `[]` — a silent no-op, not an error.

## 2.8 How a design becomes pixels, verbatim

`render.ts:81-110`:

```ts
/**
 * Render a design to an RGBA buffer.
 *
 * Vector layers are skipped; a design with only vector layers yields the
 * background, which the validator already treats as valid.
 */
export function renderPixels(design: ClothingDesign): RenderedSheet {
  const { width, height } = SHEET_DIMENSIONS[design.type]
  const pixels = new Uint8ClampedArray(width * height * 4)

  if (design.background) {
    const hex = Number.parseInt(String(design.background).replace('#', ''), 16)
    const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = 255
    }
  }

  for (const layer of design.layers ?? []) {
    if (layer.hidden || !isPattern(layer.kind)) continue
    for (const region of resolveTarget(design.type, layer.target ?? 'all')) {
      paintPatternRegion(pixels, width, region, layer)
    }
  }

  return { width, height, pixels }
}
```

And the per-region painter, `render.ts:51-79`:

```ts
/** Fill one region with a pattern layer, writing straight into `pixels`. */
function paintPatternRegion(
  pixels: Uint8ClampedArray,
  width: number,
  region: Region,
  layer: ClothingLayer
): void {
  const field = patternField(layer, region.w, region.h)
  const opacity = clampOpacity(layer.opacity)

  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      const [r, g, b] = field(x, y) as Rgb
      const offset = ((region.y + y) * width + (region.x + x)) * 4
      if (opacity >= 1) {
        pixels[offset] = r
        pixels[offset + 1] = g
        pixels[offset + 2] = b
        pixels[offset + 3] = 255
      } else {
        const src = Uint8ClampedArray.of(r, g, b, 255)
        const dst = pixels.slice(offset, offset + 4)
        const merged = Uint8ClampedArray.from(dst)
        blendOver(merged, src, opacity)
        pixels.set(merged, offset)
      }
    }
  }
}
```

Two consequences worth naming:

1. `patternField(layer, region.w, region.h)` is called with the **region's** size, and the returned
   function is evaluated at **region-local** coordinates `(x, y)` starting at `(0,0)`. Every region
   therefore restarts the pattern at its own top-left corner. `pattern.ts:5-11` documents this as
   deliberate. It is also exactly why the prompt's instruction to make "seams line up across the
   torso and the sleeves" (§4) can never be satisfied.
2. `blendOver` is called with a *copy* of the destination pixel, so this is plain source-over. There
   is no batch buffer. The file header at `render.ts:5-9` claims "consecutive pattern layers render
   into one **transparent** batch buffer, so a pattern with `opacity < 1` darkens toward black before
   compositing" — that behaviour is **not** present in this code. The comment is stale.

## 2.9 Encoding, verbatim

`png.ts:1-29`:

```ts
/**
 * The rendered sheet as a PNG data URL, through a canvas.
 *
 * RobloxKit renders into a canvas and calls `toBlob('image/png')`
 * (`render-CpljO1Hx.js`); the browser's encoder is the reference, so this uses
 * `toDataURL('image/png')` on the same pixels rather than re-implementing PNG.
 * `renderPixels` is the deterministic part — the same design always yields the
 * same RGBA buffer, and the encoder is lossless, so the URL is stable too.
 */

import type { RenderedSheet } from './render'

/** `data:image/png;base64,…` for the sheet. */
export function pngDataUrl(sheet: RenderedSheet): string {
  const { width, height, pixels } = sheet
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('a 2D canvas is unavailable, so the sheet cannot be encoded')

  // `ImageData` takes the buffer as-is: `renderPixels` is already RGBA, row-major.
  const image = ctx.createImageData(width, height)
  image.data.set(pixels)
  ctx.putImageData(image, 0, 0)

  return canvas.toDataURL('image/png')
}
```

Note `document.createElement('canvas')` — this path requires a DOM. It works in the renderer, which
is where the gateway runs, and is mocked in vitest (`vitest.setup.ts:150-247`).

## 2.10 Is it a faithful Roblox template?

**Geometry: yes.** Every rect, the 66 px stride, the 64 px face width, the 128 px face height, the
`up`/`down` cap positions at y=289 and y=485, the per-side face ordering, the 585×559 sheet, the
512×512 t-shirt — all identical to RobloxKit's `layout-yFs0_M_2.js:1-86` as recorded in
`01-robloxkit-clothing-design.md` §2.2-§2.3.

**The compositor: no.** RobloxKit's `renderToCanvas` is a two-pass compositor — patterns batched into
a buffer, then `text`/`image`/`shape`/`trim` drawn through Canvas2D with per-region
`save()/rect()/clip()`. Termul implements only pass 1. See §3.

**The review artefact: no.** RobloxKit renders a 1024×358 JPEG containing three three.js avatar views
(front / back / left side) plus the flat template, and that is what the model sees. Termul renders the
flat 585×559 UV atlas and nothing else. See §6 and §9.

---

# 3. What actually draws

## 3.1 The dispatch table

`render.ts:29-30`, verbatim — this single predicate decides everything:

```ts
const isPattern = (kind: string): boolean =>
  kind !== 'text' && kind !== 'image' && kind !== 'shape' && kind !== 'trim'
```

and `render.ts:103`:

```ts
    if (layer.hidden || !isPattern(layer.kind)) continue
```

So: **`text`, `image`, `shape` and `trim` are skipped unconditionally.** They are accepted by the
validator, named in the system prompt, and produce zero pixels.

The file header states this openly, `render.ts:13-14`:

```
 * Only the pattern batch runs here. Vector layers (text/image/shape/trim) need a
 * 2D canvas and are out of scope for the headless path.
```

That justification does not hold in this codebase: `png.ts:16` already creates a real
`document.createElement('canvas')` and gets a 2D context, so a Canvas2D pass was available.

## 3.2 Kind-by-kind truth table

| kind | Paints? | What it actually paints | Verdict |
|---|---|---|---|
| `solid` | yes | one flat colour, whole region | **trivial** — falls through to `pattern.ts:200-201` `default: return () => primary` |
| `gradient` | yes | linear gradient across the region, `angle`-aware | real |
| `stripes` | yes | bands of `size` px on, `gap` px off, `angle`-aware | real |
| `checks` | yes | 2-colour checkerboard, cell = `size` | real, but **`angle` is read and ignored** |
| `plaid` | yes | 3-colour woven plaid with a 25 % dither and pin-stripes | real, but `angle` ignored |
| `polka` | yes | staggered dots, radius `size/2`, pitch `size+gap` | real, but `angle` ignored |
| `zigzag` | yes | triangle-wave bands, amplitude `size/2`, wavelength `2·size` | real, but `angle` ignored |
| `camo` | yes | 2-octave value noise, 3 hard thresholds | real |
| `noise` | yes | 1-octave value noise, lerp between two colours | real |
| `text` | **no** | nothing. Zero pixels. | **no-op stub** |
| `image` | **no** | nothing. Zero pixels. Also **cannot validate** — see §3.4. | **double no-op** |
| `shape` | **no** | nothing. Zero pixels. | **no-op stub** |
| `trim` | **no** | nothing. Zero pixels. | **no-op stub** |

## 3.3 `solid` is the default branch, not a case

`pattern.ts:99-203` — the `switch (layer.kind)` has explicit cases for `gradient`, `stripes`,
`checks`, `plaid`, `polka`, `zigzag`, `camo`, `noise`, and then:

```ts
    default:
      return () => primary
```

`pattern.ts:200-201`. `primary` is `parseColor(layer.color ?? layer.from ?? '#ffffff')`
(`pattern.ts:104`). So `solid` is not implemented; it is the fall-through. Any kind the validator
would reject also falls here, but the validator runs first so that cannot be reached in practice.

## 3.4 `image` can never validate

`gateway-handler.ts:103-107`:

```ts
    const accepted = queueGenerateClothing(deps.clothing, {
      type,
      prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
      design: spec
    })
```

`queueGenerateClothing` passes those args to `runClothingGeneration`, which calls
(`tools/generate-clothing.ts:169`):

```ts
    build: async (spec) => buildClothing(spec, { type: args.type }),
```

No `images` is passed, so `buildClothing` uses its default `images = 0` (`build.ts:55`). Then
`schema.ts:222-230` runs with `images === 0`:

- An `image` layer with no `image` index → `an image layer needs "image": the number of an attached picture (0)`.
- An `image` layer with any index → `must be 0..-1` is impossible, so it hits the else-branch:
  `no pictures are attached; remove this layer`.

There is no attachment path anywhere: `GENERATE_CLOTHING_INPUT_SCHEMA` (`tools/generate-clothing.ts:25-33`)
declares no `images`, and the Rust tool schema (`generator_tools.rs:106-158`) declares only `type`,
`prompt`, `spec`. So `image` is a kind the prompt advertises, the validator has a rule for, and
**nothing can ever satisfy**.

## 3.5 What the renderer never touches

Grepping the whole `src/renderer/lib/generator` tree for Canvas2D drawing calls (`fillRect`,
`fillText`, `drawImage`, `strokeRect`, `beginPath`, `arc(`, `measureText`, `loadImage`,
`createPattern`) returns **zero hits**. There is no vector drawing code at all, not even dead code.

Grepping for `layer.x`, `layer.y`, `layer.w`, `layer.h`, `.outline`, `outlineWidth`, `offsetX`,
`layer.width`, `layer.src`, `layer.fit`, `layer.scale`, `layer.weight` returns only three hits, all
in `schema.ts` (the interface declaration at `:67`, `:80`, and the validator's `layer.src` check at
`:219`). Nothing reads them.

## 3.6 The `background` escape hatch defeats both quality warnings

`render.ts:91-100` fills the *entire* sheet opaque when `background` is set. That interacts with the
two checks in `build.ts:63-78`:

```ts
  const painted = coverage(rendered)
  const colors = distinctColors(rendered)

  const issues: Array<{ level: 'error' | 'warn'; message: string }> = []
  if (painted < MIN_COVERAGE) {
    issues.push({
      level: 'warn',
      message: `the design covers only ${(painted * 100).toFixed(1)}% of the sheet`
    })
  }
  if (colors < MIN_DISTINCT_COLORS) {
    issues.push({ level: 'warn', message: 'the design is a single flat colour' })
  }
```

with `build.ts:35-37`:

```ts
/** Flat-colour designs are legal but rarely what the user asked for. */
const MIN_DISTINCT_COLORS = 2
const MIN_COVERAGE = 0.05
```

`coverage()` (`render.ts:112-120`) counts every pixel with `alpha > 0`. With `background` set, every
pixel has alpha 255, so `coverage` is **exactly 1.0** and the coverage warning can never fire.
`distinctColors()` (`render.ts:122-131`) counts the background colour too, so
`background: "#000000"` plus one `solid` layer gives 2 colours and the flat-colour warning can never
fire either.

The cheapest possible design — `{"type":"shirt","background":"#000000","layers":[{"kind":"solid","color":"#000000"}]}`
— passes validation, reports `coverage: 1, colors: 1`… actually `colors` would be 1 here, so the
flat warning fires. But `background: "#000000"` plus `solid #111111` gives `coverage: 1, colors: 2`
and **both warnings are silent**. This is a two-line bypass of the only two automated checks that
exist.

## 3.7 The `report` object, verbatim

`build.ts:80-97`:

```ts
  return {
    spec: normalized,
    sheet: pngDataUrl(rendered),
    report: {
      ok: issues.every((issue) => issue.level !== 'error'),
      issues,
      width: size.width,
      height: size.height,
      coverage: Number(painted.toFixed(4)),
      colors
    },
    layout: [
      `Sheet ${size.width}x${size.height}, garment ${type}.`,
      `${normalized.layers?.length ?? 0} layer(s).`,
      `Painted ${(painted * 100).toFixed(1)}% with ${colors} distinct colour(s).`,
      `Regions: ${regionSummary(type)}.`
    ].join(' ')
  }
```

`report.ok` is `issues.every(i => i.level !== 'error')`. Every issue pushed at `build.ts:67-78` is
`level: 'warn'`. **There is no code path that produces `level: 'error'`**, so `report.ok` is
**always `true`**. This mirrors RobloxKit exactly (see `01-robloxkit-clothing-design.md` §2.16), so it
is a faithful defect rather than a new one — but it means the only quality gate is the model looking
at the render, and §5 shows the render never reaches the model.

`regionSummary` (`render.ts:139-143`) joins every region id, so for a shirt the `layout` string
carries 18 ids: `torso_right, torso_front, torso_left, torso_back, torso_up, torso_down, right_arm_left,
…`. It is a static list of the atlas, identical for every design, not a description of this design.
---

# 4. The prompt

## 4.1 `CLOTHING_SYSTEM_PROMPT`, verbatim

`src/renderer/lib/generator/engines/clothing/prompt.ts:1-56`, complete file:

```ts
/**
 * The clothing engine's system prompt.
 *
 * Re-authored rather than recovered: RobloxKit fetches this text from an
 * auth-gated server (`GET /api/assets/*` → 401 on every path tested), so only
 * the *contract* survived — see `re/full-reverse/01-generator-loop/REPORT.md`
 * §15. The field list and limits below are `schema.ts`'s own, so a change
 * there has to be mirrored here or the model authors specs the engine rejects.
 */

export const CLOTHING_SYSTEM_PROMPT = `You design Roblox clothing. You are given a request and you reply with one JSON design document that the renderer turns into a clothing texture.

Reply with exactly one fenced \`\`\`json block and nothing else. No prose before or after it.

The document:
{
  "type": "shirt" | "pants" | "tshirt",
  "background": "#rrggbb" or null,
  "name": "short label",
  "layers": [ <layer>, ... ]
}

\`type\` is fixed by the tool call; you cannot change it. Layers are painted in order, so the first is the bottom.

A layer may set:
  kind    "solid" | "gradient" | "stripes" | "checks" | "plaid" | "polka" | "zigzag" | "camo" | "noise" | "text" | "image" | "shape" | "trim"
  target  "all", a part of the garment, a side, or a region id (see below)
  color, color2, color3   "#rrggbb" — base, second and third colour
  from, to, outline       "#rrggbb"
  x, y, w, h, opacity     numbers from 0 to 1
  size                    1 to 400 (the pattern's scale in pixels)
  gap                     0 to 400
  angle                   -360 to 360 (degrees)
  text, font, weight      kind "text" only: 1 to 60 characters, font is sans | serif | mono | display
  shape                   kind "shape" only: rect | circle | star | heart | diamond | triangle
  edge, width             kind "trim" only: edge is top | bottom | left | right | sides | all
  image                   kind "image" only: the index of an attached picture
  seed                    integer, for reproducible noise and camo

Parts per garment:
  shirt  torso, right_arm, left_arm
  pants  torso, right_leg, left_leg
  tshirt torso
Sides: front, back, left, right, up, down.

Rules the renderer enforces and will reject you for:
- \`layers\` needs at least one entry, at most 40.
- Every colour is "#rrggbb" — six hex digits, no names, no alpha.
- \`target\` must name a part of this garment, a side, "all", or a region id.
- \`size\` 1-400, \`gap\` 0-400, \`angle\` -360 to 360.
- A kind that needs two colours must set both; plaid uses three.
- An "image" layer needs the index of a picture the request actually attached. If none were attached, do not use image layers.

Design for the garment as a player sees it on their avatar: a pattern must still read at a distance, seams must line up across the torso and the sleeves, and the whole thing must look like one garment rather than a flat poster. Prefer a few deliberate layers over many faint ones.

If the renderer rejects your design it names the exact rule you broke. Fix those and return the whole corrected document — never a patch, never an apology.`
```

Note the provenance comment: this prompt is **not** RobloxKit's. RobloxKit's `prompts/clothing.md` is
an auth-gated server asset and could not be recovered; this text is a re-authoring from the contract
alone. `01-robloxkit-clothing-design.md` §3.1 reaches the same conclusion.

Three problems inside the prompt itself:

1. It advertises `text`, `image`, `shape` and `trim` as usable kinds (line 26). All four paint
   nothing (§3).
2. It instructs "seams must line up across the torso and the sleeves" (line 54). Every region
   restarts the pattern at its own origin (`render.ts:58`), so this is impossible to satisfy, and the
   model has no way to learn that.
3. It says `x, y, w, h` are settable "numbers from 0 to 1". They are validated, then never read.

## 4.2 How the turn is assembled

Four layers, in order.

### Layer 1 — the first user message

`src/renderer/lib/generator/tools/generate-clothing.ts:80-97`:

```ts
/**
 * Build the first user message. The Studio context block goes first so the
 * model reads where it is before what it was asked for (`acp:967`).
 */
export function firstMessage(args: GenerateClothingArgs, studio?: SessionStudio): Msg {
  const parts: string[] = []
  if (studio) parts.push(sessionContext(studio))

  if (args.design) {
    parts.push(
      `Fix this ${args.type} design JSON and return the whole corrected design:\n\`\`\`json\n${JSON.stringify(args.design, null, 2)}\n\`\`\``
    )
  } else {
    parts.push(`Design a ${args.type}: ${args.prompt ?? 'anything that fits the garment'}.`)
  }

  return { role: 'user', text: parts.join('\n\n') }
}
```

Two paths: a `design` argument turns the first turn into a correction request; otherwise it is a
one-line brief.

`deps.studio` is never supplied in production — `generator-gateway.ts:56-67` builds the
`ClothingToolDeps` literal without a `studio` key, and `ClothingToolDeps.studio` is optional
(`generate-clothing.ts:73-74`). So **the Studio context block is always absent** in a real run. Only
the test at `__tests__/e2e-clothing.test.ts:250` exercises it.

### Layer 2 — the system-prompt fold

`src/renderer/lib/generator/ask-brain.ts:48-66`:

```ts
/**
 * Fold the system prompt into the first user turn.
 *
 * ACP has no system-prompt slot a generator can use, so every agent gets the
 * prompt prepended to its first message — RobloxKit does the same
 * (`gen3d:647`). Getting this wrong is silent: the model simply never sees the
 * schema it was supposed to author against, and answers with whatever else it
 * can call.
 */
export function flattenForBrain(brain: Brain, history: Msg[], system: string): Msg[] {
  void brain
  const [first, ...rest] = history
  if (!first) return [{ role: 'user', text: system }]
  if (!system.trim()) return history.map((message) => ({ ...message }))
  return [
    { ...first, text: `${system}\n\n---\n\n${first.text}` },
    ...rest.map((message) => ({ ...message }))
  ]
}
```

The system prompt is prepended to the **first** message only, separated by `\n\n---\n\n`. Because the
transport re-sends the whole history on every turn (§5.3), the system prompt is re-sent on every turn
as well — it is permanently glued to the first entry of the history array.

### Layer 3 — the `askBrain` adapter

`ask-brain.ts:75-93`:

```ts
export function createAskBrain(options: AskBrainOptions) {
  return async (request: BrainRequest): Promise<string> => {
    const scope = request.brain.scope ?? `gen/${request.action ?? 'unknown'}`
    const messages = flattenForBrain(request.brain, request.history, request.system)

    options.onSend?.({ scope, messages, system: request.system })
    request.onPhase?.(`asking ${request.brain.id}`)

    return options.transport.send({
      scope,
      messages: messages.map((message) => ({
        role: message.role,
        text: message.text,
        ...(message.image ? { image: message.image } : {})
      })),
      system: request.system
    })
  }
}
```

At this layer the `image` field is still carried. `scope` is `gen/clothing` because `Brain.scope` is
never set and `action` is `'clothing'` (`generate-clothing.ts:161`).

### Layer 4 — the ACP transport, where the image dies

`src/renderer/lib/generator/acp-brain-transport.ts:44-98`:

```ts
export function createAcpBrainTransport(options: AcpBrainTransportOptions): BrainTransport {
  const timeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS

  return {
    async send({ scope, messages }) {
      const last = messages[messages.length - 1]
      if (!last) throw new Error('a generator turn needs at least one message')

      const agentId = options.agentId()
      if (!agentId) {
        throw new Error(
          'no ACP agent is running, so the generator has nothing to ask; start a chat first'
        )
      }

      const session = await acpNewSession(agentId, options.cwd, [], {
        ephemeral: true,
        promotable: false
      })
      const sessionId = session.sessionId

      const text = messages.map((m) => m.text).join('\n\n')
      let collected = ''

      const stopChunks = onAcpEvent<MessageChunkEvent>('acp:message_chunk', (event) => {
        if (event.sessionId !== sessionId) return
        const role: ChunkRole = event.role
        if (role !== 'agent') return
        const chunk = event.content.text
        if (typeof chunk === 'string') collected += chunk
      })

      const finished = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`the ${scope} turn produced nothing within ${timeoutMs} ms`))
        }, timeoutMs)
        const stop = onAcpEvent<PromptCompleteEvent>('acp:prompt_complete', (event) => {
          if (event.sessionId !== sessionId) return
          clearTimeout(timer)
          stop()
          resolve()
        })
      })

      try {
        await acpSendPrompt(agentId, sessionId, text)
        await finished
        return collected
      } finally {
        stopChunks()
        await acpCloseSession(agentId, sessionId).catch(() => undefined)
      }
    }
  }
}
```

**Line 65 is the defect.** `const text = messages.map((m) => m.text).join('\n\n')` — the `image` field
is dropped. `acpSendPrompt` (`acp-api.ts:1248-1256`) takes a single `text` string. There is a
`acpSendPromptBlocks` (`acp-api.ts:1258-1266`) that would accept `ContentBlock[]` including images,
and it is not used here.

Three further consequences of the same line:

- **Role is discarded.** User and assistant turns are concatenated into one blob with `\n\n`. The
  model cannot tell its own previous reply from the engine's rejection text.
- **Every turn is a fresh session.** `acpNewSession` at line 59, `acpCloseSession` in `finally` at
  line 94. The full history is re-sent as a single prompt each time; there is no conversational
  state. The header comment at `acp-brain-transport.ts:4-8` says this is intentional, but it makes
  each successive turn more expensive, not less.
- **`stop()` leaks on timeout.** The `acp:prompt_complete` listener is unsubscribed only on the
  resolve path (line 83). When the 300 s timer fires, `finished` rejects and `finally` runs
  `stopChunks()` only — the `prompt_complete` handler stays subscribed forever.

### Does the model see the rendered image back?

**No.** Trace:

1. `loop.ts:176` — `let canImage = visionOk && !!current.sheet && (await brainTakesImages(brain))`.
   With an image-capable agent this is `true`.
2. `loop.ts:183-187` — pushes a user message with `image: canImage ? current.sheet : undefined`.
3. `ask-brain.ts:88` — the image survives into `transport.send`.
4. `acp-brain-transport.ts:65` — **`const text = messages.map((m) => m.text).join('\n\n')`**. The
   image is not in `text`. It is gone.
5. `acp-brain-transport.ts:89` — `await acpSendPrompt(agentId, sessionId, text)` — a plain string
   prompt.

So the model receives, on the checking turn:

> Here is the garment sheet you designed, laid out flat as Roblox maps it onto the body. Checks
> passed. No issues found. Sheet 585x559, garment shirt. 2 layer(s). Painted 45.1% with 3 distinct
> colour(s). Regions: torso_right, … Does it match the request "a racing jacket"? If it does and
> there are no errors, reply with the single word DONE. Otherwise return the whole corrected design.

with **no sheet**. The lead sentence at `generate-clothing.ts:111` is factually false at the point
the model reads it.

Worse: because `canImage` was `true`, the loop never enters its text-only fallback
(`loop.ts:192-204`, which sets `visionOk = false` and re-sends). The transport did not throw, so the
loop has no signal that anything was lost.

---

# 5. The loop

## 5.1 How many brain turns per `generate_clothing` call

`designLoop` (`loop.ts:68-263`) runs in three phases.

| Phase | Turns | Where |
|---|---|---|
| A — author the spec | 1 | `loop.ts:121` `let reply = await turn('designing')` |
| B — extract → normalize → build, retry on rejection | 0 extra if valid; up to `MAX_BUILD_RETRIES = 3` extra | `loop.ts:127-161` |
| C — review rounds | `rounds = MAX_REVIEW_ROUNDS = 2`, 1 turn each, plus rebuild retries | `loop.ts:173-260` |

**Minimum: 2 turns.** Authoring, then one review turn where the model says `DONE` and the gate
accepts.

**Typical: 2–3 turns.** If the model revises on round 0, a second review turn happens on round 1.

**Maximum, per the budget constants** (`budget.ts:11-24`):

```ts
/** Review cycles after a successful build (`gen3d:416`, `:833`). */
export const MAX_REVIEW_ROUNDS = 2

/** Authoring-phase build retries (`gen3d:528` `_e`) → 4 attempts total. */
export const MAX_BUILD_RETRIES = 3

/** Rebuild retries per review round (`gen3d:992`) → 3 attempts. */
export const MAX_REBUILD_RETRIES = 2

/** Transport retries per turn (`gen3d:1015` `Q`) → 3 attempts. */
export const MAX_TRANSPORT_RETRIES = 2

/** How many times a rejected `DONE` is re-asked within one round (`gen3d:957`). */
export const MAX_DONE_REASKS = 2
```

Worst case: 1 authoring + 3 build retries + 2 rounds × (1 verdict + 2 done-reasks + 2 rebuild
retries) = 4 + 10 = **14 turns**, each with its own ephemeral ACP session and a 300 s timeout. At
`DEFAULT_TURN_TIMEOUT_MS = 300_000` (`acp-brain-transport.ts:35`) that is a 70-minute ceiling for one
`generate_clothing` call.

In practice `MAX_DONE_REASKS` never fires on clothing — see §5.4.

## 5.2 Is there a render → review → fix cycle?

**Structurally yes, functionally no.**

The structure is there: `loop.ts:173-260` is a two-round loop that builds, shows the result, asks the
model to judge it, and rebuilds from the model's revised spec.

What is missing is the *input* to the judgement:

- The image is dropped (§4.2 Layer 4).
- The `layout` string is a static atlas inventory, not a description of this design (§3.7).
- `report.ok` is always `true` (§3.7), so the engine never has a complaint.

So the model's "review" is: read back its own JSON, read a sentence that says "Checks passed. No
issues found.", and answer. There is nothing to review. The loop runs, costs two to three model
calls, and returns the first design.

## 5.3 The review message, verbatim

`loop.ts:173-187`:

```ts
  for (let round = 0; round < rounds; round++) {
    onStage?.({ stage: 'checking', detail: 'Checking the result' })

    let canImage = visionOk && !!current.sheet && (await brainTakesImages(brain))
    let parts = review(current, canImage)

    const ask = question
      ? `\n${question({ prompt, what, round })}`
      : `\nDoes it match the request "${prompt}"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected ${what}.`

    history.push({
      role: 'user',
      text: `${parts.lead} ${parts.facts}${parts.layout ?? ''}${ask}`,
      image: canImage ? current.sheet : undefined
    })
```

Note `review(current, canImage)` — the second argument is passed but `clothingReview` ignores it
(`generate-clothing.ts:100-115` takes only `built`). So even the text is identical with and without
vision.

`generate-clothing.ts:99-115`:

```ts
/** What the model is told to judge during the checking stage. */
export function clothingReview(built: BuildResult): {
  lead: string
  facts: string
  layout?: string
} {
  const report = built.report
  const issues = report.issues.length
    ? `Issues: ${report.issues.map((issue) => `[${issue.level}] ${issue.message}`).join('; ')}.`
    : 'No issues found.'

  return {
    lead: 'Here is the garment sheet you designed, laid out flat as Roblox maps it onto the body.',
    facts: `Checks ${report.ok ? 'passed' : 'failed'}. ${issues}`,
    layout: built.layout
  }
}
```

Compare with RobloxKit's review message (`01-robloxkit-clothing-design.md` §3.4-§3.5): a per-layer
inventory (`0. solid on all #1a3a8f`) plus an explicit `Empty regions (skin shows): right_arm_front,
…` list. Termul's `layout` is instead the static region-id dump from `render.ts:139-143`.

## 5.4 The code that decides to stop

Two exits.

**Exit 1 — build budget exhausted.** `loop.ts:147-151`:

```ts
    if (attempt >= MAX_BUILD_RETRIES) {
      throw new Error(
        `The AI's ${what} could not be built: ${problems.slice(0, PROBLEMS_IN_ERROR).join('; ')}`
      )
    }
```

This throws, so the task settles `failed` (`task-queue.ts:250-255`).

**Exit 2 — the DONE gate.** `loop.ts:206-229`:

```ts
    // ── DONE handling, with the acceptance gate ───────────────────────────
    let next = extract(verdict)
    let accepted = false

    for (let n = 0; !next && n < MAX_DONE_REASKS && isDone(verdict); n++) {
      const nudge = current.report.ok
        ? (accept?.({ verdict, built: current, round }) ?? null)
        : `The checks still find errors:\n- ${current.report.issues
            .filter((issue) => issue.level === 'error')
            .map((issue) => issue.message)
            .join('\n- ')}\nFix them and return the whole corrected ${what}.`

      if (!nudge) {
        accepted = true
        break
      }

      notes.push(`review ${round + 1}: DONE not accepted`)
      history.push({ role: 'user', text: nudge })
      verdict = await turn('checking')
      next = extract(verdict)
    }

    if (accepted || !next) break
```

For clothing, `accept` is never supplied — `runClothingGeneration` (`generate-clothing.ts:160-173`)
passes `build`, `normalize`, `review`, `onStage`, `brain`, `askBrain`, `brainTakesImages` and nothing
else. So `accept?.({...})` is `undefined`, `?? null` makes `nudge` `null`, `accepted = true`, `break`.

And even if `accept` existed, the `: "The checks still find errors…"` branch is unreachable because
`report.ok` is always `true`.

So the DONE gate is: **the first `DONE` wins.** `MAX_DONE_REASKS` is dead code on this path, exactly
as in RobloxKit (`01-robloxkit-clothing-design.md` §2.16).

`isDone` itself, `loop.ts:27-31`:

```ts
/** Matches a bare `DONE` at either end of the trimmed reply (`gen3d:957`). */
export function isDone(text: string): boolean {
  const trimmed = (text ?? '').trim()
  return /^\s*DONE\b/i.test(trimmed) || /\bDONE\W*$/.test(trimmed)
}
```

**Exit 3 — the round budget.** The `for` at `loop.ts:173` simply runs out after `rounds = 2`, and
`loop.ts:262` returns whatever `current` is:

```ts
  return { result: spec, built: current, notes }
```

A design that was never accepted is returned as a success.

## 5.5 The rebuild path

`loop.ts:231-257`:

```ts
    // ── rebuild the revised spec; MAX_REBUILD_RETRIES per round ───────────
    for (let attempt = 0; next; attempt++) {
      const normalized = normalize?.(next)
      if (normalized !== undefined) next = normalized

      onStage?.({ stage: 'fixing', detail: 'Rebuilding with the corrections' })
      try {
        current = await build(next)
        spec = next
        notes.push(`revised after review ${round + 1}`)
        break
      } catch (error) {
        const problems = problemsOf(error)
        if (attempt >= MAX_REBUILD_RETRIES) {
          notes.push(`a revision did not build (${problems[0]})`)
          next = null
          break
        }
        history.push({
          role: 'user',
          text: `The engine rejected the ${what}:\n- ${problems
            .slice(0, PROBLEMS_ECHOED)
            .join('\n- ')}\nReturn the whole corrected ${what}.`
        })
        next = extract(await turn('fixing'))
      }
    }
```

Note `normalize: (spec) => spec` at `generate-clothing.ts:170` — the loop's normalize hook is a no-op.
The type is actually forced inside `buildClothing` via `normalizeDesign` (§1.8), so this is harmless,
just redundant.

## 5.6 Stage reporting

`types.ts:11`:

```ts
export type Stage = 'designing' | 'building' | 'checking' | 'fixing'
```

Reported through `onStage` → `runClothingGeneration`'s `report` → `TaskQueue`'s `report`
(`task-queue.ts:233-241`), which throttles UI emission to one per second. The MCP agent never sees
these stages; only `task.stage` on a poll does (`generate-clothing.ts:201`).

---

# 6. The result envelope

## 6.1 `readClothingResult`, verbatim

`src/renderer/lib/generator/tools/generate-clothing.ts:179-202`, complete:

```ts
/** Read a task back in the shape the poll tool returns. */
export function readClothingResult(queue: TaskQueue, taskId: string): GenerateClothingResult {
  const task = queue.get(taskId)
  if (!task) {
    return { status: 'failed', taskId, stage: 'Unknown', error: `No task ${taskId}` }
  }
  if (task.status === 'done') {
    const built = task.result as { result?: unknown; built?: BuildResult } | null
    return {
      status: 'done',
      taskId,
      stage: task.stage,
      design: built?.built?.spec ?? built?.result ?? null,
      image: built?.built?.sheet,
      report: built?.built?.report,
      layout: built?.built?.layout,
      summary: `${task.title} is ready`
    }
  }
  if (task.status === 'failed') {
    return { status: 'failed', taskId, stage: task.stage, error: task.error ?? 'failed' }
  }
  return { status: task.status, taskId, stage: task.stage }
}
```

And the interface it satisfies, `generate-clothing.ts:49-64`:

```ts
/** What a poll returns once a task settles. */
export interface GenerateClothingResult {
  status: 'done' | 'failed' | 'cancelled' | 'running' | 'queued' | 'interrupted'
  taskId: string
  stage: string
  /** The design the engine accepted, when the task finished. */
  design?: unknown
  /** `data:image/png;base64,…` of the rendered sheet. */
  image?: string
  /** What the checks found: `ok`, the issue list, size, coverage, colours. */
  report?: unknown
  /** One-line description for a model that cannot see the image. */
  layout?: string
  error?: string
  summary?: string
}
```

## 6.2 The accept envelope, verbatim

`generate-clothing.ts:41-47` and `:77-78`:

```ts
/** What the tool returns before the work is done. */
export interface GenerateClothingAccepted {
  status: 'queued' | 'running'
  taskId: string
  stage: string
  note: string
}
```

```ts
const ACCEPTED_NOTE =
  'Still designing in the background. Carry on; call get_task_result with this task_id.'
```

Two defects in that string: it names `get_task_result`, but the actual tool is `get_clothing_task`
(`generator_tools.rs:163` builds `get_{engine}_task`). An agent that follows the instruction calls a
tool that does not exist.

## 6.3 The three JSON shapes the model sees

**`generate_clothing` (immediate):**

```json
{
  "status": "queued",
  "taskId": "task-m9x2k1-1",
  "stage": "Waiting",
  "note": "Still designing in the background. Carry on; call get_task_result with this task_id."
}
```

**`get_clothing_task` while running:**

```json
{ "status": "running", "taskId": "task-m9x2k1-1", "stage": "checking" }
```

**`get_clothing_task` when done:**

```json
{
  "status": "done",
  "taskId": "task-m9x2k1-1",
  "stage": "Done",
  "design": { "type": "shirt", "background": null, "layers": [ … ] },
  "image": "data:image/png;base64,iVBORw0KGgo…",
  "report": { "ok": true, "issues": [], "width": 585, "height": 559, "coverage": 0.4509, "colors": 3 },
  "layout": "Sheet 585x559, garment shirt. 2 layer(s). Painted 45.1% with 3 distinct colour(s). Regions: torso_right, torso_front, …",
  "summary": "a racing jacket is ready"
}
```

## 6.4 Is the image inline base64, a data URL, a file path, or nothing?

**A `data:image/png;base64,…` data URL**, and it is transformed on the way out.

1. `build.ts:82` — `sheet: pngDataUrl(rendered)` produces `data:image/png;base64,…`.
2. `readClothingResult` puts it in `image` (`generate-clothing.ts:192`).
3. `gateway-handler.ts:121-125` returns it inside `{callId, ok: true, result}`.
4. `generator-gateway-client.ts:73` sends it as a `generator_reply` over the transport.
5. `src-tauri/src/web/ws/generator.rs:21-41` parses it and calls `env.acp.answer_generator_call(parsed)`.
6. `parent/generator.rs:119-125` routes it to the parked `oneshot`.
7. `parent/generator.rs:101` — `FrameReply::ok_with(reply.result.unwrap_or(Value::Null))`.
8. **`child.rs:283-310`** rewrites the reply.

`src-tauri/src/acp/host_mcp/child.rs:277-310`, verbatim:

```rust
/// A generator reply, with its `image` lifted into a real MCP image block.
///
/// The engines answer with a `data:image/png;base64,…` URL. Leaving it inside
/// the JSON text means the agent has to decode base64 by hand to see anything,
/// and in practice it goes looking on disk instead — so the bytes become an
/// image content block and the JSON keeps everything else.
fn generator_result(mut result: serde_json::Value) -> CallToolResult {
    let image = result
        .as_object_mut()
        .and_then(|fields| fields.remove("image"))
        .and_then(|value| value.as_str().map(str::to_string));
    let Some(data) = image else {
        return CallToolResult::structured(result);
    };
    let (mime, base64) = match data.split_once(',') {
        Some((head, body)) if head.starts_with("data:") => {
            let mime = head
                .trim_start_matches("data:")
                .split(';')
                .next()
                .unwrap_or("image/png")
                .to_string();
            (mime, body.to_string())
        }
        _ => ("image/png".to_string(), data),
    };
    let text = result.to_string();
    let mut out = CallToolResult::structured(result);
    out.content = vec![
        rmcp::model::ContentBlock::text(text),
        rmcp::model::ContentBlock::image(base64, mime),
    ];
    out
}
```

So the final MCP `CallToolResult` has **two content blocks**:

1. `Text` — the JSON *without* `image`.
2. `Image` — the raw base64 bytes, `mime_type: "image/png"`.

The `structured_content` is the same JSON, also without `image`.

**So: the outer agent sees the render; the generator brain does not.** That is the asymmetry at the
heart of this feature. The chat agent can look at the PNG; the loop that is supposed to critique the
PNG cannot.

The tests pin this behaviour: `generator_e2e_tests.rs:174-208` asserts `kinds == vec!["text", "image"]`
and that `structured_content` has no `image` key.

## 6.5 The reply-size ceiling

`child.rs:533-548`:

```rust
    // Snapshot payloads are large; keep the cap generous.
    const MAX_REPLY: u64 = 1024 * 1024;
    let mut reader = BufReader::new(stream.take(MAX_REPLY));
```

The reply line is read with a hard 1 MiB cap. A 585×559 RGBA sheet is 1.31 MB raw; a noisy design
(§3, `noise`/`camo`) compresses poorly, and base64 inflates by 4/3. A design that lands above ~786 KB
of PNG bytes produces a reply line over 1 MiB, `read_line` returns a truncated string,
`serde_json::from_str` fails, and the child reports `generator_unreachable` (`child.rs:269-273`). The
agent then sees a transport error for a generation that actually succeeded.

---

# 7. Tool surface

## 7.1 The twenty tools

`generator_tools.rs:65-76` defines ten families, and `tools()` (`:190-197`) emits two tools per
family, so **20 tools**:

```rust
const FAMILIES: &[Family] = &[
    Family { engine: "clothing", noun: "garment (shirt, pants or t-shirt) as a Roblox clothing PNG", accepts_prompt: true },
    Family { engine: "3d", noun: "3D model as Roblox geometry", accepts_prompt: true },
    Family { engine: "sfx", noun: "sound effect as a Roblox audio asset", accepts_prompt: true },
    Family { engine: "texture", noun: "seamless texture set (colour, normal, roughness, metal)", accepts_prompt: true },
    Family { engine: "skybox", noun: "six-face skybox", accepts_prompt: true },
    Family { engine: "icon", noun: "UI icon as SVG and raster sizes", accepts_prompt: true },
    Family { engine: "vfx", noun: "particle effect sprite sheet", accepts_prompt: true },
    Family { engine: "gfx", noun: "rendered scene image", accepts_prompt: true },
    Family { engine: "animation", noun: "R15/R6 animation as a KeyframeSequence", accepts_prompt: true },
    Family { engine: "cutscene", noun: "cutscene timeline as Luau", accepts_prompt: true },
];
```

```rust
/// Every generator tool, ready for the child's router.
#[must_use]
pub fn tools() -> Vec<Tool> {
    FAMILIES
        .iter()
        .flat_map(|family| [generate_tool(family), task_tool(family)])
        .collect()
}
```

## 7.2 The full list, with implementation status

| # | Tool | Engine | Implemented? |
|---|---|---|---|
| 1 | `generate_clothing` | clothing | **yes** |
| 2 | `get_clothing_task` | clothing | **yes** |
| 3 | `generate_3d` | 3d | no — "no engine in this build yet" |
| 4 | `get_3d_task` | 3d | no |
| 5 | `generate_sfx` | sfx | no |
| 6 | `get_sfx_task` | sfx | no |
| 7 | `generate_texture` | texture | no |
| 8 | `get_texture_task` | texture | no |
| 9 | `generate_skybox` | skybox | no |
| 10 | `get_skybox_task` | skybox | no |
| 11 | `generate_icon` | icon | no |
| 12 | `get_icon_task` | icon | no |
| 13 | `generate_vfx` | vfx | no |
| 14 | `get_vfx_task` | vfx | no |
| 15 | `generate_gfx` | gfx | no |
| 16 | `get_gfx_task` | gfx | no |
| 17 | `generate_animation` | animation | no |
| 18 | `get_animation_task` | animation | no |
| 19 | `generate_cutscene` | cutscene | no |
| 20 | `get_cutscene_task` | cutscene | no |

**2 of 20 implemented.** The other 18 are listed, described, and answered with a refusal.

The refusal, `gateway-handler.ts:19-39` and `:75-84`:

```ts
/** Which engine each tool family needs, for the refusal message. */
const UNAVAILABLE = new Set([
  'generate_3d',
  'get_3d_task',
  'generate_sfx',
  'get_sfx_task',
  'generate_texture',
  'get_texture_task',
  'generate_skybox',
  'get_skybox_task',
  'generate_icon',
  'get_icon_task',
  'generate_vfx',
  'get_vfx_task',
  'generate_gfx',
  'get_gfx_task',
  'generate_animation',
  'get_animation_task',
  'generate_cutscene',
  'get_cutscene_task'
])
```

```ts
  if (UNAVAILABLE.has(call.tool)) {
    return {
      callId: call.callId,
      ok: false,
      error:
        `${call.tool} has no engine in this build yet. Only the clothing generator is ` +
        'implemented; the others are listed so the tool names are stable. Tell the user ' +
        'this engine is not available rather than approximating it another way.'
    }
  }
```

That is 18 entries, matching the 18 unimplemented tools. Good — the set and the family list agree.

## 7.3 `generate_*` descriptions, verbatim

Built by `generator_tools.rs:106-158`. The description is the tag plus a `format!`:

```rust
    let description = format!(
        "Generate a {}. Returns a task id at once; the artifact takes minutes, so poll \
         `get_{}_task` with that id instead of calling this again. An invalid spec comes back \
         as a list of problems to fix, not as a crash.{}",
        family.noun,
        family.engine,
        kind_hint(family)
    );
```

with the tag, `generator_tools.rs:24-25`:

```rust
pub const DESCRIPTION_TAG: &str = "Termul generator (renders a real Roblox asset in the project; \
it does not write source files): ";
```

and the clothing-only hint, `generator_tools.rs:87-103`:

```rust
fn kind_field(family: &Family) -> Option<(&'static str, &'static [&'static str])> {
    match family.engine {
        "clothing" => Some(("type", CLOTHING_TYPES)),
        _ => None,
    }
}

/// A sentence naming the required argument, so a description-only client
/// still learns it exists.
fn kind_hint(family: &Family) -> String {
    match kind_field(family) {
        Some((field, values)) => {
            format!(" Required argument `{field}`: one of {}.", values.join(", "))
        }
        None => String::new(),
    }
}
```

So `generate_clothing`'s description, rendered:

> Termul generator (renders a real Roblox asset in the project; it does not write source files):
> Generate a garment (shirt, pants or t-shirt) as a Roblox clothing PNG. Returns a task id at once;
> the artifact takes minutes, so poll `get_clothing_task` with that id instead of calling this again.
> An invalid spec comes back as a list of problems to fix, not as a crash. Required argument `type`:
> one of shirt, pants, tshirt.

and `generate_3d`'s:

> Termul generator (renders a real Roblox asset in the project; it does not write source files):
> Generate a 3D model as Roblox geometry. Returns a task id at once; the artifact takes minutes, so
> poll `get_3d_task` with that id instead of calling this again. An invalid spec comes back as a list
> of problems to fix, not as a crash.

## 7.4 `get_*_task` descriptions, verbatim

`generator_tools.rs:161-188`:

```rust
fn task_tool(family: &Family) -> Tool {
    Tool::new(
        format!("get_{}_task", family.engine),
        format!(
            "{DESCRIPTION_TAG}Read a {} generation started by `generate_{}`. Status is one of \
             queued, running, done, failed or cancelled. When it is done the reply carries the \
             artifact itself: `image` is a `data:image/png;base64` URL you can show, `design` is \
             the spec the engine accepted, `report` is what the checks found, and `layout` \
             describes the render in words. Nothing is written to disk, so do not search the \
             filesystem for an output file. While it is still running the reply carries the \
             stage the engine is on; poll again rather than starting a second generation.",
            family.noun, family.engine
        ),
        json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The id `generate_*` returned."
                }
            },
            "required": ["task_id"],
        })
        .as_object()
        .cloned()
        .unwrap_or_default(),
    )
}
```

Two inaccuracies in that text: the status list omits `interrupted`, which `TaskQueue.restore`
produces (`task-queue.ts:172-181`); and it claims `layout` "describes the render in words" when it is
a static region-id dump.

## 7.5 The session `instructions`

`src-tauri/src/acp/host_mcp/mod.rs:92-101`:

```rust
/// The full `instructions` of the child's `initialize` result: the chat
/// guidance, then the design canvas guide.
#[must_use]
pub fn session_instructions() -> String {
    format!(
        "{TERMUL_CHAT_INSTRUCTIONS}\n\n{}\n\n{}",
        generator_tools::instructions(),
        canvas_tools::instructions()
    )
}
```

Three blocks: chat markdown guidance, then the generator guide, then the canvas guide.

The generator guide, `generator_tools.rs:33-46`, verbatim:

```rust
const GENERATOR_GUIDE: &str = "Asset generators: this project can generate Roblox assets — \
clothing, 3D models, sound effects, textures, skyboxes, icons, VFX, GFX renders, animations and \
cutscenes — with this server's generator tools: generate_clothing, get_clothing_task, \
generate_3d, get_3d_task, generate_sfx, get_sfx_task, generate_texture, get_texture_task, \
generate_skybox, get_skybox_task, generate_icon, get_icon_task, generate_vfx, get_vfx_task, \
generate_gfx, get_gfx_task, generate_animation, get_animation_task, generate_cutscene, \
get_cutscene_task. When the user asks for a garment, a model, a sound, a texture, a sky, an icon, \
an effect, a render, an animation or a cutscene, call the matching generate_* tool. Each one \
returns a task id immediately because a generation takes minutes: poll the matching get_*_task \
tool with that id rather than calling generate_* again, which would start a second, different \
artifact. Do not write .lua files, .obj files or image files to disk to stand in for an asset, \
and do not hand-author a Roblox instance in place of a generator: these tools produce the \
artifact and hand it back. A generator that rejects a spec returns the problems it found; pass \
them back to the user rather than silently retrying with a different idea.";
```

This block advertises all ten engines as working ("this project can generate Roblox assets —
clothing, 3D models, sound effects, …") and only the per-tool refusal (§7.2) tells the truth. An agent
that reads the guide and never calls a tool has no way to know 9 of the 10 families are stubs.

## 7.6 `FrameKind::Generator`

`src-tauri/src/acp/host_mcp/mod.rs:164-168`:

```rust
    /// A `generate_*` / `get_*_task` call: the generative engines run in the
    /// renderer (they need a canvas and the model transport), so the parent
    /// forwards the call to the renderer holding the session's project and
    /// waits for its reply.
    Generator,
```

Serialized as `"generator"` (pinned by `parent/generator/tests.rs:37-41`). The frame fields,
`mod.rs:364-371`:

```rust
    /// The generator tool name of a `Generator` frame (`generate_clothing`,
    /// `get_3d_task`, …), verbatim from the agent's call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generator_tool: Option<String>,
    /// The `Generator` frame's tool arguments as JSON text, forwarded
    /// unparsed so the renderer owns the schema.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generator_args: Option<String>,
```

## 7.7 The full path of one call

```
agent                child (MCP stdio)          parent (TCP)            renderer
  |                        |                        |                      |
  |- tools/call ---------->|                        |                      |
  |  generate_clothing     |- FrameKind::Generator >|                      |
  |  {type, prompt}        |  {tool, args as str}   |- park oneshot        |
  |                        |                        |- fan_out ----------->| acp:generator_call
  |                        |  (waits, 30 s)         |                      |- gateway-handler
  |                        |                        |                      |   -> queue.spawn
  |                        |                        |<- generator_reply ---|   -> taskId
  |                        |<- FrameReply ----------|                      |
  |<- CallToolResult ------|  generator_result()    |                      |
  |                        |                        |                      | (task runs in background)
  |                        |                        |                      |  designLoop -> 2-3 ACP sessions
  |                        |                        |                      |
  |- tools/call ---------->|                        |                      |
  |  get_clothing_task     |----------------------->|--------------------->| readClothingResult
  |                        |                        |<---------------------| {design, image, report}
  |<- text + IMAGE --------|  image lifted to block |                      |
```

Timeouts: `GENERATOR_CALL_TIMEOUT = 30 s` (`parent/generator.rs:25`) covers the queue/reply round
trip only, never the generation. Per-turn timeout is 300 s (`acp-brain-transport.ts:35`).

---

# 8. Which agent runs the turn

## 8.1 `resolveGeneratorAgent`, verbatim

`src/renderer/lib/generator/agent-selection.ts:1-58`, complete file:

```ts
/**
 * Which ACP agent answers a generator turn, and what it can do.
 *
 * A generation needs a live agent, not a config id: the ACP session is created
 * with the runtime `agentId` the host minted at spawn. Picking Claude
 * unconditionally would send a Codex chat's generation to an agent that is not
 * in play, so the agent is resolved from the chat and only falls back to
 * Claude when nothing is known yet.
 */

import { CLAUDE_AGENT_CONFIG_ID } from '@/lib/claude-agent-id'
import { useAcpStore } from '@/stores/acp-store'

/** A resolved agent and the capabilities it advertised at `initialize`. */
export interface GeneratorAgent {
  id: string
  /** `promptCapabilities.image`: whether this agent accepts pictures at all. */
  takesImages: boolean
}

function takesImagesOf(capabilities: unknown): boolean {
  const prompt = (capabilities as { promptCapabilities?: { image?: boolean } | null })
    ?.promptCapabilities
  return prompt?.image === true
}

/**
 * The runtime agent id for `sessionId`, else for the selected agent config,
 * else the live Claude agent, else any live agent.
 *
 * `null` when no agent has been spawned yet — the caller reports that rather
 * than inventing an id, because a wrong id fails as "unknown agent".
 */
export function resolveGeneratorAgent(sessionId?: string | null): GeneratorAgent | null {
  const state = useAcpStore.getState()
  const live = state.configToLiveAgent ?? {}
  const agents = state.agents ?? {}

  const pick = (id: string | undefined | null): GeneratorAgent | null => {
    if (!id) return null
    return { id, takesImages: takesImagesOf(agents[id]?.capabilities) }
  }

  const session = sessionId ? state.sessions?.[sessionId] : undefined
  const fromSession = pick(session?.agentId)
  if (fromSession) return fromSession

  const selected = state.selectedAgentConfigId
  if (selected) {
    const fromSelection = pick(live[selected])
    if (fromSelection) return fromSelection
  }

  const fromClaude = pick(live[CLAUDE_AGENT_CONFIG_ID])
  if (fromClaude) return fromClaude

  return pick(Object.values(live).find((id) => !!id))
}
```

## 8.2 How the agent is chosen — the intended ladder

Four steps, first match wins:

1. **The chat's own agent.** `state.sessions[sessionId].agentId`. This is the correct answer: it is
   the runtime id the host minted for the chat that made the tool call.
2. **The selected agent config.** `configToLiveAgent[state.selectedAgentConfigId]`.
3. **The live Claude agent.** `configToLiveAgent[CLAUDE_AGENT_CONFIG_ID]`, where
   `CLAUDE_AGENT_CONFIG_ID = 'acp-registry:claude-acp'` (`lib/claude-agent-id.ts:9`).
4. **Any live agent.** `Object.values(configToLiveAgent).find(id => !!id)`.

`null` if all four miss, and the transport then throws
`no ACP agent is running, so the generator has nothing to ask; start a chat first`
(`acp-brain-transport.ts:54-57`).

## 8.3 How the agent is actually chosen — steps 2 and 3 never match

This is a live bug, not a nuance.

`configToLiveAgent` is keyed by `agentReuseKey(configId, cwd, projectId?)`, which
`src/renderer/stores/acp-reuse-keys.ts:42-47` defines as:

```ts
export function agentReuseKey(configId: string, cwd: string, projectId?: string | null): string {
  const base = `${configId}${NUL}${cwd.trim()}`
  const project = projectId?.trim() ?? ''
  if (project.length === 0) return base
  return `${base}${NUL}${PROJECT_SEGMENT}${NUL}${project}`
}
```

with `const NUL = '\0'` (`acp-reuse-keys.ts:25`). Every write to `configToLiveAgent` uses that key:
`shared-state.ts:749` then `:765` (`[reuseKey]: match.id`), and `:987-991`
(`[key]: agentId`, where `key` is `reuseKey` or `detachedReuseKey(reuseKey, agentId)`).

So the real keys look like `acp-registry:claude-acp\0C:\Users\...\project` — **always** containing at
least one NUL and a cwd.

`agent-selection.ts:50` does `live[selected]` and `:54` does `live[CLAUDE_AGENT_CONFIG_ID]` — both
bare config ids with no `\0cwd` suffix. Both lookups always return `undefined`.

The codebase knows this. The correct reverse lookup is at `stores/acp-store/helpers.ts:2079-2080`:

```ts
    const reuseKey = Object.keys(state.configToLiveAgent).find(
      (k) => state.configToLiveAgent[k] === agentId
```

and `shared-state.ts:204-205`:

```ts
  const reuseKey = Object.keys(state.configToLiveAgent).find(
    (k) => state.configToLiveAgent[k] === session.agentId
```

`agent-selection.ts` uses direct indexing instead.

**Consequence in production:** step 2 and step 3 always fall through, and the generator brain is
whichever agent happens to be first in `Object.values(configToLiveAgent)` — i.e. the first entry in
insertion order, which is the agent spawned for whichever config/cwd/project was warmed first. It is
not the chat's agent, it is not the selected config, and it may be an agent for a completely
different project directory.

**Why the tests do not catch it:** `__tests__/agent-selection.test.ts:20-35` builds the fixture with
bare keys:

```ts
    reset({
      sessions: { 's-1': { agentId: 'runtime-codex' } },
      configToLiveAgent: { [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude' }
    })
```

```ts
    reset({
      selectedAgentConfigId: 'acp-registry:codex-acp',
      configToLiveAgent: {
        'acp-registry:codex-acp': 'runtime-codex',
        [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude'
      }
    })
```

The tests encode the buggy contract, so they pass against a shape the store never produces.

## 8.4 The session id is available and is not passed

`GeneratorCall` carries it — `src/renderer/lib/acp-transport/generator-gateway-client.ts:23-31`:

```ts
/** One generator call as the host forwards it. */
export interface GeneratorCall {
  agentId: string
  sessionId: string
  callId: number
  /** The agent's tool name, e.g. `generate_clothing` or `get_3d_task`. */
  tool: string
  /** The tool arguments as JSON text, unparsed. */
  arguments: string
}
```

`call.agentId` is the exact runtime agent that made the call — it is right there in the event.

`generator-gateway.ts:47` throws it away:

```ts
  const resolve = options.agent ?? (() => resolveGeneratorAgent())
```

`resolve()` takes no arguments, so `sessionId` is always `undefined` and step 1 of the ladder
(`state.sessions[sessionId].agentId`) never runs either. `call.agentId` is never read anywhere in the
renderer. So **all four steps are broken or bypassed**, and the fourth is what runs.

## 8.5 Where the generator session's cwd comes from

Three hops.

**Hop 1** — `src/renderer/layouts/WorkspaceLayout.tsx:82-87`:

```tsx
  // This renderer runs the agent's generator calls; the engines need a canvas
  // and an ACP session, neither of which exists in the MCP child.
  useEffect(() => {
    if (!activeProject?.path) return
    return startGeneratorGateway({ cwd: activeProject.path })
  }, [activeProject?.path])
```

**Hop 2** — `src/renderer/lib/generator-gateway.ts:53-68`:

```ts
  gateway.setHandler(
    createGeneratorHandler({
      queue,
      clothing: {
        queue,
        brain: brainOf(),
        askBrain: createAskBrain({
          transport: createAcpBrainTransport({
            agentId: () => resolve()?.id ?? null,
            cwd: options.cwd
          })
        }),
        brainTakesImages: createBrainTakesImages(() => resolve()?.takesImages ?? false),
        system: options.system ?? CLOTHING_SYSTEM_PROMPT
      }
    })
  )
```

**Hop 3** — `src/renderer/lib/generator/acp-brain-transport.ts:59-62`:

```ts
      const session = await acpNewSession(agentId, options.cwd, [], {
        ephemeral: true,
        promotable: false
      })
```

So the cwd is **the active project's root path**, captured when `WorkspaceLayout` mounted the
gateway and re-captured whenever `activeProject.path` changes (the effect deps). It is not the chat
session's cwd, and it is not the calling agent's cwd.

Three consequences:

1. **A chat in a worktree gets a generator session in the project root.** `activeProject.path` is the
   project's own path, not `session.cwd`. If the chat is running in a worktree, the generator's
   ephemeral ACP session is created with the wrong cwd. The host's `new_session_with_context`
   (`src-tauri/src/acp/manager/mod.rs:1059-1122`) passes that cwd straight through to `session/new`.
2. **The gateway is torn down and rebuilt on every project switch** — the effect returns
   `startGeneratorGateway`'s stop function, which calls `queue.cancelAll()`
   (`generator-gateway.ts:71-74`). Switching projects **cancels every in-flight generation**.
3. **`mcpServers` is `[]`.** The generator's ephemeral session has no MCP servers at all — no Studio
   tools, no canvas, no host plan child. `manager/mod.rs:1084` injects the host MCP child only when
   `!context.ephemeral || context.promotable`, and this call is `ephemeral: true, promotable: false`.
   So the generator turn is a genuinely tool-free text call, which matches the design note at
   `ask-brain.ts:9-10` ("generation is a pure text/vision call: `tools: []`"). This part is correct.

## 8.6 The brain object is frozen at gateway start

`generator-gateway.ts:46-51`:

```ts
  const queue = options.queue ?? new TaskQueue()
  const resolve = options.agent ?? (() => resolveGeneratorAgent())
  const brainOf = (): Brain => {
    const agent = resolve()
    return agent ? { id: brainIdOf(agent.id), takesImages: agent.takesImages } : { id: 'custom' }
  }
```

`brain: brainOf()` at `:58` is evaluated **once**, when the gateway starts. If no agent is live at
that moment, `deps.brain` is permanently `{ id: 'custom' }`. `runClothingGeneration`
(`generate-clothing.ts:166`) spreads it per task (`{ ...deps.brain, signal }`) but the spread cannot
add fields that were never there.

`brainTakesImages` (`:65`) is a fresh closure, so the *vision gate* is dynamic. `brain.id` is not. It
is used only for `brainLabel` in stage text (`loop.ts:64-66`) and the `scope` fallback
(`ask-brain.ts:77`), so this is cosmetic — but it means the stage text names the wrong agent.

## 8.7 The vision gate

`ask-brain.ts:95-100`:

```ts
/** Build the `brainTakesImages` the loop expects. */
export function createBrainTakesImages(
  capability: ImageCapability = defaultTakesImages
): (brain: Brain) => Promise<boolean> {
  return async (brain) => capability(brain)
}
```

`generator-gateway.ts:65` overrides the default with `() => resolve()?.takesImages ?? false`, and
`resolve().takesImages` comes from `takesImagesOf(agents[id]?.capabilities)`
(`agent-selection.ts:21-25`) reading `promptCapabilities.image`. That part is correct: it reads the
agent's advertised capability rather than guessing from its name, and the tests at
`agent-selection.test.ts:63-98` pin it.

Because §8.3 resolves the wrong agent, the capability read is also for the wrong agent — but the
mechanism is sound.

---

# 9. Gaps vs a faithful RobloxKit port

Each item names the defect, the file:line, and what RobloxKit does instead. Ordered by severity.

## Critical — the loop is structurally blind

### G1. The review image never reaches the model

`src/renderer/lib/generator/acp-brain-transport.ts:65`

```ts
      const text = messages.map((m) => m.text).join('\n\n')
```

`loop.ts:176-187` computes `canImage`, attaches `current.sheet` to the user message, and
`ask-brain.ts:85-89` forwards it — then this line discards it. `acpSendPrompt` takes a `text: string`
(`acp-api.ts:1248-1256`); `acpSendPromptBlocks` (`acp-api.ts:1258-1266`) would accept an image block
and is not used.

The loop believes the image was delivered (`canImage` stayed `true`), so it also skips its text-only
retry at `loop.ts:192-204`. The model is told "Here is the garment sheet you designed"
(`generate-clothing.ts:111`) and shown nothing.

RobloxKit attaches a `data:image/jpeg` review image to the review turn
(`01-robloxkit-clothing-design.md` §2.13, §3.4).

### G2. The review image is the UV atlas, not the avatar sheet

`src/renderer/lib/generator/engines/clothing/build.ts:82`

```ts
    sheet: pngDataUrl(rendered),
```

`renderPixels` (`render.ts:87-110`) produces the flat 585×559 UV atlas. RobloxKit renders a
**1024×358 JPEG** containing three three.js avatar views (front, back, left side) plus the flat
template in panel 4, and *that* is the review artefact
(`01-robloxkit-clothing-design.md` §2.13). That report calls it "the single biggest quality lever".
Even with G1 fixed, the model would be judging a texture sheet rather than a garment.

### G3. Four of thirteen layer kinds paint nothing  *(FIXED in the uncommitted working tree - see the note at the top)*

`src/renderer/lib/generator/engines/clothing/render.ts:29-30` and `:103`

```ts
const isPattern = (kind: string): boolean =>
  kind !== 'text' && kind !== 'image' && kind !== 'shape' && kind !== 'trim'
```

```ts
    if (layer.hidden || !isPattern(layer.kind)) continue
```

`text`, `image`, `shape` and `trim` are validated, documented in the system prompt (`prompt.ts:26`,
`:34-37`), and produce zero pixels. There is no Canvas2D drawing code anywhere in
`src/renderer/lib/generator` (grep for `fillRect`/`fillText`/`drawImage`/`beginPath`/`arc(` returns
nothing).

The header's justification — "vector layers ... need a 2D canvas and are out of scope for the
headless path" (`render.ts:13-14`) — is not true in this codebase: `png.ts:16` already creates a
canvas and takes a 2D context.

RobloxKit implements all four through `save()/rect()/clip()` per region
(`01-robloxkit-clothing-design.md` §2.9).

### G4. `image` layers cannot validate at all  *(HALF-FIXED in the uncommitted working tree - see the note at the top)*

`src/renderer/lib/generator/tools/generate-clothing.ts:169`

```ts
    build: async (spec) => buildClothing(spec, { type: args.type }),
```

No `images` argument, so `buildClothing` defaults to `images = 0` (`build.ts:55`) and
`schema.ts:218-231` rejects every `image` layer:

- no index -> `an image layer needs "image": the number of an attached picture (0)`
- any index -> `no pictures are attached; remove this layer`

Neither `GENERATE_CLOTHING_INPUT_SCHEMA` (`generate-clothing.ts:25-33`) nor the Rust tool schema
(`generator_tools.rs:106-158`) has any way to attach a picture. The prompt at `prompt.ts:52` tells the
model "An 'image' layer needs the index of a picture the request actually attached. If none were
attached, do not use image layers." — so the model is instructed about a capability that does not
exist.

RobloxKit has `attachImages` (`01-robloxkit-clothing-design.md` §1.8) and a `pictures` path in the
tool arguments.

## Critical — the agent is wrong

### G5. `resolveGeneratorAgent`'s config lookups never match

`src/renderer/lib/generator/agent-selection.ts:50` and `:54`

```ts
    const fromSelection = pick(live[selected])
```

```ts
  const fromClaude = pick(live[CLAUDE_AGENT_CONFIG_ID])
```

`configToLiveAgent` is keyed by `agentReuseKey(configId, cwd, projectId?)` =
`configId\0cwd[\0project\0projectId]` (`stores/acp-reuse-keys.ts:42-47`; writes at
`stores/acp-store/shared-state.ts:749,765,991`). Both lookups pass a bare config id, so both always
return `undefined`.

The correct reverse lookup exists in the same codebase: `stores/acp-store/helpers.ts:2079-2080` and
`shared-state.ts:204-205` both scan `Object.keys(...)`.

**Effect:** steps 2 and 3 of the ladder always fall through; the generator brain is whichever agent
is first in `Object.values(configToLiveAgent)`, i.e. an arbitrary agent that may belong to a
different config, cwd and project.

**Tests encode the bug:** `__tests__/agent-selection.test.ts:20-35` builds fixtures with bare keys
that the store never produces.

### G6. The calling agent's id and session id are available and discarded

`src/renderer/lib/generator-gateway.ts:47`

```ts
  const resolve = options.agent ?? (() => resolveGeneratorAgent())
```

`GeneratorCall.agentId` and `GeneratorCall.sessionId` are on every forwarded call
(`acp-transport/generator-gateway-client.ts:23-31`), and `gateway-handler.ts:61-63` has the whole
`call` in scope. Neither is passed to `resolve()`. So `resolveGeneratorAgent`'s first and best
branch — `state.sessions[sessionId].agentId` (`agent-selection.ts:44-46`) — is dead code in
production, and the exact runtime agent that made the call is never used.

## High — quality gates are absent

### G7. `report.ok` is always `true`, so the DONE gate never gates  *(still true; now documented as deliberate)*

`src/renderer/lib/generator/engines/clothing/build.ts:84`

```ts
      ok: issues.every((issue) => issue.level !== 'error'),
```

Every issue pushed at `build.ts:67-78` is `level: 'warn'`. No code path emits `'error'`. Combined
with `accept` being undefined for clothing (`generate-clothing.ts:160-173`), `loop.ts:210-221` always
sets `accepted = true` on the first `DONE`:

```ts
      const nudge = current.report.ok
        ? (accept?.({ verdict, built: current, round }) ?? null)
        : `The checks still find errors:...`
```

`MAX_DONE_REASKS = 2` (`budget.ts:24`) is dead. This is a faithful reproduction of RobloxKit
(`01-robloxkit-clothing-design.md` §2.16) — so it is a defect worth fixing in *both*, and it means the
review round is the only gate, which G1 and G2 have disabled.

### G8. `background` silently disables both remaining checks  *(FIXED in the uncommitted working tree - see the note at the top)*

`src/renderer/lib/generator/engines/clothing/render.ts:91-100` fills the whole sheet opaque when
`background` is set. `coverage()` (`render.ts:112-120`) counts alpha > 0, so it returns exactly `1.0`;
`distinctColors()` (`render.ts:122-131`) counts the background, so two colours is trivially reached.
The warnings at `build.ts:67-75` can then never fire.

A design of `{"background":"#000000","layers":[{"kind":"solid","color":"#111111"}]}` reports
`coverage: 1, colors: 2` and is completely silent.

RobloxKit's `checkDesign` samples **inside each region only** and reports which region ids are empty
(`01-robloxkit-clothing-design.md` §2.16), so a background cannot mask an unpainted sleeve.

### G9. The `layout` string is a static atlas dump, not a design inventory  *(FIXED in the uncommitted working tree - see the note at the top)*

`src/renderer/lib/generator/engines/clothing/render.ts:139-143`

```ts
export function regionSummary(type: DesignType): string {
  return regionsFor(type)
    .map((region) => region.id)
    .join(', ')
}
```

`build.ts:91-96` composes `Regions: torso_right, torso_front, ..., left_arm_down.` — 18 ids for a
shirt, identical for every shirt design. It says nothing about the layers, nothing about which
regions are empty, and nothing about what the model actually authored.

RobloxKit's layout string is a per-layer inventory plus an explicit empty-region list
(`01-robloxkit-clothing-design.md` §3.5):

```
Layers (bottom to top):
0. solid on all #1a3a8f
1. trim on torso #d4af37
2. shape on torso_front star #d4af37 at 0.5,0.3
Empty regions (skin shows): right_arm_up, left_arm_up
```

That report calls it "the cheapest quality lever in the entire system". It is ~40 lines of code.

### G10. The system prompt promises capabilities the engine does not have

`src/renderer/lib/generator/engines/clothing/prompt.ts:26`

```
  kind    "solid" | "gradient" | "stripes" | "checks" | "plaid" | "polka" | "zigzag" | "camo" | "noise" | "text" | "image" | "shape" | "trim"
```

and `prompt.ts:54`:

```
Design for the garment as a player sees it on their avatar: a pattern must still read at a distance, seams must line up across the torso and the sleeves, and the whole thing must look like one garment rather than a flat poster. Prefer a few deliberate layers over many faint ones.
```

`text`/`image`/`shape`/`trim` paint nothing (G3). "Seams must line up across the torso and the
sleeves" is impossible because every region restarts the pattern at its own origin (`render.ts:58` —
`patternField(layer, region.w, region.h)` evaluated at region-local `(x, y)`). The prompt sets an
instruction the renderer cannot honour and gives the model no feedback channel to discover that.

## High — transport and plumbing

### G11. Every turn is a fresh ACP session and the role structure is destroyed

`src/renderer/lib/generator/acp-brain-transport.ts:59-65`

```ts
      const session = await acpNewSession(agentId, options.cwd, [], {
        ephemeral: true,
        promotable: false
      })
      const sessionId = session.sessionId

      const text = messages.map((m) => m.text).join('\n\n')
```

A 2–3 turn loop opens and closes 2–3 ephemeral ACP sessions, re-sending the entire history plus the
system prompt as one flat string each time. User and assistant turns become indistinguishable. The
token cost is quadratic in turn count, and the model cannot tell its own prior reply from the
engine's rejection.

### G12. A 1 MiB reply cap can fail a successful generation

`src-tauri/src/acp/host_mcp/child.rs:544`

```rust
    const MAX_REPLY: u64 = 1024 * 1024;
```

The reply line carries the base64 PNG. A 585×559 RGBA sheet is 1.31 MB raw; `noise` and `camo`
designs compress poorly, and base64 adds 33 %. Above ~786 KB of PNG bytes the line is truncated,
`serde_json::from_str` fails, and the agent gets `generator_unreachable` (`child.rs:269-273`) for a
generation that in fact succeeded.

RobloxKit's review image is a JPEG at quality 0.85 (`01-robloxkit-clothing-design.md` §2.13), and
`budget.ts:33-36` already declares `REVIEW_IMAGE_MAX_EDGE = 1568` and
`REVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024` — neither constant is referenced anywhere.

### G13. The accept note names a tool that does not exist

`src/renderer/lib/generator/tools/generate-clothing.ts:77-78`

```ts
const ACCEPTED_NOTE =
  'Still designing in the background. Carry on; call get_task_result with this task_id.'
```

The tool is `get_clothing_task` (`generator_tools.rs:163` — `format!("get_{}_task", family.engine)`).
An agent that follows the note calls a nonexistent tool.

### G14. `get_*_task` descriptions omit `interrupted`

`src-tauri/src/acp/host_mcp/generator_tools.rs:166-167`

```rust
            "{DESCRIPTION_TAG}Read a {} generation started by `generate_{}`. Status is one of \
             queued, running, done, failed or cancelled. When it is done the reply carries the \
```

`TaskQueue.restore` produces `'interrupted'` (`task-queue.ts:172-181`), and
`GenerateClothingResult.status` includes it (`generate-clothing.ts:51`). An agent that sees
`"status":"interrupted"` has been told it cannot happen.

### G15. The session guide advertises ten working engines when nine are stubs

`src-tauri/src/acp/host_mcp/generator_tools.rs:33-46` — "this project can generate Roblox assets —
clothing, 3D models, sound effects, textures, skyboxes, icons, VFX, GFX renders, animations and
cutscenes". Only clothing has an engine (`gateway-handler.ts:20-39`). The truth is in the per-tool
refusal, which the agent only sees *after* it has already promised the user a 3D model.

## Medium — correctness and hygiene

### G16. `targetResolves` accepts region ids that resolve to nothing

`src/renderer/lib/generator/engines/clothing/schema.ts:109`

```ts
  return target.includes('_') && PARTS[type].some((part) => target.startsWith(part))
```

A prefix test, not a membership test. `torso_zzz` and `right_arm_garbage` both pass validation. Then
`resolveTarget` (`layout.ts:86-97`) falls through all three filters and returns `[]`, and
`render.ts:104-106` iterates an empty array. The layer paints nothing and no warning is raised.

The validator should compare against `regionsFor(type).map(r => r.id)`.

### G17. The prompt claims `x`/`y`/`w`/`h` are usable

`src/renderer/lib/generator/engines/clothing/prompt.ts:30`

```
  x, y, w, h, opacity     numbers from 0 to 1
```

`opacity` is honoured (`render.ts:59`). `x`, `y`, `w`, `h` are validated (`schema.ts:194-196`) and
read by nothing. Same for `outline`, `outlineWidth`, `weight`, `offsetX`, `offsetY`, `width`, `fit`,
`scale`, `locked` — 21 of the 34 declared layer fields are dead.

### G18. `SHEET_SIZE` is a misleading dead constant

`src/renderer/lib/generator/engines/clothing/layout.ts:26`

```ts
/** Sheet edge length for the full-body garments. */
export const SHEET_SIZE = 512
```

The comment is wrong: full-body garments are 585×559. 512 is the t-shirt size. Exported from
`index.ts:13`, referenced nowhere else in the tree.

### G19. The `render.ts` header describes behaviour the code does not have  *(FIXED in the uncommitted working tree - see the note at the top)*

`src/renderer/lib/generator/engines/clothing/render.ts:5-14`

```
 *  - consecutive pattern layers render into one **transparent** batch buffer, so
 *    a pattern with `opacity < 1` darkens toward black before compositing
 *    (`render:231-349`)
 *  - pattern coordinates are region-local, so every region restarts the pattern
 *    at its own corner
 *
 * Only the pattern batch runs here. Vector layers (text/image/shape/trim) need a
 * 2D canvas and are out of scope for the headless path.
```

The second bullet is true. The first is not: `paintPatternRegion` (`render.ts:51-79`) writes straight
into `pixels` and calls `blendOver` on a copy, which is plain source-over. There is no batch buffer.

### G20. `acp:prompt_complete` listener leaks on every turn timeout

`src/renderer/lib/generator/acp-brain-transport.ts:76-95`

```ts
      const finished = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`the ${scope} turn produced nothing within ${timeoutMs} ms`))
        }, timeoutMs)
        const stop = onAcpEvent<PromptCompleteEvent>('acp:prompt_complete', (event) => {
          if (event.sessionId !== sessionId) return
          clearTimeout(timer)
          stop()
          resolve()
        })
      })

      try {
        await acpSendPrompt(agentId, sessionId, text)
        await finished
        return collected
      } finally {
        stopChunks()
        await acpCloseSession(agentId, sessionId).catch(() => undefined)
      }
```

`stop()` is called only on the resolve path (line 83). The `finally` calls `stopChunks()` but not
`stop`. Every 300 s timeout leaves a `prompt_complete` handler subscribed for the lifetime of the
window. With `MAX_TRANSPORT_RETRIES = 2` and up to 14 turns, a failing agent accumulates handlers.

### G21. `clothingReview` takes a vision flag it ignores

`src/renderer/lib/generator/tools/generate-clothing.ts:99-115`

```ts
export function clothingReview(built: BuildResult): {
```

`loop.ts:177` calls `review(current, canImage)`, and `types.ts:102` declares
`Review = (built: BuildResult, hasImage: boolean) => ReviewParts`. The parameter is dropped, so the
review text is byte-identical with and without a picture. RobloxKit has a distinct no-image fallback
(`01-robloxkit-clothing-design.md` §3.4, "The no-image fallback").

### G22. The Studio context block is never supplied

`src/renderer/lib/generator/tools/generate-clothing.ts:73-74` declares `studio?: SessionStudio`, and
`generator-gateway.ts:56-67` never sets it. So `firstMessage` (`generate-clothing.ts:84-97`) always
takes the `if (studio)` false branch and the `Robloxkit session context` block
(`session-context.ts:53-70`) never reaches a real generation. Only
`__tests__/e2e-clothing.test.ts:250` exercises it.

The module docstring (`session-context.ts:1-11`) says "The context block is the reason a fresh chat
'just knows' it is in Roblox. Without it the user has to say 'load the Studio MCP, make object X'." —
and it is never sent.

### G23. The gateway cancels in-flight generations on project switch

`src/renderer/layouts/WorkspaceLayout.tsx:84-87` — the effect's cleanup is
`startGeneratorGateway`'s returned stop, which calls `queue.cancelAll()`
(`generator-gateway.ts:71-74`). A user who switches project while a generation runs loses it, and the
agent's subsequent `get_clothing_task` poll returns `cancelled`.

### G24. `brain` is frozen at gateway start

`src/renderer/lib/generator-gateway.ts:58` — `brain: brainOf()` is evaluated once. If no agent was
live at mount, `deps.brain` is permanently `{ id: 'custom' }`. `brainTakesImages` is dynamic (`:65`),
so only the label and `scope` fallback are affected — but `runClothingGeneration`'s
`{ ...deps.brain, signal }` (`generate-clothing.ts:166`) cannot repair a field that was never set.

---

## Summary table

| # | Defect | File:line | Severity |
|---|---|---|---|
| G1 | Review image dropped by the transport | `acp-brain-transport.ts:65` | critical |
| G2 | Review image is the UV atlas, not the avatar sheet | `build.ts:82`, `render.ts:87-110` | critical |
| G3 | `text`/`image`/`shape`/`trim` paint nothing | `render.ts:29-30`, `:103` | critical |
| G4 | `image` layers cannot validate (no attachment path) | `generate-clothing.ts:169` | critical |
| G5 | `resolveGeneratorAgent` config lookups never match | `agent-selection.ts:50`, `:54` | critical |
| G6 | Call's `agentId`/`sessionId` never passed to resolve | `generator-gateway.ts:47` | critical |
| G7 | `report.ok` always `true`; DONE gate never gates | `build.ts:84` | high |
| G8 | `background` disables both remaining checks | `render.ts:91-100` | high |
| G9 | `layout` is a static atlas dump, not a layer inventory | `render.ts:139-143` | high |
| G10 | Prompt advertises dead kinds and an impossible seam rule | `prompt.ts:26`, `:54` | high |
| G11 | Fresh ACP session per turn; roles flattened | `acp-brain-transport.ts:59-65` | high |
| G12 | 1 MiB reply cap fails successful generations | `child.rs:544` | high |
| G13 | Accept note names `get_task_result` (nonexistent) | `generate-clothing.ts:77-78` | high |
| G14 | `get_*_task` description omits `interrupted` | `generator_tools.rs:166-167` | medium |
| G15 | Session guide advertises 10 engines, 1 exists | `generator_tools.rs:33-46` | medium |
| G16 | `targetResolves` prefix test accepts dead region ids | `schema.ts:109` | medium |
| G17 | Prompt advertises `x/y/w/h`; 21 of 34 fields dead | `prompt.ts:30` | medium |
| G18 | `SHEET_SIZE = 512` dead and mislabelled | `layout.ts:26` | low |
| G19 | `render.ts` header describes a batch buffer that does not exist | `render.ts:5-14` | low |
| G20 | `prompt_complete` listener leaks on timeout | `acp-brain-transport.ts:76-95` | low |
| G21 | `clothingReview` ignores its vision flag | `generate-clothing.ts:99-115` | low |
| G22 | Studio context block never supplied | `generate-clothing.ts:73-74` | medium |
| G23 | Project switch cancels in-flight generations | `WorkspaceLayout.tsx:84-87` | medium |
| G24 | `brain` frozen at gateway start | `generator-gateway.ts:58` | low |

---

## What is actually faithful

For balance, these are correct and should not be touched:

- **The region atlas** (`layout.ts:35-78`). Every rect, stride, face order and sheet dimension matches
  RobloxKit byte for byte.
- **Target resolution precedence** (`layout.ts:86-97`). Exact id -> part -> face, with `"torso"` -> 6
  regions and `"left"` -> 3.
- **All nine pattern algorithms** (`pattern.ts:99-203`), including `mulberry32`, the memoised value
  noise, the plaid dither, and the polka stagger. The pinned tests
  (`__tests__/clothing.test.ts:113-197`) check the maths, not just that something was drawn.
- **Region-local pattern origins** (`render.ts:58`). Deliberate, and it matches.
- **The budget constants** (`budget.ts:11-24`). Every value is cited to a RobloxKit bundle line.
- **`extractSpec`** (`extract.ts:11-31`). Fence first, then brace span, first parse wins.
- **`isDone`** (`loop.ts:27-31`). Either end of the trimmed reply, matching `gen3d:957`.
- **`droppedConnection` / `isAbort`** (`loop.ts:39-52`). Transport retry classification, abort
  passthrough.
- **The type is forced from the tool call** (`schema.ts:241-243`, `build.ts:57`), so the model cannot
  change the garment type.
- **`TaskQueue`** (`task-queue.ts:87-288`). Concurrency clamp to 1..4, `interrupted` on restore,
  throttled UI emission, honest `cancelled` on abort.
- **The tool-call/task-id split** (`generate-clothing.ts:126-151`). Generation takes minutes; the MCP
  reply must not block. Correct, and `parent/generator.rs:20-25` documents why the 30 s timeout is
  safe.
- **The image-to-MCP-content-block lift** (`child.rs:283-310`). Turning the data URL into a real
  `ContentBlock::image` is the right call — the outer agent gets a viewable picture rather than a wall
  of base64.
- **The refusal for the 18 unimplemented tools** (`gateway-handler.ts:75-84`). An honest error beats a
  silently empty artifact.
- **The capability-based vision gate** (`agent-selection.ts:21-25`, `ask-brain.ts:44-46`). Reads
  `promptCapabilities.image` rather than guessing from the agent's name, and defaults to "no" so a
  wrong guess does not cost a retry.

The gap is not in the geometry or the pattern maths — those are a careful port. The gap is that the
**compositor stops at the pattern pass**, the **review artefact is the wrong image**, and the
**transport silently drops the one thing the loop exists to deliver**. Fix G1, G2, G3 and G5 and the
machine starts working; everything else on the list is refinement.
