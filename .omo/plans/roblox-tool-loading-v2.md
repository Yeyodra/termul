# roblox-tool-loading-v2 - Work Plan

## TL;DR (For humans)

**What you'll get:** Tombol Roblox di Termul akhirnya bekerja untuk Claude. Bilang "buatkan gw objek meja", dan agent langsung membangun mejanya di Roblox Studio yang sedang terbuka — bukan menulis file `.lua` ke folder kosong lalu mengaku bingung.

**Why this approach:** Roblox Studio sudah terhubung dan 28 tool-nya sudah sampai ke agent. Masalahnya Claude Code menunda pemuatan tool itu karena deskripsinya panjang, jadi agent hanya tahu namanya tanpa tahu cara memakainya. Rencana ini mencoba tiga cara mengatasinya secara berurutan dari yang paling murah, dan berhenti begitu satu berhasil — bukan langsung membangun yang paling besar.

**What it will NOT do:** Tidak menambah 65 tool RobloxKit (pembuat 3D, ikon, SFX, admin Open Cloud) — itu proyek terpisah. Tidak mengubah Roblox Studio atau file Roblox apa pun. Tidak mengubah perilaku agent lain seperti OpenCode, yang sudah terbukti bekerja tanpa perbaikan ini.

**Effort:** Short (jika cara pertama berhasil) sampai Medium (jika harus sampai proxy)
**Risk:** Low-Medium - risiko rendah karena tiap tahap diverifikasi dulu sebelum lanjut; driver risikonya adalah apakah dua cara termurah benar-benar bekerja.

**Decisions to sanity-check:** (1) Tiga cara dicoba berurutan, berhenti di yang pertama berhasil — supaya tidak membangun proxy 250 baris kalau 15 baris cukup. (2) Dua cara pertama khusus Claude dan itu diterima, karena sifatnya menambah dan tidak merusak agent lain. (3) Instruksi Roblox tetap dikirim di semua varian, karena murah dan hanya itu yang membawa nama place.

Your next move: `$start-work`. Full execution detail follows below.

---

> TL;DR (machine): Short-Medium effort. Phase 0 empirically tests escalating mechanisms to stop Claude Code deferring the 28 StudioMCP tools, stops at the first that works, and always ships a Roblox instruction block. **Amended before execution** per `.omo/roblox-re/08-correction-alwaysLoad.md`, whose open question is now resolved in `.omo/roblox-re/09-verified-metapath.md`: the cheapest mechanism is server-level `alwaysLoad` delivered via `_meta.claudeCode.options.mcpServers` (NOT the ACP `mcpServers` array, which the adapter projects to four fields), with the server removed from that array to avoid the spread-order overwrite. The stdio proxy is the last resort, not the centrepiece.

## Scope

### Must have

- Phase 0 that empirically establishes which mechanism suppresses tool deferral, evidenced by a real Claude Code transcript.
- Mechanism A′: per-session `_meta.claudeCode.options.mcpServers["roblox-studio"].alwaysLoad = true`, with `roblox-studio` removed from that session's ACP `mcp_servers` array. **This replaces the plan's original Mechanism A** (`ENABLE_TOOL_SEARCH` env), which is now the fallback because it disables deferral for *every* server rather than the Roblox one; see `.omo/roblox-re/09-verified-metapath.md`.
- Mechanism B: `ENABLE_TOOL_SEARCH` in per-session agent env, as the deferral fallback if A′ fails.
- Mechanism C, **only if A′ and B both fail**: a `robloxkit` stdio MCP proxy re-publishing the 28 upstream tools with `_meta["anthropic/alwaysLoad"] = true`.
- **The instruction carrier (unconditional)**: `_meta.systemPrompt.append` carrying the Roblox instruction block. Amendment 2 — this ships regardless of which deferral mechanism wins, because A′ carries no text and the plan's original design had no carrier for the block under A′.
- A Roblox instruction block naming the real 28 tool names, the open place name, and a prohibition on writing `.lua` files instead of driving Studio.
- An always-on instruction line telling the agent to load tool schemas before concluding a tool is unavailable (folds in `08`'s "New todo"; carried by todo 7 so it ships on every path).
- Place-name plumbing from the renderer's existing `robloxApi.liveStatus().placeName` into whichever mechanism ships.
- Sibling Rust/TS test files for every new module.
- A manual QA recipe as the final gate, because the last proof needs a GUI.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- MUST NOT implement any RobloxKit generative tool: no `image_*`, `generate_3d`, `generate_texture`, `generate_skybox`, `generate_icon*`, `generate_vfx`, `generate_sfx`, `generate_gfx`, `generate_clothing`, `generate_cutscene`, `create_animation`, `insert_music`.
- MUST NOT implement Roblox Open Cloud admin: no `publish_place`, `publish_message`, `update_experience`, `update_place`, `restart_servers`, `ban_user`, `unban_user`, datastore tools, `spawn_task` family, `ytdl_*`.
- MUST NOT add HTTP or SSE transport anywhere in this work.
- MUST NOT add `if agent_id == "claude-acp"` (or any literal agent-id comparison) in a hot path. Use the existing profile/helper pattern at `src-tauri/src/acp/manager/gates.rs:470-479`.
- MUST NOT filter, hide, or special-case the Roblox instruction block per agent.
- MUST NOT modify `StudioMCP.exe`, any file under `%LOCALAPPDATA%\Roblox`, or any Roblox install artifact.
- MUST NOT write, seed, or read `CLAUDE.md`, `AGENTS.md`, or any project instruction file.
- MUST NOT rename, alias, or "clean up" upstream tool names.
- MUST NOT touch `canvas_tools`, `figcraft`, `.figcraft`, `.pen`, or `.op`.
- MUST NOT persist any change to the `roblox-studio` MCP registry entry. Both the `alwaysLoad` metadata and the array suppression are **per-session, in-memory request shaping only** — `store.json` must be byte-identical after this work.
- MUST NOT send `roblox-studio` in both the ACP `mcpServers` array and `_meta.claudeCode.options.mcpServers` for the same session: the adapter spreads the array last (`acp-agent.js:8699-8702`) and silently discards the `alwaysLoad` entry.
- MUST NOT hardcode an absolute `StudioMCP.exe` path; resolve per call via `crate::roblox::find_studio_mcp()`.

## Verification strategy

> Zero human intervention except the single final manual gate, which is stated as outstanding until the user reports it.

- Test decision: **tests-after**, with `cargo test` for Rust sibling modules and `vitest` for renderer. Rationale: Phase 0 establishes the actual wire behaviour first; tests written before it would encode a guess.
- Frameworks: Rust built-in `#[test]` / `#[tokio::test]` in sibling files wired via `#[cfg(test)] #[path = "..."] mod tests;` (see `src-tauri/src/roblox.rs:164-166`); renderer via `vitest` (`bun run test`).
- Evidence: `.omo/evidence/task-<N>-roblox-tool-loading-v2.md` (no ulw-loop session active, so the non-loop evidence root applies).

## Execution strategy

### Parallel execution waves

- **Wave 1 — Phase 0, prove the mechanisms (todos 1-3).** Todo 1 runs first and alone; it probes mechanism A′ (server-level `alwaysLoad` via `_meta`) and B (`ENABLE_TOOL_SEARCH`) in one harness. Todo 2(i) — the append **channel** check — is unconditional and may run in parallel with todo 1 because it answers a different question. Todo 2(ii) and todo 3 run only if the deferral mechanisms fail. Nothing in Wave 2 starts until the deferral verdict is recorded.
- **Wave 2 — the shipping mechanisms (todos 4-6).** Todo 4 ships exactly one deferral mechanism (A′/B/C) chosen by the Wave 1 verdict. **Todo 5 ships unconditionally** (Amendment 2) because it is the instruction carrier.
- **Wave 3 — context layer (todos 7-8).** Always ships, independent of which mechanism won.
- **Wave 4 — verification and closeout (todos 9-10).**

### Dependency matrix

| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2(ii), 4, 7 | 2(i) |
| 2 | 1 (only for 2(ii)) | 3, 5, 7 | 1 |
| 3 | 2(ii) (only if deferral failed) | 6, 7 | - |
| 4 | 1 | 8, 9 | 5, 7 |
| 5 | 2(i) | 8, 9 | 4, 7 |
| 6 | 3 | 8, 9 | 7 |
| 7 | 2(i) verdict only | 8, 9 | 4, 5 |
| 8 | 4 and 5 (and 6 if C shipped), and 7 | 9 | - |
| 9 | 8 | 10 | - |
| 10 | 9 | - | - |

## Todos

> Implementation + Test = ONE todo. Never separate.

> **AMENDMENT (pre-execution, required by `08-correction-alwaysLoad.md`).**
> `08` said the plan was "not ready to execute" until its open question was resolved.
> That question is now answered with verified source: see
> **`.omo/roblox-re/09-verified-metapath.md`**. Three consequences are folded in below:
> (1) `alwaysLoad` **cannot** ride on the ACP `mcpServers` array entry — the adapter
> projects only `{type,command,args,env}` at `acp-agent.js:8518-8528`; (2) it **can**
> ride on `_meta.claudeCode.options.mcpServers`, which the adapter spreads unfiltered
> at `acp-agent.js:8699-8702`; (3) **ordering trap** — the ACP array is spread *after*
> `_meta`, so the server must be removed from the array for that session or the
> `alwaysLoad` copy is silently overwritten. Todo 1 now probes this as mechanism **A′**
> first, and asserts the ordering trap explicitly.

> **AMENDMENT 3 (post-probe, verified defect in the plan's own fallback value).**
> Todo 1 measured that **`ENABLE_TOOL_SEARCH=100` does nothing.** The CLI accepts only
> the `auto:N` syntax; a bare `100` is accepted silently with no warning and produces
> no threshold change (`b_100` behaved identically to unset: `addedNames=31`,
> `toolCount=14`, probe deferred). `auto:100` and `false` both work
> (`deferred_tools_delta` absent entirely, 43–57 tools eager). Both
> `06-root-cause-verdict.md` and `09-verified-metapath.md` proposed `"100"` — that
> value is wrong. **If Mechanism B is ever shipped, the value MUST be `auto:100`
> (or `false`), never `100`.** Todo 4 carries this correction.

- [x] 1. Phase 0 probe: does `alwaysLoad` on the server config suppress deferral?
  What to do / Must NOT do: Build a throwaway probe MCP server under `.omo/evidence/probe/` (NOT under `src/`) that serves two fake tools with deliberately long descriptions (so the 10%-of-context threshold from `06` is crossed on its own). Then probe **mechanism A′** and **mechanism B** in one harness, A′ first:
  **A′** — send the probe server in `session/new` `_meta.claudeCode.options.mcpServers[<name>] = {type:"stdio", command, args, env, alwaysLoad:true}` AND **omit it from the ACP `mcpServers` array** (this omission is load-bearing; see `09` Fact 4). Run once more with `alwaysLoad:false` as the control.
  **B** — only if A′ reports DOES NOT WORK: same probe entry in the ACP array, plus `_meta.claudeCode.options.env.ENABLE_TOOL_SEARCH` = `"100"`, control `"auto"`.
  For every run, read the Claude Code transcript at `%USERPROFILE%\.claude\projects\C--Users-Novella-Documents-<cwd-slug>\<sessionId>.jsonl`, find `attachment.type == "deferred_tools_delta"`, and record whether `addedNames` lists the probe tools and whether the follow-up system-reminder says their schemas are NOT loaded. Also capture `debugDescription` from any `auto_above_threshold` / `auto_below_threshold` line. Write verdict WORKS / DOES NOT WORK / INCONCLUSIVE **per mechanism** with quoted JSON to `.omo/evidence/task-1-roblox-tool-loading-v2.md`. MUST NOT modify anything under `src/` or `src-tauri/src/`. MUST NOT leave the probe server registered — remove it and confirm `store.json` no longer lists it. MUST NOT send the entry in both the array and `_meta` in the same run — that is the ordering trap and it produces a false DOES NOT WORK.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2, 4, 7
  References: `.omo/roblox-re/09-verified-metapath.md` (**read first** — the verified `_meta` path, the ordering trap, and what remains unproven); `.omo/roblox-re/06-root-cause-verdict.md` (decoded threshold `c7e=10`, `hfr=2.5`, `enabled: y >= D`, and the `Tool search disabled: ...` messages); `.omo/roblox-re/08-correction-alwaysLoad.md` (why the key is `anthropic/alwaysLoad`, not `always_load`); `%APPDATA%\com.termul-manager.app\acp-registry-binaries\claude-acp\node_modules\@agentclientprotocol\claude-agent-acp\dist\acp-agent.js:8518-8528,8570,8699-8702`; `...\@anthropic-ai\claude-agent-sdk\sdk.d.ts:1369-1383,1994`; `src-tauri/src/acp/manager/gates.rs:486-495`; `src-tauri/src/acp/manager/command_loop.rs:155,387,478`; `src/renderer/lib/roblox-studio-mcp.ts:11-21`; `%APPDATA%\com.termul-manager.app\store.json` key `data."shared/lww/acp/mcp-servers"`.
  Acceptance criteria (agent-executable): the evidence file contains (a) a verdict token per mechanism, (b) at least one verbatim `deferred_tools_delta` JSON line per run including the `alwaysLoad:false` control, (c) the two probe tool names, (d) an explicit statement of whether the probe entry was in the ACP array or only in `_meta` for each run, (e) confirmation the probe entry was removed from the registry.
  QA scenarios (name the exact tool + invocation): happy = A′ run shows probe tools absent from `addedNames` (or present with schemas loaded) while the `alwaysLoad:false` control defers them — that contrast is the proof; failure = probe server pointed at a dead command, session still starts and the transcript shows it under `failedMcpServers`. Evidence `.omo/evidence/task-1-roblox-tool-loading-v2.md`.
  Commit: N | research only, no product change

> **AMENDMENT 2 (pre-execution, instruction carrier).** Amendment 1 makes A′ the
> likely winner, which exposes a gap in the original plan: A′ only sets `alwaysLoad`
> on the server config — it carries **no text**. The plan assumed the instruction
> block rides on Mechanism B or C, but both are conditional, so under A′ the
> deliverable "a Roblox instruction block naming the 28 tools" would have no carrier.
> `08-correction-alwaysLoad.md` §"Finding A" already flagged the answer: a
> `_meta.systemPrompt.append` is a *stronger* channel than MCP `instructions` because
> it cannot be missed. **Therefore the instruction carrier is
> `_meta.systemPrompt.append`, and it ships on every path** — it is orthogonal to
> which deferral mechanism wins. This splits two questions that todo 2 previously
> conflated:
> - *Does `append` suppress deferral?* — probably not; that stays a fallback question.
> - *Does `append` reach the model-facing prompt?* — **must be true**, because it is
>   the carrier for the always-shipping instruction block. Todo 2 verifies this
>   regardless of the todo 1 verdict.
>
> Consequence for the waves: todo 2's **channel check** is unconditional; only its
> **deferral check** is gated on todo 1 failing. Todo 5 (shipping the append) is
> therefore unconditional too, and is no longer "only if todo 2 reported WORKS" in the
> deferral sense.

- [x] 2. Verify the `_meta.systemPrompt` append channel (carrier), and whether it also suppresses deferral
  What to do / Must NOT do: This todo has **two independent questions**; do not conflate them.
  **(i) CHANNEL CHECK — always run.** Send `_meta.systemPrompt` in the object form carrying `append` with a short recognisable marker plus a sentence naming the probe tools. Confirm from the transcript that the appended text appears in the model-facing system prompt (the `system` entry of the first API request, or the equivalent rendered prompt record). This is the carrier for the always-shipping Roblox instruction block, so a failure here is a **blocker for todo 7**, not just a fallback.
  **(ii) DEFERRAL CHECK — run only if todo 1 reported DOES NOT WORK or INCONCLUSIVE for BOTH A′ and B.** Determine whether the probe tools are still schema-less with the append present. Record this separately from (i).
  Write both results with quoted evidence to `.omo/evidence/task-2-roblox-tool-loading-v2.md`, each with its own verdict token. MUST NOT ship any product change in this todo. MUST NOT use `_meta.systemPrompt` as a full replacement string — use the `append` form so Claude's preset prompt survives. NOTE: `append` does **not** make tools callable, it only nudges the model toward `ToolSearch`; record that limitation so it is never mistaken for a deferral fix.
  Parallelization: Wave 1 | Blocked by: none for (i); 1 (only if 1 fails) for (ii) | Blocks: 3, 5, 7
  References: `acp-agent.js:8531-8551` (`airCustomInstructions(params._meta)` builds the base append, then `_meta.systemPrompt` string-vs-object handling); `acp-agent.js:8552-8555` (the spec's own `systemPrompt` wins — do not set both); `.omo/roblox-re/08-correction-alwaysLoad.md` §"Finding A"; `.omo/roblox-re/09-verified-metapath.md`; `src-tauri/src/acp/manager/gates.rs:486-495`; `src-tauri/src/acp/manager/command_loop.rs:155`.
  Acceptance criteria (agent-executable): the evidence file quotes the appended text as it appears in the model-facing prompt, and states whether `addedNames` still contains the probe tools.
  QA scenarios: happy = append visible in prompt AND tools load; failure = append visible but tools still deferred → record as DOES NOT WORK with both facts. Evidence `.omo/evidence/task-2-roblox-tool-loading-v2.md`.
  Commit: N | research only, no product change

- [x] 3. Test whether per-tool `_meta["anthropic/alwaysLoad"]` survives a proxy
  What to do / Must NOT do: Run ONLY if todos 1 and 2 both failed; otherwise record "not needed" and stop. Extend the probe server to act as a thin pass-through in front of the real `StudioMCP.exe`: it must forward `initialize`, `tools/list` and `tools/call`, and add `_meta: {"anthropic/alwaysLoad": true}` to every tool in the `tools/list` reply. Register that proxy as the only Roblox MCP entry and start a Claude session. Confirm from the transcript that the proxied tools are (a) present and (b) not deferred. Also confirm a `tools/call` round-trips through the proxy to Studio successfully (`get_studio_state` is read-only and safe). Write verdict with quoted evidence to `.omo/evidence/task-3-roblox-tool-loading-v2.md`. MUST NOT call any write-capable Studio tool. MUST NOT leave the proxy registered.
  Parallelization: Wave 1 | Blocked by: 2 (only if 2 fails) | Blocks: 6, 7
  References: `...\@anthropic-ai\claude-agent-sdk\sdk.d.ts:646-653` (the authoritative statement that `alwaysLoad` is applied via `_meta['anthropic/alwaysLoad']` per tool); `sdk.d.ts:1216` (the server-level variant and its 5s connect block); `...\claude-agent-acp\dist\acp-agent.js:8505-8530` (proves the adapter drops `_meta` from an ACP `mcpServers` entry, which is why a proxy is needed for the per-tool key); `src-tauri/src/roblox/session.rs:53-183` (the JSON-RPC client to reuse); `src-tauri/src/roblox/session.rs:317-364` (`parse_studios` — the MCP content-block envelope shape).
  Acceptance criteria (agent-executable): the evidence file quotes a `tools/list` line containing `"anthropic/alwaysLoad"`, states whether the tools were deferred, and quotes a successful `get_studio_state` result that passed through the proxy.
  QA scenarios: happy = tools loaded AND a call round-trips; failure = `_meta` present in the reply but tools still deferred → record as DOES NOT WORK and state that Mechanism C cannot work through this adapter without extending it. Evidence `.omo/evidence/task-3-roblox-tool-loading-v2.md`.
  Commit: N | research only, no product change

- [x] 4. Ship Mechanism A′ — server-level `alwaysLoad` for the Roblox MCP entry
  What to do / Must NOT do: Run only if todo 1 reported WORKS for A′ (if it reported WORKS for B instead, ship the env variant through this same todo and say so in the evidence — the wiring path is identical). Extend the existing `_meta` builder in `src-tauri/src/acp/manager/gates.rs` (`summarized_thinking_meta`, `:486-495`) into one builder that emits **both** `claudeCode.options.thinking` and `claudeCode.options.mcpServers["roblox-studio"].alwaysLoad = true` for a Roblox Claude session. Merge the keys into one `claudeCode.options` object — do not build a second `_meta` and do not replace `thinking`. **Then remove `roblox-studio` from that session's ACP `mcp_servers` array**, because `acp-agent.js:8699-8702` spreads the ACP array *after* `_meta`, so leaving it there silently overwrites the `alwaysLoad` entry (`09` Fact 4) and the fix becomes a no-op. Apply on both the create and reopen paths (`command_loop.rs:155,387,478`). Gate on the existing Claude-adapter detection (`gates.rs:470-479`), never a literal id comparison. MUST NOT set anything for non-Claude agents. MUST NOT touch non-Roblox projects. MUST NOT replace the `thinking` key. MUST NOT rely on `_meta` alone while the ACP array entry is still present.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 8, 9
  References: `.omo/roblox-re/09-verified-metapath.md` (the verified path and the ordering trap); `acp-agent.js:8518-8528` (array entries are projected to 4 fields — `alwaysLoad` dies there); `acp-agent.js:8570,8699-8702` (`userProvidedOptions.mcpServers` spread unfiltered, and spread *before* the array); `sdk.d.ts:1369-1383,1994` (`alwaysLoad` on `McpStdioServerConfig`, `Record<string, McpServerConfig>`); `acp-agent.js:8647-8656` (env merge, if B is the winner); `src-tauri/src/acp/manager/gates.rs:470-479,486-495`; `src-tauri/src/acp/manager/tests.rs:70` (the existing `summarized_thinking_meta` test to extend); `src-tauri/src/acp/manager/mod.rs:1058-1096`; `.omo/evidence/task-1-roblox-tool-loading-v2.md` (the winning mechanism).
  Acceptance criteria (agent-executable): a unit test asserts the merged `_meta` for a Roblox Claude session contains **both** `claudeCode.options.thinking` and `claudeCode.options.mcpServers["roblox-studio"].alwaysLoad === true`; a second test asserts the Roblox session's ACP `mcp_servers` array **does not** contain `roblox-studio` (the ordering guard); a third asserts a non-Roblox session's `_meta` and `mcp_servers` are unchanged; a fourth asserts a non-Claude agent gets no `mcpServers` key.
  QA scenarios: happy = merged `_meta` contains both keys AND the array omits `roblox-studio`; failure = existing `thinking` test still passes unchanged (no regression). Evidence `.omo/evidence/task-4-roblox-tool-loading-v2.md`.
  Commit: Y | feat(roblox): load Studio tool schemas eagerly for Claude sessions

- [x] 5. Ship the instruction carrier — `_meta.systemPrompt.append` for Roblox Claude sessions
  What to do / Must NOT do: **This todo is UNCONDITIONAL** (per Amendment 2): the append is the carrier for the always-shipping Roblox instruction block, independent of which deferral mechanism won in Wave 1. Gate only on todo 2(i) having confirmed the channel reaches the model-facing prompt; if 2(i) failed, stop and report a blocker instead of shipping. Attach `_meta.systemPrompt` in the object form `{ append: roblox_instructions(place_name) }` for Roblox Claude sessions, through the same merged `_meta` builder used by todo 4 — one builder emitting `claudeCode.options.*` and `systemPrompt`, never two competing `_meta` values. Use the `append` form, never the string form, so Claude's preset prompt survives. Reuse the exact `roblox_instructions()` prose from todo 7 so Mechanism C's `instructions` can carry the same text later. MUST NOT send `systemPrompt` as a bare string. MUST NOT send it for non-Roblox projects. MUST NOT send it for non-Claude agents. MUST NOT set a top-level `type`/`preset` (the adapter locks those itself).
  Parallelization: Wave 2 | Blocked by: 2(i) | Blocks: 8, 9
  References: `.omo/roblox-re/08-correction-alwaysLoad.md` §"Finding A" (why append is a stronger channel than MCP `instructions`); `acp-agent.js:8531-8551` (string replaces, object is spread with `type/preset` locked — `append` is the additive key); `acp-agent.js:8552-8555` (the spec's `systemPrompt` wins over `_meta`; do not set both); `src-tauri/src/acp/manager/gates.rs:486-495`; `.omo/evidence/task-2-roblox-tool-loading-v2.md`.
  Acceptance criteria (agent-executable): a unit test asserts the emitted `_meta.systemPrompt` is an object with an `append` string and no top-level `type`/`preset`; a second asserts the `append` contains the todo 7 instruction text; a third asserts it is absent for a non-Roblox project; a fourth asserts `claudeCode.options.thinking` still coexists in the same `_meta`.
  QA scenarios: happy = `_meta.systemPrompt.append` present, non-empty, and contains the instruction block; failure = existing `thinking` `_meta` unaffected. Evidence `.omo/evidence/task-5-roblox-tool-loading-v2.md`.
  Commit: Y | feat(roblox): append Roblox context to the Claude system prompt

- [x] 6. Ship Mechanism C — the `robloxkit` stdio proxy
  What to do / Must NOT do: Run only if todos 1 and 2 both failed and todo 3 reported WORKS. Create `src-tauri/src/acp/host_mcp/roblox/` with `upstream.rs` (spawn `StudioMCP.exe`, reuse the JSON-RPC framing from `roblox/session.rs`), `tools.rs` (map each upstream `Tool` via `Tool::new(...).with_meta(...)` adding `_meta["anthropic/alwaysLoad"] = true` and a `ROBLOX_DESCRIPTION_TAG` prefix, preserving name/schema/title/annotations/icons), `instructions.rs` (`roblox_instructions(place_name)`), and `mod.rs` (`run() -> i32` serving a runtime `ToolRouter` built with `ToolRouter::new()` + `add_route(ToolRoute::new_dyn(...))`). Add `CHILD_ARG_ROBLOX` and `is_roblox_child_invocation()` to `host_mcp/mod.rs`, and branch on it in BOTH `main.rs` and `server_main.rs` before Tauri init. Add `build_internal_roblox_stdio()` to `gates.rs` and prepend it in `new_session_with_context` and `prepare_reopen_mcp` only for the Roblox project, suppressing the raw `roblox-studio` entry for that session only. If upstream is unreachable, still serve `initialize` with instructions and an empty tool list. MUST NOT use the `#[tool_router]` macro for the dynamic set. MUST NOT update only one of the two binaries. MUST NOT persist the suppression. MUST NOT let the child initialise Tauri or an `AppHandle`.
  Parallelization: Wave 2 | Blocked by: 3 | Blocks: 8, 9
  References: `rmcp-3.5.0/src/model/tool.rs:17-39,228`; `rmcp-3.5.0/src/handler/server/router/tool.rs:197,389-440`; `src-tauri/src/acp/host_mcp/mod.rs:48-62`; `src-tauri/src/main.rs:17-26`; `src-tauri/src/server_main.rs:70-80`; `src-tauri/src/acp/host_mcp/child.rs:81-120,368-380,529`; `src-tauri/src/acp/host_mcp/canvas_tools.rs:20-24`; `src-tauri/src/acp/manager/gates.rs:112-137`; `src-tauri/src/acp/manager/mod.rs:1058-1070,1204-1235`; `src-tauri/src/roblox/session.rs:53-183`; `src-tauri/src/roblox.rs:48-62`; `.omo/evidence/task-3-roblox-tool-loading-v2.md`.
  Acceptance criteria (agent-executable): `cargo check --lib --bins` passes; a test asserts a 2-tool mock upstream yields 2 tools each serialising with `"_meta":{"anthropic/alwaysLoad":true}` and an unchanged `input_schema`; a test asserts `is_roblox_child_invocation()` is false for the plan flag and true for the Roblox flag; a test asserts a Roblox-project session list contains `robloxkit` and not `roblox-studio`, and a non-Roblox session is untouched.
  QA scenarios: happy = proxy serves tools with `_meta`, a call round-trips, no duplicate tool sets; failure = `STUDIO_MCP_EXE` points at a missing file → `initialize` still answers with instructions and `tools/list` returns `[]`, and the session still starts. Evidence `.omo/evidence/task-6-roblox-tool-loading-v2.md`.
  Commit: Y | feat(roblox): proxy Studio tools with alwaysLoad metadata

- [x] 7. Author the Roblox instruction block and place-name plumbing
  What to do / Must NOT do: Write `roblox_instructions(place_name: Option<&str>) -> String` in a module both Mechanism B and C can use (place it at `src-tauri/src/acp/host_mcp/roblox/instructions.rs` even if only B ships, so C can reuse it later). Content must: name the 28 real StudioMCP tool names by bare name; instruct that place changes go through those tools and MUST NOT be written as `.lua` files; state `studio_id` may be omitted when one Studio is open; **state that if a tool is not yet available the agent must load its schema via `ToolSearch` before concluding it is unavailable (this is the always-on safety net folded in from `08`, and it must ship even when mechanism A′ wins)**; and embed the place name when supplied. Plumb the place name from the renderer's existing `robloxApi.liveStatus().placeName` into the session-creation path (a `_meta` field for B, or a child env var for C). MUST NOT mention any RobloxKit-only tool name. MUST NOT prefix tool names with `mcp__` or a server name. MUST NOT emit a dangling placeholder when the place name is unknown.
  Parallelization: Wave 3 | Blocked by: 1 (verdict only) | Blocks: 8, 9
  References: `.omo/roblox-re/00-runtime-evidence.md` §E2 (the verified 28 tool names); `.omo/roblox-re/07-opencode-baseline.md` (OpenCode succeeded with no instructions — keep this block tight and specific); `.omo/roblox-re/06-root-cause-verdict.md` §"Step 3" (the ToolSearch safety-net wording, and why it must not name tools the model cannot call); `.omo/roblox-re/09-verified-metapath.md`; `src-tauri/src/acp/host_mcp/canvas_tools.rs:26-47` (`CANVAS_GUIDE` prose style); `src-tauri/src/acp/host_mcp/mod.rs:78-95` (`TERMUL_CHAT_INSTRUCTIONS` + `session_instructions` composition); `src/renderer/lib/tauri-roblox.ts:14-33` (`RobloxStudioLiveStatus.placeName`); `src/renderer/hooks/use-roblox-studio-status.ts:20` (poll interval, if the renderer must supply a fresh name).
  Acceptance criteria (agent-executable): a test asserts the string contains all 28 tool names, contains the `.lua` prohibition phrase, contains `studio_id`, contains a `ToolSearch` mention, and contains no `mcp__` substring; `Some("X")` embeds `X`; `None` leaves no dangling punctuation.
  QA scenarios: happy = all 28 names present; failure = a deliberately wrong tool name (e.g. `read_script`) makes the test fail — proving the test actually checks the list. Evidence `.omo/evidence/task-7-roblox-tool-loading-v2.md`.
  Commit: Y | feat(roblox): add the Roblox instruction block

- [x] 8. Wire the chosen mechanism into the session lifecycle and prove non-Roblox sessions are untouched
  What to do / Must NOT do: Connect whichever of A′/B/C shipped to both `new_session_with_context` and `prepare_reopen_mcp`, gated on the session's project being the Roblox project. If A′ shipped, the wiring must ALSO drop `roblox-studio` from that session's `mcp_servers` array in both paths — the `_meta` entry alone is silently overwritten (`09` Fact 4). Resolve project identity through the project registry rather than path string matching; if only the name is available, compare against `ROBLOX_PROJECT_NAME` and document why. Add regression tests proving: a Roblox session gets the mechanism (and, for A′, an `mcp_servers` array without `roblox-studio`); a non-Roblox session's `session/new` `_meta` and `mcpServers` are byte-identical to before; a session on a machine with no `StudioMCP.exe` still starts successfully. MUST NOT change any non-Roblox session's request. MUST NOT let the mechanism's absence or failure return `Err` from `new_session_with_context` or `prepare_reopen_mcp`. MUST NOT persist the array suppression to `store.json`.
  Parallelization: Wave 3 | Blocked by: 4 or 5 or 6, and 7 | Blocks: 9
  References: `.omo/roblox-re/09-verified-metapath.md` (ordering trap + the reopen-path symmetry); `src-tauri/src/acp/manager/mod.rs:1034-1096` (create path and its single `Result` site at `gate_mcp_servers`); `src-tauri/src/acp/manager/mod.rs:1204-1235` (reopen path, including `unregister_by_token` on failure); `src-tauri/src/acp/manager/gates.rs:37-56` (stdio passes unconditionally at `:43`); `src-tauri/src/acp/project_registry.rs:70` (project `mcp_servers` field); `src/renderer/lib/roblox-studio-mcp.ts:8-9` (`ROBLOX_STUDIO_MCP_ID`, `ROBLOX_PROJECT_NAME`); `src-tauri/src/roblox.rs:23` (`WORKSPACE_DIR_NAME`).
  Acceptance criteria (agent-executable): the tests listed above, each asserting on the built request rather than on a log line; for A′, one test asserts the array omits `roblox-studio` while `_meta` carries `alwaysLoad`.
  QA scenarios: happy = Roblox session carries the mechanism, non-Roblox is unchanged; failure = missing `StudioMCP.exe` → session created, mechanism skipped, warning logged without the place name. Evidence `.omo/evidence/task-8-roblox-tool-loading-v2.md`.
  Commit: Y | feat(roblox): scope the tool-loading fix to the Roblox project

- [x] 9. Run the full affected test suites and record exact commands
  What to do / Must NOT do: Run and record the exact command plus output tail for each: `cargo check --lib --bins`, `cargo clippy --lib --bins -- -D warnings`, `cargo test --lib roblox`, `bun run typecheck`, `bun run test --run src/renderer/lib/roblox-studio-mcp.test.ts src/renderer/lib/tauri-roblox.test.ts src/renderer/components/RobloxStudioIndicator.test.tsx`. Ensure every new module has a sibling `*_tests.rs` wired with `#[cfg(test)] #[path = "..."] mod tests;` — never inline `mod tests`. Gate any test that spawns the real `StudioMCP.exe` behind `#[ignore]`. Confirm the diff touches ≤50 files. MUST NOT report a suite as passing from a grep or a subagent summary — quote the real exit code and the summary line.
  Parallelization: Wave 4 | Blocked by: 8 | Blocks: 10
  References: `src-tauri/src/roblox.rs:164-166` (the sibling-test wiring convention); `src-tauri/src/acp/host_mcp/child/tests.rs` (a working rmcp-server test over an in-memory transport); `AGENTS.md` (≤50 files per PR, sibling tests, ~800 prod-line ceiling); `docs/roblox-studio-status-indicator.md` §7 (the `cargo test --lib` `STATUS_ENTRYPOINT_NOT_FOUND` trap on this machine and the throwaway-crate workaround).
  Acceptance criteria (agent-executable): every command above has its exit code and summary line quoted in the evidence file; the changed-file count is stated and is ≤50.
  QA scenarios: happy = all exit 0; failure = if `cargo test --lib` cannot run on this machine, reproduce the logic in a throwaway crate, record that, and label it explicitly as a workaround rather than as a pass. Evidence `.omo/evidence/task-9-roblox-tool-loading-v2.md`.
  Commit: Y | test(roblox): cover the tool-loading fix

- [x] 10. Write the manual QA recipe and the closeout record
  What to do / Must NOT do: Write `.omo/evidence/task-10-roblox-tool-loading-v2.md` with a numbered, copy-pasteable recipe: open Roblox Studio with a place loaded; open Termul on the Roblox project; pick Claude; send exactly `buatkan gw objek meja` with no mention of MCP; then verify (a) the newest `~/.claude/projects/C--Users-Novella-Documents-RobloxKit/*.jsonl` has a `deferred_tools_delta` whose `addedNames` does not list the Roblox tools (or lists them and they are callable), (b) an assistant `tool_use` names a Roblox tool, (c) the Workspace child count in Studio increased. Record the baseline: the same prompt on OpenCode already works (`.omo/roblox-re/07-opencode-baseline.md`). Record the rollback for the shipped mechanism. State explicitly `STATUS: awaiting user confirmation`. MUST NOT claim the fix is verified from unit tests alone.
  Parallelization: Wave 4 | Blocked by: 9 | Blocks: none
  References: `.omo/roblox-re/07-opencode-baseline.md`; `.omo/roblox-re/00-runtime-evidence.md` §E4-§E5 (the pre-fix failure signature); `.omo/roblox-re/06-root-cause-verdict.md` (the deferral evidence to re-check); `docs/roblox-studio-status-indicator.md` §8 (existing manual checklist style).
  Acceptance criteria (agent-executable): the evidence file contains the numbered recipe, the three pass conditions with exact paths and JSON keys, the rollback steps, and the `STATUS: awaiting user confirmation` line.
  QA scenarios: happy = user reports the three conditions pass; failure = user reports `.lua` files still written → the file already lists next diagnostics (check `deferred_tools_delta` first, then whether the chosen mechanism's key survived into the request). Evidence `.omo/evidence/task-10-roblox-tool-loading-v2.md`.
  Commit: Y | docs(roblox): add the tool-loading manual QA recipe

## Final verification wave

> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [x] F1. Plan compliance audit
- [x] F2. Code quality review
- [~] F3. Real manual QA
- [x] F4. Scope fidelity

## Commit strategy

- Todos 1-3 are research only: evidence files under `.omo/evidence/`, committed as `docs(roblox): ...` or not at all if `.omo/` is ignored.
- Exactly one of todos 4/5/6 produces product code — the one the Phase 0 verdict selected. The other two are recorded as "not needed" in the evidence and produce no commit.
- Todos 7-10 each produce one conventional commit with a `roblox` scope.
- No commit may mix this work with the canvas path, the plan child, or the status-lamp modules.
- If the diff exceeds 50 files (only possible if Mechanism C ships), split into: (a) proxy core + tests, (b) wiring + scoping, (c) docs.
- Never commit an evidence file containing a place name, a token, or a full tool argument payload.

## Success criteria

- A Claude session on the Roblox project, given `buatkan gw objek meja` with no mention of MCP, calls a Roblox Studio tool and changes the live place — verified by a `tool_use` entry in the transcript and a changed Workspace child count.
- The `deferred_tools_delta` for that session no longer lists the Roblox tools as schema-less, or lists them and they are callable.
- No non-Roblox project's `session/new` request changes in any observable way.
- A machine with no Roblox install, or with Studio closed, still starts every session successfully.
- `cargo check`, `cargo clippy -D warnings`, `cargo test --lib roblox`, and `bun run typecheck` all pass, with real exit codes quoted.
- The diff touches ≤50 files and contains zero literal agent-id comparisons in a hot path.
- The user has run the manual QA recipe and reported it passing.
