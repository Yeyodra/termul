# 02 — The host-injected MCP pattern (`acp/host_mcp/`)

Read this only if a **native** Studio tool family is wanted (Phase 3+). For the
first milestone this is not needed — see `01-acp-session-injection.md` §2.

Every claim cites `file:line`. UNKNOWN where unverifiable.

## 1. Shape: child ↔ parent over loopback TCP

```
agent  --stdio MCP-->  child (same exe, --internal-mcp-plan-server)
                          |  one TCP frame per tool call
                          v
                       parent (HostPlanServer, in-process listener 127.0.0.1:<ephemeral>)
                          |  emits events / performs host action
                          v
                       renderer (via EventSink fan-out)
```

The child is the *same binary* re-executed (`child.rs:3-8`). It holds no Tauri
state, so it works identically on desktop and standalone `termul-server`.

## 2. Why a child process at all

The agent's MCP client needs a **stdio** transport. Termul's own process cannot
be that transport for an already-running GUI app, so it re-spawns itself with a
flag and pipes MCP through the child. The child then reaches back into the live
process over loopback TCP.

## 3. `ChildConfig` and env (`child.rs:41-74`)

```rust
pub struct ChildConfig { pub port: u16, pub token: String,
                         pub session_id: String, pub agent_id: String }
```

Parsed from `TERMUL_PLAN_PORT` / `_TOKEN` / `_SESSION_ID` / `_AGENT_ID`
(constants at `host_mcp/mod.rs:66-69`). `AGENT_ID` is optional → `""`
(`child.rs:66-67`). Missing required env → error string → `run()` prints and
exits 1 (`child.rs:81-88`).

## 4. `run()` entrypoint (`child.rs:81-108`)

Builds a **current-thread** tokio runtime (`child.rs:90-93`), then
`serve_mcp_server(config)` (`child.rs:101`). Returns `i32` so both `main.rs`
(`std::process::exit`) and `server_main.rs` (`ExitCode::from`) can use it
(`child.rs:78-80`).

## 5. The server struct (`child.rs:113-143`)

```rust
struct TermulPlanServer {
    config: ChildConfig,
    tool_router: ToolRouter<Self>,   // per-INSTANCE, because it is extended at runtime
}
```

Construction (`child.rs:131-143`) — **this is the extension point**:

```rust
fn new(config: ChildConfig, browser: Option<DescribedTool>) -> Self {
    let mut tool_router = Self::tool_router();          // static #[tool] routes
    for tool in canvas_tools::tools() {                 // dynamic routes
        tool_router.add_route(canvas_route(tool));
    }
    if let Some(tool) = browser {                       // runtime-described route
        tool_router.add_route(browser_route(tool));
    }
    Self { config, tool_router }
}
```

Three registration mechanisms coexist:

| Mechanism | Example | When the tool set is known |
|---|---|---|
| `#[tool]` macro | `plan`, `ask_user`, `read_canvas_guide` | compile time |
| `add_route` + `tools()` | canvas (`canvas_tools::tools()`) | child startup, from a crate |
| `add_route` + describe | `browser` (`describe_browser_tool`) | child startup, from the parent |

## 6. Dynamic registration — the pattern to copy

`child.rs:215-226`:
```rust
fn canvas_route(tool: Tool) -> ToolRoute<TermulPlanServer> {
    ToolRoute::new_dyn(tool, |context: ToolCallContext<'_, TermulPlanServer>| {
        let config = context.service.config.clone();
        let name = context.name.to_string();
        let arguments = context.arguments.map_or(Value::Null, Value::Object);
        Box::pin(async move {
            Ok(canvas_tools::call_tool(config, name, arguments).await.into())
        })
    })
}
```

The closure returns a boxed future resolving to `Result<CallToolResult, ErrorData>`
(the `.into()` converts `CallToolResult`). Because the router is a **field** on
the instance, `#[tool_handler]` must be told to use it:
`#[tool_handler(router = self.tool_router)]` (`child.rs:367`).

> UNKNOWN: the exact `ToolRoute::new_dyn` / `ToolRouter::add_route` signatures.
> rmcp 3.5.0 source is not vendored on this machine (grep for `rmcp` in the
> cargo registry returned nothing), so this is read from **usage**, not from the
> crate source. Do not treat the generic bounds as verified.

## 7. `get_info` lives in the `ServerHandler` impl, deliberately

Comment at `child.rs:257-260`: the static tools are declared in a
`#[tool_router] impl TermulPlanServer` block, while `get_info` must live in the
`#[tool_handler] impl ServerHandler` block below so it can attach
`session_instructions()` to the `initialize` result.

`child.rs:369-378`:
```rust
fn get_info(&self) -> rmcp::model::ServerConfig {
    rmcp::model::ServerConfig::new(
        rmcp::model::ServerCapabilities::builder()
            .enable_tools().enable_resources().enable_prompts().build(),
    ).with_instructions(session_instructions())
}
```

`session_instructions()` (`host_mcp/mod.rs:90-95`) = chat markdown guidance +
`canvas_tools::instructions()`. **This is where a Studio guide would be appended.**

## 8. Frame protocol

### `FrameKind` (`host_mcp/mod.rs:142-158`, `rename_all = "snake_case"`)

| Variant | Wire | Purpose |
|---|---|---|
| `Plan` | `plan` | full-replace todo list |
| `SetTitle` | `set_title` | session title + branch slug |
| `Browser` | `browser` | browser automation dispatch |
| `Describe` | `describe` | child asks parent for a tool schema |
| `AskUser` | `ask_user` | question panel, blocks until answered |
| `Canvas` | `canvas` | figcraft control protocol |

**No `Studio` variant exists.** Adding one is the minimal change for a native
Studio family.

### `FrameRequest` (`host_mcp/mod.rs:324-353`)

Fields: `token`, `session_id`, `kind`, `todos`, `title`, `branch`,
`browser_input`, `ask`, `canvas_method`, `canvas_params`, `canvas_tool`.

### `FrameReply` (`host_mcp/mod.rs:357-408`)

`{ ok, error?, code?, result? }` with constructors `ok()`, `ok_with(v)`,
`err(msg)`, `err_code(code, msg)`.

Frame cap: `MAX_REQUEST_FRAME_BYTES = 1 MiB` (`host_mcp/mod.rs:322`).

## 9. Parent: `HostPlanServer` (`parent.rs`)

### Startup (`parent.rs:116-201`)

`start(sinks, persistence)` → `Arc<Self>`. Spawns a **dedicated OS thread** named
`termul-host-mcp` (`:143-145`) with its own current-thread runtime (`:146-156`),
binds `127.0.0.1:0` (`:158`), calls `host_perimeter::claim_for_process(port)`
(`:167`), publishes the port into a `OnceLock` (`:168`), then blocks the caller
until the port is known (`:199`).

One shared listener serves all sessions.

### Session registration

- `register_session(agent_id)` → `(port, token, provisional_sid)` (`:211-230`).
  Token and provisional sid are both `Uuid::new_v4()`.
- `bind_session(token, real_session_id)` after `session/new` returns (`:236-254`).
- `begin_turn` / `end_turn` track accepted prompt turns per agent (`:257-286`).
- `unregister_session(real_sid)` (`:292-312`) and
  `unregister_by_token(token)` (`:317-325`).

### Connection handling (`parent.rs:353-398`)

One frame per connection. Read capped by `MAX_REQUEST_FRAME_BYTES` and bounded by
a 10 s timeout (`:357-366`). A `hung_up` future is constructed from the read half
(`:375-378`) so a blocking handler (ask_user) can detect the child going away.

### Auth (`parent.rs:410-430`)

Token lookup, then a defense-in-depth check that the frame's `session_id` equals
the `provisional_sid` the token was minted with. Unknown token and mismatched sid
both return `"auth rejected"` without disclosing which sessions exist.

### Dispatch (`parent.rs:488-639`)

`Describe` is special-cased **before** the bound-session check (`:432-434`) so a
child can fetch a tool schema before `session/new` completes. The `match` then
covers all six variants. The `Describe` arm at `:542` is unreachable in practice.

Routing before dispatch (`:454-486`) handles agents that reuse an older session's
MCP child: prefer the token's bound session when it has an active turn; otherwise
reroute only when exactly one turn is active; multiple active turns →
`"ambiguous active session"`; no active turn → `"no active turn"`.

## 10. End-to-end trace — `plan`

| Hop | Location |
|---|---|
| 1. Agent calls `plan` | rmcp → `TermulPlanServer::plan` `child.rs:267-276` |
| 2. Build frame | `child.rs:268-271` (`FrameKind::Plan`), `frame()` `child.rs:206-213` |
| 3. Send + read | `forward_to_parent` `child.rs:431-445` (10 s cap) → `forward_to_parent_inner` `child.rs:470-499`: connect `127.0.0.1:port` (`:475`), write JSON+`\n` (`:478-483`), read one line capped 64 KiB (`:485-491`) |
| 4. Parent accept | `parent.rs:172-192` → `handle_conn` `:353-398` |
| 5. Auth + route | `process_request` `:402-486` |
| 6. Plan arm | `:560-576`: reject if `title` present (`:561-563`), map todos (`:564`), `plan_store.set` (`:568`), `emit_plan_update` (`:569`) |
| 7. Emit | `host_mcp/mod.rs:484-502` → `events::fan_out(..., EVENT_PLAN_UPDATE, ...)` (`:496-501`) |
| 8. Reply | `FrameReply::ok()` (`:575`) → written `parent.rs:388-396` |
| 9. Child returns | `"plan updated"` (`child.rs:272-275`, `:494-496`) |

Failure at any transport hop is folded into a **successful** tool text
(`format!("plan error: {e}")`, `child.rs:274`) — see §12.

## 11. `ask_user` — the blocking variant (worth studying)

`child.rs:328-357` sends the frame and then:

```rust
let reply = tokio::select! {
    reply = exchange_frame(&self.config, request) => reply,
    () = cancelled.cancelled() => return "ask_user cancelled by the client".to_string(),
};
```

No client-side timeout on purpose: the user decides (`child.rs:337-341`). The
`CancellationToken` lets an rmcp-side cancel tear the question down.

Parent side: `parent.rs:553-559` → `parent/ask.rs`, which parks a oneshot keyed by
a `q-<uuid>` question id, fans out a question event, and resolves on answer,
`hung_up`, or session end.

## 12. Error vs result — three distinct behaviours

This is a trap. They are **not** consistent.

| Mechanism | Is `isError` set? | Where |
|---|---|---|
| `CallToolResult::structured(reply)` | no | `child.rs:171` |
| `CallToolResult::structured_error(reply)` | **yes** | `child.rs:173` |
| `CallToolResult::error(vec![ContentBlock::text(msg)])` | **yes** | `canvas_tools.rs:112` |
| `#[tool]` fn returning `Result<String, String>` | **yes** on `Err` | `child.rs:305, 320`; evidence `child/tests.rs:789` |
| `#[tool]` fn returning `String` | **no** — error is plain text | `child.rs:274, 293, 351-356` |
| `ErrorData` (resources/prompts) | JSON-RPC error, not a tool result | `canvas_tools.rs:134-135, 147, 150` |

Practical consequence: `plan` / `set_session_title` / `ask_user` report failures
as *successful* tool output containing the word `error`. An agent cannot
distinguish them structurally. If Studio tools are added, prefer
`Result<T, String>` or `structured_error` so failures are machine-detectable.

## 13. `presence/` — canvas-only, not needed for Studio

`presence` renders each answered agent canvas call as a guest cursor
(`parent.rs:99-102`). It is driven only from `parent/canvas.rs` and
`end_turn`/`unregister_session` (`parent.rs:280, 308`). `derive_activity` matches
figcraft tool names. **Not relevant** unless Studio tools route through the canvas
router.

## 14. `gateway_harness.rs` — reusable test scaffold

`#[cfg(test)] mod gateway_harness;` (`host_mcp/mod.rs:33-34`), so crate-wide
available in test builds.

`Harness::new` builds a real `HostPlanServer::start(vec![], Some(persistence))`,
registers sessions as `agent-{index}`, binds them and begins turns
(`gateway_harness.rs:24-74`). `mount_renderer` (`:94-124`) wires a fake canvas
renderer through `CanvasRouter`.

Reusable parts for a Studio family: `Harness::new` + real persistence + registered
sessions. **Not** reusable: `mount_renderer` (canvas-specific).

The other useful harness is `with_mcp_session` in `child/tests.rs`, which drives
the child's MCP surface directly.

## 15. Checklist: add a new tool family (derived from the code only)

1. New module, e.g. `host_mcp/studio_tools.rs`, exposing:
   - `tools() -> Vec<Tool>`
   - `call_tool(config: ChildConfig, name: String, args: Value) -> CallToolResult`
   - `instructions() -> String`
2. Register in `TermulPlanServer::new` (`child.rs:131-143`) via a
   `ToolRoute::new_dyn` factory modelled on `canvas_route` (`child.rs:215-226`).
3. Append its instructions in `session_instructions()` (`host_mcp/mod.rs:90-95`).
4. Add a `FrameKind` variant (`host_mcp/mod.rs:142-158`) **and** the matching
   `FrameRequest` field (`:324-353`). The parent `match` is exhaustive, so the
   compiler will force the new arm.
5. Add a parent handler module under `parent/` and an arm in
   `parent.rs:488-639`.
6. If the call must reach the renderer, model it on `Bridge` (`bridge.rs`) —
   blocking sockets — and run it on `spawn_blocking` (`canvas_tools.rs:102`).
7. Update `HOST_TOOLS` in `child/tests.rs:606-613` (the test asserts the exact
   tool list; a new family breaks it).
8. Do **not** add inline `#[cfg(test)] mod tests` to production files — AGENTS.md
   requires a sibling `_tests.rs` or `tests.rs`.

## 16. Sizing note

`child.rs` is 654 lines, `parent.rs` 661, `host_mcp/mod.rs` 505. AGENTS.md's
~800-line ceiling means a Studio family fits as **its own module** (`studio_tools.rs`
+ `parent/studio.rs`), not by growing `child.rs`. Registration is a 3-line
addition there.
