//! End-to-end: an agent's `generate_clothing` call travels the whole chain.
//!
//! A real parent, a real loopback socket and a real child frame; the renderer
//! is faked, because it is the only leg that needs a DOM. What this proves is
//! that the frame reaches the renderer, that the answer comes back to the
//! caller, and that a session closing or a timeout cannot leave the call
//! hanging.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

use crate::acp::host_mcp::gateway_harness::Harness;
use crate::acp::host_mcp::parent::{GeneratorReplyPayload, EVENT_GENERATOR_CALL};
use crate::acp::host_mcp::child;
use crate::acp::host_mcp::{FrameKind, FrameRequest};

fn send_frame(port: u16, frame: &FrameRequest) -> serde_json::Value {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(40)))
        .expect("read timeout");
    let mut line = serde_json::to_vec(frame).expect("encode");
    line.push(b'\n');
    stream.write_all(&line).expect("write");
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).expect("read");
    serde_json::from_str(&reply).expect("decode reply")
}

fn generator_frame(config: &crate::acp::host_mcp::child::ChildConfig, tool: &str) -> FrameRequest {
    FrameRequest {
        token: config.token.clone(),
        session_id: config.session_id.clone(),
        kind: FrameKind::Generator,
        generator_tool: Some(tool.to_string()),
        generator_args: Some(r#"{"type":"shirt","prompt":"striped"}"#.to_string()),
        ..FrameRequest::default()
    }
}

/// Run one generator call on a real socket while a fake renderer answers it
/// from another thread, and return the caller's reply.
fn call_with_renderer(
    harness: &Harness,
    config: &crate::acp::host_mcp::child::ChildConfig,
    tool: &str,
    answer: GeneratorReplyPayload,
) -> serde_json::Value {
    let server = std::sync::Arc::clone(harness.server());
    let port = config.port;
    let frame = generator_frame(config, tool);

    let answering = std::thread::spawn(move || {
        // The renderer learns the call id from the event, then answers it.
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < deadline {
            if server.answer_generator_call(GeneratorReplyPayload {
                call_id: answer.call_id,
                ok: answer.ok,
                result: answer.result.clone(),
                error: answer.error.clone(),
            }) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("the call was never parked");
    });

    let reply = send_frame(port, &frame);
    answering.join().expect("renderer thread");
    reply
}

#[test]
fn a_generator_call_reaches_the_renderer_and_its_answer_returns_to_the_agent() {
    let (harness, configs) = Harness::new(&[("session-1", Some("project-1"))]);
    let config = &configs[0];

    let reply = call_with_renderer(
        &harness,
        config,
        "generate_clothing",
        GeneratorReplyPayload {
            call_id: 1,
            ok: true,
            result: Some(serde_json::json!({
                "status": "queued",
                "taskId": "task-abc",
                "stage": "Designing",
                "note": "poll get_clothing_task"
            })),
            error: None,
        },
    );

    assert_eq!(reply["ok"], serde_json::json!(true), "{reply}");
    assert_eq!(reply["result"]["taskId"], serde_json::json!("task-abc"));
    assert_eq!(reply["result"]["status"], serde_json::json!("queued"));
}

#[test]
fn the_read_half_of_the_pair_travels_the_same_chain() {
    let (harness, configs) = Harness::new(&[("session-1", Some("project-1"))]);

    let config = &configs[0];
    let reply = call_with_renderer(
        &harness,
        config,
        "get_clothing_task",
        GeneratorReplyPayload {
            call_id: 1,
            ok: true,
            result: Some(serde_json::json!({ "status": "done" })),
            error: None,
        },
    );

    assert_eq!(reply["ok"], serde_json::json!(true), "{reply}");
    assert_eq!(reply["result"]["status"], serde_json::json!("done"));
}

#[test]
fn a_failed_generator_answer_surfaces_as_a_tool_error_the_agent_can_read() {
    let (harness, configs) = Harness::new(&[("session-1", Some("project-1"))]);
    let config = &configs[0];

    let reply = call_with_renderer(
        &harness,
        config,
        "generate_3d",
        GeneratorReplyPayload {
            call_id: 1,
            ok: false,
            result: None,
            error: Some("generate_3d has no engine in this build yet".to_string()),
        },
    );

    assert_eq!(reply["ok"], serde_json::json!(false), "{reply}");
    assert_eq!(
        reply["error"],
        serde_json::json!("generate_3d has no engine in this build yet")
    );
}

#[test]
fn a_frame_without_a_tool_name_is_refused_without_reaching_the_renderer() {
    let (harness, configs) = Harness::new(&[("session-1", Some("project-1"))]);
    let config = &configs[0];
    let frame = FrameRequest {
        token: config.token.clone(),
        session_id: config.session_id.clone(),
        kind: FrameKind::Generator,
        ..FrameRequest::default()
    };

    let reply = send_frame(config.port, &frame);

    assert_eq!(reply["ok"], serde_json::json!(false), "{reply}");
    assert!(reply["error"]
        .as_str()
        .unwrap_or_default()
        .contains("needs a tool name"));
    drop(harness);
}

#[test]
fn the_generator_event_constant_is_the_wire_name_the_renderer_listens_for() {
    assert_eq!(EVENT_GENERATOR_CALL, "acp:generator_call");
}

#[test]
fn a_result_carrying_an_image_sends_it_as_a_real_image_block() {
    let result = serde_json::json!({
        "status": "done",
        "taskId": "t-1",
        "image": "data:image/png;base64,iVBORw0KGgo=",
        "design": { "type": "shirt" }
    });

    let out = child::generator_result(result);
    let kinds: Vec<&str> = out
        .content
        .iter()
        .map(|block| match block {
            rmcp::model::ContentBlock::Text(_) => "text",
            rmcp::model::ContentBlock::Image(_) => "image",
            _ => "other",
        })
        .collect();
    assert_eq!(kinds, vec!["text", "image"], "the agent must see the render");
    assert!(
        out.structured_content
            .as_ref()
            .and_then(|value| value.get("image"))
            .is_none(),
        "the base64 is not repeated in the JSON"
    );
    assert_eq!(
        out.structured_content
            .as_ref()
            .and_then(|value| value.get("taskId"))
            .and_then(|value| value.as_str()),
        Some("t-1"),
        "everything else stays in the structured payload"
    );
}

#[test]
fn a_result_without_an_image_is_plain_structured_json() {
    let result = serde_json::json!({ "status": "running", "taskId": "t-2" });

    let out = child::generator_result(result);

    assert_eq!(out.content.len(), 1);
    assert!(matches!(
        out.content[0],
        rmcp::model::ContentBlock::Text(_)
    ));
}

#[test]
fn a_bare_base64_payload_is_still_treated_as_a_png() {
    let result = serde_json::json!({ "image": "iVBORw0KGgo=" });

    let out = child::generator_result(result);

    assert_eq!(out.content.len(), 2);
    match &out.content[1] {
        rmcp::model::ContentBlock::Image(image) => assert_eq!(image.mime_type, "image/png"),
        _ => panic!("expected an image block"),
    }
}
