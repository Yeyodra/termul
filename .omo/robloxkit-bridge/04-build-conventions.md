# 04 — Build, test and convention constraints

Every claim cites `file:line`.

## 1. Dependencies — nothing needs adding

`src-tauri/Cargo.toml`:

| Crate | Version / features | Line | Use for a Studio bridge |
|---|---|---|---|
| `serde` | 1 (`derive`) | `:85` | frame + tool types |
| `serde_json` | 1 | `:86` | MCP payloads |
| `reqwest` | 0.13 (`json, rustls, http2, stream`) | `:91` | only if an HTTP leg is needed |
| `tokio` | 1 (`full`, `test-util`) | `:101` | runtime |
| `agent-client-protocol` | 1.3 (`unstable_auth_methods`, `unstable_elicitation`) | `:116` | `McpServer`, `McpServerStdio`, `HttpHeader` |
| `rmcp` | 3.5.0 — see below | `:132` | MCP client **and** server |
| `axum` | 0.8 (`ws`) | `:187` | web/server surface |
| `uuid` | 1 (`v4`, `serde`) | `:160` | token/provisional sid |
| `log` | 0.4 | `:183` | logging |

### The `rmcp` feature set is already correct (`Cargo.toml:132-141`)

```toml
rmcp = { version = "3.5.0", features = [
    "client",
    "transport-child-process",
    "transport-streamable-http-client-reqwest",
    "client-side-sse",
    "server",
    "transport-io",
    "macros",
    "auth",
] }
```

Decoded for this task:

| Feature | Enables | Needed by |
|---|---|---|
| `client` + `transport-child-process` | `TokioChildProcess` MCP **client** | talking to `StudioMCP.exe` over stdio |
| `server` + `transport-io` | `rmcp::transport::io::stdio()` MCP **server** | the host-injected child |
| `macros` | `#[tool]`, `#[tool_router]`, `#[tool_handler]` | child tool definitions |
| `transport-streamable-http-client-reqwest` + `client-side-sse` | HTTP/SSE client | `mcp_probe.rs` |
| `auth` | OAuth flows | `mcp_oauth.rs` |

**Both directions a Studio bridge needs are already compiled in.** No
`Cargo.toml` change is required for either path (registry entry or host family).

`Cargo.toml:125-131` also documents the intent explicitly:
> "`src/acp/host_mcp/` — the host-injected `termul` MCP SERVER … Uses `server`,
> `transport-io` … and `macros`"

And notes `3.5.0` speaks MCP `2026-07-28` (`server/discover`) while still
accepting the legacy `initialize` handshake — relevant because `StudioMCP.exe`
advertises `protocolVersion: "2025-11-25"` (RobloxKit `AGENTS.md:270`).

> **This is a real compatibility question, not a formality.** The RobloxKit clone
> pinned `2025-11-25` when talking to `StudioMCP.exe` (`studio.rs:31`). Termul's
> `rmcp` client is newer. Whether `rmcp` 3.5 negotiates `2025-11-25` cleanly with
> `StudioMCP.exe` is **UNVERIFIED** — it is the first thing Phase 1 should prove.

## 2. Two entrypoints, both must branch

| Binary | File | Branch |
|---|---|---|
| desktop `termul-manager` | `src-tauri/src/main.rs` | `:24` `if termul_manager_lib::host_mcp::is_child_invocation()` |
| standalone `termul-server` | `src-tauri/src/server_main.rs` | same helper (`child.rs:3-8`) |

Must run **before** Tauri/app init (`main.rs:18-24`). The helper matches the flag
at any argv position so the binaries cannot drift (`host_mcp/mod.rs:56-62`).

## 3. Command registration

`src-tauri/src/lib.rs:1911`:
```rust
.invoke_handler(host_perimeter::main_webview_only(tauri::generate_handler![
```
Note the `main_webview_only` wrapper. Handlers live in
`src-tauri/src/commands/` (29 files) and `src-tauri/src/acp/commands.rs`.

> UNKNOWN: how a command becomes reachable on the **web/`termul-server`**
> transport. `src-tauri/src/web/` and `commands/remote.rs` exist; the mapping was
> not traced. AGENTS.md:27 requires both transports, so confirm before adding a
> renderer-callable command.

## 4. Capabilities

`src-tauri/capabilities/` exists but was **not read**. UNKNOWN which permissions a
new command needs. Compare against an existing command before shipping.

## 5. Test layout rule — verified

`AGENTS.md:30`: sibling `<name>_tests.rs` or `<name>/tests.rs`, never inline
`#[cfg(test)] mod tests` in the production file.

Followed consistently:
- `acp/host_mcp/tests.rs`, `child/tests.rs`, `parent/tests.rs`, `bridge/tests.rs`
- `data_lock_tests.rs`, `exit_cleanup_tests.rs`, `lib_tests.rs`,
  `webview_recovery_tests.rs`
- `commands/tests.rs`, `commands/terminal_tests.rs`, `commands/worktree_tests.rs`

`child.rs:653-654` and `parent.rs:660-661` use `#[cfg(test)] mod tests;` — a
*declaration* pointing at the sibling file, which is the prescribed form.

Integration tests: `src-tauri/tests/`.

## 6. File-size rule and current headroom

`AGENTS.md:29`: keep files under ~800 prod lines; split into `<name>/` dirs.

| File | Lines | Note |
|---|---|---|
| `acp/host_mcp/child.rs` | 654 | ~146 headroom — **do not grow it** |
| `acp/host_mcp/parent.rs` | 661 | ~139 headroom |
| `acp/host_mcp/mod.rs` | 505 | ~295 headroom |
| `acp/manager/mod.rs` | 2277 | already ~2.8× over, mitigated by the `manager/` dir |

A Studio family belongs in its own `host_mcp/studio_tools.rs` +
`host_mcp/parent/studio.rs`, with ~3 lines of registration in `child.rs:131-143`.

## 7. Logging

`AGENTS.md:15`: `log` for desktop Rust, `tracing` for `termul-server`,
`src/renderer/lib/log-api.ts` for renderer; never log secrets.

Verified `log` in `host_mcp`: `parent.rs:152, 161, 170, 178, 187, 226, 241, 248,
263, 281, 382, 415, 424, 442, 469, 478`.

Redaction helper: `crate::logging::redact_session_id(...)` (`parent.rs:243, 250,
264, 283, 426-428, 463-464, 472-473, 481, 535, 572`).

Boundary-logging convention (`parent.rs:523-537`): log the **wire code + action +
argument KEY NAMES**, never values, citing CWE-532.

For Studio: log tool names and argument keys — **not** Luau source, place
contents, or asset ids that identify a user's game.

## 8. Dev commands and offline status

```
bun install
bun run dev          bun run test        bun run typecheck
bun run lint         bun run build
```
Rust: `cargo test` in `src-tauri/`.

Opt-in real-system tests use `--ignored` — established precedent:
`cargo test --lib -- --ignored real_server` (README, SSH section). A live-Studio
test should follow the same convention.

Lint is **Biome** (`biome.json`), not ESLint. Husky pre-commit hook exists.

`.cargo/config.toml` contains **only** a `rustflags` setting for the
async-process signal backend (`:13-14`); it does **not** configure offline or
vendored builds. So unlike the RobloxKit repo, `--offline` is not implied here.

## 9. Contribution limits that shape phasing

`AGENTS.md:12-14`:
- target `dev`, not `main`
- one real problem per PR
- **≤50 changed files** per PR
- split larger work into stacked PRs

A single "Studio support" PR touching host_mcp + renderer + capabilities + tests
would risk the budget. The phased plan in `05` keeps each step inside it.

## 10. Constraints summary

| Constraint | Implication |
|---|---|
| `McpServer::Stdio` is gate-free (`manager/gates.rs:43`) | use stdio, not http |
| `rmcp` already has client+server stdio features | no dep change |
| `rmcp` 3.5 speaks MCP `2026-07-28` | **must verify** against `StudioMCP.exe`'s `2025-11-25` |
| child branch before init, both binaries | a new subcommand touches two `main`s |
| sibling test files | no inline `mod tests` |
| ~800 lines | new module, not a bigger `child.rs` |
| `log` + redaction | tool names/keys only, never place contents |
| parity trio | a new Tauri command needs adapter + `api.ts` + test |
| ≤50 files/PR | phase the work |
