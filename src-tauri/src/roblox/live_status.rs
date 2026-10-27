//! The status-bar lamp's answer: installed / running / connected / place name.
//!
//! Every failure maps to a field rather than an error, so the renderer always
//! has a state to paint. The place name is user content (it can be a private
//! experience title), so it is never logged — only booleans and counts.

use serde::Serialize;

use crate::roblox::process::studio_running;
use crate::roblox::session::{self, StudioSnapshot};

/// One reachable Studio window, as the renderer needs it to build the session
/// context block. The id is the MCP proxy's handle, not a user-facing string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RobloxStudioWindow {
    pub id: String,
    pub name: Option<String>,
}

/// What the renderer needs to draw the Roblox lamp and to describe the place to
/// an agent on the first turn of a chat.
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
    /// The MCP handle of the open place's window, when one is reachable.
    pub studio_id: Option<String>,
    /// Every other reachable Studio window, so an agent can offer to switch
    /// instead of guessing which place the user means.
    pub other_studios: Vec<RobloxStudioWindow>,
}

impl RobloxStudioLiveStatus {
    /// Nothing to show: no Studio on this machine.
    #[must_use]
    pub fn not_installed() -> Self {
        Self::unreachable(false)
    }

    /// Studio is installed but not running.
    #[must_use]
    pub fn idle() -> Self {
        let mut status = Self::unreachable(true);
        status.running = false;
        status
    }

    /// Studio is running but the proxy reached no instance.
    #[must_use]
    pub fn running_only() -> Self {
        Self::unreachable(true)
    }

    /// The proxy reached a Studio instance.
    #[must_use]
    pub fn connected(snapshot: &StudioSnapshot) -> Self {
        let Some(first) = snapshot.studios.first() else {
            return Self::running_only();
        };
        Self {
            installed: true,
            running: true,
            connected: true,
            place_name: first.name.clone(),
            studio_id: Some(first.id.clone()),
            other_studios: snapshot
                .studios
                .iter()
                .skip(1)
                .map(|studio| RobloxStudioWindow {
                    id: studio.id.clone(),
                    name: studio.name.clone(),
                })
                .collect(),
        }
    }

    fn unreachable(installed: bool) -> Self {
        Self {
            installed,
            running: installed,
            connected: false,
            place_name: None,
            studio_id: None,
            other_studios: Vec::new(),
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
        "[roblox] live status: installed={} running={} connected={} hasPlaceName={} windows={}",
        status.installed,
        status.running,
        status.connected,
        status.place_name.is_some(),
        status.other_studios.len() + usize::from(status.connected)
    );
    status
}

/// What the renderer gets for a place probe: the addressable key, and whether
/// this probe is what wrote the unpublished-place GUID into the place file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RobloxPlaceKey {
    /// `place-<PlaceId>`, `unpub-<guid>`, or `None` when the place cannot be
    /// addressed (no place loaded, or an unpublished place with no GUID yet).
    pub place_key: Option<String>,
    /// The place id, `0` for an unpublished place.
    pub place_id: i64,
    /// The display name, so a caller can label the session without re-probing.
    pub place_name: Option<String>,
    /// This probe minted the GUID. Worth logging once; not user-facing.
    pub created: bool,
}

impl RobloxPlaceKey {
    fn empty() -> Self {
        Self {
            place_key: None,
            place_id: 0,
            place_name: None,
            created: false,
        }
    }
}

/// `roblox_place_key` — the addressable key for the open place.
///
/// This is the mechanism that lets an unpublished place keep its chat session:
/// `game.PlaceId` is `0` until publication, so a GUID is written into a
/// `workspace` attribute and travels with the `.rbxl`. Reopening the file
/// yields the same GUID, hence the same key, hence the same session.
///
/// Unlike the lamp this **mutates the place** (once, for an unpublished place
/// with no GUID). It is therefore not polled — the renderer asks for it when a
/// chat starts.
#[tauri::command]
pub async fn roblox_place_key() -> RobloxPlaceKey {
    let Some(exe) = crate::roblox::find_studio_mcp() else {
        return RobloxPlaceKey::empty();
    };
    if !studio_running() {
        return RobloxPlaceKey::empty();
    }

    let mut guard = match session::probe_session(&exe).await {
        Ok(guard) => guard,
        Err(error) => {
            log::warn!("[roblox] place key: no MCP session: {error}");
            return RobloxPlaceKey::empty();
        }
    };
    let Some(session) = guard.as_mut() else {
        return RobloxPlaceKey::empty();
    };

    let studio_id = match session.list_studios().await {
        Ok(studios) if !studios.is_empty() => studios[0].id.clone(),
        Ok(_) => return RobloxPlaceKey::empty(),
        Err(error) => {
            log::warn!("[roblox] place key: could not list studios: {error}");
            return RobloxPlaceKey::empty();
        }
    };

    match crate::roblox::place_key::probe_place(session, &studio_id).await {
        Ok(Some(probe)) => {
            if probe.created {
                log::info!("[roblox] place key: minted a GUID for an unpublished place");
            }
            RobloxPlaceKey {
                place_key: probe.place_key(),
                place_id: probe.place_id,
                place_name: Some(probe.name),
                created: probe.created,
            }
        }
        Ok(None) => {
            log::debug!("[roblox] place key: no place loaded");
            RobloxPlaceKey::empty()
        }
        Err(error) => {
            log::warn!("[roblox] place key: probe failed: {error}");
            RobloxPlaceKey::empty()
        }
    }
}
