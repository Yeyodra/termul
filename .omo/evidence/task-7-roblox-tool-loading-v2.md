# Task 7 — Roblox instruction block and place-name plumbing

**Status: implemented and verified.** `cargo check`, `clippy -D warnings`, and
`cargo test --lib host_mcp` all exit 0 (180 passed, 1 ignored).

## What shipped

`src-tauri/src/acp/host_mcp/roblox/` — text only, no tools, no proxy, no router:

| File | Purpose |
| --- | --- |
| `mod.rs` | `pub mod instructions;` + the sibling-test wiring |
| `instructions.rs` | `STUDIO_MCP_TOOLS` (28 frozen names), `roblox_instructions(Option<&str>)`, `resolve_place_name()` |
| `instructions_tests.rs` | 12 tests (11 default + 1 `#[ignore]`) |

`pub mod roblox;` added to `src-tauri/src/acp/host_mcp/mod.rs:32`.

## The instruction text (verbatim)

```
Roblox Studio: this project drives the live place through Roblox Studio's own MCP tools, so a change to the place is a tool call, never a file. {target} These tools are upload_image, search_game_tree, script_search, skill, multi_edit, start_stop_play, get_console_output, user_mouse_input, store_image, http_get, character_navigation, script_read, get_studio_state, screen_capture, script_grep, wait_job_finished, generate_procedural_model, generate_texture, segment_mesh, user_keyboard_input, generate_mesh, subagent, execute_luau, generate_material, inspect_instance, search_asset, insert_asset, list_roblox_studios. Use them for anything the user asks for in the place — build and move instances with execute_luau, read the tree with search_game_tree, check state with get_studio_state, and screenshot with screen_capture to verify your own work. Do NOT write .lua files, Rojo projects, or any other file to disk to represent a place change: a file does nothing to the open place, and the user asked for the place to change. Pass studio_id only when more than one Studio is open; with a single Studio you may omit it and the call goes to that one. If a tool above is not in your current tool list, its schema is not loaded yet — call ToolSearch("select:<name>") to load it, then call the tool. Never conclude a Roblox tool is unavailable without trying ToolSearch first.
```

`{target}` is `The open place is "<name>".` when known, else
`A place is open in Roblox Studio.` — so `None` leaves no dangling punctuation.

## Requirements coverage

| Requirement | Where |
| --- | --- |
| names all 28 real tool names, bare | `STUDIO_MCP_TOOLS` const, joined into the text |
| `.lua` prohibition | "Do NOT write .lua files, Rojo projects, or any other file to disk to represent a place change" |
| `studio_id` may be omitted with one Studio | "Pass studio_id only when more than one Studio is open" |
| `ToolSearch` safety net | "call ToolSearch(\"select:<name>\") to load it … Never conclude a Roblox tool is unavailable without trying ToolSearch first" |
| place name embedded when supplied | `{target}` sentence |
| no RubloxKit-only tool names | `FORBIDDEN_TOOLS` test iterates 20 names + absence asserts |
| no `mcp__` / server prefix | bare-name rule + test |

The 28 names are frozen against a live `tools/list`
(`.omo/roblox-re/00-runtime-evidence.md` §E2), documented in the module header:
renaming or adding would describe tools the server does not have.

## Place-name plumbing

`resolve_place_name() -> Option<String>` resolves in **Rust**, not via a renderer
round-trip, because the `_meta` is constructed in Rust:

1. `crate::roblox::find_studio_mcp()` → `Option<PathBuf>` (per call; Studio
   relocates the exe into a new `version-<hash>` dir on every update).
2. `crate::roblox::session::probe(&exe).await` → `StudioSnapshot`.
3. `StudioSnapshot::place_name() -> Option<String>`.

Every failure — not installed, proxy error, no place loaded — is `None`. It never
panics and never returns `Err`, because it runs on the session-creation path. The
place name is user content and is **never logged** (only the error string is, at
`debug`).

**Not yet wired into `_meta`** — that is todo 5. This todo deliberately stops at
providing the function plus the text.

## Tests

11 default + 1 `#[ignore]`, all in `instructions_tests.rs`, asserting real content:

- `names_every_studio_mcp_tool` — iterates the `STUDIO_MCP_TOOLS` const so the
  assertion cannot silently drift.
- `rejects_a_tool_name_that_does_not_exist` — asserts `read_script` is absent,
  proving the list assertion is not vacuous (the real tool is `script_read`).
- `forbids_writing_lua_files`, `explains_when_studio_id_may_be_omitted`,
  `mentions_the_tool_search_safety_net`.
- `never_uses_an_agent_specific_tool_prefix` — no `mcp__`, no `roblox-studio_`.
- `never_names_a_robloxkit_only_tool` — iterates 20 forbidden names.
- `embeds_the_place_name_when_supplied`, `treats_a_blank_place_name_as_unknown`,
  `leaves_no_dangling_placeholder_without_a_place_name` (exact sentence-swap
  equality, so any stray placeholder fails).
- `stays_short_enough_to_be_read` — under 1500 chars, because
  `.omo/roblox-re/07-opencode-baseline.md` shows OpenCode succeeded with **no**
  instructions, so this must stay a paragraph.
- `resolve_place_name_never_fails_without_studio` — `#[ignore]`, because it spawns
  the real `StudioMCP.exe`.

## Two defects found and fixed during review

1. **A failing assertion that was simply wrong.** The test asserted
   `!text.contains("the place ")`, but the prose legitimately says "a change to
   **the place** is a tool call". The assertion was over-broad; it was removed.
   The real dangling-placeholder intent is still covered by five assertions,
   including the exact sentence-swap equality.
2. **A test that hung the suite.** `resolve_place_name_never_fails_without_studio`
   spawned a real `StudioMCP.exe` (the exe exists on disk even with Studio closed)
   and blocked `cargo test --lib host_mcp` past a 900 s timeout. Gated behind
   `#[ignore]` per the plan's rule that any test spawning the real binary is
   opt-in. The suite now finishes in 5.26 s.

## Verification (real exit codes)

```
cd src-tauri && cargo check --lib --bins
  Finished `dev` profile ... in 7m 45s            exit=0

cd src-tauri && cargo clippy --lib --bins -- -D warnings
  Finished `dev` profile ... in 8m 57s            exit=0

cd src-tauri && cargo test --lib host_mcp::roblox
  test result: ok. 11 passed; 0 failed; 1 ignored; 3419 filtered out

cd src-tauri && cargo test --lib host_mcp
  test result: ok. 180 passed; 0 failed; 1 ignored; 3250 filtered out; finished in 5.26s
```

## Not verified here

- The real 1.5k-char block has **not** been observed reaching a live model. Todo 2
  proved the `append` *channel* with a 266-char marker; this todo produced different
  text. Todo 5 wires it and todo 10 owns the GUI proof.
- Whether a ~1.4k-char append is *obeyed* (as opposed to simply delivered) is
  untested.
- Prompt-cache cost of appending at the `system.1` cache breakpoint is unmeasured.