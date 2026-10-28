# 09 — VERIFIED: the `_meta` path that survives, and the mechanism order

> Written at the start of execution, resolving the open question that
> `08-correction-alwaysLoad.md` flagged as "the single highest-value thing to verify".
> Read against the **actually installed** adapter, not a guess.

---

## The question 08 left open

> "The open question is only whether the ACP adapter forwards `_meta` from an
> `mcpServers` entry into the SDK's server config. The adapter builds the server map
> at `acp-agent.js:8520-8528` from `{type, command, args, env}` only — `_meta` is
> **not** visible in that construction. So either the adapter drops it, or it is
> forwarded elsewhere. **This is now the single highest-value thing to verify** — it
> decides between a ~20-line change and a ~250-line proxy."

**Answer: both halves are true, and the resolution is better than either option 08 listed.**

---

## Evidence (installed files, verified on this machine)

Adapter: `@agentclientprotocol/claude-agent-acp@0.95.0`
at `%APPDATA%\com.termul-manager.app\acp-registry-binaries\claude-acp\node_modules\@agentclientprotocol\claude-agent-acp\dist\acp-agent.js` (634,155 bytes, 10,883 lines).

SDK: `@anthropic-ai/claude-agent-sdk@0.3.309`.

### Fact 1 — the ACP `mcpServers` entry DOES drop everything but four fields

`acp-agent.js:8518-8528`:

```js
else if (!("type" in server)) {
    // Stdio type MCP server (with or without explicit type field)
    mcpServers[server.name] = {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: server.env
            ? Object.fromEntries(server.env.map((e) => [e.name, e.value]))
            : undefined,
    };
}
```

So `08` Correction 2's suspicion is confirmed: **you cannot put `alwaysLoad` on the
ACP `mcpServers` array entry.** It is silently discarded there. Option 1 as 08
described it ("`_meta.alwaysLoad` on the `roblox-studio` **server** entry in
`session/new`") **cannot work through the ACP array.**

### Fact 2 — but `_meta.claudeCode.options.mcpServers` is spread in UNFILTERED

`acp-agent.js:8570` and `:8699-8702`:

```js
const userProvidedOptions = sessionMeta?.claudeCode?.options;
...
mcpServers: {
    ...(userProvidedOptions?.mcpServers || {}),
    ...mcpServers,
},
```

`userProvidedOptions` is the raw object from `_meta.claudeCode.options` — no
projection, no whitelist. Whatever the client puts under
`_meta.claudeCode.options.mcpServers` is spread straight into the SDK's
`mcpServers` option. **This is the surviving path.**

### Fact 3 — the SDK type accepts `alwaysLoad` on a stdio server

`sdk.d.ts:1369-1383`:

```ts
export declare type McpStdioServerConfig = {
    type?: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    timeout?: number;
    /**
     * When true, all tools from this server are always included in the prompt and
     * never deferred behind tool search, except a tool the server itself lists with
     * _meta anthropic/alwaysLoad set to false. Equivalent to setting
     * defer_loading: false on the API. When false, all tools from this server are
     * deferred behind tool search. Default: tools are deferred when tool search is
     * enabled. As a side effect, true also blocks startup until the server is
     * connected (capped at the standard 5s connect timeout) ...
     */
    alwaysLoad?: boolean;
};
```

`McpServerConfig` is the union `McpStdioServerConfig | McpSSEServerConfig |
McpHttpServerConfig | McpSdkServerConfigWithInstance` (`sdk.d.ts:1247`), and
`QueryOptions.mcpServers?: Record<string, McpServerConfig>` (`sdk.d.ts:1994`). So a
stdio entry carrying `alwaysLoad: true` is type-legal on the exact field the adapter
spreads.

### Fact 4 — ORDER MATTERS: the ACP array wins over `_meta`

Because `...mcpServers` (the ACP-derived map) is spread **after**
`...(userProvidedOptions?.mcpServers || {})`, an entry present in BOTH is overwritten
by the ACP one — i.e. by the filtered, `alwaysLoad`-less copy.

**Consequence:** the `_meta` entry only works if the server is **removed from the ACP
`mcpServers` array** for that session and carried **only** in
`_meta.claudeCode.options.mcpServers`. Sending it in both places silently reverts to
the broken behaviour. This is the single most likely way to ship a no-op fix.

### Fact 5 — Termul currently sends `_meta` only for thinking

`src-tauri/src/acp/manager/gates.rs:486-495` emits exactly
`{"claudeCode":{"options":{"thinking":{...}}}}`, and
`src-tauri/src/acp/manager/command_loop.rs:155,387,478` attach it. There is no
`mcpServers` key anywhere in `src-tauri` today (verified: zero hits for `"mcpServers"`).
So the change is additive and confined to the one existing builder.

---

## What this changes in the plan

`08` proposed a 5-row option table. Facts 1-4 collapse it to **one cheapest option
that is strictly better than 08's Option 2 and 3**, because it is *targeted*: it
forces eager load for the Roblox server only, instead of disabling deferral
globally.

| # | Mechanism | Cost | Blast radius | Status |
|---|---|---|---|---|
| **A′** | `_meta.claudeCode.options.mcpServers["roblox-studio"].alwaysLoad = true`, and drop that server from the ACP array for the session | ~20 lines, no new process | Roblox server only | **test first** |
| B | `ENABLE_TOOL_SEARCH=100` env | ~1 line | **all** MCP servers, ~14k extra tokens of Roblox schemas always resident | fallback |
| C | `_meta.systemPrompt.append` | ~30 lines, adapter-specific | does not fix deferral at all — only nudges toward ToolSearch | fallback / safety net |
| D | Proxy re-publishing tools with per-tool `_meta["anthropic/alwaysLoad"]` | ~250 lines | new process per session | last resort |

A′ beats B because B disables the threshold for every server (33 `termul` + 15
`roblox-mcp` + 15 built-ins also become eager), which `06` measured at ~13,919 tokens
for Roblox alone. A′ loads only the 28 Roblox tools.

A′ beats C because C does not make tools callable; it only tells the model to call
`ToolSearch`. C survives as the always-on safety-net sentence regardless of winner.

**Correction to `08`:** 08's Option 1 as written is dead (Fact 1). The same idea works
only via `claudeCode.options.mcpServers` (Fact 2) *and* only with the ACP array entry
removed (Fact 4). 08 said "~20 lines, no new process" — that number holds, but the
placement it named was wrong.

---

## Still unverified (must be measured, not assumed)

1. Whether `claude.exe` honours `alwaysLoad: true` arriving through
   `--mcp-config` / the SDK's `mcpServers` option. Facts 2-3 prove the value
   *arrives*; they do not prove the CLI *acts* on it. **This is what the probe tests.**
2. Whether the 5s startup block that `alwaysLoad: true` triggers is acceptable when
   Studio is closed (it would delay session start by up to 5s, once).
3. Whether `alwaysLoad` on a stdio entry is accepted by the CLI's config validator
   (it may warn on unknown keys, or reject the file).
4. Token cost of 28 eager Roblox schemas (~13,919 tokens per `06`) — accepted as the
   price of correctness, but it must be stated in the evidence, not discovered later.

---

## Honest status

`08` was right that the plan was not ready to execute. It was wrong about *where* the
cheap fix lives. The probe in todo 1 is rewritten to test A′ first, and it now also
asserts the ordering trap from Fact 4, because a probe that sends the entry in both
places would report DOES NOT WORK for the wrong reason — the exact failure mode `08`
Correction 1 warned about.
