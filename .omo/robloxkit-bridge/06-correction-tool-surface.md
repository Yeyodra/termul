# 06 — CORRECTION: the tool surface is not "just StudioMCP"

This report corrects an over-simplification in `00`–`05`. The user pushed back on
two points and **both are right**. Read this before the plan.

## What I got wrong

`00-index.md` and `05-implementation-plan.md` framed the job as:

> "Add `StudioMCP.exe` to Termul's MCP registry → done."

That is true for the **Studio-editing half** and false for the whole. Two
corrections:

### Correction 1 — RobloxKit ships its own embedded MCP server

Not a wrapper around StudioMCP. `re/05-ai-agent-acp-mcp/FINDINGS.md:243-256`:

> **What RobloxKit does instead: its own MCP server + a name-prefixed tool surface.**
> * **Internal MCP server** (HTTP, `tiny_http 0.12.0`): bind `127.0.0.1:0`, route
>   `/mcp`, `Authorization: Bearer <token>`, serverInfo `RobloxKit Studio` v`0.1.0`,
>   protocol `2025-11-25`
> * **Tool relay is frontend-mediated, not Rust-relayed:** Rust emits `mcp:call` →
>   the **frontend** executes the tool (`fO(name, args)`) → `mcp_tool_result`

So the architecture is:

```
agent → RobloxKit's OWN embedded MCP server (93 tools)
           → Rust emits `mcp:call`
           → frontend runs fO(name, args)
              ├─ 9-10 tools → StudioMCP.exe → WS :13469 → Studio
              └─ ~83 tools  → local engine (image/sfx/3D/files/OpenCloud)
```

StudioMCP is **one leaf** of that tree, not the tree.

### Correction 2 — tool calls do not come only from Studio

`artifacts/mcp-tools-robloxkit.md` — 93 tools in 19 groups:

| Group | Tools | What it actually is |
|---|---|---|
| `lp` | 9 | **the only Studio-direct group** (`execute_luau`, `read_script`, `edit_script`, `search_game_tree`, `inspect_instance`, `read_console`, `list_scripts`, `capture_viewport`, `studio_state`) |
| `wn` | 9 | workspace files (`list_files`, `read_file`, `write_file`, `delete_file`, `read_image`, `slice_image`, `resize_image`, `upload_asset`, `asset_status`) |
| `Rd` | 5 | **image engine** (`image_render`, `image_edit`, `image_info`, `image_atlas`, `image_spec`) |
| `ml` | 5 | **3D** (`generate_3d`, `edit_3d`, `get_3d_model`, `list_3d_collection`, `send_3d_to_studio`) |
| `Tl` | 4 | clothing |
| `ru` | 5 | gfx |
| `fu` | 5 | vfx |
| `Su` | 6 | sfx |
| `ku` | 5 | icons |
| `Lu` | 3 | cutscene |
| `Gu` | 3 | animation |
| `ed` | 2 | skybox |
| `od` | 2 | texture |
| `Pd` | 5 | music + ytdl |
| `Nf` | 15 | **Roblox Open Cloud** (experience/place update, datastores, ban/unban, publish) |
| `Zc` | 3 | open places (attach/detach/list) |
| `ap` | 1 | copy between places |
| `cp` | 2 | skills |
| `Zf` | 4 | subagent tasks |

**Only ~9–10 of 93 touch Studio.** This matches
`re/05-ai-agent-acp-mcp/FINDINGS-TOOL-ROUTES.md:37-39`:

> "only **10 of 85** tools talk to Studio directly. The original posture — '77 tools
> proxy Studio endpoints' — was wrong."

## What this changes

### Phase 0 is still valid, but it buys less than I implied

Adding `StudioMCP.exe` to Termul's registry gives you the `lp` group — the ability
to read and edit a live place. That is genuinely the **core** use case ("agent
edits my game"), and it needs no code.

But it does **not** give you 83 of 93 tools. If your target is "RobloxKit
equivalent", Phase 0 is roughly 10% of the surface by tool count.

### The honest scope table

| Capability | Via Termul registry + StudioMCP | Needs new work |
|---|---|---|
| Read/edit scripts, run Luau, inspect tree, capture viewport | ✅ | — |
| Workspace file tools | ❌ | Termul has its own file explorer/editor; may already cover this |
| Image engine (`image_render` etc.) | ❌ | **port the engine** — RobloxKit's RE has formulas (`FINDINGS-DEEP-5.md`) but no implementation |
| SFX / music synthesis | ❌ | port DSP — formulas known, code is not |
| 3D generation | ❌ | **hardest** — RE scored ~45% (`DUPLICATION-READINESS.md:42`); no algorithm captured |
| Clothing / gfx / vfx / icons / skybox / texture | ❌ | same class as image/3D |
| Open Cloud (datastores, publish, ban) | ❌ | needs Roblox OAuth + Open Cloud API; RobloxKit proxied it via its own server |
| Task/subagent orchestration | ❌ | Termul has ACP subagents — different model |

### What Termul already has that reduces the gap

| RobloxKit group | Termul equivalent |
|---|---|
| `wn` workspace files (9) | file explorer + editor + ripgrep search — **probably covered** |
| `cp` skills (2) | `src-tauri/src/skills/` exists (`mod.rs`, `files.rs`, `commands.rs`) |
| `Zf` tasks (4) | ACP subagents / native subagents (`manager/native_subagents.rs`) |
| `lp` Studio (9) | **nothing** — this is the real gap Termul fills |

So the genuinely new value Termul needs is: **`lp` (Studio) + generative engines +
Open Cloud**. Termul covers files, skills and subagents already.

### Dependency check for the generative half

Termul's `src-tauri/Cargo.toml` has **no** image/audio crates:
grep for `image`, `resvg`, `ffmpeg`, `hound`, `rodio`, `symphonia` → **no matches**.

So every generative engine is net-new dependency + net-new code. That is a large,
separate project — not a Phase 2.

## Revised recommendation

Split into two tracks and be explicit that they are different sizes:

**Track A — Studio editing (small, high value)**
- Phase 0: registry entry. No code. Proves the protocol.
- Phase 1: discovery + `studio_id` + status. Small Rust.
- Done. This is the "agent edits my Roblox game" product.

**Track B — RobloxKit parity (large, separate)**
- Needs a **new embedded MCP server** in Termul (the `host_mcp` family in `02`),
  exposing ~83 non-Studio tools.
- Plus 7+ generative engines, each its own porting project.
- Plus an Open Cloud client with Roblox OAuth.
- RobloxKit's own duplication-readiness for this half is 45–70%
  (`DUPLICATION-READINESS.md:40-48`) — i.e. **the reference project itself never
  finished it either.**

Do not conflate the two. Track A is days. Track B is months and has no complete
reference implementation to copy.

## What remains true from 00–05

- The `host_mcp` child/parent pattern (`02`) is the right vehicle **for Track B**,
  because that is exactly what RobloxKit's embedded server does.
- The stdio-vs-http gate (`01` §4) still matters.
- Build conventions (`04`) still apply.
- The `rmcp` protocol-compat risk (`05`) is unchanged and still the first thing to
  test.

## New unknowns this correction introduces

1. Whether Termul's `skills/` module is compatible with RobloxKit's
   `list_skills`/`read_skill` contract — not compared.
2. Whether Termul's file tools (editor/explorer) are reachable **by the agent** or
   only by the user. RobloxKit's `wn` group is agent-facing; Termul's file UI may
   not be. **This is the key question for how much of `wn` is actually covered.**
3. Whether Open Cloud is in scope at all — it requires a Roblox OAuth app, which is
   a product decision, not a technical one.
