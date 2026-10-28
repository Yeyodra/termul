# 06 — ROOT CAUSE VERDICT (final)

> Supersedes the earlier hypothesis in `05-injection-channels-and-fix-plan.md` §6 P0,
> which said "add Roblox instructions to `session_instructions()`". That is still
> **necessary but NOT sufficient**. The real blocker is one layer below.

---

## The actual root cause: tool deferral

`claude.exe` does not put MCP tools in the model's tool list. It **defers** them.

From the real Claude Code transcript of the user's Roblox session
(`%USERPROFILE%\.claude\projects\C--Users-Novella-Documents-RobloxKit\0f548212-a22c-4d10-a12c-1f435283b0c9.jsonl`,
line 7, `attachment.type = "deferred_tools_delta"`):

```
addedNames: 84 entries
  ... mcp__roblox-studio__execute_luau
      mcp__roblox-studio__inspect_instance
      mcp__roblox-studio__search_game_tree
      mcp__roblox-studio__script_read
      ... (28 roblox-studio tools total)
      mcp__termul__plan, mcp__termul__create_node, ... (33 termul tools)
      mcp__roblox-mcp__* (15 tools from a user-level server)
      CronCreate, WebFetch, WebSearch, NotebookEdit, ... (15 built-ins)
wireHiddenNames: 0
pendingMcpServers: (none)   failedMcpServers: (none)   needsAuthMcpServers: (none)
```

And the system-reminder the model received (same file, line 7, `rendered[0].content`):

> The following deferred tools are now available via ToolSearch. **Their schemas are
> NOT loaded — calling them directly will fail with InputValidationError.** Use
> ToolSearch with query `"select:<name>[,<name>...]"` to load tool schemas before
> calling them.

And `ToolSearch`'s own description (line 19):

> Fetches full schema definitions for deferred tools so they can be called. Deferred
> tools appear by name in `<system-reminder>` messages. **Until fetched, only the name
> is known — there is no parameter schema, so the tool cannot be invoked.**

**So the 28 Roblox tools were present-but-unusable.** The model knew the names
existed but had no schemas, and therefore no reliable way to call them.

---

## Proof from the two sessions in the same transcript

| | Turn 1: "buatkan gw objek meja" | Turn 2: "cek koneksi mcp robloxstudio" |
|---|---|---|
| Tool calls | 8× `Bash`, 2× `Write`, 2× `Read` | 1× `ToolSearch("roblox studio")` → 1× `list_roblox_studios` → 1× `get_studio_state` |
| Roblox tools used | **0** | **2** |
| Outcome | wrote `Meja.lua` to disk | confirmed live Studio connection |

The difference is not the MCP config (identical session, same `--mcp-config`). The
difference is that in turn 2 the user's prompt contained the word **"mcp"** and
**"robloxstudio"**, so the model went looking and called `ToolSearch`. In turn 1 the
prompt was "buatkan gw objek meja" — nothing pointed at Studio, so the model never
searched, and fell back to writing a `.lua` file.

This exactly matches the user's complaint. And it explains the model's own words in
turn 1: *"Ambiguous: Roblox Lua script? Or a 3D model file (.obj)?"* — it genuinely
did not know a live place was reachable, because the tool schemas were not loaded.

---

## What is NOT the problem (all ruled out, verified)

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Studio not installed | **NO** | `StudioMCP.exe` at `version-7aaa6838d36c4448`, 8,224,208 bytes |
| Studio not running | **NO** | `RobloxStudioBeta` PID 19400 |
| Place not loaded | **NO** | `list_roblox_studios` → `Untitled Experience (placeId: 93291914711483)` |
| MCP not registered | **NO** | `store.json` → `shared/lww/acp/mcp-servers` has `roblox-studio`, `enabled: true` |
| MCP not injected | **NO** | `claude.exe --mcp-config` carries `roblox-studio`; 5 `StudioMCP.exe` children have `claude.exe` as parent |
| MCP tools not reaching model | **NO** | `deferred_tools_delta` lists all 28 `mcp__roblox-studio__*` names |
| Tool broken | **NO** | `execute_luau` returned `"Workspace children: 23"` live |
| `instructions` channel dead | **NO** | `mcp_instructions_delta` delivered 3 blocks incl. `## roblox-studio` |
| Termul sends no Roblox context | **YES, but secondary** | `session_instructions()` = markdown guide + canvas guide only |

---

## Why instructions alone will not fix it

Even with a perfect Roblox paragraph in `session_instructions()`, the model would
know *"there are Roblox tools, use them"* but still lack the schemas. It would have
to call `ToolSearch` first. That is one extra hop the model may or may not take —
and turn 1 proves it often will not.

Worse: the instruction would name tools like `execute_luau` that the model cannot
call without a schema fetch, so a naive instruction could increase
`InputValidationError` failures.

**The fix must make the tools non-deferred, and then add the context.**

---

## The fix, in dependency order

### Step 1 (REQUIRED) — force the Roblox tools to load eagerly

`claude.exe` supports an `alwaysLoad` flag per MCP tool. Strings found in
`claude-agent-sdk-win32-x64\claude.exe`:

```
@126375864  readOnlyHint / destructiveHint / openWorldHint / searchHint /
            alwaysLoad / maxResultSizeChars / requiresUserInteraction
@126375864  search_hint / always_load / max_result_size_chars /
            requires_user_interaction
@127037685  --mcp-config alwaysLoad servers
            CLAUDE_CODE_MCP_ALWAYS_LOAD_JOIN_BEFORE_INPUT
@132875099  "Tool search disabled: ... ENABLE_TOOL_SEARCH=true overrides this"
```

Two viable levers, both outside Termul's Rust code:

**(a) `always_load` in the tool's `_meta`.** StudioMCP would have to declare it —
Termul cannot edit StudioMCP. So this is only possible if Termul wraps StudioMCP in
its own MCP server that re-publishes the tools with `_meta.always_load = true`.
This is the one place where a proxy **is** justified.

**(b) `ENABLE_TOOL_SEARCH` env var — the mechanism, decoded.**

The deferral is **threshold-based on tool-description size**, not a fixed tool count.
From `claude.exe` (minified, offsets ~257,700,877 and ~252,992,648):

```js
var c7e = 10;                                  // default: 10 (% of context window)
function f7e() {
  let e = process.env.ENABLE_TOOL_SEARCH;
  if (!e) return c7e;                          // unset      -> 10
  if (e === "auto") return c7e;                // "auto"     -> 10
  let n = LUo(e);                              // numeric    -> that number
  if (n !== null) return n;
  return c7e;
}
var hfr = 2.5;
function fcn(e) { let n = Hm(e, aH(Cer(e))), r = f7e() / 100; return Math.floor(n * r); }
function yfr(e) { return Math.floor(fcn(e) * hfr); }   // char fallback threshold

async function wfr(e,n,r,s,h) {
  let y = await kfr(...);                      // deferred tool tokens
  if (y !== null) {
    let D = fcn(s);
    return { enabled: y >= D,
             debugDescription: `${y} tokens (threshold: ${D}, ${f7e()}% of context)` };
  }
  let S = await bfr(...), w = yfr(s);
  return { enabled: S >= w, debugDescription: `${S} chars (threshold: ${w})` };
}
```

So: **deferred-tool description tokens >= N% of the context window ⇒ tool search
(auto-deferral) turns ON.** Default `N = 10`.

The user's session had **84 deferred tools**, 28 of them `mcp__roblox-studio__*`.
Measured on this machine, those 28 tools alone are:

```
TOTAL chars (description + inputSchema): 55,678
approx tokens:                           ~13,919
```

Per-tool, the worst offenders:

| Tool | chars |
|---|---|
| `search_asset` | 7,498 |
| `user_keyboard_input` | 4,500 |
| `inspect_instance` | 4,098 |
| `search_game_tree` | 3,808 |
| `generate_procedural_model` | 3,724 |
| `skill` | 3,440 |
| `multi_edit` | 3,243 |
| `http_get` | 2,602 |
| `generate_mesh` | 2,498 |
| `user_mouse_input` | 2,246 |
| `subagent` | 2,100 |

~13,919 tokens of Roblox tool definitions, on top of 33 `termul` tools and 15
`roblox-mcp` tools, comfortably crosses 10% of the context window — which is exactly
why `auto_above_threshold` fired and all 28 were deferred.

Other decoded messages confirm the modes:

```
"Auto tool search enabled: <debugDescription> [source: auto_above_threshold]"
"Auto tool search disabled: <debugDescription> [source: auto_below_threshold]"
"Tool search disabled for model '<x>': model does not support tool_reference blocks."
"Tool search disabled: ToolSearchTool is not available (may have been disallowed via disallowedTools)."
"Tool search disabled: this conversation has run without ToolSearch ... ENABLE_TOOL_SEARCH=true overrides this."
```

**Practical consequence:** raising `ENABLE_TOOL_SEARCH` to a large number (e.g. `100`)
pushes the threshold past 100% of the window, so `y >= D` is never true and
auto-deferral never engages — every MCP tool schema is loaded eagerly.

**UNVERIFIED:** that `ENABLE_TOOL_SEARCH=100` is honoured as a plain number (the code
path `LUo(e)` parsing is not visible), and whether eager loading of 28 long Roblox
descriptions costs enough context to hurt. Both must be measured, not assumed.

### Step 2 (REQUIRED) — add Roblox session instructions

As designed in `05` §6 P0. Now it becomes useful, because the tools are callable.

### Step 3 (RECOMMENDED) — tell the model to call `ToolSearch` first

Cheap, zero-risk fallback that works even if Step 1 fails:

```
Before using any Roblox Studio tool, call
ToolSearch("select:mcp__roblox-studio__execute_luau,...") to load the schemas.
```

This is a single sentence in the instruction block and it converts the failure mode
from "silently writes files" into "loads schemas then works".

---

## Why a thin proxy is now justified (correction to `02` §8)

`02-robloxkit-proxy-architecture.md` concludes the RobloxKit proxy adds nothing.
That is true for **transport** — Termul already does stdio MCP directly.

But it is **not** true for **tool metadata**. A Termul-owned MCP proxy in front of
`StudioMCP.exe` could:

1. Re-publish the 28 tools with `_meta.always_load = true` → fixes the deferral.
2. Rewrite descriptions to add Roblox context per tool (the `DESCRIPTION_TAG`
   pattern Termul already uses for canvas tools in `canvas_tools.rs:20-24`).
3. Serve its own `instructions` naming the exact tool set.
4. Optionally add a `studio_call`-style meta-tool that injects `studio_id`.

That is a small, well-scoped piece of Rust — Termul already owns an identical
pattern (`TermulPlanServer` in `host_mcp/child.rs`).

---

## What this still does not give you

The 93-tool RobloxKit surface (generative 3D/VFX/SFX/icon engines, Open Cloud admin,
16 Roblox skills) remains out of scope. Fixing deferral + context makes the **28
StudioMCP tools** work. It is not RobloxKit parity.
