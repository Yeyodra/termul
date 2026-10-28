# 03 — Renderer surface

Every claim cites `file:line`. UNKNOWN where unverified.

> Note: the renderer deep-dive subagent was cancelled mid-run, so this report is
> thinner than 01/02 and is based on my own targeted greps. Items I could not
> verify are marked explicitly.

## 1. The MCP registry slice — this is where a Studio server would live

`src/renderer/stores/acp-store/slices/mcp.ts`.

State + actions exposed (`mcp.ts:40-62`):

| Group | Members |
|---|---|
| State | `mcpServers`, `mcpServersLoaded`, `mcpProbeStatus`, `mcpOAuthConnecting`, `mcpOAuthConnected`, `mcpTools`, `mcpToolsLoaded`, `mcpProbing`, `mcpProbeError` |
| Actions | `loadMcpServers`, `saveMcpServer`, `importMcpServers`, `setMcpServerEnabled`, `deleteMcpServer`, `syncMcpRegistryToProjectFile`, `probeMcpServer`, `loadMcpTools`, `connectMcpOAuth`, `checkMcpOAuthStatus`, `disconnectMcpOAuth` |

Mutations are serialized through a promise queue (`mcp.ts:19-38`). The comment
explains why and it is a real hazard worth preserving:

> "Without this, two overlapping mutations each snapshot `mcpServers` before their
> async disk write; the slower one would persist a stale snapshot AFTER the newer
> mutation (clobbering it)"

So any Studio-server mutation must go through `runSerializedMcpRegistryMutation`
(`mcp.ts:33-38`), not a direct `set()`.

Probing is automatic after a save: `if (server.enabled !== false) void get().probeMcpServer(server.id)`
(`mcp.ts:171`). Enabled defaults to `true` (`mcp.ts:207`).

## 2. Persistence types

`src/renderer/lib/acp-mcp-persistence.ts`:

| Item | Line |
|---|---|
| `McpTransport = 'stdio' \| 'http' \| 'sse'` | `:9` |
| `StoredMcpServer = McpServerConfig & { id; enabled? }` | `:11` |
| `McpValidation`, `SkippedMcpServer`, `McpServerSelection` | `:13, 18, 24` |
| `transportOf()` — defaults to `'stdio'` | `:30-31` |
| Validation (stdio requires non-empty `command`) | `:37-56` |
| `toWireServer()` — fills `args: []`, `env: []`, `headers: []` | `:58-78` |
| `normalizeStoredServer()` — rejects malformed entries | `:93-99` |

The wire conversion is the important bit: the ACP schema **requires** `args` and
`env` on stdio, so they are always emitted even when empty (`:60-66`).

## 3. Settings UI

`src/renderer/components/settings/McpServersSettings.tsx`:

| Feature | Line |
|---|---|
| Add/edit dialog | `:555` |
| Accepts a Claude Desktop `{"mcpServers": {...}}` wrapper on paste | `:173`, placeholder `:571` |
| Transport badge shown per server | `:382` |
| Description: "Add a stdio, HTTP, or SSE server. New agent chats can then use its tools." | `:328` |
| stdio rows show `command`, remote rows show `url` | `:347-349` |
| Edit mode splits stdio vs http/sse shapes | `:70-90` |
| Probe failure surfaced as a status dot, never a crash | `:131` |

**This UI already accepts a Studio server.** A user can paste:

```json
{ "mcpServers": { "roblox-studio": {
    "command": "C:\\Users\\<you>\\AppData\\Local\\Roblox\\Versions\\version-7aaa6838d36c4448\\StudioMCP.exe",
    "args": []
} } }
```

Note the path contains a **version directory** that changes when Roblox updates —
that is exactly why exe auto-discovery is a real deliverable, not a nicety.

## 4. Tool calls in the chat

| Item | Location |
|---|---|
| `ToolCall` type | `src/renderer/lib/acp-api.ts:187` (fields incl. `title?` `:189`) |
| `ToolCallUpdate` type | `acp-api.ts:238` (`title?` `:240`) |
| Per-session tool-call state | `src/renderer/stores/acp-store/shared-state.ts:184` — `toolCalls: Record<SessionId, ToolCall[]>` |
| Replay dedup comment (covered tool_call/tool_call_update) | `shared-state.ts:127` |
| Related tests | `tool-call-stamps.test.ts`, `subagent-transcript.test.ts`, `replay-dedup.test.ts` |

There is also a chat-level MCP indicator: `src/renderer/components/chat/McpBadge.tsx`
(+ `McpBadge.test.tsx`).

## 5. Important negative result: no `mcp__` prefix handling

Grep for `mcp__` across `src/renderer/` → **no matches**.

This differs from the RobloxKit clone, whose frontend stripped
`mcp__robloxkit__` before display (`app/dist/index.html:297-304`). Termul instead
uses the ACP-provided `title` / `name` on the tool call.

Consequence: if Studio tools arrive as `mcp__roblox-studio__execute_luau`, the UI
may show the raw prefixed name. Whether that is acceptable is a design decision;
it is **not** currently normalized anywhere in the renderer.

## 6. The `@` mention and slash-command surface

`ChatInputBar.tsx`, `AgentChatPanel.tsx`, `ComposerAddSheet.tsx` all reference
`mcpServers` (per grep). The composer appears to surface MCP context. **UNKNOWN**:
the exact semantics — whether it lists attached servers, or lets a user toggle a
server per message. Needs a dedicated read before building UI that assumes either.

## 7. Parity checklist — a hard gate on new backend capabilities

`src/renderer/lib/__tests__/parity-checklist.test.ts`.

It iterates P0 (`:234`) and P1 (`:280`) domain lists and asserts, per domain:

1. the Tauri adapter file exists and exports a factory (`:237-246`)
2. `api.ts` exports from that Tauri adapter (`:264-271`, `:310`)
3. a test file exists at the declared path (`:271-272`, `:317`)

There is also a regression guard: "Session API uses Tauri-only export pattern"
(`:333`).

**What this means for implementation:** adding a new renderer-callable backend
domain means satisfying all three assertions, plus AGENTS.md's requirement that
the Tauri **and** web transports both work (`AGENTS.md:27`). A Studio panel that
only works on desktop would need explicit `isTauriContext()` gating and a test for
the unsupported state (`AGENTS.md:27`).

## 8. What a Studio panel would need (derived, not specified)

For a status panel showing connected Studio instances / current place:

| Need | Exists? |
|---|---|
| Backend command to report status | No — would be new |
| Renderer API wrapper (`api.ts` + adapter + test) | Pattern exists, entry is new |
| Event to push status changes | Pattern exists (`acp:*` events, `EventSink`) |
| Panel slot in the workspace | Yes — `BrowserPanel`, `GitPanel`, `EditorPanel` are precedents |

But note: for **Phase 1** none of this is needed. The agent reaches Studio tools
through the registry, and the chat already renders tool calls.

## 9. Residual unknowns

- Whether `selectMcpServersForAgent` drops unsupported servers silently or reports
  them via `skipped` — the return type has `skipped`, the predicate was not read.
- Whether the registry is global or per-project, and the precedence between the
  store and the project-file mirror (`syncMcpRegistryToProjectFile`, `mcp.ts:56`,
  `activeProjectId()` `mcp.ts:29-31`).
- Exact `ComposerAddSheet` / `McpBadge` behaviour (see §6).
- The full P0/P1 domain list in the parity checklist.
