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

/// Event telling the renderer where a finished garment landed.
///
/// The renderer answers the call before this write happens, so it cannot learn
/// the record path from its own reply: the save note is attached afterwards and
/// goes to the agent. This event is how a page already open on the project
/// refreshes without polling the disk.
pub const EVENT_ARTIFACT_SAVED: &str = "acp:artifact_saved";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSavedEvent {
    pub session_id: String,
    pub slug: String,
    pub kind: String,
    pub version: u64,
    pub item_path: String,
    pub relative: String,
    pub task_id: Option<String>,
}

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
    ///
    /// The atlas is kept per version rather than overwritten, unlike RobloxKit:
    /// its chat link carries the item, so an old card opens the newest version.
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
        let record_dir = garment_dir(fields);
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
        let still = fields
            .get("image")
            .and_then(|value| value.as_str())
            .and_then(|url| decode_data_url(url).ok());
        let version = version_fields(fields);
        let root = scope.root.clone();
        let requested = record_dir.clone();
        let written = tokio::task::spawn_blocking(move || {
            write_record(&root, &requested, &bytes, still.as_deref(), version)
        })
        .await;
        let kind = fields
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("clothing")
            .to_string();
        let task_id = fields
            .get("taskId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let note = match written {
            Ok(Ok(saved)) => {
                events::fan_out(
                    &self.sinks,
                    Some(session_id),
                    EVENT_ARTIFACT_SAVED,
                    &ArtifactSavedEvent {
                        session_id: session_id.to_string(),
                        slug: saved.slug.clone(),
                        kind,
                        version: saved.version,
                        item_path: saved.item_absolute.clone(),
                        relative: saved.atlas_relative.clone(),
                        task_id,
                    },
                );
                serde_json::json!({
                    "saved": true,
                    "path": saved.atlas_absolute,
                    "relative": saved.atlas_relative,
                    "itemPath": saved.item_absolute,
                    "slug": saved.slug,
                    "version": saved.version,
                })
            }
            Ok(Err(error)) => serde_json::json!({ "saved": false, "reason": error }),
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

fn garment_dir(fields: &serde_json::Map<String, Value>) -> String {
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
    format!(".termul/generated/{kind}/{name}")
}

fn version_fields(fields: &serde_json::Map<String, Value>) -> Value {
    let text = |key: &str| fields.get(key).and_then(Value::as_str).map(str::to_string);
    serde_json::json!({
        "prompt": text("prompt"),
        "design": fields.get("design").cloned().unwrap_or(Value::Null),
        "ok": fields
            .get("report")
            .and_then(|report| report.get("ok"))
            .and_then(Value::as_bool),
        "name": text("name"),
        "kind": text("kind"),
    })
}

struct SavedRecord {
    slug: String,
    version: u64,
    atlas_absolute: String,
    atlas_relative: String,
    item_absolute: String,
}

/// Append one version to `<root>/<record_dir>/item.json`, writing its atlas and
/// its still beside it. The read-modify-write of the record happens under one
/// blocking call so two generations of the same slug cannot both read the same
/// `max(n)` and write the same `v<n>.png`.
fn write_record(
    root: &std::path::Path,
    record_dir: &str,
    atlas: &[u8],
    still: Option<&[u8]>,
    version: Value,
) -> Result<SavedRecord, String> {
    use crate::acp::host_mcp::canvas_policy::write_project_file;

    let item_relative = format!("{record_dir}/item.json");
    let existing = read_record(root, &item_relative);
    let n = existing
        .get("versions")
        .and_then(Value::as_array)
        .map(|versions| {
            versions
                .iter()
                .filter_map(|version| version.get("n").and_then(Value::as_u64))
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0)
        + 1;

    let atlas_name = format!("v{n}.png");
    let atlas_relative = format!("{record_dir}/{atlas_name}");
    let atlas_file = write_project_file(root, &atlas_relative, atlas).map_err(|error| error.message)?;

    let still_name = match still {
        Some(bytes) => {
            let name = format!("v{n}.still.png");
            write_project_file(root, &format!("{record_dir}/{name}"), bytes)
                .map_err(|error| error.message)?;
            Value::String(name)
        }
        None => Value::Null,
    };

    let now = now_millis();
    let mut version = version;
    if let Some(fields) = version.as_object_mut() {
        fields.insert("n".to_string(), serde_json::json!(n));
        fields.insert("at".to_string(), serde_json::json!(now));
        fields.insert("atlas".to_string(), Value::String(atlas_name));
        fields.insert("still".to_string(), still_name);
    }

    let slug = record_dir
        .rsplit('/')
        .next()
        .unwrap_or(record_dir)
        .to_string();
    let mut record = existing;
    let fields = record
        .as_object_mut()
        .ok_or_else(|| "the record is not an object".to_string())?;
    fields.insert("schema".to_string(), serde_json::json!(1));
    fields.insert("slug".to_string(), Value::String(slug.clone()));
    fields.insert("current".to_string(), serde_json::json!(n));
    fields.insert("updatedAt".to_string(), serde_json::json!(now));
    fields
        .entry("createdAt")
        .or_insert_with(|| serde_json::json!(now));
    let versions = fields
        .entry("versions")
        .or_insert_with(|| Value::Array(Vec::new()));
    match versions.as_array_mut() {
        Some(list) => list.push(version),
        None => *versions = Value::Array(vec![version]),
    }

    let item_file = write_project_file(root, &item_relative, record.to_string().as_bytes())
        .map_err(|error| error.message)?;

    Ok(SavedRecord {
        slug,
        version: n,
        atlas_absolute: atlas_file.absolute.to_string_lossy().to_string(),
        atlas_relative: atlas_file.relative,
        item_absolute: item_file.absolute.to_string_lossy().to_string(),
    })
}

/// The existing record, or an empty object when it is missing or unreadable.
/// A corrupt record must not fail a generation: the picture is already rendered,
/// so the record is rebuilt from this version.
fn read_record(root: &std::path::Path, relative: &str) -> Value {
    let path = root.join(relative);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return serde_json::json!({});
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(value) if value.is_object() => value,
        _ => {
            log::warn!(
                "[generator] record `{}` is not valid JSON; starting a fresh one",
                relative
            );
            serde_json::json!({})
        }
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
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
