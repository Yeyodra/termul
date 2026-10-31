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
use crate::web::sink::{record_host_event, HostRecordFanout};
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
        // A 3D engine reports its artifact in `model`; clothing reports an
        // `atlas`. Both are written through the same path, so whichever is
        // present becomes this version's main file.
        let model = fields
            .get("model")
            .and_then(|value| value.as_str().map(str::to_string));
        let atlas = fields
            .remove("atlas")
            .and_then(|value| value.as_str().map(str::to_string))
            .or_else(|| model.clone());
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
        let extension = artifact_extension(fields);
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
            write_record(&root, &requested, &bytes, still.as_deref(), version, extension)
        })
        .await;
        let kind = fields
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("artifact")
            .to_string();
        let note = match written {
            Ok(Ok(saved)) => {
                self.announce_artifact(session_id, &saved, &kind);
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

    /// Show the finished garment in the agent's own reply.
    ///
    /// A `message_chunk` is the only durable record that survives a relaunch and
    /// renders as a bubble: `tool_call` payloads are reduced to id/kind/status, so
    /// a picture written there is dropped. The chunk carries the file's URI, never
    /// the bytes - the atlas already lives in the record directory, and a base64
    /// copy would ride in every transcript write.
    fn announce_artifact(&self, session_id: &str, saved: &SavedRecord, kind: &str) {
        if saved.still_absolute.is_none() {
            return;
        }
        let chunk = serde_json::json!({
            "role": "agent",
            "content": {
                "type": "image",
                "uri": format!("file://{}", saved.still_absolute.as_deref().unwrap_or_default()),
                "mimeType": "image/png",
                "slug": saved.slug,
                "kind": kind,
                "version": saved.version,
            },
        });
        if let Err(error) = record_host_event(
            &self.sinks,
            session_id,
            "message_chunk",
            &chunk,
            HostRecordFanout::AllSinks,
        ) {
            log::warn!(
                "[generator] could not announce the saved garment for session {}: {error}",
                crate::logging::redact_session_id(session_id)
            );
        }
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

/// The record directory a save belongs to.
///
/// `recordSlug` wins when the caller knows it. That is the whole point of the
/// field: a revision must land in the SAME record as the garment it revises, and
/// the model's chosen name cannot be trusted for that. Asking the model to "keep
/// the same name" is a request; a slug is a fact. Without it a user who asked for
/// pants on top of a shirt got a second record and lost the first one's history.
///
/// The name is still the fallback, for an agent that only ever creates.
fn garment_dir(fields: &serde_json::Map<String, Value>) -> String {
    let kind = fields
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("artifact");
    let record_slug = fields
        .get("recordSlug")
        .and_then(Value::as_str)
        .map(slug)
        .filter(|slug| !slug.is_empty());
    let name = fields
        .get("name")
        .and_then(Value::as_str)
        .map(slug)
        .filter(|slug| !slug.is_empty())
        .unwrap_or_else(|| kind.to_string());
    format!(
        ".termul/generated/{kind}/{}",
        record_slug.unwrap_or(name)
    )
}

/// The file extension a record's main artifact gets.
///
/// A 3D engine reports its model in `model` as a `data:` URL whose media type
/// names the format; anything else (clothing, and every engine that predates
/// 3D) writes a PNG atlas. Defaulting to `png` keeps the clothing path
/// byte-identical to what it wrote before this parameter existed.
fn artifact_extension(fields: &serde_json::Map<String, Value>) -> &'static str {
    let model = fields.get("model").and_then(Value::as_str).unwrap_or("");
    if model.starts_with("data:model/gltf-binary") {
        "glb"
    } else if model.starts_with("data:model/gltf+json") {
        "gltf"
    } else if model.starts_with("data:model/stl") {
        "stl"
    } else {
        "png"
    }
}

/// What a save wrote, in the shape both callers report.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArtifact {
    pub slug: String,
    /// The folder the record was filed under.
    ///
    /// A slug is only unique within a kind, so a caller that wants to select the
    /// record it just wrote needs both: the same slug can exist under two kinds,
    /// and a pick that names only the slug selects whichever one is found first.
    pub kind: String,
    pub version: u64,
    pub path: String,
    pub relative: String,
    pub item_path: String,
}

/// Write a finished artifact into `root`, without a session.
///
/// This is the seam the page composer uses. `save_generated_garment` is reachable
/// only from `answer_generator_call`, which needs an agent's tool call parked and
/// waiting, so a user typing on a feature page had no way to produce a record
/// without going through a chat. The write itself is the same one, under the same
/// lock, so the two paths cannot disagree about how a record is laid out.
///
/// `result` is the engine's finished result, exactly as the renderer reports it
/// for a poll: `atlas`, optional `image`, `kind`, `name`, `prompt`, `design`,
/// `report`. Returns the write note, or an error string the caller shows.
pub fn save_artifact_result(
    root: &std::path::Path,
    result: &Value,
) -> Result<SavedArtifact, String> {
    let fields = result
        .as_object()
        .ok_or_else(|| "the result is not an object".to_string())?;

    // A garment reports its sheet as `atlas`; a 3D engine reports the GLB as
    // `model`. Reading only `atlas` rejected every model with "the result
    // carries no atlas", so a generation finished and was never written - the
    // page kept showing whatever record it already had.
    let artifact = fields
        .get("atlas")
        .or_else(|| fields.get("model"))
        .and_then(Value::as_str)
        .ok_or_else(|| "the result carries no atlas".to_string())?;
    let bytes = decode_data_url(artifact)?;

    let still = fields
        .get("image")
        .and_then(Value::as_str)
        .and_then(|url| decode_data_url(url).ok());
    let version = version_fields(fields);
    let record_dir = garment_dir(fields);
    let extension = artifact_extension(fields);

    let saved = write_record(root, &record_dir, &bytes, still.as_deref(), version, extension)?;
    Ok(SavedArtifact {
        slug: saved.slug,
        kind: record_dir
            .split('/')
            .nth(2)
            .unwrap_or("artifact")
            .to_string(),
        version: saved.version,
        path: saved.atlas_absolute,
        relative: saved.atlas_relative,
        item_path: saved.item_absolute,
    })
}

fn version_fields(fields: &serde_json::Map<String, Value>) -> Value {
    let text = |key: &str| fields.get(key).and_then(Value::as_str).map(str::to_string);
    let report = fields.get("report").cloned().unwrap_or(Value::Null);
    // `Value::get` on a non-object yields None, so `ok` is read through the same
    // object check the report itself needs.
    let ok = report.get("ok").and_then(Value::as_bool);
    // A garment engine names its authored document `design`; a 3D engine names
    // the same thing `spec`. Reading only `design` wrote `null` for every model,
    // so a stored model could not be rebuilt from its own record.
    let authored = fields
        .get("design")
        .or_else(|| fields.get("spec"))
        .cloned()
        .unwrap_or(Value::Null);
    serde_json::json!({
        "prompt": text("prompt"),
        "design": authored,
        "ok": ok,
        // The whole report, not just `ok`: a 3D version's checks are triangles,
        // size and the issue list, and the Inspector has nothing to show
        // without them. A garment carries it too, so one shape serves both.
        "report": report,
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
    still_absolute: Option<String>,
}

/// Append one version to `<root>/<record_dir>/item.json`, writing its atlas and
/// its still beside it. The read-modify-write of the record happens under one
/// blocking call so two generations of the same slug cannot both read the same
/// `max(n)` and write the same `v<n>.png`.
///
/// `extension` names the main artifact's file type: `png` for a clothing atlas,
/// `glb` for a 3D model. A 3D version also records `model` alongside `atlas`,
/// both pointing at the same file, so a reader that only knows `atlas` still
/// finds something to show and a reader that knows `model` does not have to
/// guess from the extension.
fn write_record(
    root: &std::path::Path,
    record_dir: &str,
    atlas: &[u8],
    still: Option<&[u8]>,
    version: Value,
    extension: &str,
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

    let atlas_name = format!("v{n}.{extension}");
    let atlas_relative = format!("{record_dir}/{atlas_name}");
    let atlas_file = write_project_file(root, &atlas_relative, atlas).map_err(|error| error.message)?;

    let (still_name, still_absolute) = match still {
        Some(bytes) => {
            let name = format!("v{n}.still.png");
            let file = write_project_file(root, &format!("{record_dir}/{name}"), bytes)
                .map_err(|error| error.message)?;
            (
                Value::String(name),
                Some(file.absolute.to_string_lossy().to_string()),
            )
        }
        None => (Value::Null, None),
    };

    let now = now_millis();
    let mut version = version;
    if let Some(fields) = version.as_object_mut() {
        fields.insert("n".to_string(), serde_json::json!(n));
        fields.insert("at".to_string(), serde_json::json!(now));
        fields.insert("atlas".to_string(), Value::String(atlas_name.clone()));
        fields.insert("still".to_string(), still_name);
        if extension != "png" {
            fields.insert("model".to_string(), Value::String(atlas_name));
        }
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
        still_absolute,
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
    // A 3D model arrives as `data:model/...`; every other artifact is an image.
    if !head.starts_with("data:image/") && !head.starts_with("data:model/") {
        return Err("the artifact is not an image or model data URL".to_string());
    }
    base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|error| format!("the artifact is not valid base64: {error}"))
}

#[cfg(test)]
#[path = "generator/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "generator/gateway_tests.rs"]
mod gateway_tests;
