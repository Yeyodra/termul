# RobloxKit → Termul: mapping reports

**Status:** mapping only. No production code written.
**Constraint:** authored in plan mode, so reports live in `.omo/robloxkit-bridge/`.
Move to `docs/robloxkit-bridge/` when implementation starts.

## ⚠️ Read `06-correction-tool-surface.md` FIRST

An earlier draft of this index claimed "add StudioMCP to the registry → done".
That is **wrong for the whole product**, right only for the Studio-editing slice.

RobloxKit ships its **own embedded MCP server** (93 tools / 19 groups) and only
**~9–10 of those tools** touch Studio. See `06`.

## The finding that shapes the plan

**Termul already has a user-configurable MCP server registry.**

`src/renderer/stores/acp-store/slices/mcp.ts` +
`src/renderer/lib/acp-mcp-persistence.ts` + `components/settings/McpServersSettings.tsx`
support `stdio` / `http` / `sse` transports, persist per project, probe on demand,
and inject enabled servers into every `session/new`.

So the **Studio-editing slice** needs zero code:

> Settings → MCP Servers → Add → paste `StudioMCP.exe` as a stdio server →
> start a chat → the agent can read/edit a live place.

Everything else (generative engines, Open Cloud, the other 83 tools) is a
different, much larger project — see `06`.

## Why not port RobloxKit's code

The RobloxKit clone hand-rolled an HTTP MCP server (`mcpserver.rs`, 422 L) only to
hand Studio tools to the agent. Termul already solves that generically. Porting it
would duplicate working infrastructure.

What **is** worth porting is Studio-specific knowledge:

| Port this | Source (Robloxkit repo) | Why |
|---|---|---|
| `StudioMCP.exe` discovery | `app/src-tauri/src/studio.rs:48-74` | path has a **version dir** that changes on every Roblox update |
| `studio_id` auto-inject | `studio.rs:230-256` | multi-Studio case |
| Status shape | `studio.rs:339-350` | `{ exePath, found, running }` |
| Timing note | `HANDOFF.md` §7 | plugin re-dials ~2 s after spawn |

## Reports

| File | Scope |
|---|---|
| **`06-correction-tool-surface.md`** | **READ FIRST** — the 93-tool surface; only ~10 touch Studio |
| `01-acp-session-injection.md` | The **two** injection paths; the stdio-vs-http capability gate |
| `02-host-mcp-architecture.md` | The host-injected child/parent pattern; how to add a tool family |
| `03-renderer-surface.md` | Registry slice, settings UI, tool cards, parity checklist |
| `04-build-conventions.md` | Deps (already sufficient), entrypoints, test rules, size limits |
| `05-implementation-plan.md` | Phased plan for the **Studio-editing** track only |

## Two tracks, very different sizes

| Track | Content | Size |
|---|---|---|
| **A — Studio editing** | the `lp` group (~9 tools): run Luau, read/edit scripts, inspect tree | days; Phase 0 needs no code |
| **B — RobloxKit parity** | the other ~83 tools: 7+ generative engines, Open Cloud, task orchestration | months; **no complete reference exists** (RobloxKit itself scored 45–70%) |

Do not conflate them. `05` covers Track A only.

## The one decision that matters

| Option | Work | When |
|---|---|---|
| **A. Registry entry** (Phase 0) | 0 code | Do this first — it also retires the biggest unknown |
| **B. Host-injected family** (Phase 2) | new `FrameKind` + parent handler + child routes | only if A leaves a proven gap |

## Highest risk, and it is cheap to test

`rmcp` is pinned at **3.5.0**, whose comment says it speaks MCP `2026-07-28`
(`src-tauri/Cargo.toml:130-131`). `StudioMCP.exe` advertises
`protocolVersion: "2025-11-25"` (RobloxKit `AGENTS.md:270`).

Whether those negotiate cleanly is **unverified**. Phase 0 answers it in minutes.
If it fails, no amount of Rust will help until the protocol question is settled.

## Verification done this session

- `StudioMCP.exe` **exists** here:
  `C:\Users\Novella\AppData\Local\Roblox\Versions\version-7aaa6838d36c4448\StudioMCP.exe`
- `rmcp 3.5.0` already has **both** `client`+`transport-child-process` and
  `server`+`transport-io`+`macros` enabled (`Cargo.toml:132-141`) — no dep change
  needed for either path.
- `McpServer::Stdio` is **gate-free** (`manager/gates.rs:43`); `Http`/`Sse` require
  agent capability. → use stdio.
- Termul has **no** existing Roblox/Studio code (grep `roblox` → no source hits).

## Known gaps in this mapping

Stated plainly so they are not mistaken for verified:

1. `rmcp` source not vendored → `ToolRoute::new_dyn` / `structured_error` read
   from call sites, not the crate.
2. `selectMcpServersForAgent` filtering predicate not read line-by-line.
3. Global-registry vs per-project-file precedence untraced.
4. Renderer tool-card event→component chain partial (that subagent was cancelled).
5. Web/`termul-server` command registration path not traced.
6. Capability entries a new command needs — not read.
