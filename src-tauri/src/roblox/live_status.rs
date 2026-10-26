//! The status-bar lamp's answer: installed / running / connected / place name.
//!
//! Every failure maps to a field rather than an error, so the renderer always
//! has a state to paint. The place name is user content (it can be a private
//! experience title), so it is never logged — only booleans and counts.

use serde::Serialize;

use crate::roblox::process::studio_running;
use crate::roblox::session::{self, StudioSnapshot};

/// What the renderer needs to draw the Roblox lamp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RobloxStudioLiveStatus {
    /// `StudioMCP.exe` was found on this machine.
    pub installed: bool,
    /// The Studio process is alive.
    pub running: bool,
    /// The MCP proxy reported at least one reachable Studio instance.
    pub connected: bool,
    /// The open place's name. Never logged.
    pub place_name: Option<String>,
}

impl RobloxStudioLiveStatus {
    /// Nothing to show: no Studio on this machine.
    #[must_use]
    pub fn not_installed() -> Self {
        Self {
            installed: false,
            running: false,
            connected: false,
            place_name: None,
        }
    }

    /// Studio is installed but not running.
    #[must_use]
    pub fn idle() -> Self {
        Self {
            installed: true,
            running: false,
            connected: false,
            place_name: None,
        }
    }

    /// Studio is running but the proxy reached no instance.
    #[must_use]
    pub fn running_only() -> Self {
        Self {
            installed: true,
            running: true,
            connected: false,
            place_name: None,
        }
    }

    /// The proxy reached a Studio instance.
    #[must_use]
    pub fn connected(snapshot: &StudioSnapshot) -> Self {
        Self {
            installed: true,
            running: true,
            connected: true,
            place_name: snapshot.place_name(),
        }
    }
}

/// The probe core, taking its inputs so a test can drive every branch.
///
/// Order matters: the process check is ~1 ms and the MCP round-trip needs a
/// live child, so a machine with Studio closed never spawns the proxy.
///
/// `recheck_running` closes a race that otherwise reads as a bug. Closing Studio
/// kills the proxy and the editor at slightly different moments, so a process
/// check taken just before the probe can still see Studio while the probe
/// already answers with an empty list. Reporting that as "open, no place" makes
/// a closed Studio look like a stalled connection, so ask again before saying
/// Studio is open.
pub async fn resolve_status(
    installed: bool,
    running: bool,
    probe: impl std::future::Future<Output = Result<StudioSnapshot, String>>,
    recheck_running: impl FnOnce() -> bool,
) -> RobloxStudioLiveStatus {
    if !installed {
        return RobloxStudioLiveStatus::not_installed();
    }
    if !running {
        return RobloxStudioLiveStatus::idle();
    }
    match probe.await {
        Ok(snapshot) if snapshot.studios.is_empty() => {
            if recheck_running() {
                RobloxStudioLiveStatus::running_only()
            } else {
                RobloxStudioLiveStatus::idle()
            }
        }
        Ok(snapshot) => RobloxStudioLiveStatus::connected(&snapshot),
        Err(error) => {
            log::warn!("[roblox] Studio MCP probe failed: {error}");
            if recheck_running() {
                RobloxStudioLiveStatus::running_only()
            } else {
                RobloxStudioLiveStatus::idle()
            }
        }
    }
}

/// `roblox_studio_live_status` — whether Studio is installed, running and
/// connected, plus the open place's name.
///
/// Never panics and never returns an error: the renderer paints a lamp from
/// whichever fields are true.
#[tauri::command]
pub async fn roblox_studio_live_status() -> RobloxStudioLiveStatus {
    let Some(exe) = crate::roblox::find_studio_mcp() else {
        return RobloxStudioLiveStatus::not_installed();
    };
    let status =
        resolve_status(true, studio_running(), session::probe(&exe), studio_running).await;
    if !status.running {
        // Nothing to poll, so release the ~14 MB child. Reopening Studio
        // respawns it once on the next tick (~69 ms).
        session::shutdown().await;
    }
    log::info!(
        "[roblox] live status: installed={} running={} connected={} hasPlaceName={}",
        status.installed,
        status.running,
        status.connected,
        status.place_name.is_some()
    );
    status
}
