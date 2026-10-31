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
use crate::roblox::opencloud::{
    CreateAssetRequest, OpenCloudClient, API_KEY_ACCOUNT, USER_ID_ACCOUNT,
};

/// A key that could be an Open Cloud key.
///
/// This used to require the UUID shape (`8-4-4-4-12` hex), which was wrong twice
/// over: the dashboard also issues longer opaque strings, so a real key was
/// rejected at save time, and a UUID-shaped string that is not a key at all was
/// accepted and only failed later with a bare 401.
///
/// The only authority on whether a key is real is Roblox's own introspect
/// endpoint, so this checks nothing about the shape beyond "something was
/// pasted". `introspect_api_key` is what actually decides, and it says why.
fn looks_like_api_key(value: &str) -> bool {
    let trimmed = value.trim();
    // Long enough to be a whole credential, and pasted as one piece. Both key
    // shapes the dashboard issues are far longer than this; a truncated paste is
    // the mistake this catches.
    trimmed.len() >= 30 && !trimmed.chars().any(char::is_whitespace)
}

/// Whether a key is stored, without revealing it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCloudStatus {
    pub configured: bool,
    /// Why the answer is `false`, when it is not simply "nothing saved yet".
    pub reason: Option<String>,
    /// The creator id the key uploads under, or `None` when it was never given.
    ///
    /// Not a secret, and the page needs it: an upload must name a creator, and
    /// asking for it on every upload would mean the user typing a numeric id
    /// they have no reason to memorise.
    pub user_id: Option<String>,
}

/// The stored creator id, if one was saved.
fn stored_user_id() -> Option<String> {
    credentials::read_secret(USER_ID_ACCOUNT, "the stored Roblox user id is empty")
        .ok()
        .flatten()
}

/// A creator id is all digits. Roblox ids never contain anything else, and a
/// pasted username is the mistake this catches.
fn looks_like_user_id(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed.len() <= 20 && trimmed.chars().all(|c| c.is_ascii_digit())
}

#[tauri::command]
pub fn roblox_opencloud_status() -> IpcResult<OpenCloudStatus> {
    match credentials::read_secret(API_KEY_ACCOUNT, "the stored Open Cloud key is empty") {
        Ok(Some(_)) => IpcResult::success(OpenCloudStatus {
            configured: true,
            reason: None,
            user_id: stored_user_id(),
        }),
        Ok(None) => IpcResult::success(OpenCloudStatus {
            configured: false,
            reason: None,
            user_id: stored_user_id(),
        }),
        Err(reason) => IpcResult::success(OpenCloudStatus {
            configured: false,
            reason: Some(reason),
            user_id: stored_user_id(),
        }),
    }
}

/// Store an Open Cloud key, after Roblox confirms it exists and may write assets.
///
/// The check is a real request to the introspect endpoint, not a shape test. A
/// shape test cannot tell a real key from a session token, and it rejected the
/// longer key format the dashboard also issues - so a valid key was refused at
/// save time while an invalid UUID-shaped string was accepted and only failed
/// later with a bare 401.
///
/// `user_id` is optional here so a user can save the key first and the creator
/// second. An upload refuses without both, but refusing at save time would mean
/// losing a key the user already has to hand.
#[tauri::command]
pub async fn roblox_opencloud_save_key(
    key: String,
    user_id: Option<String>,
) -> IpcResult<OpenCloudStatus> {
    if !looks_like_api_key(&key) {
        return IpcResult::error(
            "That does not look like a key that was pasted whole. Copy it again from \
             create.roblox.com → Credentials → API Keys.",
            "NOT_AN_API_KEY",
        );
    }

    // Roblox decides, not a shape test: it is the only party that knows whether
    // this string is a key and what the key may do.
    let info = match crate::roblox::opencloud::OpenCloudClient::new(key.trim()) {
        Ok(client) => match client.introspect().await {
            Ok(info) => info,
            Err(reason) => return IpcResult::error(reason, "KEY_REJECTED"),
        },
        Err(reason) => return IpcResult::error(reason, "CLIENT_UNAVAILABLE"),
    };
    if let Some(blocker) = info.upload_blocker() {
        return IpcResult::error(blocker, "KEY_NOT_USABLE");
    }

    let creator = user_id.map(|value| value.trim().to_string());
    if let Some(creator) = creator.as_deref() {
        if !creator.is_empty() && !looks_like_user_id(creator) {
            return IpcResult::error(
                "A Roblox user id is all digits. Open your profile and copy the number from the \
                 URL, not the username.",
                "NOT_A_USER_ID",
            );
        }
    }

    if let Err(reason) = credentials::write_secret(
        API_KEY_ACCOUNT,
        key.trim(),
        "Could not save the Open Cloud key in the OS keychain",
        "Could not verify the Open Cloud key in the OS keychain",
    ) {
        return IpcResult::error(reason, "KEYCHAIN_WRITE_FAILED");
    }

    // The creator is stored beside the key rather than in front of it, so a
    // failed write here cannot leave a creator with no key to use it.
    if let Some(creator) = creator.filter(|value| !value.is_empty()) {
        if let Err(reason) = credentials::write_secret(
            USER_ID_ACCOUNT,
            &creator,
            "Could not save the Roblox user id in the OS keychain",
            "Could not verify the Roblox user id in the OS keychain",
        ) {
            return IpcResult::error(reason, "KEYCHAIN_WRITE_FAILED");
        }
    }

    IpcResult::success(OpenCloudStatus {
        configured: true,
        reason: None,
        user_id: stored_user_id(),
    })
}

#[tauri::command]
pub fn roblox_opencloud_clear_key() -> IpcResult<OpenCloudStatus> {
    // The creator goes too: leaving it behind would attach the next key's uploads
    // to the previous user's account.
    let _ = credentials::delete_secret(USER_ID_ACCOUNT, "Could not remove the Roblox user id");
    match credentials::delete_secret(API_KEY_ACCOUNT, "Could not remove the Open Cloud key") {
        Ok(()) => IpcResult::success(OpenCloudStatus {
            configured: false,
            reason: None,
            user_id: None,
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
/// `studio_id` must be present before the upload starts, which is the same
/// invariant the TypeScript path enforces: a missing place must not burn an
/// upload.
///
/// The creator comes from the keychain rather than a parameter: it was saved
/// beside the key, and taking it from the caller would let the two disagree.
#[tauri::command]
pub async fn roblox_upload_model(
    glb_base64: String,
    name: String,
    description: Option<String>,
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

    let Some(user_id) = stored_user_id() else {
        return Ok(IpcResult::error(
            "No Roblox user id is saved, so Roblox does not know whose account the model belongs \
             to. Save your numeric user id with the key.",
            "NO_USER_ID",
        ));
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
    fn a_uuid_shaped_key_is_still_accepted() {
        assert!(looks_like_api_key(
            "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"
        ));
    }

    /// The dashboard also issues long opaque strings. Requiring the UUID shape
    /// rejected those at save time, so a real key could not be stored at all.
    #[test]
    fn a_long_opaque_key_is_accepted_because_roblox_decides() {
        let long = "qQkzL3I4YU2MbTBA+9GLQOcigtpQO1py1tEJU8wpb633npEWZXIKaGJHY2lPaUpTVXpJMU5pSXNJbXRwWkNJNkluTnBaeTB5TURJeExUQTNMVEV6VkRFNE9qVXhPalE1V2lJc0luUjVjQ0k2SWtwWFZDSjkuZXlKaGRXUWlPaUpTYjJKc2IzaEpiblJsY201aGJDSXNJbWx6Y3lJNklrTnNiM1ZrUVhWMGFHVnVkR2xqWVhScGIyNVRaWEoyYVdObElpd2lZbUZ6WlVGd2FVdGxlU0k2SWxSQmVIZDBNemxVYjFWSE4xWTJNRWN5Y2l0aWNuSmhXVzlRUnpZekt6azBhbnBSUzBoWWFtZzVRbTQ0U2taWGJTSXNJbTkzYm1WeVNXUWlPaUk0TXpReE5UazRPRFVpTENKbGVIQWlPakUzT1RNek56RTNNakVzSW1saGRDSTZNVGM1TXpNMk9ERXlNU3dpYm1KbUlqb3hOemt6TXpZNE1USXhmUS5vR2pITlVEYVpPUV9USC1kelhpSUNmUlFuREVhLWxaRzhCRnZraTVVYThoTWY2MmZuOFd0cUdsajdySkp2TnltN3JQcGM3emoxcXhtSjM1S1J3UURoUkxteGFxbEFFWlRkb1ZGMXg0QVFlYlpsN3piUkU3VEJ0ZU9ibnhmaDdsSlUzRFloWG5hUXhuOC1EeFBOMXpEUVVvQnlSX0hFRGdyRFBPUWxpeXVIS2VCZzdZOC11ZjA5V1JjSTU0eEdlenJJQnhfMVctS3BpbGlZWkxUb3k0RGJ5OWhhR2MxZkdyeGRRT2MycEFXNXF4WThpQjdLRktEOUlRbjFrNzBpc0FiaFVwb1ItS0lXNkw4TE56SXc2UWcwbUhkRjZ6LXNqcEpCa1pfMDhtVTdIekl3bWJhdE11QUJXbUFVWV9mcE1iTlZieS1KNWxPaF9CM2ZHUmdfX01HelE=";
        assert!(looks_like_api_key(long));
    }

    /// A shape test cannot tell a session token from a key, which is why the save
    /// path asks Roblox instead. This one is long enough to pass the paste check
    /// and is rejected by introspect with "API Key does not exist".
    #[test]
    fn the_paste_check_alone_does_not_claim_a_key_is_valid() {
        assert!(looks_like_api_key(
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
    fn a_value_with_spaces_inside_is_not_a_pasted_key() {
        assert!(!looks_like_api_key("0f1e 2d3c 4b5a 6978 8a9b"));
    }

    #[test]
    fn surrounding_whitespace_is_tolerated() {
        assert!(looks_like_api_key(
            "  0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b  "
        ));
    }

    #[test]
    fn a_key_without_the_asset_scope_says_which_permission_is_missing() {
        let info = crate::roblox::opencloud::ApiKeyInfo {
            name: "termul".into(),
            authorized_user_id: Some(834159885),
            enabled: true,
            expired: false,
            scopes: vec![crate::roblox::opencloud::ApiKeyScope {
                name: "universe-datastores.objects".into(),
                operations: vec!["create".into()],
            }],
        };
        let blocker = info.upload_blocker().expect("blocked");
        assert!(blocker.contains("asset:write"), "{blocker}");
    }

    #[test]
    fn a_key_with_asset_write_may_upload() {
        let info = crate::roblox::opencloud::ApiKeyInfo {
            name: "termul".into(),
            authorized_user_id: Some(834159885),
            enabled: true,
            expired: false,
            scopes: vec![crate::roblox::opencloud::ApiKeyScope {
                name: "asset".into(),
                operations: vec!["write".into()],
            }],
        };
        assert!(info.upload_blocker().is_none());
    }

    #[test]
    fn a_disabled_or_expired_key_says_so() {
        let base = crate::roblox::opencloud::ApiKeyInfo {
            name: "k".into(),
            authorized_user_id: None,
            enabled: true,
            expired: false,
            scopes: vec![crate::roblox::opencloud::ApiKeyScope {
                name: "asset".into(),
                operations: vec!["write".into()],
            }],
        };
        let disabled = crate::roblox::opencloud::ApiKeyInfo {
            enabled: false,
            ..base.clone()
        };
        let expired = crate::roblox::opencloud::ApiKeyInfo {
            expired: true,
            ..base
        };
        assert!(disabled.upload_blocker().unwrap().contains("disabled"));
        assert!(expired.upload_blocker().unwrap().contains("expired"));
    }
}
