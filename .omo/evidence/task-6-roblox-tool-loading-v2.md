# Task 6 — Ship Mechanism C (the `robloxkit` stdio proxy): NOT NEEDED

**Status: NOT NEEDED. No code was written. No proxy was built.**

## Why this todo was skipped

Todo 6 of `.omo/plans/roblox-tool-loading-v2.md` is gated on:

> Run only if todos 1 and 2 both failed and todo 3 reported WORKS.

Neither failed, so the gate never opened. Todo 1 measured Mechanism A′ as **WORKS**
with an `alwaysLoad:false` control, and todo 4 shipped it (verified: `cargo check`,
`clippy -D warnings`, and 54/161/325 tests all exit 0). The ~250-line proxy would be
pure waste.

## The chain of reasoning, with the measurements

| Todo | Question | Answer | Consequence |
| --- | --- | --- | --- |
| 1 | Does server-level `alwaysLoad` suppress deferral? | **WORKS** — `t_on`: `addedNames=29`, `probeInShape=2`, `toolCount=30`; control `t_off`: `addedNames=45`, `probeInShape=0`, `toolCount=14` | A′ is the mechanism |
| 2 | Does `_meta.systemPrompt.append` reach the model-facing prompt? | **WORKS** (structural) — marker present exactly once in `sp_append`, absent in `sp_none` | Carrier exists for the instruction block |
| 3 | Does per-tool `_meta["anthropic/alwaysLoad"]` survive a proxy? | **never asked** — the gate did not open | unknown, and moot |
| 4 | Ship A′ | **SHIPPED** | the fix exists without a proxy |
| **6** | **Build the proxy** | **not needed** | — |

## Why the proxy question is now moot

The proxy existed to re-publish the 28 tools each carrying
`_meta["anthropic/alwaysLoad"] = true`, because Termul cannot edit `StudioMCP.exe`.
Mechanism A′ achieves the same effect at the **server** level, which the SDK
documents as OR'd with per-tool flags (`sdk.d.ts:1216`: "except a tool the server
itself lists with _meta anthropic/alwaysLoad set to false"). So there is no need to
re-publish anything to carry a per-tool key.

A′ is also strictly better than the proxy on cost: ~20 lines versus a new child
process per session, no tool-name plumbing, no `instructions` re-serving, and no
per-tool schema rewriting.

## What this means for the plan

- The proxy stays a **documented contingent branch**, not scheduled work — exactly
  what `08-correction-alwaysLoad.md` required.
- The `robloxkit` server name is **not** introduced anywhere. The session still
  carries the ordinary `roblox-studio` entry in the registry; only the per-session
  request shape changes (array suppression + `_meta`).
- No `CHILD_ARG_ROBLOX`, no `is_roblox_child_invocation()`, no `build_internal_roblox_stdio()`,
  no changes to `main.rs` or `server_main.rs`.

## Honest note

This todo produced no measurement, which is the correct outcome given its gate. It
does mean **Mechanism C's feasibility through this adapter remains unproven** — the
question "does per-tool `anthropic/alwaysLoad` survive a proxy?" was never answered
because it stopped being relevant. If A′ ever regresses (for example a future Claude
Code version stops honouring server-level `alwaysLoad`), that question must be
re-opened from scratch, and the probe harness at `.omo/evidence/probe/` is the tool
to answer it with.