# 00 — Runtime Evidence (verified live on this machine)

> Collected by the orchestrator, not a subagent. Everything here was measured or
> read directly from disk / live processes on 2026-10-26. Nothing in this file is
> inferred.

---

## E1. Roblox Studio is running with a place loaded

```
PID 19400  RobloxStudioBeta  started 10/26/2026 11:45:55 AM
```

Probe via `StudioMCP.exe` → `list_roblox_studios`:

```json
{"studios":[{"id":"bee7f8ce-7366-499d-9591-8ce154cffae2",
             "name":"Untitled Experience (placeId: 93291914711483)"}]}
```

**Conclusion:** the Studio side is healthy. A place is open and reachable.

---

## E2. `StudioMCP.exe` handshake + tool count

`initialize` reply, verbatim:

```json
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":"2025-11-25",
  "capabilities":{"tools":{"listChanged":true}},
  "serverInfo":{"name":"RobloxStudio","version":"1.0.0"},
  "instructions":"Studio MCP Proxy - bridges MCP clients with Roblox Studio"}}
```

`tools/list` → **28 tools**:

```
upload_image, search_game_tree, script_search, skill, multi_edit, start_stop_play,
get_console_output, user_mouse_input, store_image, http_get, character_navigation,
script_read, get_studio_state, screen_capture, script_grep, wait_job_finished,
generate_procedural_model, generate_texture, segment_mesh, user_keyboard_input,
generate_mesh, subagent, execute_luau, generate_material, inspect_instance,
search_asset, insert_asset, list_roblox_studios
```

Exe path: `%LOCALAPPDATA%\Roblox\Versions\version-7aaa6838d36c4448\StudioMCP.exe`
(8,224,208 bytes). Four other `version-*` dirs exist **without** the exe, so the
scan in `roblox.rs` is genuinely required.

---

## E3. The MCP server IS injected into the agent process

Live `claude.exe` command lines show the injected config. Full `--mcp-config`
argument from PID 21528:

```json
{"mcpServers":{
  "termul":{"type":"stdio",
            "command":"C:\\Users\\Novella\\Documents\\Github\\termul\\src-tauri\\target\\debug\\termul-manager.exe",
            "args":["--internal-mcp-plan-server"],
            "env":{"TERMUL_PLAN_PORT":"62384",
                   "TERMUL_PLAN_TOKEN":"<redacted>",
                   "TERMUL_PLAN_SESSION_ID":"0af2d0e6-258c-4508-8e1f-950dd89b607e",
                   "TERMUL_PLAN_AGENT_ID":"cfcf8e5f-2f66-416a-be6d-428cc4eb49f3"}},
  "roblox-studio":{"type":"stdio",
                   "command":"C:\\Users\\Novella\\AppData\\Local\\Roblox\\Versions\\version-7aaa6838d36c4448\\StudioMCP.exe",
                   "args":[],"env":{}}}}
```

**Conclusion:** `roblox-studio` **is** wired into the agent. This is NOT a
registration bug.

Process tree proof that the child actually spawns from the agent:

```
MCP 14976 <- parent 12988 (termul-manager.exe)
MCP 25184 <- parent 21528 (claude.exe)
MCP 13320 <- parent 19672 (claude.exe)
MCP 18200 <- parent 23832 (claude.exe)
MCP 19836 <- parent 24132 (claude.exe)
MCP 11676 <- parent 23152 (claude.exe)
```

Five `StudioMCP.exe` children are spawned **by `claude.exe`**, i.e. the agent
connected the MCP server itself. The tool list reached the model.

---

## E4. But the agent never called a single Roblox tool

From `acp-sessions/c69f0013-c474-4aa1-b113-8970cfd772ae/tool-calls.jsonl`
(Roblox project, session "buatkan gw objek meja"):

| Tool kind | Count |
|---|---|
| `execute` (shell) | 5 |
| `edit` (write file) | 2 |
| `read` | 1 |
| **any Roblox/Studio tool** | **0** |

Same for `18af4721-6966-49c4-9ed1-8872e97fc55e` ("baju barcelona"): 14× `execute`,
0 Roblox tools.

Grep for `roblox-studio|StudioMCP|list_roblox|mcp__` across that session's
`messages.jsonl` → **0 hits**.

---

## E5. What the agent actually did instead

It wrote Lua files to disk:

```
C:\Users\Novella\Documents\robloxkit\src\Meja.lua               4184 bytes
C:\Users\Novella\Documents\robloxkit\src\contoh-pakai.server.lua 769 bytes
```

And its own words, from the screenshots:

> "Ambiguous: Roblox Lua script? Or a 3D model file (.obj)?"
> "folder ini nggak ada project Rojo/Studio"

The directory contained only `icon.svg` (written by Termul), `.codegraph/`, `.omo/`.
No `AGENTS.md`, no `CLAUDE.md`, no Rojo project.

---

## E6. Termul's only injected instructions say nothing about Roblox

`src-tauri/src/acp/host_mcp/mod.rs:78`:

```rust
pub const TERMUL_CHAT_INSTRUCTIONS: &str = "Termul renders your markdown replies in a rich chat UI. \
Embed images inline with `![alt](path)` — https URLs render everywhere; paths relative to the \
session working directory, absolute paths, and `file://` URLs render in the desktop app and \
fall back to alt text elsewhere (use this for generated charts, screenshots, diagrams). \
Reference files as markdown links `[label](path)`: Termul renders them as buttons that open \
the file in its built-in editor — absolute and cwd-relative paths inside the session workspace \
roots work, a `:line` suffix (or `#L<line>` on the link target) positions the cursor, and \
bare multi-segment file paths in prose become open-in-editor links too.";
```

And `mod.rs:90`:

```rust
pub fn session_instructions() -> String {
    format!("{TERMUL_CHAT_INSTRUCTIONS}\n\n{}", canvas_tools::instructions())
}
```

Two blocks: **markdown rendering** + **figcraft canvas**. Zero Roblox. Zero mention
of the `roblox-studio` MCP server that is being injected 20 lines away.

---

## E7. `placeName` never reaches the model

`robloxApi.liveStatus()` returns `{installed, running, connected, placeName}`.
Its only consumers are:

- `use-roblox-studio-status.ts` (polling hook)
- `RobloxStudioIndicator.tsx` (status-bar lamp)

Both are UI. `placeName` is never passed into `createSession`, `newSession`, or any
prompt builder. The green lamp the user sees is purely cosmetic from the agent's
point of view.

---

## E8. Claude Code reads CLAUDE.md — but there is none here

`claude.exe` is launched with `--setting-sources=user,project,local`, which means
Claude Code itself will load `CLAUDE.md` from the user dir and project dir.

- `~/.claude/CLAUDE.md` → **does not exist**
- `Documents/robloxkit/CLAUDE.md` → **does not exist**
- `Documents/robloxkit/AGENTS.md` → **does not exist**

So the one context channel that *would* have worked automatically is empty,
because Termul created the workspace as an empty folder and never seeded it.

---

## E9. RobloxKit does all three things Termul does not

`artifacts/frontend_src/assets/agentInstructions-DRb-9XyH.js` — the **session
context builder**, verbatim (unminified logic):

```js
function l({studios=[], studioId:t, status:n}) {
  let r = e.find(e => e.id === t);
  return [
    `RobloxKit session context`,
    `- Open place: ${r ? `${r.name} (studio_id ${r.id})` : `none selected`}`,
    `- Studio connection: ${n ?? `unknown`}`,
    `- Other Studio windows: ${e.filter(e => e.id !== t).map(e => e.name).join(`, `) || `none`}`,
    `- Skills to read first: roblox-performance; then the one for the task (${i().join(`, `)})`,
    `- Studio and workspace tools are on the \`robloxkit\` MCP server.`
  ].join(`\n`)
}
```

Three injection layers RobloxKit has:

| Layer | RobloxKit | Termul |
|---|---|---|
| **System rules** (`acp/rules.md`) | yes | no |
| **Tool catalog instructions** (`tools/instructions.md`) | yes | no |
| **Per-session context block** (place name, studio_id, connection status, "tools are on the `robloxkit` MCP server") | yes | no |
| **Skills list** (16 Roblox skills: building, rigging, vfx, ui, ...) | yes | no |

The asset bundles are fetched from `/api/assets/...` on RobloxKit's server, so the
*contents* of `rules.md` / `instructions.md` are not in the repo. The mechanism is
fully visible though, and that is what matters.

---

## E10. RobloxKit's tool names differ from StudioMCP's

RobloxKit exposes **93 tools / 19 groups** (`artifacts/mcp-tools-robloxkit.md`).
Its Studio group (`lp`, 9 tools):

```
search_game_tree, inspect_instance, read_console, execute_luau,
list_scripts, read_script, edit_script, capture_viewport, studio_state
```

vs StudioMCP's 28 tools which use different names:

```
script_read (not read_script), get_console_output (not read_console),
multi_edit (not edit_script), get_studio_state (not studio_state),
screen_capture (not capture_viewport), script_search / script_grep (not list_scripts)
```

So RobloxKit's `instructions.md` is written against **its own** tool names. Copying
that text verbatim into Termul would point the agent at tools that do not exist.
Any instruction block for Termul must be written against the 28 StudioMCP names.

**UNVERIFIED:** whether StudioMCP's own `instructions` string ("Studio MCP Proxy -
bridges MCP clients with Roblox Studio") is surfaced by `claude-agent-sdk` into
model context. It is returned on `initialize`, but whether the SDK forwards it is
not established here.

---

## E11. Six `termul-manager` processes are running

```
3552, 4764, 12988, 16368, 17448, 21576
```

`AGENTS.md` warns that the app takes a single-instance lock **by executable name**,
so several of these are stale. Not the cause of this bug, but worth cleaning before
any further manual test.
