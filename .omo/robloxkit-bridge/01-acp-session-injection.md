# 01 — How an MCP server reaches the agent (session injection)

Every claim cites `file:line`. Where I could not verify, it says UNKNOWN.

## 1. There are TWO injection paths, not one

This is the single most important structural fact.

| Path | What | Who controls it | Code |
|---|---|---|---|
| **A. User-configured registry** | Servers the user adds in Settings | The user, at runtime | `slices/mcp.ts`, `acp-mcp-persistence.ts` |
| **B. Host-injected `termul` server** | The `plan` / `ask_user` / canvas / browser tools | Hard-coded by Termul | `manager/mod.rs:1058-1070` |

Path A already exists and needs no Rust work. Path B is the pattern to copy if a
native, always-on Studio tool family is wanted.

## 2. Path A — user-configured MCP registry (already shipped)

### Transport support

`src/renderer/lib/acp-mcp-persistence.ts:9`
```ts
export type McpTransport = 'stdio' | 'http' | 'sse'
```

Wire mapping (`acp-mcp-persistence.ts:58-75`) — note it fills required fields so
the ACP schema validates:
```ts
case 'stdio': { const { name, command, args, env } = server
  return { type: 'stdio', name, command, args: args ?? [], env: env ?? [] } }
```

Validation requires `command` for stdio (`acp-mcp-persistence.ts:38-42`).

### Persistence

`StoredMcpServer = McpServerConfig & { id: string; enabled?: boolean }`
(`acp-mcp-persistence.ts:11`). Loaded/saved per project via
`loadMcpServers` / `saveMcpServers` (`slices/mcp.ts:9-13`), mirrored into a
project file by `syncMcpRegistryToProjectBestEffort` (`slices/mcp.ts:12`).

### Selection into a session

`src/renderer/stores/acp-store/slices/session.ts:1538-1543`:
```ts
createSession: async (agentId, cwd, mcpServers, projectId, opts) => {
  const ... = mcpServers === undefined
    ? selectMcpServersForAgent(get().mcpServers, get().agents[agentId]?.capabilities)
    : { servers: mcpServers, skipped: [], pending: false }
```
Then `acpApi.newSession(agentId, cwd, sessionMcpServers, {...})`
(`session.ts:1555`).

**`selectMcpServersForAgent` filters by agent capabilities.** This matters: if an
agent does not advertise HTTP MCP support, an `http` server is silently skipped.
A `stdio` server is never skipped (see §4).

### UI

`src/renderer/components/settings/McpServersSettings.tsx`:
- add/edit dialog, both modes — `:555`
- accepts a Claude Desktop `{"mcpServers": {...}}` wrapper on paste — `:173`, placeholder `:571`
- transport badge — `:382`
- "Add a stdio, HTTP, or SSE server. New agent chats can then use its tools." — `:328`
- per-server enable toggle — `slices/mcp.ts:247-250`

### On-demand probe

`src-tauri/src/acp/mcp_probe.rs` — opens a fresh rmcp client, `initialize` +
`tools/list`, closes. 10 s cap (`:54`). Stateless; does not touch the registry
(`:10-13`). Transport mapping: stdio → `TokioChildProcess` (`:17-20`), http →
`StreamableHttpClientTransport` (`:21-22`), sse → probed via the modern
streamable-http client because rmcp 1.7 dropped standalone SSE (`:23-28`).

Windows detail worth keeping: stdio children spawn with `CREATE_NO_WINDOW`
(`0x0800_0000`) so a GUI-launched probe does not flash a console (`:17-20`).

## 3. Path B — host-injected `termul` server

`src-tauri/src/acp/manager/mod.rs:1058-1070`:
```rust
let (combined_mcp_servers, plan_token): (Vec<McpServer>, Option<String>) =
    if !context.ephemeral || context.promotable {
        let (port, token, provisional_sid) =
            self.host_plan_server.register_session(&agent_id.0);
        let internal = build_internal_plan_stdio(&agent_id.0, port, &token, &provisional_sid);
        let mut combined = internal;   // prepended: first in the agent's tool list
        combined.extend(mcp_servers);
        (combined, Some(token))
    } else { (mcp_servers, None) };
```

So the host server is **prepended**, and user servers follow. Ephemeral
(non-promotable) sessions get no host server at all.

The stdio descriptor is built in
`src-tauri/src/acp/manager/gates.rs:113-136`:
```rust
let stdio = McpServerStdio::new("termul".to_string(), exe)
    .args(vec![crate::acp::host_mcp::CHILD_ARG.to_string()])
    .env(env);   // TERMUL_PLAN_PORT / _TOKEN / _SESSION_ID / _AGENT_ID
```
`exe` is `std::env::current_exe()`, falling back to a PATH lookup named
`termul-manager` (`gates.rs:119-122`).

Session lifecycle (`manager/mod.rs:1098-1117`): on success
`bind_session(&token, &outcome.session_id.0)`; on failure
`unregister_by_token(&token)` so a token cannot leak.

## 4. The capability gate — decides stdio vs http

`src-tauri/src/acp/manager/gates.rs:37-56`:
```rust
match server {
    McpServer::Stdio(_) => {}                                    // always allowed
    McpServer::Http(_) if caps.mcp_capabilities.http => {}
    McpServer::Sse(_) if caps.mcp_capabilities.sse => {}
    McpServer::Http(_) => return Err("agent does not support HTTP MCP servers"),
    McpServer::Sse(_) => return Err("agent does not support SSE MCP servers"),
    _ => return Err("agent does not support this MCP transport"),
}
```

**Consequence for a Studio bridge: use `stdio`, not `http`.**

`StudioMCP.exe` speaks MCP over stdio natively, so `stdio` is both the natural
transport and the one that can never be gated off. The RobloxKit clone used
`http` for its *internal* server (because that server was its own); Termul does
not need to repeat that.

`gates.rs:110-112` states this explicitly:
> "The internal server is `McpServer::Stdio`, which `gate_mcp_servers` accepts
> unconditionally (stdio is mandatory in ACP), so no gate relaxation is needed."

## 5. OAuth injection (does not affect Studio)

`manager/mod.rs:1075` calls `inject_oauth_tokens(combined_mcp_servers).await`
before gating. `gates.rs:59-79` adds an `Authorization: Bearer` header only when
the server has no `Authorization` header already (`gates.rs:85-90`), keyed by URL
(`gates.rs:91`).

A stdio server has no URL and no headers, so this is a no-op for Studio. Worth
knowing so nobody goes looking for why a token is not injected.

## 6. What `new_session_with_context` takes

`manager/mod.rs:1034-1040`:
```rust
pub async fn new_session_with_context(
    &self,
    agent_id: &AgentId,
    cwd: String,
    mcp_servers: Vec<McpServer>,
    context: SessionCreationContext,
) -> Result<NewSessionOutcome, String>
```

`SessionCreationContext` carries (from its use sites, `mod.rs:1079-1092`):
`additional_directories`, `project_id`, `ephemeral`, `worktree_path`,
`worktree_branch`, `command_id`, `promotable`. `Default` is used by the plain
`new_session` wrapper (`mod.rs:1019-1032`).

## 7. Resume/reload path

`load_session` (`manager/mod.rs:1124-1138`) takes `mcp_servers: Option<Vec<McpServer>>`:
- `None` → reopen as before, no client MCP list (`:1122`)
- `Some` → connects those servers plus the host plan server on this session (`:1123`)

`prepare_reopen_mcp` (`mod.rs:1137-1138`) does the work. The renderer passes
`options?.mcpServers` on reload (`slices/session.ts:1158, 1222, 1263`).

## 8. Where a new *entrypoint* would go

Both binaries branch on the child flag **before** Tauri/app init:
- `src-tauri/src/main.rs:24` — `if termul_manager_lib::host_mcp::is_child_invocation()`
- `src-tauri/src/server_main.rs` — same helper (per `child.rs:3-8` doc comment)

`is_child_invocation()` matches `CHILD_ARG` at any argv position
(`host_mcp/mod.rs:60-62`), deliberately unifying the desktop and standalone
binaries so they cannot drift.

## 9. Answer to "can Studio be added without touching Rust?"

**Yes, for the agent-facing half.** Add a stdio server pointing at
`StudioMCP.exe`. The registry, gating, probe, persistence and injection all
already work.

What zero-code does **not** give you:
- Studio exe auto-discovery (user must paste the path; it is version-dir-specific)
- `studio_id` auto-injection for the single-studio case
- a Studio status panel or place name in the UI
- Roblox-specific permission/consent posture

Those are the real deliverables of phase 2+.
