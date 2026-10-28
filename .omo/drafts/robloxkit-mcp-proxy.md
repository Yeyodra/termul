---
slug: robloxkit-mcp-proxy
status: awaiting-approval
intent: clear
review_required: false
pending-action: write .omo/plans/robloxkit-mcp-proxy.md
approach: Add a Termul-owned stdio MCP proxy named `robloxkit` in front of Roblox's StudioMCP.exe. The proxy re-publishes the 28 upstream tools with `_meta.always_load = true` and a Roblox instruction block, so Claude Code stops deferring them behind ToolSearch. Roblox context also joins `session_instructions()`. No transport change, no per-agent branching.
---

# Draft: robloxkit-mcp-proxy

## Components (topology ledger)

<!-- id | outcome (one line) | status | evidence path -->

| id | outcome | status | evidence |
|---|---|---|---|
| C1 | Proxy `robloxkit` runs and its 28 tools load eagerly instead of being deferred | active | `.omo/roblox-re/06-root-cause-verdict.md` |
| C2 | Roblox context (place name, tool names, "don't write .lua") reaches the agent | active | `.omo/roblox-re/05-injection-channels-and-fix-plan.md` §3 |
| C3 | Registry stays clean: no duplicate `roblox-studio` + `robloxkit` tool sets | active | `.omo/roblox-re/00-runtime-evidence.md` §E3 |

## Open assumptions (announced defaults)

<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->

| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| Who runs the Phase 0 runtime probe | The worker, as todos 1-2, with an explicit abort branch | No shell in the planning session; the plan must be self-contained so a worker can prove or disprove `always_load` without a human in the loop | yes |
| Test strategy | tests-after for the proxy; the wire shape is only knowable after the Phase 0 probe | Writing tests against a guessed upstream frame would encode the guess. Existing convention is sibling test files (`roblox_tests.rs`) | yes |
| Fallback if `_meta.always_load` is ignored | Try `ENABLE_TOOL_SEARCH` env var, then the "call ToolSearch first" instruction line | Cheapest-to-most-invasive ordering; each is independently shippable | yes |
| MCP server name | `robloxkit` | User's explicit choice. Deliberately distinct from `roblox-studio` so the two never collide in `--mcp-config` | yes |
| Agent scope | All ACP agents, no filter | User's explicit choice; matches commit `04ac8e48` ("No agent is restricted") | yes |
| `_meta.always_load` sent to every agent | Yes, unconditionally | User's explicit choice (Option A). MCP requires clients to ignore unknown `_meta`; no if-chain needed | yes |

## Findings (cited - path:lines)

**The bug is tool deferral, not missing Roblox support.**

- `~/.claude/projects/C--Users-Novella-Documents-RobloxKit/0f548212-*.jsonl:7` — `attachment.type = "deferred_tools_delta"`, `addedNames` = 84 entries including all 28 `mcp__roblox-studio__*`; `wireHiddenNames` = 0; `pendingMcpServers`/`failedMcpServers`/`needsAuthMcpServers` all empty. The tools were present but schema-less.
- Same file, `rendered[0].content`: *"Their schemas are NOT loaded — calling them directly will fail with InputValidationError."*
- `claude.exe` @126865964: `deferred_tools_delta` attachment name. @126375864: `alwaysLoad` / `always_load` / `searchHint` / `maxResultSizeChars`. @132120640: `ENABLE_TOOL_SEARCH`. @127037685: `--mcp-config alwaysLoad servers`, `CLAUDE_CODE_MCP_ALWAYS_LOAD_JOIN_BEFORE_INPUT`.
- `claude.exe` @257700877: `var c7e = 10;` (default threshold = 10% of context), `var hfr = 2.5`, `wfr()` returns `{ enabled: y >= D }` where `D = floor(contextWindow * (threshold/100))`.
- Measured 28 StudioMCP tools = **55,678 chars / ~13,919 tokens** (`00-runtime-evidence.md` §E2) — far past 10% of the window.

**The bug is Claude-specific.**

- `.omo/roblox-re/07-opencode-baseline.md` — same prompt, same project, OpenCode called `roblox-studio_list_roblox_studios`, `get_studio_state`, `execute_luau`, `screen_capture` and built a 9-part `Meja` model. Zero Roblox instruction text injected, no `CLAUDE.md` present.

**`rmcp` supports the fix.**

- `rmcp-3.5.0/src/model/tool.rs:17-39` — `pub struct Tool` is `#[non_exhaustive]`, has `#[serde(rename = "_meta")] pub meta: Option<MetaObject>`.
- `rmcp-3.5.0/src/model/tool.rs:228` — `pub fn with_meta(mut self, meta: MetaObject) -> Self`.
- `rmcp-3.5.0/src/handler/server/router/tool.rs:197` — `ToolRoute::new_dyn`; `:436` — `ToolRouter::add_route(&mut self, ToolRoute<S>)`. Runtime router from a `Vec<Tool>` is possible, so the macro is not required.

**Termul's existing patterns to copy.**

- `src-tauri/src/acp/host_mcp/mod.rs:51` — `CHILD_ARG = "--internal-mcp-plan-server"`; `:60` `is_child_invocation()`.
- `src-tauri/src/main.rs:24` and `src-tauri/src/server_main.rs:74` — both branch on the child flag BEFORE Tauri init. Both must be updated (the code comments warn about drift).
- `src-tauri/src/acp/host_mcp/child.rs:368-377` — `impl ServerHandler for TermulPlanServer`, `get_info()` returns `ServerConfig::new(...).with_instructions(session_instructions())`.
- `src-tauri/src/acp/host_mcp/canvas_tools.rs:20-24` — `DESCRIPTION_TAG` precedent: prefix every tool description when some clients ignore server `instructions`.
- `src-tauri/src/acp/manager/gates.rs:37-56` — `gate_mcp_servers`; `:43` `McpServer::Stdio(_) => {}` (stdio passes unconditionally).
- `src-tauri/src/acp/manager/gates.rs:112-137` — `build_internal_plan_stdio`, the template for a new `build_internal_roblox_stdio`.
- `src-tauri/src/acp/manager/mod.rs:1059-1067` — where the internal server is prepended into `combined`; the Roblox proxy hooks in here.
- `src-tauri/src/roblox/session.rs` — existing `StudioSession`/`Client`: newline-framed JSON-RPC 2.0 over the child's stdio. The proxy's upstream half can reuse this shape.
- `src-tauri/src/roblox.rs:48-62` — `find_studio_mcp_in`, resolves `StudioMCP.exe` per call (the `version-<hash>` dir changes every update).

## Decisions (with rationale)

**D1 — stdio↔stdio, not HTTP.** `gate_mcp_servers` accepts stdio unconditionally, so no port, no bearer token, no loopback listener, and no change to the `mcpServers` wire shape. RobloxKit needed HTTP because its proxy is a separate process boundary with auth; Termul self-spawns `current_exe()` and inherits stdio, exactly like `TermulPlanServer`.

**D2 — `_meta.always_load` unconditionally, no agent branch.** MCP requires clients to ignore unknown `_meta` keys, so sending it to OpenCode/Codex/Gemini is a no-op rather than a hazard. An `if agent == "claude-acp"` would encode a vendor's internal behaviour into Termul's Rust and rot on the next release.

**D3 — the proxy is opt-in per project.** It is injected only when the session's project is the Roblox project (`ROBLOX_PROJECT_NAME` from `src/renderer/lib/roblox-studio-mcp.ts:9`). A user editing an ordinary repo must not pay ~14k tokens of Roblox tool schemas.

**D4 — the raw `roblox-studio` registry entry is disabled while the proxy is active.** Otherwise the agent receives both `mcp__roblox-studio__*` and `mcp__robloxkit__*` — 56 tools and ~28k tokens for one capability.

**D5 — tool descriptions get a context prefix, mirroring `DESCRIPTION_TAG`.** The canvas precedent exists precisely because some clients never show server `instructions`. Doing both is deliberate redundancy.

**D6 — do not rename upstream tools.** The proxy re-publishes StudioMCP's names verbatim (`execute_luau`, not `executeLuau`). RobloxKit's own instruction text is written against *its* names (`read_console`, `read_script`, `edit_script`), which do not exist in StudioMCP — copying it would point the agent at phantom tools.

## Scope IN

- A new `robloxkit` stdio MCP proxy child, registered and injected only for the Roblox project.
- `_meta.always_load = true` on every proxied tool.
- Roblox `instructions` block (place name, real tool names, "drive the place, don't write .lua files", `studio_id` optional).
- A `DESCRIPTION_TAG`-style context prefix on each proxied tool description.
- Place-name plumbing from the renderer's existing `liveStatus()` into the child.
- Phase 0 proof-or-disprove of `_meta.always_load`, with the two documented fallbacks.
- Tests: sibling `roblox_*_tests.rs` for the proxy; renderer tests for the wiring.

## Scope OUT (Must NOT have)

- No RobloxKit 93-tool surface: no generative 3D/VFX/SFX/icon/skybox/texture engines, no clothing/GFX/cutscene/animation, no Open Cloud admin (`publish_place`, `ban_user`, datastores), no `spawn_task` orchestration, no `ytdl_*`.
- No HTTP/SSE transport for the proxy.
- No `if agent_id == "claude-acp"` (or any agent-id branch) in Rust.
- No per-agent filtering of the proxy or its instructions.
- No change to `StudioMCP.exe` or any Roblox install file.
- No editing of `.figcraft`/`.pen`/`.op` files, no touching the canvas path.
- No `CLAUDE.md` seeding in this plan (considered, deferred: it is a second channel that masks whether the MCP fix works; revisit only if the proxy proves insufficient).
- No change to the `roblox-studio` registry entry's persisted shape — only its enabled state at injection time.

## Open questions

None blocking. Two runtime unknowns are deliberately converted into Phase 0 todos with explicit abort branches:

- Whether Claude honours `_meta.always_load` (todos 1-2).
- Whether `ENABLE_TOOL_SEARCH=<n>` suppresses deferral outright (todo 3, fallback only).

## Approval gate

status: awaiting-approval

Brief presented. Awaiting the user's explicit okay before writing `.omo/plans/robloxkit-mcp-proxy.md`.
