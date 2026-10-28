# 02 — RobloxKit's MCP proxy: does it add anything over `StudioMCP.exe`?

**Scope.** Read-only archaeology of `C:\Users\Novella\Documents\Github\Robloxkit`.
Everything below cites `file:line` with a quoted snippet. Claims I could not
confirm are marked **UNVERIFIED**; reasoning beyond the evidence is marked
**SPECULATION**.

**Bottom line up front.** The **rebuild** (`rust/robloxkit-lite` + `app/src-tauri`)
is a *pure transport wrapper*: it re-exposes StudioMCP's own `tools/list` verbatim
and forwards `tools/call` verbatim. It renames nothing, filters nothing, adds no
tools, and sends no system prompt, no instructions, no place context and no
`placeKey` to the agent. The **original shipped binary** did considerably more
(a 93-tool frontend-owned registry pushed via `mcp_register {tools,instructions}`,
plus a Claude-specific `_meta.systemPrompt.append` and a per-session place-context
block). Almost none of that was rebuilt.

---

## 0. The three-layer picture (what actually exists)

```
                       ORIGINAL (robloxkit-desktop.exe)          REBUILD (this repo)
                       --------------------------------          -------------------
agent CLI  <--ACP/stdio-->  app  <--MCP/stdio--> StudioMCP.exe    same
                              |
                              +-- own MCP server on 127.0.0.1:<port>/mcp
                                  (tiny_http 0.12.0)              (hand-rolled TcpListener)
                                  tool exec: mcp:call -> FRONTEND -> mcp_tool_result
                                                                  tool exec: Rust -> StudioMCP stdio (direct)
                                  registry: 93 frontend tools      registry: StudioMCP's own 28 tools
                                  instructions: rules.md + tools/instructions.md
                                                + place context    instructions: one hardcoded sentence
```

Two independent claims are often conflated and must be kept apart:

1. **Transport**: how the agent reaches the tools. Original and rebuild agree —
   ACP `session/new` → `mcpServers: [{type:"http", name:"robloxkit", url:...}]`.
2. **Capability**: what the tools *are* and what *context* accompanies them.
   Original and rebuild disagree sharply.

---

## 1. `rust/robloxkit-lite/src/mcpserver.rs` — the internal MCP-over-HTTP server

**Verdict: pure pass-through. No rename, no filter, no added tool.**

The module doc states the design intent itself, `mcpserver.rs:10-12`:

```rust
//!   * the agent renders tools as `mcp__robloxkit__<tool>`; v1 is a pass-through
//!     registry: `tools/*` forward to the [`Bridge`] (the app adapts its
//!     StudioMCP stdio bridge), not a recreated 93-tool frontend registry.
```

### 1.1 `initialize` — `mcpserver.rs:335-347`

```rust
        "initialize" => {
            let client_version = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("2025-03-26")
                .to_string();
            Ok(json!({
                "protocolVersion": client_version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": server_name, "version": "0.1.0" },
                "instructions": "RobloxKit-lite internal tools (pass-through to StudioMCP).",
            }))
        }
```

Notes:
* `protocolVersion` is **echoed from the client** (default `"2025-03-26"`), not
  negotiated. StudioMCP's own `initialize` returns a fixed `"2025-11-25"`
  (verified live, §6.1).
* `capabilities.tools.listChanged = false` — a *reduction* vs StudioMCP, which
  advertises `listChanged: true` (verified live).
* `instructions` is **one hardcoded sentence** (58 chars) and is the *only*
  instruction text the rebuild ever emits. Compare §5.
* `serverInfo.name` is the `server_name` argument; `app/src-tauri/src/acp.rs:119-122`
  passes `"robloxkit"`.

### 1.2 `tools/list` — `mcpserver.rs:349-352`

```rust
        "tools/list" => {
            let tools = bridge.list_tools().await;
            Ok(json!({ "tools": tools }))
        }
```

Three lines. No `.map()`, no `.filter()`, no renaming. The array is whatever the
`Bridge` returns, serialized unchanged.

### 1.3 `tools/call` — `mcpserver.rs:353-379`

```rust
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match bridge.call_tool(&name, arguments).await {
                Ok(result) => {
                    if result.is_object() {
                        Ok(result)
                    } else {
                        Ok(json!({
                            "content": [{ "type": "text", "text": result.to_string() }],
                            "isError": false,
                        }))
                    }
                }
                Err(e) => Ok(json!({
                    "content": [{ "type": "text", "text": e }],
                    "isError": true,
                })),
            }
        }
```

Name and arguments pass through untouched. The only shaping is envelope
normalization: a non-object result is wrapped as a text content block, and a
`Bridge` error becomes `isError: true` **inside a successful JSON-RPC result**
(which is MCP-legal). No argument rewriting of any kind.

### 1.4 Everything else is rejected — `mcpserver.rs:380`

```rust
        other => Err((-32601, format!("method not found: {other}"))),
```

So the rebuild serves exactly four methods: `initialize`, `ping` (`:348`),
`tools/list`, `tools/call`. `resources/*`, `prompts/*`, `completion/complete`,
`logging/setLevel`, `subscriptions/listen`, `server/discover` — all of which the
**original** server supported (`re/04-studio-bridge/FINDINGS.md:216-222`) — return
`-32601`. This is a real capability *loss*, not parity.

### 1.5 Transport is deliberately minimal — `mcpserver.rs:14-20`

```rust
//! Transport: minimal Streamable HTTP - `POST /mcp` carries the JSON-RPC 2.0
//! frame, `GET /mcp` answers 405 (spec-legal for stateless servers), and every
//! response sets `Connection: close` so the request reader stays trivial.
```

One request per TCP connection (`write_response` always emits
`Connection: close`, `mcpserver.rs:254-262`), no SSE, no `Mcp-Session-Id`, no
`Origin` check (the original checked `Origin: 127.0.0.1:*`,
`re/04-studio-bridge/FINDINGS.md:212`).

### 1.6 Auth token differs in provenance — `mcpserver.rs:97-112`

```rust
/// Loopback-only bearer token: SplitMix64 over (boot nanos ^ pid salt). Not
/// cryptographic; it only has to be unguessable to processes that cannot read
/// this process's memory.
fn make_token() -> String {
```

Original: 32 bytes from `SystemFunction036`/`RtlGenRandom`, lowercase-hex →
64 chars (`re/05-ai-agent-acp-mcp/FINDINGS.md:460-501`). Rebuild: SplitMix64 ×4 →
also 64 hex chars, but **explicitly not cryptographic**. Same shape, weaker source.

### 1.7 The descriptor shape diverges from the RE — `mcpserver.rs:114-126`

```rust
/// `session/new` `mcpServers` entry. ACP wire shape (agentclientprotocol.com
/// protocol/v1/session-setup, "HTTP Transport"): `type` / `name` / `url` +
/// `headers` as **`HttpHeader[]`** (array of `{name, value}`). The object-map
/// headers seen at `sub_1405FFA10` is the binary's internal pre-serialization
/// form - the live adapter rejects the object map with -32602 (2026-10-20).
pub fn descriptor(port: u16, token: &str, name: &str) -> Value {
    json!({
        "type": "http",
        "name": name,
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "headers": [ { "name": "Authorization", "value": format!("Bearer {token}") } ],
    })
}
```

The original's `sub_1405FFA10` emits an **object map**
(`{"Authorization":"Bearer <token>"}`, `re/05-ai-agent-acp-mcp/FINDINGS.md:303`);
the rebuild emits an **array**. The comment claims the array is what the live
adapter accepts. **UNVERIFIED** here — I did not re-run the adapter to confirm
which form it rejects. `AGENTS.md:47-48` still documents the object-map form,
so the repo's own docs and its code disagree.

### 1.8 What is *not* in this file

* No `mcp_register` equivalent (see §7).
* No `mcp_tool_result` / `mcp:call` relay (the original routed execution through
  the frontend; see §7).
* No `place` / `placeKey` argument injection (the original injected a `place`
  property into 14 tool schemas, `re/05-ai-agent-acp-mcp/FINDINGS.md:432-437`).
* No tool-name remapping. The original's Studio group used *different* names from
  StudioMCP (`read_script` vs `script_read`, `studio_state` vs `get_studio_state`,
  `capture_viewport` vs `screen_capture`, ... — `re/04-studio-bridge/FINDINGS.md:242-249`,
  `.omo/roblox-re/00-runtime-evidence.md` E10). The rebuild exposes StudioMCP's
  names unchanged.

**Contrast — the Node scaffold *does* add tools.** `scaffold/bridge/src/index.mjs:106-128`
defines two `META_TOOLS` and splices them in at `:171-180`:

```js
      case "tools/list": {
        await ensureChildInit();
        let tools = [];
        const r = await childRequest("tools/list", {}, 1500); // short: child is silent w/o Studio
        if (r && r.result && Array.isArray(r.result.tools)) tools = r.result.tools;
        const names = new Set(tools.map((t) => t.name));
        for (const mt of META_TOOLS) if (!names.has(mt.name)) tools.push(mt);
        toAgent({ jsonrpc: "2.0", id, result: { tools } });
```

That is the *scaffold*, not the shipped Rust server. Anyone reading the scaffold
would wrongly conclude the proxy augments the tool list.

---

## 2. `rust/robloxkit-lite/src/acp.rs` — `connect_with_mcp` / `NewSessionParams`

**Verdict: `session/new` carries exactly two keys — `cwd` and `mcpServers`.
`instructions` is NOT sent. Neither is `placeKey`, `threadId`, `mode`,
`config`, `resumeSessionId`, or `_meta`.**

### 2.1 The params struct — `rust/robloxkit-lite/src/models.rs:163-173`

```rust
/// `session/new` params (ACP wire). The adapter
/// (`@agentclientprotocol/claude-agent-acp`) validates these and REQUIRES both:
/// `cwd` = absolute existing directory; `mcpServers` = array (may be empty).
/// `{}` → error -32602 (2026-10-12). The `mode`/`config`/`resumeSessionId`
/// strings at blob `0x14132d308` belong to Tauri `acp_new_session`, not ACP.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionParams {
    pub cwd: String,
    pub mcp_servers: Vec<Value>,
}
```

Two fields. `#[serde(rename_all = "camelCase")]` turns `mcp_servers` into
`mcpServers`. There is no `#[serde(skip_serializing_if)]`, no flatten, no extra
map — so the serialized object is provably `{"cwd":..., "mcpServers":[...]}` and
nothing else. This is asserted by a test,
`rust/robloxkit-lite/tests/mcp_server.rs:224-241`:

```rust
#[test]
fn session_new_params_carry_the_descriptor() {
    let desc = mcpserver::descriptor(43110, "t0k", "robloxkit");
    let params = NewSessionParams {
        cwd: "C:/tmp/ws".to_string(),
        mcp_servers: vec![desc],
    };
    let v = serde_json::to_value(&params).expect("serialize");
    assert_eq!(v["cwd"], "C:/tmp/ws");
    assert_eq!(v["mcpServers"][0]["type"], "http");
```

### 2.2 The request build — `rust/robloxkit-lite/src/acp.rs:308-369`

```rust
    pub async fn connect_with_mcp(
        &self,
        cwd: Option<&Path>,
        mcp_servers: Vec<Value>,
    ) -> Result<String, AcpError> {
        let init = serde_json::to_value(InitializeParams::default()).expect("init params");
        let init_res = self.request("initialize", init).await?;
        self.notify("notifications/initialized", serde_json::json!({}))
            .await?;

        if !mcp_servers.is_empty() {
            // ACP v1 session-setup: HTTP MCP transport requires the agent to
            // advertise agentCapabilities.mcpCapabilities.http - else errors
            // are implicit (adapter validation) or the agent ignores tools.
            let http_ok = init_res
                .get("agentCapabilities")
                .and_then(|c| c.get("mcpCapabilities"))
                .and_then(|c| c.get("http"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !http_ok {
                return Err(AcpError::Rpc(format!(
                    "agent does not advertise mcpCapabilities.http; cannot hand over {} MCP server(s) over ACP",
                    mcp_servers.len()
                )));
            }
        }

        let dir = match cwd {
            Some(p) => {
                if !p.is_absolute() || !p.is_dir() {
                    return Err(AcpError::Rpc(format!(
                        "session/new cwd must be an absolute existing directory: {}",
                        p.display()
                    )));
                }
                p.to_path_buf()
            }
            None => default_workspace(),
        };
        let params = NewSessionParams {
            cwd: dir.to_string_lossy().into_owned(),
            mcp_servers,
        };
        let res = self
            .request(
                "session/new",
                serde_json::to_value(params).expect("session/new params"),
            )
            .await?;
```

Sequence: `initialize` → `notifications/initialized` → capability gate →
`session/new`. No `session/load`, no `session/set_mode`, no
`session/set_config_option` — all three of which the original performed
(`re/03-tauri-commands/FINDINGS-DEEP-3.md:73-79`).

### 2.3 What `initialize` sends — `models.rs:128-142`

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client_capabilities: Value,
}

impl Default for InitializeParams {
    fn default() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            client_capabilities: serde_json::json!({"fs": {"readTextFile": true, "writeTextFile": true}, "terminal": true}),
        }
    }
}
```

`PROTOCOL_VERSION = 1` (`models.rs:10`). This matches the RE'd
`initialize` (`re/05-ai-agent-acp-mcp/FINDINGS-DEEP.md:61`).

**Known gap, self-documented:** `GAPS.md:282-293` — `fs/*` and `terminal/*` are
advertised but never implemented; any such request gets `-32601`
(`acp.rs:516-530`). That is a false capability claim in the handshake.

### 2.4 `session/prompt` — `acp.rs:377-406`

```rust
        let params = PromptParams {
            session_id: sid.clone(),
            prompt: vec![TextContent {
                r#type: "text",
                text: text.to_string(),
            }],
        };
```

A single `{type:"text", text}` block. No `resource` block, no context preamble.
Contrast the original frontend, which prepends a context block (§5.3).

---

## 3. `app/src-tauri/src/studio.rs` — `StudioToolBridge` / `ensure_bridge`

**Verdict: bridges to `StudioMCP.exe` over stdio MCP. Neither filters nor
augments the tool list. One latent special case exists that is unreachable.**

### 3.1 The adapter — `app/src-tauri/src/studio.rs:376-390`

```rust
/// [`robloxkit_lite::mcpserver::Bridge`] adapter: serves the live
/// `StudioBridge` to the internal MCP HTTP server (Option C wiring - the
/// agent reaches Studio tools as `mcp__robloxkit__<tool>` over HTTP).
#[derive(Clone)]
pub struct StudioToolBridge(pub Arc<StudioBridge>);

impl robloxkit_lite::mcpserver::Bridge for StudioToolBridge {
    async fn list_tools(&self) -> Vec<Value> {
        self.0.list_tools().await
    }

    async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, String> {
        self.0.studio_call(name, arguments).await
    }
}
```

Two delegation methods. Nothing else. So `StudioToolBridge` *is* the whole
"augmentation layer" — and it augments nothing.

### 3.2 `list_tools` returns the child's array verbatim — `studio.rs:200-219`

```rust
    /// `tools/list` from the child (best-effort; the child is silent with no
    /// Studio attached, so this uses a short timeout like the Node bridge).
    pub async fn list_tools(&self) -> Vec<Value> {
        if self.ensure_init().await.is_err() {
            return vec![];
        }
        match self
            .request("tools/list", json!({}), Duration::from_millis(5000))
            .await
        {
            // `v` is the whole JSON-RPC envelope; the array lives at result.tools.
            Ok(v) => v
                .get("result")
                .and_then(|r| r.get("tools"))
                .and_then(|t| t.as_array())
                .cloned()
                .unwrap_or_default(),
            Err(_) => vec![],
        }
    }
```

Extract `result.tools`, clone, return. No transform. Note the **5 s timeout** —
the comment says the child is silent with no Studio attached. Verified live that
this machine's StudioMCP answers `tools/list` without a Studio round-trip, so
5 s is comfortable here, but it is a hard cap on a cold child.

### 3.3 `ensure_bridge` — `studio.rs:352-366`

```rust
/// Spawn the bridge if needed and return it.
pub async fn ensure_bridge(state: &AppState) -> Result<Arc<StudioBridge>, String> {
    let mut guard = state.studio.lock().await;
    if let Some(existing) = guard.as_ref() {
        if existing.is_running() {
            return Ok(existing.clone());
        }
    }
    let exe = find_studio_mcp().ok_or_else(|| {
        "StudioMCP.exe not found. Set STUDIO_MCP_EXE or install Roblox Studio.".to_string()
    })?;
    let bridge = StudioBridge::spawn(exe).await?;
    *guard = Some(bridge.clone());
    Ok(bridge)
}
```

Lazy singleton under `state.studio`. Discovery: `STUDIO_MCP_EXE` override, else
scan `%LOCALAPPDATA%\Roblox\Versions\*\StudioMCP.exe` (`studio.rs:46-74`).

### 3.4 The `studio_call` meta-tool special case — `studio.rs:228-256`

```rust
    /// `tools/call`. Special-cases the `studio_call` meta-tool: resolves a
    /// single connected studio and injects `studio_id` (Node bridge parity).
    pub async fn studio_call(&self, name: &str, arguments: Value) -> Result<Value, String> {
        self.ensure_init().await?;
        if name == "studio_call" {
            let target = arguments
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or("studio_call requires arguments.name")?
                .to_string();
            let mut target_args = arguments
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if target_args.get("studio_id").is_none() {
                if let Ok(studios) = self.connected_studios().await {
                    if studios.len() == 1 {
                        if let Some(sid) =
                            studios[0].get("id").or_else(|| studios[0].get("studio_id"))
                        {
                            target_args["studio_id"] = sid.clone();
                        }
                    }
                }
            }
            return self.forward_tool_call(&target, target_args).await;
        }
        self.forward_tool_call(name, arguments).await
    }
```

This is the **only** place the rebuild rewrites arguments: `studio_call` is
unwrapped into a nested target call, and `studio_id` is injected when exactly one
Studio is connected.

**Two observations, both material:**

1. **`studio_call` is never advertised.** StudioMCP's live `tools/list` on this
   machine returns 28 tools and `studio_call` is *not* among them (§6.1). The
   rebuild adds no tools (§3.2). So through the MCP path the agent can never
   invoke `studio_call`, and this branch is unreachable from the agent.
   **SPECULATION (well-supported):** it is dead code for the MCP leg; it survives
   for parity with the Node scaffold, where `META_TOOLS` *does* advertise it
   (`scaffold/bridge/src/index.mjs:113-127`).
2. **`studio_id` injection is redundant anyway.** Verified live: StudioMCP's
   `get_studio_state` and `script_search` both succeed with **no `studio_id`**
   argument (§6.2). StudioMCP resolves the single attached Studio itself. So the
   `connected_studios()` round-trip (`studio.rs:271-289`) buys nothing on a
   single-Studio machine.

### 3.5 Child notifications are dropped — `studio.rs:330-332`

```rust
        // Notifications from the child are dropped (parity: bridge forwards
        // tools/list_changed, which we surface through list_tools()).
```

Combined with `listChanged: false` in `mcpserver.rs:343`, the rebuild never tells
the agent the tool list changed. The Node scaffold *does* forward them
(`scaffold/bridge/src/index.mjs:81-82`). Another reduction vs both the original
and the scaffold.

---

## 4. `app/src-tauri/src/acp.rs` — `start()`: the full launch sequence

`start()` is `app/src-tauri/src/acp.rs:95-162`. Here is the whole function with the
sequence annotated.

### 4.1 Resolve the agent and pick the cwd — `:100-112`

```rust
    let agent = Agent::from_id(agent_id).ok_or_else(|| format!("unknown agent: {agent_id}"))?;

    // Stop any previous agent before replacing it.
    stop(state).await;

    // Effective cwd: the frontend's choice if given, else the default workspace
    // root (`%USERPROFILE%\Documents\RobloxKit`). It is used BOTH as the child's
    // working directory and as the required `session/new` `cwd`.
    let effective = match cwd {
        Some(dir) => PathBuf::from(dir),
        None => robloxkit_lite::acp::default_workspace(),
    };
    let cwd_path = Some(effective.as_path());
```

`default_workspace()` = `%USERPROFILE%\Documents\RobloxKit`, created if missing
(`rust/robloxkit-lite/src/acp.rs:123-135`). **No file is written into it** — no
`CLAUDE.md`, no `AGENTS.md`, no `.mcp.json`, no managed `<!-- robloxkit:begin -->`
block. Verified: `grep` for `CLAUDE.md`, `managed block`, `robloxkit:begin`,
`fs::write` across `app/src-tauri/src` + `rust/robloxkit-lite/src` → **0 hits**;
the only filesystem call is `create_dir_all` at `acp.rs:131`.

### 4.2 Spawn the Studio bridge and the internal MCP server — `:114-132`

```rust
    // Internal MCP server -> the agent gets Studio tools. Studio missing is
    // NOT fatal: tools/list just comes back empty and calls error clearly.
    let bridge = crate::studio::ensure_bridge(state).await.ok();
    let mcp_server = match bridge {
        Some(b) => {
            let server = robloxkit_lite::mcpserver::spawn(
                studio::StudioToolBridge(b),
                "robloxkit",
            )
            .await
            .map_err(|e| format!("internal mcp server failed to start: {e}"))?;
            Some(server)
        }
        None => None,
    };
    let mcp_servers = mcp_server
        .as_ref()
        .map(|s| vec![s.descriptor("robloxkit")])
        .unwrap_or_default();
```

Order: `StudioMCP.exe` child first, then the HTTP server wrapping it. If
StudioMCP is absent, `mcp_servers` is empty and `session/new` gets `[]` — the
agent still connects, with zero Roblox tools.

### 4.3 Resolve the adapter CLI — `:134`

```rust
    let launch = agents::resolve_adapter(agent, cwd_path);
```

`rust/robloxkit-lite/src/agents.rs:89-126`. Preference order:
1. `<cwd>/node_modules/.bin/<bin>.cmd` if present;
2. Kiro → `kiro-cli --agent`;
3. otherwise `cmd /C npx -y <package>@latest` on Windows (bare `npx` elsewhere).

Concrete Windows command for Claude:
`cmd /C npx -y @agentclientprotocol/claude-agent-acp@latest` — asserted in
`rust/robloxkit-lite/tests/acp_roundtrip.rs:20-33`. Note `@latest`, not the
`0.85.1` the original pinned (`re/05-ai-agent-acp-mcp/FINDINGS-DEEP.md:116`) —
an unpinned version can silently break the `mcpServers` contract.

### 4.4 Emit a notice, spawn, connect — `:138-161`

```rust
    emitter_notice(
        &state.handle,
        json!({
            "agent": agent.id(),
            "command": launch.command,
            "args": launch.args,
            "cwd": effective,
            "mcp": mcp_servers.first().cloned().unwrap_or(json!(null)),
        }),
    );

    client
        .spawn(launch, cwd_path)
        .await
        .map_err(|e| format!("spawn failed: {e}"))?;

    let session_id = client
        .connect_with_mcp(cwd_path, mcp_servers)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;

    *state.mcp.lock().await = mcp_server;
    *state.acp.lock().await = Some(client);
    Ok(session_id)
```

### 4.5 What the agent receives, in wire order

| # | Message | Payload | Source |
|---|---|---|---|
| 1 | `initialize` (req) | `{protocolVersion:1, clientCapabilities:{fs:{readTextFile,writeTextFile},terminal:true}}` | `models.rs:135-142` |
| 2 | `notifications/initialized` | `{}` | `acp.rs:315` |
| 3 | `session/new` (req) | `{"cwd":"<abs>","mcpServers":[{"type":"http","name":"robloxkit","url":"http://127.0.0.1:<port>/mcp","headers":[{"name":"Authorization","value":"Bearer <tok>"}]}]}` | `acp.rs:348-357` |
| 4 | *(agent connects to that URL)* | `initialize` → gets `instructions: "RobloxKit-lite internal tools (pass-through to StudioMCP)."` | `mcpserver.rs:345` |
| 5 | *(agent)* `tools/list` | StudioMCP's 28 tools, unmodified | `mcpserver.rs:349-351` |
| 6 | `session/prompt` (req) | `{"sessionId":"…","prompt":[{"type":"text","text":"<user text>"}]}` | `acp.rs:384-396` |

**That is the entire context the agent ever gets about Roblox.** One 58-character
sentence, a cwd path, and a tool list. No place name, no `studio_id`, no
`placeKey`, no rules file, no skills list, no system prompt.

### 4.6 `stop()` — `:226-235`

```rust
pub async fn stop(state: &AppState) {
    let mut guard = state.acp.lock().await;
    if let Some(client) = guard.take() {
        client.stop().await;
    }
    drop(guard);
    if let Some(server) = state.mcp.lock().await.take() {
        server.stop().await;
    }
}
```

Agent first, then the MCP server. The `StudioBridge` in `state.studio` is **not**
stopped here — it lives for the process lifetime.

### 4.7 The frontend surface is tiny — `app/dist/index.html`

The whole Tauri surface is 9 commands (`app/src-tauri/src/lib.rs:60-70`). The
bundled UI calls exactly five of them:

| Line | Call |
|---|---|
| `index.html:527` | `invoke("agent_list")` |
| `index.html:543` | `invoke("studio_status")` |
| `index.html:569` | `invoke("acp_start", { agent: picker.value })` |
| `index.html:587` | `invoke("acp_prompt", { text })` |
| `index.html:459,485` | `acp_permission_respond` |
| `index.html:562,603` | `acp_cancel` |

Note `acp_start` is called with **`{agent}` only** — no `cwd`, no place, no
thread. `studio_call` is never invoked by the UI. So the shipped rebuild's agent
gets zero Roblox context even from the UI layer.

---

## 5. Does RobloxKit send any system prompt / instructions / placeKey?

### 5.1 The rebuild: **NO.** Categorically.

**What I searched.** These paths, for these tokens:

```
rust/robloxkit-lite/src/*.rs
rust/robloxkit-lite/tests/*.rs
app/src-tauri/src/*.rs
app/dist/index.html
scaffold/bridge/src/*.mjs
```

**Result (exhaustive, all matches):**

| Token | Hits | Where |
|---|---|---|
| `placeKey` | **0** | — |
| `place_key` | **0** | — |
| `systemPrompt` | **0** | — |
| `system_prompt` | **0** | — |
| `_meta` | **0** | — |
| `mcp_register` | **0** | — |
| `93` | 1 | a comment saying it is *not* recreated: `mcpserver.rs:12` |
| `instructions` | 5 | 1 real (`mcpserver.rs:345`, the 58-char sentence); 1 scaffold (`index.mjs:157`); 3 false positives in `workspace.mjs` about *protected filenames* |

The only occurrence that reaches an agent is `mcpserver.rs:345`:

```rust
                "instructions": "RobloxKit-lite internal tools (pass-through to StudioMCP).",
```

**Negative evidence, sharper.** `NewSessionParams` (`models.rs:168-173`) has two
fields and no flatten/extra map, so `session/new` provably cannot carry anything
beyond `cwd` and `mcpServers` — asserted by `tests/mcp_server.rs:224-241`.
`InitializeParams` (`models.rs:128-142`) has two fields. `PromptParams`
(`models.rs:150-155`) has two fields. There is no fourth struct and no
`serde_json::json!({...})` literal anywhere in the ACP write path that adds a
context key. `acp.rs:57-109` builds every frame from a typed struct.

The two behavioural clinchers:

* `app/dist/index.html:569` — `invoke("acp_start", { agent: picker.value })`. The
  UI cannot supply a place, because the command signature has no such parameter
  (`commands.rs:24-30` takes only `agent`, `cwd`).
* `app/dist/index.html:295-303` — the UI *strips* the `mcp__robloxkit__` prefix
  for display:
  ```js
      // Tool name normalizer (RE function `w`): strip MCP prefixes so the UI
      // shows the bare tool name.
      function toolName(name) {
        if (!name) return "tool";
        return name
          .replace(/^mcp__robloxkit__/, "")
  ```
  So the agent-side namespacing is real, but the rebuild only *reacts* to it; it
  never contributes a Roblox-aware prompt.

### 5.2 The original: **YES** - three distinct channels, one only partly traced

**(a) A `_meta` / `systemPrompt` / `append` key chain, an `includeMcpJson` +
`mcpServers` CLI-config block, and a fixed 57-char prompt literal.**

Two different functions are involved. Both were decoded byte-wise from
string-building immediates - the same runtime-built-key trick that made
`mcpServers` a false negative (`GAPS.md:169-172`).

**`sub_1402DB9A0`** - `.pdata` range `[0x1402db9a0, 0x1402dc22c)` - assembles the
Claude-specific *key* chain. Each row is a `mov rcx, imm64` (+ a 2-4 byte
`mov [rax+n], imm32`) that spells a key 8 bytes at a time:

| Key | Instruction VA | Bytes -> text |
|---|---|---|
| `claudeCode` | `0x1402dba52` | `48 b9 63 6c 61 75 64 65 43 6f` + `66 c7 40 08 64 65` -> `claudeCo`+`de` (len `0x0a`) |
| `options` | `0x1402dbaad` | `c7 00 6f 70 74 69` -> `opti` (len `0x07`) |
| `cpConfig` | `0x1402dbaf4` | `48 b9 63 70 43 6f 6e 66 69 67` |
| `strictMcpConfig` | `0x1402dbb02` | `48 b9 73 74 72 69 63 74 4d 63` (len `0x0f`) |
| `gSources` | `0x1402dbb7e` | `48 b9 67 53 6f 75 72 63 65 73` |
| `settingSources` | `0x1402dbb8c` | `48 b9 73 65 74 74 69 6e 67 53` (len `0x0e`) |
| `user` | `0x1402dbbf3` | `c7 00 75 73 65 72` (the `settingSources` element) |
| `thinking` | `0x1402dbc84` | `48 b9 74 68 69 6e 6b 69 6e 67` (len `0x08`) |
| `type` | `0x1402dbcd2` | `c7 00 74 79 70 65` |
| `adaptive` | `0x1402dbd19` | `48 b9 61 64 61 70 74 69 76 65` (len `0x08`) |
| `dispH`(+`lay`) | `0x1402dbd93`/`0x1402dbd9a` | `c7 00 64 69 73 70` + `c7 40 03 6c 61 79` -> `display` |
| `summariz`(+`ed`) | `0x1402dbde1` | `48 b9 73 75 6d 6d 61 72 69 7a` + `66 c7 40 08 65 64` (len `0x0a`) |
| `appe`(+`nd`) | `0x1402dbfe8` | `c7 00 61 70 70 65` + `66 c7 40 04 6e 64` -> `append` (len `0x06`) |
| `_meta` | `0x1402dbf4f`, `0x1402dc0d4` | `48 8d 0d 12 ac fd 00` -> `0x1412b6b68` = `"_metarobloxkit..."` |
| `systemPrompt` | `0x1402dc0f1` | `48 8d 0d c1 ab fd 00` -> `0x1412b6cb9` |

Both `_meta` and `systemPrompt` are `lea` instructions **inside `sub_1402DB9A0`**
(confirmed by `.pdata`: `0x1402dbf4f` and `0x1402dc0f1` both fall in
`[0x1402db9a0, 0x1402dc22c)`). This **independently corroborates** the RE claim at
`re/05-ai-agent-acp-mcp/FINDINGS.md:305`:

> `claude` branch adds `"claudeCode"`, `"options"`, `"strictMcpConfig"`, `"settingSources":["user"]`,
> `"thinking":{"type":"adaptive","display":"summarized"}`; plus `"_meta":{"systemPrompt":{"append":<prompt>}}`

**`sub_1402D91E0`** - `.pdata` range `[0x1402d91e0, 0x1402d9df4)` - builds a
*different* block, and is where the prompt **text** is materialized:

| Key / value | Instruction VA | Bytes -> text |
|---|---|---|
| `robloxkit` | `0x1402d92f7` | `48 b9 72 6f 62 6c 6f 78 6b 69` + `c6 40 08 74` -> len `0x09` |
| `description` | `0x1402d9363` | `48 b9 64 65 73 63 72 69 70 74` + `c7 40 08 69 6f 6e` (len `0x0b`) |
| `AGENTS.md` | `0x1402d9483` | `48 b9 47 45 4e 54 53 2e 6d 64` (len `0x16`) |
| `tool` | `0x1402d94f0` | `c7 00 74 6f 6f 6c` (len `0x05`) |
| `includeMcpJson` | `0x1402d95c3`, `0x1402d95d1` | `48 b9 69 6e 63 6c 75 64 65 4d` at `[rax]` + `48 b9 65 4d 63 70 4a 73 6f 6e` at `[rax+6]` -> `includeM`+`eMcpJson`, len `0x0e` |
| `mcpServers` | `0x1402d963b` | `48 b9 6d 63 70 53 65 72 76 65` + `66 c7 40 08 72 73` -> `mcpServe`+`rs`, len `0x0a` |
| **prompt text** | `0x1402d93af`-`0x1402d93d0` | 4x `movups` of a split constant |

The prompt text constant is 57 bytes at VA `0x1412b6bc8`:

```
RobloxKit: builds in Roblox Studio with RobloxKit's tools
```

loaded by four overlapping 16-byte reads whose displacements land on
`0x1412b6bc8` / `0x1412b6bd8` / `0x1412b6be8` / `0x1412b6bf1`, with
`c6 45 38 03` + `48 c7 45 40 39 00 00 00` setting the discriminant to `3`
(a `&str` pair) and the length to `0x39` = 57.

**Honest boundary.** What I proved: `sub_1402DB9A0` assembles the key chain
`claudeCode` / `options` / `strictMcpConfig` / `settingSources:["user"]` /
`thinking:{type:"adaptive",display:"summarized"}` / `_meta` / `systemPrompt` /
`append`; `sub_1402D91E0` assembles `includeMcpJson` + `mcpServers` and loads the
57-char prompt. What I did **not** prove: that the 57-char literal is the *value*
of `_meta.systemPrompt.append`. There is **no `lea` to `0x1412b6bc8` from inside
`sub_1402DB9A0`** (I scanned every RIP-relative displacement in the whole `.text`
for that target and found exactly one reference, at `0x1402d93d0`, in
`sub_1402D91E0`). Linking the two functions into one JSON object is the RE's
§7c/§7d chain, **not** something I traced as a single data flow. Treat
"`append` receives this exact 57-char string" as **UNVERIFIED**; treat "a fixed
57-char Roblox system prompt is compiled into the binary and materialized into a
per-agent config object" as **verified**.

**So, at minimum: the original has a Roblox-aware system-prompt channel for
Claude, and the string it would carry is compiled into the binary. The rebuild
has neither the channel nor the string.**

> Naming caution: this 57-byte *system prompt literal* is a different object from
> the 58-character `instructions` string the **rebuild** emits at
> `mcpserver.rs:345`. Two different strings; do not conflate them.

**(b) A 93-tool registry with instructions, pushed via `mcp_register`.**
`re/05-ai-agent-acp-mcp/FINDINGS.md:382-384`:

> RobloxKit registers its tool list with the agent via `mcp_register` (payload `{tools, instructions}`;
> `sub_140963890`), clears it with `mcp_register {tools:[],instructions:""}`, and answers calls
> by emitting `mcp:call` → frontend runs the tool → `mcp_tool_result` (`{callId, result}`; `sub_1409831E0`).

Corroborated by the decompilation, `artifacts/decomp/handlers/mcp_register.c:132-142`:

```c
            *(_QWORD *)Dst = aMcpRegister;
            *(_QWORD *)&Dst[8] = 12;
            *(_QWORD *)&Dst[16] = aInstructions_2;
            *(_QWORD *)&Dst[24] = 12;
```

i.e. the payload is deserialized with keys `host` (len 4), `tools` (len 5) and
`instructions` (len 12). The frontend side is
`pO()` / `registerCatalogue` (`re/05-ai-agent-acp-mcp/FINDINGS.md:398`):

```js
pO() / registerCatalogue | await ot('studio_tools'), fp(), ra(), then mcp_register {tools:dO(), instructions:ia()}
```

and `ia()` is `agentInstructions-DRb-9XyH.js`'s `c()`:

```js
function c() {
  return e(t(`tools/catalog`, `tools/instructions.md`), {
    skills: r()
  });
}
```

(`artifacts/frontend_unmin/agentInstructions-DRb-9XyH.js:11-15`.) So the
instruction text is `tools/instructions.md` with the installed-skills list
interpolated. That is a *large, Roblox-aware* prompt. The rebuild has no
equivalent — it has 58 characters.

**(c) A per-session place-context block prepended to the first prompt.**
`artifacts/frontend_unmin/agentInstructions-DRb-9XyH.js:16-24`:

```js
function l({
  studios: e = [],
  studioId: t,
  status: n
}) {
  let r = e.find(e => e.id === t);
  return [`RobloxKit session context`, `- Open place: ${r ? `${r.name} (studio_id ${r.id})` : `none selected`}`, `- Studio connection: ${n ?? `unknown`}`, `- Other Studio windows: ${e.filter(e => e.id !== t).map(e => e.name).join(`, `) || `none`}`, `- Skills to read first: roblox-performance; then the one for the task (${i().join(`, `)})`, "- Studio and workspace tools are on the `robloxkit` MCP server."].join(`
`);
}
```

Wired in at `artifacts/frontend_unmin/acp-C1bBXu3Z.js:967-980`:

```js
    let n = b ? [l(o), _.summary].filter(Boolean).join(`

`) : null;
    return Q({
      result: await t(`acp_prompt`, {
        agent: e,
        sessionId: v,
        prompt: Z({
          text: i,
          images: a,
          context: n,
          caps: y
        })
```

and `Z()` (`acp-C1bBXu3Z.js:773-798`) turns `context` into either an embedded
`resource` block or a plain text block **prepended before the user text**:

```js
  if (n) {
    i.push(r.promptCapabilities?.embeddedContext ? {
      type: `resource`,
      resource: {
        uri: `robloxkit://studio/context`,
        mimeType: `text/markdown`,
        text: n
      }
    } : {
      type: `text`,
      text: n
    });
  }
  if (e) {
    i.push({
      type: `text`,
      text: e
    });
```

So the original's first `session/prompt` of every session carried
`robloxkit://studio/context` — place name, `studio_id`, connection status, other
Studio windows, and the skills to read. **The rebuild's `PromptParams` has no
`context` field and no `resource` support** (`models.rs:150-155`,
`acp.rs:384-390`).

### 5.3 `placeKey` — where it lives, and why it does not reach the agent

`placeKey` **does** exist in the original, but only on the **Tauri command**
surface, never on the ACP wire:

* `re/03-tauri-commands/FINDINGS-DEEP-3.md:58-68` — `struct AcpNewSession { agent, mode, config, resumeSessionId, placeKey, threadId, instructions, allowUnrestricted, consent }`.
* `artifacts/decomp/handlers/acp_new_session.c:493` — `*(_QWORD *)&v287[16] = aPlacekey;` (deserialized from the Tauri payload).
* `artifacts/frontend_unmin/acp-C1bBXu3Z.js:690-698` — the frontend sends it:
  ```js
      let s = {
        agent: e,
        instructions: d(),
        mode: a.mode || null,
        config: H(e, a.config),
        allowUnrestricted: !!a.allowUnrestricted,
        placeKey: f,
        threadId: p
      };
  ```
* It is a **session-lookup key**, not prompt content: `acp-C1bBXu3Z.js:478-482` uses it in `acp_session_lookup { agent, placeKey, threadId }`, and `place-BGH23Giu.js:16` defines the Workspace attribute `RobloxKitPlaceKey`.

**So: `placeKey` is never sent to the agent by the original either** — it keys
RobloxKit's own thread store. The rebuild simply omits the whole thread/session
lookup layer, so `placeKey` disappears entirely (0 hits, §5.1). No capability is
lost *at the agent*, but session resumption by place is lost *at the app*.

**UNVERIFIED:** whether the original's `instructions` field (sent from the
frontend at `acp-C1bBXu3Z.js:692` as `d()` = `agentInstructions` `o()` =
`acp/rules.md`) ends up on the ACP wire. `acp_new_session.c:383` reads it
(`aInstructions_2`) but the 1888-line decompilation does not make it obvious
which struct slot it lands in. The `_meta.systemPrompt.append` at
`0x1402dbf4f`/`0x1402dc0f1` is the *only* place I can prove a prompt reaches the
agent, and its payload is the 57-char literal — not `rules.md`. **Do not claim
`rules.md` reaches the agent without a live capture.**

---

## 6. Tool counts: StudioMCP vs RobloxKit

### 6.1 StudioMCP.exe, measured live on this machine

`%LOCALAPPDATA%\Roblox\Versions\version-7aaa6838d36c4448\StudioMCP.exe`
(8,224,208 bytes). Spawned it directly and spoke MCP over stdio. Verbatim
`initialize` reply:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"RobloxStudio","version":"1.0.0"},"instructions":"Studio MCP Proxy - bridges MCP clients with Roblox Studio"}}
```

`tools/list` -> **28 tools**:

```
upload_image, search_game_tree, script_search, skill, multi_edit, start_stop_play,
get_console_output, user_mouse_input, store_image, http_get, character_navigation,
script_read, get_studio_state, screen_capture, script_grep, wait_job_finished,
generate_procedural_model, generate_texture, segment_mesh, user_keyboard_input,
generate_mesh, subagent, execute_luau, generate_material, inspect_instance,
search_asset, insert_asset, list_roblox_studios
```

`prompts/list` -> `{"prompts":[]}`. `resources/list` -> `{"resources":[]}`.

This **exactly confirms** `.omo/roblox-re/00-runtime-evidence.md` E2 (28 tools,
identical list, same 8,224,208-byte exe) and **contradicts** the older
`re/04-studio-bridge/FINDINGS.md:300-306` claim of "30 tools". The delta is
exactly two names: that note's list also had `capture_plugin_gui` and
`list_plugin_guis`, which this build does **not** expose. Same `serverInfo`
(`RobloxStudio` v`1.0.0`), but `re/04-studio-bridge/FINDINGS.md:12` recorded the
build hash `1.0.0 (9276c15)` — so the 30-tool list is from an older StudioMCP.

Practical consequence: **the StudioMCP tool count is not a stable number.** Any
design that hard-codes "28" (or "30", or "93") will drift. The rebuild gets this
right by construction — it never enumerates (`mcpserver.rs:349-351`).

### 6.2 StudioMCP does NOT require `studio_id` (correction to the docs)

`re/04-studio-bridge/FINDINGS.md:260` says "Every tool needs `studio_id`; call
`list_roblox_studios` first." That is **not true for this build**. Verified live
with no `studio_id` in the arguments:

```
tools/call get_studio_state {} ->
  {"content":[{"type":"text","text":"- Current Studio Mode: Edit\n- Available DataModels: Edit\n- Focused DataModel in the viewport: Edit"}],"isError":false}

tools/call script_search {"keywords":"x"} ->
  {"content":[{"type":"text","text":"No matches found for the given query."}],"isError":false}
```

Both succeeded. StudioMCP resolves the single attached Studio itself. This makes
the rebuild's `studio_id` injection (§3.4) redundant, and it means a plain
`StudioMCP.exe` stdio MCP server is directly usable by any MCP client with **zero
adapter code**.

### 6.3 Count comparison

| Surface | Count | Source |
|---|---|---|
| StudioMCP `tools/list` (live) | **28** | measured above |
| Rebuild's `robloxkit` server | **28** (identical) | `mcpserver.rs:349-351` passes through |
| Original's `robloxkit` server (advertised) | **93** | `artifacts/mcp-tools-robloxkit.md` (93 `### \`name\`` headings, 93 unique) |
| Original's registry array `up` | 94 unique names | `GAPS.md:247-269`, `re/08-frontend-ui/FINDINGS-SOURCE-RECOVERY.md:126-136` |
| Original's `Rf` feature-gate map | 86 entries | `artifacts/frontend_unmin/_TOOLFEATURES.txt:1` |
| Original's tools with an `inputSchema` | 85 | `re/05-ai-agent-acp-mcp/FINDINGS-TOOL-CONTRACTS.md:65` |
| Original's runtime count | **unknown, plan-dependent** | `mp()` filters by `Wf(tool) = planHas(Rf[tool.name], plan)` |

So the original advertised **93-94** tools where StudioMCP exposes **28**. That
gap is the whole point: 93 - 28 = 65 tools that are *not* StudioMCP tools at all.

### 6.4 Is there a 93-tool registry anywhere in the repo?

**Yes — but only as extracted *documentation/artifacts*, never as code.**

| Where | Form | Count |
|---|---|---|
| `artifacts/mcp-tools-robloxkit.md` | human table + schemas | 93 (`### \`name\`` headings, verified 93 unique) |
| `artifacts/mcp-tools-contracts.json` / `.md` | machine-readable contracts | 85 with schemas |
| `artifacts/mcp-tool-studio-routes.json` / `.md` | route map | 85 |
| `artifacts/frontend_unmin/_TOOLFEATURES.txt` | gate map | 86 |
| `artifacts/frontend_unmin/index-DPVV2ya5.js` | the **real** registry (`up`, `dp`, `dO()`) | 94 unique |
| `artifacts/mcp-tools.txt` | ⚠️ **different thing**: the third-party `@chrrxs/robloxstudio-mcp` set | 48 |

**No Rust or JS file in the repo implements any of these 93 tools.** Verified:
`grep` for the 9 original Studio-group tool names across
`rust/robloxkit-lite/src`, `app/src-tauri/src`, `app/dist/index.html` gives:

| Original tool name | Hits in rebuild |
|---|---|
| `search_game_tree` | 0 |
| `inspect_instance` | 0 |
| `list_scripts` | 0 |
| `read_script` | 0 |
| `edit_script` | 0 |
| `capture_viewport` | 0 |
| `studio_state` | 0 |
| `execute_luau` | 4 (all in `animation.rs`/`commands.rs` as a *StudioMCP* tool name) |
| `list_roblox_studios` | 6 (`studio.rs` — a StudioMCP tool, used for `studio_id`) |

`execute_luau` happens to be the one name both surfaces share, so the rebuild's
`animation.rs:326-330` calls it straight through — which is correct for StudioMCP
and would have been correct for the original too.

**Caveat on the number 93.** `re/08-frontend-ui/FINDINGS-SOURCE-RECOVERY.md:128-136`
says the earlier 93 came from a byte scan and that the readable source gives 94
unique names, 86 gated, 85 with schemas. `GAPS.md:260-266` and `HANDOFF.md:318-330`
repeat that. So **93 is the documented-but-superseded number; 94 is the current
static count; the true runtime count was never measured** because it depends on
the user's plan (`GAPS.md:267-269`: "the only authority for the runtime answer" is
a live `tools/list` on the original app, which nobody has captured).

---

## 7. What the original did that the rebuild does not

Reading `re/05-ai-agent-acp-mcp/FINDINGS.md` (§7, §7c, §7d) and
`FINDINGS-DEEP.md` (§3, §7) against the rebuild.

### 7.1 `mcp_register {tools, instructions}` — the big one

**Original.** Two Tauri commands implement a *host-side* MCP catalogue:

`re/03-tauri-commands/FINDINGS-DEEP-3.md:110-113`:

| Command | Handler | Request | Behaviour |
|---|---|---|---|
| `mcp_register` | `0x140963890` | `{ host, tools: Value, instructions: String }` | registers the tool catalogue with the frontend host |
| `mcp_tool_result` | `0x1409831E0` | `{ host, callId: String, result: Value }` | resolves a pending `mcp:call` (literal `result`) |

Confirmed in the decompilation `artifacts/decomp/handlers/mcp_register.c:132-142`
(deserialize order `host` len 4, `tools` len 5, `instructions` len 12) and
`:100-104` (`aMcpRegister` len 12, `aHost` len 4).

The **control flow is inverted relative to the rebuild**:

```
ORIGINAL:  agent -> RobloxKit HTTP MCP server -> emits `mcp:call` -> FRONTEND runs the tool
                                                                  -> `mcp_tool_result {callId, result}`
REBUILD:   agent -> RobloxKit HTTP MCP server -> Rust -> StudioMCP.exe stdio -> Studio
```

`re/05-ai-agent-acp-mcp/FINDINGS.md:251-256`:

> **Tool relay is frontend-mediated, not Rust-relayed:** the Rust side emits
> `mcp:call` (`0x1410d8f50`) → the **frontend** executes the tool
> (`fO(name, args)` in `index-DPVV2ya5.js`) → `mcp_tool_result` (`sub_1409831E0`).

**Rebuild.** Neither `mcp_register` nor `mcp_tool_result` exists: `grep` for
`mcp_register` across the whole repo's code (`*.rs`, `*.mjs`, `*.html`) → **0
hits** (it appears only in `artifacts/decomp/`, `artifacts/strings.txt`, and the
`.md` docs). The tool list comes from `bridge.list_tools()` instead.

**Consequence.** This is the single largest capability difference. The original's
agent got 93-94 tools covering asset generation, file I/O, DataStores, skills,
places, tasks, music/ytdl — only ~10 of which touch Studio at all
(`re/05-ai-agent-acp-mcp/FINDINGS-TOOL-ROUTES.md:27-39`: "only **10 of 85** tools
talk to Studio directly"). The rebuild's agent gets exactly StudioMCP's 28, all of
which are Studio-only.

### 7.2 `instructions` - a whole prompt, vs 58 characters

**Original.** `mcp_register {tools, instructions}` carries `ia()` =
`tools/instructions.md` with the installed-skills list interpolated
(`re/05-ai-agent-acp-mcp/FINDINGS.md:439-443`;
`artifacts/frontend_unmin/agentInstructions-DRb-9XyH.js:11-15`). Plus
`_meta.systemPrompt.append` (§5.2a) and the per-session place context (§5.2c).

**Rebuild.** One sentence, `mcpserver.rs:345`:
`"RobloxKit-lite internal tools (pass-through to StudioMCP)."`

### 7.3 Place context and skills — gone

**Original.** `agentInstructions` `l()` builds a 6-line block naming the open
place, `studio_id`, connection status, sibling Studio windows, and the two skills
to read first (`artifacts/frontend_unmin/agentInstructions-DRb-9XyH.js:16-24`),
prepended as a `robloxkit://studio/context` resource on the first prompt
(`acp-C1bBXu3Z.js:967-798`). Plus `list_skills` / `read_skill` as *tools*
(`re/05-ai-agent-acp-mcp/FINDINGS.md:414`).

**Rebuild.** Zero. No `placeKey` (0 hits), no skills tools, no context block,
`PromptParams` has no `context` field.

### 7.4 The `place` argument injection — gone

**Original.** For 14 tool names, `Yc()` injects a `place` string property
(`re/05-ai-agent-acp-mcp/FINDINGS.md:432-437`):

> For these 14 tool names, `Yc()` adds a `place` string property when absent:
> `search_game_tree, inspect_instance, read_console, execute_luau, list_scripts,
> read_script, edit_script, capture_viewport, studio_state, send_3d_to_studio,
> send_vfx_to_studio, send_icon_to_studio, send_sfx_to_studio, insert_music`.

**Rebuild.** None. Schemas pass through untouched (`mcpserver.rs:349-351`), so the
agent sees StudioMCP's schemas verbatim — no multi-place routing at all.

### 7.5 Plan/feature gating — gone (arguably a gain)

**Original.** `mp()` filters tools by plan:
`up.filter(t => (remote || !t.remote) && Wf(t))` where
`Wf(tool) = planHas(Rf[tool.name], plan)`, 13 gate keys
(`GAPS.md:260-269`, `re/08-frontend-ui/FINDINGS-SOURCE-RECOVERY.md:153-176`).

**Rebuild.** No gating (no auth, no plan). `GAPS.md:268-269` calls this out as
intended: "A no-auth clone should expose all 94 (gate collapses to `true`), which
is a superset of any real user." The rebuild instead exposes 28 — a *subset* of
both.

### 7.6 MCP method surface — reduced

**Original** internal server supported
`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`,
`prompts/list|get`, `resources/list|read|templates/list`,
`resources/subscribe|unsubscribe`, `completion/complete`, `logging/setLevel`,
`notifications/{progress,cancelled,resources/list_changed,tools/list_changed,prompts/list_changed,subscriptions/acknowledged}`,
`subscriptions/listen`, `server/discover` (`re/04-studio-bridge/FINDINGS.md:216-221`).

**Rebuild**: four methods (`initialize`, `ping`, `tools/list`, `tools/call`) and
`-32601` for everything else (`mcpserver.rs:334-381`).

### 7.7 ACP surface — reduced

**Original** ACP handlers: 17 commands including `acp_steer` (`_session/steering`),
`acp_turns`, `acp_set_mode`, `acp_set_config`, `acp_session_lookup`,
`acp_close_session`, `acp_login_status`, `acp_adapter_status`,
`agent_unrestricted_get/set` (`re/05-ai-agent-acp-mcp/FINDINGS-DEEP.md:31-49`).

**Rebuild**: `agent_list`, `acp_start`, `acp_prompt`, `acp_cancel`,
`acp_permission_respond` (`app/src-tauri/src/commands.rs`), and
`session/new` + `session/prompt` + `session/cancel` + `session/request_permission`
on the wire. No `session/load`, no `session/set_mode`, no `session/set_config_option`,
no `_session/steering`, no `session/close`.

### 7.8 Auth / signing — deliberately dropped (not a loss for the goal)

`X-RK-Sig` Ed25519 signing, `robloxkit.dev` proxy, Discord OAuth, device-id
derivation (`re/06-auth-session/FINDINGS.md`) are all gone. `mcpserver.rs:18-20`
says so explicitly: "No robloxkit.dev, no X-RK-* headers (those are the
cloud-signing pieces the no-auth rebuild drops)." This is the *stated goal* of the
project, so it is a difference by design, not a regression.

### 7.9 Summary table

| Capability | Original | Rebuild | Verdict |
|---|---|---|---|
| ACP `session/new` `mcpServers` (http) | yes | yes | **parity** |
| Tools exposed to agent | 93-94 | 28 | **-65** |
| Tool-name remapping (`read_script` etc.) | yes | no (raw StudioMCP names) | **loss** |
| `place` arg injection (14 tools) | yes | no | **loss** |
| `mcp_register {tools,instructions}` | yes | **absent** | **loss** |
| Instruction prompt | `tools/instructions.md` + skills | 58-char sentence | **loss** |
| System prompt (`_meta.systemPrompt.append`) | yes (57-char literal) | no | **loss** |
| Per-session place context block | yes | no | **loss** |
| Skills tools (`list_skills`,`read_skill`) | yes | no | **loss** |
| Frontend-mediated execution (`mcp:call`) | yes | no (Rust-direct) | **different, simpler** |
| Plan gating | yes | no | **change (intended)** |
| `prompts/*`, `resources/*`, `completion/*` | yes | no | **loss** |
| `tools/list_changed` forwarding | yes | no (`listChanged:false`) | **loss** |
| `session/load`, `set_mode`, `set_config_option` | yes | no | **loss** |
| `_session/steering` | yes | no | **loss** |
| `placeKey` / `threadId` session resume | yes (app-side) | no | **loss** |
| Auth / `X-RK-Sig` / `robloxkit.dev` | yes | no | **dropped by design** |
| Cryptographic token | `RtlGenRandom` 32B | SplitMix64 | **weaker** |

---

## 8. Answer: does the proxy add capability beyond `StudioMCP.exe`?

**The rebuild's proxy adds none.** Concretely:

1. `tools/list` is `bridge.list_tools()` serialized unchanged (`mcpserver.rs:349-351`);
   `StudioToolBridge::list_tools` is `self.0.list_tools().await` (`studio.rs:383-385`);
   `StudioBridge::list_tools` extracts `result.tools` and returns it
   (`studio.rs:200-219`). Three hops, zero transformation. **28 in, 28 out.**
2. `tools/call` forwards `name` and `arguments` verbatim
   (`mcpserver.rs:353-363`, `studio.rs:387-389`). The only rewrite
   (`studio_call` -> nested call + `studio_id`) is unreachable, because
   `studio_call` is not in the 28 (§3.4, §6.1).
3. It carries **no** system prompt, instructions, place context, `placeKey`,
   skills, or `_meta` (§5.1: 0 hits for every one of those tokens).
4. It *reduces* the surface vs StudioMCP itself: `listChanged:false`
   (`mcpserver.rs:343`) vs StudioMCP's `true`; child notifications dropped
   (`studio.rs:330-332`); `prompts/list` and `resources/list` return `-32601`
   even though StudioMCP answers them with empty arrays (§6.1).

**What it *does* provide is genuinely necessary, but it is transport, not
capability:**

* it converts **stdio** MCP into **Streamable HTTP** MCP, because an ACP agent can
  only be handed an MCP server through `session/new.mcpServers`, and the rebuild
  chose the `http` transport (the original did the same —
  `re/05-ai-agent-acp-mcp/FINDINGS.md:279-336`);
* it adds a loopback Bearer token so an arbitrary local process cannot drive the
  user's Studio (`mcpserver.rs:295-303`);
* it owns the `StudioMCP.exe` child's lifetime as a lazy singleton
  (`studio.rs:352-366`) and kills its process tree on stop
  (`rust/robloxkit-lite/src/acp.rs:432-446` — `taskkill /T /F`).

All three are also achievable by pointing the agent at `StudioMCP.exe` as a
`stdio` MCP server directly, which is exactly what the live evidence shows works
(`.omo/roblox-re/00-runtime-evidence.md` E3: `"roblox-studio":{"type":"stdio",
"command":"…\\StudioMCP.exe"}` and five `StudioMCP.exe` children spawned by
`claude.exe`).

**Therefore:** the rebuild's proxy is **a transport wrapper with an auth token and
a process supervisor**, not a capability layer. The *original* RobloxKit's proxy
**was** a capability layer — it owned a 93-94 tool registry, executed tools in its
own frontend, injected a place argument into 14 schemas, and shipped a real
instruction prompt plus per-session place context. That layer was not rebuilt.

---

## 9. Residual unknowns (do not overclaim)

| Item | Status |
|---|---|
| Whether the original's `_meta.systemPrompt.append` receives the 57-char literal | **UNVERIFIED** — no `lea` from `sub_1402DB9A0` to `0x1412b6bc8`; only `sub_1402D91E0` references it |
| Whether `acp_new_session`'s `instructions` field (from `acp/rules.md`) reaches the ACP wire | **UNVERIFIED** — read at `acp_new_session.c:383`, slot not traced |
| Live `tools/list` count on the original app | **UNVERIFIED** — plan-dependent; nobody captured it (`GAPS.md:267-269`) |
| Whether the array-form `headers` in `mcpserver.rs:124` is required (vs the original's object map) | **UNVERIFIED** — comment asserts adapter rejection; not re-tested |
| Exact JSON nesting the original sends (the `_meta` key's parent) | **UNVERIFIED** — the RE's §7c chain, not independently traced |
| `sub_1402D91E0`'s exact output object shape (`includeMcpJson` + `mcpServers` + description + `AGENTS.md`) | **PARTIAL** — keys recovered, structure inferred from key order |

## 10. Reproduce

```powershell
# live StudioMCP tool count (28)
$exe = "$env:LOCALAPPDATA\Roblox\Versions\version-7aaa6838d36c4448\StudioMCP.exe"
# spawn, send initialize + notifications/initialized + tools/list on stdin, read two lines

# negative evidence: the rebuild sends no instructions/placeKey/systemPrompt/_meta
Select-String -Path rust\robloxkit-lite\src\*.rs,app\src-tauri\src\*.rs,app\dist\index.html `
  -Pattern 'placeKey','systemPrompt','_meta','mcp_register' -SimpleMatch

# Address mapping used throughout (PE sections: .text rva=0x1000 rawptr=0x400,
# .rdata rva=0x10d2000 rawptr=0x10d1000):
#   .text   VA = file_off + 0x14000C00      file_off = VA - 0x14000C00
#   .rdata  VA = file_off + 0x140001000     file_off = VA - 0x140001000
# e.g. file 0x2dae52 -> VA 0x1402dba52 ("claudeCo"); file 0x12b5bc8 -> VA 0x1412b6bc8

# the runtime-built keys in sub_1402DB9A0 (VA 0x1402dba40..0x1402dc100)
python -c "d=open(r'C:\Users\Novella\AppData\Local\RobloxKit\robloxkit-desktop.exe','rb').read(); print(d[0x2dae40:0x2db500].hex(' '))"

# the runtime-built keys + prompt in sub_1402D91E0 (VA 0x1402d92d0..0x1402d9660)
python -c "d=open(r'C:\Users\Novella\AppData\Local\RobloxKit\robloxkit-desktop.exe','rb').read(); print(d[0x2d86d0:0x2d8a60].hex(' '))"

# the 57-char prompt literal (VA 0x1412b6bc8)
python -c "d=open(r'C:\Users\Novella\AppData\Local\RobloxKit\robloxkit-desktop.exe','rb').read(); print(d[0x12b5bc8:0x12b5bc8+57])"
```
