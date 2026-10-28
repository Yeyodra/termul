# 05 — Injection Channels & Fix Plan

> Derived from the verified runtime evidence in `00-runtime-evidence.md` and the
> source reads below. Every file:line here was opened, not inferred.

---

## 1. The channel that already exists

Termul injects its own stdio MCP server into every non-ephemeral session
(`src-tauri/src/acp/manager/mod.rs:1059-1067`):

```rust
let (port, token, provisional_sid) =
    self.host_plan_server.register_session(&agent_id.0);
let internal = build_internal_plan_stdio(&agent_id.0, port, &token, &provisional_sid);
// Prepend so the internal server is first in the agent's tool list.
let mut combined = internal;
combined.extend(mcp_servers);
```

That child's MCP `initialize` result carries `session_instructions()`
(`host_mcp/child.rs:377`):

```rust
.with_instructions(session_instructions())
```

and `session_instructions()` is (`host_mcp/mod.rs:90`):

```rust
format!("{TERMUL_CHAT_INSTRUCTIONS}\n\n{}", canvas_tools::instructions())
```

**So Termul already has a working, per-session, dynamic instruction channel.**
It is simply not used for Roblox.

---

## 2. Proof that MCP `instructions` reach the model

This was the one genuinely open question — if `instructions` were ignored by
`claude-agent-sdk`, the whole canvas feature would be dead too. It is not.

`claude.exe` contains a system-prompt section header:

```
# MCP Server Instructions

The following MCP servers have provided instructions for how to use their tools and resources:

The following MCP servers have disconnected. Their instructions above no longer apply:
```

Located at byte offset 132,193,004 of
`...\acp-registry-binaries\claude-acp\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`.

**Conclusion:** any `instructions` string returned by an MCP server's `initialize`
is surfaced to the model inside a dedicated `# MCP Server Instructions` block.
Adding Roblox guidance to `session_instructions()` will reach the model.

Corroborating evidence that Termul's own team relies on this channel:
`host_mcp/canvas_tools.rs:20-24` says the canvas guide is needed because
*"Some MCP clients never show the server `instructions` to the model"* — which is
why they ALSO prefix every canvas tool description with `DESCRIPTION_TAG`. Two
channels, deliberately redundant.

---

## 3. The canvas precedent — copy this shape

`canvas_tools.rs:26-47` is the exact template a Roblox block should follow:

```rust
const CANVAS_GUIDE: &str = "Design canvas: this project has a design canvas, Termul Canvas, a \
Figma-class editor. Its document is the project's .figcraft file ... When the user asks for a \
design, mockup, wireframe, screen or anything \"on the canvas\", build it with this server's \
canvas tools: create_node, set_properties, ... Do not create or edit .figcraft, .pen or \
.op files on disk, do not call open_file, and do not look for other design tools, MCP servers \
or canvas apps: these tools are the canvas.";
```

Note the four moves it makes, all of which the Roblox block needs:

1. **Names the capability** ("this project has a design canvas").
2. **Lists the exact tool names** the agent should call.
3. **Says what triggers it** ("when the user asks for a design, mockup, wireframe...").
4. **Explicitly forbids the wrong behaviour** ("do not create or edit .figcraft on disk").

The Roblox block must do (4) most of all, because the observed failure was exactly
the wrong behaviour: writing `Meja.lua` to disk instead of calling `execute_luau`.

---

## 4. Why "just use RobloxKit's proxy" is the wrong fix

RobloxKit's own rebuilt proxy (`robloxkit-lite/src/mcpserver.rs`) is a **pure
pass-through**:

- `initialize` → static reply, `instructions: "RobloxKit-lite internal tools (pass-through to StudioMCP)."` (`:345`)
- `tools/list` → `bridge.list_tools().await` (`:350`) — whatever StudioMCP says
- `tools/call` → `bridge.call_tool(name, arguments).await` (`:363`) — straight through

It adds **no tools, no renaming, no filtering, no context**. Its only real jobs are
(a) turning stdio into HTTP so it can ride ACP `mcpServers`, and (b) holding the
loopback bearer token.

Termul already rides ACP `mcpServers` over **stdio** directly, and
`gate_mcp_servers` accepts stdio unconditionally (`manager/gates.rs:43`). So the
proxy solves a problem Termul does not have.

**The original shipped RobloxKit binary is a different story** — it exposed 93
tools across 19 groups (`artifacts/mcp-tools-robloxkit.md`), including generative
engines, Open Cloud admin, and skills. But that surface lives in the **frontend**
bundle and is dispatched via `mcp:call` → frontend → `mcp_tool_result`, not in the
Rust proxy. Rebuilding it is the "months" track, not the "days" track.

For the immediate bug — *agent does not understand it is in a Roblox session* —
the proxy is irrelevant. Context injection fixes it.

---

## 5. Two hard constraints found while probing

### 5.1 Tool names differ — do not copy RobloxKit's instructions text

| RobloxKit (`lp` group) | StudioMCP (actual) |
|---|---|
| `read_console` | `get_console_output` |
| `read_script` | `script_read` |
| `edit_script` | `multi_edit` |
| `list_scripts` | `script_search` / `script_grep` |
| `capture_viewport` | `screen_capture` |
| `studio_state` | `get_studio_state` |

An instruction block written for RobloxKit would name six tools that do not exist
in Termul. The Roblox block must be written against the 28 StudioMCP names
(verified list in `00-runtime-evidence.md` §E2).

### 5.2 `studio_id` is declared required but is NOT enforced

All 27 non-`list_roblox_studios` tools list `studio_id` in `inputSchema.required`.
But at runtime it is optional — verified live:

```
tools/call get_studio_state  arguments: {}   →  isError: false
  "- Current Studio Mode: Edit
   - Available DataModels: Edit
   - Focused DataModel in the viewport: Edit"

tools/call execute_luau  arguments: {datamodel_type:"Edit", code:"..."}  →  isError: false
  "Workspace children: 23"
```

So an agent that omits `studio_id` still works, and it resolves to the focused
Studio. The instruction block should tell the agent it may omit `studio_id` when a
single Studio is open — otherwise a cautious agent will stall trying to discover a
UUID it does not need.

---

## 6. The fix, ranked

### P0 — Roblox session instructions (fixes the reported bug)

Add a `ROBLOX_GUIDE` beside `CANVAS_GUIDE` and compose it in
`session_instructions()` when the session is a Roblox session.

Shape of the text (all 28 tool names verified, `studio_id` note included):

```
Roblox Studio: this project drives a live Roblox place through the `roblox-studio`
MCP server. When the user asks for anything in the place — an object, a script, a
model, a UI, a change to the game — do it through these tools, not by writing
files. Tools: execute_luau, inspect_instance, search_game_tree, script_read,
script_grep, script_search, multi_edit, get_studio_state, get_console_output,
start_stop_play, generate_procedural_model, generate_mesh, generate_texture,
generate_material, insert_asset, search_asset, screen_capture, ...
Do NOT write .lua files to disk and do NOT create a Rojo project: these tools are
the place. `studio_id` may be omitted when one Studio is open. If a call fails
with a connection error, ask the user to open Studio and load a place.
```

Wiring question that must be answered before coding: `session_instructions()` is
**not** per-session today — it is a pure function with no arguments, called from
`TermulPlanServer::get_info()`. The Roblox flag therefore has to travel to the
child, e.g. as another env var (`TERMUL_PLAN_ROBLOX=1` + the place name) set by
`build_internal_plan_stdio`, which already takes `agent_id`/`port`/`token`/`sid`.

### P0 — Include the live place name

`liveStatus().placeName` is already fetched by the renderer for the lamp. Passing
it into the child env lets the instruction say *"the open place is 'Untitled
Experience (placeId: 93291914711483)'"* — exactly what RobloxKit does with
`- Open place: ${r.name} (studio_id ${r.id})`.

### P1 — Prefix the tool descriptions you can control

`DESCRIPTION_TAG` already exists for canvas tools. For Roblox there is nothing to
prefix — the tools belong to StudioMCP, not to Termul. So P1 is really: make sure
the `roblox-studio` server is **enabled** in the registry for the Roblox project
(it is, verified in `00` §E3), and consider hiding it for non-Roblox projects.

### P2 — Seed the workspace

`Documents/robloxkit` contains only `icon.svg`. Claude Code would auto-load a
`CLAUDE.md` there (the `--setting-sources=user,project,local` flag is passed).
Termul could write a small `CLAUDE.md` on workspace creation as a second,
redundant channel — same belt-and-braces logic as `DESCRIPTION_TAG`.

### P3 — Restrict agents (optional)

`.omo/robloxkit-bridge/13-implementation-status.md` claims a Claude-only filter
(`robloxMode`) was implemented. **It was never committed** — `grep robloxMode` over
`src/` returns nothing, and commit `04ac8e48` says *"No agent is restricted"*.
Decide whether to build it; it is not needed for the context bug.

---

## 7. What this does NOT fix

The 93-tool RobloxKit surface (generative 3D/VFX/SFX/icon engines, Open Cloud
admin, skills) is a separate, much larger effort. Injecting context makes the
agent use the **28 StudioMCP tools** correctly. It does not give it
`generate_3d`, `publish_place`, `ban_user`, or the 16 Roblox skills.

If the goal is genuine RobloxKit parity, the context fix is step 1 of a much
longer plan — but it is also the step that makes the current feature actually
work.
