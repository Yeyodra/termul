# Task 2 — Does `_meta.systemPrompt.append` reach the model-facing system prompt?

**Date:** 2026-10-26
**Verdict (i) CHANNEL — the point of this task:** **WORKS (structural).**
**Verdict (ii) DEFERRAL — informational only, todo 1 already answered it:** **DOES NOT SUPPRESS DEFERRAL.**

Evidence type: **structural.** The marker was found literally inside the `system` parameter of the
API request Claude Code actually sent — not inferred from behaviour.

This is a **research-only** deliverable. No product change, no commit, nothing under `src/` or
`src-tauri/` was touched.

---

## 1. TL;DR for the planner

`_meta.systemPrompt = { append: "<text>" }` **does reach the model-facing system prompt**, and it
arrives **additively** — Claude Code's entire preset prompt survives intact and the append text is
tacked on at the end of the second system block.

**The plan's todo 5 and todo 7 are unblocked.** The instruction carrier is real.

Four findings the planner needs:

1. **The channel works, structurally proven.** The 266-char append appears verbatim as the tail of
   `system[1]` in the first request's `system` array. `sp_none` (identical `_meta`, key omitted)
   does not contain it, and the marker exists in no ambient config file. So it is not ambient.
2. **`append` and `alwaysLoad` coexist in the same `_meta` without clobbering each other.** Both
   took effect in the same session: the marker was in the prompt **and** the probe tools were
   eagerly loaded. This was the real integration risk and it is cleared.
3. **The bare-string form is a full replacement and is genuinely dangerous.** `sp_string` reduced
   the system prompt from **5,774 chars to 170 chars** — all of `# Harness`, `# Memory`,
   `# Environment`, `# Context management`, the safety paragraph, and the pronoun guidance were
   **gone**. `append` is not merely tidier; the string form silently deletes the agent's operating
   instructions.
4. **`append` does NOT suppress deferral — and that is fine.** With `append` present but
   `alwaysLoad:false` (`sp_append_noload`), the probe tools were **still deferred**
   (`addedNames=31`, both probe names listed, 14-tool request with zero probe schemas). The append
   only nudges the model toward `ToolSearch`; it never makes a tool callable. **Never treat the
   append as a deferral fix.**

---

## 2. Question (i) — the CHANNEL: **WORKS (structural)**

### 2.1 The verbatim marker

```
ROBLOX_CHANNEL_PROBE_7f3a9c
```

Full appended text as sent (`_meta.systemPrompt.append`), 266 chars:

```
ROBLOX_CHANNEL_PROBE_7f3a9c: When the Roblox Studio tools are available (probe_alpha_tool, probe_beta_tool), prefer calling them over writing .lua files. This sentence exists only to prove the _meta.systemPrompt.append channel reaches the model-facing system prompt.
```

### 2.2 Where it was found — exact JSON path

**Path:** `api-request-shape` → `shape.system[1].text` (tail), in the session transcript
`~/.claude/projects/C--Users-Novella-AppData-Local-Temp-probe-sp-append-20a5536d-.../<sessionId>.jsonl`.

`sp_append`, block layout of the request's `system` array:

| block | chars | contains marker | starts with |
|---|---|---|---|
| `system[0]` | 94 | **false** | `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.` |
| `system[1]` | 5981 | **true** | `\nYou are an agent working with the user toward their goals, ...` |

Quoted excerpt (from `analysis.json` → `systemPromptEvidence.markerContext.excerpt`, truncated with
an explicit marker):

```
...<truncated 5390 chars>...text window so work can continue — you don't need to wrap up early or hand off mid-task.

When you have enough information to act, act. Do not re-derive facts already established in the conversation, re-litigate a decision the user has already made, or narrate options you will not pursue. If you are weighing a choice, give a recommendation, not an exhaustive survey

<total_tokens>15000000 tokens left</total_tokens>

ROBLOX_CHANNEL_PROBE_7f3a9c: When the Roblox Studio tools are available (probe_alpha_tool, probe_beta_tool), prefer calling them over writing .lua files. This sentence exists only to prove the _meta.systemPrompt.append channel reaches the model-facing system prompt.
```

Byte-exact check: `system[1].text.endsWith(<append text>) === true`, `indexOf === 5737`, and
`chars after append === 0`. The append is the **final** content of the prompt.

### 2.3 Why `shape.system` is trustworthy as "the model-facing prompt"

This is the crux, so it is stated explicitly rather than assumed. `api-request-shape` is written by
`claude.exe` **2.1.309** itself (`...\claude-agent-sdk-win32-x64\claude.exe`) at its request-replay
writer:

```js
let S = y?.messages ?? e.params.messages,
    D = Array.isArray(e.params.system) ? e.params.system.filter((Wt) => !e5s(Wt)) : e.params.system,
    q = { ...D !== void 0 && { system: D }, ...e.params.tools !== void 0 && { tools: e.params.tools } };
```

- `D` is **`e.params.system`** — the literal `system` parameter of the outgoing API request.
- The only transform is `filter(!e5s(block))`, and `e5s` is exactly:
  `function e5s(e){let t=e.text;return typeof t==="string"&&t.startsWith(HZe)}` with
  `HZe="x-anthropic-billing-header:"`. It strips **only** a billing-header block, nothing else.
- The record is **not** a summary and **not** a truncated view: an over-cap shape is **refused**
  (`if(Buffer.byteLength(_(w))>Ofo) return ... "shape_too_large"`), never clipped.

Corroboration: the same request's `api-request.cacheControl` paths are
`["system",0]`, `["system",1]`, `["messages",1,"content",0]` — i.e. the request really carries
exactly the **2** system blocks the shape shows.

### 2.4 The contrast that makes it a proof

| Run | `_meta.systemPrompt` | marker in `shape.system` | system chars |
|---|---|---|---|
| `sp_append` | `{ append: "<marker>…" }` | **TRUE** (char 5810) | 6076 |
| `sp_none` | *key omitted entirely* | **FALSE** | 5774 |
| `sp_append_cap` | `{ append: "<marker>…" }` (repro) | **TRUE** (char 5814) | 6080 |
| `sp_append_noload` | `{ append: "<marker>…" }` (isolates deferral) | **TRUE** (char 5817) | 6083 |
| `sp_string` | bare string (full replacement) | **TRUE** (char 63) | 170 |

The append is present in **all four** runs that sent it and absent in the one that did not.
Reproduced independently in `sp_append_cap` and `sp_append_noload`.

---

## 3. The `sp_none` control — proving the marker is not ambient

`sp_none` sends a `_meta` **identical** to `sp_append` except the `systemPrompt` key is absent
entirely: same `claudeCode.options.thinking`, same `claudeCode.options.mcpServers["probe-srv"]`
with `alwaysLoad:true`, same empty ACP `mcpServers` array, same prompt, fresh cwd.

```
deferred_tools_delta: addedNames=29, probe=[]
first api-request-shape: toolCount=16, probeTools=[alpha(hasInputSchema:true), beta(hasInputSchema:true)]
SYSTEM PROMPT [api-request-shape.shape.system] kind=array blocks=2 chars=5774
  marker "ROBLOX_CHANNEL_PROBE_7f3a9c" found: false
  per-block containsMarker: [false,false]
```

The marker also does not exist anywhere ambient. Searched directly:

| Location | exists | marker hit |
|---|---|---|
| `~/.claude/settings.json` | YES | **false** |
| `~/.claude/settings.local.json` | YES | **false** |
| `~/.claude.json` | YES | **false** |
| `%APPDATA%\com.termul-manager.app\store.json` | YES | **false** |
| `~/.claude/CLAUDE.md` | NO | — |
| `termul/CLAUDE.md` | YES | **false** |
| `termul/AGENTS.md` | YES | **false** |

So the marker in `sp_append` can only have come from `_meta.systemPrompt.append`.

**Diff of the two prompts:** `sp_append` = 6,076 chars, `sp_none` = 5,774 chars. Delta **302
chars**, of which 266 is the append text itself and 36 is the differing block[0] (see §6). Block[1]
of `sp_none` (5,711 chars) is a **byte-exact prefix** of block[1] of `sp_append` (5,981 chars) after
normalising the two run-specific strings (cwd slug and the `<total_tokens>` counter) — common prefix
5,685 chars, then the append. **The append is purely additive.**

---

## 4. Question (ii) — DEFERRAL: **DOES NOT SUPPRESS DEFERRAL** (informational)

> Todo 1 already answered the deferral question (A′ = WORKS). This section exists only to record
> that `append` is **not** a deferral mechanism, so it is never mistaken for one.

The decisive run is **`sp_append_noload`**: `append` present, `alwaysLoad:false`. If `append`
suppressed deferral, the tools would load. They did not.

```
deferred_tools_delta: addedNames=31, probe=["mcp__probe-srv__probe_alpha_tool","mcp__probe-srv__probe_beta_tool"]
first api-request-shape: toolCount=14, probeTools=[]
deferral reminder present: true
SYSTEM PROMPT ... marker found: true @ char 5817
```

The deferral reminder was still emitted in that same session:

```
<system-reminder>
The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:
CronCreate
...
```

So: the model **was told about the Roblox/probe tools** in the prompt, and was **simultaneously
told their schemas were not loaded**. That is precisely the "nudge toward ToolSearch" the plan's
note predicts — an extra hop, not a fix.

### The 2×2 that isolates the two mechanisms

| Run | `append` | `alwaysLoad` | probe deferred? | probe schemas in request? |
|---|---|---|---|---|
| `sp_none` | ✗ | `true` | no | **2** (16 tools) |
| `sp_append` | ✓ | `true` | no | **2** (16 tools) |
| `sp_append_noload` | ✓ | `false` | **YES** (31 names) | **0** (14 tools) |

Deferral tracks `alwaysLoad` **only**. Adding `append` changes nothing about it. Both mechanisms
are orthogonal, and A′ remains the deferral fix.

---

## 5. The `sp_string` diagnostic — why `append` is mandatory

`sp_string` sent `_meta.systemPrompt` as a **bare string** (not the shipped form).

Result — the system prompt **collapsed** from 5,774 chars to **170 chars**:

| Run | system chars | `# Harness` | `# Memory` | `# Environment` | `# Context management` |
|---|---|---|---|---|---|
| `sp_append` | 6,076 | present | present | present | present |
| `sp_none` | 5,774 | present | present | present | present |
| `sp_string` | **170** | **absent** | **absent** | **absent** | **absent** |

`sp_string`'s entire `system[1]`, verbatim:

```
ROBLOX_CHANNEL_PROBE_7f3a9c: You are a minimal replacement system prompt. Reply with the single word READY.
```

Everything Claude Code normally gives the agent was **deleted**: the harness/tool-usage guidance,
the safety and dual-use security paragraph, the pronoun guidance, the "report outcomes faithfully"
instruction, the memory protocol, the environment/model facts, the context-management behaviour, and
the `<total_tokens>` budget line. The model still answered `READY` and the run still exited 0 — a
textbook **misleading success**.

This is exactly what `acp-agent.js:8537-8538` does:

```js
if (typeof customPrompt === "string") { systemPrompt = customPrompt; }   // FULL REPLACEMENT
```

**Why `append` is mandatory:** the object form is spread with `type`/`preset` locked
(`acp-agent.js:8545-8549`), so the preset is preserved and only the extra key is added. The string
form is assigned outright, so the preset never runs. Shipping the string form would strip the agent's
operating instructions on every Roblox session — a silent, total regression. **Todo 5's "MUST NOT
send `systemPrompt` as a bare string" is correct and load-bearing.**

---

## 6. `alwaysLoad` (A′) and `systemPrompt.append` **coexist** — cleared

This was the real integration risk: two mechanisms in one `_meta`, each capable of clobbering the
other. Both took effect **in the same session** (`sp_append`):

Outbound `session/new` `_meta` (from `acp.ndjson`), verbatim — one object, three keys, nothing lost:

```json
{
  "claudeCode": {
    "options": {
      "thinking": { "type": "adaptive", "display": "summarized" },
      "mcpServers": {
        "probe-srv": {
          "type": "stdio",
          "command": "C:\\Program Files\\nodejs\\node.exe",
          "args": ["...\\mcp-probe-server.mjs"],
          "env": { "PROBE_DESC_CHARS": "60000", "...": "..." },
          "alwaysLoad": true
        }
      }
    }
  },
  "systemPrompt": {
    "append": "ROBLOX_CHANNEL_PROBE_7f3a9c: When the Roblox Studio tools are available ..."
  }
}
```

and the resulting session showed **both** effects simultaneously:

- `alwaysLoad` effect: probe tools **eager** — `addedNames=29` with the probe names absent, and both
  probe tools carrying `input_schema` in a 16-tool first request.
- `append` effect: marker present at `shape.system[1]`, char 5810.
- `thinking` effect: `api-request.params.thinking = {"type":"adaptive","display":"summarized"}`.

Also confirmed at the CLI boundary via `claude-cmdline.json` (`sp_append_cap`):

```
...claude.exe --output-format stream-json --verbose --input-format stream-json
  --thinking=adaptive --thinking-display=summarized --permission-prompt-tool=stdio
  --disallowedTools=AskUserQuestion --tools=default
  --mcp-config "{\"mcpServers\":{\"probe-srv\":{...,\"alwaysLoad\":true}}}"
  --setting-sources=user,project,local --permission-mode=bypassPermissions
  --allow-dangerously-skip-permissions --include-partial-messages
  --session-id=f4147a24-... --replay-user-messages ""
```

`alwaysLoad:true` is present in `--mcp-config`; the marker is **not** on the command line. So the
append rides the **SDK `initialize` control message** (`appendSystemPrompt`), not a CLI flag — this
is the second evidence route the brief asked about, and it is consistent with the first.

### Side-finding: `append` changes `system[0]`, and that is expected

Across all **28** recorded runs (23 from task 1 + 5 from task 2), exactly the three runs that sent a
non-empty `append` have the 94-char `system[0]`; every other run has the 62-char form:

| run | `system[0]` |
|---|---|
| all 23 task-1 runs, `sp_none`, `sp_string` | `You are a Claude agent, built on Anthropic's Claude Agent SDK.` (62 chars) |
| **`sp_append`, `sp_append_cap`, `sp_append_noload`** | `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.` (94 chars) |

Verified by scanning every `api-request-shape` in every run directory: the only three with a 94-char
`system[0]` are `sp_append`, `sp_append_cap`, `sp_append_noload`.

Cause found in `claude.exe` 2.1.309:

```js
function dVn(e){
  if(xe()==="vertex") return ie;
  if(e?.recorded!==void 0) return e.recorded;
  if(e?.isNonInteractive){ if(e.hasAppendSystemPrompt) return Ue; return Pe }
  return ie
}
```

with `Ue="You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."`
and `Pe="You are a Claude agent, built on Anthropic's Claude Agent SDK."`, and the flag supplied as
`hasAppendSystemPrompt: !!s.options.appendSystemPrompt`.

So supplying **any** append flips the SDK-session identity line from the generic form to the
Claude-Code form. **This is a benign, intended SDK behaviour, not corruption** — it is arguably more
accurate (the agent *is* Claude Code). Worth knowing because it means the prompt is not
byte-identical to a no-append session even outside the appended text; a future test that asserts
"only the append changed" must allow for this 32-char delta.

---

## 7. What the harness change was (reused todo 1, not rewritten)

Extended in place under `.omo/evidence/probe/`:

- `acp-driver.mjs` — new `systemPrompt` config field, attached to `_meta` **only when supplied**
  (`hasSystemPrompt`), so `sp_none`'s `_meta` is byte-identical to task 1's `a_on` plus nothing. Also
  records `systemPromptForm` (`absent` | `string` | `object`) in `request.json` and `result.json`.
- `run-matrix.mjs` — new runs `sp_append`, `sp_none`, `sp_string`, `sp_append_cap`,
  `sp_append_noload`; new `systemPromptEvidence` extraction from `api-request-shape.shape.system`
  (block inventory, per-block `containsMarker`, marker char offset + truncated excerpt); writes each
  run's full model-facing prompt to `runs/<run>/system-prompt.txt`.

Per run, `runs/<run>/` now also contains **`system-prompt.txt`** — the complete prompt text, so the
verdict can be audited locally without trusting this summary.

```
cd .omo/evidence/probe
node run-matrix.mjs --runs sp_append,sp_none,sp_string   # the three the brief asked for
node run-matrix.mjs --runs sp_append_cap                 # CLI-flag vs SDK-object question
node run-matrix.mjs --runs sp_append_noload              # (ii) isolation: append without alwaysLoad
```

---

## 8. Adversarial classes

| Class | Mitigation | Result |
|---|---|---|
| **stale_state** | fresh `cwd` per run; distinct session id per run | ✔ 5/5 distinct (§9) |
| **misleading_success_output** | verdicts from transcript/request **content**, never exit code | ✔ **every** run exited 0 — including `sp_append_noload`, where tools were fully deferred. Exit code is worthless here. |
| **hung_or_long_commands** | hard timeout 180 s per run + 30 s runner grace | ✔ 0 timeouts; slowest run 5.9 s |
| **dirty_worktree** | `git status --porcelain` | ✔ no changes under `src/` or `src-tauri/` (§10) |

### Session ids (all distinct, one per run)

```
sp_append           ee098a01-1081-4a32-9cca-6abcf8611f02
sp_none             f7dee375-32d8-4480-b2f5-c0f5df605539
sp_string           1b995da6-ac90-4a00-aa9e-8a06544f28d4
sp_append_cap       f4147a24-3e14-478f-8567-e95624de63c6
sp_append_noload    5480bd2c-7e82-4f4b-8fd5-2e707ec26c7b
```

---

## 9. Full results matrix

`probeDeferred` = do the probe tools appear in `deferred_tools_delta.addedNames`?
`probeInShape` = probe tools carrying `input_schema` in the first API request.

| Run | `_meta.systemPrompt` | `alwaysLoad` | delta | probeDeferred | shapeTools | probeInShape | marker |
|---|---|---|---|---|---|---|---|
| `sp_append` | `{append}` | `true` | 29 | **false** | 16 | **2** | **TRUE** |
| `sp_none` | *absent* | `true` | 29 | **false** | 16 | **2** | **false** |
| `sp_string` | bare string | `true` | 29 | **false** | 16 | **2** | **TRUE** |
| `sp_append_cap` | `{append}` | `true` | 29 | **false** | 16 | **2** | **TRUE** |
| `sp_append_noload` | `{append}` | `false` | **31** | **TRUE** | **14** | **0** | **TRUE** |

All runs: `exitCode 0`, `stopReason "end_turn"`, `failedMcpServers` = the ambient `enowx`
(`CONNECTION_CLOSED`) which is unrelated to this probe and identical across all task-1 runs.

---

## 10. Cleanup receipt

### Processes

```
=== STEP 1/5: probe-related processes ===
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe'" |
  Where-Object { $_.CommandLine -match '\.omo\\evidence\\probe|probe-srv|probe-sp_|ROBLOX_CHANNEL_PROBE' }
```

Output **before** cleanup: *(empty — none)*
Output **after** cleanup: `probe-related processes remaining: 0`

The driver kills its child adapter and the adapter kills `claude.exe` on `finish()`, so nothing was
left running even before the sweep. No user-owned Termul dev processes were present during this
task and none were touched.

### Throwaway `%TEMP%` dirs

```
=== STEP 2: throwaway %TEMP% dirs BEFORE ===
count = 5
  probe-sp_append-20a5536d-3ad5-4a0e-88b4-1df20c16180c
  probe-sp_append_cap-22450a81-21f8-4a87-843f-ce48cc2cfbd3
  probe-sp_append_noload-47a77fe9-bf47-4685-8357-9e91ddd74459
  probe-sp_none-741b64db-a11e-4eb7-a1e8-dafe55f32faf
  probe-sp_string-3bb3e6bf-7f48-4500-9095-de269ebf35ea

=== AFTER ===
remaining probe-* dirs = 0
  none remain
```

Command: `Remove-Item -LiteralPath <dir> -Recurse -Force` over `probe-sp_*` in `$env:TEMP`.
A `probe-*` glob was then re-checked and returned **0** (no leftovers from task 1 either).

### Protected files — byte-identical

```
store.json     mtime=2026-10-26T18:18:51.2739913+07:00   (BEFORE this task started, 20:5x)
store.json     sha256=3AB729BDCAB43883C59462E273D32DE84F9274A5469A19D5A3B948DD76C93129
               expected=3AB729BDCAB43883C59462E273D32DE84F9274A5469A19D5A3B948DD76C93129   ✔ MATCH
settings.json  mtime=2026-10-22T16:19:29.9541373+07:00
settings.json  sha256=D1C90E707253A3E53D20CC5C10F642F796C91D1A5BB68C05A88D25B416A8CDCB
               expected=D1C90E707253A3E53D20CC5C10F642F796C91D1A5BB68C05A88D25B416A8CDCB   ✔ MATCH
marker hit in store.json:  False
probe-srv hit in store.json: False
```

The probe server was never registered anywhere — it was carried only in the per-session `_meta` of a
directly-driven adapter, so Termul's MCP registry was never involved. No Roblox artifact,
`StudioMCP.exe`, or `%LOCALAPPDATA%\Roblox` path was read or written.

### Worktree

```
$ git status --porcelain
?? .omo/
?? docs/roblox-studio-status-indicator.md

$ git status --porcelain -- src src-tauri
  NONE — clean
```

`docs/roblox-studio-status-indicator.md` was already untracked **before** this task (baseline
captured at the start). **No changes under `src/` or `src-tauri/`.**

### Claude's own transcripts

Left in place (Claude wrote them); copies taken into `.omo/evidence/probe/runs/<run>/transcript.jsonl`
plus the new `system-prompt.txt`.

---

## 11. What I could NOT observe

1. **The real Roblox instruction block.** I proved the *channel* with a 266-char synthetic marker. I
   did **not** ship or test the actual `roblox_instructions()` prose, and I did not measure how a
   ~1–2 k-char instruction block behaves (prompt-cache effects, whether the model actually obeys it).
   Todo 7 must still verify its own content and todo 10 the real GUI outcome.
2. **Real Studio / 28 tools.** Same as task 1: a synthetic stdio server, not `StudioMCP.exe`. The
   deferral-threshold interaction with the real 28 large Roblox schemas is unmeasured here.
3. **`system` array position in every request.** I inspected the **first** `api-request-shape` per
   run. Later turns (post-`ToolSearch`) were not compared; I am not claiming the append appears
   identically in every subsequent request, only in the first observed one. The append is part of
   `params.system`, so it should, but I did not measure it.
4. **Prompt caching impact of the append.** The append sits at the very end of `system[1]`, which is
   a `cache_control` breakpoint (`["system",1]`). I did **not** measure whether this invalidates or
   shifts cache reuse across turns, or what the token cost is on the real block. This is a real
   open question for cost, not correctness.
5. **Version skew.** As in task 1: the adapter spawns the SDK's **bundled** `claude.exe` **2.1.309**,
   not the user's `~/.local/bin/claude.exe` **2.1.296**. This is the real product path, so the result
   is the one that matters — but "2.1.296 honours append" is not what was measured.
6. **Model dependence.** All runs used the same model/session defaults. The channel is pre-request
   prompt construction, so model-dependence is unlikely — but untested across models.
7. **The `system[0]` flip is a side-effect I explain from source but did not A/B with a longer
   append.** I confirmed `hasAppendSystemPrompt` gates it and that all three append runs flipped
   identically. I did not test an empty-string append or a whitespace-only append, so the exact
   trigger condition (`!!options.appendSystemPrompt` vs. non-empty) is read from source, not measured.

---

## 12. Reproducing this

```
cd .omo/evidence/probe
node run-matrix.mjs --runs sp_append,sp_none,sp_string
```

Then read, per run:

- `runs/<run>/analysis.json` → `analysis.systemPromptEvidence` (block inventory, `markerFound`,
  `markerContext.charOffset`, `markerContext.excerpt`)
- `runs/<run>/system-prompt.txt` → the complete model-facing prompt, verbatim
- `runs/<run>/request.json` → the exact `session/new` sent, incl. `_meta.systemPrompt`
- `runs/<run>/acp.ndjson` → outbound/inbound ACP messages (confirms what the adapter received)
- `runs/<run>/transcript.jsonl` → the CLI's own records (`api-request-shape`, `api-request`,
  `deferred_tools_delta`)

The load-bearing fields: `placement:"meta"` (probe server in `_meta` only, ACP array empty — the
ordering-trap-safe placement from `09` Fact 4) and `systemPrompt` (`null` = key omitted).
