# Roblox Studio Status Indicator — Implementation Brief

> **For a new session.** Everything here is verified against the repo at commit
> `04ac8e48` (branch `dev`). Where something is assumed rather than measured, it
> is marked **UNVERIFIED**.

---

## 1. Goal

Show whether Roblox Studio is connected in Termul's status bar, so a user knows
before starting a chat instead of discovering it after a failed turn.

**In scope:** a connection lamp + the open place's name.
**Out of scope:** tool count (explicitly dropped by the user).

---

## 2. What already exists (do not rebuild)

The Roblox entry in the Rail is done and pushed. Read these first:

| File | Lines | What it does |
|---|---|---|
| `src-tauri/src/roblox.rs` | 298 | `StudioMCP.exe` discovery + workspace resolution + icon |
| `src/renderer/lib/roblox-studio-mcp.ts` | 93 | `ensureRobloxStudioMcp()`, `ensureRobloxProject()` |
| `src/renderer/lib/tauri-roblox.ts` | 32 | `createRobloxApi()` — `studioPath()`, `workspacePath()` |
| `src/renderer/lib/roblox-studio-mcp.test.ts` | 191 | 12 tests |
| `src/renderer/lib/tauri-roblox.test.ts` | 53 | 3 tests |

Existing public surface in `roblox.rs`:

```rust
pub const STUDIO_MCP_EXE_ENV: &str = "STUDIO_MCP_EXE";   // :11
pub const WORKSPACE_DIR_NAME: &str = "RobloxKit";         // :14
pub fn find_studio_mcp() -> Option<PathBuf>               // :29
pub fn find_studio_mcp_in(override, local_app_data)       // :39  (testable core)
pub fn status() -> RobloxStudioStatus                     // :57
pub fn roblox_studio_path() -> RobloxStudioStatus         // :72  (command)
pub fn resolve_workspace_in(home, local_app_data)         // :88
pub fn workspace_candidates_in(home, local_app_data)      // :102
pub fn roblox_workspace_path() -> Option<String>          // :119 (command)
```

Registered commands: `lib.rs:1923-1924` (`roblox_studio_path`, `roblox_workspace_path`).

**Nothing here polls or keeps a live MCP connection.** This brief adds that.

---

## 3. Measured facts (do not re-derive)

Measured on this machine against `StudioMCP.exe` 8,224,208 bytes
(`version-7aaa6838d36c4448`) with Studio running:

| Operation | Measured | Notes |
|---|---|---|
| `spawn` + `initialize` | **69 ms** | far cheaper than assumed |
| `tools/call list_roblox_studios` (1st) | **2 ms** | |
| `tools/call list_roblox_studios` (2nd–4th) | **1 ms** | connection stays warm |
| `tools/list` | **2 ms** | 28 tools |
| Process RSS | ~14 MB | |

`list_roblox_studios` payload when Studio is open:

```json
{"studios":[{"id":"2f697dcc-c4a5-49d6-823b-176b28cf2f51",
             "name":"Untitled Experience (placeId: 93291914711483)"}]}
```

So the place name is `studios[0].name` — it already carries the placeId.

`initialize` result: `serverInfo = {"name":"RobloxStudio","version":"1.0.0"}`.
Protocol used in the probe: `2025-11-25`.

> **Correction worth keeping:** an earlier estimate said spawn costs ~2 s. That
> was PowerShell `Start-Process` overhead, not the real cost. The real number is
> 69 ms. Do not design around the wrong number.

---

## 4. Design decided with the user

**Keep `StudioMCP.exe` alive** while the Roblox project is active (14 MB), so
polling costs 1–2 ms instead of a respawn. Kill it when the user leaves the
Roblox project.

**Tiered polling** — cheap check first, expensive call only when it can pay off:

| State | Check | Interval |
|---|---|---|
| Just clicked Roblox | spawn + `list_roblox_studios` | immediately (69 ms) |
| Studio process running, connected | `list_roblox_studios` on the live child | **30 s** |
| Studio process not running | process check only | **5 s** |

Rationale for 5 s when down: the user may open Studio after clicking Roblox, and
should not wait a minute. 5 s of a process check is ~1 ms.

The user explicitly rejected a flat 1-minute interval for this reason.

---

## 5. Implementation plan

### 5.1 Rust — a live Studio connection

New module or an addition to `roblox.rs` (respect the ~800-line rule in
`AGENTS.md:29`; `roblox.rs` is at 298, so adding here is fine for now).

Needs a **process-wide singleton** holding the child + its stdin/stdout, because
the status command is called repeatedly.

Suggested shape:

```rust
pub struct StudioSession {
    child: tokio::process::Child,
    stdin: ChildStdin,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
    initialized: AtomicBool,
}
```

Requirements:
- `initialize` once, then `notifications/initialized`
- newline-framed JSON-RPC 2.0 over stdio
- a background read loop resolving `pending` by `id`
- `list_roblox_studios()` → `Result<Vec<StudioEntry>, String>`
- a `Drop`/`shutdown()` that kills the child (Termul already does
  `taskkill /T /F` for agent trees — see `acp::AcpClient::stop` in the reference
  project for the Windows pattern)
- **Do not** hold the lock across an await that can block for seconds

### 5.2 Rust — process detection (the cheap tier)

Before spawning anything, answer "is Studio even running?" without MCP.

**UNVERIFIED:** the cheapest cross-platform way inside this crate. Options:
- `sysinfo` crate — check whether it is already a dependency before adding
- reuse whatever `process_util` offers (module exists at
  `src-tauri/src/process_util.rs`; its helpers were not read for this brief)
- Windows: `tasklist` / Toolhelp32 snapshot

Studio's process name is `RobloxStudioBeta` (verified: it appears in
`Get-Process`). Treat the name as a constant with a comment, since Roblox has
used `RobloxStudioBeta` for years.

### 5.3 Rust — the command

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RobloxStudioLiveStatus {
    pub installed: bool,      // StudioMCP.exe found
    pub running: bool,        // Studio process alive
    pub connected: bool,      // list_roblox_studios returned >= 1 studio
    pub place_name: Option<String>,
}

#[tauri::command]
pub async fn roblox_studio_live_status() -> RobloxStudioLiveStatus
```

Rules:
- never panic; every failure maps to a status field
- log with `log::info!`/`log::warn!`, **never** log the place name verbatim if it
  could carry user content — log a boolean + counts instead
- register in `lib.rs` next to `:1923`

### 5.4 Renderer — API + hook

Extend `src/renderer/lib/tauri-roblox.ts`:

```ts
liveStatus: () => Promise<IpcResult<RobloxStudioLiveStatus>>
```

Non-Tauri context returns `{ installed: false, running: false, connected: false, placeName: null }`.

New hook `src/renderer/hooks/use-roblox-studio-status.ts`:
- no polling when the active project is not the Roblox project
- interval 5 s when `!running`, 30 s when `running`
- clear the timer on unmount and on project switch
- one in-flight request at a time (skip a tick if the previous is unresolved)

### 5.5 Renderer — the indicator

Place it in `src/renderer/components/StatusBar.tsx`, **right side**, immediately
before `<ConnectionStatusIndicator />` at `:183`:

```tsx
{/* Right side — :177 */}
<div className="flex items-center gap-0.5 shrink-0">
  {project && !isMobileWebShell && <NeedsYouPill projectId={project.id} />}
  <RobloxStudioIndicator />          {/* ← new */}
  <ConnectionStatusIndicator />      {/* :183 */}
  ...
```

Copy the existing conventions:
- `STATUS_BAR_ITEM_CLASS`, `STATUS_BAR_HOVER_CLASS`, `StatusItem`,
  `StatusTooltip` (all in `StatusBar.tsx`, e.g. `:163-168`, `:199-207`)
- a 12px dot: green when `connected`, muted when `running` but not connected,
  dim when `!running`
- hide entirely when `!installed` (a machine without Roblox should not show it)
- hide when the active project is not the Roblox project

Visible text: the place name, truncated. Tooltip carries the full name plus the
reason when disconnected.

### 5.6 Tests

Follow `AGENTS.md:30` — sibling test files, never inline `#[cfg(test)] mod tests`.

Rust (`src-tauri/src/roblox_tests.rs` or a sibling of wherever the session lands):
- `initialize` then `list_roblox_studios` against a **mock child** (a script that
  speaks the two frames), not the real exe
- a child that never answers → command returns `connected: false`, no hang
- a child that dies mid-call → no panic
- process detection: Studio-name match is case-insensitive on Windows

Renderer:
- `tauri-roblox.test.ts` — `liveStatus` in and out of Tauri context
- hook test — interval switches 5 s → 30 s when `running` flips
- indicator test — renders nothing when `!installed`; green vs muted dot

**Never** write a test that spawns the real `StudioMCP.exe` in CI.

---

## 6. Constraints that will bite

| Constraint | Source |
|---|---|
| Files under ~800 prod lines | `AGENTS.md:29` |
| Sibling test files only | `AGENTS.md:30` |
| `log` for desktop Rust, never secrets/place contents | `AGENTS.md:15` |
| New renderer-callable command ⇒ adapter + `api.ts` + test | `parity-checklist.test.ts:237-272` |
| Desktop **and** web transports must both work | `AGENTS.md:27` |
| ≤50 changed files per PR, target `dev` | `AGENTS.md:12-14` |
| Windows-only feature; gate with `isTauriContext()` | `StudioMCP.exe` ships with Studio |

---

## 7. Traps already paid for in this project

1. **Single-instance locks by executable name**, not identifier
   (`lib.rs:1140`). Build and dev both produce `termul-manager.exe`, so dev
   silently exits while a build runs. Kill the other process first:
   `Get-Process termul-manager | Stop-Process -Force`.
2. **`cargo test --lib` cannot run on this machine** — the test binary dies with
   `STATUS_ENTRYPOINT_NOT_FOUND` (a DLL/entrypoint problem, reproducible on
   untouched modules like `path_validation`). Verify logic by copying the module
   into a throwaway crate without Tauri, or by `cargo check --lib`.
3. **Project history is scoped per project.** A Roblox chat does not appear while
   another project is active. Do not "fix" this by leaking chats across projects
   — that was tried and reverted.
4. **Project icons cache for 24 h** in `store.json` under
   `device/<id>/project-prefs`, not `projects.json`. Delete that key to force a
   re-resolve.
5. **`bun run dev`, not `npm run tauri dev`** (`package.json:53`). Vite serves
   `localhost:5180`.

---

## 8. Verification steps for the new session

```powershell
# 1. Compile
cd src-tauri; cargo check --lib

# 2. Logic tests (separate crate, because --lib cannot run here)
#    copy the module without #[tauri::command] + log:: macros into a temp crate

# 3. Renderer
bun run typecheck
bun run test --run src/renderer/lib/tauri-roblox.test.ts

# 4. Manual, with Studio open
#    - click Roblox in the Rail → indicator turns green with the place name
#    - close Studio → within 5 s the indicator goes dim
#    - reopen Studio → within 5 s it turns green again, no chat restart needed
```

---

## 9. Open questions to settle first

1. **Process detection method** — `sysinfo`, `process_util`, or a Windows
   snapshot? Check `Cargo.toml` before adding a dependency.
2. **Where the session lives** — append to `roblox.rs` (298 lines, room to grow)
   or a new `roblox/` dir? `AGENTS.md:29` prefers a dir once a file passes ~800.
3. **Should the lamp also appear for non-Roblox projects?** Recommendation: no.
   A user editing a normal project does not need Roblox status.
4. **Web surface** — `termul-server` runs on Linux, where Studio cannot exist.
   The indicator must render nothing there, not a broken state.
