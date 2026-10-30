//! Roblox Open Cloud: uploading a generated model as a Model asset.
//!
//! This is the half of the 3D Studio path that Termul was missing. `studio.ts`
//! already knows how to build the GLB, decide `merge`, emit both Luau scripts and
//! honour the five invariants; what it never had was a transport, so
//! `sendToStudio` could only be exercised against an injected fake.
//!
//! The API is `POST https://apis.roblox.com/assets/v1/assets` with an
//! `x-api-key` header and a `multipart/form-data` body carrying two parts:
//!
//!  * `request` — JSON: `assetType`, `displayName`, `description` and
//!    `creationContext.creator.{userId|groupId}`
//!  * `fileContent` — the model file itself
//!
//! The response is a long-running operation. It either carries the asset id
//! directly or a `path` to poll at `https://apis.roblox.com/cloud/v2/{path}`
//! until `done` is true.
//!
//! **The multipart encoder is hand-written** because `reqwest`'s `multipart`
//! feature is not enabled in this crate, and turning it on for one call site
//! would pull in a second HTTP body abstraction for no gain. The encoder is pure,
//! so it is tested by comparing exact bytes rather than by hoping.
//!
//! **No key material is ever logged.** Errors name the status code and Roblox's
//! own message, never the request headers.

use serde::{Deserialize, Serialize};

/// The Assets endpoint that creates an asset.
pub const CREATE_ASSET_URL: &str = "https://apis.roblox.com/assets/v1/assets";
/// The prefix a polled operation `path` is appended to.
pub const OPERATION_BASE_URL: &str = "https://apis.roblox.com/cloud/v2/";

/// The keychain account the user's Open Cloud key is stored under.
pub const API_KEY_ACCOUNT: &str = "roblox.open-cloud.api-key";
/// The Roblox user the assets are created under. Not a secret, but stored beside
/// the key so the two cannot drift apart.
pub const USER_ID_ACCOUNT: &str = "roblox.open-cloud.user-id";

/// One multipart part: a name, an optional filename and content type, and bytes.
pub struct Part<'a> {
    pub name: &'a str,
    pub filename: Option<&'a str>,
    pub content_type: Option<&'a str>,
    pub body: &'a [u8],
}

/// A multipart body with its boundary.
pub struct MultipartBody {
    pub boundary: String,
    pub body: Vec<u8>,
}

/// Encode parts as `multipart/form-data`.
///
/// The layout follows RFC 7578: every part is preceded by `--boundary` + CRLF,
/// the part headers each end with CRLF, a blank CRLF separates headers from the
/// body, and the whole body ends with `--boundary--` + CRLF.
///
/// `boundary` is caller-supplied so the output is deterministic and a test can
/// assert exact bytes. A real caller passes something unique per request.
pub fn encode_multipart(parts: &[Part<'_>], boundary: &str) -> MultipartBody {
    let mut body = Vec::new();

    for part in parts {
        body.extend_from_slice(b"--");
        body.extend_from_slice(boundary.as_bytes());
        body.extend_from_slice(b"\r\n");

        body.extend_from_slice(b"Content-Disposition: form-data; name=\"");
        body.extend_from_slice(part.name.as_bytes());
        body.extend_from_slice(b"\"");
        if let Some(filename) = part.filename {
            body.extend_from_slice(b"; filename=\"");
            body.extend_from_slice(filename.as_bytes());
            body.extend_from_slice(b"\"");
        }
        body.extend_from_slice(b"\r\n");

        if let Some(content_type) = part.content_type {
            body.extend_from_slice(b"Content-Type: ");
            body.extend_from_slice(content_type.as_bytes());
            body.extend_from_slice(b"\r\n");
        }

        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(part.body);
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(b"--");
    body.extend_from_slice(boundary.as_bytes());
    body.extend_from_slice(b"--\r\n");

    MultipartBody {
        boundary: boundary.to_string(),
        body,
    }
}

/// The `request` part's JSON.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateAssetRequest {
    #[serde(rename = "assetType")]
    pub asset_type: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    #[serde(rename = "creationContext")]
    pub creation_context: CreationContext,
}

/// Who owns the created asset. Exactly one of the two ids may be set.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreationContext {
    pub creator: Creator,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Creator {
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(rename = "groupId", skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

impl CreateAssetRequest {
    /// A Model upload owned by `user_id`.
    pub fn model(user_id: &str, display_name: &str, description: &str) -> Self {
        Self {
            asset_type: "Model".to_string(),
            display_name: display_name.to_string(),
            description: description.to_string(),
            creation_context: CreationContext {
                creator: Creator {
                    user_id: Some(user_id.to_string()),
                    group_id: None,
                },
            },
        }
    }

    /// Reject a request Roblox would refuse, before spending a round trip.
    ///
    /// The API requires a creator and a non-empty display name; an empty name
    /// comes back as a 400 that says nothing useful about which field was wrong.
    pub fn validate(&self) -> Result<(), String> {
        if self.asset_type.trim().is_empty() {
            return Err("an asset needs an assetType".to_string());
        }
        if self.display_name.trim().is_empty() {
            return Err("an asset needs a displayName".to_string());
        }
        let creator = &self.creation_context.creator;
        match (&creator.user_id, &creator.group_id) {
            (Some(_), Some(_)) => {
                Err("a creator is either a userId or a groupId, not both".to_string())
            }
            (None, None) => Err("a creator needs a userId or a groupId".to_string()),
            _ => Ok(()),
        }
    }
}

/// The create response, or one poll of it.
///
/// Roblox returns either the finished asset, a `path` to poll, or both. The
/// field names are the API's, so they are kept verbatim.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct Operation {
    /// `assets/v1/assets/<id>/versions/<n>` — the thing to poll.
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub response: Option<OperationResult>,
    /// Present when Roblox refused the content rather than the request.
    #[serde(default)]
    pub moderation_note: Option<String>,
}

/// The payload a finished operation carries.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OperationResult {
    #[serde(rename = "assetId", default)]
    pub asset_id: Option<serde_json::Value>,
}

impl Operation {
    /// The asset id as a number, whether Roblox sent it as a number or a string.
    ///
    /// The API is inconsistent across endpoints: `assetId` arrives as a string in
    /// the operation response and as a number elsewhere. Parsing both here means
    /// a caller never has to care.
    pub fn asset_id(&self) -> Option<u64> {
        let value = self.response.as_ref()?.asset_id.as_ref()?;
        match value {
            serde_json::Value::Number(number) => number.as_u64(),
            serde_json::Value::String(text) => text.trim().parse().ok(),
            _ => None,
        }
    }

    /// The URL to poll, or `None` when the operation already finished.
    ///
    /// `base` is a parameter rather than a constant so a test can point polling
    /// at its own server; production passes [`OPERATION_BASE_URL`].
    pub fn poll_url(&self, base: &str) -> Option<String> {
        if self.done {
            return None;
        }
        let path = self.path.as_ref()?.trim_start_matches('/');
        Some(format!("{}/{path}", base.trim_end_matches('/')))
    }
}

/// The result of an upload attempt.
#[derive(Debug, Clone)]
pub struct UploadedAsset {
    pub asset_id: u64,
    /// The raw operation, so a caller can report the moderation note.
    pub operation: Operation,
}

/// What the upload client needs to reach Roblox.
pub struct OpenCloudClient {
    api_key: String,
    http: reqwest::Client,
    create_url: String,
    operation_base: String,
    poll_attempts: u32,
    poll_interval: std::time::Duration,
}

/// Debug that never prints the key.
///
/// A derived `Debug` would put the API key in any `{:?}` — a log line, a panic
/// message, a test failure. The key is the one field that must stay out of every
/// output, so this is written by hand rather than derived.
impl std::fmt::Debug for OpenCloudClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpenCloudClient")
            .field("api_key", &"<redacted>")
            .field("create_url", &self.create_url)
            .field("poll_attempts", &self.poll_attempts)
            .finish_non_exhaustive()
    }
}

/// How many times a poll is retried before giving up.
///
/// Roblox's own docs poll six times at five seconds; the same budget is used
/// here so a slow moderation pass behaves the same as the reference client.
const DEFAULT_POLL_ATTEMPTS: u32 = 6;
const DEFAULT_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);

impl OpenCloudClient {
    pub fn new(api_key: impl Into<String>) -> Result<Self, String> {
        let api_key = api_key.into();
        if api_key.trim().is_empty() {
            return Err("an Open Cloud upload needs an API key".to_string());
        }
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|_| "could not start the HTTP client".to_string())?;
        Ok(Self {
            api_key,
            http,
            create_url: CREATE_ASSET_URL.to_string(),
            operation_base: OPERATION_BASE_URL.to_string(),
            poll_attempts: DEFAULT_POLL_ATTEMPTS,
            poll_interval: DEFAULT_POLL_INTERVAL,
        })
    }

    /// Point the client at another host, and shorten its polling. Tests only.
    ///
    /// `create_url` is the full create endpoint; `operation_base` is the prefix a
    /// polled `path` is appended to. Both move together so a test server serves
    /// the create call and its polls from one origin.
    pub fn with_endpoint(
        mut self,
        create_url: impl Into<String>,
        operation_base: impl Into<String>,
        poll_attempts: u32,
        poll_interval: std::time::Duration,
    ) -> Self {
        self.create_url = create_url.into();
        self.operation_base = operation_base.into();
        self.poll_attempts = poll_attempts;
        self.poll_interval = poll_interval;
        self
    }

    /// Upload `bytes` as a Model asset and wait for Roblox to finish processing.
    ///
    /// The multipart body is built once and sent as raw bytes, so the exact
    /// payload is what `encode_multipart` produced — no second serialiser sits
    /// between the encoder and the wire.
    pub async fn upload_model(
        &self,
        request: &CreateAssetRequest,
        filename: &str,
        bytes: &[u8],
    ) -> Result<UploadedAsset, String> {
        request.validate()?;

        let json = serde_json::to_vec(request)
            .map_err(|error| format!("could not encode the asset request: {error}"))?;
        let boundary = format!("termul-{}", uuid_like());
        let body = encode_multipart(
            &[
                Part {
                    name: "request",
                    filename: None,
                    content_type: Some("application/json"),
                    body: &json,
                },
                Part {
                    name: "fileContent",
                    filename: Some(filename),
                    content_type: Some("model/gltf-binary"),
                    body: bytes,
                },
            ],
            &boundary,
        );

        let response = self
            .http
            .post(&self.create_url)
            .header("x-api-key", &self.api_key)
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body.body)
            .send()
            .await
            .map_err(|error| format!("could not reach Roblox: {}", scrub(&error.to_string(), &self.api_key)))?;

        let status = response.status();
        let text = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(describe_refusal(status.as_u16(), &text, &self.api_key));
        }

        let mut operation: Operation = serde_json::from_str(&text)
            .map_err(|_| "Roblox answered with something that is not an operation".to_string())?;

        // The create call often returns the id outright; otherwise poll.
        if let Some(asset_id) = operation.asset_id() {
            return Ok(UploadedAsset {
                asset_id,
                operation,
            });
        }

        for _ in 0..self.poll_attempts {
            let Some(url) = operation.poll_url(&self.operation_base) else {
                break;
            };
            tokio::time::sleep(self.poll_interval).await;

            let response = self
                .http
                .get(&url)
                .header("x-api-key", &self.api_key)
                .send()
                .await
                .map_err(|error| format!("could not reach Roblox: {}", scrub(&error.to_string(), &self.api_key)))?;
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(describe_refusal(status.as_u16(), &text, &self.api_key));
            }
            operation = serde_json::from_str(&text)
                .map_err(|_| "Roblox answered a poll with something unreadable".to_string())?;
            if let Some(asset_id) = operation.asset_id() {
                return Ok(UploadedAsset {
                    asset_id,
                    operation,
                });
            }
        }

        Err(operation.moderation_note.clone().unwrap_or_else(|| {
            "Roblox has not finished processing the upload yet. It will appear under My Models when \
             it does."
                .to_string()
        }))
    }
}

/// Turn a non-2xx response into a message a user can act on.
///
/// Roblox's own `message` field is preferred over the bare status because it
/// names the offending field (`displayName is required`, `Invalid API key`). The
/// body is passed through [`scrub`] with the live key so an echoed credential is
/// redacted while the diagnostic wording survives.
fn describe_refusal(status: u16, body: &str, api_key: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|message| message.as_str())
                .map(str::to_string)
                .or_else(|| {
                    value
                        .get("errors")
                        .and_then(|errors| errors.as_array())
                        .and_then(|errors| errors.first())
                        .and_then(|first| first.get("message"))
                        .and_then(|message| message.as_str())
                        .map(str::to_string)
                })
        })
        .unwrap_or_else(|| scrub(body.trim(), api_key));

    let detail = scrub(&detail, api_key);

    let hint = match status {
        401 | 403 => " Check that the API key has the Assets permission and asset:write scope.",
        400 => " Check the asset name and creator.",
        429 => " Roblox is rate limiting; wait a moment and try again.",
        _ => "",
    };

    if detail.is_empty() {
        format!("Roblox refused the upload ({status}).{hint}")
    } else {
        format!("Roblox refused the upload ({status}): {detail}.{hint}")
    }
}

/// Redact the API key's own value from a message.
///
/// The wording around a credential is the useful part — `Invalid API key` is
/// exactly what a user needs to read — so only the secret itself is replaced. A
/// proxy or a debug body can echo the `x-api-key` header back, and that value
/// must never reach a log or a chat transcript.
fn scrub(text: &str, api_key: &str) -> String {
    let trimmed = api_key.trim();
    let redacted = if trimmed.is_empty() {
        text.to_string()
    } else {
        text.replace(trimmed, "<redacted>")
    };
    redacted.chars().take(300).collect()
}

/// A boundary suffix that is unique enough for one request without a uuid crate.
fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{}", std::process::id())
}

#[cfg(test)]
#[path = "opencloud_tests.rs"]
mod tests;
