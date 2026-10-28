# 01 — What context a coding agent gets when a chat session is created in Termul

Read-only code archaeology on `C:\Users\Novella\Documents\Github\termul` (HEAD `54e62076`).
Every claim below carries a `file:line` and a short quote. Anything I could not
verify is marked **UNVERIFIED**. Anything inferred is marked **SPECULATION**.

**Bottom line:** Termul injects exactly **two** static text blocks into an agent's
context, and both are UI-affordance instructions (chat markdown rendering + the
figcraft design canvas). There is **no** Roblox branch, **no** project-context-file
reader, and **no** use of the ACP `systemPrompt` field. `placeName` from
`robloxApi.liveStatus()` never leaves the status bar.

---

## 1. The full chain: AgentLauncher → session/new wire params

| # | Hop | File:line | Evidence |
|---|---|---|---|
| 1 | `AgentLauncher.launch()` (the `Ctrl+T` launcher's submit) | `src/renderer/components/agents/AgentLauncher.tsx:1490` | `const launch = useCallback(async () => {` |
| 2 | builds the first-turn blocks, then calls `finalizeChatLaunch` | `AgentLauncher.tsx:1684` | `realId = await liveStore.finalizeChatLaunch({` |
| 3 | `finalizeChatLaunch` → `startChat` | `src/renderer/stores/acp-store/slices/launch.ts:690` (def) → `:708` | `const sessionId = await get().startChat(configId, cwd, mcpServers, projectId, {` |
| 4 | `startChat` spawns/reuses the agent then calls `createSession` | `launch.ts:421` (def) → `:451` | `return get().createSession(agentId, trimmedCwd, mcpServers, projectId, opts)` |
| 5 | `createSession` selects MCP servers and calls `acpApi.newSession` | `src/renderer/stores/acp-store/slices/session.ts:1538` (def) → `:1555` | `acpApi.newSession(agentId, cwd, sessionMcpServers, {` |
| 6 | `acpNewSession` — dedupe key + ledger | `src/renderer/lib/acp-api.ts:1018` (def) → `:1049` | `getAcpTransport().newSession(agentId, cwd, mcpServers, { ...options, ...call })` |
| 7 | transport selection | `src/renderer/lib/acp-transport/index.ts:63` | `export function getAcpTransport(): AcpTransport {` (desktop → `DesktopAcpTransport`) |
| 8 | `WsAcpTransport.newSession` sends WS request `create_session` | `src/renderer/lib/acp-transport/ws-transport.ts:1030` (def) → `:1047-1048` | `const outcome = await this.request<NewSessionOutcome>('create_session', {` |
| 9 | Desktop carrier: same `WsAcpTransport`, socket = Tauri IPC Channel | `src/renderer/lib/acp-transport/desktop-transport.ts:38` | `export class DesktopAcpTransport extends WsAcpTransport {` |
| 10 | IPC `invoke('ws_channel_send')` | `src/renderer/lib/acp-transport/channel-socket.ts:181` | `await invoke('ws_channel_send', { connectionId: this.connectionId, frame })` |
| 11 | Rust command `ws_channel_send` | `src-tauri/src/web/ws/channel/commands.rs:32` | `pub fn ws_channel_send(` |
| 12 | WS dispatch table | `src-tauri/src/web/ws/dispatch.rs:124-126` | `"create_session" => { handle_create_session(...) }` |
| 13 | `handle_create_session` parses payload → `new_session_with_context` | `src-tauri/src/web/ws/projects.rs:51` (def) → `:111` | `.new_session_with_context(&parsed.agent_id, parsed.cwd, parsed.mcp_servers, SessionCreationContext {` |
| 14 | **Host injection point**: prepend the `termul` MCP child server | `src-tauri/src/acp/manager/mod.rs:1034` (def) → `:1058-1067` | see §4 below |
| 15 | sends `AcpCommand::NewSession` to the driver | `manager/mod.rs:1081` | `send_command(&tx, \|reply\| AcpCommand::NewSession {` |
| 16 | driver builds the actual ACP request | `src-tauri/src/acp/manager/command_loop.rs:129` (arm) → `:151-153` | `let mut request = NewSessionRequest::new(cwd.clone()).mcp_servers(mcp_servers).additional_directories(additional_directories);` |
| 17 | sent as raw JSON-RPC (legacy-`models` shim) | `command_loop.rs:161` → `src-tauri/src/acp/legacy_models.rs:159-168` | `let value = cx.send_request(message).block_task().await?;` |

### What the `session/new` params actually contain

The pinned schema is `agent-client-protocol-schema 1.4.0`
(`src-tauri/Cargo.lock:94-95`). `NewSessionRequest` has exactly four fields:

`C:\Users\Novella\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\agent-client-protocol-schema-1.4.0\src\v1\agent.rs:1011-1037`
```rust
pub struct NewSessionRequest {
    pub cwd: PathBuf,
    pub additional_directories: Vec<PathBuf>,
    pub mcp_servers: Vec<McpServer>,
    #[serde(rename = "_meta")]
    pub meta: Option<Meta>,
}
```

**There is no `system_prompt` field in this version.** `grep` over the whole 1.4.0
crate for `system_prompt`/`SystemPrompt` returns **zero** hits (the `unstable_session_system_prompt`
feature exists only in the *unpacked but unused* 1.12.0 copy in the cargo registry; Termul
does not depend on it). Termul's `Cargo.toml:116` enables only
`features = ["unstable_auth_methods", "unstable_elicitation"]`.

So the only prompt-ish things Termul can put on `session/new` are:
1. the `mcp_servers` list (which is how the instructions below reach the model), and
2. `_meta`, which Termul uses for exactly one thing — thinking display (see §6).

The `_meta` Termul actually sends, `src-tauri/src/acp/manager/command_loop.rs:154-156`:
```rust
if profile.summarize_thinking {
    request = request.meta(summarized_thinking_meta());
}
```
defined at `src-tauri/src/acp/manager/gates.rs:486-494`:
```rust
pub(super) fn summarized_thinking_meta() -> Meta {
    Meta::from_iter([("claudeCode".to_string(),
        serde_json::json!({ "options": { "thinking": { "type": "adaptive", "display": "summarized" } } }))])
}
```
No instructions, no project context — purely a reasoning-display toggle.

---

## 2. `TERMUL_CHAT_INSTRUCTIONS` — full text

`src-tauri/src/acp/host_mcp/mod.rs:71-85` (doc comment + constant, quoted verbatim):

```rust
/// Server `instructions` returned in the child's MCP `initialize` result.
/// Agents that connect the injected `termul` server surface this guidance in
/// model context, so it doubles as the advertisement for the chat renderer's
/// markdown affordances: inline images (`![alt](path)`) and file references
/// that open in Termul's built-in editor (`[label](path)` and bare paths).
/// Keep it static and surface-honest — where a URL form is unreadable the
/// renderer's existing fallbacks apply (alt chip / plain text).
pub const TERMUL_CHAT_INSTRUCTIONS: &str = "Termul renders your markdown replies in a rich chat UI. \
Embed images inline with `![alt](path)` — https URLs render everywhere; paths relative to the \
session working directory, absolute paths, and `file://` URLs render in the desktop app and \
fall back to alt text elsewhere (use this for generated charts, screenshots, diagrams). \
Reference files as markdown links `[label](path)`: Termul renders them as buttons that open \
the file in its built-in editor — absolute and cwd-relative paths inside the session workspace \
roots work, a `:line` suffix (or `#L<line>` on the link target) positions the cursor, and \
bare multi-segment file paths in prose become open-in-editor links too.";
```

Content summary: markdown image embedding, file-link rendering, `:line` suffixes.
**Zero mention of Roblox, Studio, Lua, Rojo, places, or any domain.** Zero mention of
the `roblox-studio` MCP server that is injected into the same `mcp_servers` array
(see §7 / the live `--mcp-config` in §5).

---

## 3. `session_instructions()` — what it composes, and whether there is a Roblox branch

`src-tauri/src/acp/host_mcp/mod.rs:87-95`:

```rust
/// The full `instructions` of the child's `initialize` result: the chat
/// guidance, then the design canvas guide.
#[must_use]
pub fn session_instructions() -> String {
    format!(
        "{TERMUL_CHAT_INSTRUCTIONS}\n\n{}",
        canvas_tools::instructions()
    )
}
```

**No Roblox branch. No conditional at all — the function takes no arguments and has a
single, unconditional `format!`.** Its only two call sites:

- `src-tauri/src/acp/host_mcp/child.rs:377` — `.with_instructions(session_instructions())`
- `src-tauri/src/acp/host_mcp/child/tests.rs:150` (test assertion)

Second half comes from `src-tauri/src/acp/host_mcp/canvas_tools.rs:28-51`:

```rust
const CANVAS_GUIDE: &str = "Design canvas: this project has a design canvas, Termul Canvas, a \
Figma-class editor. Its document is the project's .figcraft file (design.figcraft by default). \
When the user asks for a design, mockup, wireframe, screen or anything \"on the canvas\", build it \
with this server's canvas tools: create_node, set_properties, list_commands, run_command, batch, \
inspect_document, get_node, select, screenshot, export, undo and redo (pointer, key, type_text and \
inspect_ui drive the editor UI and need the canvas on screen). save_file saves the document; \
Termul chooses the file and ignores any path you pass. Do not create or edit .figcraft, .pen or \
.op files on disk, do not call open_file, and do not look for other design tools, MCP servers or \
canvas apps: these tools are the canvas. Agents cannot open the canvas. A CANVAS_CLOSED error \
means it is not open, so ask the user to open it with the Canvas button in Termul's left rail, \
then retry. Before your first canvas edit in a session, call read_canvas_guide with no topic to \
read the termul-canvas skill index (SKILL.md), then call it again for the required topics \
canvas-basics and working-protocol and for the guide that fits the request. When the user \
gives no brand or style, call get_canvas_style, pick one, run its apply batch and tell the user \
which style you chose. The canvas editor is FigCraft, and the rest of this section is its own \
guide.";

pub fn instructions() -> String {
    format!("{CANVAS_GUIDE}\n\n{}", figcraft_mcp::INSTRUCTIONS)
}
```

`figcraft_mcp::INSTRUCTIONS` is the third-party crate's own string
(`C:\Users\Novella\.cargo\git\checkouts\figcraft-30c4f372489bedd2\245506a\crates\mcp\src\server.rs:31`):
`"FigCraft is an interface design tool (Figma-class): pages hold frames, ..."`.

So the total injected instruction payload is: **chat markdown affordances + canvas guide +
figcraft's guide.** All three are UI/tool affordances. **No Roblox.**

---

## 4. How the internal `termul` MCP child advertises `instructions`

### 4a. The server config that makes the agent spawn it

`src-tauri/src/acp/manager/gates.rs:113-136`:

```rust
pub(super) fn build_internal_plan_stdio(
    agent_id: &str, port: u16, token: &str, provisional_sid: &str,
) -> Vec<McpServer> {
    let exe = std::env::current_exe().unwrap_or_else(|e| { ... });
    let env = vec![
        EnvVariable::new(crate::acp::host_mcp::ENV_PORT, port.to_string()),
        EnvVariable::new(crate::acp::host_mcp::ENV_TOKEN, token.to_string()),
        EnvVariable::new(crate::acp::host_mcp::ENV_SESSION_ID, provisional_sid.to_string()),
        EnvVariable::new(crate::acp::host_mcp::ENV_AGENT_ID, agent_id.to_string()),
    ];
    let stdio = McpServerStdio::new("termul".to_string(), exe)
        .args(vec![crate::acp::host_mcp::CHILD_ARG.to_string()])
        .env(env);
    vec![McpServer::Stdio(stdio)]
}
```

Server name is literally `"termul"`; argv is `["--internal-mcp-plan-server"]`
(`host_mcp/mod.rs:51`, `CHILD_ARG`).

### 4b. Where it is prepended to every session

`src-tauri/src/acp/manager/mod.rs:1058-1070`:

```rust
let (combined_mcp_servers, plan_token): (Vec<McpServer>, Option<String>) =
    if !context.ephemeral || context.promotable {
        let (port, token, provisional_sid) = self.host_plan_server.register_session(&agent_id.0);
        let internal = build_internal_plan_stdio(&agent_id.0, port, &token, &provisional_sid);
        // Prepend so the internal server is first in the agent's tool list.
        let mut combined = internal;
        combined.extend(mcp_servers);
        (combined, Some(token))
    } else {
        (mcp_servers, None)
    };
```

(`mcp_servers` here are the user's registry entries — which is how `roblox-studio` rides along.)

### 4c. The file that builds the `initialize` result

`src-tauri/src/acp/host_mcp/child.rs:359-377` — this is the answer to "which file builds it":

```rust
/// `#[tool_handler]` fills `call_tool`/`list_tools`/`get_tool` from the
/// per-instance router (static tools, canvas tools and the described
/// `browser` tool) and skips `get_info` because it is provided here: the
/// returned `instructions` land in the MCP `initialize` result so agents
/// learn they can embed images, link files for open-in-editor, and design
/// on the canvas. Resources and prompts are figcraft's, answered by
/// `canvas_tools`.
#[tool_handler(router = self.tool_router)]
impl ServerHandler for TermulPlanServer {
    fn get_info(&self) -> rmcp::model::ServerConfig {
        rmcp::model::ServerConfig::new(
            rmcp::model::ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_instructions(session_instructions())
    }
```

`get_info()` is what rmcp serialises into the `initialize` result's `instructions`
field — and also into `server/discover` (`child.rs:576-577` fills discover request
meta; test at `child/tests.rs:148-152` pins `discover["result"]["instructions"]` to
the same string).

The child also exposes five static tools (`child.rs:263, 278, 297, 311, 324`):
`plan`, `set_session_title`, `read_canvas_guide`, `get_canvas_style`, `ask_user`,
plus figcraft's tools (`canvas_tools::tools()`) and a parent-described `browser` tool.
**None of them are Roblox tools.**

### 4d. Empirical confirmation (this machine, live)

Running `claude.exe` command line (PID 19672) shows the injected config:
`--mcp-config {"mcpServers":{"termul":{...,"args":["--internal-mcp-plan-server"],...},"roblox-studio":{"type":"stdio","command":"...\\StudioMCP.exe","args":[],"env":{}}}}`.

And the transcript for the Roblox session
`%USERPROFILE%\.claude\projects\C--Users-Novella-Documents-RobloxKit\0f548212-....jsonl`,
line index 8, is an `attachment` of type **`mcp_instructions_delta`** whose content is
the model-facing `# MCP Server Instructions` system-reminder. It contains three sections:

```
## roblox-mcp      <- from ~/.claude.json user-level MCP server (NOT Termul)
## roblox-studio   <- "Studio MCP Proxy - bridges MCP clients with Roblox Studio"  (StudioMCP's own string)
## termul          <- TERMUL_CHAT_INSTRUCTIONS + CANVAS_GUIDE + figcraft INSTRUCTIONS
```

So the only Roblox-aware text the model ever saw came from **the Roblox MCP servers'
own `instructions`**, never from Termul. This is the single most important finding:
Termul's own injection is 100% Roblox-blind, and the Roblox awareness in the session
was contributed by third-party MCP servers describing themselves.

---

## 5. Does Termul ever read AGENTS.md / CLAUDE.md / any project context file?

**No. Verified by exhaustive search.**

- `grep -r "AGENTS\.md|CLAUDE\.md"` over `src-tauri/src` → 7 hits, **all of them code
  comments** referencing the repo's own logging policy, plus one real file-list entry:
  - `src-tauri/src/acp/claude_accounts/links.rs:25` — `pub const SHARED_FILES: &[&str] = &["settings.json", "CLAUDE.md"];`
    This is **not a read**: it is the list of user-level Claude config files that are
    *symlinked* between Claude Account config dirs (`ensure_links`, `links.rs:30-58`,
    which does `fs::create_dir_all` + `link_entry`, and only links a target
    `if !target.is_file() { continue; }`). Nothing is parsed, nothing is injected.
  - Remaining hits: `web/ws/relay/conn.rs:314`, `server_main.rs:199`, `server_main.rs:435`,
    `web/fs_api.rs:252`, `web/router/host_routes.rs:37` — comments only.
- `grep -r "AGENTS\.md|CLAUDE\.md|\.cursorrules|GEMINI\.md|copilot-instructions|rules\.md"` over `src/` → only
  comments (`CONTEXT.md` references in `acp-store/types.ts:620`, `agent-update-utils.ts:2`,
  `AgentLauncher.tsx:289`) — design-doc references, no file reads.
- `grep -r "readFile.*AGENTS|AGENTS.*readFile|projectContext|contextFile"` over `src/` → only
  `project-context-menu.tsx` / `project-list.tsx` (UI context menus, unrelated).
- `grep -r "read_to_string"` over `src-tauri/src` shows every file read in the crate. The
  only prompt-adjacent ones are `skills/files.rs:84` and `skills/mod.rs:156,260,528,658`
  — all `SKILL.md` bodies (see §6, item 4). **No config/instruction markdown file is ever
  read into a prompt.**

### What `--setting-sources=user,project,local` means (and why it matters)

The flag is **not** set by Termul's Rust code. `grep -r "setting-sources"` across the
whole repo (excluding `node_modules`/`target`) returns **exactly one hit**, and it is a
previous research note (`.omo/roblox-re/00-runtime-evidence.md:176`). Termul never
constructs that flag.

It is set by the **third-party adapter** `@agentclientprotocol/claude-agent-acp`:
`...\node_modules\@agentclientprotocol\claude-agent-acp\dist\acp-agent.js:8668`
```js
systemPrompt,
settingSources: ["user", "project", "local"],
```
which the Claude Agent SDK turns into argv at
`...\node_modules\@anthropic-ai\claude-agent-sdk\sdk.mjs` (line 157):
```js
if(D!==void 0)W.push(Ke("--setting-sources",D.join(",")));
```

Semantics (per the adapter's own docs, `dist/client-system-prompt.d.ts`): these are the
Claude Code *setting sources*. With `project` and `local` enabled, **Claude Code itself**
discovers and loads `CLAUDE.md` (user `~/.claude/CLAUDE.md`, project `<cwd>/CLAUDE.md`,
and `CLAUDE.local.md`), plus `.claude/settings.json`, hooks, etc. **Termul is not involved
in that read and cannot see or shape the result.** If a Roblox workspace had contained a
`CLAUDE.md`, Claude Code would have loaded it — Termul would have had nothing to do with it.

Verified on this machine: the workspace `C:\Users\Novella\Documents\robloxkit` contains
only `.codegraph/`, `.omo/`, `src/`, `icon.svg` — no `*.md` at any depth ≤1
(`Get-ChildItem -Filter *.md -Recurse -Depth 1` → empty). And
`%USERPROFILE%\.claude\CLAUDE.md` **does not exist**. Consistent with the prior note in
`00-runtime-evidence.md:179-181`.

Corroboration from the actual transcript: the session's `prompt_snapshot` attachment
(line 15, 10 blocks / 5,665 chars) is Claude Code's own preset prompt (Harness, Memory,
Environment, Context management, …). It contains the string `CLAUDE.md` **only inside the
Memory section's prose** ("Don't save what the repo already records (code structure, past
fixes, git history, CLAUDE.md)…"). It contains **no** `TERMUL_CHAT_INSTRUCTIONS` and **no**
`FigCraft`. That is the empirical proof that Termul's text arrives via the **MCP
instructions channel**, not the system prompt.

---

## 6. Every "system prompt" / "append system prompt" / "initial prompt" mechanism found

### Mechanisms Termul DOES use

1. **MCP server `instructions`** (the main one) — `host_mcp/child.rs:377` `.with_instructions(session_instructions())`.
   Delivered to the model by the client/agent as an `# MCP Server Instructions` system-reminder
   (observed verbatim at transcript line 8). Contents: §2 + §3.
2. **`_meta.claudeCode.options.thinking`** on `session/new`, `session/load`, `session/resume`
   — `manager/gates.rs:486-494`, applied at `command_loop.rs:154-156`, `:386-388`, `:477-479`.
   Reasoning display only, not instructions.
3. **The first user prompt at launch** — the launcher's `buildPromptParts()` output becomes the
   `session/prompt` content. `AgentLauncher.tsx:1529-1537` → `launch.ts:797-816`. It is exactly
   the user's text plus (optionally) skill framing and file `resource_link` blocks. See item 4.
4. **Skill framing inside the user prompt** — `src/renderer/lib/skills-prompt.ts:37-39`:
   ```ts
   const skillsSection = `# Agent Skills\n\n${lines.join('\n')}`
   ...
   return `${skillsSection}\n\n---\n\n${userInline}`
   ```
   Only emitted when the user typed a skill chip. It ships **paths**, not bodies
   (`skills-prompt.ts:3-4`: "the agent reads the body from disk via the path — no body is shipped").
   No skill is auto-injected.
5. **Agent-switch handoff summary** — `src/renderer/components/chat/handoff-summary.ts:89,120`:
   ```ts
   const HANDOFF_HEADER = '# Conversation handoff'
   ...
   /^You are taking over a conversation previously handled by .+ Summary of the prior conversation:$/
   ```
   This is the *only* place Termul synthesizes instruction-like prose for a model, and it is
   per-switch (agent→agent migration), not per-session-creation. It contains transcript turns only.

### Mechanisms Termul does NOT use (checked explicitly)

- **ACP `systemPrompt` / `sessionCapabilities.systemPrompt`**: field does not exist in the pinned
  schema 1.4.0 (zero grep hits). Termul never advertises it in
  `client_capabilities` (`src-tauri/src/acp/client.rs:54-83` advertises only
  `fs`, `terminal`, `auth`, `session.config_options`, `elicitation`, and two `_meta` flags).
- **`appendSystemPrompt`**: zero hits in `src-tauri/src` (`grep -r "append_system|appendSystem|system_prompt|systemPrompt"` → no matches).
  The adapter *supports* it (`dist/client-system-prompt.js:33-39` `sdkSystemPrompt`), but
  Termul never sends it.
- **`--append-system-prompt` CLI flag**: never constructed by Termul; the only argv the
  Rust side builds for an agent is `McpServerStdio::new(name, exe).args(...)` from the user's
  agent config (`src-tauri/src/acp/agent_process.rs:137` `command.args(&stdio.args);`).
- **`_meta.systemPrompt`** (the adapter's AIR extension, `dist/air-extension.js:76-77`
  `JETBRAINS_META_KEY = "jetbrains"` / `AIR_META_KEY = "air"`, read at `acp-agent.js:8535-8550`):
  Termul does not set it. `grep -r "customInstructions|air\b"` in `src-tauri/src` → only
  `_meta.claudeCode` thinking usage.
- **A greeting/welcome prompt**: there is no synthetic first prompt in Termul. The renderer's
  "synthetic greeting turn" language (`helpers.ts:106-114`, `session_payload.rs:127-133`) refers to
  *hiding* a blank user bubble on replay, not to Termul sending one. (The transcript's first
  real user message is the user's own text: `{"type":"text","text":"buatkan gw objek meja"}`.)

---

## 7. Where `robloxApi.liveStatus()` / `placeName` is consumed — UI only, proven

### Producer (Rust)

- `src-tauri/src/roblox/live_status.rs:15-24` defines the struct; `:113` the command:
  ```rust
  #[tauri::command]
  pub async fn roblox_studio_live_status() -> RobloxStudioLiveStatus {
  ```
- Registered at `src-tauri/src/lib.rs:1925` — `roblox::live_status::roblox_studio_live_status,`

### Consumer (renderer) — exactly two files

`grep -r "liveStatus"` over `src/` returns only:
- `src/renderer/lib/tauri-roblox.ts:57` — the IPC wrapper: `return invokeIpcWrapped<RobloxStudioLiveStatus>('roblox_studio_live_status')`
- `src/renderer/hooks/use-roblox-studio-status.ts:88` — `const result = await robloxApi.liveStatus()`

`grep -r "useRobloxStudioStatus|RobloxStudioIndicator"` shows the hook's only caller is
`src/renderer/components/RobloxStudioIndicator.tsx:55`:
```ts
const status = useRobloxStudioStatus({ enabled: isRobloxProject })
```
and the indicator's only caller is `src/renderer/components/StatusBar.tsx:183`:
```tsx
<RobloxStudioIndicator project={project} />
```

`placeName` is read at exactly two places, both render-only
(`RobloxStudioIndicator.tsx:61-62` and `:82`):
```ts
const placeName = status.placeName
const summary = placeName ? `${label}: ${placeName}` : label
...
<span className="truncate leading-none">{placeName ?? STATE_TEXT[state]}</span>
```

### Proof it is not used for prompt building

- `placeName` never appears in `AgentLauncher.tsx`, `launch.ts`, `session.ts`, `acp-api.ts`,
  `ws-transport.ts`, `skills-prompt.ts`, `handoff-summary.ts`, or any Rust file. The only
  `place_name` in Rust is `roblox/live_status.rs` (`:22`, `:42`, `:61`) and
  `roblox/session.rs` (`StudioSnapshot::place_name()`), consumed solely by
  `resolve_status`/`RobloxStudioLiveStatus::connected`.
- The `createSession`/`newSession` parameter lists (hops 5–8 above) have no field capable of
  carrying it: `(agentId, cwd, mcpServers, projectId, opts{ephemeral,promotable,worktreePath,worktreeBranch,additionalDirectories})`.
- `roblox-studio-status-indicator.md` (the design brief) frames the whole feature as "a
  connection lamp + the open place's name" with nothing about prompting.

**Verdict: `placeName` is consumed ONLY by the status-bar lamp. It never reaches a prompt,
a session, or the agent process.** (Note: `liveStatus` also has a side effect in Rust —
`session::shutdown()` when Studio is not running, `live_status.rs:145-149` — but that is the
host's own probe child, not the agent's.)

### The other two Roblox APIs, for completeness

- `robloxApi.studioPath()` → `roblox-studio-mcp.ts:31` `ensureRobloxStudioMcp()` → writes the
  `roblox-studio` entry into the **user MCP registry** (`robloxStudioEntry`, `roblox-studio-mcp.ts:13-24`).
  That is the *only* way Roblox reaches the agent, and it does so as an ordinary stdio MCP server
  whose `instructions` come from `StudioMCP.exe` itself.
- `robloxApi.workspacePath()` → `roblox-studio-mcp.ts:65` `ensureRobloxProject()` → creates/updates
  the project named `Roblox` at `~/Documents/RobloxKit` (`src-tauri/src/roblox.rs:23`,
  `WORKSPACE_DIR_NAME = "RobloxKit"`). Rust also writes an `icon.svg` there (`roblox.rs:141-155`).
  **It seeds no `AGENTS.md`, no `CLAUDE.md`, no README, no `.rojo` — only the icon.**

---

## 8. Answers to the two headline questions

**Q: What context does a coding agent receive when a chat session is created in Termul?**
1. The ACP `session/new` params: `cwd`, `additional_directories`, `mcp_servers`, `_meta`
   (`_meta.claudeCode.options.thinking` only). No prompt text.
2. The `termul` MCP server's `instructions`: chat-markdown affordances + canvas guide +
   figcraft's guide (§2, §3).
3. Whatever the user's configured MCP servers advertise in their own `initialize.instructions`
   (e.g. `roblox-studio`'s one-liner) — Termul does not author or curate this.
4. Claude Code's own preset system prompt and its `CLAUDE.md`/settings discovery, because the
   third-party adapter passes `--setting-sources=user,project,local`. Termul is not involved.
5. The user's first typed message (plus skill framing / file links if the user used those).

**Q: Is any of it Roblox-aware?**
**No — nothing Termul authors is Roblox-aware.** The single Roblox string in a session comes
from `StudioMCP.exe` describing itself ("Studio MCP Proxy - bridges MCP clients with Roblox
Studio"), which Termul merely forwards as an opaque user-configured MCP entry. `session_instructions()`
has no Roblox branch, `TERMUL_CHAT_INSTRUCTIONS` has no Roblox word, and `placeName` is
status-bar-only.

---

## 9. Unverified / speculative

- **UNVERIFIED:** whether every ACP client/adapter forwards MCP `instructions` into model
  context. The adapter here (`claude-agent-acp`) demonstrably does (transcript line 8). Whether
  Codex/Gemini/Cursor adapters do is out of scope and not checked.
- **UNVERIFIED:** the exact ordering/precedence Claude Code applies between the preset system
  prompt and the `# MCP Server Instructions` reminder. Only that both appear was observed.
- **SPECULATION (labelled):** a Roblox-aware instruction block could be added either (a) as a
  new section appended in `session_instructions()` (cheap, always-on, would need to be
  project-conditional since that function currently takes no arguments), or (b) as a
  `CLAUDE.md`/`AGENTS.md` seeded into the Roblox workspace at creation
  (`roblox.rs:128-137` already writes there), which would ride the adapter's existing
  `--setting-sources=project` path with zero Rust prompt plumbing. Option (b) is the only one
  that works without touching the instruction chain. I have not implemented or tested either.
- **UNVERIFIED:** whether Termul's `_meta` thinking key would collide with an AIR
  `customInstructions` key if both were sent. They are on different meta subtrees
  (`claudeCode.options` vs `jetbrains.air`), so no collision is expected, but this was not tested.
