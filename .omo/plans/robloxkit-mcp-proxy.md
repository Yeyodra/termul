# robloxkit-mcp-proxy - Work Plan

## TL;DR (For humans)

**What you'll get:** Tombol Roblox di Termul akhirnya benar-benar bekerja untuk Claude. Sekarang, kalau kamu bilang "buatkan gw objek meja", agent langsung membuat mejanya di Roblox Studio yang sedang terbuka — bukan menulis file `.lua` ke folder kosong lalu bilang bingung.

**Why this approach:** Ternyata masalahnya bukan Termul kurang fitur Roblox. Roblox Studio sudah terhubung, 28 tool-nya sudah sampai ke agent. Yang terjadi: Claude Code menunda pemuatan tool itu karena deskripsinya panjang, jadi agent cuma tahu namanya tanpa tahu cara memakainya. Kita pasang satu lapisan tipis di depan Studio yang memberi tahu Claude "muat semua tool ini sekarang juga", plus menjelaskan konteks Roblox-nya.

**What it will NOT do:** Tidak menambah 65 tool RobloxKit (pembuat 3D, ikon, SFX, admin Open Cloud) — itu proyek terpisah. Tidak mengubah Roblox Studio atau file Roblox apa pun. Tidak mengubah cara Termul terhubung ke agent lain seperti OpenCode, yang sudah terbukti bekerja tanpa perbaikan ini.

**Effort:** Medium
**Risk:** Medium - apakah Claude benar-benar menghormati penanda "muat selalu" itu belum pernah diuji langsung; rencana ini menguji itu lebih dulu sebelum membangun apa pun.

**Decisions to sanity-check:** (1) Proxy pakai stdio, bukan HTTP seperti RobloxKit — karena Termul tidak butuh batas proses ber-auth. (2) Penanda `always_load` dikirim ke semua agent tanpa cek nama agent — client yang tidak paham wajib mengabaikannya, jadi aman. (3) Proxy hanya aktif di project Roblox, supaya project lain tidak membayar ~14.000 token skema Roblox.

Your next move: review plan ini (sedang berjalan), lalu `$start-work`. Full execution detail follows below.

---

> TL;DR (machine): Medium effort, medium risk. Adds a stdio MCP proxy `robloxkit` that re-publishes StudioMCP's 28 tools with `_meta.always_load=true` + Roblox instructions, injected only for the Roblox project, to stop Claude Code deferring the tools behind ToolSearch. Phase 0 proves the mechanism before any proxy code is written.

## Scope

### Must have

- A `robloxkit` stdio MCP proxy child process that connects to `StudioMCP.exe` as its upstream and re-publishes the upstream tool list to the agent.
- Every proxied tool carries `_meta.always_load = true`.
- Every proxied tool's description carries a Roblox context prefix (the `DESCRIPTION_TAG` pattern).
- A `robloxkit` MCP `instructions` block naming the real StudioMCP tool names, the open place name, and an explicit prohibition on writing `.lua` files to disk instead of driving Studio.
- The proxy is injected into `session/new` only when the session's project is the Roblox project.
- While the proxy is active, the raw `roblox-studio` stdio entry is not also injected (no duplicate tool sets).
- A proxy spawn failure degrades to "no Roblox tools for this session", never to a failed session.
- Phase 0 empirical proof of whether `_meta.always_load` actually suppresses deferral, with two documented fallbacks if it does not.
- Sibling test files for all new Rust modules.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- MUST NOT implement any of the RobloxKit 93-tool surface: no `image_*`, `generate_3d`, `generate_vfx`, `generate_sfx`, `generate_icon`, `generate_skybox`, `generate_texture`, `generate_clothing`, `generate_gfx`, `generate_cutscene`, `create_animation`, no `publish_place` / `ban_user` / datastore / `restart_servers`, no `spawn_task` family, no `ytdl_*`.
- MUST NOT add HTTP or SSE transport for this proxy. stdio only.
- MUST NOT branch on an agent id (`claude-acp`, `codex-acp`, `opencode`, or any other) anywhere in Rust or TypeScript for this feature.
- MUST NOT filter, hide, or special-case the proxy per agent.
- MUST NOT modify `StudioMCP.exe`, any file under `%LOCALAPPDATA%\Roblox`, or any Roblox install artifact.
- MUST NOT write, seed, or read `CLAUDE.md`, `AGENTS.md`, or any project instruction file. Deferred deliberately: it is a second channel that would mask whether the MCP fix works.
- MUST NOT rename, alias, or "clean up" upstream tool names. Publish `execute_luau`, not `executeLuau`; publish `script_read`, not `read_script`.
- MUST NOT touch the canvas path (`canvas_tools`, `.figcraft`, `.pen`, `.op`) or the `figcraft` instruction block.
- MUST NOT change the persisted shape of the `roblox-studio` registry entry. Its enabled state is decided at injection time, not written back to disk.
- MUST NOT hardcode an absolute `StudioMCP.exe` path. It is re-resolved per call because Roblox installs each update under a new `version-<hash>` directory.

## Verification strategy

> Zero human intervention - all verification is agent-executed.

- Test decision: **tests-after**, with `cargo test` for Rust sibling modules and `vitest` for renderer. Rationale: the upstream wire shape is only known after todo 3 captures it; tests written earlier would encode a guess. This matches the repo convention of sibling `*_tests.rs` files (`src-tauri/src/roblox_tests.rs`).
- Framework: Rust built-in `#[test]` / `#[tokio::test]` in sibling files referenced via `#[cfg(test)] #[path = "..."] mod tests;` (see `src-tauri/src/roblox.rs:164-166`); renderer uses `vitest` (`bun run test`).
- Evidence: `.omo/evidence/task-<N>-robloxkit-mcp-proxy.md` (no ulw-loop session active, so the non-loop evidence root applies).

## Execution strategy

### Parallel execution waves

- **Wave 1 (Phase 0 - prove the mechanism):** todos 1, 2, 3. Nothing else may start until todo 1 reports a verdict. This wave exists to avoid building a proxy that solves nothing.
- **Wave 2 (proxy core, parallel after wave 1):** todos 4, 5, 6, 7.
- **Wave 3 (wiring, sequential on 4-7):** todos 8, 9, 10.
- **Wave 4 (tests + docs):** todos 11, 12.

### Dependency matrix

| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 4,5,6,7,8,9 | 3 |
| 2 | - | 9 | 3 |
| 3 | - | 4,5 | 1,2 |
| 4 | 1,3 | 5,7,8 | 6 |
| 5 | 3 | 7,8 | 4,6 |
| 6 | 1 | 7,8 | 4,5 |
| 7 | 4,5,6 | 8,11 | - |
| 8 | 4,5,6,7 | 9,11 | - |
| 9 | 2,7,8 | 10,11 | - |
| 10 | 9 | 11,12 | - |
| 11 | 7,8,9,10 | 12 | - |
| 12 | 11 | - | - |

## Todos

> Implementation + Test = ONE todo. Never separate.

- [ ] 1. Prove or disprove that `_meta.always_load` suppresses Claude Code tool deferral
  What to do / Must NOT do: Build a throwaway probe MCP server (a small Node script under `.omo/evidence/probe/`, NOT under `src/`) that serves exactly two fake tools, one with `_meta: {"always_load": true}` and one without. Point a Termul Claude session at it by temporarily adding it to the MCP registry. Send one prompt that requires the flagged tool. Read the resulting Claude Code transcript at `%USERPROFILE%\.claude\projects\C--Users-Novella-Documents-<cwd>\<sessionId>.jsonl` and inspect `attachment.type == "deferred_tools_delta"`: record whether the flagged tool name appears in `addedNames`. Also inspect whether a `<system-reminder>` block lists it as deferred. Write the verdict (WORKS / DOES NOT WORK / INCONCLUSIVE) with the exact JSON lines quoted into `.omo/evidence/task-1-robloxkit-mcp-proxy.md`. MUST NOT modify any file under `src/` or `src-tauri/src/`. MUST NOT leave the probe server registered in the MCP registry afterwards (remove it and confirm `store.json` no longer lists it).
  Parallelization: Wave 1 | Blocked by: none | Blocks: 4,5,6,7,8,9
  References (executor has NO interview context - be exhaustive): `.omo/roblox-re/06-root-cause-verdict.md` (the deferral mechanism, threshold math, and the `alwaysLoad`/`always_load` string offsets); `.omo/roblox-re/00-runtime-evidence.md` §E3 (how the registry entry and `--mcp-config` look); `src/renderer/lib/roblox-studio-mcp.ts:11-21` (`robloxStudioEntry` — the exact `StoredMcpServer` shape to imitate for the probe); `src/renderer/stores/acp-store/slices/mcp.ts` (`saveMcpServer` / `deleteMcpServer`); `%APPDATA%\com.termul-manager.app\store.json` key `data."shared/lww/acp/mcp-servers"`.
  Acceptance criteria (agent-executable): `.omo/evidence/task-1-robloxkit-mcp-proxy.md` exists and contains (a) the verdict token, (b) at least one verbatim `deferred_tools_delta` JSON line, (c) the two tool names, (d) a statement that the probe entry was removed from the registry.
  QA scenarios (name the exact tool + invocation): happy = probe server registered, flagged tool called successfully without ToolSearch; failure = probe server pointed at a dead command, confirm the session still starts and the transcript shows the server in `failedMcpServers`. Evidence `.omo/evidence/task-1-robloxkit-mcp-proxy.md`.
  Commit: N | research only, no product change

- [ ] 2. Determine whether `ENABLE_TOOL_SEARCH=<n>` suppresses deferral, as the primary fallback
  What to do / Must NOT do: Only run this if todo 1 reports DOES NOT WORK or INCONCLUSIVE; otherwise record "not needed" and stop. Launch the same probe from todo 1 with the env var set on the agent process, testing two values: `ENABLE_TOOL_SEARCH=100` and `ENABLE_TOOL_SEARCH=auto`. Determine how Termul sets env on a spawned agent (the agent config `env` map) and use that path — do not hack the process environment globally. Record for each value whether `deferred_tools_delta` still lists the tools, and quote the `debugDescription` string from the `auto_above_threshold` / `auto_below_threshold` log line if it appears. Append the verdict to `.omo/evidence/task-2-robloxkit-mcp-proxy.md`. MUST NOT change any file under `src/` or `src-tauri/src/`.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 9
  References: `.omo/roblox-re/06-root-cause-verdict.md` (the decoded `f7e()` / `wfr()` / `hfr=2.5` / `c7e=10` threshold logic and the full list of `Tool search disabled: ...` messages); `src/renderer/lib/agents/acp-registry.ts:120-169` (`AgentPolicy` shape, where a per-agent env would live if one is needed); `src-tauri/src/acp/manager/gates.rs` (`build_internal_plan_stdio` shows how env is attached to an `McpServerStdio`).
  Acceptance criteria (agent-executable): `.omo/evidence/task-2-robloxkit-mcp-proxy.md` states, for each of the two values, whether deferral stopped, and names the exact mechanism used to set the env var with a file:line.
  QA scenarios: happy = env var set, deferral stops, transcript quoted; failure = env var has no effect, verdict recorded as such with the transcript showing `addedNames` unchanged. Evidence `.omo/evidence/task-2-robloxkit-mcp-proxy.md`.
  Commit: N | research only, no product change

- [ ] 3. Capture the real StudioMCP upstream frames the proxy must relay
  What to do / Must NOT do: Spawn `StudioMCP.exe` (resolved via the same scan as `find_studio_mcp_in`) from a throwaway script and capture, verbatim and complete: the `initialize` result, the `notifications/initialized` exchange, the full `tools/list` result, and one `tools/call` result for `get_studio_state`. Save the raw JSON lines to `.omo/evidence/task-3-robloxkit-mcp-proxy.md` plus a summarized table of each tool's `name`, description length, and `inputSchema.required` array. Explicitly record the `protocolVersion` and `serverInfo` the upstream reports. MUST NOT call any upstream tool that mutates the place — read-only calls only (`get_studio_state`, `list_roblox_studios`, `inspect_instance`, `script_read`). MUST NOT run this against a place in Play mode without noting it.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 4,5
  References: `src-tauri/src/roblox/session.rs:218-257` (`StudioSession::spawn` — the exact stdio wiring to copy); `src-tauri/src/roblox/session.rs:30` (`PROTOCOL_VERSION = "2025-11-25"`); `src-tauri/src/roblox/session.rs:317-364` (`parse_studios` / `entries_from_document` — how the MCP content-block envelope is shaped); `src-tauri/src/roblox.rs:48-62` (`find_studio_mcp_in`); `.omo/roblox-re/03-studiomcp-tool-surface.md` (the 28 tool names already enumerated).
  Acceptance criteria (agent-executable): the evidence file contains the verbatim `initialize` result and a `tools/list` result whose `tools` array length is recorded; the per-tool table has 28 rows; no write-capable tool was invoked.
  QA scenarios: happy = Studio open, frames captured, 28 tools counted; failure = Studio closed, record the exact error and note that todo 4 must therefore be written against the schema rather than a captured frame. Evidence `.omo/evidence/task-3-robloxkit-mcp-proxy.md`.
  Commit: N | research only, no product change

- [ ] 4. Add the upstream StudioMCP stdio client module for the proxy
  What to do / Must NOT do: Create `src-tauri/src/acp/host_mcp/roblox/upstream.rs` with a client that spawns `StudioMCP.exe`, performs `initialize` + `notifications/initialized`, and exposes `list_tools() -> Vec<rmcp Tool>` and `call_tool(name, args) -> Value`. Reuse the framing and pending-map design from `roblox/session.rs` rather than inventing a second protocol layer; if the existing `roblox::session::Client` is reusable as-is, depend on it instead of duplicating. Resolve the exe through `crate::roblox::find_studio_mcp()` on every construction — never cache it. Bound every request with a timeout and map a dead child to an `Err`, not a panic. MUST NOT modify `roblox/session.rs` behaviour used by the status lamp. MUST NOT cache the exe path. MUST NOT log tool arguments or the place name.
  Parallelization: Wave 2 | Blocked by: 1,3 | Blocks: 5,7,8
  References: `src-tauri/src/roblox/session.rs:53-183` (`Client`: `write_frame`, `request`, `read_loop`, pending map); `src-tauri/src/roblox/session.rs:218-277` (`StudioSession::spawn`, `is_alive`, `Drop`); `src-tauri/src/roblox/session.rs:37` (`REQUEST_TIMEOUT`); `src-tauri/src/process_util.rs` (`hide_console`, `KillOnCloseJob`); `src-tauri/src/roblox.rs:38-43` (`find_studio_mcp`); `.omo/evidence/task-3-robloxkit-mcp-proxy.md` (the captured frames).
  Acceptance criteria (agent-executable): `cargo check --lib` passes; the module compiles with `#![deny(clippy::unwrap_used)]`-clean code (no `unwrap`/`expect` outside tests); a unit test in `src-tauri/src/acp/host_mcp/roblox/upstream_tests.rs` drives the client against an in-memory duplex and asserts `list_tools` returns the mocked tools and a timed-out request returns `Err`.
  QA scenarios: happy = mock upstream returns 2 tools, `list_tools` yields 2; failure = mock upstream never answers, `call_tool` returns `Err` within the timeout and the process does not hang. Evidence `.omo/evidence/task-4-robloxkit-mcp-proxy.md`.
  Commit: Y | feat(roblox): add a stdio upstream client for StudioMCP

- [ ] 5. Re-publish upstream tools with `_meta.always_load` and a context prefix
  What to do / Must NOT do: Create `src-tauri/src/acp/host_mcp/roblox/tools.rs`. Take `Vec<rmcp::model::Tool>` from upstream and map each to a new `Tool` built with `Tool::new(...)` then `.with_meta(...)` (the struct is `#[non_exhaustive]` — a struct literal will not compile) and a description prefixed with a `ROBLOX_DESCRIPTION_TAG` constant modelled on `canvas_tools::DESCRIPTION_TAG`. Set `_meta.always_load = true` on every tool. Preserve `name`, `input_schema`, `title`, `output_schema`, `annotations`, `icons` exactly. If todo 1 reported DOES NOT WORK, gate the `always_load` key behind a single named constant so it can be flipped off in one place — do not delete the code path. MUST NOT rename any tool. MUST NOT drop or reorder `inputSchema.required`. MUST NOT strip `studio_id` from any schema even though the upstream tolerates its absence at runtime.
  Parallelization: Wave 2 | Blocked by: 3 | Blocks: 7,8
  References: `C:\Users\Novella\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\rmcp-3.5.0\src\model\tool.rs:14-40` (`Tool` fields, `#[non_exhaustive]`, `#[serde(rename = "_meta")] pub meta: Option<MetaObject>`); `...\tool.rs:161-240` (`Tool::new` and `with_meta`); `src-tauri/src/acp/host_mcp/canvas_tools.rs:20-24` (`DESCRIPTION_TAG` precedent and its rationale); `.omo/roblox-re/06-root-cause-verdict.md` (why `always_load` is the mechanism); `.omo/evidence/task-1-robloxkit-mcp-proxy.md` (the verdict that decides whether the key stays).
  Acceptance criteria (agent-executable): a test in `roblox/tools_tests.rs` builds from a 2-tool mock upstream and asserts (a) both tools survive with identical `name` and `input_schema`, (b) both serialise to JSON containing `"_meta":{"always_load":true}`, (c) each description starts with the tag.
  QA scenarios: happy = mock with 2 tools → 2 tools out, both carrying `_meta`; failure = mock with a tool whose `input_schema` is an empty object → still passes through unchanged, no panic. Evidence `.omo/evidence/task-5-robloxkit-mcp-proxy.md`.
  Commit: Y | feat(roblox): re-publish Studio tools with always_load metadata

- [ ] 6. Author the Roblox instruction block
  What to do / Must NOT do: Create `src-tauri/src/acp/host_mcp/roblox/instructions.rs` exposing `roblox_instructions(place_name: Option<&str>) -> String`. Content must state, in plain English: this project drives a live Roblox place through the `robloxkit` MCP server; name the real tool names (`execute_luau`, `inspect_instance`, `search_game_tree`, `script_read`, `script_grep`, `script_search`, `multi_edit`, `get_studio_state`, `get_console_output`, `start_stop_play`, `generate_procedural_model`, `generate_mesh`, `generate_texture`, `generate_material`, `insert_asset`, `search_asset`, `screen_capture`, `character_navigation`, `user_mouse_input`, `user_keyboard_input`, `upload_image`, `store_image`, `segment_mesh`, `wait_job_finished`, `subagent`, `skill`, `http_get`, `list_roblox_studios`); instruct that changes to the place go through those tools and MUST NOT be written as `.lua` files on disk; state that `studio_id` may be omitted when a single Studio is open; state that if a tool is not yet available the agent should load it via the tool-search mechanism before concluding it is unavailable; and include the open place name when supplied. Refer to tools by bare name only — never prefix them with `mcp__` or `<server>_`. MUST NOT copy RobloxKit's `instructions.md` text (its tool names do not exist here). MUST NOT mention any RobloxKit-only tool. MUST NOT hardcode a server-name prefix.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 7,8
  References: `.omo/roblox-re/07-opencode-baseline.md` (OpenCode succeeded with no instructions, so this block is for Claude's deferral case plus the place name — keep it tight); `.omo/roblox-re/02-robloxkit-proxy-architecture.md` §5.2 (RobloxKit's three-layer model, for shape not content); `src-tauri/src/acp/host_mcp/mod.rs:78-95` (`TERMUL_CHAT_INSTRUCTIONS` and `session_instructions` — the composition point); `src-tauri/src/acp/host_mcp/canvas_tools.rs:26-47` (`CANVAS_GUIDE` — the prose style to match); `.omo/roblox-re/00-runtime-evidence.md` §E2 (the verified 28-tool list).
  Acceptance criteria (agent-executable): a test in `roblox/instructions_tests.rs` asserts the string contains all 28 tool names, contains the phrase forbidding `.lua` files, contains `studio_id`, and contains no `mcp__` substring; and that `place_name: Some("X")` embeds `X` while `None` does not emit an empty placeholder.
  QA scenarios: happy = `Some("Untitled Experience")` embeds the name; failure = `None` produces text with no dangling `: ` or `(none)`. Evidence `.omo/evidence/task-6-robloxkit-mcp-proxy.md`.
  Commit: Y | feat(roblox): add the Roblox session instruction block

- [ ] 7. Add the `robloxkit` child entrypoint and wire both binaries
  What to do / Must NOT do: Create `src-tauri/src/acp/host_mcp/roblox/mod.rs` with `pub fn run() -> i32` that builds an `rmcp` server whose `get_info()` returns the Roblox `instructions` and whose `list_tools` / `call_tool` are driven by a **runtime** `ToolRouter` built with `ToolRouter::new()` + `add_route(ToolRoute::new_dyn(...))` per upstream tool (the `#[tool_router]` macro cannot express a dynamic list). On `call_tool`, forward to the upstream client from todo 4. Add `pub const CHILD_ARG_ROBLOX: &str = "--internal-mcp-roblox-server";` and `pub fn is_roblox_child_invocation() -> bool` to `host_mcp/mod.rs` beside the existing `CHILD_ARG`. Add the branch to **both** `src-tauri/src/main.rs` and `src-tauri/src/server_main.rs`, BEFORE any Tauri init, mirroring the existing plan-child branch. If upstream is unreachable, the child must still serve `initialize` with the instructions and an empty tool list rather than exiting non-zero. MUST NOT use the `#[tool_router]`/`#[tool]` macros for the dynamic set. MUST NOT update only one of the two binaries. MUST NOT let the child initialise Tauri, logging sinks, or `AppHandle`.
  Parallelization: Wave 2 | Blocked by: 4,5,6 | Blocks: 8,11
  References: `src-tauri/src/acp/host_mcp/mod.rs:48-62` (`CHILD_ARG`, `is_child_invocation`, and the comment about the two entrypoints not drifting); `src-tauri/src/main.rs:17-26` and `src-tauri/src/server_main.rs:70-80` (the two branches to mirror); `src-tauri/src/acp/host_mcp/child.rs:81-120` (`run()` shape), `:368-380` (`get_info` + `with_instructions`), `:529` (`serve_server`); `C:\Users\Novella\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\rmcp-3.5.0\src\handler\server\router\tool.rs:197` (`ToolRoute::new_dyn`), `:389-440` (`ToolRouter::new`, `add_route`).
  Acceptance criteria (agent-executable): `cargo check --lib --bins` passes; running `termul-manager --internal-mcp-roblox-server` with stdin closed exits cleanly (no panic, exit code recorded); a test in `roblox/tests.rs` asserts `is_roblox_child_invocation()` is false for `["termul-manager"]` and true for `["termul-manager","--internal-mcp-roblox-server"]`, and that the plan flag does not satisfy it.
  QA scenarios: happy = spawn the child with a mocked upstream, send `initialize` + `tools/list` on stdin, receive the Roblox instructions and 2 tools; failure = spawn with `STUDIO_MCP_EXE` pointing at a nonexistent file, confirm `initialize` still answers with the instructions and `tools/list` returns an empty array. Evidence `.omo/evidence/task-7-robloxkit-mcp-proxy.md`.
  Commit: Y | feat(roblox): add the robloxkit MCP proxy child

- [ ] 8. Build and register the proxy as an injected stdio server
  What to do / Must NOT do: Add `build_internal_roblox_stdio()` to `src-tauri/src/acp/manager/gates.rs`, modelled on `build_internal_plan_stdio`, returning a single `McpServer::Stdio` named `robloxkit` that runs `current_exe()` with `CHILD_ARG_ROBLOX`. It needs no port or token (unlike the plan child) — pass nothing but the arg. Wire it into `AcpManager::new_session_with_context` beside the existing plan-server prepend so the combined list is `[termul, robloxkit, ...user servers]`. MUST NOT add a TCP listener, port, or bearer token. MUST NOT touch the plan-child path. MUST NOT reorder the plan server away from first position.
  Parallelization: Wave 3 | Blocked by: 4,5,6,7 | Blocks: 9,11
  References: `src-tauri/src/acp/manager/gates.rs:112-137` (`build_internal_plan_stdio` — the exact template); `src-tauri/src/acp/manager/mod.rs:1049-1075` (`new_session_with_context`, the `combined_mcp_servers` construction and `inject_oauth_tokens` / `gate_mcp_servers` call sites); `src-tauri/src/acp/manager/mod.rs:1216-1224` (`prepare_reopen_mcp` — the reopen path that must also carry the proxy); `src-tauri/src/acp/host_mcp/mod.rs:51` (where the new const lives).
  Acceptance criteria (agent-executable): a test in `src-tauri/src/acp/manager/gates_tests.rs` (or the existing manager test file) asserts `build_internal_roblox_stdio()` returns exactly one `McpServer::Stdio` named `robloxkit`, whose `args` contain only `CHILD_ARG_ROBLOX`, and that `gate_mcp_servers` accepts it under `AgentCapabilities::default()`.
  QA scenarios: happy = default capabilities accept it; failure = an agent advertising no MCP capabilities still accepts it (stdio is unconditional). Evidence `.omo/evidence/task-8-robloxkit-mcp-proxy.md`.
  Commit: Y | feat(roblox): inject the robloxkit proxy into Roblox sessions

- [ ] 9. Gate the proxy on the Roblox project and suppress the duplicate raw entry
  What to do / Must NOT do: In `new_session_with_context`, resolve whether the session's project is the Roblox project and, only then, prepend the proxy and drop any incoming `McpServer::Stdio` whose name is `roblox-studio`. Determine the project's identity through the existing project registry rather than string-matching a path; if the only available signal is the project name, compare against `ROBLOX_PROJECT_NAME` and document why. Apply the same rule on the reopen path (`prepare_reopen_mcp`) so a reopened chat keeps working. When the proxy is not injected, pass the user's server list through untouched. MUST NOT mutate or write back the persisted registry — the suppression is per-session only. MUST NOT apply the proxy to a non-Roblox project. MUST NOT drop any server other than the exact upstream `roblox-studio` stdio entry.
  Parallelization: Wave 3 | Blocked by: 2,7,8 | Blocks: 10,11
  References: `src-tauri/src/acp/manager/mod.rs:1034-1090` (`new_session_with_context` signature, `project_id`, and the combined-list build); `src-tauri/src/acp/manager/mod.rs:1200-1230` (`prepare_reopen_mcp`); `src-tauri/src/acp/project_registry.rs` (project lookup surface, including the `mcp_servers` field at `:70`); `src/renderer/lib/roblox-studio-mcp.ts:8-9` (`ROBLOX_STUDIO_MCP_ID = 'roblox-studio'`, `ROBLOX_PROJECT_NAME = 'Roblox'`); `src-tauri/src/roblox.rs:23` (`WORKSPACE_DIR_NAME = "RobloxKit"`); `.omo/roblox-re/00-runtime-evidence.md` §E3 (the live `--mcp-config` showing both servers today).
  Acceptance criteria (agent-executable): tests assert (a) a Roblox-project session receives `robloxkit` and not `roblox-studio`; (b) a non-Roblox session receives neither; (c) a non-Roblox session that itself registered a server named `roblox-studio` keeps it; (d) `prepare_reopen_mcp` applies the same rule.
  QA scenarios: happy = Roblox project → list contains `robloxkit`, excludes `roblox-studio`; failure = project id resolves to nothing → list passes through unchanged and the session still starts. Evidence `.omo/evidence/task-9-robloxkit-mcp-proxy.md`.
  Commit: Y | feat(roblox): scope the proxy to the Roblox project

- [ ] 10. Make a proxy failure non-fatal for every session
  What to do / Must NOT do: Audit and prove that a failure to build, spawn, or connect the proxy cannot fail `new_session_with_context`. If `build_internal_roblox_stdio` cannot resolve `StudioMCP.exe`, skip injection and log a warning rather than returning `Err`. If the child dies mid-session, the agent must see an MCP server that is present-but-empty, not a broken session. Add a regression test that forces the missing-exe path and asserts a session is still created. MUST NOT convert any proxy problem into a `session/new` error. MUST NOT log the place name or any tool arguments.
  Parallelization: Wave 3 | Blocked by: 9 | Blocks: 11,12
  References: `src-tauri/src/acp/manager/mod.rs:1075-1090` (where `inject_oauth_tokens` and `gate_mcp_servers` can return `Err` and abort a session — the hazard); `src-tauri/src/acp/manager/gates.rs:37-56` (`gate_mcp_servers` error paths); `src-tauri/src/roblox.rs:38-43` (`find_studio_mcp` returning `None`); `.omo/roblox-re/00-runtime-evidence.md` §E11 (six `termul-manager` processes — a stale-process trap to be aware of during QA).
  Acceptance criteria (agent-executable): a test forces `find_studio_mcp` to `None` (via `STUDIO_MCP_EXE` pointing at a missing file plus a bogus `LOCALAPPDATA`) and asserts `new_session_with_context` still yields a session with the plan server present and the proxy absent, and that no `Err` is returned.
  QA scenarios: happy = exe present → proxy injected; failure = exe absent → session created, proxy skipped, warning logged without the place name. Evidence `.omo/evidence/task-10-robloxkit-mcp-proxy.md`.
  Commit: Y | fix(roblox): never fail a session when the proxy is unavailable

- [ ] 11. Add the sibling Rust test suites and run the affected checks
  What to do / Must NOT do: Ensure every new module has a sibling `*_tests.rs` wired with `#[cfg(test)] #[path = "..."] mod tests;` (repo convention — never inline `mod tests`). Cover: upstream client happy/timeout/dead-child; tool re-publish field preservation and `_meta` serialisation; instruction content assertions; child arg detection; gate acceptance; project scoping; missing-exe degradation. Then run `cargo check --lib --bins`, `cargo clippy --lib --bins -- -D warnings`, `cargo test --lib roblox`, and `bun run typecheck`. Record exact commands and their output tails. MUST NOT use the `#[tool_router]` macro in any test fixture. MUST NOT leave a test that spawns the real `StudioMCP.exe` in the default suite — gate any such test behind `#[ignore]`.
  Parallelization: Wave 4 | Blocked by: 7,8,9,10 | Blocks: 12
  References: `src-tauri/src/roblox.rs:164-166` (the `#[cfg(test)] #[path = "roblox_tests.rs"] mod tests;` convention); `src-tauri/src/acp/host_mcp/child/tests.rs` (a working example of testing an rmcp server over an in-memory transport); `AGENTS.md` (≤50 files per PR; sibling test files; ~800 prod-line ceiling); `docs/roblox-studio-status-indicator.md` §7 (the `cargo test --lib` trap on this machine and the throwaway-crate workaround).
  Acceptance criteria (agent-executable): `cargo check --lib --bins` exits 0; `cargo clippy --lib --bins -- -D warnings` exits 0; `cargo test --lib roblox` reports 0 failures; `bun run typecheck` exits 0; the file count in the diff is ≤50.
  QA scenarios: happy = all four commands exit 0 with the counts recorded; failure = if `cargo test --lib` cannot run on this machine (the documented `STATUS_ENTRYPOINT_NOT_FOUND` trap), reproduce the logic in a throwaway crate and record that instead, explicitly labelled as a workaround. Evidence `.omo/evidence/task-11-robloxkit-mcp-proxy.md`.
  Commit: Y | test(roblox): cover the robloxkit proxy end to end

- [ ] 12. Write the manual QA recipe and the closeout record
  What to do / Must NOT do: Write `.omo/evidence/task-12-robloxkit-mcp-proxy.md` containing a numbered, copy-pasteable manual QA recipe for the user, because the final proof needs a GUI: open Studio with a place, open Termul on the Roblox project, pick Claude, send exactly `buatkan gw objek meja` with no mention of MCP, then check (a) the newest `~/.claude/projects/C--Users-Novella-Documents-RobloxKit/*.jsonl` has a `deferred_tools_delta` whose `addedNames` does NOT include `mcp__robloxkit__*` (or includes it but the tools are callable), (b) an assistant `tool_use` names a Roblox tool, (c) the Workspace child count in Studio increased. Also record the comparison baseline: the same prompt on OpenCode already works (`.omo/roblox-re/07-opencode-baseline.md`), so the fix is Claude-only by construction. Include the rollback: remove the proxy injection and the raw entry resumes. MUST NOT claim the fix is verified from unit tests alone — the manual gate is mandatory and must be stated as outstanding until the user reports it.
  Parallelization: Wave 4 | Blocked by: 11 | Blocks: none
  References: `.omo/roblox-re/07-opencode-baseline.md` (the exact OpenCode transcript shape to expect on the Claude side after the fix); `.omo/roblox-re/00-runtime-evidence.md` §E4-§E5 (the pre-fix failure signature to compare against); `.omo/roblox-re/06-root-cause-verdict.md` (the deferral evidence to re-check); `docs/roblox-studio-status-indicator.md` §8 (the existing manual verification checklist style).
  Acceptance criteria (agent-executable): the evidence file contains the numbered recipe, the three pass conditions with exact file paths and JSON keys, the rollback steps, and an explicit "STATUS: awaiting user confirmation" line.
  QA scenarios: happy = recipe executed by the user and reported passing; failure = user reports the agent still writes `.lua` files → file already lists the next diagnostics (check `deferred_tools_delta` first, then whether `_meta` survived into `--mcp-config`). Evidence `.omo/evidence/task-12-robloxkit-mcp-proxy.md`.
  Commit: Y | docs(roblox): add the proxy manual QA recipe

## Final verification wave

> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy

- One commit per todo that changes product code (todos 4-12), each a conventional commit with a `roblox` scope.
- Todos 1-3 are research only: their evidence files live under `.omo/evidence/` and are committed separately as `docs(roblox): ...` or not at all if the repo ignores `.omo/`.
- No commit may mix the proxy work with the canvas path, the plan child, or the status-lamp modules.
- If the diff exceeds 50 files, split into: (a) proxy core + tests, (b) wiring + scoping, (c) docs.
- Never commit a `--reset --force` plan artifact, a probe server left in the registry, or an evidence file containing a place name or a token.

## Success criteria

- A Claude session on the Roblox project, given the prompt `buatkan gw objek meja` with no mention of MCP, calls a Roblox Studio tool and changes the live place — verified by a `tool_use` entry in the Claude transcript and a changed Workspace child count in Studio.
- `deferred_tools_delta` for that session no longer lists the Roblox tools as schema-less, or lists them and the agent calls them successfully anyway.
- No non-Roblox project's `session/new` changes in any observable way.
- A machine with no Roblox install, or with Studio closed, still starts every session successfully.
- `cargo check`, `cargo clippy -D warnings`, `cargo test --lib roblox`, and `bun run typecheck` all pass.
- The diff touches ≤50 files and contains zero agent-id branches.
- The user has run the manual QA recipe and reported it passing.
