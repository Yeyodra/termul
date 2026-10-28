---
slug: roblox-tool-loading-v2
status: awaiting-approval
intent: clear
review_required: false
pending-action: write .omo/plans/roblox-tool-loading-v2.md
approach: Stop Claude Code from deferring the Roblox Studio MCP tools. Three escalating mechanisms, each verified against the real adapter source before the next is attempted — (A) per-session agent env `ENABLE_TOOL_SEARCH`, (B) Roblox system prompt via `_meta.systemPrompt.append`, (C) a Termul-owned stdio MCP proxy that re-publishes the tools with `_meta["anthropic/alwaysLoad"]`. A fourth, always-on layer (Roblox session instructions + a "load schemas first" line) ships regardless.
---

# Draft: roblox-tool-loading-v2

> Supersedes `.omo/plans/robloxkit-mcp-proxy.md` (v1). v1 bet on per-tool
> `_meta.always_load`, which is the wrong wire key, and it assumed a proxy was the
> centrepiece. Both were wrong. See `.omo/roblox-re/08-correction-alwaysLoad.md`.

## Components (topology ledger)

| id | outcome | status | evidence |
|---|---|---|---|
| C1 | Claude stops deferring the 28 Roblox Studio tools | active | `.omo/roblox-re/06-root-cause-verdict.md` |
| C2 | Roblox context (place name, tool names, "drive the place, don't write .lua") reaches the agent | active | `.omo/roblox-re/05-injection-channels-and-fix-plan.md` §3 |
| C3 | No non-Roblox session changes behaviour | active | `src-tauri/src/acp/manager/gates.rs:43` |

## Open assumptions (announced defaults)

| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| Which mechanism wins | Try A, then B, then C — measured, not guessed | Each is cheaper than the next; the plan must not build C if A works | yes |
| Test strategy | tests-after; Phase 0 is empirical before any product test is written | The wire behaviour is only knowable by running it | yes |
| Agent scope | All ACP agents; mechanisms that are Claude-only are labelled as such and are additive, never gating | User's standing choice; MCP requires clients to ignore unknown `_meta` | yes |
| Proxy server name (only if C is reached) | `robloxkit` | User's explicit choice; distinct from `roblox-studio` so they never collide | yes |
| Instruction block | Ships in every variant, including if A succeeds | Cheap, orthogonal, and supplies the place name no tool description carries | yes |

## Findings (cited)

### The bug is tool deferral — proven, not inferred

- `~/.claude/projects/C--Users-Novella-Documents-RobloxKit/0f548212-*.jsonl:7` — `attachment.type = "deferred_tools_delta"`, `addedNames` = 84, including all 28 `mcp__roblox-studio__*`; `wireHiddenNames` = 0; `failedMcpServers` empty.
- Same file `rendered[0].content`: *"Their schemas are NOT loaded — calling them directly will fail with InputValidationError."*
- Measured 28 StudioMCP tools = 55,678 chars / ~13,919 tokens (`.omo/roblox-re/00-runtime-evidence.md` §E2), far past the default 10% threshold decoded from `claude.exe` @257700877 (`c7e=10`, `hfr=2.5`, `enabled: y >= D`).

### It is Claude-specific

- `.omo/roblox-re/07-opencode-baseline.md` — OpenCode, same prompt, same project, called `list_roblox_studios` → `get_studio_state` → `execute_luau` → `screen_capture` and built a 9-part model. No instructions injected.

### Mechanism A (env) is reachable — VERIFIED

- `acp-agent.js:8647-8656`: `const env = { ...process.env, ...userProvidedOptions?.env, ...providerEnv, ... }`.
- `acp-agent.js:8570`: `const userProvidedOptions = sessionMeta?.claudeCode?.options;` where `sessionMeta = params._meta` (`:8557`).
- So `_meta.claudeCode.options.env.ENABLE_TOOL_SEARCH` reaches the agent process env.
- Termul already builds exactly this `_meta` shape: `src-tauri/src/acp/manager/gates.rs:486-495` (`summarized_thinking_meta`, `claudeCode.options.thinking`), applied at `command_loop.rs:155, 387, 478`.

### Mechanism B (system prompt) is reachable — VERIFIED, but adapter-specific

- `acp-agent.js:8531-8555`: `airCustomInstructions(params._meta)` and `params._meta?.systemPrompt` both build `systemPrompt`; a string replaces it, an object is spread with `type/preset` locked, and `append` is the documented additive form.
- `sdk.d.ts:646-653`: `alwaysLoad` on an SDK MCP server config is applied "via `_meta['anthropic/alwaysLoad']` on each tool" — this is the **correct wire key**, and it is **per-tool**, not `always_load`.
- `sdk.d.ts:1216`: a **server-level** `alwaysLoad` exists too, and it "blocks startup until the server is connected (capped at the standard 5s connect timeout)".

### Mechanism C's premise is weakened — the adapter drops server `_meta`

- `acp-agent.js:8505-8530` builds the SDK server map from `{type, command, args, env}` **only** for stdio, and `{type, url, headers}` for http/sse. `_meta` on an ACP `mcpServers` entry is **discarded**.
- Consequence: the server-level `alwaysLoad` cannot be set through ACP today. Either the adapter is extended, or the per-tool `_meta['anthropic/alwaysLoad']` is delivered by a proxy that re-publishes tools. This is why C remains on the table.

### `rmcp` can express both halves of C

- `rmcp-3.5.0/src/model/tool.rs:17-39` — `Tool` is `#[non_exhaustive]`, has `#[serde(rename = "_meta")] pub meta: Option<MetaObject>`; `:228` `with_meta`.
- `rmcp-3.5.0/src/handler/server/router/tool.rs:197` `ToolRoute::new_dyn`, `:436` `ToolRouter::add_route` — a runtime router is possible, so the `#[tool_router]` macro is not required.

### Termul's own patterns to copy

- `src-tauri/src/acp/host_mcp/mod.rs:51,60` — `CHILD_ARG`, `is_child_invocation`.
- `src-tauri/src/main.rs:24` and `src-tauri/src/server_main.rs:74` — both branch on the child flag before Tauri init; both must be updated (comments warn about drift).
- `src-tauri/src/acp/host_mcp/child.rs:368-380` — `get_info()` + `.with_instructions(session_instructions())`.
- `src-tauri/src/acp/host_mcp/canvas_tools.rs:20-24` — `DESCRIPTION_TAG` precedent.
- `src-tauri/src/acp/manager/gates.rs:37-56` — `gate_mcp_servers`; `:43` stdio passes unconditionally.
- `src-tauri/src/acp/manager/gates.rs:112-137` — `build_internal_plan_stdio`, the builder template.
- `src-tauri/src/acp/manager/mod.rs:1058-1070` (create) and `:1204-1235` (reopen) — the two injection points, both with the same shape.

### Blast radius is structurally small — verified by reading, not assumed

- `build_internal_plan_stdio` is a **pure config builder**; it spawns nothing and cannot fail.
- On both create and reopen, the only `Result` on the path is `gate_mcp_servers`, and `McpServer::Stdio(_) => {}` passes unconditionally.
- Therefore a stdio-only proxy entry cannot fail a session. The residual risk is a *dead child* at runtime, which surfaces as an empty tool list, not a failed session.

## Decisions (with rationale)

**D1 — order mechanisms by cost, and prove each before building the next.** A is ~15 lines. B is ~40 lines. C is ~250 lines plus a new child process. Shipping C without first disproving A and B would be the v1 mistake repeated.

**D2 — mechanism A/B are Claude-specific; that is acceptable because they are additive.** A and B change nothing for OpenCode/Codex/Gemini (they ignore unknown `_meta`, and their env is untouched). They are gated on "the agent is the Claude ACP adapter", detected through the existing `requests_summarized_thinking`-style helper (`gates.rs:470-479` matches `claude-agent-acp`), not a hardcoded id string in a hot path. If even that feels too vendor-specific, C is the fallback that needs no vendor detection at all.

**D3 — the Roblox instruction block ships in every variant.** It costs nothing, supplies the place name, and is the only layer that helps a user on an agent that neither defers nor reads `_meta`.

**D4 — no proxy unless A and B both fail.** C exists in this plan as a fully specified contingent branch, not as scheduled work.

**D5 — do not seed `CLAUDE.md`.** Deliberately excluded: it is a second channel that would mask whether the MCP fix works.

**D6 — the raw `roblox-studio` entry is suppressed only when a proxy is actually injected.** Since C is contingent, this decision only binds if C is reached.

## Scope IN

- Phase 0: empirically determine which of A / B suppresses deferral, with transcript evidence.
- Mechanism A: per-session `_meta.claudeCode.options.env.ENABLE_TOOL_SEARCH` for Claude sessions.
- Mechanism B: Roblox system-prompt append via `_meta.systemPrompt` (object form with `append`).
- Mechanism C (contingent): `robloxkit` stdio proxy re-publishing the 28 tools with `_meta["anthropic/alwaysLoad"] = true`, injected only for the Roblox project.
- A Roblox instruction block with the place name, real tool names, and a "drive the place, don't write .lua files" prohibition.
- An always-on line telling the agent to load tool schemas before concluding a tool is unavailable.
- Sibling tests for every new module; a manual QA recipe as the final gate.

## Scope OUT (Must NOT have)

- No RobloxKit 93-tool surface: no generative engines (clothing, SFX, 3D, texture, skybox, icons, VFX, GFX, cutscene, animation, music), no Open Cloud admin, no `spawn_task`, no `ytdl_*`.
- No HTTP or SSE transport.
- No `if agent_id == "claude-acp"` string comparison in a hot path; use the existing capability/profile helper.
- No per-agent filtering of the Roblox proxy or its instructions.
- No modification of `StudioMCP.exe` or any `%LOCALAPPDATA%\Roblox` file.
- No `CLAUDE.md` / `AGENTS.md` seeding or reading.
- No renaming or aliasing of upstream tool names.
- No touching the canvas path or the `figcraft` instruction block.
- No persisted-state mutation for MCP entry suppression.
- No hardcoded absolute `StudioMCP.exe` path.

## Open questions

None blocking. Three runtime unknowns are converted into Phase 0 todos with explicit abort branches:

- Does `ENABLE_TOOL_SEARCH=<n>` suppress deferral? (todo 1)
- Does `_meta.systemPrompt.append` reach the model and help? (todo 2)
- Does per-tool `_meta["anthropic/alwaysLoad"]` survive through a proxy? (todo 3, only if 1 and 2 fail)

## Approval gate

status: awaiting-approval

Brief presented in-chat. Awaiting the user's explicit okay before writing `.omo/plans/roblox-tool-loading-v2.md`.
