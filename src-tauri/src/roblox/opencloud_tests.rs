//! Tests for the Open Cloud transport.
//!
//! Two layers, deliberately separate:
//!
//!  * the multipart encoder and the operation parser are pure, so they are
//!    asserted byte for byte;
//!  * the upload path runs against a **real local HTTP server** that this file
//!    starts. That is what makes the test evidence rather than a mock agreeing
//!    with itself: the request that arrives has to parse as multipart, carry the
//!    key header, and contain the model bytes.
//!
//! No test reaches Roblox. The live smoke test needs the user's own API key and
//! is the one thing this file cannot cover.

use super::*;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// One canned HTTP response.
struct Reply {
    status: u16,
    body: String,
}

impl Reply {
    fn ok(body: impl Into<String>) -> Self {
        Self {
            status: 200,
            body: body.into(),
        }
    }

    fn status(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into(),
        }
    }
}

/// What the test server observed about one request.
#[derive(Default, Debug)]
struct Observed {
    method: String,
    path: String,
    headers: String,
    body: Vec<u8>,
}

impl Observed {
    fn header(&self, name: &str) -> Option<String> {
        self.headers.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            if key.trim().eq_ignore_ascii_case(name) {
                Some(value.trim().to_string())
            } else {
                None
            }
        })
    }

    fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }
}

/// Start a server that answers `replies` in order and records every request.
///
/// Returns the base URL and a handle that yields what was observed. A hand-rolled
/// loop over `TcpListener` is enough: one request per connection, `Connection:
/// close`, and `Content-Length` framing is all `reqwest` needs.
async fn serve(replies: Vec<Reply>) -> (String, tokio::task::JoinHandle<Vec<Observed>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let address = listener.local_addr().expect("addr");

    let handle = tokio::spawn(async move {
        let mut observed = Vec::new();

        for reply in replies {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };

            let mut raw = Vec::new();
            let mut chunk = [0u8; 8192];

            // Read until the headers are complete.
            let header_end = loop {
                let read = socket.read(&mut chunk).await.unwrap_or(0);
                if read == 0 {
                    break None;
                }
                raw.extend_from_slice(&chunk[..read]);
                if let Some(position) = find(&raw, b"\r\n\r\n") {
                    break Some(position + 4);
                }
            };

            let Some(body_start) = header_end else {
                continue;
            };

            let headers = String::from_utf8_lossy(&raw[..body_start]).to_string();
            let mut request = Observed {
                method: headers
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().next())
                    .unwrap_or_default()
                    .to_string(),
                path: headers
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or_default()
                    .to_string(),
                headers: headers.clone(),
                body: Vec::new(),
            };

            let length: usize = request
                .header("content-length")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);

            let mut body = raw[body_start..].to_vec();
            while body.len() < length {
                let read = socket.read(&mut chunk).await.unwrap_or(0);
                if read == 0 {
                    break;
                }
                body.extend_from_slice(&chunk[..read]);
            }
            request.body = body;

            let response = format!(
                "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.status,
                reply.body.len(),
                reply.body
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;

            observed.push(request);
        }

        observed
    });

    (format!("http://{address}"), handle)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// A client pointed at `base`, with polling shortened so a test does not wait.
fn client(base: &str) -> OpenCloudClient {
    OpenCloudClient::new("test-key")
        .expect("client")
        .with_endpoint(
            format!("{base}/assets/v1/assets"),
            format!("{base}/cloud/v2"),
            3,
            Duration::from_millis(1),
        )
}

const GLB: &[u8] = b"glTF\x02\x00\x00\x00glTF";

#[test]
fn the_multipart_encoder_writes_exact_bytes() {
    let encoded = encode_multipart(
        &[Part {
            name: "request",
            filename: None,
            content_type: Some("application/json"),
            body: b"{}",
        }],
        "BOUND",
    );

    assert_eq!(encoded.boundary, "BOUND");
    assert_eq!(
        String::from_utf8(encoded.body).unwrap(),
        "--BOUND\r\n\
         Content-Disposition: form-data; name=\"request\"\r\n\
         Content-Type: application/json\r\n\
         \r\n\
         {}\r\n\
         --BOUND--\r\n"
    );
}

#[test]
fn the_multipart_encoder_carries_a_filename_for_the_file_part() {
    let encoded = encode_multipart(
        &[Part {
            name: "fileContent",
            filename: Some("crate.glb"),
            content_type: Some("model/gltf-binary"),
            body: GLB,
        }],
        "B",
    );

    let text = String::from_utf8_lossy(&encoded.body);
    assert!(
        text.contains("Content-Disposition: form-data; name=\"fileContent\"; filename=\"crate.glb\""),
        "{text}"
    );
    assert!(text.contains("Content-Type: model/gltf-binary"), "{text}");
    // The model bytes survive untouched, including the NULs in the header.
    assert!(encoded.body.windows(GLB.len()).any(|window| window == GLB));
}

#[test]
fn a_model_request_serialises_the_fields_roblox_reads() {
    let request = CreateAssetRequest::model("834159885", "Crate", "Made with Termul");
    let json = serde_json::to_value(&request).unwrap();

    assert_eq!(json["assetType"], "Model");
    assert_eq!(json["displayName"], "Crate");
    assert_eq!(json["description"], "Made with Termul");
    assert_eq!(json["creationContext"]["creator"]["userId"], "834159885");
    // A user-owned asset must not also name a group.
    assert!(json["creationContext"]["creator"].get("groupId").is_none());
}

#[test]
fn a_request_is_rejected_before_a_round_trip_when_it_cannot_work() {
    let mut request = CreateAssetRequest::model("1", "Crate", "");
    assert!(request.validate().is_ok());

    request.display_name = "   ".to_string();
    assert!(request.validate().unwrap_err().contains("displayName"));

    let mut both = CreateAssetRequest::model("1", "Crate", "");
    both.creation_context.creator.group_id = Some("2".to_string());
    assert!(both.validate().unwrap_err().contains("not both"));

    let mut neither = CreateAssetRequest::model("1", "Crate", "");
    neither.creation_context.creator.user_id = None;
    assert!(neither.validate().unwrap_err().contains("needs a userId"));
}

#[test]
fn an_asset_id_is_read_whether_roblox_sends_a_number_or_a_string() {
    let numeric: Operation =
        serde_json::from_str(r#"{"done":true,"response":{"assetId":123}}"#).unwrap();
    assert_eq!(numeric.asset_id(), Some(123));

    let textual: Operation =
        serde_json::from_str(r#"{"done":true,"response":{"assetId":"456"}}"#).unwrap();
    assert_eq!(textual.asset_id(), Some(456));

    let absent: Operation = serde_json::from_str(r#"{"done":false}"#).unwrap();
    assert_eq!(absent.asset_id(), None);
}

#[test]
fn a_poll_url_is_absolute_and_absent_once_done() {
    let pending: Operation =
        serde_json::from_str(r#"{"path":"assets/v1/assets/9/versions/1","done":false}"#).unwrap();
    assert_eq!(
        pending.poll_url(OPERATION_BASE_URL).as_deref(),
        Some("https://apis.roblox.com/cloud/v2/assets/v1/assets/9/versions/1")
    );

    // A leading slash must not double up.
    let slashed: Operation =
        serde_json::from_str(r#"{"path":"/assets/v1/assets/9","done":false}"#).unwrap();
    assert_eq!(
        slashed.poll_url(OPERATION_BASE_URL).as_deref(),
        Some("https://apis.roblox.com/cloud/v2/assets/v1/assets/9")
    );

    let done: Operation = serde_json::from_str(r#"{"path":"x","done":true}"#).unwrap();
    assert_eq!(done.poll_url(OPERATION_BASE_URL), None);
}

#[test]
fn a_refusal_names_the_field_and_the_scope_hint() {
    let unauthorized = describe_refusal(401, r#"{"message":"Invalid API key"}"#, "test-key");
    assert!(unauthorized.contains("Invalid API key"), "{unauthorized}");
    assert!(unauthorized.contains("asset:write"), "{unauthorized}");

    let bad_request = describe_refusal(400, r#"{"errors":[{"message":"displayName is required"}]}"#, "test-key");
    assert!(bad_request.contains("displayName is required"), "{bad_request}");

    let bare = describe_refusal(500, "", "test-key");
    assert!(bare.contains("500"), "{bare}");
}

#[test]
fn a_refusal_body_that_echoes_the_key_value_redacts_only_the_value() {
    // A proxy can echo the header back. The secret must go; the diagnostic
    // wording around it must stay, because "Invalid API key" is the part a user
    // can act on.
    let echoed = r#"{"message":"Invalid API key: abc-123-secret"}"#;
    let scrubbed = describe_refusal(403, echoed, "abc-123-secret");

    assert!(!scrubbed.contains("abc-123-secret"), "{scrubbed}");
    assert!(scrubbed.contains("<redacted>"), "{scrubbed}");
    assert!(scrubbed.contains("Invalid API key"), "{scrubbed}");
    assert!(scrubbed.contains("asset:write"), "{scrubbed}");
}

#[test]
fn a_refusal_keeps_its_wording_when_no_key_appears_in_it() {
    let plain = describe_refusal(400, r#"{"message":"displayName is required"}"#, "abc-123-secret");
    assert!(plain.contains("displayName is required"), "{plain}");
    assert!(!plain.contains("<redacted>"), "{plain}");
}

#[tokio::test]
async fn an_upload_sends_both_parts_and_returns_the_asset_id() {
    let (base, server) = serve(vec![Reply::ok(r#"{"done":true,"response":{"assetId":777}}"#)]).await;

    let uploaded = client(&base)
        .upload_model(
            &CreateAssetRequest::model("834159885", "Crate", "Made with Termul"),
            "crate.glb",
            GLB,
        )
        .await
        .expect("upload");

    assert_eq!(uploaded.asset_id, 777);

    let observed = server.await.unwrap();
    assert_eq!(observed.len(), 1);
    let request = &observed[0];

    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/assets/v1/assets");
    assert_eq!(request.header("x-api-key").as_deref(), Some("test-key"));

    let content_type = request.header("content-type").expect("content type");
    assert!(content_type.starts_with("multipart/form-data; boundary="), "{content_type}");

    // Both parts arrive, and the file part still holds the model bytes.
    let body = request.body_text();
    assert!(body.contains("name=\"request\""), "{body}");
    assert!(body.contains("\"assetType\":\"Model\""), "{body}");
    assert!(body.contains("name=\"fileContent\"; filename=\"crate.glb\""), "{body}");
    assert!(request.body.windows(GLB.len()).any(|window| window == GLB));

    // The boundary in the header is the one that frames the body.
    let boundary = content_type
        .split("boundary=")
        .nth(1)
        .expect("boundary")
        .to_string();
    assert!(body.starts_with(&format!("--{boundary}\r\n")), "{body}");
    assert!(body.ends_with(&format!("--{boundary}--\r\n")), "{body}");
}

#[tokio::test]
async fn an_upload_polls_until_the_operation_finishes() {
    let (base, server) = serve(vec![
        // The create call only hands back a path.
        Reply::ok(r#"{"path":"assets/v1/assets/9/versions/1","done":false}"#),
        // First poll: still working.
        Reply::ok(r#"{"path":"assets/v1/assets/9/versions/1","done":false}"#),
        // Second poll: done.
        Reply::ok(r#"{"done":true,"response":{"assetId":"42"}}"#),
    ])
    .await;

    let uploaded = client(&base)
        .upload_model(&CreateAssetRequest::model("1", "Crate", ""), "crate.glb", GLB)
        .await
        .expect("upload");

    assert_eq!(uploaded.asset_id, 42);

    let observed = server.await.unwrap();
    assert_eq!(observed.len(), 3);
    assert_eq!(observed[0].method, "POST");
    // Polls are GETs on the operation path, and they carry the key too.
    assert_eq!(observed[1].method, "GET");
    assert!(observed[1].path.contains("/assets/v1/assets/9/versions/1"), "{:?}", observed[1].path);
    assert_eq!(observed[1].header("x-api-key").as_deref(), Some("test-key"));
}

#[tokio::test]
async fn an_unfinished_upload_reports_roblox_has_not_processed_it() {
    // Every poll says "not done", so the retry budget runs out.
    let (base, server) = serve(vec![
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false}"#),
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false}"#),
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false}"#),
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false}"#),
    ])
    .await;

    let error = client(&base)
        .upload_model(&CreateAssetRequest::model("1", "Crate", ""), "crate.glb", GLB)
        .await
        .unwrap_err();

    assert!(error.contains("has not finished processing"), "{error}");
    let _ = server.await;
}

#[tokio::test]
async fn a_moderation_note_is_surfaced_rather_than_a_generic_timeout() {
    let (base, server) = serve(vec![
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false}"#),
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false,"moderation_note":"Rejected"}"#),
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false,"moderation_note":"Rejected"}"#),
        Reply::ok(r#"{"path":"assets/v1/assets/9","done":false,"moderation_note":"Rejected"}"#),
    ])
    .await;

    let error = client(&base)
        .upload_model(&CreateAssetRequest::model("1", "Crate", ""), "crate.glb", GLB)
        .await
        .unwrap_err();

    assert!(error.contains("Rejected"), "{error}");
    let _ = server.await;
}

#[tokio::test]
async fn a_401_becomes_an_actionable_message() {
    let (base, server) = serve(vec![Reply::status(401, r#"{"message":"Invalid API key"}"#)]).await;

    let error = client(&base)
        .upload_model(&CreateAssetRequest::model("1", "Crate", ""), "crate.glb", GLB)
        .await
        .unwrap_err();

    assert!(error.contains("401"), "{error}");
    assert!(error.contains("Invalid API key"), "{error}");
    assert!(error.contains("asset:write"), "{error}");
    let _ = server.await;
}

#[tokio::test]
async fn an_invalid_request_never_reaches_the_network() {
    // No replies are queued: if a request arrived, the server would block and the
    // assertion below would fail rather than the call succeeding.
    let (base, _server) = serve(vec![]).await;

    let error = client(&base)
        .upload_model(&CreateAssetRequest::model("1", "   ", ""), "crate.glb", GLB)
        .await
        .unwrap_err();

    assert!(error.contains("displayName"), "{error}");
}

#[tokio::test]
async fn an_empty_key_is_refused_when_the_client_is_built() {
    let error = OpenCloudClient::new("   ").unwrap_err();
    assert!(error.contains("API key"), "{error}");
}

#[tokio::test]
async fn introspect_reports_the_scopes_a_key_really_has() {
    let (base, server) = serve(vec![Reply::ok(
        r#"{"name":"termul","authorizedUserId":834159885,"enabled":true,"expired":false,
            "scopes":[{"name":"asset","operations":["write"]}]}"#,
    )])
    .await;

    let info = OpenCloudClient::new("test-key")
        .expect("client")
        .with_introspect_url(format!("{base}/api-keys/v1/introspect"))
        .introspect()
        .await
        .expect("introspect");

    assert_eq!(info.name, "termul");
    assert_eq!(info.authorized_user_id, Some(834159885));
    assert!(info.can_write_assets());
    assert!(info.upload_blocker().is_none());

    let observed = server.await.unwrap();
    assert_eq!(observed[0].method, "POST");
    assert_eq!(observed[0].path, "/api-keys/v1/introspect");
    // The key travels in the body, not a header: that is the endpoint's contract.
    assert!(observed[0].body_text().contains("test-key"));
}

#[tokio::test]
async fn a_key_that_does_not_exist_is_reported_as_such() {
    let (base, server) = serve(vec![Reply::status(
        404,
        r#"{"code":5,"message":"API Key does not exist."}"#,
    )])
    .await;

    let error = OpenCloudClient::new("not-a-key")
        .expect("client")
        .with_introspect_url(format!("{base}/api-keys/v1/introspect"))
        .introspect()
        .await
        .unwrap_err();

    assert!(error.contains("does not exist"), "{error}");
    let _ = server.await;
}

#[tokio::test]
async fn introspect_never_echoes_the_key_it_was_given() {
    let secret = "super-secret-key-value-0123456789";
    let (base, server) = serve(vec![Reply::status(401, r#"{"message":"no"}"#)]).await;

    let error = OpenCloudClient::new(secret)
        .expect("client")
        .with_introspect_url(format!("{base}/api-keys/v1/introspect"))
        .introspect()
        .await
        .unwrap_err();

    assert!(!error.contains(secret), "the key leaked into the error: {error}");
    let _ = server.await;
}
