# Task 8 — Wire the mechanism into the session lifecycle; prove non-Roblox sessions are untouched

**Status: complete.** The wiring was delivered incrementally by todos 4 and 5; this
task verified it end to end and closed the one missing regression test.

## Wiring (all three session paths)

| Path | Site | Gate |
| --- | --- | --- |
| create | `command_loop.rs:157` `shape_session_request(...)` | `profile.summarize_thinking` × `RobloxEagerLoad::is_active()` |
| reopen (load) | `command_loop.rs:392` `shape_session_request_opt(...)` | same |
| reopen (resume) | `command_loop.rs:486` `shape_session_request_opt(...)` | same |
| manager create | `mod.rs` `new_session_with_context` → `AcpCommand::NewSession.roblox_studio_eager_load` | — |
| manager reopen | `mod.rs` `load_session` / `resume_session` → `AcpCommand::{LoadSession,ResumeSession}.roblox` | — |
| WS gating | `projects.rs:135` (create), `projects.rs:411` (load), `lifecycle.rs:42` (resume) `wants_roblox_eager_load(...)` | registry name == "Roblox" ∧ `roblox-studio` entry present |

`prepare_reopen_mcp` deliberately does **not** suppress: suppression happens once, in
`shape_session_request_opt`, and only when the `_meta` that replaces the dropped entry
is actually sent. Applying it in both places would have double-filtered and, worse,
could have dropped the entry for a non-Claude agent that never receives `_meta`.

## Project identity

Resolved through the registry, never a path or basename match:

- `create`: `resolve_session_project(registry, explicit_project_id, cwd)` → id, then
  `registry.snapshot().projects` → `name`.
- `load` / `resume`: the payload carries no `project_id`, so
  `registry.find_by_path(&cwd)` → id, then the same name lookup.

`wants_roblox_eager_load` requires **both** the project name and a `roblox-studio`
entry. Gating on the entry alone was rejected: the renderer's MCP registry is one
shared list (`selectMcpServersForAgent`, `acp-mcp-persistence.ts:152`), so that entry
is attached to every session of every project once registered — gating on it would
change non-Roblox sessions.

## Regression tests for the three required properties

| Required | Test |
| --- | --- |
| a Roblox session gets the mechanism, **and** the array omits `roblox-studio` | `suppress_servers_drops_the_studio_entry_and_meta_still_carries_always_load` + `thinking_always_load_and_the_append_coexist_in_one_meta` |
| a non-Roblox session's `_meta` and `mcpServers` are unchanged | `inert_roblox_eager_load_keeps_thinking_and_leaves_servers_untouched`, `inert_roblox_meta_appends_nothing`, `wants_roblox_eager_load_is_false_for_a_non_roblox_project` |
| a machine with no `StudioMCP.exe` still starts | **`a_machine_without_studio_still_gets_a_working_thinking_meta`** (added by this task) |

The last one was the gap. `RobloxEagerLoad::resolve` had a `None` branch returning
`Self::default()`, but no test could reach it without depending on whether this machine
has Studio installed. The decision half was split into
`from_studio_path(Option<PathBuf>)`, so the no-Studio branch is now driven directly and
asserts: not active, the ACP list keeps all entries, `thinking` is present, no
`systemPrompt`, no `mcpServers`.

`resolve()` still calls `find_studio_mcp()` and delegates, so production behaviour is
unchanged.

## Verification

```
cd src-tauri && cargo clippy --lib --bins -- -D warnings
  Finished `dev` ... in 1m 18s                     exit=0

cd src-tauri && cargo test --lib acp::manager
  test result: ok. 167 passed; 0 failed; 0 ignored; 3270 filtered out; 18.86s
```

167 vs 166 before — the extra test is the new no-Studio one.

## Guardrails checked

- `store.json` mtime still `2026-10-26T18:18:51` — never written.
- 0 literal `== "claude-acp"` comparisons added.
- 0 hardcoded absolute `StudioMCP.exe` paths in production code.
- 0 touches to `canvas_tools`, `figcraft`, `.pen`, `.op`.
- **10 changed/untracked files** — well under the plan's 50-file limit.

## Not verified here

- No live GUI proof that a real Claude session receives and obeys the shaping. Todo 10
  owns that and remains outstanding until the user reports it.
- The `_meta` and suppression were verified by building the request in tests, not by
  capturing a real `session/new` frame from a running Termul.