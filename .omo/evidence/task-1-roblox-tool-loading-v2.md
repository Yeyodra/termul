# Task 1 — Phase 0 probe: does `alwaysLoad` via the ACP `_meta` channel suppress tool deferral?

**Date:** 2026-10-26
**Verdict (headline):** **A′ = WORKS.** **B = WORKS (but only with the `auto:N` syntax the CLI actually accepts).**
**Winning mechanism:** **A′** — server-level `alwaysLoad: true` on `_meta.claudeCode.options.mcpServers["<name>"]`, with that server **omitted** from the ACP `mcpServers` array.

This is a **research-only** deliverable. No product change, no commit, nothing under `src/` or `src-tauri/` was touched.

---

## 1. TL;DR for the planner

The ~20-line change is the right one. `claude.exe` **does act** on `alwaysLoad` once the value arrives, and it is **per-server targeted** (it did *not* un-defer the other servers in the same session — see §6).

Three findings that change how the plan must be written:

1. **A′ works and is targeted.** With `alwaysLoad:true`, the probe tools' schemas were loaded eagerly **while the other 29 tools in the same session stayed deferred**. This is exactly the selectivity `09` predicted and is the reason A′ beats B.
2. **The ordering trap is real and now empirically proven, not just read from source.** Placing `alwaysLoad` on the ACP array entry — or in both places — produces a `--mcp-config` with **no `alwaysLoad` key at all** (§5). A probe that did this would have reported a false DOES NOT WORK.
3. **`ENABLE_TOOL_SEARCH=100` is silently invalid.** The accepted syntax is `auto:N`. Bare `100` was accepted without any warning but produced **no** threshold change. `06`/`09` both proposed `"100"`; that value does nothing. If B is ever shipped as a fallback it must send `auto:100` (or `false`).

---

## 2. What was probed, and where each run put the server

**This table is load-bearing** — `09` Fact 4 says the ACP array is spread *after* `_meta`, so the placement decides whether the test is valid at all.

| Run | Probe server placement | `alwaysLoad` | `ENABLE_TOOL_SEARCH` | Extra |
|---|---|---|---|---|
| `a_on` | **`_meta` only** (ACP array `[]`) | `true` | — | — |
| `a_off` | **`_meta` only** (ACP array `[]`) | `false` | — | control |
| `a_absent` | **`_meta` only** (ACP array `[]`) | *key omitted* | — | control |
| `t_on` | **`_meta` only** (ACP array `[]`) | `true` | — | **14 bulk tools → above threshold** |
| `t_off` | **`_meta` only** (ACP array `[]`) | `false` | — | **same 14 bulk tools** |
| `a_on_slow` | **`_meta` only** (ACP array `[]`) | `true` | — | 9s MCP handshake |
| `call_on` | **`_meta` only** (ACP array `[]`) | `true` | — | 2nd turn calls the tool |
| `call_off` | **`_meta` only** (ACP array `[]`) | `false` | — | 2nd turn calls the tool |
| `a_meta_auto` | **`_meta` only** (ACP array `[]`) | — | `auto` | isolation |
| `a_array_on` | **ACP array only** | `true` | — | ordering-trap / Fact 1 |
| `t_array_on` | **ACP array only** | `true` | — | ordering-trap, above threshold |
| `a_both_on` | **both** | `true` | — | ordering-trap / Fact 4 |
| `t_both_on` | **both** | `true` | — | ordering-trap, above threshold |
| `b_array_noenv` | ACP array only | — | *none* | baseline |
| `b_100` | ACP array only | — | `100` | as `06`/`09` proposed |
| `b_auto` / `b_auto_rerun` | ACP array only | — | `auto` | reproducibility |
| `b_auto100` | ACP array only | — | `auto:100` | **accepted syntax** |
| `t_b_auto100` | ACP array only | — | `auto:100` | above threshold |
| `b_false` | ACP array only | — | `false` | deferral off |
| `cap_a_on` | **`_meta` only** | `true` | — | cmdline capture (mirrors `a_on`) |
| `cap_t_array_on` | ACP array only | `true` | — | cmdline capture (mirrors `t_array_on`) |
| `cap_t_both_on` | **both** | `true` | — | cmdline capture (mirrors `t_both_on`) |

Every run used a **fresh `cwd`** under `%TEMP%`, so every run produced a **new session id** (§9). No run reused a transcript.

---

## 3. Mechanism A′ — verdict **WORKS**

### 3.1 The decisive contrast (threshold mode: `t_on` vs `t_off`)

Both runs load the **identical** probe server (16 tools) plus the same ambient servers. The **only** difference is `alwaysLoad`.

**`t_on` — `alwaysLoad: true`, above threshold.** Probe tools are **absent** from `addedNames` and their **schemas are present** in the first API request:

```json
{"type":"attachment","attachmentType":"deferred_tools_delta","addedNamesCount":29,"addedNames":["CronCreate","CronDelete","CronList","EnterPlanMode","EnterWorktree","ExitPlanMode","ExitWorktree","NotebookEdit","SendMessage","TaskStop","WebFetch","WebSearch","mcp__roblox-mcp__click-button","mcp__roblox-mcp__execute","mcp__roblox-mcp__execute-file","mcp__roblox-mcp__get-console-output","mcp__roblox-mcp__get-data-by-code","mcp__roblox-mcp__get-descendants-tree","mcp__roblox-mcp__get-game-info","mcp__roblox-mcp__get-script-content","mcp__roblox-mcp__list-clients","mcp__roblox-mcp__list-roblox-windows","mcp__roblox-mcp__remote-spy","mcp__roblox-mcp__screenshot-window","mcp__roblox-mcp__script-grep","mcp__roblox-mcp__search-instances","mcp__roblox-mcp__semantic-search-scripts","mcp__roblox-mcp__set-active-client","mcp__roblox-mcp__type-text-box"],"probePresent":false,"wireHiddenNames":[],"failedMcpServers":[{"name":"enowx","errorCode":"CONNECTION_CLOSED","error":"Connection closed"}]}
```

`api-request-shape`, `t_on` (30 tools — the 14 bulk tools **and** both probe tools carry schemas):

```json
{"name":"mcp__probe-srv__probe_alpha_tool","description":"Tool `probe_alpha_tool`: inspects and reports structured state from a live authoring host. This tool is read-only unless explicitly stated otherwise and never mutates the target document as a side effect of inspection.\n\nSection 1. When invoked, this tool resolves the effective property value after i...<truncated 3811 chars>...","input_schema":{"type":"object","properties":{"selector":{"type":"string","description":"Optional selector narrowing the inspected scope."}},"required":[],"additionalProperties":false}}
```

```json
{"name":"mcp__probe-srv__probe_beta_tool","description":"Tool `probe_beta_tool`: inspects and reports structured state from a live authoring host. This tool is read-only unless explicitly stated otherwise and never mutates the target document as a side effect of inspection.\n\nSection 1. When invoked, this tool resolves the effective property value after in...<truncated 3811 chars>...","input_schema":{"type":"object","properties":{"selector":{"type":"string","description":"Optional selector narrowing the inspected scope."}},"required":[],"additionalProperties":false}}
```

**`t_off` — `alwaysLoad: false`, same bulk load, above threshold.** Probe tools **are** deferred:

```json
{"type":"attachment","attachmentType":"deferred_tools_delta","addedNamesCount":45,"probeNames":["mcp__probe-srv__probe_alpha_tool","mcp__probe-srv__probe_beta_tool","mcp__probe-srv__probe_bulk_000","mcp__probe-srv__probe_bulk_001","mcp__probe-srv__probe_bulk_002","mcp__probe-srv__probe_bulk_003","mcp__probe-srv__probe_bulk_004","mcp__probe-srv__probe_bulk_005","mcp__probe-srv__probe_bulk_006","mcp__probe-srv__probe_bulk_007","mcp__probe-srv__probe_bulk_008","mcp__probe-srv__probe_bulk_009","mcp__probe-srv__probe_bulk_010","mcp__probe-srv__probe_bulk_011","mcp__probe-srv__probe_bulk_012","mcp__probe-srv__probe_bulk_013"],"first10":["CronCreate","CronDelete","CronList","EnterPlanMode","EnterWorktree","ExitPlanMode","ExitWorktree","NotebookEdit","SendMessage","TaskStop"],"wireHiddenNames":[]}
```

`t_off`'s first API request has **14** tools and **zero** probe tools (`probeInShape=0`).

**This is the contrast the task demanded.** Same server, same size, same threshold state; only the flag differs; deferral flips.

### 3.2 The same contrast at low volume (`a_on` vs `a_off`)

`a_on` (2 probe tools only): `addedNamesCount=29`, probe tools **absent**, shape has **16** tools including both probe tools with `input_schema`.

`a_off` (2 probe tools only): `addedNamesCount=31`, probe tools **present**, shape has **14** tools and **no** probe tools.

Verbatim from `a_off`'s delta:

```json
"addedLines": ["CronCreate","CronDelete","CronList","EnterPlanMode","EnterWorktree","ExitPlanMode","ExitWorktree","NotebookEdit","SendMessage","TaskStop","WebFetch","WebSearch","mcp__probe-srv__probe_alpha_tool","mcp__probe-srv__probe_beta_tool","mcp__roblox-mcp__click-button", ...]
```

`a_absent` (flag omitted entirely) behaved like `a_off` — `addedNamesCount=31`, probe tools deferred. So the default is "deferred", and only an explicit `true` changes it.

### 3.3 Callability — the sharpest single piece of evidence

The task's acceptance criterion is about schemas, but schema-presence and callability are different claims, so I tested both with a second turn instructing the model to call the tool.

**`call_on` (`alwaysLoad: true`)** — the model called the tool **directly**, with **no** `ToolSearch`:

```
tool_use: mcp__probe-srv__probe_alpha_tool  input={}
```

**`call_off` (`alwaysLoad: false`)** — the model had to **fetch the schema first**:

```
tool_use: ToolSearch  input={"query":"select:mcp__probe-srv__probe_alpha_tool","max_results":5}
tool_use: mcp__probe-srv__probe_alpha_tool  input={}
```

Both eventually returned `PROBE_OK:probe_alpha_tool`. **The difference is the extra hop** — which is exactly the failure mode `06` documents ("one extra hop the model may or may not take"). This is the cleanest reproduction of the production bug and its fix.

---

## 4. Why the verdict is WORKS and not INCONCLUSIVE

- **Contrast exists:** `t_on` (eager) vs `t_off` (deferred) differ **only** in `alwaysLoad`. ✔
- **Not a small-tool-set artifact:** `t_off` proves the same 16 tools *are* deferred when the flag is false, and the threshold was genuinely crossed (45 deferred names). ✔
- **Not a transcript-reuse artifact:** fresh `cwd` per run, distinct session ids (§9). ✔
- **Not a silent-failure artifact:** verdicts come from transcript **content** (`deferred_tools_delta`, `api-request-shape`), never exit codes. ✔
- **Value provably reached the CLI:** captured `--mcp-config` shows `"alwaysLoad":true` verbatim (§5). ✔
- **Ordering trap ruled out:** `_meta`-only runs have an empty ACP array; the captured `--mcp-config` confirms the key survived. ✔

---

## 5. The ordering trap — empirically confirmed (this was read from source before; now it is measured)

Captured `--mcp-config` handed to `claude.exe` while each session was live (each capture run used its own fresh cwd):

| Run | Placement | `alwaysLoad` keys in `--mcp-config` | Values |
|---|---|---|---|
| `cap_a_on` | `_meta` only | **1** | `true` |
| `cap_t_array_on` | ACP array only | **0** | — |
| `cap_t_both_on` | both | **0** | — |

`cap_a_on` verbatim (probe entry — the key **survived**):

```
--mcp-config "{\"mcpServers\":{\"probe-srv\":{\"type\":\"stdio\",\"command\":\"C:\\Program Files\\nodejs\\node.exe\",\"args\":[\"C:\\Users\\Novella\\Documents\\Github\\termul\\.omo\\evidence\\probe\\mcp-probe-server.mjs\"],\"env\":{...},\"alwaysLoad\":true}}}"
```

`cap_t_array_on` verbatim (same server, `alwaysLoad:true` sent on the ACP array entry — **key gone**):

```
--mcp-config "{\"mcpServers\":{\"probe-srv\":{\"type\":\"stdio\",\"command\":\"C:\\Program Files\\nodejs\\node.exe\",\"args\":[\"C:\\Users\\Novella\\Documents\\Github\\termul\\.omo\\evidence\\probe\\mcp-probe-server.mjs\"],\"env\":{...,\"PROBE_BULK_TOOLS\":\"14\"}}}}"
```

The only difference between those two strings is the presence of `"alwaysLoad":true` — and the deferral outcome flips with it (`cap_a_on`: probe eager; `cap_t_array_on`: probe deferred, `addedNames=45`).

This confirms, by observation rather than by reading:

- **`09` Fact 1** — the ACP array entry is projected to four fields; `alwaysLoad` is dropped there.
- **`09` Fact 4** — with the server in **both** places, the array's four-field copy wins and the `_meta` key is silently lost.
- **`09` open question 3** — the CLI's config validator **accepts** `alwaysLoad` on a stdio entry without warning or rejection. `t_array_on`/`t_both_on` deferred the probe tools, exactly as the trap predicts.

Consequence for todo 4: dropping `roblox-studio` from the ACP array is **not** optional hygiene — without it the fix is a verified no-op.

---

## 6. Selectivity — A′ does *not* un-defer everything (this is why A′ beats B)

In `t_on`, with `alwaysLoad:true` on the probe server only:

- probe tools: **eager** (schemas in the request)
- the other **29** tools (`CronCreate`, `WebFetch`, all 15 `mcp__roblox-mcp__*`, …): **still deferred**
- the deferral reminder **still present** in the same session

That reminder, from `t_on`:

```
The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:
CronCreate
...
mcp__roblox-mcp__type-text-box
```

So A′ is **per-server**, as documented. Contrast with B (§7), which un-deferred **all 43** tools. For the Roblox fix this is the whole argument: A′ loads the 28 Roblox schemas and leaves the other 55+ deferred.

---

## 7. Mechanism B — verdict **WORKS, but `ENABLE_TOOL_SEARCH=100` does nothing**

> **Scope note / deviation from the brief.** The task said to run B *only if* A′ showed the tools still deferred. A′ worked, so B was not required. I ran it anyway because the B probes cost ~6 s each and they surfaced a **defect in the plan's own proposed fallback value** (§7.1). Recording that seemed more useful than withholding it. **B is not the recommended mechanism** — §6 is the reason.

### 7.1 `"100"` is silently invalid

`06` and `09` both proposed `ENABLE_TOOL_SEARCH=100`. Measured:

| Run | Value | Deferred delta | Shape tools | Probe in shape |
|---|---|---|---|---|
| `b_100` | `100` | present, 31 names, probe **deferred** | 14 | **0** |
| `b_array_noenv` | *(unset)* | present, 31 names, probe **deferred** | 14 | **0** |
| `b_auto` | `auto` | present, 31 names | **43** | **2** |

`b_100` is **indistinguishable from unset**. The CLI contains:

```js
function LUo(e){if(!e.startsWith("auto:"))return null;let o=e.slice(5),r=gu(o);if(isNaN(r))return t(`Invalid ENABLE_TOOL_SEARCH value "${e}": expected auto:N where N is a number.`),null;return Math.max(0,Math.min(100,r))}
```

`LUo` only parses `auto:N`, so `"100"` → `null` → falls through to the default. No warning was emitted, which is why this is a trap worth recording: **the plan's proposed fallback value would have shipped as a silent no-op.**

### 7.2 The accepted syntax works

| Run | Value | Deferred delta | Shape tools | Probe in shape |
|---|---|---|---|---|
| `b_auto100` | `auto:100` | **ABSENT** | 43 | 2 |
| `t_b_auto100` | `auto:100` (bulk, above threshold) | **ABSENT** | **57** | 2 |
| `b_false` | `false` | **ABSENT** | 43 | 2 |

`auto:100` maps to mode `standard` (`if(o===100)return"standard"`), i.e. deferral off — matching `09`'s intent, just with different syntax. `t_b_auto100` is the strongest: with the threshold genuinely crossed, **no** `deferred_tools_delta` entry was written at all and all **57** tools carried schemas.

### 7.3 The `b_auto` nuance (recorded so it is not misread)

`b_auto` (`auto`, default 10%) produced `addedNames=31` **and** a 43-tool shape. That is not a contradiction: `auto` keeps the threshold in play, the **reminder still lists the probe tools**, and the 43-tool shape is the *post-`ToolSearch`* request. `b_auto` is therefore **not** evidence of eager loading — it is a session where the model fetched schemas itself. Reproduced in `b_auto_rerun`, so it is deterministic, not noise.

---

## 8. Startup delay — the 5s `alwaysLoad` connect block

`09` open question 2 asked whether `alwaysLoad:true` costs startup time, and whether a slow Studio would exceed the documented 5s cap.

Per-phase timings from the ACP message log:

| Run | initialize | `session/new` | prompt |
|---|---|---|---|
| `a_on` | 9249 ms | **2686 ms** | 3032 ms |
| `a_off` | 928 ms | **1786 ms** | 10980 ms |
| `a_absent` | 969 ms | 2167 ms | 2498 ms |
| `a_array_on` | 1026 ms | 1814 ms | 2557 ms |
| `t_on` | 1129 ms | **1862 ms** | 3468 ms |
| `t_off` | 979 ms | **1807 ms** | 2405 ms |
| `a_on_slow` (9 s handshake) | 1129 ms | **7117 ms** | 6645 ms |

Findings, stated conservatively:

- The `alwaysLoad:true` cost at `session/new` is **not consistent** across pairs: `a_on` vs `a_off` shows **+900 ms** (2686 vs 1786), while `t_on` vs `t_off` shows only **+55 ms** (1862 vs 1807). So the flag adds **at most ~0.9 s** and often near zero — not a reliable multi-second penalty. **I am not claiming a fixed startup cost.**
- **`a_on_slow` made the MCP handshake take 9 s — longer than the documented 5 s cap — and the probe tools were STILL loaded eagerly** (`addedNames=29`, probe absent, `probeInShape=2`). Its `session/new` took 7117 ms, i.e. the documented cap bounded the wait rather than letting it run to 9 s, and deferral did **not** silently revert. Worst observed cost: ~7 s once, at session start.
- The `a_on` 9249 ms `initialize` is **API/auth latency**, not MCP: `a_off`/`a_absent` show ~1 s there while their prompt phase swings 2.5–11 s. Phase timings are dominated by model latency, so only `session/new` is attributable to the flag.

**Residual uncertainty:** n=1 for the slow-handshake case. Behaviour well past 9 s, and interaction with `MCP_CONNECT_TIMEOUT_MS`, is unmeasured.

---

## 9. Threshold grounding and adversarial checks

### Description sizes (as the task required)

Generated: each probe tool description was **60,309 / 60,307 chars** (target 60,000).

**Claude Code truncates tool descriptions at ~4096 chars.** As actually delivered to the API:

```
"mcp__probe-srv__probe_alpha_tool": descriptionChars = 4109, hasInputSchema = true
"mcp__probe-srv__probe_beta_tool":  descriptionChars = 4109, hasInputSchema = true
```

This is why two 60 k-char tools were **not** enough to cross the threshold on their own (as the task brief assumed they would be): post-truncation the pair contributes only ~8.2 k chars ≈ 2 k tokens. I therefore added 14 bulk tools (`probe_bulk_000..013`) in the `t_*` runs to cross the threshold honestly rather than assert it.

Threshold math in `t_off` (the deferral-engaged run): **45** deferred tools; shape description total **83,349 chars ≈ 20,837 tokens** in `t_on`'s eager request vs **17,573 chars ≈ 4,393 tokens** in `t_off`'s deferred request. `06`'s decoded rule is `enabled = deferredTokens >= floor(contextWindow * N/100)` with `N=10`, so the deferred set was comfortably above 10% of a 200 k window.

### Adversarial classes

| Class | Mitigation | Result |
|---|---|---|
| **stale_state** | fresh `cwd` per run; distinct session id per run | ✔ all 20 runs distinct (below) |
| **misleading_success_output** | verdicts from transcript content only | ✔ exit 0 in every run, including deferred ones — proving exit code is worthless here |
| **hung_or_long_commands** | hard timeout 180 s + 30 s runner grace | ✔ 0 timeouts; slowest run 25.7 s |
| **dirty_worktree** | `git status --porcelain` | ✔ only `.omo/` (see §11) |

Session ids (one per run, **all distinct**, 23 runs):

```
a_absent      e19b439b-1791-4cf9-9bf5-3a8a1bdbdd08
a_array_on    29ec3387-ba12-4e02-829d-14fcb031507e
a_both_on     dc6b48b8-5daa-41b6-b39a-f4c4112e262f
a_meta_auto   7389e9f3-c917-49c6-9f71-7de8f75afa53
a_off         5be4dbf3-5a67-4946-8a14-f3e43f6dce25
a_on          973eb6c5-018b-4523-90a3-6b5040e25e48
a_on_slow     9fa9913e-0ddc-404b-ad79-6624336acbb8
b_100         3b4decc6-738b-4c1e-b7cc-28030cebc6e6
b_array_noenv 68fbb905-b961-4bd3-a68f-6ea33887091f
b_auto        c083ad6b-b37e-4c37-8367-58a027929e5d
b_auto_rerun  2e4b6b9d-c71a-4dcc-8f17-fd891fecf748
b_auto100     d5b1f7ee-bcda-49ac-a3a5-df5909e0e969
b_false       9c9c6096-6a18-42e7-b905-44a703bda96c
call_off      881613ba-d2f8-4890-bff1-025c132c7486
call_on       e65db10a-8d27-409c-9222-95c829f0f125
cap_a_on      ad1c3e60-5f56-4683-8895-31518f395f31
cap_t_array_on 8d0dbc72-3e1c-445e-be00-72c4ea32824e
cap_t_both_on 8759505e-2e13-4025-a6bc-6448c3eedae7
t_array_on    26dd76b6-5c4f-4410-8313-f6f937118595
t_b_auto100   3d3ef3b7-62f7-44ca-a7ae-e330c6b8d7b6
t_both_on     e75fec70-2dd6-4b72-85ed-b48169878957
t_off         979ce373-d7d2-44dd-a737-59023d20f123
t_on          2549ca39-6838-439f-b9fc-0e634d6e8ae2
```

The `cap_*` runs exist only to read the real `--mcp-config`; each got its own fresh cwd and reproduced its parent's deferral result exactly (`cap_a_on`: probe eager; `cap_t_array_on`/`cap_t_both_on`: probe deferred).

---

## 10. Full results matrix

`probeDeferred` = do the probe tools appear in `deferred_tools_delta.addedNames`? `probeInShape` = count of probe tools carrying `input_schema` in the first API request.

| Run | Placement | `alwaysLoad` | `ENABLE_TOOL_SEARCH` | delta | probeDeferred | shapeTools | probeInShape |
|---|---|---|---|---|---|---|---|
| `a_on` | `_meta` | `true` | — | 29 | **false** | 16 | **2** |
| `a_off` | `_meta` | `false` | — | 31 | true | 14 | 0 |
| `a_absent` | `_meta` | — | — | 31 | true | 14 | 0 |
| `t_on` | `_meta` | `true` | — | 29 | **false** | **30** | **2** |
| `t_off` | `_meta` | `false` | — | 45 | true | 14 | 0 |
| `a_on_slow` | `_meta` | `true` | — | 29 | **false** | 16 | **2** |
| `call_on` | `_meta` | `true` | — | 29 | **false** | 16 | **2** |
| `call_off` | `_meta` | `false` | — | 31 | true | 14 | 0 |
| `a_meta_auto` | `_meta` | — | `auto` | 31 | true | 43 | 2 |
| `a_array_on` | array | `true` | — | 31 | **true** | 14 | 0 |
| `t_array_on` | array | `true` | — | 45 | **true** | 14 | 0 |
| `a_both_on` | both | `true` | — | 31 | **true** | 14 | 0 |
| `t_both_on` | both | `true` | — | 45 | **true** | 14 | 0 |
| `b_array_noenv` | array | — | — | 31 | true | 14 | 0 |
| `b_100` | array | — | `100` | 31 | true | 14 | 0 |
| `b_auto` | array | — | `auto` | 31 | true | 43 | 2 |
| `b_auto_rerun` | array | — | `auto` | 31 | true | 43 | 2 |
| `b_auto100` | array | — | `auto:100` | **ABSENT** | n/a | 43 | **2** |
| `t_b_auto100` | array | — | `auto:100` | **ABSENT** | n/a | **57** | **2** |
| `b_false` | array | — | `false` | **ABSENT** | n/a | 43 | 2 |
| `cap_a_on` | `_meta` | `true` | — | 29 | **false** | 16 | **2** |
| `cap_t_array_on` | array | `true` | — | 45 | **true** | 14 | 0 |
| `cap_t_both_on` | both | `true` | — | 45 | **true** | 14 | 0 |

Every run exited **0** with `stopReason: "end_turn"`. **This is exactly why exit codes were not used as evidence.**

---

## 11. Cleanup receipt

### Processes

No orphan probe, adapter, or driver processes remain. Verified:

```
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe'" |
  Where-Object { $_.CommandLine -match '\.omo\\evidence\\probe|probe-srv|PROBE_DESC' }
```

→ **no output** (zero matches).

Two unrelated processes were observed and **deliberately not touched**, because they belong to the user's own running Termul dev app, not to this probe:

```
PID 23080  ...com.termul-manager.app.dev\...\claude-agent-acp\dist/index.js
PID 22184  ...com.termul-manager.app.dev\...\claude-agent-sdk-win32-x64\claude.exe --mcp-config "{...roblox-studio...}"
```

### Throwaway `%TEMP%` session dirs

Removed in two passes (once after the first matrix, once after the re-runs and cmdline captures):

```
=== BEFORE: count = 22 ===
=== AFTER:  count = 0 ===
  none remain

=== BEFORE: count = 7 ===
=== AFTER:  count = 0 ===
  NONE remain
```

Command used: `Remove-Item -LiteralPath <dir> -Recurse -Force` over `probe-{a_,b_,t_,call_,cap_}*` in `$env:TEMP`. Final state verified: **0 remaining**.

### Claude's own transcripts

Left in place, as the task permits (Claude wrote them). Copies were taken into `.omo/evidence/probe/runs/<run>/transcript.jsonl`; **all verified byte-identical** to originals at capture time.

### Registry / config integrity

- `store.json`: mtime **2026-10-26 18:18:51**, i.e. **before** this probe started (19:09). Zero matches for `probe-srv|probe_alpha|PROBE_DESC`. **Never written; nothing registered.**
- `~/.claude/settings.json`: mtime **2026-10-22 16:19:29** — untouched.
- Driving the adapter directly meant Termul's MCP registry was never involved at all.

### Worktree

```
$ git status --porcelain
?? .omo/
?? docs/roblox-studio-status-indicator.md
```

`docs/roblox-studio-status-indicator.md` was already untracked **before** this task (captured in the baseline at the start). **No changes under `src/` or `src-tauri/`.**

---

## 12. Reproducing this

Harness (left in place, dependency-free, single command per run):

```
.omo/evidence/probe/mcp-probe-server.mjs   # stdio MCP server, 2 (+N bulk) long-description tools
.omo/evidence/probe/acp-driver.mjs         # ACP v1 client: initialize -> session/new -> session/prompt
.omo/evidence/probe/run-matrix.mjs         # matrix runner + transcript analyser
.omo/evidence/probe/capture-mcp-config.mjs # captures the real --mcp-config handed to claude.exe
.omo/evidence/probe/runs/<run>/            # per-run config, request, result, acp log, stderr, transcript, analysis
```

```
cd .omo/evidence/probe
node run-matrix.mjs --runs t_on,t_off      # the decisive A' contrast
node run-matrix.mjs --runs all             # everything
```

Note the driver's `placement` field is the load-bearing one; `meta` means the probe server is carried **only** in `_meta` with an empty ACP array.

---

## 13. What I am still unsure about

1. **Version skew.** The adapter spawns the SDK's **bundled** `claude.exe` **2.1.309** (`claude-agent-sdk-win32-x64\claude.exe`, sha256 `5441781F…` matching `manifest.json`), **not** the user's `~/.local/bin/claude.exe` **2.1.296**. This is the real product path, so the result is the one that matters — but a conclusion stated as "claude.exe 2.1.296 honours `alwaysLoad`" would be unsupported by this probe.
2. **Real Studio, not a fake server.** I proved the mechanism with a synthetic stdio server. I did not run it against `StudioMCP.exe`, and per the task constraints I did not touch Studio. Studio's 28 tools are far larger than my truncated pair, so the eager-load token cost (~13,919 per `06`) is unmeasured here.
3. **One slow-handshake sample.** The 9 s case still loaded eagerly, but n=1; behaviour past ~9 s or with `MCP_CONNECT_TIMEOUT_MS` tuned is unknown.
4. **Model-dependence.** All runs used the same model/session defaults. The `alwaysLoad` path is pre-request bookkeeping, so model-dependence is unlikely — but untested across models.
5. **`b_auto` remains partly opaque.** I can state deterministically what happened (reminder present, 43-tool post-search shape) but not why the shape shows eager tools while the reminder still lists them. I have **not** treated `b_auto` as evidence for either verdict.
6. **Token cost of the real fix.** A′ on 28 Roblox tools adds the eager schemas to every request. `t_on` shows eager schemas ~4.7× the deferred-request description total (20,837 vs 4,393 approx tokens) — indicative, not the real Roblox number.
