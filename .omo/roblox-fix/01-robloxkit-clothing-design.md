# RobloxKit clothing: the complete design → render → review spec

**Question this file answers:** why does RobloxKit's generated clothing look good while a naive
clone produces flat, ugly garments?

**Provenance.** Everything below is read from the shipping RobloxKit SPA, de-minified, at
`C:\Users\Novella\Documents\Github\Robloxkit\artifacts\frontend_unmin\` (and cross-checked against
the still-minified `artifacts\frontend_src\assets\`). All `file:line` citations are 1-based lines of
the **unminified** files. Where a claim comes from an RE report rather than the source itself, the
report is cited. Where a claim is a derivation of mine rather than a statement in the code, it is
marked **[DERIVED]**.

| File | Size | Role |
|---|---|---|
| `clothing-62l72JIa.js` | 10,993 B / 512 L | orchestration, prompt builder, `build()` closure, task registration, persistence |
| `render-CpljO1Hx.js` | 11,091 B / 394 L | pattern math, PRNG, value noise, pixel painter, canvas compositor, PNG encoder call |
| `design-PKArvEjc.js` | 4,469 B / 132 L | `TYPES` / `LIMITS` / validator / `attachImages` / `checkDesign` |
| `layout-yFs0_M_2.js` | 1,860 B / 110 L | the 585×559 (and 512×512) UV region atlas |
| `palette-CdyFZUx0.js` | — | `#rrggbb` → `[r,g,b]` (the only colour parser the renderer uses) |
| `avatarRender-DVeE1evW.js` | 2,415 B / 97 L | `renderClothingSheet` / `renderClothingThumbnail` (three.js) |
| `avatar-CSK-yHJ2.js` | 7,499 B | `buildAvatar` R15/R6 blocky rig, skin tones, box-UV mapping, composite |
| `rig-P29m_B-3.js` | — | joint pivot tables, attachment tables, poses |
| `ClothingPanel-CEM_quBl.js` | 42,184 B | UI; used here for new-layer defaults, slider ranges, example prompts |
| `gen3d-BAdfthxw.js` | 27,367 B / 1,060 L | the shared `designLoop` (`Se` at `:814-1014`, exported as `Z`/`designLoop` at `:771`) |
| `index-DPVV2ya5.js` | 1,073,814 B | MCP tool surface + result envelopes (`:18835-19070`, `:42151-42202`) |
| `serverAssets-p9XPPBjy.js` | — | the prompt-bundle fetch contract (`:18-53`, `:40`) |

---

## TL;DR — the six things that make the difference

1. **The design is a 13-kind layer stack, not a colour plus a border.** RobloxKit has 9 procedural
   pattern generators (one of them a two-octave value-noise **camo**, one a **plaid** with a woven
   dither and pin-stripes) plus 4 vector layer kinds (`text`, `image`, `shape`, `trim`) that are
   composited through Canvas2D with per-region clipping. A naive clone that renders "solid + trim"
   throws away 11 of the 13 kinds, and the two it keeps are the two that produce flat output.
2. **The renderer is a two-pass compositor with real geometry.** A 585×559 atlas of **18 regions**
   (6 torso faces + 6 right-limb faces + 6 left-limb faces), each face getting its own independent
   pattern origin, pattern-clipped, then vector layers drawn on top through `save()/rect()/clip()`.
   Patterns are batched into one `Uint8ClampedArray` pass; vector layers force a flush.
3. **The model is shown the garment *on an avatar*, not the UV atlas.** `renderClothingSheet`
   renders three three.js views (front / back / left side) plus the flat template into a
   **1024×358 JPEG** and that image is attached to the review turn. This is the single biggest
   quality lever and it is invisible from the atlas.
4. **The loop is generate → build → *look at the render* → repair, twice.** `rounds: 2`,
   `vision: true`, with a 4-attempt build-retry budget on validator rejection. The self-critique is
   not a separate step: the review round *is* the critic.
5. **The feedback text is a per-layer inventory plus an explicit list of unpainted regions.** The
   `layout` string the model sees is `0. solid on all #1a3a8f` / `1. trim on torso #d4af37` / …
   followed by `Empty regions (skin shows): right_arm_front, left_arm_front`. A stats line ("painted
   100%, 2 colours") cannot be acted on; a region list can.
6. **A naive port can pass the checks and still be flat.** `checkDesign`'s `ok` is *always* `true` —
   no code path emits `level: "error"`. So `report.ok` never blocks `DONE`, and the only thing that
   ever forces a second look is the model reading the sheet image and the layer list. If your port
   drops the image or the list, nothing in the machine will ever notice the garment is flat.

The one thing that genuinely cannot be recovered is `prompts/clothing.md`, the system prompt. It is
an auth-gated server asset (`serverAssets-p9XPPBjy.js:40`; `GET /api/assets/...` → 401 on every path
tested). Everything *around* it — the user message, the review message, the layout formatter, the
fix message, every budget — is in the bundle and is reproduced verbatim below. See §3 and §7.

---

# 1. What EXACTLY the clothing design schema looks like

## 1.1 Top level

A design is a plain JSON object. There is no schema version, no units field, no canvas field — the
canvas size is derived from `type`.

| Field | Type | Required | Allowed | Default | Enforced at |
|---|---|---|---|---|---|
| `type` | string | **yes** | `"shirt"` \| `"pants"` \| `"tshirt"` | none (falls back to `shirt` **only inside error messages**) | `design:17-19` |
| `background` | string \| null | no | `/^#[0-9a-f]{6}$/i` | `null` | `design:20-22` |
| `layers` | array | **yes**, ≥ 1, ≤ 40 | — | — | `design:23-28` |
| `name` | string | no | free | — | **not validated**; read by `clothing:316`, `clothing:467` |
| `seed` | — | — | — | — | **not a design field.** There is no top-level seed; the seed is per-layer (§1.2) |

```js
// design-PKArvEjc.js:3-7
var s = [`shirt`, `pants`, `tshirt`];
var c = {
  layers: 40,
  text: 60
};
```

`type` is additionally **overwritten before validation** by the loop's `normalize` hook, so the
model can never change it:

```js
// clothing-62l72JIa.js:125-128
normalize: e => {
  e.type = t;
  return e;
},
```

## 1.2 The layer object — every field

This is the complete field set the renderer or the validator knows about, with the real defaults
the renderer applies when the field is absent. "Validated?" is `yes` only if `validateDesign`
actually rejects a bad value.

| Field | Type | Applies to | Allowed / range | Renderer default | Validated? |
|---|---|---|---|---|---|
| `id` | string | all | free | `` `l${index}` `` (`design:81`) | no |
| `name` | string | all | free (UI truncates to 40, `ClothingPanel:530`) | — | no |
| `kind` | string | all | one of the 13 `LAYER_KINDS` | — | **yes**, `design:38-40` |
| `target` | string | all | `all`, a part name, a face name, or a region id | `"all"` (`design:82`) | **yes**, `design:41-43` |
| `color` | `#rrggbb` | patterns, text, shape, trim | 6-hex | `#ffffff` | **yes** |
| `color2` | `#rrggbb` | patterns | 6-hex | `#000000` | **yes** |
| `color3` | `#rrggbb` | `plaid`, `camo` | 6-hex | plaid `#000000`, camo `#5a5a3c` | **yes** |
| `from` | `#rrggbb` | `gradient` (and any pattern via the `color ?? from` fallback) | 6-hex | used only if `color` absent | **yes** |
| `to` | `#rrggbb` | `gradient` (and any pattern via the `color2 ?? to` fallback) | 6-hex | used only if `color2` absent | **yes** |
| `outline` | `#rrggbb` | `text`, `shape` | 6-hex | none (no stroke drawn) | **yes** |
| `outlineWidth` | number | `shape` | any | `2` | **no** |
| `x` | number | `text`, `image`, `shape` | 0..1 | `0.5` | **yes** |
| `y` | number | `text`, `image`, `shape` | 0..1 | `0.5` | **yes** |
| `w` | number | `image`, `shape` | 0..1 | image: absent ⇒ fit mode; shape: `0.4` | **yes** |
| `h` | number | `shape` | 0..1 | derived — see §2.7 | **yes** |
| `opacity` | number | all (but honoured only by patterns) | 0..1 | `1` | **yes** |
| `size` | number | patterns, `text` | 1..400 | patterns `16`, text `32` | **yes** |
| `gap` | number | patterns | 0..400 | `= size` (after the `size` floor) | **yes** |
| `angle` | number | `gradient`, `stripes` only | -360..360 | `0` | **yes** |
| `seed` | number | `camo`, `noise` only | any | `7` | **NO** |
| `text` | string | `text` | 1..60 chars | — | **yes**, `design:53-56` |
| `font` | string | `text` | `sans`\|`serif`\|`mono`\|`display` | `sans` | **yes**, `design:57-59` |
| `weight` | number | `text` | any | `700` | **no** |
| `offsetX` | number | `text`, `image` | any (px) | `0` | **no** |
| `offsetY` | number | `text`, `image` | any (px) | `0` | **no** |
| `shape` | string | `shape` | one of `SHAPES` | `circle` | **yes**, `design:61-63` |
| `edge` | string | `trim` | `top`\|`bottom`\|`left`\|`right`\|`all`\|`sides` | `bottom` | **yes**, `design:64-66` |
| `width` | number | `trim` | any | `6` | **no** |
| `image` | integer | `image` | `0 .. images-1` | — | **yes**, `design:67-73` |
| `src` | string (data URL) | `image` | any | injected by `attachImages` | only "absent" is checked |
| `fit` | `"cover"` \| anything | `image` when `w` absent | — | `min` (contain) | **no** |
| `scale` | number | `image` when `w` absent | any | `1` | **no** |
| `hidden` | boolean | all | — | falsy ⇒ drawn | **no** |
| `locked` | boolean | all | UI only (blocks delete) | — | **no** |

## 1.3 The 13 layer kinds

```js
// render-CpljO1Hx.js:3
var r = [`solid`, `gradient`, `stripes`, `checks`, `plaid`, `polka`, `zigzag`, `camo`, `noise`];
// render-CpljO1Hx.js:154-161
var l = [...r, `text`, `image`, `shape`, `trim`];
var u = [`rect`, `circle`, `star`, `heart`, `diamond`, `triangle`];
var d = {
  sans: `"IBM Plex Sans Variable", system-ui, sans-serif`,
  serif: `Georgia, 'Times New Roman', serif`,
  mono: `ui-monospace, Menlo, monospace`,
  display: `Impact, 'Arial Black', system-ui, sans-serif`
};
```

So:

- **`PATTERNS` (9)** — `solid`, `gradient`, `stripes`, `checks`, `plaid`, `polka`, `zigzag`, `camo`, `noise`.
  These are the kinds rendered by the CPU pixel pass (`renderPixels`) and the ones the batch
  compositor groups together.
- **`LAYER_KINDS` (13)** — the 9 patterns + `text`, `image`, `shape`, `trim`. These are the four
  **vector** kinds, drawn by Canvas2D under a per-region clip.
- **`SHAPES` (6)** — `rect`, `circle`, `star`, `heart`, `diamond`, `triangle`.
- **`FONTS` (4)** — `sans`, `serif`, `mono`, `display` (with the literal CSS stacks above).
- **`TYPES` (3)** — `shirt`, `pants`, `tshirt`.

Which field each kind actually reads (this is the real dispatch, from `render:37-132` and
`render:261-345`):

| kind | reads | ignores (even if you send it) |
|---|---|---|
| `solid` | `color`/`from` | everything else |
| `gradient` | `from`/`color`, `to`/`color2`, `angle` | `size`, `gap`, `color3` |
| `stripes` | `color`, `color2`, `size`, `gap`, `angle` | `color3` |
| `checks` | `color`, `color2`, `size` | **`gap`**, **`angle`**, `color3` |
| `plaid` | `color`, `color2`, `color3`, `size`, `gap` | **`angle`** |
| `polka` | `color`, `color2`, `size`, `gap` | **`angle`** |
| `zigzag` | `color`, `color2`, `size`, `gap` | **`angle`** |
| `camo` | `color`, `color2`, `color3`, `size`, `seed` | **`angle`**, `gap` |
| `noise` | `color`, `color2`, `size`, `seed` | **`angle`**, `gap` |
| `text` | `text`, `color`, `size`, `font`, `weight`, `x`, `y`, `offsetX`, `offsetY`, `outline` | `opacity` |
| `image` | `src`/`image`, `x`, `y`, `w` *or* (`fit`, `scale`), `offsetX`, `offsetY` | `opacity` |
| `shape` | `shape`, `color`, `w`, `h`, `x`, `y`, `outline`, `outlineWidth` | `opacity` |
| `trim` | `edge`, `width`, `color` | `opacity` |

**Note the two traps:** `angle` is silently ignored by 7 of the 9 patterns, and `opacity` is
silently ignored by all four vector kinds (§2.8).

## 1.4 Nesting and z-order

Exactly two levels. `layers[]` is a **flat** array; z-order is **array order, index 0 = bottom**
(`render:210-216`, `render:261`). There are no groups, no per-layer `blend` mode, no per-layer mask.
`target` is the only way a layer restricts itself to part of the sheet.

`hidden: true` removes a layer entirely — no pixels, and it does **not** flush the pattern batch
(`render:262-266`).

## 1.5 `newDesign()` — the built-in starting design (the bar to clear)

`render:162-197`. Exported but **not called by the generation pipeline** — it is what the panel
opens with, and it is the canonical example of a well-formed design.

```js
// render-CpljO1Hx.js:162-197
function f(e = `shirt`) {
  return {
    type: e,
    name: e === `tshirt` ? `my-tshirt` : e === `pants` ? `my-pants` : `my-shirt`,
    background: null,
    layers: e === `tshirt` ? [{
      id: `l1`, kind: `gradient`, target: `all`, from: `#e11d48`, to: `#7c3aed`, angle: 45
    }, {
      id: `l2`, kind: `text`, target: `all`, text: `ROBLOXKIT`, color: `#ffffff`, size: 64
    }] : [{
      id: `l1`, kind: `solid`, target: `all`, color: e === `pants` ? `#1f2a44` : `#e11d48`
    }, {
      id: `l2`, kind: `stripes`, target: e === `pants` ? `left_leg` : `torso`,
      color: `#ffffff`, color2: e === `pants` ? `#1f2a44` : `#e11d48`,
      size: 6, gap: 26, angle: 90
    }]
  };
}
```

Read those numbers carefully — they are a worked example of *pattern scale*:

- Shirt: base `#e11d48` on **everything**, then stripes on **`torso`** only, `size: 6`, `gap: 26`,
  `angle: 90`. Period = 32 px. On a 128 px-tall torso face that is **4 bands**, 6 px of white and
  26 px of the base colour. The eye reads the *period*, not the stripe.
- Pants: base `#1f2a44`, stripes on **`left_leg`** only (one limb — an asymmetric accent, not an
  all-over pattern).
- T-shirt: a 45° two-stop gradient `#e11d48 → #7c3aed` plus 64 px text.

## 1.6 New-layer defaults the UI uses (what a hand edit looks like)

```js
// ClothingPanel-CEM_quBl.js:610-672
function qe(e, t) {
  let n = t === `tshirt` ? `all` : `torso_front`;
  switch (e) {
    case `text`:    return { kind: e, text: `TEXT`, color: `#ffffff`, size: 28, target: n, y: 0.4 };
    case `shape`:   return { kind: e, shape: `star`, color: `#ffd23f`, w: 0.4, target: n };
    case `trim`:    return { kind: e, edge: `bottom`, width: 8, color: `#ffffff`, target: `torso` };
    case `image`:   return { kind: e, src: null, w: 0.5, target: n };
    case `plaid`:   return { kind: e, color: `#b3202a`, color2: `#1b1b1f`, color3: `#e8e1d4`, size: 32, gap: 16, target: `all` };
    case `stripes`: return { kind: e, color: `#ffffff`, color2: `#1f2a44`, size: 8, gap: 16, angle: 90, target: `all` };
    default:        return { kind: `solid`, color: `#ffffff`, target: `all` };
  }
}
```

Two things to notice:

- Every vector layer defaults to `target: "torso_front"`, i.e. **one face**, not the whole garment.
  A naive port that defaults `target` to `all` will smear a chest motif across all six faces.
- The kinds addable by hand are a **subset** (`ClothingPanel:583`):
  `solid, stripes, plaid, text, shape, trim, image`. `gradient, checks, polka, zigzag, camo, noise`
  can only arrive from the model — but once present they are fully editable.

## 1.7 UI slider ranges are narrower than the validator

`ClothingPanel:761-776`:

| Slider | Range | Shown for |
|---|---|---|
| Pattern `Scale` | 4..80 (text `Size` 4..160) | stripes, checks, plaid, polka, zigzag, camo, noise, text |
| `Gap` | 1..80 | stripes, polka, plaid, zigzag |
| `Angle` | **0..180** | stripes, gradient |
| trim `Width` | 1..40 | trim |
| `Across` / `Down` (`x`,`y`) | 0..1, step 0.01 | text, image, shape |
| `Width` (`w`) | 0.05..1, step 0.01 | image, shape |
| `Opacity` | 0..1, step 0.05 | **every** kind (and does nothing on vector kinds) |

The validator accepts `size` 1..400 and `angle` -360..360, so the model can legally emit values
the human UI cannot reproduce by hand.

## 1.8 `attachImages` — the only normalisation the design gets

```js
// design-PKArvEjc.js:77-89
function d(e, t = []) {
  return {
    ...e,
    layers: (e.layers ?? []).map((e, n) => ({
      id: e.id ?? `l${n}`,
      target: `all`,
      ...e,
      ...(e.kind === `image` && e.image != null && t[e.image] ? { src: t[e.image] } : {})
    }))
  };
}
```

- `id` and `target` are the **only** defaults injected. Nothing else is filled in; every other
  default lives inside the renderer and is applied at draw time.
- `target: "all"` is written **before** `...e`, so an explicit `target` wins (correct).
- `src` is injected only when `t[image]` is truthy, so an `image` layer that already carries a `src`
  (hand-edited, `ClothingPanel:757`) survives `attachImages(design, [])`.

The inverse transform, `y()` in `clothing:20-46`, strips `src` back to an integer `image` index so a
design can be JSON-serialised into the prompt without embedding base64:

```js
// clothing-62l72JIa.js:20-46
function y(e, t = []) {
  let n = [...t];
  let r = (e?.layers ?? []).map(e => {
    if (e.kind !== `image` || !e.src) {
      return e;
    }
    let { src: t, ...r } = e;
    let i = n.indexOf(t);
    if (i < 0) {
      i = n.push(t) - 1;
    }
    return { ...r, image: i };
  });
  return {
    design: e ? { ...e, layers: r } : null,
    images: n
  };
}
```

**This is a load-bearing optimisation for prompt size:** the model never sees base64, only
`"image": 0`.

## 1.9 How this differs from a trivial "solid + trim" design

| Dimension | RobloxKit | A "solid + trim" clone |
|---|---|---|
| Layer kinds available | 13 (9 procedural + 4 vector) | 2 |
| Can a layer be limited to one body face? | yes — `target` resolves to 1 of 18 regions | no (or only "all") |
| Multi-colour patterns | `plaid` uses **3** colours + a 25 % dither + 65 % pin-stripes; `camo` uses 3 flat colours from a 2-octave noise field | 2 flat colours at most |
| Procedural texture | value noise + mulberry32, smoothstep-interpolated, feature size in px | none |
| Per-pixel tone variation | plaid dithers `(x+y)%2` cells 25 % toward the opposite colour; camo hard-thresholds at 0.40 / 0.62 | none — every pixel is one of N flat colours |
| Vector detail | text (4 fonts, weight, outline, multi-line, maxWidth squash), images (contain/cover/scale), 6 shapes (incl. 10-point star, bezier heart), trims on 6 edge sets | a border |
| Seam behaviour | deliberate: each face's pattern restarts at its own corner | accidental: one pattern stretched across the whole sheet |
| Empty-region detection | yes — 4 px lattice, < 5 % ⇒ region reported empty by id | none |
| Small-text detection | yes — text < 10 px warned | none |

A "solid + trim" garment is *flat* for a specific mechanical reason: `solid` is `return () => i`
(`render:129-130`) — a constant. There is no per-pixel variation anywhere in the image except the
trim rectangles. Every quality signal a viewer reads — weave, breakup, tonal depth, motif, heraldry
— comes from the 11 kinds the naive clone does not implement.
---

# 2. How RobloxKit renders the design to pixels — the full pipeline

## 2.1 One-line chain

```
design JSON
  -> validateDesign        (design:9)    -> string[]; non-empty => throw {problems}
  -> attachImages          (design:77)   -> inject id / target / src
  -> renderToCanvas        (render:231)  -> HTMLCanvasElement 585x559 | 512x512
       -> renderPixels per *pattern batch*  (render:198) -> Uint8ClampedArray
            -> pattern closure              (render:37)  -> per-pixel [r,g,b]
                 -> palette.parse           (palette:4) -> [r,g,b]
                 -> mulberry32 + valueNoise (render:4, render:14)
       -> flush: putImageData into a scratch canvas, drawImage onto the main canvas
       -> 2D clip + text / image / shape / trim   (render:261-345)
  -> getImageData(...).data            (clothing:231) -> Uint8ClampedArray for checkDesign
  -> canvas.toBlob("image/png")        (render:352)   -> PNG bytes   [only via renderPng]
  -> renderClothingThumbnail           (avatarRender:49)  -> 256x256 PNG bytes  (thumb.png)
  -> renderClothingSheet               (avatarRender:63)  -> 1024x358 JPEG dataURL  (the review image)
```

## 2.2 Canvas size

```js
// layout-yFs0_M_2.js:74-86
function i(e) {
  if (e === `tshirt`) {
    return { width: 512, height: 512 };
  } else {
    return { width: 585, height: 559 };
  }
}
```

- `shirt` and `pants`: **585 x 559** = 327,015 px.
- `tshirt`: **512 x 512** = 262,144 px.

Coordinate system: **y-down, origin top-left, unit = 1 px.** The atlas is authored as pixel
rectangles, not normalised UVs.

UVs are flipped for three.js in `rectUvs`, hard-coded to 585/559:

```js
// avatar-CSK-yHJ2.js:74-80
function k(e) {
  let t = e.x / 585;
  let n = (e.x + e.w) / 585;
  let r = 1 - e.y / 559;
  let i = 1 - (e.y + e.h) / 559;
  return [t, r, n, r, t, i, n, i];
}
```

The t-shirt bypasses this path entirely (it is a separate 512x512 plane on the chest, 2.15).

## 2.3 The region atlas — complete, exact

`layout-yFs0_M_2.js:1-73`. The torso block (`e()`), then two limb blocks (`t()`).

### Torso — 6 regions

```js
// layout-yFs0_M_2.js:1-27
function e() {
  return [...[[`right`, 165, 64], [`front`, 231, 128], [`left`, 361, 64], [`back`, 427, 128]].map(([e, t, n]) => ({
    id: `torso_${e}`,
    part: `torso`,
    face: e,
    x: t,
    y: 74,
    w: n,
    h: 128
  })), {
    id: `torso_up`,
    part: `torso`,
    face: `up`,
    x: 231,
    y: 8,
    w: 128,
    h: 64
  }, {
    id: `torso_down`,
    part: `torso`,
    face: `down`,
    x: 231,
    y: 204,
    w: 128,
    h: 64
  }];
}
```

| id | part | face | x | y | w | h |
|---|---|---|---|---|---|---|
| `torso_right` | torso | right | 165 | 74 | 64 | 128 |
| `torso_front` | torso | front | 231 | 74 | 128 | 128 |
| `torso_left` | torso | left | 361 | 74 | 64 | 128 |
| `torso_back` | torso | back | 427 | 74 | 128 | 128 |
| `torso_up` | torso | up | 231 | 8 | 128 | 64 |
| `torso_down` | torso | down | 231 | 204 | 128 | 64 |

### Limbs — 6 regions per limb

```js
// layout-yFs0_M_2.js:28-54
function t(e, t, n, r) {
  return [...n.map((n, r) => ({
    id: `${e}_${n}`,
    part: e,
    face: n,
    x: t + r * 66,
    y: 355,
    w: 64,
    h: 128
  })), {
    id: `${e}_up`,
    part: e,
    face: `up`,
    x: r,
    y: 289,
    w: 64,
    h: 64
  }, {
    id: `${e}_down`,
    part: e,
    face: `down`,
    x: r,
    y: 485,
    w: 64,
    h: 64
  }];
}
```

**The stride is 66, the face width is 64** — a 2 px gutter between consecutive faces on a limb.

Arms — `t("right_arm", 19, ["left","back","right","front"], 217)` and
`t("left_arm", 308, ["front","left","back","right"], 308)`:

| id | x | y | w | h |
|---|---|---|---|---|
| `right_arm_left` | 19 | 355 | 64 | 128 |
| `right_arm_back` | 85 | 355 | 64 | 128 |
| `right_arm_right` | 151 | 355 | 64 | 128 |
| `right_arm_front` | 217 | 355 | 64 | 128 |
| `right_arm_up` | 217 | 289 | 64 | 64 |
| `right_arm_down` | 217 | 485 | 64 | 64 |
| `left_arm_front` | 308 | 355 | 64 | 128 |
| `left_arm_left` | 374 | 355 | 64 | 128 |
| `left_arm_back` | 440 | 355 | 64 | 128 |
| `left_arm_right` | 506 | 355 | 64 | 128 |
| `left_arm_up` | 308 | 289 | 64 | 64 |
| `left_arm_down` | 308 | 485 | 64 | 64 |

Legs are the **identical geometry** with `part` = `right_leg` / `left_leg`:
`t("right_leg", 19, ["left","back","right","front"], 217)` and
`t("left_leg", 308, ["front","left","back","right"], 308)`.

### Counts

```js
// layout-yFs0_M_2.js:55-73
var n = {
  shirt: [`right_arm`, `left_arm`],
  pants: [`right_leg`, `left_leg`]
};
function r(r) {
  if (r === `tshirt`) {
    return [{
      id: `graphic`, part: `torso`, face: `front`, x: 0, y: 0, w: 512, h: 512
    }];
  }
  let [i, a] = n[r] ?? n.shirt;
  return [...e(), ...t(i, 19, [`left`, `back`, `right`, `front`], 217), ...t(a, 308, [`front`, `left`, `back`, `right`], 308)];
}
```

- `shirt`: **18 regions** (6 torso + 6 right_arm + 6 left_arm)
- `pants`: **18 regions** (6 torso + 6 right_leg + 6 left_leg)
- `tshirt`: **1 region** (`graphic`, 0,0,512,512)

**[DERIVED]** The 18 regions cover 147,456 of the 327,015 atlas pixels = **45.1 %**. The other 55 %
is gutter, margin and the inter-limb gaps. A pattern with `target: "all"` paints only the 18
rectangles; the rest of the sheet stays transparent (or `background`, if set).

## 2.4 Target resolution — three-step precedence

```js
// layout-yFs0_M_2.js:94-109
function o(e, t = `all`) {
  let n = r(e);                              // all regions for this type
  if (t === `all`) {
    return n;
  }
  let i = n.filter(e => e.id === t);
  if (i.length) {
    return i;                                // 1. exact region id
  }
  let a = n.filter(e => e.part === t);
  if (a.length) {
    return a;                                // 2. part name
  } else {
    return n.filter(e => e.face === t);      // 3. face name
  }
}
```

Precedence matters, and it has two sharp edges:

- `"torso"` resolves at step 2 as a **part** => 6 regions.
- `"front"` / `"back"` / `"left"` / `"right"` / `"up"` / `"down"` fall through step 2 (no part is
  named `"left"` — parts are `torso`, `right_arm`, `left_arm`) and resolve at step 3 as a **face**
  => 3 regions. So `target: "left"` means "every left-facing face", **not** the left arm.
- `"left_arm"` / `"right_arm"` resolve at step 2 as a **part** => 6 regions. For `pants` those names
  do not exist, and `left_leg`/`right_leg` do not exist for `shirt` — the validator rejects them
  with an explicit part list.

The UI's target picker is exactly this ladder (`ClothingPanel:673-694`): `all` -> each part -> each
face (`front`, `back`, `left`, `right`, `up`, `down`) -> each region id, labelled `Torso x front`.

## 2.5 `renderPixels` — the raw buffer pass, verbatim

```js
// render-CpljO1Hx.js:198-218
function p(i) {
  let { width: a, height: o } = t(i.type);
  let s = new Uint8ClampedArray(a * o * 4);
  if (i.background) {
    let [t, n, r] = e(i.background);
    for (let e = 0; e < s.length; e += 4) {
      s.set([t, n, r, 255], e);
    }
  }
  for (let e of i.layers ?? []) {
    if (!e.hidden && r.includes(e.kind)) {
      for (let t of n(i.type, e.target)) {
        c(s, a, t, e);
      }
    }
  }
  return s;
}
```

Non-pattern kinds are **silently ignored** here. That is deliberate: the batch passes
`background: null`, so a batch buffer always starts as transparent black.

## 2.6 The per-region painter `c`, verbatim

```js
// render-CpljO1Hx.js:133-153
function c(e, t, n, r) {
  let i = s(r, n.w, n.h);                                     // pattern closure, region-local W,H
  let a = Math.min(1, Math.max(0, Number(r.opacity ?? 1)));
  for (let r = 0; r < n.h; r++) {
    for (let o = 0; o < n.w; o++) {
      let s = ((n.y + r) * t + n.x + o) * 4;                  // atlas byte offset
      let [c, l, u] = i(o, r);                                // colour at REGION-LOCAL (x,y)
      if (a >= 1) {
        e[s] = c;
        e[s + 1] = l;
        e[s + 2] = u;
        e[s + 3] = 255;
      } else {
        e[s] = Math.round(e[s] * (1 - a) + c * a);
        e[s + 1] = Math.round(e[s + 1] * (1 - a) + l * a);
        e[s + 2] = Math.round(e[s + 2] * (1 - a) + u * a);
        e[s + 3] = Math.max(e[s + 3], Math.round(a * 255));
      }
    }
  }
}
```

Two facts a reimplementation must get right:

1. **The pattern is evaluated at region-local coordinates.** `i(o, r)` with `o` = x within the
   region, `r` = y within the region, and `s(r, n.w, n.h)` was constructed with the *region's* width
   and height. So **`(0,0)` of every pattern is the region's top-left corner**, always.
   Consequences:
   - plaid / checks / stripes **do not align** across the front / back / side faces;
   - a layer with `target: "torso"` draws the *same* pattern six times, each anchored to its own face;
   - a `gradient` restarts on every face (which is why the default t-shirt gradient is on `all` of a
     single 512x512 region — it has only one face to restart on).
   This is a real, visible seam and it is intentional.
2. **`opacity < 1` is a straight "over" in sRGB byte space, and alpha is a `max`, not an
   accumulate.** Two 50 % layers give alpha 128, not 191. This makes semi-transparent patterns *not*
   composite like normal `source-over`.

## 2.7 The nine pattern algorithms — exact math

### 2.7.1 Shared prelude

```js
// render-CpljO1Hx.js:37-45
function s(t, n, r) {                          // (layer, regionWidth, regionHeight)
  let i = e(t.color ?? t.from ?? `#ffffff`);   // A = primary colour
  let s = e(t.color2 ?? t.to ?? `#000000`);    // B = secondary colour
  let c = Math.max(2, Number(t.size ?? 16));   // S = band size (floor 2, no ceiling)
  let l = Math.max(1, Number(t.gap ?? c));     // G = gap (floor 1, default = S)
  let u = Number(t.angle ?? 0) % 360 * Math.PI / 180;  // theta (wraps, no clamp)
  let d = Math.cos(u);                         // cos theta
  let f = Math.sin(u);                         // sin theta
  let p = Number(t.seed ?? 7);                 // seed
  switch (t.kind) { ... }
}
```

The colour parser (`palette-CdyFZUx0.js:4-8`):

```js
function r(e) {
  let t = String(e).replace(`#`, ``);
  let n = parseInt(t.length === 3 ? t.replace(/./g, `$&$&`) : t, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
```

Accepts `#rgb` and `#rrggbb`. Anything else => `parseInt` gives `NaN` => bitwise coercion yields
`[0,0,0]`. The validator already restricts to 6 hex, so this is only reachable by hand-editing.

The colour lerp helper (`render:36`):

```js
var o = (e, t, n) => e.map((e, r) => Math.round(e + (t[r] - e) * n));
```

**Canonical lerp:** `out[k] = round(A[k] + (B[k] - A[k]) * t)`, k in {r,g,b}, `t` clamped by the
caller. `Math.round`, not floor — half-up.

### 2.7.2 `solid`

```js
// render-CpljO1Hx.js:129-130
default:
  return () => i;
```

Constant `A`. Also the fallback for any unknown kind (unreachable — the validator rejects unknown
kinds).

### 2.7.3 `gradient`

```js
// render-CpljO1Hx.js:47-54
case `gradient`:
  {
    let e = Math.abs(n * d) + Math.abs(r * f) || 1;
    return (t, a) => {
      let c = ((t - n / 2) * d + (a - r / 2) * f) / e + 0.5;
      return o(i, s, Math.min(1, Math.max(0, c)));
    };
  }
```

With `W` = region width, `H` = region height, `c = cos(theta)`, `s = sin(theta)`:

```
denom = |W*c| + |H*s|                                  (or 1 if that is 0 — unreachable)
t     = ((x - W/2)*c + (y - H/2)*s) / denom + 0.5      clamped to [0,1]
out   = round(A + (B - A)*t)
```

This is a projection of the centred pixel onto the `(c,s)` axis, **normalised by the bounding-box
extent of that axis** — so the gradient always spans exactly the full region regardless of `angle`,
and both end colours are always reached. `angle: 0` => horizontal left to right. `angle: 45` => the
`newDesign` t-shirt diagonal.

`from`/`to` are honoured **only** through the prelude fallback (`color ?? from`, `color2 ?? to`). If
the model emits both `color` and `from`, `color` wins and `from` is silently ignored.

### 2.7.4 `stripes`

```js
// render-CpljO1Hx.js:55-56
case `stripes`:
  return (e, t) => ((e * d + t * f) % (c + l) + c + l) % (c + l) < c ? i : s;
```

```
period = S + G
u      = ((x*cos(theta) + y*sin(theta)) mod period + period) mod period   (double-mod => positive)
out    = u < S ? A : B
```

- **Stripe width = `S` = `size`; period = `size + gap`.**
- `angle: 0` => `cos=1, sin=0` => bands vary with x (vertical stripes).
- `angle: 90` => `cos=0, sin=1` => bands vary with y (horizontal "hoops"). That is why `newDesign`
  uses `angle: 90`.
- Bands restart at each region's corner (2.6).

### 2.7.5 `checks`

```js
// render-CpljO1Hx.js:57-58
case `checks`:
  return (e, t) => (Math.floor(e / c) + Math.floor(t / c)) % 2 == 0 ? i : s;
```

Checkerboard with **cell = `S` exactly**. `gap` is read into `l` but **never used**. `angle` unused.
Parity of `floor(x/S) + floor(y/S)`.

### 2.7.6 `plaid` — the richest pattern

```js
// render-CpljO1Hx.js:59-80
case `plaid`:
  {
    let n = e(t.color3 ?? `#000000`);          // C = third colour
    let r = c + l;                             // period P = S + G
    let a = c / 2;                             // half-band h = S/2
    let u = Math.max(1, Math.round(c / 12));   // pin width w = max(1, round(S/12))
    let d = r - l / 2;                         // pin centre = P - G/2
    return (e, t) => {
      let c = (e % r + r) % r;                 // px = x mod P
      let l = (t % r + r) % r;                 // py = y mod P
      let f = (+(c < a) + +(l < a)) / 2;       // tone t in {0, 0.5, 1}
      let p = o(i, s, f);                      // base = lerp(A,B,t)
      if ((e + t) % 2 == 0 && f === 0.5) {
        p = o(p, c < a ? s : i, 0.25);         // dither the 50 % cells 25 % toward the *other* colour
      }
      if (Math.abs(c - d) < u / 2 + 0.25 || Math.abs(l - d) < u / 2 + 0.25) {
        return o(p, n, 0.65);                  // pin stripes: 65 % toward C
      } else {
        return p;
      }
    };
  }
```

Decoded:

- `tone = (hx + hy)/2` where `hx = 1 if (x mod P) < S/2`, `hy` likewise. Three tone levels: 0, 0.5, 1.
- **Half-band, not full band** — the primary band occupies only the first `S/2` of each period. This
  is what makes it read as woven rather than striped.
- **Dither:** on a checkerboard (`(x+y) % 2 === 0`) and only in the 0.5 tone, blend 25 % toward the
  opposite colour. `c < a ? s : i` — if the *x* band is active, blend toward B, else toward A. This
  is the weave texture.
- **Pins:** a line of width `w = max(1, round(S/12))` (plus a 0.25 px anti-alias allowance) at
  `P - G/2` in both axes, blended **65 %** toward `color3`. With `gap` small the pin sits near the
  period boundary; with `gap = S` it sits at `1.5S`, i.e. mid-gap.
- `angle` is read but **not used**.

### 2.7.7 `polka`

```js
// render-CpljO1Hx.js:94-107
case `polka`:
  {
    let e = c / 2;                             // radius R = S/2
    let t = c + l;                             // cell P = S + G
    return (n, r) => {
      let a = ((n + (Math.floor(r / t) % 2 ? t / 2 : 0)) % t + t) % t - t / 2;
      let o = (r % t + t) % t - t / 2;
      if (a * a + o * o <= e * e) {
        return i;
      } else {
        return s;
      }
    };
  }
```

Square lattice of pitch `P = S + G`; **odd rows are shifted by `P/2`** (staggered dots). Cell-local
coords are centred on 0. Inside a circle of radius `S/2` => `A`, else `B`. Dots touch when `gap = 0`
(but `gap` is floored to 1). `angle` unused.

### 2.7.8 `zigzag`

```js
// render-CpljO1Hx.js:81-93
case `zigzag`:
  {
    let e = c / 2;                             // amplitude A = S/2
    let t = Math.max(4, c * 2);                // wavelength L = max(4, 2S)
    return (n, r) => {
      let a = (n % t + t) % t;                 // x mod L
      if (((r - (a < t / 2 ? a : t - a) / (t / 2) * e) % (c + l) + c + l) % (c + l) < c) {
        return i;
      } else {
        return s;
      }
    };
  }
```

A triangle wave `tri(x) = (x mod L < L/2) ? (x mod L) : (L - (x mod L))`, normalised by `L/2` and
scaled by `A = S/2`, giving a sawtooth in `[0, S/2]`. Then `y' = y - tri(x)` and the stripes test
`(y' mod (S+G)) < S` decides. Net: horizontal stripes bent into a zigzag with **amplitude `S/2` and
wavelength `2S`**. `angle` unused.

### 2.7.9 `camo` — two-octave value noise, hard-thresholded

```js
// render-CpljO1Hx.js:108-123
case `camo`:
  {
    let n = a(p, c * 2);           // f1 = fbm(seed,     feature size 2S)
    let r = a(p + 1, c);           // f2 = fbm(seed + 1, feature size S)
    let o = e(t.color3 ?? `#5a5a3c`);   // C
    return (e, t) => {
      let a = n(e, t) * 0.7 + r(e, t) * 0.3;
      if (a < 0.4) {
        return i;                  // A
      } else if (a < 0.62) {
        return s;                  // B
      } else {
        return o;                  // C
      }
    };
  }
```

Two independent value-noise fields at different frequencies, blended **0.7 / 0.3**, then
**hard-thresholded into three flat colours** at `0.40` and `0.62`. No anti-aliasing — this is why it
reads as camouflage rather than smoke. `size` sets the blob scale; `seed` and `seed+1` decorrelate
the two octaves. `angle` unused.

### 2.7.10 `noise`

```js
// render-CpljO1Hx.js:124-128
case `noise`:
  {
    let e = a(p, c);
    return (t, n) => o(i, s, e(t, n));
  }
```

Single-octave value noise at feature size `S`, used **directly as the lerp factor** between A and B.
Full-range continuous gradient, `round()` per channel.

### 2.7.11 The seeded PRNG — mulberry32, exact

```js
// render-CpljO1Hx.js:4-13
function i(e) {
  let t = e >>> 0;
  return () => {
    t = t + 1831565813 >>> 0;
    let e = t;
    e = Math.imul(e ^ e >>> 15, e | 1);
    e ^= e + Math.imul(e ^ e >>> 7, e | 61);
    return ((e ^ e >>> 14) >>> 0) / 4294967296;
  };
}
```

This is **mulberry32**. Constants: increment `1831565813` = `0x6D2B79F5`; shifts `15, 7, 14`;
multipliers via `Math.imul`; `e | 1` forces odd. Output is `uint32 / 2^32` in `[0,1)`.

### 2.7.12 The noise function — hashed value noise + smoothstep

```js
// render-CpljO1Hx.js:14-35
function a(e, t) {
  let n = new Map();
  let r = (t, r) => {                        // lattice hash -> sample
    let a = t * 73856093 ^ r * 19349663;
    if (!n.has(a)) {
      n.set(a, i(e ^ a)());
    }
    return n.get(a);
  };
  let a = e => e * e * (3 - e * 2);          // smoothstep
  return (e, n) => {
    let i = e / t;                           // u = x / featureSize
    let o = n / t;                           // v = y / featureSize
    let s = Math.floor(i);
    let c = Math.floor(o);
    let l = a(i - s);                        // fx, smoothstepped
    let u = a(o - c);                        // fy, smoothstepped
    let d = r(s, c) * (1 - l) + r(s + 1, c) * l;
    let f = r(s, c + 1) * (1 - l) + r(s + 1, c + 1) * l;
    return d * (1 - u) + f * u;
  };
}
```

Exact facts a reimplementation must match:

1. **Lattice hash** `h(ix, iy) = ix * 73856093 XOR iy * 19349663`. JS `*` on doubles then `^`
   coerces via ToInt32, so effectively `int32(ix*73856093) ^ int32(iy*19349663)`.
2. **Per-cell value** = `mulberry32(seed ^ hash)()` — the *first* output of a fresh PRNG, seeded with
   `(seed ^ hash) >>> 0`.
3. **Memoised** in a per-pattern-instance `Map` keyed by the hash. The Map is created fresh on every
   `s(layer, W, H)` call, i.e. **per layer per region** (`render:134` calls `s` once per region).
   Identical `(ix,iy)` in different regions of the same layer get the same value (deterministic);
   different layers with the same seed also get the same field.
4. **Interpolation** is bilinear on a **smoothstep** remap `3u^2 - 2u^3` — *not* the quintic
   `6u^5 - 15u^4 + 10u^3`.
5. Feature size `t` = `S` (noise) or `S`, `2S` (camo). Larger `size` => larger blobs.
6. Output range `[0,1)`.

## 2.8 `renderToCanvas` — the two-pass compositor, verbatim

```js
// render-CpljO1Hx.js:231-349
async function g(e, i) {
  let { width: a, height: o } = t(e.type);
  i.width = a;
  i.height = o;
  let s = i.getContext(`2d`);
  s.clearRect(0, 0, a, o);
  let c = [];                                   // the pending pattern batch
  let l = () => {                               // flush the batch
    if (!c.length) {
      return;
    }
    let t = p({ ...e, background: null, layers: c });
    let n = document.createElement(`canvas`);
    n.width = a;
    n.height = o;
    n.getContext(`2d`).putImageData(new ImageData(t, a, o), 0, 0);
    s.drawImage(n, 0, 0);
    c = [];
  };
  if (e.background) {
    s.fillStyle = e.background;
    s.fillRect(0, 0, a, o);
  }
  for (let t of e.layers ?? []) {
    if (!t.hidden) {
      if (r.includes(t.kind)) {                 // r = the 9 pattern kinds
        c.push(t);
        continue;
      }
      l();                                      // flush pattern batch BEFORE a vector layer
      for (let r of n(e.type, t.target)) {
        s.save();
        s.beginPath();
        s.rect(r.x, r.y, r.w, r.h);
        s.clip();
        ...                                     // text / image / shape / trim (2.9)
        s.restore();
      }
    }
  }
  l();                                          // final flush
  return i;
}
```

Layer order and batching, precisely:

1. `clearRect` the whole canvas (transparent).
2. If `background` => `fillRect` with the raw hex string on the 2D context (opaque, alpha 255).
3. Walk `layers` in array order (index 0 = bottom).
   - `hidden: true` => skipped entirely (no pixels, no batch flush).
   - pattern kind => **pushed to a pending batch**; no flush.
   - vector kind (`text`/`image`/`shape`/`trim`) => **flush the batch first**, then draw this layer.
4. Flush the batch.

**Batch semantics — the trap.** A run of consecutive pattern layers is rendered as *one* off-screen
buffer by `renderPixels({...design, background:null, layers:batch})`, i.e. starting from
**transparent black**, not from the canvas' current contents; then `putImageData` into a scratch
canvas and `drawImage`d onto the main canvas with the default `source-over`.

Consequence: a pattern layer with `opacity < 1` blends toward **transparent black inside the batch**,
producing a darkened, semi-transparent colour, which then source-overs over the canvas. A 50 % red
`#ff0000` pattern over a white background yields roughly `(191,128,128)`, not `(255,128,128)`. This
is a real double-darkening artifact, not a rounding detail.

## 2.9 The four vector kinds — exact draw code

All four run inside `save() / beginPath() / rect(region) / clip() / ... / restore()` per region
(`render:268-343`), so they are hard-clipped to the face they target.

### 2.9.1 `text` (`render:274-295`)

```js
if (t.kind === `text` && t.text) {
  let n = Math.max(6, Number(t.size ?? 32));
  s.font = `${t.weight ?? 700} ${n}px ${d[t.font] ?? d.sans}`;
  s.textAlign = `center`;
  s.textBaseline = `middle`;
  let i = String(t.text).split(`\n`);
  let a = n * 1.1;                                   // line height
  let o = r.x + r.w * e(t.x) + Number(t.offsetX ?? 0);
  let c = r.y + r.h * e(t.y) + Number(t.offsetY ?? 0);
  i.forEach((e, l) => {
    let u = c + (l - (i.length - 1) / 2) * a;        // vertically centred block
    if (t.outline) {
      s.lineWidth = Math.max(2, n / 10);
      s.lineJoin = `round`;
      s.strokeStyle = t.outline;
      s.strokeText(e, o, u, r.w * 0.96);             // maxWidth squashes
    }
    s.fillStyle = t.color ?? `#ffffff`;
    s.fillText(e, o, u, r.w * 0.96);
  });
}
```

- `e = (v, d = 0.5) => Number(v ?? d)` (`render:273`) — the `x`/`y` accessor, **unclamped**. A model
  returning `x: 3` places the text off-canvas.
- Multi-line via `\n`; the block is centred on `y`; `maxWidth = regionWidth * 0.96` so long text is
  **horizontally condensed** rather than wrapped or clipped.
- Outline width `max(2, size/10)`, `lineJoin: round`.
- Default weight `700`, default font `sans`.

### 2.9.2 `image` (`render:296-311`)

```js
if (t.kind === `image` && t.src) {
  let n = await h(t.src);
  let i;
  let a;
  if (t.w) {
    i = r.w * Number(t.w);
    a = n.height / n.width * i;
  } else {
    let e = (t.fit === `cover` ? Math.max : Math.min)(r.w / n.width, r.h / n.height) * Number(t.scale ?? 1);
    i = n.width * e;
    a = n.height * e;
  }
  let o = r.x + r.w * e(t.x) + Number(t.offsetX ?? 0);
  let c = r.y + r.h * e(t.y) + Number(t.offsetY ?? 0);
  s.drawImage(n, o - i / 2, c - a / 2, i, a);
}
```

- With `w`: width = `regionWidth * w`, height preserves aspect.
- Without `w`: **contain** (or **cover** if `fit:"cover"`), times `scale`.
- Placement is **centre-anchored**: `drawImage(img, cx - w/2, cy - h/2, w, h)` with
  `cx = region.x + region.w*x + offsetX`, `cy = region.y + region.h*y + offsetY`.
- Images are loaded through a module-level `Map`-cached `Image` (`render:219-230`), error text
  `could not read that image`.

### 2.9.3 `shape` (`render:312-323`) and its path builder

```js
if (t.kind === `shape`) {
  let n = r.w * Number(t.w ?? 0.4);
  let i = r.h * Number(t.h ?? t.w ?? 0.4) * (t.h ? 1 : r.w / r.h);
  v(s, t.shape ?? `circle`, r.x + r.w * e(t.x), r.y + r.h * e(t.y), n, i);
  s.fillStyle = t.color ?? `#ffffff`;
  s.fill();
  if (t.outline) {
    s.lineWidth = Number(t.outlineWidth ?? 2);
    s.strokeStyle = t.outline;
    s.stroke();
  }
}
```

The size derivation is subtle and must be copied exactly:

- `w` only: `n = regionW * w`; `i = regionH * w * (regionW / regionH) = w * regionW`.
  => **a circle stays circular in pixels**, because both axes come out as `w * regionW`.
- explicit `h`: `i = regionH * h` (no aspect correction) — so `w` and `h` are in different units
  (fractions of *different* region dimensions). This is a genuine quirk.
- Centre = `(region.x + region.w*x, region.y + region.h*y)`.

```js
// render-CpljO1Hx.js:355-393
function v(e, t, n, r, i, a) {
  e.beginPath();
  let o = i / 2;
  let s = a / 2;
  switch (t) {
    case `rect`:
      e.rect(n - o, r - s, i, a);
      break;
    case `diamond`:
      e.moveTo(n, r - s);
      e.lineTo(n + o, r);
      e.lineTo(n, r + s);
      e.lineTo(n - o, r);
      e.closePath();
      break;
    case `triangle`:
      e.moveTo(n, r - s);
      e.lineTo(n + o, r + s);
      e.lineTo(n - o, r + s);
      e.closePath();
      break;
    case `star`:
      for (let t = 0; t < 10; t++) {
        let i = -Math.PI / 2 + t * Math.PI / 5;
        let a = t % 2 ? 0.45 : 1;
        e.lineTo(n + Math.cos(i) * o * a, r + Math.sin(i) * s * a);
      }
      e.closePath();
      break;
    case `heart`:
      e.moveTo(n, r + s);
      e.bezierCurveTo(n - o * 1.4, r, n - o * 0.6, r - s * 1.2, n, r - s * 0.4);
      e.bezierCurveTo(n + o * 0.6, r - s * 1.2, n + o * 1.4, r, n, r + s);
      e.closePath();
      break;
    default:
      e.ellipse(n, r, o, s, 0, 0, Math.PI * 2);
  }
}
```

- `star`: **10 vertices**, outer radius `1.0`, inner radius **`0.45`**, starting at `-PI/2` (top),
  step `PI/5` (36 degrees). It uses `lineTo` from a fresh path — the first `lineTo` acts as a
  `moveTo` in Canvas2D.
- `heart`: two cubic Beziers, symmetric; the "waist" control points are `+/-1.4*o` horizontally and
  `-1.2*s` vertically.
- `circle` is the **`default`** branch => an unknown shape string also renders a circle (unreachable —
  the validator rejects unknown shapes).

### 2.9.4 `trim` (`render:324-342`)

```js
if (t.kind === `trim`) {
  let e = Math.max(1, Number(t.width ?? 6));
  s.fillStyle = t.color ?? `#ffffff`;
  let n = t.edge === `all` ? [`top`, `bottom`, `left`, `right`] : t.edge === `sides` ? [`left`, `right`] : [t.edge ?? `bottom`];
  for (let t of n) {
    if (t === `top`) {
      s.fillRect(r.x, r.y, r.w, e);
    }
    if (t === `bottom`) {
      s.fillRect(r.x, r.y + r.h - e, r.w, e);
    }
    if (t === `left`) {
      s.fillRect(r.x, r.y, e, r.h);
    }
    if (t === `right`) {
      s.fillRect(r.x + r.w - e, r.y, e, r.h);
    }
  }
}
```

- `width = max(1, width ?? 6)`, in **pixels** (not a fraction).
- Edge expansion: `all` => top+bottom+left+right; `sides` => left+right; otherwise the single named
  edge, defaulting to `bottom`.
- Plain `fillRect`s — no inset, no corner join. On a 64 px-wide limb face, `width: 8` is 12.5 % of
  the face.

## 2.10 `renderPng` — the bytes

```js
// render-CpljO1Hx.js:350-354
async function _(e) {
  let t = await g(e, document.createElement(`canvas`));
  let n = await new Promise(e => t.toBlob(e, `image/png`));
  return new Uint8Array(await n.arrayBuffer());
}
```

**The clothing PNG is encoded by the browser's `canvas.toBlob("image/png")`.** The hand-rolled
`png-D9MD6Y0w.js` writer (zlib-store + adler32 + crc32) is **not** in the clothing path — it is used
only by `palette-CdyFZUx0.js:65-67` for the 3D texture-palette atlas. No import in
`render-CpljO1Hx.js`, `design-PKArvEjc.js`, `avatarRender-DVeE1evW.js`, or `avatar-CSK-yHJ2.js`
references it.

## 2.11 Alpha — the complete truth table

| Situation | Resulting alpha | Site |
|---|---|---|
| no `background`, no layer covers the pixel | 0 (transparent PNG) | `render:239` `clearRect` |
| `background` set | 255 everywhere | `render:257-260` |
| pattern layer, `opacity >= 1` | forced 255 | `render:140-145` |
| pattern layer, `opacity < 1` | `max(oldAlpha, round(opacity*255))` — a **max**, not source-over accumulation | `render:149` |
| vector layer (`text`/`image`/`shape`/`trim`) | drawn with `source-over`; text/shape/trim write opaque pixels where they land, images keep their own alpha | `render:261-345` |
| `hidden: true` | contributes nothing | `render:211`, `render:262` |

**The mismatch to know:** `opacity` is honoured by the pattern pass (`render:135`) but is **ignored
entirely** by `text`/`image`/`shape`/`trim` — those branches never read `t.opacity`. The UI exposes
an `Opacity` slider for *every* kind (`ClothingPanel:775-776`), so setting opacity on a shape does
nothing.

## 2.12 No dithering, no noise, no shading beyond the patterns

Worth stating explicitly because it is a common assumption:

- There is **no** global dither, grain, or film-noise pass. The only dither in the entire engine is
  the plaid's 25 % checkerboard blend (`render:71-73`).
- There is **no** shading, normal, roughness, or lighting in the clothing render. It is an unlit
  albedo map. Lighting exists only in the three.js avatar preview (2.13).
- There is **no** anti-aliasing control. Patterns are hard-thresholded per pixel; only the vector
  layers get Canvas2D's built-in AA.
- There is **no** seam-blending. Seams are whatever the per-region pattern restart produces.

## 2.13 The avatar sheet — the review image (this is the quality lever)

```js
// avatarRender-DVeE1evW.js:63-96
function h(e, t, {
  rig: n = `R15`,
  skin: r
} = {}, i = 256) {
  let a = c({ rig: n, skin: r, clothes: e });
  let o = d(a, 1447963);                        // scene background 0x16181B
  let s = document.createElement(`canvas`);
  s.width = i * 4;                              // 1024
  s.height = Math.round(i * 1.4);               // 358
  let l = s.getContext(`2d`);
  l.fillStyle = `#101113`;
  l.fillRect(0, 0, s.width, s.height);
  [[`front`, f.front], [`back`, f.back], [`left side`, f.left]].forEach(([e, t], n) => {
    let r = p(o, t, i, s.height);               // 256 x 358 three.js render
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

Numbers:

- Output canvas **1024 x 358** (4 x 256 wide, `round(256 x 1.4)` high), filled `#101113`.
- Panels 0-2: three.js renders of the avatar wearing the design, each **256 x 358** (non-square
  aspect => the camera `aspect` is `256/358`, so the avatar is framed taller, not distorted).
- Panel 3: the **flat template** (the 585x559 or 512x512 canvas) letterboxed by
  `min(256/tw, 358/th)` and centred.
- Labels: `14px sans-serif`, `rgba(255,255,255,0.85)`, at `(n*256 + 8, 18)`.
- Scene background `1447963` = `0x16181B`.
- Returns a **`data:image/jpeg` base64 URL at quality 0.85** — *not* PNG bytes. This is fed straight
  into the chat message as the vision input (`gen3d:934-938`).

Camera views (`avatarRender:33-39`):

```js
var f = {
  front: [0, 0.12, 1],
  back: [0, 0.12, -1],
  left: [1, 0.12, 0.15],
  right: [-1, 0.12, 0.15],
  "3/4": [0.75, 0.25, 1]
};
```

Camera setup (`avatarRender:40-48`): `PerspectiveCamera(30, w/h, 0.1, 100)`, target `(0, 2.75, 0)`,
positioned at `target + normalize(dir) * 12.5`, `lookAt(target)`. Renderer is
`antialias: true, alpha: true, preserveDrawingBuffer: true` with `setPixelRatio(1)` forced
(`avatarRender:5-17`), so output is exactly the requested device pixels.

Lighting (`avatarRender:18-32`): `HemisphereLight(0xffffff, 0x2a2a2a, 1.8)` +
`DirectionalLight(0xffffff, 1.9)` at `(3,8,7)` + `DirectionalLight(0xffffff, 0.9)` at `(-3,5,-7)`.

## 2.14 `renderClothingThumbnail` — the 256x256 saved as `thumb.png`

```js
// avatarRender-DVeE1evW.js:49-62
async function m(e, {
  rig: t = `R15`,
  skin: n
} = {}, r = 256) {
  let i = c({ rig: t, skin: n, clothes: e });
  let a = p(d(i, null), f[`3/4`], r, r);
  let o = await new Promise(e => a.toBlob(e, `image/png`));
  i.dispose();
  return new Uint8Array(await o.arrayBuffer());
}
```

- **256 x 256**, MIME `image/png`, one camera view `f["3/4"] = [0.75, 0.25, 1]`.
- Background `null` => the scene has no background and the renderer has `alpha: true`, so the PNG has
  a **transparent** backdrop.
- The bytes go to `collection.saveItem(item, thumb)` => written as `thumb.png` in the item dir.

## 2.15 How the design lands on the rig (why the atlas geometry matters)

The rig is a blocky R15 (default) or R6 built from five box parts (`avatar-CSK-yHJ2.js:42-72`):

| name | wears | split | size `[x,y,z]` studs | centre |
|---|---|---|---|---|
| `Torso` | `torso` | `torso` | `[2, 2, 1]` | `[0, 3, 0]` |
| `LeftArm` | `left_arm` | `arm` | `[1, 2, 1]` | `[1.5, 3, 0]` |
| `RightArm` | `right_arm` | `arm` | `[1, 2, 1]` | `[-1.5, 3, 0]` |
| `LeftLeg` | `left_leg` | `leg` | `[1, 2, 1]` | `[0.5, 1, 0]` |
| `RightLeg` | `right_leg` | `leg` | `[1, 2, 1]` | `[-0.5, 1, 0]` |

Note the aspect ratios: **torso front is 2 studs wide x 2 tall** (a 128x128 region — square, and the
region is square, so 1 atlas px is about 1/64 stud in both axes); **a limb face is 1 wide x 2 tall**
(a 64x128 region — also exactly proportional). The atlas is a faithful unwrap, which is why a
pattern drawn at `size: 6, gap: 26` on the torso reads at the same physical scale on an arm.

R15 splits each limb into segments by fraction (`avatar-CSK-yHJ2.js:36-40`):

```js
var T = {
  torso: [[`UpperTorso`, 0.8], [`LowerTorso`, 0.2]],
  arm:   [[`UpperArm`, 0.45], [`LowerArm`, 0.4], [`Hand`, 0.15]],
  leg:   [[`UpperLeg`, 0.43], [`LowerLeg`, 0.42], [`Foot`, 0.15]]
};
```

`segmentRect` (`avatar-CSK-yHJ2.js:81-105`) slices the 128-tall region by those fractions; `up`/`down`
faces use a 1-pixel strip of the *front* face for the non-extreme slices — a cheap cap trick.

Compositing order (`avatar-CSK-yHJ2.js:287-301`, `:141-156`): each part canvas is filled with the
**skin hex** first, then **pants**, then **shirt**, each stretched to 585x559. **Alpha in the
clothing canvas lets the skin through** — which is precisely why `checkDesign` warns about empty
regions (2.16). A transparent sleeve is literally visible skin.

T-shirt is a **separate transparent plane**, not part of the atlas (`avatar-CSK-yHJ2.js:236-245`): a
`PlaneGeometry(1.7, 1.7)` with the 512x512 canvas as a `transparent: true` map, at `(0, 3.08, 0.506)`,
parented to `UpperTorso`, `visible` toggled by the presence of `clothes.tshirt`.

Skin tones (`avatar-CSK-yHJ2.js:13-34`), default `SKIN_TONES[0].hex = "#eab892"`:

```
Light orange #eab892 | Pastel brown #ffcc99 | Nougat #cc8e69 | Brown #7c5c46
Reddish brown #694028 | Bright yellow #f5cd30 | Medium stone grey #a3a2a5
```

## 2.16 `checkDesign` — the post-render QA pass, verbatim

```js
// design-PKArvEjc.js:90-131
function f(n, r) {
  let { width: i, height: a } = e(n.type);
  let o = [];
  let s = [];
  if (n.type !== `tshirt`) {
    for (let e of t(n.type)) {
      let t = 0;
      for (let n = e.y; n < e.y + e.h; n += 4) {
        for (let a = e.x; a < e.x + e.w; a += 4) {
          if (r[(n * i + a) * 4 + 3] > 16) {
            t++;
          }
        }
      }
      let n = Math.ceil(e.h / 4) * Math.ceil(e.w / 4);
      if (t / n < 0.05) {
        s.push(e.id);
      }
    }
    if (s.length) {
      o.push({
        level: `warn`,
        message: `${s.length} region${s.length > 1 ? `s are` : ` is`} left empty, so the skin shows there: ${s.slice(0, 8).join(`, `)}${s.length > 8 ? `…` : ``}.`
      });
    }
  }
  if ((n.layers ?? []).filter(e => e.kind === `text` && Number(e.size ?? 32) < 10).length) {
    o.push({ level: `warn`, message: `Some text is under 10 px and will be hard to read in game.` });
  }
  return { ok: !o.some(e => e.level === `error`), issues: o, size: [i, a], empty: s };
}
```

Exact semantics:

- **Sampling lattice:** 4 px in both axes (`n += 4`, `a += 4`), starting at the region's top-left.
  A 128x128 face gets `32 x 32 = 1024` samples; a 64x128 face gets `16 x 32 = 512`.
- **Alpha test:** `alpha > 16` (about 6.3 %) counts as painted.
- **Empty threshold:** painted / total `< 0.05` (5 %). For a 128x128 face that is **< 51.2 samples**;
  for a 64x128 face **< 25.6 samples**.
- **`empty`** is a list of region **ids** (`torso_down`, `right_arm_front`, ...), used by the prompt's
  layout string and by the UI's "Regions painted" counter (`ClothingPanel:511`).
- **Small text:** any `text` layer with `size < 10` => one warning (not per layer).
- **t-shirt is exempt** from the region scan entirely (`n.type !== "tshirt"` guard) — it has one
  512x512 region and a graphic is expected to have transparent margins.

**The critical fact for a port:** *both* checks emit `level: "warn"`, and
`ok: !o.some(e => e.level === "error")`. There is **no code path that produces `level: "error"`** —
verified by grepping every `level:` literal in `design-PKArvEjc.js`: two sites, both `warn`. So
`report.ok` is **always `true`**.

Consequences in the loop:

- `gen3d:958` (`D.report.ok ? accept?.(...) ?? null : "The checks still find errors..."`) always
  takes the `accept` branch; `accept` is `undefined` for clothing => `null` => **DONE is always
  accepted on the first ask**.
- The `for (let t = 0; !g && t < 2 && ...)` DONE-re-ask loop (`gen3d:957`) can never fire for
  clothing.
- The "The checks still find errors" message (`gen3d:962-963`) is **dead code** on the clothing path.

This is why the *review round* is the only real quality gate for clothing, and why the review
message's content (3.4, 3.5) matters so much: nothing else can reject a design.

## 2.17 Determinism

**Where the seed comes from: nowhere.** There is no seed in the design object, no seed in
`validateDesign`, no seed in `checkDesign`, no seed passed from the panel, and no RNG anywhere in the
clothing path except the per-layer `seed` field:

```js
// render-CpljO1Hx.js:45
let p = Number(t.seed ?? 7);
```

`seed` is:

- **not validated** (absent from every field list in `design:44-52`);
- **not exposed in the UI** (`ClothingPanel:698-777` has sliders for size/gap/angle/width/x/y/w/
  opacity only);
- **not mentioned in the prompt builder** (`clothing:62-83` prints only kind/target/text/shape/
  colours/position);
- **not in `newDesign`**;
- default **`7`** for every pattern layer that omits it.

So `camo` and `noise` are deterministic, and *identical* between any two layers that omit `seed`.
Grep evidence: a search for `seed` across `render-CpljO1Hx.js`, `design-PKArvEjc.js`,
`ClothingPanel-CEM_quBl.js` returns exactly **one** hit: `render-CpljO1Hx.js:45`.

Not deterministic:

| Source | Why |
|---|---|
| Model output | LLM sampling |
| Item id | `m-${Date.now().toString(36)}-${Math.random()...}` |
| Task id | `task-${Date.now().toString(36)}-${Math.random()...}` |
| `createdAt` / `updatedAt` | `Date.now()` |
| Layer ids from the UI | `` `l${Date.now()}` `` |
| PNG bytes | browser `toBlob("image/png")` — encoder version, filter choice, zlib settings are UA-defined |
| Thumbnail PNG | same, plus three.js/WebGL rasterisation, driver, GPU |
| Sheet JPEG | `toDataURL("image/jpeg", 0.85)` — lossy + UA encoder |
| Text rendering | system font resolution; `"IBM Plex Sans Variable"` is a webfont that falls back to `system-ui` |

**The right determinism target is the pixel buffer, not the PNG.** Recipe:

1. Fix the design JSON exactly (`type`, `background`, ordered `layers[]`, every field including
   `seed: 7` for camo/noise if absent).
2. Implement `palette.parse`, `mulberry32`, `valueNoise`, and the 9 pattern closures **verbatim**. All
   are integer / `Math.imul` / `Math.round` / `Math.floor` operations with no transcendentals except
   `Math.cos`/`Math.sin` of `angle*PI/180` — the only float-sensitive spots.
3. Reproduce the batching rule exactly — pattern runs go to a **fresh transparent buffer**, then
   source-over.
4. `Uint8ClampedArray` semantics matter: assignments clamp to 0..255 and round-half-to-even for `.5`
   (`ToUint8Clamp`).
5. For a *canonical* buffer, restrict to pattern layers and call `renderPixels` directly — it never
   touches the 2D context, so it is bit-reproducible across browsers. `renderToCanvas` additionally
   rasterises text/images/shapes through the browser's 2D engine and will **not** be bit-identical
   across browsers/OSes.
---

# 3. The system prompt / user prompt for clothing generation

There are **four** distinct pieces of prompt text on the clothing path, and only one of them is
recoverable-in-principle-but-actually-gone:

| Piece | Where | Recovered? | Size |
|---|---|---|---|
| **System prompt** (`prompts/clothing.md`) | `clothing:17-19` | **NO — server asset, auth-gated** | unknown |
| **First user message** | `clothing:47-61` | **yes, verbatim** | 42-177 chars + the prompt |
| **Review message** (lead + facts + layout + ask) | `clothing:130-135` + `gen3d:929-933` | **yes, verbatim** | about 363-400 chars + image |
| **Fix message** (validator rejection) | `gen3d:910-914` | **yes, verbatim** | about 80 chars + problems |

There is **no** design-brief step, **no** separate critic turn, and **no** rubric/scoring on the
clothing path (contrast polyforge, 3.7). The critique *is* the review round.

## 3.1 The system prompt — what is known and what is not

```js
// clothing-62l72JIa.js:17-19
function v() {
  return n(`prompts/clothing`, `prompts/clothing.md`);
}
```

`n` is `assetText` from `serverAssets-p9XPPBjy.js:114-131`. The bundle is declared at
`serverAssets-p9XPPBjy.js:40`:

```js
"prompts/clothing": [`prompts/clothing.md`],
```

and fetched over HTTP from
`${API_BASE}/api/assets/prompts/clothing/prompts/clothing.md` (`serverAssets:58-74`), with
`Accept: text/plain, text/markdown, application/json` and an optional `Authorization: Bearer`.

Loaded before the loop starts:

```js
// clothing-62l72JIa.js:101-105
await p({
  feature: `gen_clothing`,
  bundles: [`prompts/clothing`],
  brain: i
});
```

(`p` = `prepareGeneration`, `gen3d:584-595`: entitlement check, agent-brain entitlement, then
`loadBundles`.)

**Status: unrecoverable.** `GET https://robloxkit.dev/api/assets/prompts/clothing.md` returns **401**.
The body is absent from the WebView2 cache (0 hits across `data_0..3`, `f_000001`, `index`), absent
from the EXE (the SPA is brotli-embedded; after extraction its long literals are GLSL only), and
there is no runtime injection point (`primeAssets` and `setAssetFetcher` are exported but **never
called** by any bundle). Confirmed in `01-generator-loop/REPORT.md` 15.1.

**What it must contain** — this is a deduction, not a quote, but it is a tight one:

- **No placeholders.** `prompts/clothing` is one of only two bundles (`clothing`, `music`) used
  **raw** (`01-generator-loop/REPORT.md` 15.3). No `{{guide}}`, no `{{templates}}`.
- **The entire schema.** Nothing else in the client tells the model the vocabulary:
  - `ClothingPanel` never sends a schema to the model (it is a UI, not a prompt builder);
  - the first user message (`clothing:53-57`) mentions only `type` and `image`;
  - the review `layout` prints `kind`, `target`, `color*`, `x`, `y` but only *after* a design exists.
  So `prompts/clothing.md` **must** carry: the 3 types, the 13 `kind` values, the 18 region ids and
  the 5 part names and 6 face names, every colour field (`color`, `color2`, `color3`, `from`, `to`,
  `outline`), `size`/`gap`/`angle`/`width`/`w`/`h`/`x`/`y`/`opacity`, `text`/`font`/`weight`,
  `shape`/`edge`, `image`/`fit`/`scale`, the 40-layer cap, the 60-char text cap, and the `#rrggbb`
  rule.
- **The output contract:** one fenced `json` block, nothing else.
- **The rejection contract:** the engine will reject an invalid design and ask for the whole
  corrected design.
- **Whatever quality guidance produced the good output.** This is the part that cannot be
  reconstructed by deduction and the part that most affects quality. See 3.7 for what the evidence
  implies it says.

## 3.2 The first user message — verbatim

```js
// clothing-62l72JIa.js:47-61
function b({ prompt: e, type: t, base: n, pictures: r }) {
  let i = [n ? `Change this design as asked, keeping everything else. Return the whole updated design.\n\nCurrent design:\n\`\`\`json\n${JSON.stringify(n)}\n\`\`\`\n\nChange: ${e}` : `Design a ${_[t] ?? t}: ${e}`];
  if (r) {
    i.push(`The user attached ${r} picture(s)${r ? ` (the first is shown with this message)` : ``}. Put them on the clothing with image layers ("image": 0${r > 1 ? `, 1, …` : ``}).`);
  }
  i.push(`Type: ${t}.`);
  return i.join(`\n\n`);
}
```

with the type-label table:

```js
// clothing-62l72JIa.js:12-16
var _ = {
  shirt: `Shirt`,
  pants: `Pants`,
  tshirt: `T-Shirt`
};
```

### Rendered form A — fresh design, no pictures (2 blocks, blank-line separated)

```
Design a Shirt: <prompt>

Type: shirt.
```

42 characters of boilerplate plus the prompt.

### Rendered form B — fresh design, 1 picture (3 blocks)

```
Design a Shirt: <prompt>

The user attached 1 picture(s) (the first is shown with this message). Put them on the clothing with image layers ("image": 0).

Type: shirt.
```

Note the literal `1 picture(s)` — the `(s)` is unconditional.

### Rendered form C — fresh design, 3 pictures

```
Design a Shirt: <prompt>

The user attached 3 picture(s) (the first is shown with this message). Put them on the clothing with image layers ("image": 0, 1, …).

Type: shirt.
```

The `, 1, …` uses a real U+2026 horizontal ellipsis. 177 characters of boilerplate for 3 pictures.

### Rendered form D — edit path (base design present)

````text
Change this design as asked, keeping everything else. Return the whole updated design.

Current design:
```json
{"type":"shirt","background":null,"layers":[...]}
```

Change: <prompt>

Type: shirt.
````

Exact-reproduction notes:

- `JSON.stringify(n)` is **minified** — no indentation, no spaces.
- The `base` passed here is `h.design` — the output of `y(base, images)` (`clothing:99`), i.e. the
  *previous* version's design with every `image` layer's `src` replaced by an integer `image` index.
  **So the model never sees base64.**
- The picture sentence is emitted whenever `pictures > 0`; the `(the first is shown with this
  message)` clause is always included (the inner ternary `r ? ... : ''` is always truthy at that
  point — dead code).
- `Type: <type>.` is always the last line, using the **raw** type id (`shirt`), not the label
  (`Shirt`).
- The first attached picture is also sent as a real image attachment (`clothing:121`, `image: g[0]`),
  which `gen3d:837-843` turns into a `{role:"user", text, image}` history entry.

**Token cost.** The boilerplate is 42-177 characters (about 10-45 tokens). A minified 2-layer design
is about 200 characters (about 50 tokens). So the first turn is **dominated by the system prompt**,
whatever it is. There is no few-shot example in the user message — the only worked examples the model
ever sees are (a) whatever `prompts/clothing.md` contains and (b) its own previous design on the edit
path.

## 3.3 What the model is told about *quality* in the first turn: nothing

This is worth stating flatly. The first user message says:

- the artifact type (`Shirt`),
- the user's prompt,
- the picture count (if any),
- the raw type id.

It says **nothing** about layer count, palette discipline, pattern scale, readability, seams, or what
"good" means. Every quality instruction in the entire clothing pipeline therefore lives in
`prompts/clothing.md` (gone) and in the **review message** (recovered, 3.4-3.5).

That is the structural reason a naive clone is flat: if your port has a weak system prompt *and* a
weak review message, nothing in the system ever expresses a quality bar.

## 3.4 The review message — verbatim assembly

The loop assembles it at `gen3d:924-938`:

```js
let {
  lead: n,
  facts: s,
  layout: c = ``
} = f(D, t);
let m = l ? `\n${l({
  prompt: r,
  what: i,
  round: e
})}` : `\nDoes it match the request "${r}"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected ${i}.`;
S.push({
  role: `user`,
  text: `${n} ${s}${c}${m}`,
  image: t ? D.sheet : undefined
});
```

Three separator rules that must be copied exactly:

1. **`lead` and `facts` are joined by a single space** (`` `${n} ${s}` ``).
2. **`layout` is appended with NO separator** (`` `${c}` ``) — so **the layout builder must supply
   its own leading `\n`**. RobloxKit's does (`clothing:80`).
3. **`question` is appended last, prefixed by `\n`** — and `question` is `undefined` for clothing, so
   the default closer is always used.
4. The image is attached **separately** (`image: t ? D.sheet : undefined`), so `lead` is prose *about*
   an image, not a substitute for it.

The clothing `review` callback (`clothing:130-135`):

```js
review: (e, t) => ({
  lead: t ? `Here is the design on the avatar (front, back, left side) and the flat template.` : `The renderer drew it (no picture: judge it from the description below).`,
  facts: e.report.issues.length ? `\nChecks:\n- ${e.report.issues.map(e => `${e.level}: ${e.message}`).join(`
- `)}` : `It passes the checks.`,
  layout: x(e.design, e.report)
}),
```

`t` is the sheet — present only when `vision` is on **and** the brain accepts images
(`gen3d:923`, `we(p)` at `:1023-1038`).

### The default closer (`gen3d:933`)

```
Does it match the request "<prompt>"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected design.
```

151 characters. This is the *entire* explicit instruction to critique. Note what it does **not** say:
it does not say what to look at, whose eyes to use, or what "match" means. That job is done by
`lead` — which is why `lead` is the single most important string in the pipeline.

### Rendered review message — pass case

```
Here is the design on the avatar (front, back, left side) and the flat template. It passes the checks.
Layers (bottom to top):
0. solid on all #1a3a8f
1. polka on all #ffffff/#1a3a8f
Every region is painted.
Does it match the request "a royal robe"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected design.
```

363 characters plus a 1024x358 JPEG.

### Rendered review message — with warnings

```
Here is the design on the avatar (front, back, left side) and the flat template.
Checks:
- warn: 2 regions are left empty, so the skin shows there: right_arm_front, left_arm_front.
Layers (bottom to top):
0. solid on all #1a3a8f
1. polka on all #ffffff/#1a3a8f
Empty regions (skin shows): right_arm_front, left_arm_front
Does it match the request "a royal robe"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected design.
```

Note that the empty-region information appears **twice** — once in `facts` (from
`report.issues`) and once in `layout` (from `report.empty`). That is redundancy by construction, and
it is deliberate-looking.

### The no-image fallback

If the brain rejects the image mid-flight, the loop rewrites the last message text-only and retries
the same round (`gen3d:942-954`):

```js
k = false;
O.push(`reviewed without pictures (the brain refused the image)`);
let n = f(D, false);
S[S.length - 1] = {
  role: `user`,
  text: `${n.lead} ${n.facts}${n.layout ?? ``}${m}`
};
h = await w(`checking`);
```

with the text-only `lead`:

```
The renderer drew it (no picture: judge it from the description below).
```

`k = false` is **sticky**: once refused, all later rounds in that run are text-only. This is why
`review` takes a second boolean argument.

## 3.5 The layout string — the per-layer inventory, verbatim

```js
// clothing-62l72JIa.js:62-83
function x(e, t) {
  let n = e => {
    let t = [e.kind, `on ${e.target ?? `all`}`];
    if (e.text) {
      t.push(`"${e.text}"`);
    }
    if (e.shape) {
      t.push(e.shape);
    }
    let n = [`color`, `color2`, `color3`, `from`, `to`].map(t => e[t]).filter(Boolean);
    if (n.length) {
      t.push(n.join(`/`));
    }
    if (e.x != null || e.y != null) {
      t.push(`at ${e.x ?? 0.5},${e.y ?? 0.5}`);
    }
    return t.join(` `);
  };
  return `\nLayers (bottom to top):\n${(e.layers ?? []).map((e, t) => `${t}. ${n(e)}`).join(`
`)}${t.empty?.length ? `\nEmpty regions (skin shows): ${t.empty.join(`, `)}` : `
Every region is painted.`}`;
}
```

Format per layer:

```
<index>. <kind> on <target>[ "<text>"][ <shape>][ <c1>/<c2>/<c3>/<from>/<to>][ at <x>,<y>]
```

with colours in the fixed order `color, color2, color3, from, to`, falsy ones dropped, joined by `/`.

Full example for `newDesign("shirt")`:

```

Layers (bottom to top):
0. solid on all #e11d48
1. stripes on torso #ffffff/#e11d48
Every region is painted.
```

(No `at` because `newDesign` layers carry no `x`/`y`.)

Full example for a design with gaps:

```

Layers (bottom to top):
0. solid on all #1a3a8f
1. trim on torso #d4af37
2. shape on torso_front star #d4af37 at 0.5,0.3
3. text on torso_front "ROYAL" #d4af37 at 0.5,0.2
Empty regions (skin shows): right_arm_up, left_arm_up, right_arm_down, left_arm_down
```

Why this matters more than it looks:

- It is an **addressable inventory of the model's own design**. The model can see that it has 4 layers
  and what each one is, without re-reading its own JSON — which it may have lost track of across a
  long turn.
- It **names the gaps by region id**. `right_arm_front` is actionable; "coverage 45 %" is not.
- It is **ordered bottom to top**, which is the same order the renderer composites in — so the model
  can reason about occlusion (a `trim` at index 1 is *under* a `shape` at index 2).
- It costs about 30-60 tokens. It is the cheapest quality lever in the entire system.

## 3.6 The fix message — verbatim (loop-owned, not clothing-specific)

```js
// gen3d-BAdfthxw.js:910-914
S.push({
  role: `user`,
  text: `The engine rejected the ${i}:\n- ${t.slice(0, 20).join(`
- `)}\nReturn the whole corrected ${i}.`
});
```

Rendered:

```
The engine rejected the design:
- <problem 1>
- <problem 2>
...
Return the whole corrected design.
```

- `what` = `design` for clothing (`clothing:124`).
- Capped at **20** problems (`t.slice(0, 20)`).
- Emitted at most **3** times (`_e = 3`, `gen3d:528`, checked at `:906`), i.e. 4 build attempts total.
- On the 4th failure the loop throws
  `The AI's design could not be built: <first 5 problems joined by "; ">` (`gen3d:907`).

The problems themselves are the validator's strings, verbatim (see 3.8). They are the most
information-dense text in the pipeline: each one names a JSON path and the rule.

## 3.7 Is there a design-brief step? A critic step? Multiple turns?

**Turns, counted exactly.** A clean clothing run — one design turn, one review turn — is **2 LLM
turns**:

| # | Stage id | UI label | What is sent | What comes back |
|---|---|---|---|---|
| 1 | `designing` | Designing | system + first user message | a fenced `json` design |
| 2 | `checking` | Checking | lead + facts + layout + ask + **the sheet JPEG** | `DONE` |

Every additional turn is one of three kinds:

| Kind | Stage id | Trigger | What is sent |
|---|---|---|---|
| build fix | `fixing` | `build()` threw, or the reply had no JSON (max 3 per authoring phase) | `The engine rejected the design:\n- <up to 20>\nReturn the whole corrected design.` |
| revision | `checking` -> `fixing` | the review reply contained a design instead of `DONE` (max 2 rounds) | the design is rebuilt; then the whole review message is sent again |
| rebuild fix | `fixing` | a revision failed to build (max 2 per round) | the same rejection message |

So the shape is: **2 turns minimum, 11 turns maximum** (1 designing + 3 fixing + 2 x (1 checking + 3
fixing)).

So:

- **No design-brief step.** There is no "first, describe what you will make" turn. The model goes
  straight to JSON. (Contrast: nothing in `clothing-62l72JIa.js` or `gen3d` has a brief/plan stage;
  the four stage ids are `designing | building | checking | fixing` and `building` is a *render*, not
  an LLM turn.)
- **No separate critic model.** The same brain that authored the design reviews it.
- **No rubric and no scoring gate** for clothing. `accept` is `undefined` (`clothing:106-144` passes
  no `accept`), so the DONE gate is purely `report.ok` — which is always `true`.
- **The critic step *is* the review round**, and its whole content is: the sheet image, one sentence
  of framing, the check list, the layer inventory, and "does it match?".

**The stages as the user sees them** (`clothing:272-277`):

```js
var I = {
  designing: `Designing`,
  building: `Drawing`,
  checking: `Checking`,
  fixing: `Fixing`
};
```

`building` is renamed **`Drawing`** — the only label that differs from the generic loop. That rename is
a small but real signal: RobloxKit treats "the engine drew your design" as a visible step, because
the drawing is the thing being judged.

**What the review `lead` actually says, and why it is the whole quality bar.** Verbatim:

```
Here is the design on the avatar (front, back, left side) and the flat template.
```

That is 80 characters and it does four jobs:

1. **Says there is an avatar** — so the model knows it is judging a garment *worn*, not a texture.
2. **Names the three views** — front, back, left side — so the model knows which panel is which and
   can check both sides.
3. **Says there is a flat template** — so the model knows panel 4 is the atlas and can cross-reference
   a seam it sees on the avatar against the unwrap.
4. **Implies the judgement frame** by putting the avatar first.

Compare the texture engine's `lead` (`genTexture:85`), which is far more explicit:

```
Here is the texture: top left the colour map repeated 2×2 (any seam or obvious repeat shows there), then the lit view and the normal map; below them roughness and metalness. Judge it as a player sees it on a wall or a prop: real material breakup, not a flat colour, not noise.
```

RobloxKit's clothing `lead` is **much terser** than its texture `lead` and has **no explicit
"judge it as…" clause at all**. That is a real, observed asymmetry:

| Engine | Explicit judgement clause? |
|---|---|
| texture | `Judge it as a player sees it on a wall or a prop: real material breakup, not a flat colour, not noise.` |
| icons | `Judge them small, as a player sees them: does each symbol read instantly, do they look like one set?` |
| skybox | `Judge it as a player standing in the game: mood, colours, the sun's place, clouds.` |
| gfx | `Judge it as a player scrolling past it would: does it read at a glance, is the subject clear, is the text legible and inside the safe area?` |
| animation | `Judge the motion: does each pose read, are the anticipation, the strike and the settle there, do the feet stay planted where they should?` |
| sfx | `You cannot hear it: judge its shape, length, pitch content and envelope against the request.` |
| 3D | *(none — framing is implicit)* |
| polyforge | `Look at it as the thing it should be, as a player would see it in the game.` |
| **clothing** | **none** |

So for clothing, the quality bar is carried by **the image itself plus the layer inventory**. The
model is shown the garment on a body and handed a list of what it built. That is enough — but it is
*only* enough because the image is an avatar view. If you show the model a UV unwrap and say nothing,
you get nothing.

`porting/03-generators/README.md:83-84` asserts "**Every engine's `lead` frames it as 'as a player
sees it'**". That is **false for clothing** — verified against `clothing:131`. The porting doc's own
worked example (`:288-290`) invents a stronger lead than RobloxKit's:

```ts
lead: hasImage
  ? 'Here is the clothing sheet: the garment flat, then worn on an R15 rig. Judge it as a player sees it on their avatar: does the pattern read at a distance, are the seams right, does it look like one garment?'
  : 'It was rendered (no picture: judge from the description below).',
```

That invented lead is **better than the original** and is a legitimate improvement to make — but it is
not what RobloxKit ships. Do not cite it as recovered.

## 3.8 The validator's exact messages (the text the model reads when it fails)

These arrive inside the fix message (3.6). Verbatim templates, from `design-PKArvEjc.js`:

| Site | Message |
|---|---|
| `design:15` | `the design is not an object` |
| `design:18` | `type: must be one of shirt, pants, tshirt` |
| `design:21` | `background: must be #rrggbb or null` |
| `design:24` | `layers: needs at least one layer` |
| `design:27` | `layers: at most 40` |
| `design:30` | `layers[N].color: "#xyz" is not a #rrggbb colour` |
| `design:31` | `layers[N].x: must be a number from 0 to 1` |
| `design:32` | `layers[N].size: must be a number from 1 to 400` |
| `design:36` | `layers[N]: is not an object` |
| `design:39` | `layers[N].kind: "foo" is not one of solid, gradient, stripes, checks, plaid, polka, zigzag, camo, noise, text, image, shape, trim` |
| `design:42` | `layers[N].target: "xyz" names no region of a shirt; use all, a part (torso, right_arm, left_arm), a side (front, back, left, right, up, down) or a region id` (part list is `torso, right_leg, left_leg` for pants; `torso` for tshirt) |
| `design:55` | `layers[N].text: 1 to 60 characters` |
| `design:58` | `layers[N].font: one of sans, serif, mono, display` |
| `design:62` | `layers[N].shape: one of rect, circle, star, heart, diamond, triangle` |
| `design:65` | `layers[N].edge: one of top, bottom, left, right, sides, all` |
| `design:69` | `layers[N]: an image layer needs "image": the number of an attached picture (0..K)` — the `0..K` suffix appears only when `images > 1`; with 0 or 1 picture it renders as just `(0)` |
| `design:71` | `layers[N].image: must be 0..K` (when pictures exist) / `layers[N].image: no pictures are attached; remove this layer` (when none) |

Note `design:42` is the **only** place in the client that spells out the target vocabulary to the
model. A model that has never seen `prompts/clothing.md` learns `all` / `torso` / `right_arm` /
`front` / region-id from an *error message*. That is a strong hint that `prompts/clothing.md` also
spells it out — but it is a hint, not proof.

**Validation order** (a port must match this, because only the first 20 problems are echoed):

1. `design` not an object => **immediate return** of `["the design is not an object"]` (short-circuits
   everything).
2. `type` membership.
3. `background` format.
4. `layers` non-empty array.
5. `layers.length <= 40`.
6. Per layer, index order `0..n-1`, in this fixed sequence:
   1. layer is an object => else `return` (skips the rest of *this* layer only);
   2. `kind` in `LAYER_KINDS` => else `return` (skips the rest of this layer);
   3. `target` resolves to >= 1 region;
   4. colours: `color, color2, color3, from, to, outline` (this order);
   5. unit numbers: `x, y, w, h, opacity` (this order);
   6. `size` 1..400; `gap` 0..400; `angle` -360..360 (this order);
   7. if `kind === "text"`: `text` length, then `font`;
   8. if `kind === "shape"`: `shape`;
   9. if `kind === "trim"`: `edge`;
   10. if `kind === "image"`: `image` index.

Errors **accumulate**; all problems are returned.

**What throws vs what clamps.** Only one thing throws: the build closure, and only when
`validateDesign` returned a non-empty array:

```js
// clothing-62l72JIa.js:219-228
return async (i, a = []) => {
  let o = r.validateDesign(i, { images: a.length });
  if (o.length) {
    throw Object.assign(Error(o.join(`\n`)), { problems: o });
  }
  ...
```

`validateDesign` itself never throws — it is a pure collector. And **nothing is clamped by the
validator**: every check is reject-only. The renderer clamps independently and silently:

| Value | Renderer behaviour | Site |
|---|---|---|
| `size` | `Math.max(2, Number(size ?? 16))` — floor 2, no ceiling | `render:40` |
| `gap` | `Math.max(1, Number(gap ?? c))` — floor 1, no ceiling | `render:41` |
| `angle` | `Number(angle ?? 0) % 360` — wraps | `render:42` |
| `opacity` | `Math.min(1, Math.max(0, ...))` | `render:135` |
| text `size` | `Math.max(6, Number(size ?? 32))` | `render:275` |
| trim `width` | `Math.max(1, Number(width ?? 6))` | `render:325` |
| `x`, `y` | `Number(v ?? 0.5)` — **no clamp**; `x: 3` places the item off-canvas | `render:273` |
| pattern `seed` | `Number(seed ?? 7)` — no clamp | `render:45` |
| `w` (shape) | `r.w * Number(w ?? 0.4)` — no clamp | `render:313` |

Two values are effectively **unvalidatable but used**: `seed` (validated as nothing at all, yet it
changes every camo/noise pixel) and `outlineWidth`.
---

# 4. Is there a review / repair loop (render → look → fix)?

**Yes, and it is the core of the engine.** The whole of `designLoop` (`Se`, `gen3d:814-1014`) is
reproduced verbatim below, then annotated.

## 4.1 The loop, verbatim

```js
// gen3d-BAdfthxw.js:814-1014  (abridged only where marked "…")
async function Se({
  action: e, system: t, first: n, prompt: r, what: i = `design`,
  normalize: a = e => e, extract: o = q, missing: s, question: l, accept: u,
  build: d, review: f, brain: p, provider: m, token: h, signal: g, scope: _,
  onStage: v, rounds: y = 2, vision: b = true, choice: x = null
}) {
  let S = [{
    role: `user`,
    text: n.text,
    ...(n.image ? { image: n.image } : {})
  }];
  let C = false;
  let w = async n => {                                   // one LLM turn, transport retry
    v?.({ stage: n, detail: `${c(p)} is ${n}` });
    for (let r = 0;; r++) {
      try {
        let r = await J({
          brain: p, provider: m, token: h, history: S, signal: g, scope: _,
          system: t, choice: x,
          action: C ? undefined : e,                     // action header: FIRST TURN ONLY
          onPhase: e => v?.({ stage: n, detail: e })
        });
        C = true;
        S.push({ role: `assistant`, text: r });
        return r;
      } catch (e) {
        if (g?.aborted || e?.name === `AbortError` || r >= Q || !Ce(e)) {
          throw e;
        }
        v?.({ stage: n, detail: `The connection dropped; asking ${c(p)} again (${r + 1} of ${Q})` });
      }
    }
  };
  let T = await w(`designing`);                          // A. author the spec
  let E = null;                                          // last accepted spec
  let D = null;                                          // last built artifact
  let O = [];                                            // notes[]
  for (let e = 0;; e++) {                                // B. extract -> build, with fix loop
    E = o(T);
    let t = E ? null : [s ?? `The reply had no JSON ${i}. Answer with one \`\`\`json block.`];
    if (E) {
      a(E);
      v?.({ stage: `building`, detail: `Building it` });
      try {
        D = await d(E);
      } catch (e) {
        t = e.problems ?? [String(e.message ?? e)];
      }
    }
    if (!t) {
      break;
    }
    if (e >= _e) {                                       // _e = 3  => 4 attempts
      throw Error(`The AI's ${i} could not be built: ${t.slice(0, 5).join(`; `)}`);
    }
    O.push(`fixed ${t.length} ${i} problem(s)`);
    S.push({
      role: `user`,
      text: `The engine rejected the ${i}:\n- ${t.slice(0, 20).join(`
- `)}\nReturn the whole corrected ${i}.`
    });
    T = await w(`fixing`);
  }
  let k = b;                                             // "can we still send pictures?"
  for (let e = 0; e < y; e++) {                          // C. review rounds (y = 2)
    v?.({ stage: `checking`, detail: `Checking the result` });
    let t = k && D.sheet && (await we(p));                // canImage
    let { lead: n, facts: s, layout: c = `` } = f(D, t);
    let m = l ? `\n${l({ prompt: r, what: i, round: e })}` : `\nDoes it match the request "${r}"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected ${i}.`;
    S.push({
      role: `user`,
      text: `${n} ${s}${c}${m}`,
      image: t ? D.sheet : undefined
    });
    let h;
    try {
      h = await w(`checking`);
    } catch (e) {
      if (!t || e?.name === `AbortError`) {
        throw e;
      }
      k = false;                                         // sticky: no more images this run
      O.push(`reviewed without pictures (the brain refused the image)`);
      let n = f(D, false);
      S[S.length - 1] = {
        role: `user`,
        text: `${n.lead} ${n.facts}${n.layout ?? ``}${m}`
      };
      h = await w(`checking`);
    }
    let g = o(h);
    let _ = false;
    for (let t = 0; !g && t < 2 && (/^\s*DONE\b/i.test(h) || /\bDONE\W*$/.test(h.trim())); t++) {
      let t = D.report.ok ? u?.({ verdict: h, built: D, round: e }) ?? null : `The checks still find errors:\n- ${D.report.issues.filter(e => e.level === `error`).map(e => e.message).join(`
- `)}\nFix them and return the whole corrected ${i}.`;
      if (!t) {
        _ = true;
        break;
      }
      O.push(`review ${e + 1}: DONE not accepted`);
      S.push({ role: `user`, text: t });
      h = await w(`checking`);
      g = o(h);
    }
    if (_ || !g) {
      break;
    }
    for (let t = 0; g; t++) {                            // rebuild the revision, 3 tries
      g = a(g) ?? g;
      v?.({ stage: `fixing`, detail: `Rebuilding with the corrections` });
      try {
        D = await d(g);
        E = g;
        O.push(`revised after review ${e + 1}`);
        break;
      } catch (e) {
        let n = e.problems ?? [String(e.message ?? e)];
        if (t >= 2) {
          O.push(`a revision did not build (${n[0]})`);
          g = null;
          break;
        }
        S.push({
          role: `user`,
          text: `The engine rejected the ${i}:\n- ${n.slice(0, 20).join(`
- `)}\nReturn the whole corrected ${i}.`
        });
        g = o(await w(`fixing`));
      }
    }
    if (!g) {
      break;
    }
  }
  return { result: E, built: D, notes: O };
}
```

## 4.2 The budget table — every number

| Invariant | Value | Source |
|---|---|---|
| Max **review rounds** | `2` | `gen3d:416` (`MAX_REVIEW_ROUNDS`), `:833` (`rounds: y = 2`); clothing passes `rounds: d = 2` (`clothing:96`) |
| Max **build retries** (authoring phase) | `3` => **4 attempts** | `gen3d:528` (`_e = 3`), checked at `:906` |
| Max **rebuild retries** (per review round) | `2` => **3 attempts** | `gen3d:992` (`t >= 2`) |
| Max **transport retries** | `2` => **3 attempts** | `gen3d:1015` (`Q = 2`), `:874` |
| Max **DONE re-asks** per round | `2` | `gen3d:957` (`t < 2`) — **dead for clothing** |
| **Problems echoed** to the model | `20` | `gen3d:912`, `:999` |
| **Problems** in the terminal error | `5` | `gen3d:907` |
| Review image max edge | `1568` px | `gen3d:334` |
| Review image max bytes | `5 MB` (`5242880`) | `gen3d:335` |
| Upload hard fail | `20 MB` | `gen3d:343` |
| Image MIME allow-list | `image/png`, `image/jpeg`, `image/webp`, `image/gif` | `gen3d:333` |
| Downscale JPEG quality | `0.9` | `gen3d:377` |
| Review-sheet JPEG quality | `0.85` | `avatarRender:95` |

Worst case for one clothing generation: 1 (designing) + 3 (fixing) + 2 x (1 checking + 3 fixing) =
**11 LLM turns** before it gives up. A clean run is **2 turns** (designing + checking).

## 4.3 What triggers a retry — the complete trigger list

| Trigger | Which budget | Message the model gets |
|---|---|---|
| `extractSpec` returned `null` (no JSON in the reply) | build retry (`_e = 3`) | ``The reply had no JSON design. Answer with one ```json block.`` (`gen3d:890`, the `missing` default) |
| `build()` threw with `.problems` | build retry (`_e = 3`) | `The engine rejected the design:\n- <up to 20 problems>\nReturn the whole corrected design.` |
| `build()` threw a plain `Error` | build retry (`_e = 3`) | same, with `[String(err.message)]` as the single problem |
| Review reply was `DONE` **and** `report.ok === false` | DONE re-ask (2) | `The checks still find errors:\n- <error messages>\nFix them and return the whole corrected design.` — **unreachable for clothing** (`report.ok` is always true) |
| Review reply was `DONE` **and** `accept()` returned a string | DONE re-ask (2) | the `accept` string — **clothing supplies no `accept`**, so unreachable |
| Review reply contained a JSON design (instead of `DONE`) | rebuild (3 per round) | if the rebuild throws: `The engine rejected the design: ...` |
| Transport error classified as `droppedConnection` | transport retry (2) | nothing to the model; the same turn is re-sent |
| The brain refused the image | one text-only retry of the same round | nothing to the model; the message is rewritten without the image |

**What does NOT trigger a retry** (important, and easy to get wrong):

- A design that builds fine but is visually ugly. There is no check for that. The only path is the
  model deciding, on seeing the sheet, to return a corrected design instead of `DONE`.
- A `warn`-level issue. `report.ok` is `true`, so warns never block anything.
- `report.issues` at all. The clothing review puts them in `facts` as prose; nothing acts on them.

So the *only* thing that turns a mediocre-but-valid design into a good one is the model choosing to
revise. That choice is induced entirely by the review image + the layer inventory + "does it match
the request?".

## 4.4 The transport-retry classifier

```js
// gen3d-BAdfthxw.js:1016-1022
function Ce(e) {
  if (e?.resumable || e?.stalled || e?.kind === `exited`) {
    return true;
  } else {
    return /network|fetch|connect|timed? ?out|stopped running|went quiet|ECONN|socket/i.test(String(e?.message ?? e));
  }
}
```

Only transport-ish errors are retried. Anything else (auth, quota, a 500 with a JSON body) is thrown
immediately. `AbortError` and `signal.aborted` are never retried.

## 4.5 The notes — what the run records about itself

Pushed into `O` and persisted as the version's `note` (`clothing:269`:
`note: i ?? (e.notes?.length ? e.notes.join("; ") : null)`). Verbatim strings:

| String | Site |
|---|---|
| `fixed ${n} design problem(s)` | `gen3d:909` |
| `reviewed without pictures (the brain refused the image)` | `gen3d:947` |
| `review ${round+1}: DONE not accepted` | `gen3d:968` |
| `revised after review ${round+1}` | `gen3d:988` |
| `a revision did not build (${problems[0]})` | `gen3d:993` |

A typical successful-with-one-revision run produces:
`revised after review 1`.

A typical rejected-twice run produces:
`fixed 3 design problem(s); fixed 1 design problem(s)`.

These are the only diagnostics a user ever sees about *how* the design was arrived at.

## 4.6 The stage channel

`onStage({stage, detail})` is the only progress signal. `detail` carries free text:

- `` `${brainLabel(brain)} is ${stage}` `` (`gen3d:848`)
- `Building it` (`gen3d:895`)
- `Checking the result` (`gen3d:921`)
- `Rebuilding with the corrections` (`gen3d:983`)
- `The connection dropped; asking ${brainLabel(brain)} again (${r+1} of ${Q})` (`gen3d:879`)

Clothing maps the stage ids through its own label table (`clothing:272-277`, `:300-303`), which is the
only place `building` becomes `Drawing`.

## 4.7 What is NOT a review: the panel's own preview

The `ClothingPanel` re-renders the design on every edit (`ClothingPanel:235`,
`ClothingPanel:315`, `ClothingPanel:376`) and shows a 3D preview via `Preview3D-CIiMrTBA.js`. That is
**human** review, not model review, and it never feeds back into the loop. It is, however, why the
panel shows "Regions painted: 16 / 18" (`ClothingPanel:511`) — the same `report.empty` list the
model gets.
---

# 5. The result envelope — what the agent actually sees

There are **two** envelopes on the clothing path, and they are different shapes. Both matter.

## 5.1 The in-loop envelope (`build()`'s return value) — what the *loop* sees

This is the contract the loop consumes; it is never handed to the agent.

```js
// clothing-62l72JIa.js:213-244
async function N({ withSheet: e = true, rig: t = `R15`, skin: n } = {}) {
  let r = await M();
  return async (i, a = []) => {
    let o = r.validateDesign(i, { images: a.length });
    if (o.length) {
      throw Object.assign(Error(o.join(`\n`)), { problems: o });
    }
    let s = r.attachImages(i, a);
    let c = await r.renderToCanvas(s, document.createElement(`canvas`));
    let l = c.getContext(`2d`).getImageData(0, 0, c.width, c.height).data;
    return {
      design: s,
      canvas: c,
      report: r.checkDesign(s, l),
      sheet: e ? r.renderClothingSheet({ [s.type]: c }, c, {
        rig: t,
        skin: n ?? r.SKIN_TONES[0].hex
      }) : null
    };
  };
}
```

| Field | Type | Contents |
|---|---|---|
| `design` | object | the design **after** `attachImages` — i.e. with `id`, `target` and `src` filled in |
| `canvas` | `HTMLCanvasElement` | 585x559 or 512x512, the rendered atlas |
| `report` | `{ok, issues, size, empty}` | `ok` always `true`; `issues` `[{level:"warn", message}]`; `size` `[w, h]`; `empty` region ids |
| `sheet` | `string \| null` | `data:image/jpeg;base64,...` at quality 0.85, **1024x358** — or `null` when `withSheet: false` |

The loop reads exactly three things from it: `D.sheet` (as the vision image), `D.report.ok`,
`D.report.issues`. The `canvas` field is used only by the caller (`clothing:332`,
`await w.save(m, await P(p.design, p.canvas))`).

`M()` (`clothing:206-212`) lazily imports and **flat-merges** four modules (`design`, `render`,
`avatarRender`, `avatar-CNritt1g`) into one namespace object, which is why `r.validateDesign`,
`r.renderToCanvas`, `r.renderClothingSheet`, `r.SKIN_TONES` all live side by side. This is a fragile
coupling worth noting: `SKIN_TONES` is reachable only because `avatar-CNritt1g.js` re-exports it and
is in the merge list.

## 5.2 The MCP tool envelope — what the *agent* sees

From `generate_clothing` (`index-DPVV2ya5.js:18913-18979`), the tool schema:

```js
{
  name: `generate_clothing`,
  parameters: {
    type: `object`,
    properties: {
      prompt: { type: `string` },
      type:   { type: `string`, enum: [`shirt`, `pants`, `tshirt`] },
      design: { type: `object`, description: `Optional: a complete design instead of a prompt` }
    },
    required: [`type`]
  },
  ...
}
```

**Note: `required: ["type"]` only.** A prompt is optional if a `design` is supplied. There is **no
`images` parameter** on `generate_clothing` — so the agent cannot attach pictures, which makes `image`
layers unreachable from the tool surface (the UI can still do it).

### Branch A — a complete design was supplied (`design` present)

```js
if (t.design) {
  let { item: e, built: n } = await ur({
    design: { ...t.design, type: t.type },
    prompt: t.prompt,
    brain: `assistant`
  });
  return {
    result: {
      ...Sl(e),
      report: n.report,
      ...wl(e)
    },
    summary: `Drew ${e.name}`,
    image: await xl(e.id)
  };
}
```

- `brain: "assistant"` — no LLM call at all. The design is rendered directly.
- `summary` is `Drew <name>`.
- The envelope carries the **full `report`** (`{ok, issues, size, empty}`).

### Branch B — a prompt was supplied (the generation path)

```js
let r = lr({ prompt: t.prompt, type: t.type, ctx: await yl(n), origin: n?.scope ?? null });
let { item: i, running: a } = await gl(r, n?.waitMs);
if (a) {
  return _l(a);
} else {
  return {
    result: {
      ...Sl(i),
      task_id: r.id,
      ...wl(i)
    },
    summary: `Designed ${i.name}`,
    image: await xl(i.id)
  };
}
```

### Branch C — it is still running (the background-task envelope)

```js
// index-DPVV2ya5.js:18835-18843
var _l = e => ({
  result: {
    status: e.status,
    task_id: e.id,
    stage: e.stage,
    note: `Still designing in the background. Carry on; call get_task_result with this task_id (the result is also posted to this chat).`
  },
  summary: `Designing in the background (${e.stage})`
});
```

**No `image` at all** in the running envelope. Generation takes minutes; the agent is told to carry on
and poll.

### The field builders

```js
// index-DPVV2ya5.js:18867-18878
function Sl(e) {
  let t = N(e);
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    prompt: e.prompt,
    version: e.current,
    versions: e.versions.length,
    ok: t?.ok,
    updatedAt: e.updatedAt
  };
}
// index-DPVV2ya5.js:18895-18897
var wl = e => ({ openInClothing: e.id });
```

```js
// index-DPVV2ya5.js:18860-18865
async function xl(e) {
  try {
    return bl(await cr.thumbnail(e));
  } catch {
    return;
  }
}
// index-DPVV2ya5.js:18854-18859
function bl(e) {
  let t = ``;
  for (let n = 0; n < e.length; n += 32768) {
    t += String.fromCharCode(...e.subarray(n, n + 32768));
  }
  return `data:image/png;base64,${btoa(t)}`;
}
```

So the image is a **`data:image/png;base64,...` string built from `thumb.png` bytes** — the
256x256 three.js 3/4 render from 2.14, **not** the 1024x358 sheet.

### The exact envelope, all fields

```jsonc
{
  "result": {
    "id": "m-lq3f8k-9x2b",        // item id
    "name": "royal-robe",          // item name (raw?.name || prompt.slice(0,40))
    "type": "shirt",
    "prompt": "a royal robe",
    "version": 1,                  // item.current
    "versions": 1,                 // item.versions.length
    "ok": true,                    // report.ok  -- ALWAYS true (2.16)
    "updatedAt": 1730000000000,
    "task_id": "task-lq3f8k-4a1c", // Branch B only
    "openInClothing": "m-lq3f8k-9x2b"   // deep link to the panel
  },
  "summary": "Designed royal-robe",
  "image": "data:image/png;base64,iVBORw0KGgo..."   // 256x256 thumb, ABSENT while running
}
```

**Notable absences:** no `design` JSON in the generation envelope (only `edit_clothing` with a
`design` argument echoes it back, via `Cl(N(i).design)` at `index:19060`), no `report` (except on the
direct-design branch), no file path, no URL.

`Cl` is worth quoting because it is the "don't send base64 back" filter:

```js
// index-DPVV2ya5.js:18879-18887
function Cl(e) {
  return {
    ...e,
    layers: (e?.layers ?? []).map(e => e.src ? { ...e, src: `[picture]` } : e)
  };
}
```

## 5.3 How the envelope becomes MCP content blocks

```js
// index-DPVV2ya5.js:42171-42182
let { result: o, image: s } = await i.call(a.studio, a.args, { token: r, scope: e, mcp: true, agentLabel: `an agent (over MCP)`, place: a.place });
let c = [{
  type: `text`,
  text: typeof o == `string` ? o : JSON.stringify(o ?? null)
}];
let l = s && /^data:([^;]+);base64,(.*)$/s.exec(s);
if (l) {
  c.push({
    type: `image`,
    mimeType: l[1],
    data: l[2]
  });
}
return { content: c };
```

So every generator returns **two content blocks**: a JSON text block and an image block. The image is
inline base64, not a path. If `xl` failed (thumbnail missing), the `image` key is `undefined` and only
the text block is emitted.

**Answering the question directly:** the envelope is **`{result, summary, image}`**; the image is
**inline base64** (`data:image/png;base64,...` of the 256x256 thumbnail), **not a path**. The
summary is a one-line human string. The result is a flat JSON object with 8-10 scalar fields.

## 5.4 What `edit_clothing` returns (different shape)

```js
// index-DPVV2ya5.js:19056-19065
return {
  result: {
    ...Sl(i),
    task_id: r.id,
    design: Cl(N(i).design),      // the CURRENT design, with src -> "[picture]"
    ...wl(i)
  },
  summary: `${i.name} v${i.current}`,
  image: await xl(i.id)
};
```

So `edit_clothing` is the only tool that hands the design JSON back to the agent — with every image
`src` replaced by the literal string `[picture]`. That is what makes a second edit possible without
re-uploading.

## 5.5 What the envelope does NOT contain, and why it matters

| Missing | Consequence |
|---|---|
| the design JSON (on generate) | the agent cannot inspect what was drawn; it must call `get_clothing` |
| the 1024x358 sheet | the agent sees only the 256x256 3/4 thumbnail, so it cannot judge back/side itself |
| the `report.issues` list | the agent never learns that regions were empty |
| a file path | there is nothing to hand to an upload flow (see the "upload" defect) |
| any URL | RobloxKit never uploads; the user finishes in the Creator Dashboard |

The upload path, for completeness, is a separate export:

```js
// clothing-62l72JIa.js:498-511
var Y = {
  shirt:  { label: `Classic Shirts`, url: `https://create.roblox.com/dashboard/creations?activeTab=Shirt` },
  pants:  { label: `Classic Pants`,  url: `https://create.roblox.com/dashboard/creations?activeTab=Pants` },
  tshirt: { label: `T-Shirts`,       url: `https://create.roblox.com/dashboard/creations?activeTab=TShirt` }
};
```

```js
// clothing-62l72JIa.js:489-497
function q(e) {
  return String(e.name || `clothing`).toLowerCase().replace(/[^a-z0-9_-]+/g, `-`).replace(/^-+|-+$/g, ``).slice(0, 40) || `clothing`;
}
async function J(e) {
  let t = await (await M()).renderPng(c(e).design);
  return f(`clothing`, { [`${q(e)}.png`]: t });
}
```

i.e. **render the PNG, save it as `<slug>.png` under `Documents/RobloxKit/clothing/`, and hand the
user the dashboard deep link.** There is no asset API call, no `upload_image`, no local HTTP server.
The panel says so in its own copy (`ClothingPanel:590`):
`Roblox does not let apps publish classic clothing: the upload is yours.`

---

# 6. Quality heuristics — what actually exists, and what does not

This section is deliberately split into **enforced in code**, **implied by the built-in defaults**,
and **absent** — because the honest answer is that RobloxKit enforces almost nothing and the quality
comes from the renderer's capability surface plus the review image. Getting this wrong is how a port
ends up with a rule list that makes garments *worse*.

## 6.1 Enforced in code — the complete list (it is short)

| Rule | Mechanism | Site |
|---|---|---|
| `layers` must be 1..40 | hard reject | `design:23-28` |
| `type` must be shirt/pants/tshirt | hard reject (and then overwritten) | `design:17-19`, `clothing:125-128` |
| every colour must be `#rrggbb` | hard reject | `design:30` |
| `target` must resolve to >= 1 region | hard reject | `design:41-43` |
| `kind` must be one of the 13 | hard reject | `design:38-40` |
| `text` 1..60 chars | hard reject | `design:54-56` |
| `size` 1..400, `gap` 0..400, `angle` -360..360 | hard reject | `design:50-52` |
| `x`,`y`,`w`,`h`,`opacity` in 0..1 | hard reject | `design:47-49` |
| `font` in 4 names, `shape` in 6, `edge` in 6 | hard reject | `design:57-66` |
| `image` index must be a valid attached picture | hard reject | `design:67-73` |
| **A region painted < 5 % ⇒ warn "the skin shows there"** | 4 px lattice, alpha > 16 | `design:97-118` |
| **A text layer under 10 px ⇒ warn "hard to read in game"** | threshold on `size` | `design:119-124` |

That is the entire enforced set. **Both quality checks are `warn`, and `ok` ignores warns** (2.16) —
so neither of them can block anything. They exist to *inform the model*, not to gate it.

## 6.2 The one rule with real teeth: "no region may be left bare"

The 5 %-per-region emptiness check is the closest thing to a quality heuristic in the code, and it is
worth understanding *why*:

- The clothing atlas is composited **over the skin** (2.15). A transparent region is not "empty" —
  it is *visible skin*. On a shirt, a bare `right_arm_front` is a bare arm.
- The check names the regions by id, so the model gets `right_arm_front, left_arm_front` and can add
  a layer with `target: "right_arm"`.
- The threshold is generous (5 %) so that a deliberate design choice — a sleeve with a bare cuff —
  is not flagged as long as *something* covers the face.

**Practical guidance this implies:** every one of the 18 regions should carry at least ~5 % alpha.
The simplest way to guarantee that is one `target: "all"` layer near the bottom of the stack. That is
exactly what `newDesign` does (`solid on all`), and it is what most good designs will do.

## 6.3 Implied by the built-in defaults (pattern scale, palette, layer count)

`newDesign` (1.5) is the only design RobloxKit ships as an example, and its numbers are the only
*evidence* for pattern-scale guidance. Reading them:

| Parameter | `newDesign` value | What it implies |
|---|---|---|
| Base layer | `solid`, `target: "all"` | always start with an all-region base — guarantees no bare region |
| Pattern layer | exactly **one** accent pattern | the shipped default is 2 layers, not 8 |
| Pattern `size` | `6` px | on a 128 px torso face, a 6 px band is about 1/21 of the face height — **thin** |
| Pattern `gap` | `26` px | period 32 px ⇒ **4 bands** on a 128 px face — **few, wide-spaced** |
| Pattern `angle` | `90` | horizontal hoops |
| Pattern `target` | `torso` (shirt) / `left_leg` (pants) | **restrict the accent to one part** — not `all` |
| Gradient `angle` (tshirt) | `45` | diagonal, the most "designed"-looking default |
| Text `size` (tshirt) | `64` px on a 512 px canvas | 1/8 of the canvas — **large** |
| Text colour | `#ffffff` on a saturated gradient | maximum contrast |
| Palette | `#e11d48` / `#7c3aed` / `#ffffff` / `#1f2a44` | 2-3 saturated colours + white, **no mid-greys** |

**[DERIVED] Pattern scale rule of thumb.** All the region dimensions are 64 or 128 px. A pattern with
`size: S, gap: G` produces `regionDim / (S + G)` repeats. For a repeat count of 3-6 on a 128 px face
(the "reads at a distance without looking busy" band), `S + G` should be **21-43 px**. `newDesign`'s
`6 + 26 = 32` sits exactly in the middle. A naive design that uses `size: 16, gap: 16` (the prelude
defaults!) gets `128 / 32 = 4` — also fine — but `size: 64` gets 2 repeats, which reads as a colour
block, and `size: 4, gap: 2` gets 21 repeats, which reads as noise from a distance.

The prelude defaults (`size ?? 16`, `gap ?? size`) are therefore *reasonable*, not hostile. The
problem is that a model that never gets told to think about scale will pick arbitrary values.

## 6.4 "Must read at a distance" — RobloxKit never says this to the clothing model

This phrase is **not** in the clothing path. It appears in the *invented* porting prompt
(`porting/03-generators/README.md:289`) and in the *texture* engine's review lead
(`genTexture:85` — "Judge it as a player sees it on a wall or a prop"), and in the *icons* lead
(`genIcons:91` — "Judge them small, as a player sees them"). For clothing, the nearest thing is the
small-text warning: `Some text is under 10 px and will be hard to read in game.`

That warning is the only "readability" statement anywhere in the clothing engine, and it only applies
to `text` layers. There is no equivalent for patterns.

**[DERIVED]** This is a real gap in RobloxKit, not a feature. Adding "does the pattern read at a
distance?" to the review `lead` (as `porting/03-generators` recommends) is an improvement, and it is
consistent with what the other eight engines do.

## 6.5 Palette discipline — nothing enforces it, but the capability surface implies it

There is **no** palette field, no palette limit, and no colour-count check. A design can use 40
layers with 40 distinct colours and nothing complains.

What does exist:

- `plaid` is a **3-colour** pattern by construction (`color`, `color2`, `color3`), and it blends them
  at 0.25 and 0.65 — so its three colours must be chosen to look right *blended*, not side by side.
- `camo` is a **3-colour** pattern with hard thresholds — its three colours are the entire palette of
  the garment's dominant surface.
- `checkDistinctColours` does **not** exist. `checkDesign` never counts colours.

**[DERIVED]** The discipline is implied by `newDesign`: 2-3 saturated colours plus white, with the
white used only for thin accents at 6 px. A port that wants to enforce a palette should do it in the
*prompt*, not the validator.

## 6.6 Layer count — no minimum, and the maximum is 40

There is **no minimum layer count** beyond 1. A one-layer `solid` design is perfectly valid and
passes every check with `ok: true`.

**[DERIVED] The evidence for "more layers = better" is real but indirect.** The failure mode reported
against the naive clone was a design whose *entire* visual identity was `trim` + `shape` layers, and
the clone dropped them. That is an argument for *supporting* many layers, not for *requiring* them.
RobloxKit's own default is 2 layers. The right rule is: a garment that reads as designed typically
needs **3-6** layers —

1. a base covering `all` (guarantees no bare region),
2. one or two structural accents restricted to a part or a face (trim, stripes on `torso`),
3. an optional motif (shape or text on `torso_front`),
4. optional fine detail (a second trim on a different edge, a `checks` or `plaid` band).

Anything above ~8 layers on a 585x559 atlas is usually indistinguishable from 4.

## 6.7 The heuristics that only exist in the *other* engines (and are worth stealing)

RobloxKit's other engines carry explicit quality language that clothing lacks. These are the phrases
worth importing into a clothing `lead`:

| Source | Phrase | Why it transfers |
|---|---|---|
| `genTexture:85` | `real material breakup, not a flat colour, not noise` | the exact failure mode of a solid+trim garment; two negative constraints |
| `genIcons:91` | `does each symbol read instantly, do they look like one set?` | "one set" is the palette-coherence question |
| `genGfx:101` | `does it read at a glance, is the subject clear, is the text legible and inside the safe area?` | three concrete, answerable questions |
| `genSkybox:86` | `Judge it as a player standing in the game: mood, colours, the sun's place, clouds.` | names four axes |
| `generate:701` (polyforge) | `Look at it as the thing it should be, as a player would see it in the game.` | "as the thing it should be" — judge the intent, not the geometry |
| `generate:562` (polyforge `accept`) | `Look again at every picture and the close-ups as a demanding art director would: what still reads wrong at a glance` | the "demanding art director" second pass |

Polyforge's `accept` gate is the single most transferable idea in the whole corpus (3.7 / B 10.7):
even an all-8+/10 first-round verdict is **rejected once** and the model is told to re-inspect as a
demanding art director. Clothing has no equivalent — which is exactly why a clothing run can finish in
2 turns with a mediocre garment.

The full polyforge `question` + `accept`, verbatim, for reference:

```js
// generate-BwNaPC_j.js:541-566
var $ = [`silhouette and proportions`, `anatomy and number of limbs`, `face readable from the front`, `every part attached (nothing floating, no gaps at joints)`, `level of detail for the request`, `colours`, `pose`];
function oe({ prompt: e }) {
  return `Review it critically against the request "${e}" before deciding.
1. For each picture (front, right side, back, three-quarter, and each close-up), list what is wrong or weak: be specific (which part, where, what it should be).
2. Score each of these 1 to 10, one per line as "name: N/10 - reason": ${$.join(`; `)}.
3. If every score is 8 or more and the checks found no errors, end your reply with the single word DONE. Otherwise return the whole corrected script in one \`\`\`js block, fixing the lowest scores first.`;
}
function se({ verdict: e, round: t }) {
  let n = [...String(e).matchAll(/(\d+(?:\.\d+)?)\s*\/\s*10\b/g)].map(e => Number(e[1]));
  if (n.length < $.length - 2) {
    return `Score every item first (${$.join(`; `)}), each as "name: N/10 - reason", then decide.`;
  }
  let r = n.filter(e => e < 8);
  if (r.length) {
    return `${r.length} score${r.length > 1 ? `s are` : ` is`} under 8 (${r.join(`, `)}): it is not done. Return the whole corrected script, fixing those first.`;
  } else if (t + 1 < 2) {
    return `Look again at every picture and the close-ups as a demanding art director would: what still reads wrong at a glance (proportions, the face, the hands, parts that float or clip)? Fix what you find and return the whole corrected script; reply DONE only if you truly find nothing to improve.`;
  } else {
    return null;
  }
}
```

A clothing analogue would be a 5-6 item rubric (silhouette/read-at-distance, palette coherence, seam
continuity, motif placement, coverage of all regions, text legibility) with the same 8/10 gate and the
same forced second look.

## 6.8 Where the good-looking output actually comes from — the honest summary

Ranked by how much each mechanism contributes:

| Rank | Mechanism | Contributes because |
|---|---|---|
| 1 | **The renderer supports 13 layer kinds with per-face targeting** | a design *can* express weave, motifs, borders, heraldry. Without this, no prompt can help |
| 2 | **The review image is the garment on an avatar (1024x358, 3 views + flat)** | the model can *see* drape, proportion, and whether a motif sits on the chest. This is the only way it can judge its own work |
| 3 | **The review turn exists at all (`rounds: 2`, `vision: true`)** | forces at least one look at the output before accepting |
| 4 | **The `layout` layer inventory + `Empty regions` list** | makes the repair round *actionable* — the model knows exactly what it built and what is missing |
| 5 | **`prompts/clothing.md`** (gone) | presumably carries the schema and whatever quality language produced the observed output. **Unknown, and this is the single biggest unknown in the whole engine** |
| 6 | **`checkDesign`'s two warnings** | weak (warn-only, `ok` always true) but they do reach the model as prose |
| 7 | **`newDesign` as a latent example** | only matters if the model is shown it, which it is not — so effectively 0 in the pipeline |

Notice that #5 is the only one that is unrecoverable, and #1-#4 are all fully recovered above. **That
is the actionable conclusion: you can reproduce 80 % of the quality mechanism without the system
prompt, and the remaining 20 % is prompt prose you must write yourself.**

## 6.9 The "flat garment" failure, mechanically explained

For the record, the exact mechanism by which a naive clone produces a flat garment:

1. **The model emits a design that relies on vector kinds.** A "royal robe with a cape" prompt
   produces gold `trim` seams, a `trim` placket, `trim` cuffs and hem, and a `shape` crown — because
   those are the only tools in the schema for heraldry and structure.
2. **The clone's renderer treats only the 9 pattern kinds as drawable.** The drop is a single
   predicate:
   ```ts
   const isPattern = (kind) => kind !== 'text' && kind !== 'image' && kind !== 'shape' && kind !== 'trim'
   ...
   if (layer.hidden || !isPattern(layer.kind)) continue
   ```
   (This is the actual shape of the defect in the naive port; see `termul/.omo/roblox-fix/00-ROOT-CAUSE.md`
   DEFECT 1.)
3. **What survives is the base `solid` and one pattern.** A solid blue shirt with white dots.
4. **Nothing notices.** `coverage` reports ~100 % because the `solid` filled the sheet, so `report.ok`
   is `true` — exactly as it would be in RobloxKit, where `ok` is always true anyway. The model is
   told its design passed.
5. **The review image is the flat atlas**, so even if the model looks, it sees a tidy UV unwrap and
   says `DONE`.

Four independent failures, any one of which would be enough. The fix has to address all four:
implement the 13 kinds, render the avatar sheet, report per-region emptiness, and print the layer
inventory.

---

# 7. What a faithful port must do — checklist

Ordered by dependency. Each item names the RobloxKit source it reproduces.

## 7.1 Schema and constants

- [ ] `TYPES = ['shirt', 'pants', 'tshirt']`, `LIMITS = { layers: 40, text: 60 }` (`design:3-7`).
- [ ] `PATTERNS` = the 9 pattern kinds, in this order: `solid, gradient, stripes, checks, plaid,
      polka, zigzag, camo, noise` (`render:3`).
- [ ] `LAYER_KINDS` = `PATTERNS` + `text, image, shape, trim` (`render:154`) — **13 kinds, all
      drawable**.
- [ ] `SHAPES = ['rect','circle','star','heart','diamond','triangle']` (`render:155`).
- [ ] `FONTS` = the four keys with the literal CSS stacks (`render:156-161`).
- [ ] Every layer field from the 1.2 table, with the documented defaults applied **at draw time**,
      not at validation time.
- [ ] `attachImages` injecting only `id` and `target`, plus `src` from the image array
      (`design:77-89`).
- [ ] The inverse `stripSrc` (`clothing:20-46`) so the model never sees base64.

## 7.2 Geometry — the atlas

- [ ] `SHEET_DIMENSIONS`: 585x559 for shirt/pants, 512x512 for tshirt (`layout:74-86`).
- [ ] The 6 torso regions with the exact rects in 2.3 (`layout:1-27`).
- [ ] The limb generator with **stride 66, face width 64**, y=355 for the four side faces, and the
      `up` (y=289) / `down` (y=485) 64x64 caps at the given `upX` (`layout:28-54`).
- [ ] The 18-region set for shirt (`right_arm`, `left_arm`) and pants (`right_leg`, `left_leg`), and
      the single 512x512 `graphic` region for tshirt (`layout:55-73`).
- [ ] `resolveTarget` with the **three-step precedence**: exact id, then part, then face
      (`layout:94-109`). Test the `"left"` case explicitly — it must return the 3 left-facing faces,
      not the left arm.

## 7.3 Geometry — the renderer

- [ ] `renderPixels(design) -> Uint8ClampedArray` (W*H*4), background filled first, pattern layers
      only, per region (`render:198-218`).
- [ ] The per-region painter with **region-local pattern coordinates** and the exact opacity
      semantics (`render:133-153`) — including `alpha = max(old, round(a*255))`.
- [ ] `renderToCanvas` as the **two-pass compositor**: pattern batch to a fresh transparent buffer via
      `putImageData` + `drawImage`, flush before every vector layer, final flush (`render:231-349`).
- [ ] `shapePath` for all six shapes, with the **inner radius 0.45** star and the two-bezier heart
      (`render:355-393`).
- [ ] `text` with `textAlign: center`, `textBaseline: middle`, line height `size*1.1`, `maxWidth =
      regionW*0.96`, outline `max(2, size/10)` with `lineJoin: round` (`render:274-295`).
- [ ] `image` with the `w`-vs-`fit` sizing and **centre-anchored** placement (`render:296-311`).
- [ ] `shape` with the `h ? 1 : regionW/regionH` aspect correction (`render:312-323`).
- [ ] `trim` on all six edge sets, `width` in **pixels**, default `bottom` (`render:324-342`).
- [ ] Per-region `save()/rect()/clip()/restore()` so vector layers cannot bleed across faces.

## 7.4 The nine patterns — bit-exact

- [ ] `palette.parse` accepting `#rgb` and `#rrggbb`, NaN ⇒ `[0,0,0]` (`palette:4-8`).
- [ ] Colour lerp `round(A + (B-A)*t)` (`render:36`).
- [ ] Prelude: `size` floor 2, `gap` floor 1 defaulting to `size`, `angle` wrapping mod 360, `seed`
      default 7 (`render:37-45`).
- [ ] `gradient`: bounding-box-normalised projection (`render:47-54`).
- [ ] `stripes`: `period = size+gap`, positive modulo (`render:55-56`).
- [ ] `checks`: cell = `size`, `gap` unused (`render:57-58`).
- [ ] `plaid`: half-band, 25 % checkerboard dither, `max(1, round(size/12))` pins at `P - gap/2`
      blended 65 % to `color3` (`render:59-80`).
- [ ] `zigzag`: amplitude `size/2`, wavelength `max(4, 2*size)` (`render:81-93`).
- [ ] `polka`: staggered rows, radius `size/2` (`render:94-107`).
- [ ] `camo`: two value-noise octaves at `2S` and `S`, blended 0.7/0.3, thresholds 0.40 / 0.62
      (`render:108-123`).
- [ ] `noise`: single octave as the lerp factor (`render:124-128`).
- [ ] `mulberry32` verbatim (`render:4-13`).
- [ ] `valueNoise` verbatim: hash `ix*73856093 ^ iy*19349663`, memoised, **smoothstep** `3u²-2u³`
      (`render:14-35`).

## 7.5 The checks — and the honest limit

- [ ] `checkDesign` with the 4 px lattice, `alpha > 16`, `< 5 %` ⇒ empty, `empty[]` of region ids,
      the `< 10 px` text warning, and `size: [w, h]` (`design:90-131`).
- [ ] `ok` computed as `!issues.some(i => i.level === 'error')` — **and be aware this makes `ok`
      always true**. Do not "fix" it silently; instead add a *real* gate if you want one (see 7.9).
- [ ] The `tshirt` exemption from the region scan.

## 7.6 The review image — non-negotiable

- [ ] `renderClothingSheet`: 1024x358, `#101113` background, 3 three.js panels (front / back / left
      side, each 256x358), the flat template letterboxed in panel 3, `14px sans-serif` labels,
      JPEG quality 0.85 (`avatarRender:63-96`).
- [ ] Camera: `PerspectiveCamera(30, 256/358, 0.1, 100)`, target `(0, 2.75, 0)`, distance 12.5, the
      five direction vectors from 2.13.
- [ ] Lighting: hemisphere `(0xffffff, 0x2a2a2a, 1.8)` + directional `1.9` at `(3,8,7)` + `0.9` at
      `(-3,5,-7)` (`avatarRender:18-32`).
- [ ] `setPixelRatio(1)`, `alpha: true`, `antialias: true`, `preserveDrawingBuffer: true`.
- [ ] `renderClothingThumbnail`: 256x256, `3/4` view, transparent background, PNG (`avatarRender:49-62`).
- [ ] The R15/R6 rig with the part table, the split fractions, `segmentRect`, and **skin → pants →
      shirt** compositing so alpha shows skin (`avatar-CSK-yHJ2.js:141-156`, `:287-301`).
- [ ] If a real three.js avatar is out of scope for a first pass: at minimum composite a 4-panel strip
      that shows the garment at worn proportions. **Do not ship the raw UV atlas as the review image.**

## 7.7 The prompt surface

- [ ] The first user message, exactly: `Design a <Label>: <prompt>` / `Type: <raw type>.`, blank-line
      separated, plus the picture sentence when pictures > 0 (`clothing:47-61`).
- [ ] The edit path: `Change this design as asked, keeping everything else. Return the whole updated
      design.` + fenced minified JSON + `Change: <prompt>` + `Type: <raw type>.` (`clothing:53`).
- [ ] The review `lead`, verbatim: `Here is the design on the avatar (front, back, left side) and the
      flat template.` with the text-only fallback `The renderer drew it (no picture: judge it from
      the description below).` (`clothing:131`).
- [ ] The review `facts`: `It passes the checks.` or `\nChecks:\n- <level>: <message>` (`clothing:132-133`).
- [ ] The `layout` formatter with the **leading `\n`**, bottom-to-top numbering, the fixed colour order
      `color/color2/color3/from/to`, and the `Every region is painted.` / `Empty regions (skin shows): …`
      tail (`clothing:62-83`).
- [ ] The default closer: `Does it match the request "<prompt>"? If it does and there are no errors,
      reply with the single word DONE. Otherwise return the whole corrected design.` (`gen3d:933`).
- [ ] The fix message: `The engine rejected the design:\n- <up to 20>\nReturn the whole corrected design.`
      (`gen3d:910-914`).
- [ ] The missing-JSON message: ``The reply had no JSON design. Answer with one ```json block.``
      (`gen3d:890`).
- [ ] **Write a system prompt** (`prompts/clothing.md` equivalent) that carries: the 3 types, the 13
      kinds, the 18 region ids + 5 parts + 6 faces, every field with its range, the 40/60 caps, the
      `#rrggbb` rule, the one-fenced-json-block output contract, and the "you will be asked to fix
      rejected designs" contract. This is the unrecoverable 20 %.
- [ ] **Consider strengthening the review `lead`** beyond RobloxKit's (see 6.7) — the porting doc's
      version is a legitimate improvement, clearly labelled as invented.

## 7.8 The loop

- [ ] `rounds: 2`, `vision: true` for clothing (`clothing:96-97`, `:142-143`).
- [ ] `normalize: d => { d.type = type; return d }` (`clothing:125-128`).
- [ ] Build retries 3 (4 attempts), problems capped at 20 echoed / 5 in the terminal error.
- [ ] Rebuild retries 2 (3 attempts) per review round.
- [ ] Transport retries 2 (3 attempts), only for `droppedConnection`-classified errors.
- [ ] The image-refusal fallback: rewrite the last message text-only, retry the round, set a **sticky**
      `canImage = false`.
- [ ] `extractSpec`: fenced block first, then outermost brace span (`gen3d:596-613`).
- [ ] The DONE test: `/^\s*DONE\b/i` or `/\bDONE\W*$/` on the trimmed text, **and** no JSON extracted.
- [ ] `tools: []` — generation is a pure text/vision call, never a tool call (`gen3d:667`).
- [ ] The system prompt folded into the **first user message** for ACP agents
      (`` `${system}\n\n---\n\n${text}` ``, `gen3d:647`).
- [ ] `notes[]` with the five verbatim strings from 4.5.

## 7.9 Things RobloxKit does that you should consider *fixing*

These are observed weaknesses, not spec. Fixing them is a deliberate divergence — label it as such.

- [ ] **`report.ok` is always true.** If you want the checks to mean something, emit `level: "error"`
      for a design with zero pattern layers, or for a design where > 50 % of regions are empty. Then
      the `The checks still find errors` path (`gen3d:962`) becomes live.
- [ ] **`opacity` is silently ignored on vector layers.** Either honour it or remove the slider. Do
      not leave a control that does nothing.
- [ ] **Semi-transparent pattern batches double-darken** (2.8). Either pass the canvas background
      into the batch or composite the batch with proper source-over.
- [ ] **`seed` is invisible and unvalidated.** If you want reproducible camo/noise, put `seed` in the
      schema, validate it, print it in the `layout`, and default it per design rather than per layer.
- [ ] **`angle` is ignored by 7 of 9 patterns.** Either implement it or reject it for those kinds, so
      the model's intent is not silently discarded.
- [ ] **No `accept` gate for clothing.** A 5-6 item rubric with the polyforge 8/10 threshold (6.7)
      would force a second look and is the cheapest available quality upgrade.
- [ ] **The review `lead` has no judgement clause.** Add one (6.7).
- [ ] **The agent's envelope omits the design, the report, and any path.** If your upload flow needs a
      file, write one and return the absolute path.

## 7.10 Verification tests

- [ ] **Pixel determinism:** the same pattern-only design twice ⇒ identical `Uint8ClampedArray`.
      Cover all 9 patterns, at `angle` 0/45/90, with and without `seed`.
- [ ] **Region coverage:** a `solid` on `all` ⇒ `empty.length === 0` for both shirt and pants.
- [ ] **Region targeting:** `target: "torso"` ⇒ 6 regions painted; `target: "front"` ⇒ 3;
      `target: "left"` ⇒ 3 (the left faces, **not** the left arm); `target: "torso_front"` ⇒ 1.
- [ ] **Seam independence:** a `stripes` on `all` must restart at each region's corner — compare
      `torso_front` x=0 to `torso_back` x=0 and assert they are identical columns.
- [ ] **Vector clip:** a `shape` with `x: 0.5` on `torso_front` must not appear on `torso_back`.
- [ ] **Batch flush order:** a pattern, then a `trim`, then a pattern ⇒ the first pattern is under the
      trim and the second is over it.
- [ ] **Validator order:** a design with a bad `kind` **and** a bad `color` must report the `kind`
      problem only (the `return` short-circuits the rest of that layer).
- [ ] **Build retry:** a stub brain returning an invalid design then a valid one ⇒ 2 builds, note
      `fixed N design problem(s)`.
- [ ] **Review revision:** a stub brain returning `DONE` on round 1 ⇒ 2 turns total; returning a
      corrected design then `DONE` ⇒ 4 turns, note `revised after review 1`.
- [ ] **Image refusal:** a stub brain that throws on an image turn ⇒ the round is retried text-only and
      the note is recorded.
- [ ] **Sheet shape:** the review image is 1024x358, JPEG, with three avatar panels and the template.

---

# Appendix A — the complete symbol map

| Symbol | File:line | Export name | Role |
|---|---|---|---|
| `s` | `design:3` | `TYPES` | `['shirt','pants','tshirt']` |
| `c` | `design:4-7` | `LIMITS` | `{layers:40, text:60}` |
| `l` | `design:8` | — | `/^#[0-9a-f]{6}$/i` |
| `u` | `design:9-76` | `validateDesign` | collector, returns `string[]` |
| `d` | `design:77-89` | `attachImages` | inject `id`/`target`/`src` |
| `f` | `design:90-131` | `checkDesign` | `{ok, issues, size, empty}` |
| `r` | `render:3` | `t` | `PATTERNS` (9) |
| `i` | `render:4-13` | — | `mulberry32` |
| `a` | `render:14-35` | — | `valueNoise` |
| `o` | `render:36` | — | colour lerp |
| `s` | `render:37-132` | — | pattern closure factory |
| `c` | `render:133-153` | — | per-region pixel painter |
| `l` | `render:154` | `LAYER_KINDS` | 13 kinds |
| `u` | `render:155` | `SHAPES` | 6 shapes |
| `d` | `render:156-161` | `FONTS` | 4 font stacks |
| `f` | `render:162-197` | `newDesign` | the built-in example |
| `p` | `render:198-218` | `renderPixels` | `Uint8ClampedArray` |
| `h` | `render:219-230` | — | cached `Image` loader |
| `g` | `render:231-349` | `renderToCanvas` | the compositor |
| `_` | `render:350-354` | `renderPng` | `toBlob('image/png')` |
| `v` | `render:355-393` | — | `shapePath` |
| `e` | `layout:1-27` | — | torso regions |
| `t` | `layout:28-54` | — | limb regions |
| `n` | `layout:55-58` | `n` | part map |
| `r` | `layout:59-73` | `n` (as `r`) | region list |
| `i` | `layout:74-86` | — | `SHEET_DIMENSIONS` |
| `a` | `layout:87-93` | `t` | part list |
| `o` | `layout:94-109` | `r` | `resolveTarget` |
| `r` | `palette:4-8` | `r` | hex parse |
| `m` | `avatarRender:49-62` | `renderClothingThumbnail` | 256x256 PNG |
| `h` | `avatarRender:63-96` | `renderClothingSheet` | 1024x358 JPEG |
| `b` | `clothing:47-61` | — | first-message builder |
| `x` | `clothing:62-83` | — | layout formatter |
| `S` | `clothing:84-153` | — | the `designLoop` call |
| `N` | `clothing:213-244` | `clothingBuilder` | the `build()` closure |
| `P` | `clothing:245-257` | — | thumbnail call |
| `F` | `clothing:258-271` | — | version record builder |
| `I` | `clothing:272-277` | — | stage labels |
| `L` | `clothing:278-340` | — | the task runner |
| `J` | `clothing:492-497` | `saveClothingPng` | render + save PNG |
| `Y` | `clothing:498-511` | `UPLOAD_GUIDE` | dashboard URLs |
| `Se` | `gen3d:814-1014` | — | the loop |
| `Z` | `gen3d:771-813` | `designLoop` | model resolve + delegate |
| `J` | `gen3d:614-675` | `askBrain` | one LLM turn |
| `q` | `gen3d:596-613` | `extractSpec` | JSON extraction |
| `we` | `gen3d:1023-1038` | — | `agentTakesImages` |
| `Ce` | `gen3d:1016-1022` | `droppedConnection` | transport classifier |
| `_e` | `gen3d:528` | — | `3` build retries |
| `Q` | `gen3d:1015` | — | `2` transport retries |
| `Sl` | `index:18867-18878` | — | result summary builder |
| `wl` | `index:18895-18897` | — | link builder |
| `xl` | `index:18860-18865` | — | thumbnail → data URL |
| `_l` | `index:18835-18843` | — | background-task envelope |
| `Cl` | `index:18879-18887` | — | `src` → `"[picture]"` |

---

# Appendix B — the six gaps, and how to close each

| # | Gap | Impact | How to close it |
|---|---|---|---|
| 1 | **`prompts/clothing.md` body** | HIGH — carries the whole schema + whatever quality language produced the good output | Re-author it. It is auth-gated (`GET /api/assets/prompts/clothing/prompts/clothing.md` → 401) and absent from disk/EXE. The contract it must express is enumerated in 3.1 and 7.7 |
| 2 | Whether the system prompt already lists the 9 patterns and every field name | MEDIUM — if it does, the model's schema knowledge is prompt-only and a re-authored prompt must be at least as complete | Follows from #1 |
| 3 | Whether `checkDesign`'s `level: "error"` branch is a bug | LOW — but it means the only gate is the review round | Decide deliberately (7.9) |
| 4 | Whether the semi-transparent batch double-darkening is intentional | LOW | Reproduce it for fidelity, or fix it and label the divergence |
| 5 | Whether `opacity` on vector layers is meant to work | LOW | Same |
| 6 | Exact PNG bytes from `toBlob` | LOW for quality, HIGH for byte-diff tests | Pin the browser, or target the `renderPixels` buffer instead of the PNG (2.17) |

**The honest bottom line on gap 1:** the body is gone and no amount of further reversing will recover
it. But every *interface* it must satisfy is recovered above: the schema the model has to emit
(1.1-1.3), the vocabulary it has to use (1.3, 2.3, 2.4), the ranges it must stay inside (1.2, 3.8),
the output format (`extractSpec`'s two strategies), the rejection loop, and the review message it will
be judged by. A re-authored prompt that satisfies those is functionally equivalent even if it is not
byte-identical.
