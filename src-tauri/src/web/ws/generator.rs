//! `generator_reply`: the renderer's answer to an `acp:generator_call` event.
//!
//! The host forwards an agent's `generate_*` / `get_*_task` call to the
//! renderer over the event fan-out and parks the child's frame until this
//! arrives. A reply for a call nobody waits on any more (it timed out, or the
//! session closed) is accepted and ignored, so a late answer is never an
//! error the renderer has to handle.

use super::*;
use crate::acp::host_mcp::parent::GeneratorReplyPayload;

fn malformed(id: String, error: &serde_json::Error) -> WsReply {
    warn!(target: "termul::web::ws", "generator_reply refused: failure=malformed_payload");
    WsReply::err(
        id,
        WsErrorCode::Unsupported,
        format!("malformed generator_reply payload (want callId, ok, result | error): {error}"),
    )
}

pub(super) fn handle_generator_reply(id: String, payload: &Value, env: &HandlerEnv) -> WsReply {
    let parsed: GeneratorReplyPayload = match serde_json::from_value(payload.clone()) {
        Ok(parsed) => parsed,
        Err(error) => return malformed(id, &error),
    };
    if !parsed.ok && parsed.error.as_deref().unwrap_or("").is_empty() {
        return WsReply::err(
            id,
            WsErrorCode::Unsupported,
            "a failed generator_reply must carry an error message",
        );
    }
    let resolved = env.acp.answer_generator_call(parsed);
    if !resolved {
        debug!(
            target: "termul::web::ws",
            "generator_reply for a call that is no longer waiting"
        );
    }
    WsReply::ok(id, Some(json!({ "resolved": resolved })))
}
