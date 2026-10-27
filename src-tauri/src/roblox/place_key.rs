//! Where a Studio place is, in a form a session can be keyed on.
//!
//! A published place is identified by `game.PlaceId`. An unpublished one has
//! `PlaceId == 0`, so a GUID is minted into a `workspace` attribute and stored
//! in the place file itself — reopening the `.rbxl` yields the same GUID, so the
//! chat keeps its session. Ported from RobloxKit `place:21-42`.
//!
//! The probe is a Luau `execute_luau` round-trip, so it needs a reachable Studio
//! and a loaded place; both failures are reported as `None` rather than an error,
//! because "no place open" is a normal state.

use serde::Deserialize;

use crate::roblox::session::StudioSession;

#[cfg(test)]
#[path = "place_key_tests.rs"]
mod tests;

/// Tool that runs Luau inside the target Studio.
pub const EXECUTE_LUAU_TOOL: &str = "execute_luau";

/// Mints a GUID when the place is unpublished and has none yet.
const PROBE_LUAU: &str = r#"
local HttpService = game:GetService("HttpService")
local guid = workspace:GetAttribute("RobloxKitPlaceKey")
local created = false
if game.PlaceId == 0 and type(guid) ~= "string" then
  guid = HttpService:GenerateGUID(false)
  workspace:SetAttribute("RobloxKitPlaceKey", guid)
  created = true
end
return HttpService:JSONEncode({
  placeId = game.PlaceId,
  gameId = game.GameId,
  name = game.Name,
  guid = guid,
  created = created
})
"#;

/// What the probe learned about the open place.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceProbe {
    pub place_id: i64,
    pub game_id: i64,
    pub name: String,
    pub guid: Option<String>,
    #[serde(default)]
    pub created: bool,
}

impl PlaceProbe {
    /// `place-<id>` for a published place, `unpub-<guid>` for an unpublished one
    /// with a GUID, `None` when the place cannot be addressed.
    #[must_use]
    pub fn place_key(&self) -> Option<String> {
        if self.place_id > 0 {
            return Some(format!("place-{}", self.place_id));
        }
        let guid = self.guid.as_deref()?;
        if is_uuid(guid) {
            Some(format!("unpub-{}", guid.to_ascii_lowercase()))
        } else {
            None
        }
    }
}

/// RFC 4122 shape, case-insensitive. Roblox returns uppercase GUIDs; the key is
/// lowercased so the same place never produces two keys.
fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        let hyphen = matches!(index, 8 | 13 | 18 | 23);
        let ok = if hyphen {
            *byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        };
        if !ok {
            return false;
        }
    }
    true
}

/// The Luau return value arrives wrapped in MCP's `content` array; the first
/// text block holds the JSON string the script produced.
fn text_of(result: &serde_json::Value) -> Option<&str> {
    result
        .get("content")?
        .as_array()?
        .first()?
        .get("text")?
        .as_str()
}

/// Parse the probe reply. Exposed for tests, which drive it with recorded JSON.
pub fn parse_probe(result: Option<&serde_json::Value>) -> Option<PlaceProbe> {
    let text = text_of(result?)?;
    serde_json::from_str::<PlaceProbe>(text).ok()
}

/// Probe the open place in `studio_id`.
///
/// `Ok(None)` means Studio answered but no place is loaded — a normal state, not
/// a failure. `Err` means the tool call itself failed.
pub async fn probe_place(
    session: &mut StudioSession,
    studio_id: &str,
) -> Result<Option<PlaceProbe>, String> {
    let args = serde_json::json!({
        "studio_id": studio_id,
        "code": PROBE_LUAU,
    });
    let result = session.call_tool(EXECUTE_LUAU_TOOL, args).await?;
    Ok(parse_probe(result.get("result")))
}
