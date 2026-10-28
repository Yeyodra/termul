//! Locating Roblox's official `StudioMCP.exe` on this machine, and reporting
//! whether Studio is connected.
//!
//! The path lives under a per-install version directory
//! (`%LOCALAPPDATA%\Roblox\Versions\version-<hash>\StudioMCP.exe`), and that hash
//! changes on every Studio update. Callers must therefore resolve it each time
//! they need it instead of storing the path once.
//!
//! Submodules: [`process`] answers "is Studio running?" cheaply, [`session`]
//! keeps one MCP child alive across polls, and [`live_status`] composes them
//! into the command the status bar reads.

use std::path::PathBuf;

pub mod live_status;
pub mod place_key;
pub mod process;
pub mod session;

/// Environment override, mirroring the Node bridge's `STUDIO_MCP_EXE`.
pub const STUDIO_MCP_EXE_ENV: &str = "STUDIO_MCP_EXE";

/// The stable command token the MCP registry stores for the Roblox bridge.
///
/// The registry entry cannot hold the real `StudioMCP.exe` path: Roblox moves it
/// to a new `version-<hash>` directory on every update, so a stored path goes
/// stale and the entry silently stops spawning (the badge reads "Unreachable"
/// while a freshly resolved path still works). The entry therefore stores this
/// token and every spawn site expands it through [`resolve_known_command`].
///
/// Kept identical to the server `name` the renderer registers
/// (`ROBLOX_STUDIO_MCP_ID`), so a user reading the registry sees one string.
pub const STUDIO_MCP_COMMAND_TOKEN: &str = "roblox-studio";

/// Directory name under `Documents` (and under local app data on fallback).
pub const WORKSPACE_DIR_NAME: &str = "RobloxKit";

/// Result of a discovery pass, as the renderer sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[allow(non_snake_case)] // wire format is camelCase for the frontend
pub struct RobloxStudioStatus {
    pub found: bool,
    pub exePath: Option<String>,
}

/// Scan the Roblox install tree for `StudioMCP.exe`.
///
/// `STUDIO_MCP_EXE` wins when it names an existing file, matching the Node
/// bridge in the reference project. Returns `None` when Studio is not installed.
#[must_use]
pub fn find_studio_mcp() -> Option<PathBuf> {
    find_studio_mcp_in(
        std::env::var_os(STUDIO_MCP_EXE_ENV).map(PathBuf::from),
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
    )
}

/// Testable core of [`find_studio_mcp`]: takes the env-derived roots so a test
/// never has to mutate the process environment.
#[must_use]
pub fn find_studio_mcp_in(override_path: Option<PathBuf>, local_app_data: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(candidate) = override_path.filter(|p| !p.as_os_str().is_empty() && p.exists()) {
        return Some(candidate);
    }

    let base = local_app_data?.join("Roblox").join("Versions");
    let entries = std::fs::read_dir(base).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path().join("StudioMCP.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Expand a registry command token into the executable it names, right now.
///
/// `None` means "not a known token, treat the command literally": a normal
/// `npx`/absolute-path server passes through untouched, so this stays a no-op
/// for every MCP server that is not the Roblox bridge.
///
/// Resolution happens per call on purpose. The whole point is that the answer
/// changes when Roblox updates, so caching it anywhere would reintroduce the
/// stale-path bug this exists to remove.
#[must_use]
pub fn resolve_known_command(command: &str) -> Option<PathBuf> {
    resolve_known_command_in(command, find_studio_mcp())
}

/// Testable core of [`resolve_known_command`]: takes the already-resolved
/// Studio path so a test never has to mutate the process environment.
#[must_use]
pub fn resolve_known_command_in(command: &str, studio: Option<PathBuf>) -> Option<PathBuf> {
    match command {
        STUDIO_MCP_COMMAND_TOKEN => studio,
        _ => None,
    }
}

/// The renderer-facing status.
#[must_use]
pub fn status() -> RobloxStudioStatus {
    match find_studio_mcp() {
        Some(path) => RobloxStudioStatus {
            found: true,
            exePath: Some(path.to_string_lossy().into_owned()),
        },
        None => RobloxStudioStatus {
            found: false,
            exePath: None,
        },
    }
}

/// `roblox_studio_path` — reports whether Studio is installed and where.
#[tauri::command]
pub fn roblox_studio_path() -> RobloxStudioStatus {
    let status = status();
    log::info!(
        "[roblox] StudioMCP discovery: found={} (path redacted: it contains the user profile)",
        status.found
    );
    status
}

/// The workspace a Roblox chat runs in, mirroring the reference app's
/// `$DOCUMENT/RobloxKit`. Resolved from the OS home directory so it works for
/// any user, and created on first use.
///
/// `Documents` is redirected to OneDrive on many Windows setups; when it is not
/// writable the caller falls back to the local app data directory.
#[must_use]
pub fn resolve_workspace_in(home: Option<PathBuf>, local_app_data: Option<PathBuf>) -> Option<PathBuf> {
    let candidates = workspace_candidates_in(home, local_app_data);
    for dir in candidates {
        if std::fs::create_dir_all(&dir).is_ok() {
            return Some(dir);
        }
        log::warn!("[roblox] could not create the workspace directory; trying the next candidate");
    }
    None
}

/// Every place a Roblox workspace may live, most preferred first. Split out so a
/// test can assert the ordering without touching the filesystem.
#[must_use]
pub fn workspace_candidates_in(
    home: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut out = Vec::with_capacity(2);
    if let Some(home) = home.filter(|p| !p.as_os_str().is_empty()) {
        out.push(home.join("Documents").join(WORKSPACE_DIR_NAME));
    }
    if let Some(local) = local_app_data.filter(|p| !p.as_os_str().is_empty()) {
        out.push(local.join(WORKSPACE_DIR_NAME));
    }
    out
}

/// `roblox_workspace_path` — the directory a Roblox chat runs in, created if
/// missing. `None` when no candidate directory could be created.
#[tauri::command]
pub fn roblox_workspace_path() -> Option<String> {
    let resolved = resolve_workspace_in(home_dir(), std::env::var_os("LOCALAPPDATA").map(PathBuf::from));
    if let Some(dir) = resolved.as_ref() {
        write_workspace_icon(dir);
    }
    log::info!(
        "[roblox] workspace resolved: {} (path redacted: it contains the user profile)",
        resolved.is_some()
    );
    resolved.map(|path| path.to_string_lossy().into_owned())
}

/// Roblox mark for the workspace's project icon. `project_icon::local` scans
/// `icon.svg` in the project root, so the Roblox project matches the Rail row.
/// White tile + black mark: the outline alone is invisible on the dark Rail.
const WORKSPACE_ICON: &str = r##"<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="#ffffff"/><g fill="none" stroke="#000000" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M41.2648,12.6719,14.7123,5.5572a1.666,1.666,0,0,0-2.04,1.178L5.5572,33.2877a1.666,1.666,0,0,0,1.178,2.04l26.5525,7.1147a1.666,1.666,0,0,0,2.04-1.178l7.1147-26.5525a1.666,1.666,0,0,0-1.178-2.04Z"/><path d="M29.3193,20.51l-8.1808-2.192a.5133.5133,0,0,0-.6287.3629l-2.192,8.1808a.5133.5133,0,0,0,.3629.6287l8.1808,2.192a.5133.5133,0,0,0,.6287-.3629l2.192-8.1808A.5133.5133,0,0,0,29.3193,20.51Z"/></g></svg>"##;

/// Write the icon only when the root has none, so a user's own icon wins.
fn write_workspace_icon(dir: &std::path::Path) {
    let target = dir.join("icon.svg");
    if target.exists() {
        return;
    }
    if let Err(error) = std::fs::write(&target, WORKSPACE_ICON) {
        log::warn!("[roblox] could not write the workspace icon: {error}");
    }
}

/// The OS home directory, without pulling in a new crate.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .filter(|p| !p.as_os_str().is_empty())
}

#[cfg(test)]
#[path = "roblox_tests.rs"]
mod tests;
