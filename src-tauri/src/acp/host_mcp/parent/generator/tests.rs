use super::*;
use crate::acp::host_mcp::{generator_tools, FrameKind, FrameRequest};

#[test]
fn a_generator_frame_round_trips_its_tool_and_arguments() {
    let frame = FrameRequest {
        token: "token".into(),
        session_id: "provisional".into(),
        kind: FrameKind::Generator,
        generator_tool: Some("generate_clothing".into()),
        generator_args: Some(r#"{"type":"shirt","prompt":"striped"}"#.into()),
        ..FrameRequest::default()
    };
    let encoded = serde_json::to_string(&frame).expect("encode");
    let decoded: FrameRequest = serde_json::from_str(&encoded).expect("decode");
    assert_eq!(decoded.kind, FrameKind::Generator);
    assert_eq!(decoded.generator_tool.as_deref(), Some("generate_clothing"));
    assert_eq!(
        decoded.generator_args.as_deref(),
        Some(r#"{"type":"shirt","prompt":"striped"}"#)
    );
}

#[test]
fn a_generator_frame_omits_absent_fields_on_the_wire() {
    let frame = FrameRequest {
        token: "token".into(),
        session_id: "provisional".into(),
        kind: FrameKind::Generator,
        ..FrameRequest::default()
    };
    let encoded = serde_json::to_string(&frame).expect("encode");
    assert!(!encoded.contains("generator_tool"), "{encoded}");
    assert!(!encoded.contains("generator_args"), "{encoded}");
}

#[test]
fn the_generator_kind_serializes_as_snake_case() {
    let encoded = serde_json::to_string(&FrameKind::Generator).expect("encode");
    assert_eq!(encoded, "\"generator\"");
}

#[test]
fn a_reply_without_a_waiting_call_resolves_nothing() {
    let server = crate::acp::host_mcp::parent::tests::test_server();
    assert!(!server.answer_generator_call(GeneratorReplyPayload {
        call_id: 999,
        ok: true,
        result: None,
        error: None,
    }));
}

#[test]
fn a_parked_call_is_resolved_by_its_answer() {
    let server = crate::acp::host_mcp::parent::tests::test_server();
    let reply = GeneratorReplyPayload {
        call_id: 7,
        ok: true,
        result: Some(serde_json::json!({ "taskId": "t-1" })),
        error: None,
    };
    server.park_generator_for_tests(7, "session-1");
    assert!(server.answer_generator_call(reply));
    assert!(!server.answer_generator_call(GeneratorReplyPayload {
        call_id: 7,
        ok: true,
        result: None,
        error: None,
    }));
}

#[test]
fn closing_a_session_drops_its_parked_calls() {
    let server = crate::acp::host_mcp::parent::tests::test_server();
    server.park_generator_for_tests(1, "session-1");
    server.park_generator_for_tests(2, "session-2");
    server.cancel_generator_calls_for_session("session-1");
    assert!(!server.answer_generator_call(GeneratorReplyPayload {
        call_id: 1,
        ok: true,
        result: None,
        error: None,
    }));
    assert!(server.answer_generator_call(GeneratorReplyPayload {
        call_id: 2,
        ok: true,
        result: None,
        error: None,
    }));
}

#[test]
fn every_advertised_generator_tool_parses_back_to_its_family() {
    for tool in generator_tools::tools() {
        let (engine, _) = generator_tools::parse_tool(&tool.name).expect("parses");
        assert!(!engine.is_empty());
    }
}
