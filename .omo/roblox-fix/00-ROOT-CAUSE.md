# Root-cause verdict — why generated clothing looks bad and the upload stalls

Written from the **real RobloxKit bundle** at
`C:\Users\Novella\Documents\Github\Robloxkit\artifacts\frontend_unmin\`, not from
the RE reports. Every claim below cites a file and symbol that can be re-read.

Modules that matter:

| File | Exports |
|---|---|
| `render-CpljO1Hx.js` | `renderPixels` (`p`), `renderToCanvas` (`g`), `renderPng` (`_`), `LAYER_KINDS` (`l`), `SHAPES`, `FONTS`, `PATTERNS` (`r`) |
| `layout-yFs0_M_2.js` | region atlas, `resolveTarget` (`o`), `SHEET_DIMENSIONS` (`i`) |
| `design-PKArvEjc.js` | `validateDesign` (`u`), `checkDesign` (`f`), `attachImages` (`d`) |
| `clothing-62l72JIa.js` | `clothingBuilder` (`N`), the clothing `designLoop` call (`S`), `UPLOAD_GUIDE` (`Y`), `saveClothingPng` (`J`), prompt builder (`b`), review layout (`x`) |
| `gen3d-BAdfthxw.js` | `designLoop` (`Se`), `askBrain` (`J`), `extractSpec` (`q`), budget constants |
| `avatarRender-DVeE1evW.js` | `renderClothingSheet` (`h`), `renderClothingThumbnail` (`m`) |
| `avatar-CSK-yHJ2.js` | `buildAvatar` (`P`), `composite` (`N`), `rectUvs` (`k`), `segmentRect` (`A`) |

---

## DEFECT 1 — Four of thirteen layer kinds are silently dropped (the ugly shirt)

**Termul** `src/renderer/lib/generator/engines/clothing/render.ts:29-30`

```ts
const isPattern = (kind: string): boolean =>
  kind !== 'text' && kind !== 'image' && kind !== 'shape' && kind !== 'trim'
```

and `render.ts:103`

```ts
if (layer.hidden || !isPattern(layer.kind)) continue
```

The file's own header admits it (`render.ts:13-14`):

> Only the pattern batch runs here. Vector layers (text/image/shape/trim) need a
> 2D canvas and are out of scope for the headless path.

**RobloxKit** handles all thirteen. `render-CpljO1Hx.js`:

```js
var r = [`solid`,`gradient`,`stripes`,`checks`,`plaid`,`polka`,`zigzag`,`camo`,`noise`];  // PATTERNS
var l = [...r, `text`, `image`, `shape`, `trim`];                                          // LAYER_KINDS
```

`renderToCanvas` (`g`) batches consecutive pattern layers into one `renderPixels`
call, and for every non-pattern layer **flushes the batch and draws with canvas
2D** under `ctx.save() / rect / clip`:

- `text` — `ctx.font = weight size family`, `textAlign center`, `textBaseline middle`,
  multi-line split on `\n`, line height `size * 1.1`, optional `strokeText` outline
  with `lineWidth = max(2, size/10)`, `lineJoin round`, `maxWidth = w*0.96`.
- `image` — `await` an `Image`, `fit: 'cover'|other` via `Math.max`/`Math.min`,
  `scale`, drawn centred at `x,y` offsets.
- `shape` — `v(ctx, shape, cx, cy, w, h)` then `fill()`, optional `outline` stroke
  with `outlineWidth`. Six shapes: `rect`, `diamond`, `triangle`, `star`
  (10-point polygon, inner radius 0.45), `heart` (two beziers), else `ellipse`.
- `trim` — `fillRect` on the chosen edges, `width` thick.

**Consequence for the reported bug.** The user asked for
"baju kerajaan, dengan jubah". The model produced a design whose *entire* visual
identity was `trim` layers (gold seams, placket border, cuffs, hem) plus a `shape`
layer (the crown). Termul dropped every one of them. What survived was one
`solid` `#1a3a8f` and one `polka` — the flat blue shirt with white dots in the
screenshot. **The model did not design badly; the renderer threw its design away.**

The same drop also makes the loop dishonest: `coverage()` still reports ~100%
because the `solid` filled the sheet, so no warning fires and `report.ok` is
`true`. The model is told its design passed.

---

## DEFECT 2 — The model is shown the flat UV atlas, not the garment on an avatar

This is the single biggest quality lever and Termul does not have it at all.

**RobloxKit** `clothing-62l72JIa.js`, `clothingBuilder` (`N`):

```js
let c = await r.renderToCanvas(s, document.createElement(`canvas`));
let l = c.getContext(`2d`).getImageData(0, 0, c.width, c.height).data;
return {
  design: s,
  canvas: c,
  report: r.checkDesign(s, l),
  sheet: e ? r.renderClothingSheet({ [s.type]: c }, c, { rig: t, skin: n ?? r.SKIN_TONES[0].hex }) : null
};
```

`renderClothingSheet` (`avatarRender-DVeE1evW.js` `h`) builds a **three.js avatar**
(`buildAvatar`) wearing the generated textures, and composites a 4-panel strip:

```js
s.width = i * 4;              // i = 256  ->  1024
s.height = Math.round(i * 1.4); // 358
[[`front`, f.front], [`back`, f.back], [`left side`, f.left]].forEach(...)  // 3 poses
// panel 4 = the flat template, letterboxed
return s.toDataURL(`image/jpeg`, 0.85);
```

The review lead text says so (`clothing-62l72JIa.js` `S`):

```js
lead: t
  ? `Here is the design on the avatar (front, back, left side) and the flat template.`
  : `The renderer drew it (no picture: judge it from the description below).`
```

**Termul** `tools/generate-clothing.ts:111`:

```ts
lead: 'Here is the garment sheet you designed, laid out flat as Roblox maps it onto the body.',
```

and `loop.ts:186` sends `image: current.sheet` — the raw flat 585x559 atlas.

So Termul asks the model to judge "does this look like a royal robe?" by looking at
a UV unwrap. A model cannot see drape, proportion, or whether a motif sits on the
chest from an atlas. It says `DONE` because the atlas looks tidy. RobloxKit asks
the same question while showing the garment *on a body*.

`renderClothingThumbnail` (`m`) does the same for a single 3/4 view at 256px —
that is what gets saved as the collection thumbnail.

---

## DEFECT 3 — `checkDesign` is much weaker, so the loop never learns what is wrong

**RobloxKit** `design-PKArvEjc.js` `checkDesign` (`f`):

```js
if (n.type !== `tshirt`) {
  for (let e of t(n.type)) {                    // every region of the garment
    let t = 0;
    for (let n = e.y; n < e.y + e.h; n += 4)
      for (let a = e.x; a < e.x + e.w; a += 4)
        if (r[(n * i + a) * 4 + 3] > 16) t++;    // 4px grid sample
    let n = Math.ceil(e.h / 4) * Math.ceil(e.w / 4);
    if (t / n < 0.05) s.push(e.id);             // < 5% painted -> EMPTY
  }
  if (s.length) o.push({ level: `warn`, message: `${s.length} region${...} left empty, so the skin shows there: ${s.slice(0,8).join(', ')}${...}` });
}
if ((n.layers ?? []).filter(e => e.kind === `text` && Number(e.size ?? 32) < 10).length)
  o.push({ level: `warn`, message: `Some text is under 10 px and will be hard to read in game.` });
return { ok: !o.some(e => e.level === `error`), issues: o, size: [i, a], empty: s };
```

**Termul** `engines/clothing/build.ts:66-79` reports only whole-sheet coverage,
a distinct-colour count, and a layer-count notice. No per-region emptiness, no
small-text check, no `empty[]`, no `size` array.

So when a model leaves the sleeves bare, RobloxKit says
`"2 regions are left empty, so the skin shows there: right_arm_front, left_arm_front."`
and the model fixes it next round. Termul says nothing.

---

## DEFECT 4 — The review "layout" is a stats line instead of a layer description

**RobloxKit** `clothing-62l72JIa.js` `x` builds a readable per-layer listing:

```js
function x(e, t) {
  let n = e => {
    let t = [e.kind, `on ${e.target ?? `all`}`];
    if (e.text)  t.push(`"${e.text}"`);
    if (e.shape) t.push(e.shape);
    let n = [`color`,`color2`,`color3`,`from`,`to`].map(t => e[t]).filter(Boolean);
    if (n.length) t.push(n.join(`/`));
    if (e.x != null || e.y != null) t.push(`at ${e.x ?? 0.5},${e.y ?? 0.5}`);
    return t.join(` `);
  };
  return `\nLayers (bottom to top):\n${(e.layers ?? []).map((e, t) => `${t}. ${n(e)}`).join(`\n`)}${
    t.empty?.length ? `\nEmpty regions (skin shows): ${t.empty.join(`, `)}` : `\nEvery region is painted.`}`;
}
```

Example output: `1. trim on all #d4af37` / `Empty regions (skin shows): right_arm_up`.

**Termul** `build.ts:91-96` produces
`"Sheet 585x559, garment shirt. 4 layer(s). Painted 100.0% with 2 distinct colour(s). Regions: ..."`.

The RobloxKit form gives the model an exact, addressable inventory of its own
design plus the gaps. That is what makes a repair round productive.

---

## DEFECT 5 — The system prompt is invented, and it is biased toward flat designs

`engines/clothing/prompt.ts:4-8` is explicit:

> Re-authored rather than recovered: RobloxKit fetches this text from an
> auth-gated server (`GET /api/assets/*` → 401 on every path tested), so only the
> *contract* survived.

Confirmed independently: `re/full-reverse/02-clothing/REPORT.md:1385` —
"**The markdown body is not in** [the bundle]". The asset is
`prompts/clothing.md` (`serverAssets-p9XPPBjy.js:40`), fetched with a bearer token.
**It genuinely cannot be recovered**, so re-authoring is the correct call and must
stay. But the current text actively hurts:

- `prompt.ts:54` — "Prefer a few deliberate layers over many faint ones." Combined
  with Defect 1, "few layers" means "one solid plus one pattern" → flat shirt.
- Nothing tells the model that `trim` / `shape` / `text` are the tools for
  heraldry, seams, borders, cuffs, or motifs — because in Termul they do nothing.
- Nothing says the review image is an avatar view (because it is not).
- No worked example of a rich design.

**RobloxKit's own default design** (`render-CpljO1Hx.js` `f` / `newDesign`) is the
bar to clear — two layers, but a *deliberate* pairing:

```js
[{ id:`l1`, kind:`solid`,   target:`all`,                 color:`#e11d48` },
 { id:`l2`, kind:`stripes`, target:`torso`, color:`#ffffff`, color2:`#e11d48`, size:6, gap:26, angle:90 }]
```

---

## DEFECT 6 — No way to attach pictures, so `image` layers are uncallable

`buildClothing(spec, { type, images = 0 })` accepts an image count, but
`runClothingGeneration` (`tools/generate-clothing.ts:169`) calls
`buildClothing(spec, { type: args.type })` — `images` is never passed, and
`GenerateClothingArgs` has no `images` field. The tool schema
(`GENERATE_CLOTHING_INPUT_SCHEMA`) has only `prompt`, `type`, `design`.

RobloxKit's `attachImages` (`design-PKArvEjc.js` `d`) rewrites `image: n` into
`src: urls[n]`, and `renderToCanvas` awaits each `Image` before drawing. The
validator's error text even branches on the count:
`an image layer needs "image": the number of an attached picture (0..N-1)`.

---

## DEFECT 7 — Upload: RobloxKit does not upload, and Termul gives the agent no path at all

**This is the "harness struggles to upload" bug, and it is a design bug, not an
agent bug.**

**RobloxKit** `clothing-62l72JIa.js` exports `UPLOAD_GUIDE` (`Y`):

```js
var Y = {
  shirt:  { label: `Classic Shirts`, url: `https://create.roblox.com/dashboard/creations?activeTab=Shirt` },
  pants:  { label: `Classic Pants`,  url: `https://create.roblox.com/dashboard/creations?activeTab=Pants` },
  tshirt: { label: `T-Shirts`,       url: `https://create.roblox.com/dashboard/creations?activeTab=TShirt` }
};
```

and `saveClothingPng` (`J`):

```js
async function J(e) {
  let t = await (await M()).renderPng(c(e).design);   // renderPng = canvas -> toBlob('image/png')
  return f(`clothing`, { [`${q(e)}.png`]: t });        // f = the file-save helper
}
```

So RobloxKit's "upload" is: **render a PNG, save it to disk under a slugged
filename, and hand the user the Creator Dashboard deep link for that garment
type.** There is no asset API call, no `upload_image`, no local HTTP server, no
Studio plugin hand-off. The human finishes the upload in the browser.

`ClothingPanel-CEM_quBl.js` states the policy outright, in the "Use it" tab:

> **Use it** — *"Roblox does not let apps publish classic clothing: the upload is
> yours."*
>
> - `Save PNG to workspace` → *"Saved Documents/RobloxKit/&lt;name&gt;.png."*
> - `Open Creator Dashboard`
> - Steps: "Save the PNG." / "In the Creator Dashboard open Avatar Items → Classic
>   Shirts." / "Upload the PNG, name it, and pay the upload fee (t-shirts are free
>   to upload)." / "Roblox reviews it; then set a price and put it on sale."

And the per-type "About this type" panel:

> Made of: *Patterns, text, shapes, trims, your pictures*
> Upload: *By you, in the Creator Dashboard*

Two things to carry over verbatim: the **policy** ("the upload is yours, and here
is why") and the **file location** (`Documents/RobloxKit/<name>.png`, i.e. a real
path the human can open). Note also that "Made of" names *text, shapes, trims* —
the four kinds Termul drops (Defect 1). RobloxKit advertises them as the product.

**Termul** instead tells the agent (`generator_tools.rs`, `GENERATOR_GUIDE`):

> Do not write .lua files, .obj files or image files to disk to stand in for an
> asset […] these tools produce the artifact and hand it back.

and `task_tool()`:

> Nothing is written to disk, so do not search the filesystem for an output file.

Both statements are true and both are a dead end. The agent is forbidden from
writing a file, given no file, and given no URL. It therefore invented a route:
it found the adapter's own blob dump
(`~/.claude/projects/<slug>/<uuid>/tool-results/mcp-termul-blob-*.png` — written
by the ACP adapter for large tool results, **not** by Termul), started
`python -m http.server 8765` to make it fetchable, called the *Roblox Studio MCP*
`upload_image` with an `http://localhost` URL, got `rbxassetid://81011940726608`,
then guessed wrong about `Shirt` vs `Decal` vs `ShirtTemplate`, tried
`start_stop_play` + `screen_capture`, got a blank frame, and looped. 5m05s,
"needs attention".

The fix is to port `UPLOAD_GUIDE` and `saveClothingPng`:
1. give the agent the per-type dashboard URL verbatim, and
2. actually write the PNG to the project directory and return its absolute path,
   so "upload this file" is a real instruction instead of an impossible one.

And to port the *policy sentence* into the generator guide, because it is the
thing that stops an agent improvising: **"Roblox does not let apps publish classic
clothing; the upload is the user's."** An agent that knows the boundary does not
go hunting for `upload_image`, does not start an HTTP server, and does not guess
about `ShirtTemplate`.

---

## DEFECT 8 — The generator silently runs on the wrong harness

`src/renderer/lib/generator/agent-selection.ts:34-57`:

```ts
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
```

The last line is the bug. `live` is `configToLiveAgent`, which only contains
agents that have actually been **spawned in this window**. If the user selected
Claude Code but no Claude process is live yet while an OpenCode process is, then
`live[selected]` is `undefined`, `live[CLAUDE_AGENT_CONFIG_ID]` is `undefined`,
and the function returns **whatever agent happens to be live — OpenCode** — with
no error and no log.

That matches the screenshots exactly: the user selected Claude Code, and the
generator's ephemeral sessions (`acp-brain-transport.ts:59`,
`acpNewSession(agentId, cwd, [], { ephemeral: true, promotable: false })`) show up
titled "Roblox shirt design fix" etc. in **OpenCode's** session list.

Two aggravating factors:
- `acp-brain-transport.ts:59` passes `options.cwd`, and the cwd comes from the
  generator gateway, so the sessions are created in the *Roblox project* directory
  — which is why OpenCode lists them alongside the user's own work.
- Nothing surfaces which agent answered. `onStage` says
  `` `${brainLabel(options)} is ${stage}` `` where `brainLabel` is `options.brain.id`
  — a runtime id, not a human name, and it is only a stage detail.

The correct behaviour: if a specific agent was selected, **use it or fail loudly**.
Never silently substitute a different harness for a user-visible, billable action.

---

## What a faithful port must do — checklist

**Renderer**
- [ ] `render.ts` becomes the two-pass renderer: batch pattern kinds through
      `renderPixels`, then flush and draw `text` / `image` / `shape` / `trim` with
      canvas 2D under `save()/rect()/clip()/restore()`, exactly as
      `render-CpljO1Hx.js` `g` does.
- [ ] Implement `shapePath` (`v`) for all six shapes.
- [ ] `renderToCanvas` returns a canvas; `pngDataUrl` becomes `canvas.toDataURL`.
- [ ] Keep a pure `renderPixels` for determinism tests (pattern-only designs).

**Feedback**
- [ ] Add `checkDesign` with the 4px-grid per-region emptiness scan, the
      `empty[]` list, the `<10px` text warning, and `size: [w, h]`.
- [ ] Add the per-layer textual `layout` from `x`, including
      `Empty regions (skin shows): …`.
- [ ] Render the review image as the **avatar sheet** (front / back / left side /
      template, 4 panels, JPEG 0.85) and change the review `lead` to match.
      If a three.js avatar is too much for this step, the minimum viable version
      is a composited panel strip that at least shows the garment as worn
      proportions — but the avatar is what RobloxKit ships and what makes the
      review meaningful.

**Prompt**
- [ ] Rewrite `CLOTHING_SYSTEM_PROMPT` to (a) name `trim`/`shape`/`text` as the
      tools for seams, borders, cuffs, heraldry and motifs, (b) say the review
      image shows the garment on an avatar, (c) drop or qualify
      "prefer a few deliberate layers", (d) carry one rich worked example.

**Tool surface**
- [ ] Port `UPLOAD_GUIDE` verbatim into the generator guide and the task tool
      description.
- [ ] Write the PNG to disk (`<project>/.termul/generated/clothing/<slug>.png` or
      similar) and return the absolute path in the result envelope.
- [ ] Replace "Nothing is written to disk, so do not search the filesystem" with
      the real path plus the dashboard URL.
- [ ] Add `images` to the tool schema and thread it into `buildClothing`.

**Routing**
- [ ] `resolveGeneratorAgent` must not fall back to an arbitrary live agent.
      Return `null` (and let the caller report it) when the selected agent is not
      live, or spawn it.

## Still unknown

- The body of `prompts/clothing.md`. Auth-gated, confirmed absent from the
  bundle. Re-authoring is unavoidable; the checklist above is the contract it
  must express.
- Whether the reported "opencode" routing is the `Object.values(live).find` line
  or a stale `session.agentId`. Both are consistent with the screenshots; the
  fallback line is wrong either way and must go.
