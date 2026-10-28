# Design resolution — how todo 4 gates on "the Roblox project"

> Written by the orchestrator after the first todo-4 worker stopped on this exact
> question without producing code. The question is real; the answer is now settled
> by reading the code. Do not re-litigate it.

## The question the worker got stuck on

`AcpManager::new_session_with_context` has no access to a project registry, so
"gate on the session's project being the Roblox project" looked like it required
either (a) a new global/side-channel, (b) a path comparison, or (c) threading
project identity across three layers. The worker correctly rejected (a) and (b) but
did not find (c).

## The three facts that settle it

### Fact 1 — there is only ONE real session-creation path, and it HAS the registry

`src/renderer/lib/acp-transport/desktop-transport.ts`:

```ts
export class DesktopAcpTransport extends WsAcpTransport {
```

The desktop transport is a **subclass** of the WebSocket transport; only the socket
carrier differs. So desktop and web both issue the same `/ws` request types. There is
no separate Tauri `acp_new_session` command in this tree (grepped: zero hits in
`src-tauri`), which is why the worker could not find one.

Therefore the call sites that matter are the WS handlers:

| Path | File | Has registry? |
| --- | --- | --- |
| create | `src-tauri/src/web/ws/projects.rs:110-124` | **yes** — `registry: &ProjectRegistry` is a parameter |
| reopen (load) | `src-tauri/src/web/ws/projects.rs:383` | yes (same handler module) |
| reopen (resume) | `src-tauri/src/web/ws/lifecycle.rs:45` | yes — `env.registry` |

So **project identity is resolvable at the exact place the session request is
assembled.** No global, no side-channel.

### Fact 2 — the registry exposes the project name by id

`src-tauri/src/web/project_registry/mod.rs`:

```rust
pub fn snapshot(&self) -> ProjectListPayload          // :245 — ProjectSummary { id, name, .. }
pub fn contains(&self, project_id: &str) -> bool      // :284
pub fn find_by_path(&self, cwd: &str) -> Option<String> // :299 — cwd -> project id
```

`ProjectSummary.name` is the display name (`:220`). The renderer creates the Roblox
project with the literal `ROBLOX_PROJECT_NAME = 'Roblox'`
(`src/renderer/lib/roblox-studio-mcp.ts:9`), so comparing the registry-resolved name
against that same constant is a **registry-backed** identity check, not path matching.
The plan explicitly permits this ("if only the name is available at the call site,
compare against `ROBLOX_PROJECT_NAME` and document why") — and here the name comes
from the registry, not from a directory basename.

### Fact 3 — the plumbing already exists for `project_id`; extend it, don't invent

`SessionCreationContext` (`acp/manager/mod.rs`) already carries
`project_id: Option<String>`, and `AcpCommand::NewSession` (`:187-199`) already
carries `project_id: Option<String>` — threaded from the WS handler today. The reopen
commands (`LoadSession :200`, `ResumeSession :210`) carry `cwd` and
`mcp_servers` but **not** `project_id`.

So the change is a small, uniform extension of an existing pattern.

## The decided design

1. **Compute the decision at the WS handler** (where the registry lives):
   resolve the project's name by id from the registry; `is_roblox_project = name ==
   ROBLOX_PROJECT_NAME` (export the constant once in Rust, or compare against the
   existing literal with a comment pointing at `roblox-studio-mcp.ts:9`).
   Additionally require that the session's `mcp_servers` actually contains a
   `roblox-studio` entry — if it does not, do nothing at all.

2. **Thread a single boolean** (name it something explicit like
   `roblox_studio_eager_load: bool`) through:
   - `SessionCreationContext` (default `false`),
   - `AcpCommand::NewSession`,
   - `AcpCommand::LoadSession` and `AcpCommand::ResumeSession` (new field, default
     `false` — these are the reopen paths),
   - the manager methods `new_session_with_context`, `load_session`,
     `resume_session`, and `prepare_reopen_mcp` (pass it through).

3. **Act in the command loop** (`command_loop.rs:155, 387, 478`):
   - when the flag is set, emit the merged `_meta` (thinking + `mcpServers`) instead
     of thinking-only, and
   - filter `roblox-studio` out of the `mcp_servers` vector before attaching it.
   When the flag is false, behaviour is byte-identical to today.

4. **Resolve the Studio path inside the meta builder** via
   `crate::roblox::find_studio_mcp()`. If `None`, emit thinking-only meta and skip
   the array filter — a machine without Studio must start sessions normally.

## Why not "gate on the roblox-studio entry being present"

Because the renderer's MCP registry is a single shared list
(`selectMcpServersForAgent` at `src/renderer/lib/acp-mcp-persistence.ts:152` iterates
the whole registry and includes every enabled stdio entry,
`session.ts:1540-1543`), so `roblox-studio` is attached to **every** session of
**every** project once registered. Gating on the entry alone would change non-Roblox
sessions — a direct violation of "MUST NOT change any non-Roblox session's request".
Project identity is therefore mandatory, which is why Fact 1 matters so much.

## Test that must exist

A test that asserts, for a Roblox session, the built ACP `mcp_servers` list does not
contain `roblox-studio` **while** `_meta` does carry
`claudeCode.options.mcpServers["roblox-studio"].alwaysLoad == true`. Both halves in
one test — because either half alone passes while the ordering trap silently
reintroduces the bug.
