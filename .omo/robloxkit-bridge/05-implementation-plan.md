# 05 — Implementation plan

Derived from reports 01–04. Phases are ordered so the **first one needs no code**.

## Phase 0 — Prove the path (no code)

**Goal:** an agent edits a live Roblox Studio place through Termul.

Steps:
1. Open Roblox Studio → Assistant icon (top-right) → `...` → *Manage MCP Servers*
   → enable *Enable Studio as MCP server*.
2. In Termul: Settings → MCP Servers → *Add server*, paste:

```json
{ "mcpServers": { "roblox-studio": {
    "command": "C:\\Users\\Novella\\AppData\\Local\\Roblox\\Versions\\version-7aaa6838d36c4448\\StudioMCP.exe",
    "args": []
} } }
```

3. Start a chat, prompt: *"Use the roblox-studio tools: run `return 6*7` in Studio."*

**Acceptance:**
- The probe dot turns green and `tools/list` shows Studio's tools.
- `execute_luau` returns `42`.
- A Part written via Luau appears in the place.

**What Phase 0 answers that no document can:**
- Whether `rmcp` 3.5.0's client handshake is accepted by `StudioMCP.exe`, which
  advertises `protocolVersion: "2025-11-25"` (RobloxKit `AGENTS.md:270`).
  `Cargo.toml:130-131` says rmcp speaks `2026-07-28` but still accepts legacy
  `initialize`. **This is the main technical risk and it is cheap to test.**
- Whether Studio tools surface in the chat with usable names (§03 §5: no `mcp__`
  prefix stripping exists in the renderer).
- Timing: Studio's Assistant plugin re-dials ~2 s after `StudioMCP.exe` starts
  (RobloxKit `HANDOFF.md` §7), so `tools/list` may be empty on the first probe.

**If Phase 0 fails**, the failure mode tells you which phase to jump to:
| Symptom | Likely cause | Next |
|---|---|---|
| Probe connects, 0 tools | plugin not dialled yet / not enabled | retry after 3 s, verify Studio setting |
| Handshake rejected | protocol version mismatch | needs a version pin or shim — a real design task |
| Tools list, calls error | `studio_id` not supplied | Phase 1 (`studio_id` injection) |

## Phase 1 — Studio-aware conveniences (small Rust)

Only after Phase 0 works. Ports the four genuinely useful bits from RobloxKit's
`studio.rs`, which Termul's generic registry cannot provide.

| Deliverable | Source to port | Why |
|---|---|---|
| Exe auto-discovery | RobloxKit `app/src-tauri/src/studio.rs:48-74` | path contains a **version dir** that changes on every Roblox update; asking users to paste it is a support burden |
| `studio_id` auto-inject | `studio.rs:230-256` | single-studio case: resolve via `list_roblox_studios` and inject |
| Studio status command | `studio.rs:339-350` | report `{ exePath, found, running, studios[] }` |
| Live e2e test | — | `--ignored` test, per `04` §8 convention |

**Constraints that apply (`04`):**
- New Tauri command ⇒ parity trio (adapter + `api.ts` + test) per
  `parity-checklist.test.ts:237-272`.
- Both transports (desktop + web) per `AGENTS.md:27`; gate with `isTauriContext()`
  where host-only.
- `log` + `redact_session_id`; never log place contents.

**Not** in this phase: any `host_mcp` change.

## Phase 2 — Studio host tool family (only if needed)

Choose this **only** if Phase 1 leaves a concrete gap that a registry entry cannot
close — e.g. Studio tools must be gated behind a permission prompt, or Studio state
must drive a panel.

Follow the checklist in `02` §15. Concretely:

| File | Change |
|---|---|
| `src-tauri/src/acp/host_mcp/studio_tools.rs` | **new** — `tools()`, `call_tool()`, `instructions()` |
| `src-tauri/src/acp/host_mcp/parent/studio.rs` | **new** — frame handler |
| `host_mcp/mod.rs:142-158` | new `FrameKind::Studio` |
| `host_mcp/mod.rs:324-353` | new `FrameRequest` fields |
| `host_mcp/mod.rs:90-95` | append Studio instructions |
| `child.rs:131-143` | register routes (~3 lines) |
| `parent.rs:488-639` | new dispatch arm (compiler-enforced, match is exhaustive) |
| `child/tests.rs:606-613` | update `HOST_TOOLS` (the test asserts the exact list) |

Design note from `02` §12: **return `Result<T, String>` or
`structured_error`**, not bare `String`. The existing `plan`/`ask_user` tools report
failures as *successful* text, which an agent cannot detect structurally. Do not
copy that behaviour.

Do **not** route Studio through the canvas `Bridge` (`02` §13): `StudioMCP.exe` is
already a stdio MCP server, so the child should hold a stdio client to it directly.

## Phase 3 — UI polish (optional)

| Item | Where |
|---|---|
| "Studio: connected / N places" indicator | extend `McpBadge.tsx` |
| Friendly tool names | renderer currently does **not** strip `mcp__*` (`03` §5) |
| Place name in the chat header | needs a status command (Phase 1) |

## Explicit non-goals

Carried over from the RobloxKit clone's PRD §2.2, and still correct:

- `robloxkit.dev` auth, `X-RK-Sig`, Discord OAuth — not applicable to Termul.
- Roblox Open Cloud / asset upload / `/api/roblox/*` — server-backed.
- Generative engines (image DSL, sfx DSP, 3D). RobloxKit's own RE scored these at
  ~45–70% duplication-readiness (`DUPLICATION-READINESS.md:40-42`); the clone never
  implemented them either. Not a Termul concern.
- Porting `mcpserver.rs` — Termul's registry supersedes it.

## Honest risk list

| Risk | Severity | Why |
|---|---|---|
| `rmcp` 3.5 ↔ `StudioMCP.exe` `2025-11-25` handshake | **high** | unverified; the whole path depends on it |
| Renderer shows raw `mcp__roblox-studio__*` names | low | cosmetic, fixable |
| Studio tools appear only after plugin re-dial | low | timing, retry handles it |
| Registry vs project-file precedence (`03` §9) | medium | a server could silently vanish on project switch — verify before relying on it |
| Windows-only | — | `StudioMCP.exe` ships with Roblox Studio; macOS/Linux cannot run this leg at all |

## What is still unverified in this mapping

Be explicit with the user before implementation:

1. `rmcp` 3.5.0 source is **not vendored** here, so `ToolRoute::new_dyn` and
   `CallToolResult::structured_error` semantics come from call sites and tests.
2. `selectMcpServersForAgent`'s exact filtering predicate (does it drop
   unsupported servers silently?).
3. Registry vs per-project-file precedence.
4. The tool-card event → component chain in the renderer (the subagent for this
   was cancelled; `03` §3 is partial).
5. Web/`termul-server` command registration path.
6. Capability entries a new command needs.
