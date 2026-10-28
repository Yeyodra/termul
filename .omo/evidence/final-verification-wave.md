# Final Verification Wave — F1..F4

Executed by the orchestrator directly (subagent sessions were unavailable). Each gate
below was run against raw artifacts, not against the earlier write-ups.

---

## F1 — Plan compliance audit: **APPROVE**

All 10 todos checked against their stated acceptance criteria and "Must NOT do" lists.

| Todo | Verdict | Key evidence |
| --- | --- | --- |
| 1 Phase 0 | PASS | Real **contrast** re-measured from raw artifacts: `t_on` (`alwaysLoad=true`) → `addedNames=29`, probe deferred=0, `toolCount=30`, probe schemas=2; `t_off` (`alwaysLoad=false`) → `addedNames=45`, probe deferred=2, `toolCount=14`, probe schemas=0. A single run alone would not have been proof; the control exists and differs. |
| 2 carrier check | PASS | **Structural**, not behavioural: marker `ROBLOX_CHANNEL_PROBE_7f3a9c` is literally present in `sp_append/system-prompt.txt` and literally absent from `sp_none`. |
| 3 proxy probe | PASS (gated off) | "Not needed" recorded; the plan's own gate never opened because A′ worked. |
| 4 Mechanism A′ | PASS | 11 shaping tests (4 required). Ordering guard `suppress_servers_drops_the_studio_entry_and_meta_still_carries_always_load` asserts **both** halves in one test. |
| 5 instruction carrier | PASS | 6 carrier tests. Single production emission of `systemPrompt` (`gates.rs:601`), object `{append}` form only. |
| 6 proxy ship | PASS (gated off) | "Not needed" recorded, consistent with todo 3. |
| 7 instruction block | PASS | 12 tests (9 required). 28 names frozen against the measured `tools/list`. |
| 8 lifecycle wiring | PASS | 3 WS gate call sites (create/load/resume), suppression applied exactly twice — once in each of `shape_session_request` and `shape_session_request_opt`, never twice on one request. All three required regression properties have tests. |
| 9 test suites | PASS | 8 commands with real exit codes recorded; diff is 10 files. |
| 10 manual QA | PASS (outstanding by design) | Recipe + 3 pass conditions + failure branch + rollback present; explicitly `STATUS: awaiting user confirmation`. |

**Ordering-trap verification (the highest-risk item):**

- `suppress_servers` drops the entry only when `is_active()` — `gates.rs:623-634`.
- Production call sites: exactly 2 (`gates.rs:678` in `shape_session_request_with_place`, `gates.rs:717` in `shape_session_request_opt_with_place`). Each shapes one request once.
- The suppression is conditional on `meta.is_some()`, so a non-Claude agent's list is never filtered — asserted by `non_claude_agents_get_an_unchanged_server_list_and_no_meta`.

**Guardrails (plan "Must NOT have" list):**

| Guardrail | Result |
| --- | --- |
| no literal `agent_id == "claude-acp"` in a hot path | **PASS** — 0 occurrences in the diff |
| nothing persisted to the `roblox-studio` registry entry | **PASS** — `store.json` mtime still `2026-10-26T18:18:51`, untouched |
| no hardcoded absolute `StudioMCP.exe` path | **PASS** — 0 absolute paths in the diff; resolved per call via `find_studio_mcp()` |
| no RobloxKit generative / Open Cloud tools | **PASS** — 0 such names added; 20 asserted absent by test |
| no HTTP or SSE transport added | **PASS** — the 2 `McpServer::Http/Sse` hits are *match arms* comparing `.name`, not new transport |
| no `CLAUDE.md` / `AGENTS.md` writes | **PASS** |
| no `canvas_tools` / `figcraft` / `.pen` / `.op` | **PASS** — 0 touched |
| no rename/alias of upstream tool names | **PASS** — 28 names byte-identical to the measured list |
| instruction block not filtered per agent | **PASS** — gated on project + entry + Claude adapter only |
| ≤50 files | **PASS** — 10 |

---

## F2 — Code quality review: **APPROVE**

- **Production code has no `unwrap()` / `expect()` / `panic!` on the new paths** — the only three `.expect()` calls in the diff are inside tests, where a failing assertion is the point.
- **No `as any` / `@ts-ignore`** — no TypeScript was changed.
- **Failure paths return inert values, never `Err`**: `RobloxEagerLoad::resolve` → `Self::default()` when Studio is missing; `resolve_place_name()` → `None` on every failure. A session always starts.
- **Single responsibility held**: one `_meta` builder (`meta_with_place_name`), one suppression helper, one gating predicate (`wants_roblox_eager_load`). No competing builders.
- **Dead code removed during review**: `resolved_meta()` was introduced then deleted once the `with_place` split made it unused; `meta()` was demoted to a `#[cfg(test)]` shim. `clippy -D warnings` exits 0, so no dead code remains.
- **Logging discipline**: the place name is never logged (user content); the Studio path is never logged (contains the user profile); the one new warning logs no path.
- **Sibling test convention held** — `roblox/mod.rs:8-10` wires `instructions_tests.rs` via `#[cfg(test)] #[path]`, matching `roblox.rs:164-166`.

**One process note, recorded honestly:** three subagent sessions were truncated mid-edit during todo 4 and one aborted entirely, leaving the crate uncompilable. The orchestrator made two mechanical fixes (an out-of-scope variable reference and an unused import) to restore a compiling baseline before a worker finished the wiring. Every substantive piece of todos 4-9 was verified by re-running the real gates, not accepted on a worker's word.

---

## F3 — Real manual QA: **OUTSTANDING (correctly)**

The GUI proof has **not** been run. This gate cannot pass without the user at the
machine, and the evidence file says so plainly rather than implying the fix is verified:

> `STATUS: awaiting user confirmation`

What is genuinely unproven:

- A live Claude session receiving the shipped ~1.4k-char block. Todo 2 proved the
  *channel* with a 266-char synthetic marker; the real text has never been observed in
  a live request.
- The model **obeying** the block.
- The 28 real StudioMech schemas loading eagerly — the probe used a small synthetic server.
- Real eager-load token cost (~13,919 tokens per `06`) in a live session.

Verdict: **cannot approve**. Requires `.omo/evidence/task-10-roblox-tool-loading-v2.md`
to be executed and reported. This is expected, not a defect.

---

## F4 — Scope fidelity: **APPROVE**

- 10 files changed, 0 new tools defined, 0 new MCP servers, 0 transports.
- The only new module tree is `src-tauri/src/acp/host_mcp/roblox/` — 3 files, text
  only (no router, no proxy, no tool registration).
- Mechanism C (the ~250-line proxy) was **not** built — the plan's own gating rule.
- No work leaked into the separate RobloxKit project's scope (generative engines, Open
  Cloud admin).
- Todo 2's bare-string diagnostic was used only as evidence for a guardrail; nothing
  ships from it.

---

## Wave summary

| Gate | Verdict |
| --- | --- |
| F1 plan compliance | **APPROVE** |
| F2 code quality | **APPROVE** |
| F3 real manual QA | **OUTSTANDING** — needs the user's GUI run |
| F4 scope fidelity | **APPROVE** |

Three of four gates approve. F3 cannot be closed from here.

**Pre-existing failures, not caused by this work** (verified by stashing this work and
re-running on a clean tree — identical failures): `acp::claude_accounts::tests::links_never_replace_a_real_entry`
and `acp::destructive_guard::tests::a_session_in_a_nested_linked_worktree_does_not_block_the_enclosing_tree`.
Neither module was touched.