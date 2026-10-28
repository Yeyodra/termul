# RobloxKit Generative Tool Surface — Full Source Recovery Playbook

> **Where this file lives, and why.** Written into `termul/.omo/` because the
> planning session is restricted to `.omo/*.md` inside this workspace. Move it to
> `Robloxkit/.omo/re-rebuild/` (or `Robloxkit/docs/`) when you start the new
> session there.
>
> **Purpose.** Everything a new session needs to reverse-engineer and rebuild
> RobloxKit's 93-tool agent surface — especially the 10 generative engines
> (clothing, SFX, 3D, texture, skybox, icons, VFX, GFX, cutscene, animation) —
> from artifacts **already on this machine**.
>
> **Status.** Written 2026-10-26 from direct file reads. Every claim carries a
> `file:line` or a quoted snippet. Anything unverified is marked **UNVERIFIED** or
> **UNKNOWN** with what evidence would settle it.

---

## 0. Related docs

| Doc | What |
|---|---|
| `Robloxkit/AGENTS.md` | The RE project's own permanent context — read first |
| `Robloxkit/artifacts/generative-specs.md` | Raw spec extraction (image, sfx, 3D, textures, skybox, icons, gfx, cutscene, animation) |
| `Robloxkit/artifacts/mcp-tools-robloxkit.md` | All 93 tool definitions with schemas |
| `Robloxkit/artifacts/frontend_unmin/` | **Unminified** bundles — the goldmine |
| `Robloxkit/artifacts/frontend_src/_INDEX.txt` | Exact byte sizes per bundle |
| `Robloxkit/artifacts/strings.txt` | Rust-side names with no JS counterpart |
| `termul/.omo/roblox-re/` | Parallel Termul-side RE (why the agent can't use these tools) |

---

## 1. The one thing to understand first

RobloxKit's 93 tools are **not** 93 implementations. They are five layers:

| Layer | What it is | Where the code lives |
|---|---|---|
| **Tool registry** | 93 `{name, description, parameters}`, feature-gated | frontend bundle `index-DPVV2ya5.js` (minified) → extracted to `artifacts/mcp-tools-robloxkit.md` |
| **Orchestration** | `runAgent()` — one shared multi-round LLM loop every engine calls | `frontend_unmin/gen3d-BAdfthxw.js` (19,272 B) |
| **Engines** | Actual rendering/synthesis. JS or Rust | `frontend_unmin/` per-engine files + Rust crates inside the EXE |
| **Assets** | Prompt markdown, skill markdown, presets, templates | **fetched from RobloxKit's server** via `/api/assets/...` — NOT in the repo |
| **Studio bridge** | The 28 StudioMCP tools | Roblox's own `StudioMCP.exe`, not RobloxKit |

**The critical split:** engines are ~90% recoverable. The **prompts and skills are
not** — they live on RobloxKit's server. That single fact decides the rebuild
strategy (see §4 and §7).

---

## 2. Verified inventory on disk

`artifacts/frontend_unmin/` — **100+ unminified bundles**. Confirmed present by glob:

| Engine | Orchestration | Size (min, B) | Renderer | Size (min, B) |
|---|---|---|---|---|
| shared LLM loop | `gen3d-BAdfthxw.js` | 19,272 | — | — |
| **clothing** | `clothing-62l72JIa.js` | 8,001 | `render-CpljO1Hx.js` | 6,555 |
| clothing UI | `ClothingPanel-CEM_quBl.js` | 30,353 | `dress-BYq-kZya.js` | 2,134 |
| **3D** | `gen3d-BAdfthxw.js` | 19,272 | `engine-DoiMMBHL.js` | 9,321 |
| **texture** | `textures-Dx9L9-nO.js` | 10,617 | `spec-CXEevNJ1.js` + `worker-BsRVankJ.js` | 8,167 + 18,972 |
| **skybox** | `skybox-DQ303r0h.js` | 11,468 | `spec-I-uj902h.js` + `worker-CMNq6f94.js` | 10,659 + 9,264 |
| **icons** | `icons-BpUOWggy.js` | 9,414 | `spec-Dep-KogR.js` | 11,159 |
| **VFX** | `vfx-Dbgg4Adn.js` | 8,362 | `spec-riUWHJI8.js` | 6,176 |
| **GFX** | `gfx-CVkb5YLh.js` | 10,520 | `render-5SirYDKt.js` | **64,649** |
| **cutscene** | `cutscenes-ByeUHDHa.js` | 49,342 | `spec-C4IiZFjc.js` | 11,758 |
| **animation** | `animations-t4fuf2vl.js` | 31,930 | `spec-BTlAZ_6S.js` | 8,961 |
| **SFX** | `sfx-C9VkZ_Hq.js` | 9,588 | (Rust) | — |
| **music** | `music-DejM99vB.js` | 30,956 | — | — |
| shared drawing | `draw-DnDxxJ0_.js` | 13,234 | `render-CzBncmsu.js` / `render-D__CO5co.js` / `render-Ej67xP5V.js` | 2,393 / 5,222 / 16,921 |
| avatar/rig | `robloxAvatar-5ba9uOrj.js` | — | `avatarRender-DVeE1evW.js`, `rig-P29m_B-3.js`, `rig-CDpj6dii.js`, `rigPose-DgicNbzf.js` | 1,816 / — / — / — |
| spec validators | `spec-D11M_y_m.js` (18,347), `spec-DKgnETjI.js` (6,410) | — | — | — |

Sizes from `artifacts/frontend_src/_INDEX.txt` (minified originals); the
`frontend_unmin/` copies are larger and human-readable.

> **Naming caution.** File hashes differ between the two trees. `frontend_src/` has
> `engine-DoiMMBHL.js`; confirm the unmin counterpart by globbing, not by assuming
> the hash matches.

---

## 3. The shared engine loop — read this before any engine

Every generative tool funnels through one function. Reverse it once and all 10
engines become variations. From `clothing-62l72JIa.js:111-144`:

```js
let { result: _, built: S, notes: C, modelName: w } = await m({
  action: `clothing`,
  system: v(),                    // system prompt markdown (server-fetched)
  first: { text: b({...}), image: g[0] },
  prompt: e,
  what: `design`,
  normalize: e => { e.type = t; return e; },
  build: e => l(e, g),            // spec -> canvas/artifact
  review: (e, t) => ({ lead, facts, layout }),
  brain: i, provider: a, token: o, signal: s, scope: c,
  onStage: u, rounds: d = 2, vision: f = true
});
```

Four UI stages (`clothing-62l72JIa.js:272-277`):

```js
var I = { designing: `Designing`, building: `Drawing`,
          checking: `Checking`,  fixing: `Fixing` };
```

**The `rounds: 2` + `vision: true` combination is the self-correcting loop:** the
model authors a spec, the engine renders it, the model is shown the render and
asked to fix it. That pattern is repeated across engines and is the single most
important behaviour to port faithfully.

---

## 4. The server dependency — what is irrecoverable

`frontend_unmin/serverAssets-p9XPPBjy.js` maps bundle ids → file lists. Confirmed:

```
acp/system            -> acp/rules.md
tools/catalog         -> tools/catalog.json, tools/instructions.md
prompts/chat          -> prompts/chat.md
prompts/compact       -> prompts/compact.md
prompts/clothing      -> prompts/clothing.md
prompts/3d            -> prompts/3d/system.md, prompts/3d/rig.json,
                         prompts/3d/categories.json, prompts/image-spec.md
prompts/polyforge     -> prompts/polyforge/{common,checklist,kinds.json,kit-api}
                         + examples/{chibi-claude,chibi-ghost,dullahan,
                                     ghost-octopus,suv-car}.txt
prompts/vfx           -> prompts/vfx.md, prompts/vfx-texture.json,
                         prompts/guides/roblox-vfx.md, prompts/image-spec.md
prompts/gfx           -> prompts/gfx.md, prompts/guides/roblox-gfx.md
prompts/icons         -> prompts/icons.md, prompts/guides/roblox-icons.md
prompts/sfx           -> prompts/sfx.md, prompts/guides/roblox-sfx.md
prompts/cutscene      -> prompts/cutscene.md, prompts/guides/roblox-cutscenes.md
prompts/animation     -> prompts/animation.md, prompts/guides/roblox-animation.md
prompts/skybox        -> prompts/skybox.md, prompts/guides/roblox-skybox.md
prompts/texture       -> prompts/texture.md, prompts/guides/roblox-texturing.md
prompts/texturing     -> prompts/guides/roblox-texturing.md
prompts/music         -> prompts/music.md
skills/*              -> 16 skill markdown files
```

**None of these bodies are in the repo.** They are fetched at runtime from
`${baseUrl}/api/assets/<bundle>/<file>` (the `p()` function in that same file). The
repo has the **index**, not the **content**.

### Recoverable vs must-rewrite

| Recoverable without the server | Must be re-authored |
|---|---|
| Spec schema + validator | System prompt |
| Render/synthesis pipeline | Few-shot examples |
| Prompt **builder** (the JS assembling the message) | Guide markdown (`prompts/guides/*`) |
| Multi-round loop + review logic | Skill bodies |
| Output format + export path | Some preset/template JSON |

**Consequence:** you can rebuild every engine's machinery, but you must re-author the
prompts. That is not a blocker — it is arguably an improvement, because you can write
them for Luau/Roblox directly instead of RobloxKit's intermediate spec.

---

## 5. Tool → feature → engine map

From `frontend_unmin/_TOOLFEATURES.txt` (86 entries, 13 gate keys) — verbatim:

```
assets (4)        upload_asset, asset_status, upload_gfx, list_music
gen_anim (3)      list_animations, create_animation, insert_animation
gen_clothing (4)  list_clothing_collection, generate_clothing, edit_clothing, get_clothing
gen_cutscene (3)  list_cutscenes, generate_cutscene, insert_cutscene
gen_gfx (4)       list_gfx_collection, get_gfx, generate_gfx, edit_gfx
gen_icons (6)     list_icon_collection, get_icon, generate_icon, generate_icon_set,
                  edit_icon, send_icon_to_studio
gen_sfx (5)       list_sfx_collection, get_sfx, generate_sfx, edit_sfx, send_sfx_to_studio
gen_skybox (2)    list_skyboxes, generate_skybox
gen_texture (2)   list_textures, generate_texture
gen_vfx (5)       list_vfx_collection, get_vfx, generate_vfx, edit_vfx, send_vfx_to_studio
read_roblox (6)   get_experience, list_user_restrictions, list_datastores,
                  list_datastore_entries, get_datastore_entry, list_entry_revisions
studio_tools (33) list_skills, read_skill, list_open_places, attach_place, detach_place,
                  copy_between_places, plan_teleport, search_game_tree, inspect_instance,
                  read_console, execute_luau, list_scripts, read_script, edit_script,
                  capture_viewport, studio_state, list_files, read_file, write_file,
                  delete_file, read_image, slice_image, resize_image, image_render,
                  image_edit, image_info, image_atlas, image_spec, spawn_task,
                  list_tasks, get_task_result, cancel_task, insert_music
write_roblox (9)  update_experience, update_place, restart_servers, publish_message,
                  ban_user, unban_user, set_datastore_entry, delete_datastore_entry,
                  publish_place
```

Note `studio_tools (33)` contains the four `image_*` and four `spawn_task` tools — the
Rust image engine is gated behind the same feature as Studio editing.

---

## 6. Clothing worked example (the reference implementation)

Clothing is the most complete engine, so treat it as the template.

### 6.1 Design schema

Layer fields observed in the prompt formatter (`clothing-62l72JIa.js:62-83`):

```
kind, target, text, shape, color, color2, color3, from, to, x, y
```

Clothing types (`clothing-62l72JIa.js:12-16`):

```js
var _ = { shirt: `Shirt`, pants: `Pants`, tshirt: `T-Shirt` };
```

### 6.2 Image dedup (a real optimisation worth copying)

`clothing-62l72JIa.js:20-46` — every `{kind:'image', src}` layer is rewritten to
`{image: <index>}` pointing into a flat `images[]` array, deduplicated:

```js
if (e.kind !== `image` || !e.src) return e;
let i = n.indexOf(t); if (i < 0) i = n.push(t) - 1;
return { ...r, image: i };
```

This keeps the LLM payload small when the same reference picture is reused.

### 6.3 Prompt builder (verbatim, `:47-61`)

```js
n ? `Change this design as asked, keeping everything else. Return the whole updated design.

Current design:
\`\`\`json
${JSON.stringify(n)}
\`\`\`

Change: ${e}`
  : `Design a ${_[t] ?? t}: ${e}`
```
plus, when pictures are attached:
```
The user attached N picture(s) (the first is shown with this message).
Put them on the clothing with image layers ("image": 0, 1, …).
```
and finally `Type: ${t}.`

### 6.4 Build pipeline (`:213-244`)

```
validateDesign(design, {images: n})   -> throws with .problems[] on failure
attachImages(design, images)
renderToCanvas(design, canvas)        -> HTMLCanvasElement
checkDesign(design, imageData)        -> {ok, issues[]}
renderClothingSheet({[type]: canvas}, canvas, {rig:'R15', skin})
renderClothingThumbnail({[type]: canvas}, {rig, skin})
```

### 6.5 The 9 pattern kinds (`render-CpljO1Hx.js:3`)

```js
var r = [`solid`, `gradient`, `stripes`, `checks`, `plaid`,
         `polka`, `zigzag`, `camo`, `noise`];
```

Seeded PRNG is mulberry32 (`render-CpljO1Hx.js:4-13`); 2D value-noise with
smoothstep interpolation (`:14-35`). Colour lerp at `:36`.

---

## 7. Recommended rebuild order, and why

Do **not** start with the biggest engine. Start where (recovered code) ÷ (missing
prompt) is best.

| Order | Engine | Why | Self-contained? |
|---|---|---|---|
| 1 | **Clothing** | Most complete: orchestration + 394-line renderer + validator + avatar preview all present. Output is a PNG — easy to verify. | ~90% (needs `prompts/clothing.md`) |
| 2 | **Icons** | SVG output, no raster, no three.js. | ~85% |
| 3 | **Image (Rust)** | Spec documented in extreme detail in `generative-specs.md`; pure spec→pixels, no LLM round-trip beyond authoring. | ~70% (Rust source absent) |
| 4 | **SFX** | Rust synth; param names recoverable from `strings.txt`. Verifiable by ear + spectrogram. | ~70% |
| 5 | **Texture** | Self-contained algorithm; worker protocol must be mapped. | ~85% |
| 6 | **Skybox** | Same worker pattern, 6 faces. | ~85% |
| 7 | **VFX** | Spec + guides; render path partly shared with GFX. | ~75% |
| 8 | **GFX** | `render-5SirYDKt.js` is 64 KB — largest renderer. three.js avatar. | ~70% |
| 9 | **Animation** | 31 KB orchestration + rig binding; needs a working R15 rig. | ~65% |
| 10 | **Cutscene** | 49 KB — most complex. Depends on animation + 3D. | ~60% |
| 11 | **3D (GLB)** | three.js + CSG in-process. Heaviest runtime dependency. | ~60% |
| 12 | **Music** | Depends on `ytdl_*` (external binary) + mixer. Least portable. | ~50% |

**Sequencing rule:** 1–6 are independently shippable and give real user value.
7–12 share machinery and should be batched once the shared `runAgent` port exists.

---

## 8. The blocker that outranks all of this

Before any of the above is useful, the agent must be able to **call** tools at all.

In Termul, Claude Code currently **defers** MCP tools behind `ToolSearch` — 84
deferred in the observed session, the 28 Studio tools left schema-less. A perfect
93-tool rebuild would sit unused for Claude users.

- Mechanism and evidence: `termul/.omo/roblox-re/06-root-cause-verdict.md`
- Correction to the first fix attempt (key is `_meta['anthropic/alwaysLoad']`; a
  **server-level** `alwaysLoad` may make a proxy unnecessary):
  `termul/.omo/roblox-re/08-correction-alwaysLoad.md`
- OpenCode calls the tools immediately with no help:
  `termul/.omo/roblox-re/07-opencode-baseline.md`

**So:** fix tool loading first (cheap — ~20 lines if the server-level flag works),
then rebuild engines. Reversing 93 tools while the agent cannot invoke them is
wasted effort.

---

## 9. Method notes for the new session

### Where to look, in priority order

1. `artifacts/frontend_unmin/` — **always prefer over `frontend_src/`**. Unminified
   means real variable names and readable control flow.
2. `artifacts/frontend_src/_INDEX.txt` — byte sizes; the biggest file in a subsystem
   is usually the real engine.
3. `artifacts/generative-specs.md` — the Rust image + SFX spec already written out.
4. `artifacts/mcp-tools-robloxkit.md` — every tool's description + parameters.
5. `artifacts/strings.txt` — Rust-side names with no JS counterpart.

### Traps this project already paid for

1. **String scans give false negatives.** `GAPS.md` documents that runtime-built keys
   are invisible to `strings`. `mcpServers` returned 0 hits while being the actual
   mechanism. Never conclude "absent" from a 0-hit grep.
2. **File hashes drift** between `frontend_src/` and `frontend_unmin/`. Glob by name
   prefix, not hash.
3. **The `.md` asset bodies are genuinely absent.** Do not hunt for
   `prompts/clothing.md` on disk — it is server-side. The index in
   `serverAssets-p9XPPBjy.js` is the only local trace.
4. **`artifacts/plugin_src/` is a red herring.** Those 44 Lua files belong to the
   third-party `@chrrxs/robloxstudio-mcp` plugin, which is **not** on RobloxKit's
   path (`AGENTS.md` §2 correction).
5. **Rust engine source is absent** — only strings. Rebuilding `image-engine` or the
   SFX synth means writing from the spec, not porting.

### How to verify a rebuild is faithful

Determinism is the test. Same input must produce byte-identical output:

| Engine | Verification |
|---|---|
| clothing | render same design JSON twice → identical PNG bytes (seeded PRNG) |
| icons | same spec → same SVG path data |
| image | same spec + seed → pixel-identical |
| sfx | same spec → identical sample-buffer hash |
| texture/skybox | worker in → same bitmap out |
| 3D | same spec → same triangle count + bounding box |

If a rebuild needs a seed to match, seed handling is part of the spec and must be
recovered too.

---

## 10. Honest gaps in this document

- The per-engine deep dives (being written to `Robloxkit/.omo/re-rebuild/01..05`) are
  produced by parallel subagents. **Treat them as claims** until you spot-check a
  quoted `file:line` yourself.
- I have not read `engine-DoiMMBHL.js` (3D/GLB) or `render-5SirYDKt.js` (GFX, 64 KB)
  line by line — the two largest unknowns.
- The Rust side (`image-engine`, `src/sfx/synth.rs`) is reconstructed from strings and
  `generative-specs.md`, **not** from source. Algorithm claims there are inference.
- The registry is 93 tools in `mcp-tools-robloxkit.md` but `_TOOLFEATURES.txt` lists
  86. The difference is likely feature-gated hidden tools. Flagged, not resolved.
- I did not verify that the unminified copies are complete (no truncation) for the
  largest files.
