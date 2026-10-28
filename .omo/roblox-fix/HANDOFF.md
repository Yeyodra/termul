# HANDOFF — Termul generator: PNG path + global viewport

> **This file is the source of truth if the session context is lost.**
> Read it top to bottom before doing anything. Then read the reports it links.
> Update it at the end of every work block. Never let it go stale.

Last updated: session 3, after Rust build of the PNG save path succeeded.

---

## 1. The goal (user's words, condensed)

Two things, in this order:

1. **Finish the PNG path.** A generated garment must become a real file on disk, and
   the tool reply must say where it is. No more "the picture exists only in the
   transcript".
2. **Then build a global 3D viewport.** Modelled on RobloxKit's flow:
   generate → review/double-check → **capture** → show the result **in the chat
   session as a 3D viewport** (orbit, grid, lighting, R15/R6, Avatar/Template
   toggle). **Not clothing-only** — any artifact kind must be able to show up
   there, so the viewport is a shared component, not a clothing panel feature.

Constraints the user stated explicitly:

- Port from RobloxKit; do not invent. If something is an improvement, label it as
  an improvement in the commit message.
- Reports must be written as `.md` files so nothing gets truncated.
- Full E2E test required, not just unit tests.
- The user is asleep; work autonomously to completion.

## 2. Ground truth locations

| What | Path |
| --- | --- |
| Termul repo | `C:\Users\Novella\Documents\Github\termul` (branch `dev`) |
| RobloxKit unminified bundle | `C:\Users\Novella\Documents\Github\Robloxkit\artifacts\frontend_unmin\` |
| These reports | `C:\Users\Novella\Documents\Github\termul\.omo\roblox-fix\` |
| Temp scratch | `C:\Users\Novella\AppData\Local\Temp\opencode` |

The unminified bundle is stronger evidence than the earlier RE reports. Prefer it.

## 3. Reports in this folder

| File | What it answers |
| --- | --- |
| `00-ROOT-CAUSE.md` | 8 defects in the original generator, with bundle citations |
| `01-robloxkit-clothing-design.md` | 136 KB — the clothing design system |
| `02-robloxkit-upload-path.md` | 14 KB — why RobloxKit never uploads, and what it does instead |
| `03-termul-generator-current-state.md` | 104 KB — Termul's generator as it stood |
| `04-termul-harness-and-upload-bugs.md` | 42 KB — routing + upload bugs |
| `05-robloxkit-viewport-system.md` | **explorer output** — the global viewport system |
| `06-robloxkit-capture-and-chat-embed.md` | **explorer output** — capture → chat embed |
| `07-termul-chat-artifact-rendering.md` | **explorer output** — where to mount the viewport |
| `HANDOFF.md` | this file |

## 4. What is already done (7 commits on `dev`, all green)

All of these are committed and verified:

- `cc809b5f` **fix(generator): draw every clothing layer kind, and say what is missing**
  Root cause of ugly garments: `render.ts`'s `isPattern()` silently dropped
  `text`/`image`/`shape`/`trim` — 4 of 13 `LAYER_KINDS`. Royal-robe designs are
  built from `trim` + `shape`, so almost nothing rendered, while `coverage()`
  still reported ~100% and the loop said "passed". Fixed with a two-pass
  compositor; added `shapes.ts`, `vector.ts`, `check.ts`, `report.ts`.
- `83872d4c` **fix(generator): run on the agent that asked, not on any agent that is live**
  `configToLiveAgent` is keyed `agentReuseKey(configId, cwd, projectId)` =
  `configId\0cwd`, so a bare `live[selected]` lookup could never match and
  resolution fell through to `Object.values(live).find(id => !!id)` — any live
  agent. Added `liveForConfig()`, `GeneratorAgentHint`, deleted the wildcard
  fallback.
- `8983838a` **fix(generator): describe the artifact the model actually gets, and stop it hunting for a file**
  `get_info` returns empty; instructions arrive via `initialize`
  (`child.rs:461` `.with_instructions(...)`). Rewrote `task_tool()` description
  and `GENERATOR_GUIDE`.
- `de9c4faf` **feat(generator): teach the prompt the kinds and regions the renderer has**
- `ed0f2b04` **feat(generator): show the garment on an avatar, not as a flat atlas**
  `three@0.186.1`; `avatar/rig.ts`, `avatar/avatar.ts`, `avatar/sheet.ts`.
  `sheet` = avatar strip (what the model sees), `template` = flat atlas.
- `59d5cc33` **fix(generator): map each sleeve to its own atlas rectangle**

Verified: 176 renderer generator tests, 33 Rust generator tests, clippy,
typecheck ×3, biome. Rendered a real royal-robe design and visually inspected it.
Avatar review sheet rendered in Chromium and visually inspected.

## 5. The work in progress: PNG path (uncommitted)

**Design decision — read this before touching it.**

The renderer cannot write the project folder. The host can. So:

1. `readClothingResult` puts the flat atlas in the reply as `atlas`
   (`data:image/png;base64,...`), plus `kind` and `name` for the file name.
   File: `src/renderer/lib/generator/tools/generate-clothing.ts`.
2. The Rust router intercepts a successful generator reply and writes the bytes
   through `canvas_policy::write_project_file` — the same hardened path the
   canvas export uses (canonicalize, symlink refusal, atomic replace). It then
   replaces `atlas` with `save: {saved, path, relative, reason}`.
   File: `src-tauri/src/acp/host_mcp/parent/generator.rs`
   (`save_generated_garment`, `garment_path`, `slug`, `decode_data_url`).
3. `generator_result` drops `atlas` before the model sees the reply, so the
   bytes never enter the transcript twice.
   File: `src-tauri/src/acp/host_mcp/child.rs`.
4. Guidance text updated to match: `DESCRIPTION_TAG`, `GENERATOR_GUIDE`,
   `task_tool` in `src-tauri/src/acp/host_mcp/generator_tools.rs`.

Supporting change: `SessionScope` and `scope_of()` in
`src-tauri/src/acp/host_mcp/parent/canvas.rs` are now `pub(super)` so the
generator router can ask which project a session belongs to.

Target path: `.termul/generated/<kind>/<slug>.png` inside the project, mirroring
RobloxKit's `Documents/RobloxKit/clothing/<slug>.png`.

**A failed write is not a failed generation.** The picture was already handed to
the model; the result comes back unchanged with `save.saved: false` and a reason.

Status: `cargo build` **succeeded** (8m15s, after this code was written).
Tests for the new helpers are **not written yet**. Nothing is committed.

## 6. RobloxKit facts already established (do not re-derive)

### Template names and sizes

| Kind | RobloxKit label | Size | Source |
| --- | --- | --- | --- |
| `shirt` | Classic Shirt template | 585×559 | `ClothingPanel-CEM_quBl.js:93` |
| `pants` | Classic Pants template | 585×559 | `ClothingPanel-CEM_quBl.js:99` |
| `tshirt` | T-Shirt (not classic) | 512×512 | `ClothingPanel-CEM_quBl.js:104` |

Termul already matches exactly (`SHEET_DIMENSIONS`, `layout.ts:29`).

### The character is procedural — there is no template file

RobloxKit loads no `.rbxm` or avatar asset. `buildAvatar`
(`avatar-CSK-yHJ2.js:158`) builds blocky boxes in three.js:

- Torso 2×2×1 at `[0,3,0]`; arms 1×2×1 at `[±1.5,3,0]`; legs 1×2×1 at `[±0.5,1,0]`
- Head `RoundedBoxGeometry(1.2,1.2,1.2,4,0.28)`
- Face is drawn on a 128×128 canvas (two ellipses + a smile arc), not a texture
- Skin default `#eab892`; 7 tones offered
- R15 splits a box into segments so the texture does not stretch:
  torso 0.8/0.2, arm 0.45/0.4/0.15, leg 0.43/0.42/0.15, inset 0.015

All of this is already ported into `avatar/rig.ts` and `avatar/avatar.ts`.

### Two different things the user's screenshots show

- **Screenshot 1** (3 poses + letterboxed template) = `renderClothingSheet`
  (`avatarRender-DVeE1evW.js`). Already ported → `avatar/sheet.ts`.
  FOV 30, distance 12.5, target `[0,2.75,0]`, JPEG 0.85, cell 256, strip 1024×358,
  backdrop `#101113`.
- **Screenshot 2** (interactive viewport) = `Preview3D` → `Viewport-D1Bi_VWL.js`.
  **Not built yet.** Known values:
  - `PerspectiveCamera(38, 1, 0.05, 2000)` at `(6,4,10)`
  - `HemisphereLight(0xF4F4F5, 0x16181B, 1.6)`
  - `DirectionalLight(0xFFFFFF, 2.2)` at `(4,9,6)`
  - `DirectionalLight(0x9FB4FF, 0.6)` at `(-6,4,-5)`
  - Infinite grid shader, color `#8A8F99`, `uFade 60`, rotated `-π/2`
  - Floor `#1B1D21`, opacity 0.85, default hidden
  - OrbitControls with `autoRotateSpeed 1.6`
  - Panel passes `target:[0,2.75,0]`, `radius:3.1`,
    directions `{front:[0,0.12,1], back:[0,0.12,-1], "3/4":[0.65,0.22,1]}`

### Upload policy (settled, do not revisit)

RobloxKit does **not** upload clothing. `UPLOAD_GUIDE` is dashboard deep links
and `ClothingPanel` says *"Roblox does not let apps publish classic clothing:
the upload is yours."* An image upload returns a Decal, not a Shirt. The PNG is
written to disk from a UI button only, and the path never reaches the agent —
which is why writing it from the tool is a **labelled improvement**, not a port.

## 7. Roadmap after the PNG path

1. Commit the PNG path with tests (Rust unit tests for `garment_path`, `slug`,
   `decode_data_url`, and the save envelope).
2. Read reports 05/06/07 once the explorers finish.
3. Build the global viewport: `src/renderer/lib/generator/viewport/` —
   renderer core, React wrapper, grid shader, controls, dispose.
4. Mount it in the chat transcript so a finished artifact renders as a live
   viewport, with a static image fallback for when WebGL is unavailable.
5. E2E: launch the app, generate through a real agent, confirm both the PNG on
   disk and the viewport in the session.

## 8. Environment gotchas (these have cost time before)

- PowerShell 5.1: no heredocs. **Backticks and `${...}` inside template literals
  get eaten** by the shell. For any content containing backticks, use the
  `write`/`edit` tools, never `-replace` or `Set-Content`.
- `Stop-Process termul-manager` before `cargo build`, or the linker cannot
  replace `target\debug\termul-manager.exe`.
- `Set-Content -Encoding utf8` on PS 5.1 writes a BOM. Earlier commits have a BOM
  in the subject line (`﻿feat(...)`). Cosmetic; do not rewrite history for it.
- Chromium for WebGL verification:
  `C:\Users\Novella\AppData\Local\ms-playwright\chromium-1208\chrome-win64\chrome.exe`,
  launched with `--use-gl=angle --enable-unsafe-swiftshader`, needs `CHROME_PATH`
  set (Playwright wants build 1243; only 1208 is installed).
- Start vite with `bun run dev:web -- --port 5180`; the Rust binary is served
  fresh TS from vite, so TS-only commits need no rebuild.
- The comment hook fires on every edit. Every docstring must be justified as
  category 3 (public API / non-obvious cross-process contract) or removed.

## 9. Pre-existing failures (NOT caused by this work)

- 16 Rust test failures: `data_lock`, `onboard`, `web::auth`, `skills`,
  `worktree`, `claude_accounts`, `destructive_guard`, `remote`, `trackers`,
  `command_ledger::http_tests`, canvas frame-limit.
- 1 frontend timeout: `clothing.test.ts > renderPixels > is reproducible from the
  spec alone` (given an explicit `{ timeout: 60_000 }`).

Do not "fix" these while chasing the current goal; note them and move on.
