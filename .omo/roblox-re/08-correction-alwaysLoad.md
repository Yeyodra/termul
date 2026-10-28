# 08 — CORRECTION: the plan's core assumption was wrong

> Written by the planner mid-review, after reading the actual SDK/adapter sources.
> This supersedes `.omo/plans/robloxkit-mcp-proxy.md` as written and must be folded
> into the plan before any execution.

---

## What I got wrong

The plan bet on **per-tool `_meta.always_load`**. That is not the documented
mechanism, and a much cheaper server-level switch exists.

### The real mechanism (authoritative, from the SDK's own type definitions)

`...\node_modules\@anthropic-ai\claude-agent-sdk\sdk.d.ts:646-653`:

```ts
/**
 * When true, all tools from this server are always included in the prompt
 * and never deferred behind tool search. Applied via
 * `_meta['anthropic/alwaysLoad']` on each tool. Equivalent to
 * `defer_loading: false` on the API. Per-tool `tool({ alwaysLoad })` still
 * works and is OR'd with this.
 */
alwaysLoad?: boolean;
```

And on the MCP server config, `sdk.d.ts:1216` / `:1363` / `:1379`:

```ts
/**
 * When true, all tools from this server are always included in the prompt and
 * never deferred behind tool search, except a tool the server itself lists with
 * _meta anthropic/alwaysLoad set to false. Equivalent to setting
 * defer_loading: false on the API. When false, all tools from this server are
 * deferred behind tool search. Default: tools are deferred when tool search is
 * enabled. As a side effect, true also blocks startup until the server is
 * connected (capped at the standard 5s connect timeout) even though MCP startup
 * is otherwise non-blocking by default, since the tools must be present when the
 * turn-1 prompt is built.
 */
alwaysLoad?: boolean;
```

Three corrections follow.

### Correction 1 — the key name is namespaced

The per-tool key is **`_meta['anthropic/alwaysLoad']`**, not `_meta.always_load`.
The bare `always_load` / `alwaysLoad` strings I found in `claude.exe` were the
*snake_case/camelCase field names of the internal struct*, not the wire key. Sending
`always_load` would very likely have been silently ignored — and the plan's todo 1
would have reported DOES NOT WORK for the wrong reason.

### Correction 2 — there is a SERVER-level switch, so no proxy is needed

`alwaysLoad` is settable on the **MCP server config**, and it is OR'd with per-tool
flags. The ACP adapter already passes `_meta` through to the SDK.

So the entire proxy could be unnecessary: if the ACP `mcpServers` entry for
`roblox-studio` can carry `_meta: {"alwaysLoad": true}` (or the adapter's
`anthropic/alwaysLoad` form), Claude loads all 28 tools eagerly with **zero new
process, zero re-publishing, zero tool-name plumbing**.

The open question is only whether the ACP adapter forwards `_meta` from an
`mcpServers` entry into the SDK's server config. The adapter builds the server map at
`acp-agent.js:8520-8528` from `{type, command, args, env}` only — `_meta` is **not**
visible in that construction. So either the adapter drops it, or it is forwarded
elsewhere. **This is now the single highest-value thing to verify** — it decides
between a ~20-line change and a ~250-line proxy.

### Correction 3 — `ENABLE_TOOL_SEARCH` is a percentage, and there is a 4th option

Decoded earlier: `ENABLE_TOOL_SEARCH` is read as a **number = percent of the context
window** (default `10`), and `hfr = 2.5` scales a char-based fallback. Setting it high
pushes the threshold past 100%, so `deferredTokens >= threshold` can never be true.

---

## Two more findings that change the plan

### Finding A — Termul CAN send a real system prompt, but does not

`acp-agent.js:8535-8555`:

```js
if (params._meta?.systemPrompt) {
  const customPrompt = params._meta.systemPrompt;
  if (typeof customPrompt === "string") { systemPrompt = customPrompt; }
  else if (typeof customPrompt === "object" && ...) {
    systemPrompt = { ...customPrompt, type: "preset", preset: "claude_code" };
  }
}
if (clientPrompt) systemPrompt = sdkSystemPrompt(clientPrompt, customInstructions);
```

So `session/new` `_meta.systemPrompt` (string, or an object with `append`) reaches the
model as the system prompt. `sdk.d.ts:1216` also notes `alwaysLoad: true` blocks
startup until the MCP server connects (capped at 5s) — which is exactly what makes
turn-1 reliable.

Termul currently sends only `_meta.claudeCode.options.thinking`. A Roblox
`append` here would be a **stronger** channel than MCP `instructions`, because it
cannot be missed.

**Caveat:** `_meta.systemPrompt` is an adapter extension, not portable ACP. Using it
would be a per-agent behaviour — the thing the user explicitly did not want. So it is
a documented fallback, not the primary design.

### Finding B — the plan's "non-fatal" analysis was right but incomplete

Reading `manager/mod.rs:1034-1096` and `:1204-1235` confirms:

- `build_internal_plan_stdio` is a **pure config builder** — it spawns nothing, so it
  cannot fail. A `robloxkit` equivalent is equally safe *if it is also a pure builder*.
- The real failure points on both the create and reopen paths are
  `inject_oauth_tokens` (infallible) and `gate_mcp_servers` (`Result`). Since
  `McpServer::Stdio(_) => {}` passes unconditionally (`gates.rs:43`), a stdio proxy
  entry **cannot** fail the gate.
- `prepare_reopen_mcp` has the same shape, with an extra `unregister_by_token` on
  failure (`:1226`) — a reopen-path detail the plan's todo 9/10 must mirror.

So the blast-radius risk is **lower** than I feared: a stdio-only proxy is
structurally incapable of failing a session. The plan's todo 10 is still worth
keeping as a regression test, but it is not the load-bearing risk.

---

## Revised approach, cheapest first

| # | Option | Cost | Status |
|---|---|---|---|
| 1 | `_meta.alwaysLoad` on the `roblox-studio` **server** entry in `session/new` | ~20 lines, no new process | **test this first** |
| 2 | `ENABLE_TOOL_SEARCH=100` env var on the agent | ~1 line | fallback |
| 3 | `_meta.systemPrompt.append` with the Roblox text | ~30 lines, adapter-specific | fallback, non-portable |
| 4 | Proxy re-publishing tools with `_meta['anthropic/alwaysLoad']` per tool | ~250 lines | only if 1-3 all fail |
| 5 | Instruction line: "call ToolSearch first" | 1 sentence | always-on safety net |

Option 1 is now the plan's Phase 0. Option 4 — the whole proxy — becomes the
last resort, not the centrepiece.

---

## What must change in the plan

- **Todo 1** rewritten: probe option 1 (server-level `_meta`) FIRST, and verify
  whether the adapter forwards `_meta` from an `mcpServers` entry
  (`acp-agent.js:8520-8528` is the suspicious site). Only if it drops it, fall
  through to option 2, then 3.
- **Todos 4-8, 11** (the proxy core) become **conditional**: they are only built if
  Phase 0 proves options 1-3 all fail. They stay in the plan as a documented
  contingent branch, not as scheduled work.
- **Todo 5** corrected regardless: if a proxy is ever built, the key is
  `_meta["anthropic/alwaysLoad"]`, not `always_load`.
- **Todo 6** (instructions) survives unchanged — it is cheap and orthogonal.
- **New todo**: add the "call ToolSearch before concluding a tool is unavailable"
  line, which costs nothing and works on any path.

## Honest status

The plan as written is **not ready to execute**. Its central bet was on the wrong key
name and skipped a cheaper mechanism. I am recording this before the reviewers report
so the correction is not retrofitted to look obvious.
