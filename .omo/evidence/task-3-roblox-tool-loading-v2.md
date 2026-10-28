# Task 3 — Proxy probe: NOT NEEDED

**Status: NOT NEEDED. No probe was run. No product change was made.**

## Why this todo was skipped

Todo 3 of `.omo/plans/roblox-tool-loading-v2.md` is gated on:

> Run ONLY if todos 1 and 2 both failed; otherwise record "not needed" and stop.

Neither failed. Todo 1 measured the deferral mechanisms directly:

| Mechanism | Verdict | Decisive evidence |
| --- | --- | --- |
| **A′** — server-level `alwaysLoad` via `_meta.claudeCode.options.mcpServers` | **WORKS** | `t_on`: `addedNames=29`, `probeInAdded=0`, `toolCount=30`, `probeInShape=2`. Control `t_off`: `addedNames=45`, `probeInAdded=2`, `toolCount=14`, `probeInShape=0`. |
| **B** — `ENABLE_TOOL_SEARCH` env | **WORKS** (with `auto:N`, **not** bare `100`) | `b_auto100`/`b_false`: `deferred_tools_delta` absent entirely, `toolCount=43`, `probeInShape=2`. `b_100` behaved identically to unset → bare `100` is a silent no-op. |

Todo 2 additionally confirmed the instruction carrier:

| Question | Verdict | Decisive evidence |
| --- | --- | --- |
| `_meta.systemPrompt.append` reaches the model-facing prompt | **WORKS (structural)** | Marker `ROBLOX_CHANNEL_PROBE_7f3a9c` present exactly once at the tail of `sp_append/system-prompt.txt`; absent from `sp_none`. |
| Does the append suppress deferral | **No** — and that is expected | `sp_append_noload` (`append` present, `alwaysLoad:false`): `addedNames=31`, `probeInShape=0`. The append is a carrier, not a deferral fix. |

Since A′ works, the ~250-line proxy (Mechanism C) has no remaining purpose. Building
it now would be pure waste and would violate the plan's own "stop at the first
mechanism that works" decision.

## What this means for the rest of the plan

- **Todo 6 (Ship Mechanism C) is also not needed** and will be recorded the same way.
- The per-tool `_meta["anthropic/alwaysLoad"]` question this todo was meant to answer
  is now moot: A′ sets the *server-level* flag, which the SDK documents as OR'd with
  per-tool flags (`sdk.d.ts:1216`). There is no need to re-publish tools to carry a
  per-tool key.
- The proxy remains a documented contingent branch in the plan, not scheduled work —
  exactly as `08-correction-alwaysLoad.md` required.

## Evidence pointer

The measurements behind this decision live in:

- `.omo/evidence/task-1-roblox-tool-loading-v2.md` (mechanism verdicts, ordering trap)
- `.omo/evidence/task-2-roblox-tool-loading-v2.md` (carrier verdict, coexistence)
- `.omo/evidence/probe/runs/<run>/analysis.json` (raw per-run measurements)

## Honest note

This todo produced no new measurement. That is the correct outcome given its gate, but
it means Mechanism C's feasibility through this adapter remains **unproven** — todo 3's
original question ("does per-tool `anthropic/alwaysLoad` survive a proxy?") was never
answered, because it stopped being relevant. If A′ is ever found to regress in a future
Claude Code version, that question must be re-opened from scratch.
