# 07 — OpenCode baseline: deferral is Claude-specific (PROVEN)

> Evidence supplied by the user as a live screenshot of the same prompt run
> against a different ACP agent in Termul. This closes open question T0.3.

---

## The test

Same project (Roblox), same prompt, **different agent**.

| | Claude Code | OpenCode |
|---|---|---|
| Prompt | `buatkan gw objek meja` | `buatkan gw objek meja'` |
| Words hinting at MCP | none | none |
| Roblox tools called | **0** | **4** |
| Outcome | wrote `Meja.lua` to disk | built a 9-part model in Workspace |

OpenCode's actual tool calls, in order:

```
roblox-studio_list_roblox_studios
roblox-studio_get_studio_state
roblox-studio_execute_luau
roblox-studio_screen_capture
```

Its reply:

> "Meja sudah jadi di Workspace — model bernama `Meja` (9 part, semua Anchored, sudah ada
> PrimaryPart = Top). Isinya: Top — permukaan meja 4 × 2 stud (WoodPlanks), tinggi 3 stud;
> Leg1–Leg4 — 4 kaki 0.3 × 0.3 stud (Wood), dinset 0.25 dari tepi; ApronFront/Back/Left/Right
> — rangka penyangga di bawah top (Wood)."

It even took a `screen_capture` to verify its own work, and offered to convert the
model to a `ProceduralModel` with attributes for tweaking.

---

## What this proves

### 1. Tool deferral is a Claude Code behaviour, not a general MCP/ACP problem

OpenCode received the same `roblox-studio` MCP server over the same Termul session
path and called its tools **immediately, with full schemas, on the first try**.
It has no `ToolSearch`, no `deferred_tools_delta`, no `ENABLE_TOOL_SEARCH`.

This retires the earlier hedge in `06` §"UNVERIFIED" — the claim is now measured,
not inferred.

### 2. StudioMCP's tool descriptions are self-documenting enough

OpenCode used `execute_luau` correctly on the very first call, with no Roblox
instructions injected by Termul and no `CLAUDE.md` in the workspace. The 28 tool
descriptions (measured at ~55,678 chars in `00` §E2) carry enough guidance on their
own.

**Consequence:** the `ROBLOX_GUIDE` instruction block is *not* required for basic
function. It remains useful for two narrower things:
- telling Claude to load schemas / not write `.lua` files, once deferral is off;
- the place name, which no tool description supplies.

### 3. The bug is narrowly scoped

Termul's Roblox feature is **not** architecturally broken. It works correctly with
an agent that loads its tools. The single defect is: *Claude Code defers the
StudioMCP tools, and Termul does nothing to prevent that.*

That reframes the fix from "build a Roblox integration layer" to "stop Claude from
deferring 28 tools".

---

## Tool naming difference (matters for the plan)

| Agent | Tool name shape | Example |
|---|---|---|
| Claude Code | `mcp__<server>__<tool>` | `mcp__roblox-studio__execute_luau` |
| OpenCode | `<server>_<tool>` | `roblox-studio_execute_luau` |

Termul renders whatever the agent reports; the naming is the agent's choice. So any
instruction text Termul injects must **not** hardcode one naming scheme. Refer to
tools by their bare names (`execute_luau`) and let the agent prefix them.

---

## Still open after this evidence

| Question | Status |
|---|---|
| Does `_meta.always_load` on a tool actually prevent Claude's deferral? | **UNVERIFIED** — strings show the key exists; no runtime test |
| Can `rmcp 3.5.0` emit `_meta` on a `Tool`? | **UNVERIFIED** — decides macro vs manual router |
| Does `ENABLE_TOOL_SEARCH=<big>` disable deferral entirely? | **UNVERIFIED** — code path `LUo()` not read |
| Is a proxy needed at all, or is the env var enough? | **depends on the two above** |
