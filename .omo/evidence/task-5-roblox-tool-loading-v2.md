# Task 5 — Ship the instruction carrier (`_meta.systemPrompt.append`)

**Status: implemented and verified.** `cargo check`, `clippy -D warnings`, and four
test suites all exit 0.

## What shipped

`RobloxEagerLoad` (`src-tauri/src/acp/manager/gates.rs`) now emits the Roblox
instruction block alongside the Mechanism A′ flag, from **one** builder.

Emitted `_meta` for an active Roblox Claude session:

```json
{
  "claudeCode": {
    "options": {
      "thinking": { "type": "adaptive", "display": "summarized" },
      "mcpServers": {
        "roblox-studio": {
          "type": "stdio",
          "command": "<resolved StudioMCP.exe>",
          "args": [], "env": {},
          "alwaysLoad": true
        }
      }
    }
  },
  "systemPrompt": { "append": "<roblox_instructions(place_name)>" }
}
```

For a non-Roblox session the output is byte-identical to before: `claudeCode.options.thinking`
only, no `systemPrompt`, no `mcpServers`.

## Why the object form, not a string

The adapter at `acp-agent.js:8535-8551` treats the two forms very differently:

- **string** → `systemPrompt = customPrompt` — a **full replacement**.
- **object** → spread, with `type`/`preset` locked afterwards — **additive**.

Todo 2 measured the string form's effect: the preset prompt collapsed from 5774 to
170 characters, deleting `# Harness`, `# Memory`, `# Environment` and
`# Context management` — and the session still exited 0. That is why
`append_is_an_additive_object_never_a_replacement_string` asserts both that
`systemPrompt` is an object and that it carries no client-side `type`/`preset`.

## Place-name resolution

Chosen approach **(a)**: the place name is resolved by the caller and passed into
`meta_with_place_name(Option<&str>)`.

Two layers were needed:

- `shape_session_request` / `shape_session_request_opt` (production) call
  `resolve_place(roblox)`, which probes **only when `is_active()`** — a non-Roblox
  session never spawns a `StudioMCP.exe` child.
- `shape_session_request_with_place` / `shape_session_request_opt_with_place` take an
  already-resolved name, so tests exercise the shaping without touching a live Studio.

That split was not cosmetic: the first attempt called `resolved_meta()` unconditionally
from the shaping functions, and `cargo test --lib acp::manager` **hung past a 600 s
timeout** because the fake `with_studio_command` path made `is_active()` true and the
test then probed the real machine. Splitting the functions fixed it; the suite now runs
in 18.56 s.

## Studio-missing decision

The append is emitted **only when the shaping is active**, i.e. only when
`StudioMCP.exe` resolved. With no Studio the tools are not connected, so naming them
would point the agent at tools it cannot call — strictly worse than silence. Asserted
by `inert_roblox_meta_appends_nothing`. A useful side effect: no Studio means no probe,
so no child process is spawned on that path either.

## Files changed

| File | Change |
| --- | --- |
| `src-tauri/src/acp/manager/gates.rs` | `meta_with_place_name(Option<&str>)`; `shape_session_request{,_opt}_with_place`; `resolve_place` (active-only probe); `meta()` demoted to a `#[cfg(test)]` shim; dead `resolved_meta()` removed |
| `src-tauri/src/acp/manager/command_loop.rs` | the three call sites (`session/new`, `session/load`, `session/resume`) await the shaping |
| `src-tauri/src/acp/manager/tests.rs` | 6 new tests; 2 existing shaping tests moved to the `with_place` variants |

## Tests added

| Test | Guards |
| --- | --- |
| `active_roblox_meta_appends_the_instruction_block` | append non-empty and contains `execute_luau`, `ToolSearch`, `.lua`, and the place name |
| `append_is_an_additive_object_never_a_replacement_string` | object form, has `append`, no `type`/`preset` |
| `thinking_always_load_and_the_append_coexist_in_one_meta` | all three keys in ONE `_meta` — nothing clobbered |
| `inert_roblox_meta_appends_nothing` | no `systemPrompt` without Studio; `thinking` still present |
| `append_without_a_place_name_has_no_dangling_placeholder` | non-empty, no `""`, no `(unknown)` |
| `non_claude_agents_get_an_unchanged_server_list_and_no_meta` | non-Claude untouched (updated to `_with_place`) |
| `reopen_shaping_keeps_an_absent_server_list_absent` | `None` stays `None` (updated to `_with_place`) |

## Verification (real exit codes)

```
cd src-tauri && cargo check --lib --bins
  Finished `dev` ... in 1m 13s                        exit=0

cd src-tauri && cargo clippy --lib --bins -- -D warnings
  Finished `dev` ... in 40.92s                        exit=0

cd src-tauri && cargo test --lib acp::manager
  test result: ok. 166 passed; 0 failed; 0 ignored; 3270 filtered out; 18.56s

cd src-tauri && cargo test --lib host_mcp
  test result: ok. 180 passed; 0 failed; 1 ignored; 3255 filtered out; 9.74s

cd src-tauri && cargo test --lib web::ws
  test result: ok. 325 passed; 0 failed; 0 ignored; 3111 filtered out; 12.50s

cd src-tauri && cargo test --lib roblox
  test result: ok. 67 passed; 0 failed; 1 ignored; 3368 filtered out; 0.09s
```

## Guardrails checked

- Object form only; never a bare string (measured hazard, see above).
- No `systemPrompt` for non-Roblox projects or non-Claude agents
  (`shape_session_request` returns `(servers, None)` before building any meta).
- Nothing persisted to `store.json`; `_meta` is per-request.
- No `Err` path: `resolve_place_name()` returns `Option` and never fails a session.
- No hardcoded absolute `StudioMCP.exe` path (resolved per call).
- No literal `agent_id == "claude-acp"` comparison (still `profile.summarize_thinking`).
- `resolve_place` is guarded by `is_active()`, so a non-Roblox session never spawns a child.
- No changes to `instructions.rs` prose.

## Not verified here

- The block has **not** been observed reaching a live model in a real Termul session.
  Todo 2 proved the channel with a 266-char marker; this ships ~1.4k chars. Todo 10 owns
  the GUI proof and remains outstanding until the user reports it.
- Whether the model *obeys* the block is untested.
- Prompt-cache cost of appending at the `system.1` cache breakpoint is unmeasured.