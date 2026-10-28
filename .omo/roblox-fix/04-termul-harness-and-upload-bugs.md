# Termul — BUG A (harness routing) and BUG B (Roblox upload)

Investigation of branch `dev` at `31901d7c`. No source file was modified; nothing was built or run.

Two labels are used throughout:

- **PROVED** — read directly out of the source, or out of a real transcript/artifact on this machine.
- **GUESS** — inference that the source does not settle.

The evidence base is unusually good: the failing run left a complete Claude Code transcript on disk, so most of BUG B is provable rather than inferred.

- Chat transcript: `C:\Users\Novella\.claude\projects\C--Users-Novella-Documents-RobloxKit\888892cf-4d41-478b-9cbc-1bc46811a99c.jsonl`
- The blob the screenshots mention: `...\888892cf-4d41-478b-9cbc-1bc46811a99c\tool-results\mcp-termul-blob-1793105141834-y4lek2.png` (46 871 bytes, 2026-10-27 19:45:41)

---

## 0. Executive summary

**BUG A is a broken map lookup, not a wrong default.** `resolveGeneratorAgent()` reads `configToLiveAgent` with a *bare config id* as the key, but every writer in production keys that map with `agentReuseKey()`, which is `configId\0cwd[\0project\0projectId]` (NUL-separated). So both lookups that could honour the user's harness — the selected config and the Claude fallback — return `undefined` **every time**, and control always falls through to the last line: "any live agent". That is why a Claude Code chat's generator ran on OpenCode. On top of that, the strongest signal available (the calling chat's own agent, delivered on the wire as `call.agentId`) is never passed in, because `startGeneratorGateway` calls `resolveGeneratorAgent()` with no argument.

The OpenCode session-list entries are a **second, independent defect**: `ephemeral: true` is Termul's *own* bookkeeping flag and is never sent to the agent. ACP `session/new` has no "do not persist" field, so whichever agent receives the generator turns persists them in its own store, titled from the first message — which is where "Roblox shirt design fix", "Roblox tshirt design fix", "Roblox pants design fix" come from. And because the transport opens one session **per turn**, a single generation leaks several.

**BUG B is a documentation/contract failure, not a missing capability.** The model is told (a) to poll with `get_task_result`, a tool that does not exist, and (b) that the poll reply carries `image` as a `data:image/png;base64` URL — but the child process *strips* `image` out of the JSON and converts it into an MCP image block. So the model sees a picture it can look at, and a JSON object with no `image` key: exactly the screenshot reasoning ("guessed the result contained base64 data … I can't easily access the base64 in a file"). The only file on disk is Claude Code's own tool-result blob, which Termul never writes and which the tool description explicitly denies exists. Termul has no upload tool, and the Studio MCP `upload_image` requires an `http(s)` URL — so the `python -m http.server 8765` detour was a *correct* workaround discovered the hard way.

---

## 1. Exactly how the agent for a generator turn is chosen

### 1.1 The chain

```
WorkspaceLayout.tsx:84-87   useEffect -> startGeneratorGateway({ cwd: activeProject.path })
generator-gateway.ts:39-69  builds the handler; resolves the agent lazily, per call
generator-gateway.ts:60-64  createAcpBrainTransport({ agentId: () => resolve()?.id ?? null, cwd })
generator-gateway.ts:47     const resolve = options.agent ?? (() => resolveGeneratorAgent())   <-- no sessionId
agent-selection.ts:34-57    resolveGeneratorAgent(sessionId?)
acp-brain-transport.ts:52   const agentId = options.agentId()
acp-brain-transport.ts:59   acpNewSession(agentId, options.cwd, [], { ephemeral: true, promotable: false })
acp-api.ts:1019-1061        -> transport.newSession(...) -> host ACP manager
```

`WorkspaceLayout.tsx:84-87`:

```tsx
  useEffect(() => {
    if (!activeProject?.path) return
    return startGeneratorGateway({ cwd: activeProject.path })
  }, [activeProject?.path])
```

`generator-gateway.ts:46-67`:

```ts
  const queue = options.queue ?? new TaskQueue()
  const resolve = options.agent ?? (() => resolveGeneratorAgent())
  const brainOf = (): Brain => {
    const agent = resolve()
    return agent ? { id: brainIdOf(agent.id), takesImages: agent.takesImages } : { id: 'custom' }
  }
  ...
        askBrain: createAskBrain({
          transport: createAcpBrainTransport({
            agentId: () => resolve()?.id ?? null,
            cwd: options.cwd
          })
        }),
```

The agent is resolved **lazily on every call**, which is deliberate (the header comment at `generator-gateway.ts:32-38` says a chat can switch agent between two generations). But the resolver is invoked with **no arguments**.

### 1.2 The resolver

`agent-selection.ts:34-57` verbatim:

```ts
export function resolveGeneratorAgent(sessionId?: string | null): GeneratorAgent | null {
  const state = useAcpStore.getState()
  const live = state.configToLiveAgent ?? {}
  const agents = state.agents ?? {}

  const pick = (id: string | undefined | null): GeneratorAgent | null => {
    if (!id) return null
    return { id, takesImages: takesImagesOf(agents[id]?.capabilities) }
  }

  const session = sessionId ? state.sessions?.[sessionId] : undefined
  const fromSession = pick(session?.agentId)
  if (fromSession) return fromSession

  const selected = state.selectedAgentConfigId
  if (selected) {
    const fromSelection = pick(live[selected])
    if (fromSelection) return fromSelection
  }

  const fromClaude = pick(live[CLAUDE_AGENT_CONFIG_ID])
  if (fromClaude) return fromClaude

  return pick(Object.values(live).find((id) => !!id))
}
```

Three ordered attempts, then a wildcard. Assess each:

| Step | Line | Works in production? |
|---|---|---|
| 1. the chat's own agent (`sessions[sessionId].agentId`) | `:44-46` | **No** — `sessionId` is never supplied (`generator-gateway.ts:47`) |
| 2. the user's selected config (`live[selectedAgentConfigId]`) | `:48-52` | **No** — key shape mismatch (below) |
| 3. the live Claude agent (`live[CLAUDE_AGENT_CONFIG_ID]`) | `:54-55` | **No** — same key shape mismatch |
| 4. any live agent | `:57` | Yes — and this is therefore what always runs |

### 1.3 Why steps 2 and 3 can never match — PROVED

`configToLiveAgent` is keyed by `agentReuseKey(...)`, never by a bare config id. `acp-reuse-keys.ts:42-47`:

```ts
export function agentReuseKey(configId: string, cwd: string, projectId?: string | null): string {
  const base = `${configId}${NUL}${cwd.trim()}`
  const project = projectId?.trim() ?? ''
  if (project.length === 0) return base
  return `${base}${NUL}${PROJECT_SEGMENT}${NUL}${project}`
}
```

(`NUL` is `'\0'`, `acp-reuse-keys.ts:25`.)

Every production writer uses it. `shared-state.ts:991` — the spawn path:

```ts
        set((s) => ({ configToLiveAgent: { ...s.configToLiveAgent, [key]: agentId } }))
```

where `key` is either `reuseKey` (from `currentLaunch`, which is `agentReuseKey(configId, cwd, resolvedProjectId)` — `shared-state.ts:881-883`) or `detachedReuseKey(reuseKey, agentId)`. Also `shared-state.ts:749` / `:763-766` (host-agent adoption) and `helpers.ts:1811` (detach for new credentials). The type doc says so too — `types.ts:422-428`:

```ts
  /**
   * Maps a per-project agent reuse key (`agentReuseKey(configId, cwd, projectId)`) to its
   * live spawned AgentId (for reuse). Keyed by config+cwd — not config alone —
   * ...
   */
  configToLiveAgent: Record<string, AgentId>
```

So in production the map looks like:

```
"acp-registry:claude-acp\0C:\\Users\\Novella\\Documents\\robloxkit\0project\0p1" -> "agent-7"
"acp-registry:opencode\0C:\\Users\\Novella\\Documents\\robloxkit\0project\0p1"    -> "agent-9"
```

and `live['acp-registry:claude-acp']` is `undefined`. `selectedAgentConfigId` is a bare config id — `types.ts:443-445`:

```ts
  /** The agent the warm-session pool targets (drives refill-on-consume +
   * agent-switch drain). Null = no active pool (no refill, no drain). */
  selectedAgentConfigId: string | null
```

written as a bare id at `slices/config.ts:318` (`setSelectedAgentConfigId: (configId) => set({ selectedAgentConfigId: configId })`) and `AgentLauncher.tsx:1113`. So step 2 is `live["acp-registry:claude-acp"]` → `undefined` → `pick(undefined)` → `null` → continue. Step 3 is the same expression with a constant → `undefined` → `null` → continue. **Both harness-honouring branches are dead code in production.**

That leaves step 4: `Object.values(live).find((id) => !!id)` — insertion-order-dependent, and with a warm pool that pre-spawns the *selected* agent plus whatever else is live, it is entirely possible for the OpenCode process to come first. **This is the mechanism by which the generator ran on OpenCode while Claude Code was selected.**

### 1.4 The strongest signal is on the wire and thrown away — PROVED

The host already tells the renderer which agent and session issued the call. `generator-gateway-client.ts:23-31`:

```ts
export interface GeneratorCall {
  agentId: string
  sessionId: string
  callId: number
  /** The agent's tool name, e.g. `generate_clothing` or `get_3d_task`. */
  tool: string
  /** The tool arguments as JSON text, unparsed. */
  arguments: string
}
```

and the host fills them at `src-tauri/src/acp/host_mcp/parent/generator.rs:33-39, 79-85`:

```rust
pub struct GeneratorCallEvent {
    pub agent_id: String,
    pub session_id: String,
    pub call_id: u64,
    pub tool: String,
    pub arguments: String,
}
```

`createGeneratorHandler` receives that whole object (`gateway-handler.ts:61`) but only ever reads `call.tool`, `call.arguments` and `call.callId`. A grep for `call.agentId` / `call.sessionId` across the renderer generator code finds **nothing** (the only `call.sessionId` hit in the whole renderer is a test assertion in `acp-store/agent-switch.test.ts:4557`). So `resolveGeneratorAgent(sessionId)` is a parameter that no caller supplies: `generator-gateway.ts:47` calls it bare.

### 1.5 The unit test encodes the bug — PROVED

`__tests__/agent-selection.test.ts:19-38`:

```ts
  it('uses the chat session agent when the call names one', () => {
    reset({
      sessions: { 's-1': { agentId: 'runtime-codex' } },
      configToLiveAgent: { [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude' }
    })
    ...
  it('uses the selected agent config rather than assuming Claude', () => {
    reset({
      selectedAgentConfigId: 'acp-registry:codex-acp',
      configToLiveAgent: {
        'acp-registry:codex-acp': 'runtime-codex',
        [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude'
      }
    })
```

Every fixture seeds `configToLiveAgent` with **bare config ids** — a shape no production writer ever produces. The suite therefore passes while the production path is broken, and it would keep passing after the real bug was fixed unless the fixtures change to `agentReuseKey(...)`. Any fix must add a test built from the real key shape.

### 1.6 What the user's selection is, and where it is read at generator start

There is no "harness" concept in the codebase. The selection is `useAcpStore.selectedAgentConfigId: string | null` (`types.ts:443-445`), a **config** id (`acp-registry:claude-acp` — `lib/claude-agent-id.ts:9`), while a generator needs a **runtime agent** id (what `spawnAgent` returned). The only bridge is `configToLiveAgent`. So the selection is honoured only if the lookup uses the right key, and it does not. At generator start the field is read exactly once, at `agent-selection.ts:48`, via the broken map lookup.

---

## 2. Where the brain session is created, with which `cwd`, and why it lands in OpenCode

### 2.1 Creation

`acp-brain-transport.ts:47-63`:

```ts
  return {
    async send({ scope, messages }) {
      const last = messages[messages.length - 1]
      if (!last) throw new Error('a generator turn needs at least one message')

      const agentId = options.agentId()
      if (!agentId) {
        throw new Error(
          'no ACP agent is running, so the generator has nothing to ask; start a chat first'
        )
      }

      const session = await acpNewSession(agentId, options.cwd, [], {
        ephemeral: true,
        promotable: false
      })
```

**`cwd` is the active project's path**, i.e. the RobloxKit project directory, not Termul's own — `WorkspaceLayout.tsx:86` passes `activeProject.path`, which flows to `generator-gateway.ts:62` (`cwd: options.cwd`). PROVED. The transcript confirms the effective cwd is `C:\Users\Novella\Documents\robloxkit`.

Also note: `mcpServers` is `[]`, and the session is created **inside `send()`**, so there is one agent session per model turn, not per generation (see §2.4).

### 2.2 `ephemeral` never reaches the agent — PROVED

`acpNewSession` forwards `options` to the host (`acp-api.ts:1049-1051`), and the host builds the request at `src-tauri/src/acp/manager/command_loop.rs:155-165`:

```rust
                    let (mcp_servers, meta) =
                        shape_session_request(profile.summarize_thinking, &roblox, mcp_servers).await;
                    let mut request = NewSessionRequest::new(cwd.clone())
                        .mcp_servers(mcp_servers)
                        .additional_directories(additional_directories);
                    if let Some(meta) = meta {
                        request = request.meta(meta);
                    }
```

`cwd`, `mcp_servers`, `additional_directories`, optional `_meta`. **No ephemeral flag** — because ACP has no such field. `ephemeral` is consumed entirely on Termul's side, `command_loop.rs:207-211`:

```rust
                            if !ephemeral {
                                if let Some(persistence) = req_persistence {
                                    if let Err(error) =
                                        persistence.register_session(registration.clone()).await
```

and `command_loop.rs:239-245`:

```rust
                            {
                                let mut state = req_state.lock();
                                state.set_session_root(session_id.0.clone(), PathBuf::from(&cwd));
                                if ephemeral {
                                    state.mark_ephemeral(session_id.0.clone());
```

`session.rs:414-421`:

```rust
    pub(crate) fn mark_ephemeral(&mut self, session_id: String) {
        self.ephemeral_sessions.insert(session_id);
    }
```

So `ephemeral: true` means only: *Termul will not register or persist this session in its own JSONL index*. It says nothing to the agent. The agent stores the session in its own database.

### 2.3 Why they appear in OpenCode's session list — PROVED mechanism, GUESS on the titles

Because the flag above is Termul-local, the receiving agent persists the session under the `cwd` it was given (the RobloxKit project). OpenCode titles a new session from its first user message; the generator's first message is the clothing system prompt folded into the request (`ask-brain.ts:57-66`) followed by either `Design a <type>: <prompt>` or `Fix this <type> design JSON and return the whole corrected design` (`generate-clothing.ts:84-97`). A title generator summarising that lands very naturally on **"Roblox shirt design fix" / "Roblox tshirt design fix" / "Roblox pants design fix"**. That the *type* appears in the title is the tell: the type only exists in the generator's own message.

- Mechanism (session persisted by the agent, under the project cwd): **PROVED**.
- Exact title string produced by OpenCode's own title generator: **GUESS** — I could not read OpenCode's store (`opencode.db` is locked by a running process and is ~9.9 GB).

### 2.4 Why there are *many* entries, not one — PROVED

The session is created per `send()`, i.e. per model turn, and `designLoop` makes several turns per generation:

- `loop.ts:121` authoring turn
- `loop.ts:160` one turn per build rejection (`MAX_BUILD_RETRIES`)
- `loop.ts:191` one turn per review round (`MAX_REVIEW_ROUNDS`)
- `loop.ts:225`, `:255` more on DONE re-asks and rebuilds

Each is a fresh `acpNewSession`, closed in `finally` (`acp-brain-transport.ts:92-95`):

```ts
      } finally {
        stopChunks()
        await acpCloseSession(agentId, sessionId).catch(() => undefined)
      }
```

Closing a session does not delete it from the agent's own store. So one clothing generation with two review rounds produces ~3+ orphaned sessions in the agent's list, each titled from its own turn ("…design fix" for the correction turns, which are the majority).

### 2.5 Does the generator spawn the OpenCode ACP binary regardless of selection?

**No — and this distinction matters for the fix.** Nothing in the generator path launches a binary. `acp-brain-transport.ts` only calls `acpNewSession(agentId, ...)` on an agent **that is already running**; if none is running it throws (`:53-57`). The OpenCode process was already live (warm pool / a previously opened chat), and §1.3 explains why its id was the one returned. So the defect is purely in *which* live agent gets picked, not in *what* gets spawned. **PROVED.**

---

## 3. How the app stores the selected harness (search results)

| Field | Type | Declared | Written | Read at generator start |
|---|---|---|---|---|
| `selectedAgentConfigId` | `string \| null` (a **config** id, e.g. `acp-registry:claude-acp`) | `stores/acp-store/types.ts:443-445` | `slices/config.ts:318`; `AgentLauncher.tsx:1113`; `hooks/use-acp-agents.ts:103,113` | `agent-selection.ts:48` — **broken lookup** |
| `configToLiveAgent` | `Record<reuseKey, AgentId>` | `types.ts:422-428` | `shared-state.ts:991`, `:763-766`; `helpers.ts:1811` | `agent-selection.ts:36,50,54,57` |
| `CLAUDE_AGENT_CONFIG_ID` | `'acp-registry:claude-acp'` | `lib/claude-agent-id.ts:9` | const | `agent-selection.ts:11,54` |
| `agents[id].capabilities` | runtime agent record | `types.ts` (`agents` map) | host `initialize` reply | `agent-selection.ts:41` (`takesImagesOf`) |

There is no `agentId`, `selectedAgent` or `harness` state field for this purpose. The word "harness" appears only in test-harness comments and unrelated prose (e.g. `types/settings.ts:124`, `hooks/use-terminal-idle-notification.ts:67`). **PROVED.**

Note the capability read at `agent-selection.ts:41` is *correct* — `agents` is keyed by runtime agent id, which is what `pick()` is given. That is why `takesImages` works while agent choice does not.

---
## 4. BUG B — what the model actually receives

### 4.1 The `mcp-termul-blob-*.png` on disk is written by Claude Code, not by Termul — PROVED

A repo-wide grep for `blob` in `src-tauri` finds only unrelated hits (git blob hashes, `blob:` URL parsing, SSH key blobs); `tool-results`, `mcp-termul-blob` and `blob-17…` match **nothing** in `src-tauri` or `src/renderer`. Termul writes no artifact file. Confirmed by grepping the generator tree for `writeFile|save|toBlob|disk`: the only hits are a comment in `png.ts:4` and canvas `save()`/`restore()` calls in `vector.ts`.

The file naming is the client's: `mcp-<server>-blob-<epoch-ms>-<rand>.<ext>`, where `<server>` is `termul`. The same directory holds `mcp-roblox-studio-blob-1793105239514-837jql.jpg` etc. from the *other* MCP server — one naming scheme, two servers, so it belongs to the client. Claude Code materialises an MCP image content block to disk and replaces it in the transcript with a text placeholder. The transcript shows exactly that (`…888892cf….jsonl`, line 74):

```
content[0] = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo…" } }
content[1] = { type: "text", text: "[Image: source: C:\\Users\\Novella\\.claude\\projects\\C--Users-Novella-Documents-robloxkit\\888892cf-…\\tool-results\\mcp-termul-blob-1793105141834-y4lek2.png]" }
content[2] = { type: "text", text: "{\"status\":\"done\",\"taskId\":\"task-mvqoc22h-3\",…}" }
```

So: **the blob is a side effect of the client, written under `~/.claude/projects/<project-slug>/<session-uuid>/tool-results/`, outside the project cwd, and Termul neither knows nor controls it.** (The placeholder path lowercases the slug — `…-robloxkit` — while the directory on disk is `…-RobloxKit`; it worked only because NTFS is case-insensitive. On a case-sensitive filesystem that path would not resolve. **PROVED** by comparing the two strings.)

**This directly contradicts the tool description.** `generator_tools.rs:169-171` tells the model:

```
             describes the render in words. Nothing is written to disk, so do not search the \
             filesystem for an output file.
```

A file *is* on disk. The model found it, by reading the `[Image: source: …]` placeholder it was never meant to depend on. That contradiction is a real hazard: the instruction is right for Termul and wrong for the client.

### 4.2 Does the generator's image go through that path? — PROVED

Yes, but only incidentally: `buildClothing` produces a `data:image/png;base64` URL (`build.ts:82` → `png.ts:14-28` `canvas.toDataURL('image/png')`), the renderer sends it as `result.image` on the poll reply, `child.rs` converts it into an MCP `ContentBlock::image`, and *then* Claude Code turns that block into the blob file. Termul itself never writes the bytes anywhere.

### 4.3 The full JSON envelope after `generate_clothing` — verbatim

**(a) The immediate reply.** `gateway-handler.ts:103-108`:

```ts
    const accepted = queueGenerateClothing(deps.clothing, {
      type,
      prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
      design: spec
    })
    return { callId: call.callId, ok: true, result: accepted }
```

`queueGenerateClothing` returns (`generate-clothing.ts:145-150`):

```ts
  return {
    status: task.status === 'running' ? 'running' : 'queued',
    taskId: task.id,
    stage: task.stage,
    note: ACCEPTED_NOTE
  }
```

with `generate-clothing.ts:77-78`:

```ts
const ACCEPTED_NOTE =
  'Still designing in the background. Carry on; call get_task_result with this task_id.'
```

The host wraps it (`parent/generator.rs:100-106` → `child.rs:251-256` → `generator_result`) and, because there is no `image` key, `child.rs:288-290` returns `CallToolResult::structured(result)` — text only. **The model literally received this** (transcript line 25):

```json
{"status":"queued","taskId":"task-mvqoc22h-3","stage":"Waiting","note":"Still designing in the background. Carry on; call get_task_result with this task_id."}
```

**(b) The poll reply.** `readClothingResult` (`generate-clothing.ts:180-201`) builds:

```ts
    return {
      status: 'done',
      taskId,
      stage: task.stage,
      design: built?.built?.spec ?? built?.result ?? null,
      image: built?.built?.sheet,
      report: built?.built?.report,
      layout: built?.built?.layout,
      summary: `${task.title} is ready`
    }
```

Then `child.rs:283-310` **removes `image` from the object**:

```rust
fn generator_result(mut result: serde_json::Value) -> CallToolResult {
    let image = result
        .as_object_mut()
        .and_then(|fields| fields.remove("image"))
        .and_then(|value| value.as_str().map(str::to_string));
    let Some(data) = image else {
        return CallToolResult::structured(result);
    };
    ...
    let text = result.to_string();
    let mut out = CallToolResult::structured(result);
    out.content = vec![
        rmcp::model::ContentBlock::text(text),
        rmcp::model::ContentBlock::image(base64, mime),
    ];
    out
}
```

So the **exact JSON text the model received** (transcript line 74, third block; keys verified programmatically) was:

```json
{
  "status": "done",
  "taskId": "task-mvqoc22h-3",
  "stage": "Done",
  "design": { "type": "shirt", "background": null, "name": "Royal Court Cape", "layers": [ … 38 layers … ] },
  "summary": "Baju kerajaan dengan jubah is ready",
  "report": { "ok": true, "issues": [], "width": 585, "height": 559, "coverage": 0.4509, "colors": 400 },
  "layout": "Sheet 585x559, garment shirt. 38 layer(s). Painted 45.1% with 400 distinct colour(s). Regions: torso_right, torso_front, …"
}
```

**Keys present: `status, taskId, stage, design, summary, report, layout`. `image` is absent.** (Verified: `image present? False`.) Plus, as a separate content block, the PNG itself.

**This is the core of BUG B.** `task_tool()` promises the opposite — `generator_tools.rs:164-173`:

```rust
             queued, running, done, failed or cancelled. When it is done the reply carries the \
             artifact itself: `image` is a `data:image/png;base64` URL you can show, `design` is \
             the spec the engine accepted, `report` is what the checks found, and `layout` \
             describes the render in words. Nothing is written to disk, so do not search the \
             filesystem for an output file. While it is still running the reply carries the \
             stage the engine is on; poll again rather than starting a second generation.",
```

The model is told a field exists that the child strips. Its reasoning in the screenshot ("guessed the result contained base64 data … I can't easily access the base64 in a file") is the predictable consequence.

### 4.4 Two more provable contract errors on the same path

1. **The note names a tool that does not exist.** `get_task_result` appears exactly once in the whole repository — as that string (`generate-clothing.ts:78`). The real name is built at `generator_tools.rs:162-163` as `format!("get_{}_task", family.engine)` → `get_clothing_task`. The model happened to guess right; it could as easily have called a phantom tool and burned the turn. The e2e test *pins the wrong name*: `__tests__/e2e-clothing.test.ts:123` — `expect(accepted.note).toContain('get_task_result')`.
2. **`stage` disagrees with the documented status vocabulary.** The accepted reply says `"stage":"Waiting"` (`task-queue.ts:129`) while the description promises "Status is one of queued, running, done, failed or cancelled". Harmless, but it is another place the description and the code drifted.

### 4.5 Is there any upload/asset tool in Termul's surface? — PROVED: no

A grep for `upload` across `src-tauri/src/acp/host_mcp/` returns exactly **one** hit, and it is a *description of the other server's tools*: `roblox/instructions.rs:20` — the `"upload_image"` entry in `STUDIO_MCP_TOOLS`. Termul's own tool surface is `plan`, `set_session_title`, `read_canvas_guide`, `get_canvas_style`, `ask_user`, `get_info`, the canvas tools, `browser`, and the `generate_*`/`get_*_task` pairs (`child.rs:346-409`, `generator_tools.rs:190-197`, `canvas_tools.rs:65`). **No upload, no asset-publish, and nothing that serves an artifact over HTTP.**

`upload_image` belongs to the **separate Roblox Studio MCP server** (`StudioMCP.exe`), whose schema `.omo/roblox-re/03-studiomcp-tool-surface.md:780-794` records as requiring `imagePaths: array<string>` and `studio_id`, with the description "Upload a batch of images **from http server**". The real constraint is confirmed by the transcript itself (line 118):

```json
{"C:\\Users\\Novella\\Documents\\robloxkit\\royal-cape-shirt.png":"Error Upload: Only http/https URLs are supported"}
```

So the `python -m http.server 8765` detour was not confusion — it was the only route to a URL. It cost five minutes because **no tool and no instruction says so**.

Termul does run loopback HTTP servers — `canvas/static_server.rs:4` ("the desktop binds `StaticServer` on `127.0.0.1:0`") and the `web` router — but neither serves generator artifacts, and both are token-gated per canvas. So there is no Termul-provided URL the agent could have used.

---

## 5. Root cause hypotheses (ranked)

### BUG A

#### A1 — `configToLiveAgent` is read with the wrong key shape; the selected harness is never honoured. **Confidence: very high. PROVED.**

**Evidence for:**
- `agent-selection.ts:48-55` indexes `live[selected]` and `live[CLAUDE_AGENT_CONFIG_ID]` with bare config ids.
- `acp-reuse-keys.ts:42-47` shows every key is `configId\0cwd[\0project\0projectId]`.
- `shared-state.ts:991` (and `:749`, `:763-766`, `helpers.ts:1811`) are the only writers, and all use `agentReuseKey`/`detachedReuseKey`.
- `types.ts:422-428` documents the map as keyed by `agentReuseKey(configId, cwd, projectId)`.
- Consequence: lines 48-55 are unreachable in effect, so line 57 (`any live agent`) is what always decides.
- The unit tests pass only because their fixtures use the impossible bare-key shape (`agent-selection.test.ts:22,31-34`).

**Evidence against:** none found. I could not find a single production write of a bare config id into this map.

**Proposed fix (two parts, both needed):**

1. Resolve by *parsed key*, not by literal lookup. Add a helper next to `parseReuseKey` that finds the live agent for a config id, preferring the current project/cwd:

```ts
// lib/generator/agent-selection.ts
function liveForConfig(live: Record<string, string>, configId: string, cwd?: string): string | null {
  let fallback: string | null = null
  for (const [key, agentId] of Object.entries(live)) {
    if (configIdFromReuseKey(key) !== configId) continue
    const parsed = parseReuseKey(key)
    if (cwd && parsed.cwd === cwd.trim()) return agentId
    fallback ??= agentId
  }
  return fallback
}
```

   and use `pick(liveForConfig(live, selected, cwd))` / `pick(liveForConfig(live, CLAUDE_AGENT_CONFIG_ID, cwd))`. `configIdFromReuseKey` (`acp-reuse-keys.ts:50-53`) already exists for exactly this and is documented as safe because "configId never contains `\0`".

2. Thread the real identity through. `startGeneratorGateway` already knows `options.cwd`; `GeneratorCall` already carries `agentId` and `sessionId`. Make the resolver take them:

```ts
// generator-gateway.ts
agentId: (call) => resolveGeneratorAgent(call.sessionId, { cwd: options.cwd, agentId: call.agentId })?.id ?? null
```

   `call.agentId` is the *authoritative* answer — it is the agent that is literally executing the tool call — so it should be step 0, ahead of everything else. `resolveGeneratorAgent` already accepts `sessionId` and uses `sessions[sessionId].agentId` (`:44-46`); it is simply never called with it.

3. Change the fixtures to `agentReuseKey(CLAUDE_AGENT_CONFIG_ID, '/work')` so the suite would have caught this, and add a regression test that the selected config wins over an earlier-inserted OpenCode entry.

4. Consider deleting the wildcard fallback (`:57`) or demoting it behind an explicit "no selection, nothing live" log. A silent wildcard is what turned a lookup bug into a wrong-harness turn.

#### A2 — `ephemeral: true` is Termul-local, so generator sessions persist in the agent's own session list. **Confidence: very high. PROVED (mechanism); titles GUESS.**

**Evidence for:**
- `acp-brain-transport.ts:59-62` sets `ephemeral: true, promotable: false`.
- `command_loop.rs:155-165` builds `NewSessionRequest` from cwd + mcp_servers + additional_directories + `_meta` only — no ephemeral field.
- `command_loop.rs:207-211` shows `ephemeral` guards only Termul's own `persistence.register_session`; `:239-245` shows it sets a Termul-local mark (`session.rs:414-421`).
- `cwd` is the RobloxKit project (`WorkspaceLayout.tsx:86`), so the agent files the session under that project.
- Session-per-turn (`acp-brain-transport.ts:59` inside `send()`) explains *multiple* entries per generation.

**Evidence against:** none for the mechanism. The exact title text is my inference from OpenCode's auto-titling plus the generator's first message (`generate-clothing.ts:84-97`); I could not read `opencode.db` (locked, ~9.9 GB).

**Proposed fix (ranked by strength):**

- **Best: stop creating a session per turn.** Open one session per *generation* (or per chat+engine), and send subsequent turns on it. This is what the module's own docstring claims ("opens its own ACP session, scoped to the engine, sends one prompt … and closes the session" — `acp-brain-transport.ts:4-8`) but not what the code does. One generation then leaks one session instead of N. It also removes N session-create round trips from a 5-minute operation.
- **Then: dispose instead of close.** `acpCloseSession` (`acp-api.ts:1138-1145`) only closes; the host has `AcpCommand::DisposeEphemeralSession` (`command_loop.rs:967`) reachable as `acpDisposeEphemeralSession` (`acp-api.ts:1147-1156`) and already used by the warm pool. Use it for generator sessions so the agent is asked to drop the session, not merely end it.
- **Also: name the session.** Since the agent will title it from the first message regardless, give it a predictable, honest title (e.g. via the engine scope) so a leak is identifiable rather than looking like user work.
- **Do not** simply switch to a temp `cwd`: that would move the sessions to a different project bucket in the agent's UI and break `session-context` assumptions, without solving the persistence.

#### A3 — The wildcard fallback is unsafe by construction. **Confidence: high. PROVED as code, GUESS as the specific reason OpenCode won.**

**Evidence for:** `agent-selection.ts:57` — `pick(Object.values(live).find((id) => !!id))` — depends on object insertion order, which depends on which agent happened to spawn first (warm pool, previously opened chat). Nothing checks that the result matches any user intent.

**Evidence against:** I cannot prove OpenCode was inserted before Claude in that particular session — the store is in-memory in a renderer I cannot inspect post hoc. But with A1 making lines 48-55 dead, *some* wrong pick was inevitable, and OpenCode is the only other live agent that would produce the reported symptom.

**Proposed fix:** fold into A1.4 — make the last resort explicit and logged (`"generator: no agent for the selected config; falling back to <id>"`), or fail with the existing clear error (`acp-brain-transport.ts:53-57`) instead of guessing.

#### A4 — The generator deliberately ignores the calling chat's agent. **Confidence: very high. PROVED.**

**Evidence for:** `GeneratorCall` carries `agentId` and `sessionId` (`generator-gateway-client.ts:23-31`, populated at `parent/generator.rs:79-85`); `gateway-handler.ts:74-132` never reads either; `generator-gateway.ts:47` calls `resolveGeneratorAgent()` bare. So `resolveGeneratorAgent`'s first and best branch is dead.

**Proposed fix:** pass them (A1.2). This is the smallest, highest-value change in the whole bug: it makes "the generator runs on the agent that is executing the tool call" true by construction, and makes the selection question moot for the common case.

---

### BUG B

#### B1 — The model is told `image` is a base64 field; the child strips it. **Confidence: very high. PROVED.**

**Evidence for:**
- `generator_tools.rs:166-168` promises "`image` is a `data:image/png;base64` URL you can show".
- `child.rs:284-287` does `fields.remove("image")` before serialising the text block.
- The observed JSON keys are `status, taskId, stage, design, summary, report, layout` — no `image`.
- The model's reasoning in the screenshot is the direct consequence ("guessed the result contained base64 data … I can't easily access the base64 in a file").

**Evidence against:** none. This is a plain description/code mismatch.

**Proposed fix:** make the description describe what the model actually gets, and give it the missing handle. Concretely, in `task_tool()`:

- say the render arrives as an **image content block**, and that the JSON carries `design`, `report`, `layout` (not `image`);
- drop "Nothing is written to disk, so do not search the filesystem for an output file" or soften it to "Termul writes no file; your client may materialise the image block, and that path is not a supported input" — because the current sentence is false under Claude Code and actively misleads;
- add the one sentence that would have saved the five minutes: **"To put this garment in the place, the image must be reachable over http(s): the Roblox Studio `upload_image` tool accepts only http/https URLs, not local paths. Ask the user to upload it, or use a Termul-provided URL if one is present."**

#### B2 — `get_task_result` does not exist. **Confidence: very high. PROVED.**

**Evidence for:** the string occurs once in the repo, at `generate-clothing.ts:78`. The real tool is `get_clothing_task` (`generator_tools.rs:162-163`). The e2e test asserts the wrong name (`e2e-clothing.test.ts:123`), which is why it survived.

**Proposed fix:** build the note from the tool name rather than hard-coding it — `ACCEPTED_NOTE` should be a function of the engine, e.g. `` `… call get_${engine}_task with this task_id.` `` — and fix the test to assert `get_clothing_task`.

#### B3 — Termul provides no route from a rendered artifact to a Roblox asset. **Confidence: high. PROVED for "no tool"; GUESS for the best remedy.**

**Evidence for:** no upload/asset tool anywhere in `host_mcp` (only the `upload_image` *name* inside the other server's description, `roblox/instructions.rs:20`); `upload_image` requires http/https (transcript line 118); Termul's loopback servers (`canvas/static_server.rs:4`) serve only the canvas bundle.

**Evidence against:** nothing in Termul is *broken* here — the missing piece is a capability, not a defect. That is why this is ranked below B1/B2: the agent's failure was driven by misinformation first, missing capability second.

**Proposed fix (pick one; I'd do 1 + 2):**

1. **Cheapest and honest:** ship no new tool, but make the workflow legible (B1.3). The agent then tells the user "upload this PNG in Studio" instead of spending five minutes inventing an HTTP server. The transcript shows the upload *did* eventually succeed via `http://localhost:8765/…` → `rbxassetid://81011940726608`, so a documented path is enough to complete the task.
2. **Best experience:** have the clothing engine write the PNG to a deterministic path inside the project (e.g. `<cwd>/.termul/generated/<taskId>.png`) and return that path in the JSON as `file`, plus serve it from the existing loopback listener at a tokenised URL returned as `url`. Then `upload_image([url], studio_id)` works with no improvisation. This requires a small addition to `canvas/static_server.rs` or a sibling listener, and it contradicts the current "writes nothing to disk" stance — so the docs and the `generator_tools.rs:169` sentence must change with it.
3. **Most complete:** a first-class `upload_asset` tool on Termul's host MCP that takes a `task_id` and calls the Studio MCP itself. This is the largest change and crosses the MCP boundary; not recommended as a first step.

#### B4 — The `layout`/`report` payload gives the model no Roblox next step, so it guessed the instance model. **Confidence: medium. PROVED that the payload is silent; GUESS on how much it cost.**

**Evidence for:** `build.ts:83-96` returns `report` (size/coverage/colours) and `layout` (region list) only — no mention of `ShirtTemplate`, asset ids, `Shirt` vs `Decal`, or where a `Shirt` belongs. `GENERATOR_GUIDE` (`generator_tools.rs:33-46`) says the tools "produce the artifact and hand it back" and forbids writing files, but says nothing about installing the artifact. The transcript shows the model reasoning aloud about Shirt vs Decal vs ShirtTemplate and StarterPack vs StarterPlayer > StarterCharacterScripts, then trying `start_stop_play` + `screen_capture` and looping on a blank screenshot.

**Evidence against:** the model did reach a working answer (`execute_luau` creating a `Shirt` with `ShirtTemplate = "rbxassetid://81011940726608"` in `StarterPack`, then applying it to the character at runtime — transcript lines 134, 153, 155). So the gap cost time, not correctness. Its confusion is partly a genuine Roblox modelling question, not purely a Termul defect.

**Proposed fix:** add two or three sentences to `GENERATOR_GUIDE` naming the completion step for clothing — "a clothing PNG becomes a `Shirt` (or `Pants`) instance whose `ShirtTemplate` is `rbxassetid://<id>`; the upload must be an http(s) URL; verify with `get_studio_state`/`screen_capture` after a play test". Cheap, and it targets the exact loop the screenshot shows.

---

## 6. What is proved vs guessed — one table

| Claim | Status |
|---|---|
| `resolveGeneratorAgent` indexes `configToLiveAgent` with a bare config id | PROVED — `agent-selection.ts:48-55` |
| Production keys are `configId\0cwd[\0project\0projectId]` | PROVED — `acp-reuse-keys.ts:42-47`, `shared-state.ts:881-883,991` |
| Therefore steps 2 and 3 never match; line 57 always decides | PROVED (follows from the two above) |
| `sessionId` is never passed to the resolver | PROVED — `generator-gateway.ts:47` |
| `call.agentId` / `call.sessionId` are delivered but unused | PROVED — `generator-gateway-client.ts:23-31`, no reader in `gateway-handler.ts` |
| Unit tests only pass because they use bare-key fixtures | PROVED — `agent-selection.test.ts:22,31-34` |
| Brain session `cwd` is the active project (RobloxKit), not Termul | PROVED — `WorkspaceLayout.tsx:86` → `generator-gateway.ts:62` |
| `ephemeral` never reaches the agent; ACP has no such field | PROVED — `command_loop.rs:155-165,207-211,239-245` |
| One generation creates several agent-side sessions | PROVED — session created inside `send()`, `loop.ts` multi-turn |
| OpenCode's list entries are titled "Roblox … design fix" by OpenCode | GUESS (mechanism proved; title string inferred) |
| The generator spawns OpenCode regardless of selection | **REFUTED** — it only reuses an already-live agent |
| The `mcp-termul-blob-*.png` is written by Termul | **REFUTED** — no such code; it is Claude Code's tool-result blob |
| The poll JSON the model sees has no `image` key | PROVED — `child.rs:284-287` + transcript keys |
| `task_tool()` promises `image` as a base64 field | PROVED — `generator_tools.rs:166-168` |
| `get_task_result` is not a real tool | PROVED — single occurrence, `generate-clothing.ts:78` |
| Termul has no upload/asset tool | PROVED — one `upload` hit, and it is the other server's tool list |
| `upload_image` requires http/https | PROVED — transcript line 118 error string |
| Termul serves no artifact over HTTP | PROVED — `canvas/static_server.rs` serves only the canvas bundle |

---

## 7. Suggested order of work

1. **A1.2 + A4** — pass `call.agentId` into the resolver and use it as step 0. Smallest change, fixes the reported symptom by construction.
2. **A1.1 + A1.3** — fix the key lookup with `configIdFromReuseKey`, and stop the silent wildcard. Fix the fixtures so the suite covers the real key shape.
3. **B2** — derive the poll tool name from the engine; fix the e2e assertion.
4. **B1** — rewrite `task_tool()`'s description to match `child.rs`, and add the http(s) sentence.
5. **A2** — one session per generation, disposed via `acpDisposeEphemeralSession`.
6. **B3 / B4** — decide between "document the manual upload" and "write + serve the artifact"; either way update `GENERATOR_GUIDE`.

Steps 1-4 are small, independently testable, and cover the reported symptoms. Steps 5-6 remove the leaks and the remaining dead ends.
