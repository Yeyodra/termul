# Task 10 — Manual QA recipe and closeout

**STATUS: awaiting user confirmation.** The automated side is green (todo 9). The last
condition — a real Claude session in Termul driving the live place — needs the GUI and
has **not** been run.

---

## What changed, in one line

A Claude session on the **Roblox** project now (a) makes `claude.exe` load the 28
StudioMCP tool schemas eagerly instead of deferring them behind `ToolSearch`, and
(b) receives a system-prompt block naming those tools and forbidding the `.lua`-file
fallback.

## Prerequisites

1. Roblox Studio installed and **open with a place loaded**.
2. The Roblox project open in Termul (the project named `Roblox`).
3. The `roblox-studio` MCP server registered (the Roblox button does this).
4. The patched build running (`bun run dev` or a rebuilt binary — the change is in Rust,
   so a stale binary will not show it).

## Recipe (copy-pasteable)

1. **Note the baseline.** In Studio, select `Workspace` and count its children in the
   Explorer.
2. In Termul, open the **Roblox** project.
3. Start a new chat and pick **Claude**.
4. Send exactly this, with no mention of MCP, Studio, or tools:

   ```
   buatkan gw objek meja
   ```

5. Wait for the turn to finish.
6. **Check the transcript.** Open the newest file in
   `%USERPROFILE%\.claude\projects\C--Users-Novella-Documents-RobloxKit\*.jsonl`
   and search for `deferred_tools_delta`.
7. **Check the tool call.** In the same transcript, find an assistant `tool_use` whose
   `name` is `mcp__roblox-studio__*`.
8. **Check Studio.** Re-count `Workspace` children in the Explorer.

## Pass conditions (all three must hold)

| # | Condition | Exact check |
| --- | --- | --- |
| A | The Roblox tools are not schema-deferred | In the newest `C--Users-Novella-Documents-RobloxKit\*.jsonl`, `attachment.type == "deferred_tools_delta"` → `addedNames` does **not** contain `mcp__roblox-studio__*`. (If it does, the tools must nevertheless be callable — see the failure branch.) |
| B | The agent used a Roblox tool | Same transcript: an assistant `tool_use` with `name` starting `mcp__roblox-studio__`, e.g. `execute_luau` or `inspect_instance`. |
| C | The place actually changed | `Workspace` child count in Studio is **higher** than the baseline from step 1. |

A second, cheaper check on the same session: the model-facing system prompt should end
with the Roblox instruction block, i.e. it contains `Do NOT write .lua files` and the
28 tool names. Seeing that text proves the carrier arrived.

## Failure branch — "it still wrote a .lua file"

Diagnose in this order; do not guess:

1. **Was the block delivered?** Search the transcript for `Do NOT write .lua files`.
   - **Absent** → the `_meta.systemPrompt` never reached the model. Check that the
     session was on the `Roblox` project (the gate), that the agent was Claude (not
     Codex/Gemini), and that the binary is the patched one.
   - **Present but no tool call** → the block arrived but was not obeyed. That is a
     prompt-quality problem, not a plumbing problem; tighten the wording in
     `src-tauri/src/acp/host_mcp/roblox/instructions.rs`.
2. **Was `alwaysLoad` delivered?** Search the `claude.exe` command line for
   `alwaysLoad`. It must appear **exactly once**, on the `roblox-studio` entry.
   - **Zero occurrences** → the ordering trap: `roblox-studio` is still in the ACP
     `mcpServers` array, so the adapter overwrote the `_meta` entry. That is the
     specific no-op `09-verified-metapath.md` warns about; check
     `wants_roblox_eager_load` returned `true` and that `suppress_servers` ran.
3. **Was the project gate satisfied?** The project must be named exactly `Roblox`
   (`ROBLOX_PROJECT_NAME`) and the session's MCP list must contain `roblox-studio`.

## Rollback

The change is per-session request shaping, so nothing is persisted and there is no
migration to undo.

| Shipped mechanism | Rollback |
| --- | --- |
| Mechanism A′ (`alwaysLoad` + array suppression) | In `src-tauri/src/acp/manager/gates.rs`, make `wants_roblox_eager_load` in `src-tauri/src/web/ws/projects.rs` return `false`. Sessions revert to the previous behaviour exactly; no data changes. |
| Instruction carrier (`systemPrompt.append`) | Same one-line gate change; or delete the `systemPrompt` insertion in `RobloxEagerLoad::meta_with_place_name`. |

Removing either is safe and reversible: `store.json` was never written, the MCP
registry is untouched, and `roblox-studio` is still a normal registry entry.

## What was verified automatically vs. what is outstanding

**Verified (todo 9, real exit codes):** `cargo check`, `cargo clippy -D warnings`,
and the affected Rust + renderer suites; request shaping asserted on built values,
including the ordering guard and the no-Studio path.

**Outstanding — needs the user at the GUI:**

- A real Claude session actually receiving the block (todo 2 proved the *channel* with
  a synthetic marker; the shipped ~1.4k-char block has never been observed in a live
  request).
- The model **obeying** it.
- The 28 real Studio tools loading eagerly with the real (much larger) tool set; the
  synthetic probe used a small server.
- The token cost of eager-loading the real 28 schemas (~13,919 tokens per
  `06-root-cause-verdict.md`) — accepted as the price of correctness, but unmeasured
  in a live session.

## Baseline for comparison

`.omo/roblox-re/07-opencode-baseline.md`: the same prompt on **OpenCode** already
worked without any of this, because OpenCode does not defer tool schemas. That is the
target behaviour for Claude.

`.omo/roblox-re/00-runtime-evidence.md` §E4-§E5 records the pre-fix failure signature:
8× `Bash`, 2× `Write`, 2× `Read`, zero Roblox tools, and a `Meja.lua` file on disk.

---

**Please run the recipe above and report whether A, B and C pass.**