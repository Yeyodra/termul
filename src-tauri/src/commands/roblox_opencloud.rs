//! Open Cloud upload, as the renderer calls it.
//!
//! Four commands, split the way the key's lifetime actually works:
//!
//!  * `roblox_opencloud_status` — is a key stored? Never returns the key.
//!  * `roblox_opencloud_save_key` — validate the shape, then store in the OS
//!    keychain through the shared credentials plumbing.
//!  * `roblox_opencloud_clear_key` — forget it.
//!  * `roblox_upload_model` — upload a GLB and run the insert script.
//!
//! The key never crosses IPC in the read direction, and the upload command takes
//! the Luau source rather than emitting it: `insertLuau` in `studio.ts` is the one
//! place that knows the protocol strings, and duplicating them in Rust would give
//! two emitters that can drift.
//!
//! An upload without a stored key answers `NO_KEY` rather than failing obscurely,
//! because the fix is a user action the page can offer.

use super::IpcResult;
use crate::acp::credentials;
use crate::roblox::opencloud::{CreateAssetRequest, OpenCloudClient, API_KEY_ACCOUNT};

/// A key that is not UUID-shaped is not an Open Cloud key.
///
/// The dashboard issues `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. Checking the
/// shape here catches the mistake that actually happened in practice: pasting a
/// session JWT (which is much longer and starts with a base64 prefix) instead of
/// an API key. A rejection that names the shape is faster than a 401 later.
fn looks_like_api_key(value: &str) -> bool {
    let trimmed = value.trim();
    let groups: Vec<&str> = trimmed.split('-').collect();
    groups.len() == 5
        && groups.iter().map(|group| group.len()).eq([8, 4, 4, 4, 12])
        && trimmed.chars().all(|character| character.is_ascii_hexdigit() || character == '-')
}

/// Whether a key is stored, without revealing it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCloudStatus {
    pub configured: bool,
    /// Why the answer is `false`, when it is not simply "nothing saved yet".
    pub reason: Option<String>,
}

#[tauri::command]
pub fn roblox_opencloud_status() -> IpcResult<OpenCloudStatus> {
    match credentials::read_secret(API_KEY_ACCOUNT, "the stored Open Cloud key is empty") {
        Ok(Some(_)) => IpcResult::success(OpenCloudStatus {
            configured: true,
            reason: None,
        }),
        Ok(None) => IpcResult::success(OpenCloudStatus {
            configured: false,
            reason: None,
        }),
        Err(reason) => IpcResult::success(OpenCloudStatus {
            configured: false,
            reason: Some(reason),
        }),
    }
}

/// Store an Open Cloud key, rejecting anything that cannot be one.
#[tauri::command]
pub fn roblox_opencloud_save_key(key: String) -> IpcResult<OpenCloudStatus> {
    if !looks_like_api_key(&key) {
        return IpcResult::error(
            "That does not look like an Open Cloud API key. It is a 36-character UUID from \
             create.roblox.com → Credentials, not a session token.",
            "NOT_AN_API_KEY",
        );
    }

    match credentials::write_secret(
        API_KEY_ACCOUNT,
        key.trim(),
        "Could not save the Open Cloud key in the OS keychain",
        "Could not verify the Open Cloud key in the OS keychain",
    ) {
        Ok(()) => IpcResult::success(OpenCloudStatus {
            configured: true,
            reason: None,
        }),
        Err(reason) => IpcResult::error(reason, "KEYCHAIN_WRITE_FAILED"),
    }
}

#[tauri::command]
pub fn roblox_opencloud_clear_key() -> IpcResult<OpenCloudStatus> {
    match credentials::delete_secret(API_KEY_ACCOUNT, "Could not remove the Open Cloud key") {
        Ok(()) => IpcResult::success(OpenCloudStatus {
            configured: false,
            reason: None,
        }),
        Err(reason) => IpcResult::error(reason, "KEYCHAIN_DELETE_FAILED"),
    }
}

/// What an upload produced.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub asset_id: u64,
    /// The insert script's own reply, so the page can show what Studio said.
    pub message: String,
    /// Present when the upload worked but the insert did not.
    pub recovery: Option<String>,
}

/// Upload a GLB as a Model asset, then run `luau` in the open Studio place.
///
/// `glb_base64` is the model; `luau` is the already-built insert script, which
/// names the asset id placeholder as `{{ASSET_ID}}` so this side can substitute
/// the real id once Roblox has assigned one. The placeholder is a string rather
/// than a pre-numbered id because the id does not exist until after the upload.
///
/// `user_id` is the creator the asset belongs to. `studio_id` must be present
/// before the upload starts, which is the same invariant the TypeScript path
/// enforces: a missing place must not burn an upload.
#[tauri::command]
pub async fn roblox_upload_model(
    glb_base64: String,
    name: String,
    description: Option<String>,
    user_id: String,
    studio_id: Option<String>,
    luau: String,
) -> Result<IpcResult<UploadResult>, String> {
    use base64::Engine as _;

    let Some(studio_id) = studio_id.filter(|id| !id.trim().is_empty()) else {
        return Ok(IpcResult::error(
            "Open a place in Roblox Studio first.",
            "NO_STUDIO",
        ));
    };

    let key = match credentials::read_secret(API_KEY_ACCOUNT, "the stored Open Cloud key is empty") {
        Ok(Some(key)) => key,
        Ok(None) => {
            return Ok(IpcResult::error(
                "No Open Cloud API key is saved, so the model cannot be uploaded. Add one from \
                 create.roblox.com → Credentials with the Assets permission and asset:write.",
                "NO_KEY",
            ))
        }
        Err(reason) => return Ok(IpcResult::error(reason, "KEYCHAIN_READ_FAILED")),
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(glb_base64.as_bytes()) {
        Ok(bytes) => bytes,
        Err(_) => {
            return Ok(IpcResult::error(
                "the model was not valid base64",
                "BAD_MODEL",
            ))
        }
    };

    let client = match OpenCloudClient::new(key) {
        Ok(client) => client,
        Err(reason) => return Ok(IpcResult::error(reason, "CLIENT_UNAVAILABLE")),
    };

    let request = CreateAssetRequest::model(
        user_id.trim(),
        name.trim(),
        description.as_deref().unwrap_or("Made with Termul"),
    );

    let uploaded = match client
        .upload_model(&request, &format!("{name}.glb"), &bytes)
        .await
    {
        Ok(uploaded) => uploaded,
        Err(reason) => return Ok(IpcResult::error(reason, "UPLOAD_FAILED")),
    };

    // The insert script is the renderer's, so this side only substitutes the id.
    // `{{ASSET_ID}}` is a bare number in the script's `LoadAsset(...)` call.
    let code = luau.replace("{{ASSET_ID}}", &uploaded.asset_id.to_string());

    let Some(exe) = crate::roblox::find_studio_mcp() else {
        return Ok(IpcResult::success(UploadResult {
            asset_id: uploaded.asset_id,
            message: String::new(),
            recovery: Some(format!(
                "Uploaded as asset {}, but Studio MCP is unavailable so it could not be inserted. \
                 Insert it from Toolbox → My Models.",
                uploaded.asset_id
            )),
        }));
    };

    let message = match crate::roblox::session::probe_session(&exe).await {
        Ok(mut guard) => match guard.as_mut() {
            Some(session) => session
                .call_tool(
                    crate::roblox::place_key::EXECUTE_LUAU_TOOL,
                    serde_json::json!({ "studio_id": studio_id, "code": code }),
                )
                .await
                .map(|reply| reply.to_string())
                .unwrap_or_else(|error| format!("LOAD_FAILED: {error}")),
            None => "LOAD_FAILED: Studio MCP session is unavailable".to_string(),
        },
        Err(error) => format!("LOAD_FAILED: {error}"),
    };

    // A failed insert is not a failed upload: the asset exists either way.
    let recovery = if message.contains("LOAD_FAILED") {
        Some(format!(
            "Uploaded as asset {}, but Studio could not insert it yet ({}). Insert it from \
             Toolbox → My Models, or import the GLB from the workspace with the 3D Importer.",
            uploaded.asset_id,
            message.replace("LOAD_FAILED: ", "")
        ))
    } else {
        None
    };

    Ok(IpcResult::success(UploadResult {
        asset_id: uploaded.asset_id,
        message,
        recovery,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_uuid_is_accepted_as_an_api_key() {
        assert!(looks_like_api_key(
            "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"
        ));
    }

    #[test]
    fn a_session_jwt_is_rejected_by_shape() {
        // The mistake this guard exists for: a RobloxInternal JWT is far longer
        // and is not dash-grouped, so it can never be mistaken for a key.
        assert!(!looks_like_api_key(
            "TAxwt39ToUG7V60G2r+brraYoPG63+94jzQKHXjh9Bn8JFWmZXlKaGJHY2lPaUpTVXpJMU5pSXNJbXRwWkNJNkluTnBaeTB5TURJeExUQTNMVEV6VkRFNE9qVXhPalE1V2lJc0luUjVjQ0k2SWtwWFZDSjku"
        ));
    }

    #[test]
    fn an_empty_or_short_value_is_rejected() {
        assert!(!looks_like_api_key(""));
        assert!(!looks_like_api_key("   "));
        assert!(!looks_like_api_key("abc"));
        assert!(!looks_like_api_key("0f1e2d3c-4b5a-6978-8a9b"));
    }

    #[test]
    fn a_uuid_with_non_hex_characters_is_rejected() {
        assert!(!looks_like_api_key(
            "zzzzzzzz-4b5a-6978-8a9b-0c1d2e3f4a5b"
        ));
    }

    #[test]
    fn surrounding_whitespace_is_tolerated() {
        assert!(looks_like_api_key(
            "  0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b  "
        ));
    }
}
