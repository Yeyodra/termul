//! `Generator` frames: forward a `generate_*` / `get_*_task` call to the
//! renderer that holds the session's project, and wait for its reply.
//!
//! The engines live in the renderer — they need a canvas to rasterise into and
//! the model transport for `designLoop` — so the parent is a router here, not
//! an executor. Unlike the canvas gateway there is no mount registry: a
//! generation belongs to a project, not to an open editor, so the target is
//! resolved from the session's project on every call.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

use super::HostPlanServer;
use crate::acp::events;
use crate::acp::host_mcp::FrameReply;
/// How long the host waits for the renderer to answer one generator call.
///
/// A `generate_*` call only queues work and a `get_*_task` call only reads a
/// task, so both answer in milliseconds; the generation itself runs on the
/// renderer's task queue and is never awaited here.
pub const GENERATOR_CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// Event carrying one generator call to the renderer.
pub const EVENT_GENERATOR_CALL: &str = "acp:generator_call";

/// Parent → renderer: one generator call to run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorCallEvent {
    pub agent_id: String,
    pub session_id: String,
    pub call_id: u64,
    pub tool: String,
    pub arguments: String,
}

/// Renderer → parent: the outcome of one generator call.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorReplyPayload {
    pub call_id: u64,
    pub ok: bool,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

pub(super) struct PendingGenerator {
    session_id: String,
    responder: oneshot::Sender<GeneratorReplyPayload>,
}

impl HostPlanServer {
    pub(super) async fn generator_call(
        &self,
        agent_id: &str,
        session_id: &str,
        tool: Option<String>,
        arguments: Option<String>,
    ) -> FrameReply {
        let Some(tool) = tool else {
            return FrameReply::err("a generator frame needs a tool name");
        };
        let call_id = self.next_generator_call_id();
        let (responder, waiting) = oneshot::channel();
        self.pending_generators.lock().insert(
            call_id,
            PendingGenerator {
                session_id: session_id.to_string(),
                responder,
            },
        );

        let event = GeneratorCallEvent {
            agent_id: agent_id.to_string(),
            session_id: session_id.to_string(),
            call_id,
            tool: tool.clone(),
            arguments: arguments.unwrap_or_else(|| "{}".to_string()),
        };
        events::fan_out(
            &self.sinks,
            Some(session_id),
            EVENT_GENERATOR_CALL,
            &event,
        );
        log::debug!(
            "[generator] {tool} forwarded to session {} as call {call_id}",
            crate::logging::redact_session_id(session_id)
        );

        let outcome = tokio::time::timeout(GENERATOR_CALL_TIMEOUT, waiting).await;
        self.pending_generators.lock().remove(&call_id);

        match outcome {
            Ok(Ok(reply)) if reply.ok => {
                let result = self.save_generated_garment(session_id, reply.result).await;
                FrameReply::ok_with(result.unwrap_or(Value::Null))
            }
            Ok(Ok(reply)) => FrameReply::err(
                reply
                    .error
                    .unwrap_or_else(|| "the generator call failed".to_string()),
            ),
            Ok(Err(_)) => FrameReply::err("the generator call was dropped"),
            Err(_) => FrameReply::err(format!(
                "no renderer answered {tool} within {} s; is a Termul window open on this project?",
                GENERATOR_CALL_TIMEOUT.as_secs()
            )),
        }
    }

    /// Write a finished garment into the session's project and report where.
    ///
    /// The renderer renders in a canvas it cannot turn into a file, so it sends
    /// the atlas as base64 and the write happens here, through the same checked
    /// path the canvas export uses. A failed write is not a failed generation:
    /// the picture was already handed to the model, so the result is returned
    /// unchanged with a `save` note saying why no file exists.
    async fn save_generated_garment(
        &self,
        session_id: &str,
        result: Option<Value>,
    ) -> Option<Value> {
        let mut result = result?;
        let fields = result.as_object_mut()?;
        let atlas = fields
            .remove("atlas")
            .and_then(|value| value.as_str().map(str::to_string));
        let Some(atlas) = atlas else {
            return Some(result);
        };
        let Some(scope) = self.scope_of(session_id) else {
            fields.insert(
                "save".to_string(),
                serde_json::json!({
                    "saved": false,
                    "reason": "this session has no project folder, so there is nowhere to write \
                               the picture",
                }),
            );
            return Some(result);
        };
        let relative = garment_path(fields);
        let bytes = match decode_data_url(&atlas) {
            Ok(bytes) => bytes,
            Err(reason) => {
                fields.insert(
                    "save".to_string(),
                    serde_json::json!({ "saved": false, "reason": reason }),
                );
                return Some(result);
            }
        };
        let root = scope.root.clone();
        let requested = relative.clone();
        let written = tokio::task::spawn_blocking(move || {
            crate::acp::host_mcp::canvas_policy::write_project_file(&root, &requested, &bytes)
        })
        .await;
        let note = match written {
            Ok(Ok(file)) => serde_json::json!({
                "saved": true,
                "path": file.absolute.to_string_lossy(),
                "relative": file.relative,
            }),
            Ok(Err(error)) => serde_json::json!({ "saved": false, "reason": error.message }),
            Err(error) => serde_json::json!({
                "saved": false,
                "reason": format!("the write stopped: {error}"),
            }),
        };
        fields.insert("save".to_string(), note);
        Some(result)
    }

    /// Route the renderer's answer to the parked call. Returns `false` when
    /// the call already timed out or was never issued; a call whose waiter is
    /// gone still counts as resolved, so a late answer is not reported as an
    /// unknown call.
    pub fn answer_generator_call(&self, reply: GeneratorReplyPayload) -> bool {
        let Some(pending) = self.pending_generators.lock().remove(&reply.call_id) else {
            return false;
        };
        let _ = pending.responder.send(reply);
        true
    }

    /// Drop every parked generator call for a session that closed, so no
    /// agent tool call is left waiting on a renderer that moved on.
    pub fn cancel_generator_calls_for_session(&self, real_session_id: &str) {
        let dropped: Vec<PendingGenerator> = {
            let mut pending = self.pending_generators.lock();
            let ids: Vec<u64> = pending
                .iter()
                .filter(|(_, call)| call.session_id == real_session_id)
                .map(|(id, _)| *id)
                .collect();
            ids.iter().filter_map(|id| pending.remove(id)).collect()
        };
        for call in dropped {
            let _ = call.responder.send(GeneratorReplyPayload {
                call_id: 0,
                ok: false,
                result: None,
                error: Some("the session closed before the generator answered".to_string()),
            });
        }
    }

    fn next_generator_call_id(&self) -> u64 {
        self.generator_call_seq
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1
    }

    /// Park a call without a frame, so tests can exercise the reply and
    /// cancellation bookkeeping directly (tests only).
    #[cfg(test)]
    pub(crate) fn park_generator_for_tests(&self, call_id: u64, session_id: &str) {
        let (responder, _waiting) = oneshot::channel();
        self.pending_generators.lock().insert(
            call_id,
            PendingGenerator {
                session_id: session_id.to_string(),
                responder,
            },
        );
    }
}

/// Where a garment is written inside the project, mirroring RobloxKit's
/// `Documents/RobloxKit/clothing/<slug>.png` so a user who knows one layout
/// recognises the other.
fn garment_path(fields: &serde_json::Map<String, Value>) -> String {
    let kind = fields
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("clothing");
    let name = fields
        .get("name")
        .and_then(Value::as_str)
        .map(slug)
        .filter(|slug| !slug.is_empty())
        .unwrap_or_else(|| kind.to_string());
    format!(".termul/generated/{kind}/{name}.png")
}

/// Lowercase, `-` for runs of anything else, and empty when nothing usable is
/// left so the caller falls back to the garment kind.
fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut pending_dash = false;
    for ch in name.chars().take(40) {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.push(ch.to_ascii_lowercase());
        } else {
            pending_dash = true;
        }
    }
    out
}

/// The bytes of a `data:image/png;base64,…` URL. The renderer sends the atlas
/// this way because the renderer cannot reach the project folder itself.
fn decode_data_url(url: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    let (head, body) = url
        .split_once(',')
        .ok_or_else(|| "the picture is not a data URL".to_string())?;
    if !head.starts_with("data:image/") {
        return Err("the picture is not an image data URL".to_string());
    }
    base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|error| format!("the picture is not valid base64: {error}"))
}

#[cfg(test)]
#[path = "generator/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "generator/gateway_tests.rs"]
mod gateway_tests;
