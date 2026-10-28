# 04 — Session Forensics: What the Agent Actually Did in the Roblox Project

**Scope:** read-only forensic analysis of Termul's persisted ACP session data.
**Machine:** this Windows host. **Analysis date basis:** session timestamps of 2026-10-26.
**Author of this document:** forensic pass, no data was modified.

---

## 0. Sources and method

| Source | Path | Role |
|---|---|---|
| Project registry | `C:\Users\Novella\AppData\Roaming\com.termul-manager.app\projects.json` | confirms Roblox project |
| Settings store | `...\com.termul-manager.app\store.json` | MCP registry (`data."shared/lww/acp/mcp-servers"`) |
| Session index | `...\acp-sessions\sessions.json` | messageCount / toolCount / model / cwd / status |
| Session metadata | `...\acp-sessions\<storageKey>\metadata.json` | per-session duplicate of index |
| Transcript | `...\acp-sessions\<storageKey>\messages.jsonl` | agent text + thoughts (token-streamed) |
| Tool log | `...\acp-sessions\<storageKey>\tool-calls.jsonl` | tool_call / tool_call_update records |
| **Corroborating source** | `C:\Users\Novella\.claude\projects\C--Users-Novella-Documents-RobloxKit\<sessionId>.jsonl` | Claude Code's own transcript for the same sessions |
| Files on disk | `C:\Users\Novella\Documents\robloxkit\` | artifact check |

### 0.1 Critical method note — Termul's `tool-calls.jsonl` does NOT record tool names

This is the single most important methodological finding, because it shapes every answer below.

`tool-calls.jsonl` records only `payload.toolCall.toolCallId` and sometimes `payload.toolCall.kind`
(`execute` / `edit` / `read`). **It contains no `title`, no tool name, no `rawInput`, and no
tool-result body.** Verified by exhaustive search:

```
'\"title\"'    : 0 lines in both files
'rawInput'    : 0 lines in both files
```

Record shapes present (c69f / 18af):

| Record type | c69f | 18af | Carries |
|---|---|---|---|
| `tool_call` | 15 | 64 | `toolCallId`, optional `kind` |
| `tool_call_update` | 68 | 309 | `toolCallId`, optional `status`, optional `locations`+`diffStat` |

`kind` is **absent** on many calls — c69f: 3 of 15; 18af: **50 of 64**. So `kind` cannot even
reliably distinguish "MCP tool" from "shell command". Any claim that the tool names are
"enumerated from tool-calls.jsonl" would be false. Tool identity had to be recovered by joining
`toolCallId` against the Claude Code transcript, where the ids match **1:1** (see §2.2).

`messages.jsonl` is also token-streamed: 7,527 `message_chunk` lines for c69f collapse to 15
message ids; 32,192 lines for 18af collapse to 47 message ids. Naive grep for phrases returns
false negatives because words are split across chunks (`"Ro"` + `"jo"` + `"/"` + `"Studio"`).
All quotes below were reconstructed by concatenating chunks in `seq` order, splitting on
`(messageId, role)` boundaries.

---

## 1. Session summary table

Project id `7394e2d1-9aa0-4627-9a9c-32131ca1633e` — name **Roblox**, path `\\?\C:\Users\Novella\Documents\robloxkit`.

| Field | Session A | Session B |
|---|---|---|
| `storageKey` | `c69f0013-c474-4aa1-b113-8970cfd772ae` | `18af4721-6966-49c4-9ed1-8872e97fc55e` |
| `sessionId` | `0f548212-a22c-4d10-a12c-1f435283b0c9` | `7c9959bf-40ae-4b7b-8c5e-9fb0cb8a4fdb` |
| agent namespace | `config:acp-registry:claude-acp` | `config:acp-registry:claude-acp` |
| `modelId` / `modelName` | `opus` / **Opus 5.5** | `opus` / **Opus 5.5** |
| `cwd` | `C:\Users\Novella\Documents\robloxkit` | `C:\Users\Novella\Documents\robloxkit` |
| `status` | `active` | `active` |
| **`messageCount`** (index) | **18** | **84** |
| **`toolCount`** (index) | **72** | **373** |
| `lastSeq` | 6747 | 32714 |
| title (final) | `cek koneksi mcp robloxstudio` | `bntr,coba lo ganti bajunya menjadi logo barcelona` |
| title history | `buatkan gw objek meja` (seq 5204) → `cek koneksi mcp robloxstudio` (seq 6746) | `cek koneksi robloxstudio` → `coba buat npc` → `rig jelek,build from scratch aja` → `hmm,coba lo polish lg design npc nya deh` → `bntr,coba lo ganti bajunya menjadi logo barcelona` |
| created / last activity (local) | 2026-10-26 13:00:41 / 13:10:13 | 2026-10-26 12:46:35 / 12:59:22 |
| prompt mode | `bypassPermissions` | `bypassPermissions` |

### 1.1 What `messageCount` / `toolCount` actually count

`toolCount` is **not** a count of tool invocations — it is a count of *log records* in
`tool-calls.jsonl` with `seq <= lastSeq`:

* c69f: 72 records = 15 `tool_call` + 57 `tool_call_update` → **15 real tool calls**
* 18af: 373 records = 64 `tool_call` + 309 `tool_call_update` → **64 real tool calls**

`messageCount` likewise does not match distinct messages:

* c69f: index says 18; `messages.jsonl` has **15 distinct messageIds** + 2 `user_prompt` = 17; 20 role-split text segments.
* 18af: index says 84; `messages.jsonl` has **47 distinct messageIds** + 5 `user_prompt` = 52; 79 role-split text segments.

**Verdict: `messageCount` and `toolCount` in `sessions.json` are record/segment counters, not
semantic counts. Quote the real numbers (15 and 64 tool calls) instead.** Exact counting rule
used by Termul for `messageCount` is **UNVERIFIED**.

---

## 2. Every tool the agent actually invoked

### 2.1 Termul-side view (what is provable from Termul alone)

Distinct tools, by `kind` only:

| `kind` | c69f | 18af |
|---|---|---|
| `execute` | 8 | 14 |
| `edit` | 2 | 0 |
| `read` | 2 | 0 |
| **absent** | **3** | **50** |
| total `tool_call` records | 15 | 64 |

Roblox/MCP tools identifiable from `tool-calls.jsonl` alone: **0**. Termul never wrote a tool name.

### 2.2 Ground-truth tool inventory (joined via `toolCallId`)

All 15 c69f ids and all 64 18af ids appear verbatim in the Claude Code transcripts, which do
carry `tool_use.name`. Join is exact, so the mapping below is **verified**, not inferred.

**Session A — c69f0013 (`buatkan gw objek meja` → `cek koneksi mcp robloxstudio`), 15 calls:**

| Count | Tool | Turn |
|---|---|---|
| 3 | `Bash` | T1 |
| 2 | `Write` | T1 |
| 1 | `Read` | T1 |
| 1 | `ToolSearch` | T2 |
| 5 | `Bash` | T2 |
| 1 | `Read` | T2 |
| 1 | `mcp__roblox-studio__list_roblox_studios` | T2 |
| 1 | `mcp__roblox-studio__get_studio_state` | T2 |

**Session B — 18af4721, 64 calls:**

| Count | Tool |
|---|---|
| **34** | `mcp__roblox-studio__execute_luau` |
| 14 | `Bash` |
| **6** | `mcp__roblox-studio__start_stop_play` |
| **5** | `mcp__roblox-studio__screen_capture` |
| 3 | `ToolSearch` |
| 1 | `mcp__roblox-studio__list_roblox_studios` |
| 1 | `mcp__roblox-studio__get_studio_state` |

Per-turn breakdown for Session B:

| Turn | Prompt | Calls | Composition |
|---|---|---|---|
| T1 | `cek koneksi robloxstudio` | 7 | 7× Bash (no MCP) |
| T2 | `coba buat npc` | 7 | 1 ToolSearch, 1 Bash, `list_roblox_studios`, `get_studio_state`, 3× `execute_luau` |
| T3 | `rig jelek,build from scratch aja` | 30 | 20× `execute_luau`, 4× `start_stop_play`, 5× Bash, 1 ToolSearch |
| T4 | `hmm,coba lo polish lg design npc nya deh` | 19 | 12× `execute_luau`, 5× `screen_capture`, 2× `start_stop_play`, 1 Bash, 1 ToolSearch |
| T5 | `bntr,coba lo ganti bajunya menjadi logo barcelona` | 1 | 1× `execute_luau` (turn `cancelled`) |

### 2.3 Distinct Roblox/Studio MCP tool **names** invoked

| Session | Distinct MCP tool names | MCP calls |
|---|---|---|
| A (c69f) | 2 — `list_roblox_studios`, `get_studio_state` | **2** |
| B (18af) | 5 — `execute_luau`, `start_stop_play`, `screen_capture`, `list_roblox_studios`, `get_studio_state` | **47** |
| **Total** | **5 distinct** | **49** |

Match test against `roblox`, `execute_luau`, `mcp__`, `inspect_instance`:

* `inspect_instance` — **0 invocations** in either session (refuted as an invoked tool; it *was* available, see §5).
* `mcp__*` / `roblox*` — **49 invocations** in total.

**This refutes the expectation of ZERO.** The agent did drive Studio: 34 `execute_luau`, 6
play-mode toggles, 5 viewport captures. However — and this is the important asymmetry — **all
49 of those MCP calls are in Session B, and only in turns T2–T5. Session A's first turn (the
"objek meja" request) made ZERO MCP calls.**

---

## 3. The confusion quotes — verbatim

These are the key evidence. All are from `messages.jsonl` of the stated session, reconstructed
from token chunks; `seq` ranges given so each quote is independently re-checkable.

### 3.1 Session A — "objek meja" — the agent never considered Studio reachable

`storageKey c69f0013-c474-4aa1-b113-8970cfd772ae`, messageId `msg-6067eb12-4709-405f-a30c-08dca6993985`, **role = `thought`**,
seq **255–3836** (3,582 chunks, 11,913 chars).

> "The directory is essentially empty — a Roblox kit project (icon suggests Roblox Studio plugin).
> The user asks in Indonesian slang: "buatkan gw objek meja" = "make me a table object".
>
> **Ambiguous: Roblox Lua script that builds a table model? Or a 3D model file (.obj)?** Given
> the folder is "robloxkit" with a Roblox Studio-ish icon, likely they want a Roblox Luau script
> that creates a table object in the workspace.
>
> This is genuinely ambiguous but the context strongly suggests Roblox. However, "objek meja"
> could mean an ObjectBuilder/OBJ file. Hmm. I could ask, but the guidance says prefer concrete
> answers, ask when ambiguous instead of guessing silently. [...] **I think the sensible move: produce
> a Roblox Luau module that builds a table (meja) Model with parts** [...]"

Then, decisively, the same thought stream at seq 255–3836 continues:

> "**No Lua interpreter, so I can't run/test. Be honest about that.**"
> "**Should I mention Roblox Studio not available to test? Yes.**"
> "**I could also verify syntax with a quick luau parse... not available. I'll state I couldn't run it.**"

### 3.2 Session A — the shipped answer, "folder ini nggak ada project Rojo/Studio"

`messageId msg-c61adeb2-6f44-408d-9d3d-27c0fe6734f1`, **role = `agent`** (user-visible),
seq **4052–5201**. The phrase is split across chunks at lines 4644–4648
(`Ro` / `jo` / `/` / `Studio`) — hence a naive grep for `Rojo` returns 0 hits.

> "Gw bikin modul pembuat meja (Luau, Roblox), bukan model `.rbxm` — **karena di folder ini
> nggak ada project Rojo/Studio**, jadi yang paling kepake adalah script yang bisa langsung lo
> `require`."
>
> "**Yang belum gw lakuin:** nggak ada interpreter Lua/Roblox Studio di mesin ini, jadi kodenya
> **belum gw jalanin/test**."

**This is the strongest single piece of evidence.** At the moment the agent wrote that sentence,
Roblox Studio was running and connected — Session B had already used it 47 times minutes earlier
(12:46-12:59, last call 12:59:03, vs. this sentence at 13:02:35). The agent asserted the absence purely from
`ls` output of an empty directory, never calling `list_roblox_studios`.

### 3.3 Session B — turn 1, same misreading of "robloxstudio"

`messageId msg-50b0b122-8490-4a8f-a90c-112f8c8a1edb`, **role = `thought`** (first block),
seq 8–107.

> "The user asks in Indonesian: "cek koneksi robloxstudio" — check Roblox Studio connection.
> **This is ambiguous.** They might want me to check **network connectivity to Roblox Studio
> servers from this machine**. [...] Let me just do a practical check: **ping/curl to Roblox domains.**"

The user-visible reply (same messageId, `agent`, seq 107–127):

> "Saya cek konektivitas ke server Roblox dari mesin ini. Sebentar."

Result: 7 `Bash` calls (curl/ping/netstat/tasklist), **0 MCP calls**, and a confident report about
CDN latency and TCP handshakes — not about the Studio MCP bridge the user meant.

### 3.4 Session B — the agent finds the bridge only after thinking about it twice

Same turn 1, `thought`, seq 433–631:

> "The user says "coba buat npc" [...] There's an MCP plugin bridge on localhost:13469. So they
> likely want me to create an NPC in their open Roblox Studio via MCP. **Let me check what tools
> are available.** There's a deferred tool list maybe. **Let me search for roblox/mcp tools.**"

Only then (seq 1509) does it call `ToolSearch` with query `"roblox studio luau execute script"`.
From that point onward it used MCP correctly. There is no equivalent "second thought" in Session A.

---

## 4. Files created on disk

The agent chose **"write .lua files to disk"** in Session A, and **driving Studio** in Session B.
Both paths exist; they are in different sessions.

### 4.1 Files written (Session A only)

Two `Write` tool calls (ground truth), matching Termul's two `edit` records:

| `toolCallId` | Path | Bytes | Termul record |
|---|---|---|---|
| `call_00_jkfm3BWIT3ioDTGnk4a12358` | `/c/Users/Novella/Documents/robloxkit/src/Meja.lua` | 4,184 | seq 3837 `kind=edit`, update seq 3839 `diffStat {added:151, removed:0}`, `locations: [{"path":"/c/Users/Novella/Documents/robloxkit/src/Meja.lua"}]` |
| `call_01_IWmtbWeG2AOqDMfjNM825872` | `/c/Users/Novella/Documents/robloxkit/src/contoh-pakai.server.lua` | 769 | seq 3840 `kind=edit`, update seq 3844 `diffStat {added:30, removed:0}`, `locations: [{"path":"/c/Users/Novella/Documents/robloxkit/src/contoh-pakai.server.lua"}]` |

Tool results confirm creation:

```
File created successfully at: /c/Users/Novella/Documents/robloxkit/src/Meja.lua
File created successfully at: /c/Users/Novella/Documents/robloxkit/src/contoh-pakai.server.lua
```

### 4.2 Current on-disk state of `C:\Users\Novella\Documents\robloxkit`

```
.codegraph              (symlink -> C:\Users\Novella\.omo\codegraph\projects\robloxkit-5b7bac0987bbbe83)
.omo\
.omo\run-continuation\ses_ed93ef898ffeOzKhOYhBW6SHKc.json   214 B
src\
src\Meja.lua                                              4184 B   2026-10-26 13:01:18
src\contoh-pakai.server.lua                                769 B   2026-10-26 13:01:20
icon.svg                                                   667 B
```

Byte sizes match the `Write` payloads exactly (4,184 / 769) and mtimes match the write
timestamps (13:01:18 / 13:01:20 local). **No other files were created.** Notably absent:
no `.rbxl`/`.rbxlx`, no `.rbxm`, no `default.project.json`, no `rojo` config.

### 4.3 What Session B created — not on disk

Session B created its artifacts **inside Roblox Studio's DataModel**, via `execute_luau`:

* `Workspace.NPC_Penjaga` — R6 rig, later rebuilt as "v2", with `PenjagaAI` server Script and nametag.
* Nothing was written into `C:\Users\Novella\Documents\robloxkit`.

**Verdict on Q4: yes — for the "objek meja" task the agent chose to write `.lua` files to disk
instead of driving Studio, and stated in its answer that Studio was not present. This was a
choice, not a capability limit: the same agent, in the same project, in the previous 16 minutes,
had 47 successful Studio MCP calls (last one at 12:59:03, i.e. 3m32s before this claim).**

---

## 5. Was `roblox-studio` MCP visible to the model? — YES

### 5.1 Registered in Termul

`store.json` → `data."shared/lww/acp/mcp-servers"`:

```json
{"v":{"_version":1,"data":[{
  "id":"roblox-studio","type":"stdio","name":"roblox-studio",
  "command":"C:\\Users\\Novella\\AppData\\Local\\Roblox\\Versions\\version-7aaa6838d36c4448\\StudioMCP.exe",
  "args":[],"env":[],"enabled":true}]},"rev":1}
```

Note: `projects.json` shows `"mcpServers": []` for the Roblox project, so this is a **global**
registration, not project-scoped. (Whether a project-scoped list would override it is **UNVERIFIED**.)

### 5.2 Hit counts in Termul transcripts (exact)

| Pattern | c69f `messages.jsonl` | c69f `tool-calls.jsonl` | 18af `messages.jsonl` | 18af `tool-calls.jsonl` |
|---|---|---|---|---|
| `roblox-studio` | **0** | **0** | **0** | **0** |
| `StudioMCP` | 0 | 0 | 0 | 0 |
| `list_roblox_studios` | 0 | 0 | 0 | 0 |
| `mcp__` | 0 | 0 | 0 | 0 |
| `execute_luau` | 0 | 0 | 0 | 0 |
| `inspect_instance` | 0 | 0 | 0 | 0 |
| `roblox` | 5 lines / 20 instances | 2 / 2 | 5 / 20 | 0 |
| `Rojo` (case-sens.) | 0 | 0 | 0 | 0 |

The `roblox` hits are all: the user's own prompts, session titles, and single-word chunks
(`" Studio"`, `"roblox"`) inside agent prose — never a tool name.

**So: in Termul's persisted data the string `roblox-studio` appears ZERO times.** A forensic pass
limited to Termul's files would conclude the MCP tools were never visible. That conclusion would
be **wrong**, and the reason matters: Termul's `tool-calls.jsonl` does not persist tool names at
all (§0.1), so absence of the string is an artifact of the logger, not evidence about the model.

### 5.3 Ground truth: the tools were in the model's context from the first request

From the Claude Code transcript, two independent proofs.

**(a) `deferred_tools_delta` attachment, emitted at session start.**
c69f, line 7, `ts=2026-10-26T06:00:42.131Z` - i.e. **one second after** the user typed
`buatkan gw objek meja` (line 4, `06:00:42.135Z`), and it precedes the first API call at
`06:00:43.198Z`. It lists **84** added tool names, including **28** `mcp__roblox-studio__*`
and **17** `mcp__roblox-mcp__*`:

```
mcp__roblox-studio__character_navigation     mcp__roblox-studio__execute_luau
mcp__roblox-studio__generate_material        mcp__roblox-studio__generate_mesh
mcp__roblox-studio__generate_procedural_model mcp__roblox-studio__generate_texture
mcp__roblox-studio__get_console_output       mcp__roblox-studio__get_studio_state
mcp__roblox-studio__http_get                 mcp__roblox-studio__insert_asset
mcp__roblox-studio__inspect_instance         mcp__roblox-studio__list_roblox_studios
mcp__roblox-studio__multi_edit               mcp__roblox-studio__screen_capture
mcp__roblox-studio__script_grep              mcp__roblox-studio__script_read
mcp__roblox-studio__script_search            mcp__roblox-studio__search_asset
mcp__roblox-studio__search_game_tree         mcp__roblox-studio__segment_mesh
mcp__roblox-studio__skill                    mcp__roblox-studio__start_stop_play
mcp__roblox-studio__store_image              mcp__roblox-studio__subagent
mcp__roblox-studio__upload_image             mcp__roblox-studio__user_keyboard_input
mcp__roblox-studio__user_mouse_input         mcp__roblox-studio__wait_job_finished
```

Also `pendingMcpServers`, `failedMcpServers`, `needsAuthMcpServers` were all **empty** — the
server was connected and healthy, not pending or failed.

A companion `mcp_instructions_delta` (line 9) adds instruction blocks for servers
**`roblox-mcp`, `roblox-studio`, `termul`** — so the server's own usage guidance was injected too.

**(b) The tools were actually callable, and grew over the session.**
`api-request-shape` records show the tool array size climbing:

| c69f | 18af |
|---|---|
| line 19 `06:00:43Z` — **15 tools** (no MCP) | line 19 `05:46:37Z` — **15 tools** (no MCP) |
| line 93 `06:07:35Z` — **25 tools** (10 × `roblox-studio`) | line 96 `05:48:00Z` — **25 tools** (incl. 8 `roblox-studio`) |
| — | line 241 `05:50:55Z` — **29 tools** (+`generate_procedural_model`, `start_stop_play`) |
| - | line 425 `05:55:23Z` - **36 tools** (+`screen_capture`, `search_asset`, `store_image`, `upload_image`, ...) |

The 15-tool baseline is `Agent, AskUserQuestion, Bash, Edit, Glob, Grep, ListAgents, Read,
ReportFindings, ScheduleWakeup, Skill, ToolSearch, Workflow, DeferredToolPlaceholder, Write` —
**no MCP at all**. MCP tools are `defer_loading: true`: their *names* are announced via the
`deferred_tools_delta` / system-reminder channel, and a `ToolSearch` call fetches the full
JSONSchema so they become directly invocable. `ToolSearch`'s own description states:

> "Deferred tools appear by name in `<system-reminder>` messages. Until fetched, only the name is
> known — there is no parameter schema, so the tool cannot be invoked."

### 5.4 The critical nuance: discoverable ≠ discovered

So the accurate statement is **not** "the MCP tools were invisible". It is:

1. The names **were** in context from the very first turn (`deferred_tools_delta`, 28
   `roblox-studio` names, emitted 1 s after the prompt).
2. They were **not** in the eager `tools[]` array (15 tools, no MCP).
3. To use them the model had to (a) notice the names and (b) call `ToolSearch` to fetch schemas.

Session B did this: `ToolSearch {"query":"roblox studio luau execute script","max_results":10}`
at seq 1509, after which the array jumped to 25 tools and calls succeeded.

Session A **never did**: its only `ToolSearch` was
`{"query":"roblox studio","max_results":10}` at seq 5290 — in **turn 2**, i.e. *after* it had
already written the two `.lua` files and after it had told the user "nggak ada project Rojo/Studio".
Session A turn 1 has **zero** `ToolSearch` calls.

**Therefore the "objek meja" failure was a discovery/latency failure, not an availability
failure.** The agent had the tool names, did not search them, and instead reasoned from `ls`.

---

## 6. User prompts, verbatim

### Session A — c69f0013 (2 prompts)

`seq 4`, `turnId 9527e77d-9815-41be-b73e-dc7647fda085`, recordedAt 1792994441779:

```json
{"type":"user_prompt","payload":{"turnId":"9527e77d-9815-41be-b73e-dc7647fda085",
 "content":[{"type":"text","text":"buatkan gw objek meja"}]}}
```

`seq 5206`, `turnId b568967c-d12e-403e-be5f-12d2b3cf2c04`, recordedAt 1792994849474:

```json
{"type":"user_prompt","payload":{"turnId":"b568967c-d12e-403e-be5f-12d2b3cf2c04",
 "content":[{"type":"text","text":"cek koneksi mcp robloxstudio"}]}}
```

Turn outcomes (`prompt_complete.stopReason`): T1 `end_turn` at seq 5205 (turnId `9527e77d-9815-41be-b73e-dc7647fda085`),
T2 `end_turn` at seq 6747 (turnId `b568967c-d12e-403e-be5f-12d2b3cf2c04`). Both turns completed normally.

### Session B — 18af4721 (5 prompts)

| seq | turnId | stopReason | text (verbatim) |
|---|---|---|---|
| 4 | `fd90bad8-be02-46c0-9e2f-94908f29bb3c` | `end_turn` | `cek koneksi robloxstudio` |
| 1312 | `9451566e-ef60-47af-92b8-7cb1a3d5c2c1` | `cancelled` | `coba buat npc` |
| 3614 | `7f1ab2c9-995e-4302-8866-e903b6faf7a8` | `end_turn` | `rig jelek,build from scratch aja` |
| 21896 | `5622895e-c0ce-4367-9d3f-24aa049d57ef` | `cancelled` | `hmm,coba lo polish lg design npc nya deh` |
| 30944 | `9f40ac6c-c96d-4e93-b76c-fa56a31736e0` | `cancelled` | `bntr,coba lo ganti bajunya menjadi logo barcelona` |

(The final prompt is stored exactly as `bntr,coba lo ganti bajunya menjadi logo barcelona`.)

---

## 7. Findings, ranked

1. **The agent told the user Studio was absent while Studio was connected.** Session A, agent
   message `msg-c61adeb2-6f44-408d-9d3d-27c0fe6734f1` (seq 4052–5201): *"karena di folder ini nggak ada project Rojo/Studio"*
   and *"nggak ada interpreter Lua/Roblox Studio di mesin ini"*. The offending sentence was written
   at **13:02:35 local** (seq 4644); Session B's 47 successful `mcp__roblox-studio__*` calls ran
   **12:46:41–12:59:03**, ending 3m32s before that sentence and all within the same project and
   the same Studio process. **Verified.**
2. **The MCP tool names were in context from the first second of Session A.** `deferred_tools_delta`
   at `06:00:42.131Z` lists 28 `mcp__roblox-studio__*` names, 1 s after the prompt and before the
   first API call; all MCP-server health fields empty. **Verified.**
3. **Session A turn 1 made 0 MCP calls and 0 `ToolSearch` calls**; it made 6 calls total
   (3 `Bash`, 2 `Write`, 1 `Read`) and produced 2 `.lua` files. **Verified.**
4. **The failure mode is deferred-tool discovery, not availability.** MCP tools are
   `defer_loading:true`; names are announced, schemas need `ToolSearch`. Session B ran `ToolSearch`
   and then succeeded; Session A ran it only in turn 2. **Verified.**
5. **Termul's `tool-calls.jsonl` cannot prove tool identity.** No `title`, no `rawInput`, no result
   body; `kind` missing on 3/15 and 50/64 records. Any tool-name claim requires the Claude Code
   transcript. **Verified.**
6. **`sessions.json` `toolCount`/`messageCount` are record counters, not semantic counts**
   (72 records = 15 calls; 373 = 64). **Verified.**
7. **Two `.lua` files were created and still exist**, byte-exact, mtime-matched. No `.rbxl(x)`,
   no `.rbxm`, no Rojo project. **Verified.**
8. **Session B's artifacts live only in Studio's DataModel** (`Workspace.NPC_Penjaga`), not on
   disk; their current persistence is **UNVERIFIED** (would require opening the place).
9. **The Barcelona request was refused in part on trademark grounds** - Session B, agent text
   seq 31519–31635: the agent declined to reproduce the FC Barcelona crest and instead built a
   "kit bergaya Blaugrana". The turn was `cancelled` after 1 `execute_luau` call. **Verified.**
10. **`inspect_instance` was available but never invoked** (0 calls), despite being the natural
    tool for "what's in this place". **Verified.**

## 8. Explicitly UNVERIFIED

* Exact rule Termul uses to compute `messageCount` (18 / 84) — does not equal distinct messages
  (17 / 52) nor role-split segments (20 / 79).
* Whether `store.json`'s global `roblox-studio` entry is what injected the server, vs. the host
  app injecting it directly. The agent itself concluded host-injection (Session A, seq 7104–7652)
  after finding no `.mcp.json` anywhere and no `roblox-studio` in `~/.claude.json`. That is the
  agent's finding, not an independent verification.
* Whether a project-scoped `mcpServers: []` would suppress a global server in Termul.
* Whether `Workspace.NPC_Penjaga` still exists in the place file.
* Any tool call whose `toolCallId` might be missing from both logs (none observed; 15/15 and
  64/64 matched, but a gap in a third writer cannot be excluded).
* Content of tool *results* for MCP calls other than the three inspected
  (`list_roblox_studios` ×2, `get_studio_state` ×2, `start_stop_play` ×6) — these were sampled,
  not exhaustively dumped.

---

## Appendix A — reproduction commands

```powershell
# 0) Confirm no tool names are persisted by Termul
Select-String -LiteralPath "...\c69f...\tool-calls.jsonl" -Pattern '"title"','rawInput'

# 1) Count real tool calls (not records)
Get-Content -LiteralPath "...\tool-calls.jsonl" |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.type -eq 'tool_call' } | Measure-Object

# 2) Recover tool names (requires Claude Code transcript)
#    join toolCallId -> tool_use.name
$p = "C:\Users\Novella\.claude\projects\C--Users-Novella-Documents-RobloxKit\0f548212-a22c-4d10-a12c-1f435283b0c9.jsonl"
Get-Content -LiteralPath $p | ForEach-Object {
  $o = $_ | ConvertFrom-Json
  $o.message.content | Where-Object { $_.type -eq 'tool_use' } |
    ForEach-Object { "{0}`t{1}" -f $_.id, $_.name }
}

# 3) Prove deferred-tool visibility at session start
Get-Content -LiteralPath $p | ForEach-Object {
  $o = $_ | ConvertFrom-Json
  if ($o.attachment.type -eq 'deferred_tools_delta') {
    $o.attachment.addedNames | Where-Object { $_ -like 'mcp__roblox-studio__*' }
  }
}

# 4) Prove tool-array growth (15 -> 25 -> 29 -> 36)
Get-Content -LiteralPath $p | ForEach-Object {
  $o = $_ | ConvertFrom-Json
  if ($o.type -eq 'api-request-shape') { "{0} tools={1}" -f $o.timestamp, $o.shape.tools.Count }
}
```


