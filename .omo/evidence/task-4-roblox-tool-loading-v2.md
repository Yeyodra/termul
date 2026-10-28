# Task 4 — Ship Mechanism A': server-level `alwaysLoad` for the Roblox MCP entry

**Status: implemented and verified.** `cargo check`, `clippy -D warnings`, and three
test suites all exit 0.

## What shipped

For a **Claude** session on the **Roblox** project, the request is shaped so that:

1. `_meta.claudeCode.options.mcpServers["roblox-studio"].alwaysLoad = true` is sent, and
2. `roblox-studio` is **removed from that session's ACP `mcp_servers` array**.

Both halves are produced by one function so no caller can apply one without the other.

## Why both halves (the ordering trap)

The Claude adapter projects each ACP `mcpServers` array entry down to
`{type, command, args, env}` (`acp-agent.js:8518-8528`), so `alwaysLoad` is silently
dropped there. It must ride on `_meta.claudeCode.options.mcpServers`, which the
adapter spreads unfiltered (`acp-agent.js:8570`).

The adapter then builds its own map as
`{ ...userProvidedOptions.mcpServers, ...mcpServers }` — the ACP array is spread
**last** (`acp-agent.js:8699-8702`). A server present in **both** places therefore has
its `_meta` entry overwritten by the four-field projection, making the fix a **silent
no-op that still passes a naive test**.

Measured during the Phase 0 probe: `t_array_on` and `t_both_on` both produced a
captured `--mcp-config` with **zero** `alwaysLoad` keys and the tools deferred. Only
the `_meta`-only placement (`t_on`, `cap_a_on`) carried `"alwaysLoad":true`.

**How it is guarded:** `shape_session_request` / `shape_session_request_opt` return the
shaped server list and the `_meta` together, and `suppress_servers` is applied only
when the `_meta` is present. The test
`suppress_servers_drops_the_studio_entry_and_meta_still_carries_always_load` asserts
both halves in one test, because either half alone passes while the trap silently
reintroduces the bug.

## Files changed

| File | Change |
| --- | --- |
| `src-tauri/src/acp/manager/gates.rs` | `RobloxEagerLoad` (resolve/meta/suppress_servers), `ROBLOX_STUDIO_MCP_NAME`, `is_roblox_studio_server`, `shape_session_request`, `shape_session_request_opt`; `summarized_thinking_meta()` now delegates to `RobloxEagerLoad::default().meta()` so it stays byte-identical |
| `src-tauri/src/acp/manager/mod.rs` | `SessionCreationContext.roblox_studio_eager_load`, `AcpCommand::{NewSession,LoadSession,ResumeSession}` fields, `load_session`/`resume_session` trailing arg |
| `src-tauri/src/acp/manager/command_loop.rs` | all three arms (`session/new`, `session/load`, `session/resume`) consume the shaping |
| `src-tauri/src/web/ws/projects.rs` | `ROBLOX_PROJECT_NAME`, `wants_roblox_eager_load()`, wired into create + load |
| `src-tauri/src/web/ws/lifecycle.rs` | wired into resume |
| `src-tauri/src/web/ws/dispatch.rs` | passes `registry` to both reopen handlers |
| `src-tauri/src/acp/manager/tests.rs` | 5 shaping tests + mechanical arg updates |
| `src-tauri/src/web/ws/tests.rs` | 4 gating tests |

## Gating decision

`wants_roblox_eager_load(registry, project_id, mcp_servers)` requires **all** of:

- the project's **name** resolved through `ProjectRegistry::snapshot()` equals
  `ROBLOX_PROJECT_NAME` (`"Roblox"`, mirroring
  `src/renderer/lib/roblox-studio-mcp.ts:9`) — registry-backed, **not** a path or
  basename comparison;
- the session's MCP list contains an entry named `roblox-studio`.

Create resolves `project_id` explicitly; the two reopen paths derive it from `cwd` via
`registry.find_by_path()` because `LoadResumeSessionPayload` carries no `project_id`.
Anything unknown yields `false`, which produces a byte-identical request to before.

The Claude-adapter check is **not** duplicated at the WS layer: the command loop
already gates `_meta` on `profile.summarize_thinking`, and `suppress_servers` runs
only when that `_meta` is present — so a non-Claude agent's `mcp_servers` list is
untouched. This is asserted by
`non_claude_agents_get_an_unchanged_server_list_and_no_meta`.

Gating on "the `roblox-studio` entry is present" alone was rejected: the renderer's
MCP registry is one shared list (`selectMcpServersForAgent`,
`acp-mcp-persistence.ts:152`), so that entry is attached to every session of every
project — gating on it would change non-Roblox sessions.

## Verification (real exit codes)

```
cd src-tauri && cargo check --lib --bins
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 28.48s
  exit=0

cd src-tauri && cargo clippy --lib --bins -- -D warnings
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 48.24s
  exit=0

cd src-tauri && cargo test --lib roblox
  test result: ok. 54 passed; 0 failed; 0 ignored; 3365 filtered out
  exit=0

cd src-tauri && cargo test --lib acp::manager
  test result: ok. 161 passed; 0 failed; 0 ignored; 3258 filtered out
  exit=0

cd src-tauri && cargo test --lib web::ws
  test result: ok. 325 passed; 0 failed; 0 ignored; 3094 filtered out
  exit=0
```

## Guardrails checked

- **`store.json` untouched** — mtime still `2026-10-26T18:18:51`, predating this work.
  Nothing is persisted; the flag and array suppression are per-session request shaping.
- **No hardcoded absolute `StudioMCP.exe` path in production code** — the only
  occurrences are comments, one log line, and test fixtures. Production resolves per
  call via `crate::roblox::find_studio_mcp()` because Roblox relocates the binary into
  a new `version-<hash>` directory on every update.
- **No literal agent-id comparison added** — grepped the diff for `claude-acp"`: zero
  hits. Detection stays on `requests_summarized_thinking`.
- **No forbidden paths touched** — no `canvas_tools`, `figcraft`, `.pen`, `.op`.
- **No new tools, no HTTP/SSE transport** — this todo adds no tool surface at all.
- **`systemPrompt` append deliberately absent** — that is todo 5.

## Not verified here

- **Effect on the real 28 Studio tools is not measured in this task.** Phase 0 proved
  the mechanism with a synthetic server. The real eager-load token cost
  (~13,919 tokens per `06`) is a todo-9/10 concern.
- **No end-to-end GUI proof.** A real Claude session driving Studio is todo 10's
  manual gate and remains outstanding until the user reports it.
- Phase 0 measured the SDK-bundled `claude.exe` **2.1.309**, not the user's
  `~/.local/bin/claude.exe` **2.1.296**. Do not restate this as "2.1.296 verified".