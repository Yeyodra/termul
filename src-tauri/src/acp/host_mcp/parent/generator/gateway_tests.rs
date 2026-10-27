//! The parent's half of a generator call: what reaches the renderer, and what
//! happens when no renderer answers.

use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::acp::host_mcp::parent::{GeneratorReplyPayload, EVENT_GENERATOR_CALL};

/// Records only the generator events, so the assertions read as the wire
/// contract rather than as a filter over unrelated traffic.
#[derive(Default)]
struct Sink {
    events: std::sync::Mutex<Vec<serde_json::Value>>,
}

impl Sink {
    fn of_type(&self, wanted: &str) -> Vec<serde_json::Value> {
        let _ = wanted;
        self.events.lock().unwrap().clone()
    }
}

impl crate::web::EventSink for Sink {
    fn emit(&self, event: &crate::web::sink::AcpEvent) {
        if event.type_ == EVENT_GENERATOR_CALL {
            self.events.lock().unwrap().push(event.payload.clone());
        }
    }
}

fn server_with_sink() -> (Arc<HostPlanServer>, Arc<Sink>) {
    let sink = Arc::new(Sink::default());
    let server = HostPlanServer::start(vec![sink.clone()], None);
    (server, sink)
}

fn bind(server: &HostPlanServer, agent: &str, session: &str) -> String {
    let (_, token, provisional) = server.register_session(agent);
    server.bind_session(&token, session);
    server.begin_turn(agent, session);
    provisional
}

#[tokio::test]
async fn a_call_emits_one_event_naming_the_tool_and_its_arguments() {
    let (server, sink) = server_with_sink();
    let provisional = bind(&server, "agent-1", "session-1");

    let answer = tokio::spawn({
        let server = Arc::clone(&server);
        async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let event = sink.of_type(EVENT_GENERATOR_CALL).first().cloned();
            event
        }
    });
    let reply = server
        .generator_call(
            "agent-1",
            "session-1",
            Some("generate_clothing".into()),
            Some(r#"{"type":"shirt"}"#.into()),
        )
        .await;
    assert!(!reply.ok, "no renderer answered");

    let event = answer.await.expect("event task").expect("an event");
    assert_eq!(event["tool"], "generate_clothing");
    assert_eq!(event["arguments"], r#"{"type":"shirt"}"#);
    assert_eq!(event["sessionId"], "session-1");
    assert_eq!(event["agentId"], "agent-1");
    assert!(event["callId"].is_u64());
    drop(provisional);
}

#[tokio::test]
async fn the_event_and_the_frame_share_one_call_id() {
    let (server, sink) = server_with_sink();
    bind(&server, "agent-1", "session-1");

    let waiter = tokio::spawn({
        let server = Arc::clone(&server);
        async move {
            for _ in 0..200 {
                if let Some(event) = sink.of_type(EVENT_GENERATOR_CALL).first() {
                    let call_id = event["callId"].as_u64().expect("callId");
                    return server.answer_generator_call(GeneratorReplyPayload {
                        call_id,
                        ok: true,
                        result: Some(serde_json::json!({ "taskId": "t-9" })),
                        error: None,
                    });
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            false
        }
    });

    let reply = server
        .generator_call("agent-1", "session-1", Some("generate_clothing".into()), None)
        .await;

    assert!(waiter.await.expect("waiter"), "the answer matched the event");
    assert!(reply.ok, "{reply:?}");
    assert_eq!(reply.result, Some(serde_json::json!({ "taskId": "t-9" })));
}

#[tokio::test]
async fn a_frame_without_a_tool_is_refused_before_any_event() {
    let (server, sink) = server_with_sink();
    bind(&server, "agent-1", "session-1");

    let reply = server.generator_call("agent-1", "session-1", None, None).await;

    assert!(!reply.ok);
    assert!(reply.error.unwrap_or_default().contains("needs a tool name"));
    assert!(sink.of_type(EVENT_GENERATOR_CALL).is_empty());
}

#[tokio::test]
async fn a_failed_answer_carries_its_message_to_the_caller() {
    let (server, sink) = server_with_sink();
    bind(&server, "agent-1", "session-1");

    let waiter = tokio::spawn({
        let server = Arc::clone(&server);
        async move {
            for _ in 0..200 {
                if let Some(event) = sink.of_type(EVENT_GENERATOR_CALL).first() {
                    let call_id = event["callId"].as_u64().expect("callId");
                    return server.answer_generator_call(GeneratorReplyPayload {
                        call_id,
                        ok: false,
                        result: None,
                        error: Some("generate_3d has no engine".to_string()),
                    });
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            false
        }
    });

    let reply = server
        .generator_call("agent-1", "session-1", Some("generate_3d".into()), None)
        .await;

    assert!(waiter.await.expect("waiter"));
    assert!(!reply.ok);
    assert_eq!(reply.error.as_deref(), Some("generate_3d has no engine"));
}

#[tokio::test]
async fn a_closed_session_fails_its_parked_call_instead_of_leaving_it_hanging() {
    let (server, sink) = server_with_sink();
    bind(&server, "agent-1", "session-1");

    let closer = tokio::spawn({
        let server = Arc::clone(&server);
        async move {
            for _ in 0..200 {
                if !sink.of_type(EVENT_GENERATOR_CALL).is_empty() {
                    server.cancel_generator_calls_for_session("session-1");
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }
    });

    let reply = server
        .generator_call("agent-1", "session-1", Some("generate_clothing".into()), None)
        .await;
    closer.await.expect("closer");

    assert!(!reply.ok);
    assert!(reply
        .error
        .unwrap_or_default()
        .contains("session closed before the generator answered"));
}
