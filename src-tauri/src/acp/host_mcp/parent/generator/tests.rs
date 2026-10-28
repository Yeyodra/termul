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


// --- the atlas written to disk -------------------------------------------

#[test]
fn a_garment_is_written_under_its_kind_and_slugged_name() {
    let fields = serde_json::json!({"kind": "shirt", "name": "Royal Robe!"});
    let fields = fields.as_object().unwrap();
    assert_eq!(garment_dir(fields), ".termul/generated/shirt/royal-robe");
}

#[test]
fn a_nameless_garment_falls_back_to_its_kind() {
    let fields = serde_json::json!({"kind": "pants"});
    assert_eq!(
        garment_dir(fields.as_object().unwrap()),
        ".termul/generated/pants/pants"
    );
}

#[test]
fn a_name_of_only_punctuation_falls_back_to_the_kind() {
    let fields = serde_json::json!({"kind": "tshirt", "name": "!!!"});
    assert_eq!(
        garment_dir(fields.as_object().unwrap()),
        ".termul/generated/tshirt/tshirt"
    );
}

#[test]
fn a_slug_keeps_letters_digits_and_collapses_runs() {
    assert_eq!(slug("A  b__c--D"), "a-b-c-d");
    assert_eq!(slug("  padded  "), "padded");
    assert_eq!(slug("!!!"), "");
}

#[test]
fn a_slug_is_capped_so_the_file_name_stays_short() {
    assert_eq!(slug(&"a".repeat(120)).len(), 40);
}

#[test]
fn a_png_data_url_decodes_to_its_bytes() {
    use base64::Engine as _;
    let png = b"\x89PNG\r\n\x1a\nnot really";
    let encoded = base64::engine::general_purpose::STANDARD.encode(png);
    let url = format!("data:image/png;base64,{encoded}");
    assert_eq!(decode_data_url(&url).unwrap(), png);
}

#[test]
fn a_data_url_that_is_not_an_image_is_refused() {
    let error = decode_data_url("data:text/plain;base64,aGk=").unwrap_err();
    assert!(error.contains("not an image"), "{error}");
}

#[test]
fn a_data_url_with_no_comma_is_refused() {
    let error = decode_data_url("data:image/png;base64").unwrap_err();
    assert!(error.contains("not a data URL"), "{error}");
}

#[test]
fn a_data_url_with_broken_base64_is_refused() {
    let error = decode_data_url("data:image/png;base64,not base64!!").unwrap_err();
    assert!(error.contains("not valid base64"), "{error}");
}


// --- the garment write, end to end through the router ---------------------

fn garment_server(
    root: &std::path::Path,
    cwd: std::path::PathBuf,
) -> std::sync::Arc<HostPlanServer> {
    use crate::acp::session_persistence::SessionPersistence;
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let persistence = runtime
        .block_on(SessionPersistence::open(root.join("store")))
        .unwrap();
    runtime
        .block_on(persistence.register_session(crate::acp::SessionRegistration {
            session_id: "sess-real".into(),
            stable_agent_namespace: Some("config:test".into()),
            runtime_agent_id: Some("agent-1".into()),
            project_id: Some("proj-1".into()),
            cwd,
            ..Default::default()
        }))
        .unwrap();
    HostPlanServer::start(vec![], Some(persistence))
}

#[test]
fn a_finished_garment_is_written_into_the_project_and_reported() {
    use base64::Engine as _;
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    let server = garment_server(&root, cwd.clone());
    let png = b"\x89PNG\r\n\x1a\nfake";
    let encoded = base64::engine::general_purpose::STANDARD.encode(png);
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let saved = runtime.block_on(server.save_generated_garment(
        "sess-real",
        Some(serde_json::json!({
            "status": "done",
            "kind": "shirt",
            "name": "Royal Robe",
            "atlas": format!("data:image/png;base64,{encoded}"),
        })),
    ));
    let saved = saved.expect("a result");
    assert_eq!(saved["save"]["saved"], true, "{saved}");
    assert_eq!(
        saved["save"]["relative"],
        ".termul/generated/shirt/royal-robe/v1.png"
    );
    assert_eq!(saved["save"]["version"], 1);
    assert_eq!(saved["save"]["slug"], "royal-robe");
    assert_eq!(
        std::fs::read(cwd.join(".termul/generated/shirt/royal-robe/v1.png")).unwrap(),
        png
    );
    assert!(saved.get("atlas").is_none(), "the bytes must not ride along");
}

#[test]
fn a_garment_without_an_atlas_is_passed_through_untouched() {
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    let server = garment_server(&root, cwd);
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let result = runtime.block_on(server.save_generated_garment(
        "sess-real",
        Some(serde_json::json!({"status": "running", "stage": "Designing"})),
    ));
    let result = result.expect("a result");
    assert_eq!(result["stage"], "Designing");
    assert!(result.get("save").is_none(), "{result}");
}

#[test]
fn a_bad_atlas_reports_a_reason_instead_of_failing_the_generation() {
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    let server = garment_server(&root, cwd);
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let result = runtime.block_on(server.save_generated_garment(
        "sess-real",
        Some(serde_json::json!({
            "status": "done",
            "kind": "shirt",
            "atlas": "not a data url",
        })),
    ));
    let result = result.expect("a result");
    assert_eq!(result["status"], "done");
    assert_eq!(result["save"]["saved"], false, "{result}");
    assert!(
        result["save"]["reason"].as_str().unwrap().contains("data URL"),
        "{result}"
    );
}

// --- the versioned record -------------------------------------------------

fn garment(server: &HostPlanServer, name: &str, atlas: &[u8]) -> serde_json::Value {
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(atlas);
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime
        .block_on(server.save_generated_garment(
            "sess-real",
            Some(serde_json::json!({
                "status": "done",
                "kind": "shirt",
                "name": name,
                "prompt": "a red flannel",
                "design": {"type": "shirt", "layers": []},
                "report": {"ok": true},
                "atlas": format!("data:image/png;base64,{encoded}"),
            })),
        ))
        .expect("a result")
}

fn record(cwd: &std::path::Path, slug: &str) -> serde_json::Value {
    let text = std::fs::read_to_string(cwd.join(format!(".termul/generated/shirt/{slug}/item.json")))
        .expect("a record");
    serde_json::from_str(&text).expect("valid JSON")
}

#[test]
fn a_second_generation_appends_a_version_and_keeps_both_atlases() {
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    let server = garment_server(&root, cwd.clone());

    let first = garment(&server, "Royal Robe", b"first");
    let second = garment(&server, "Royal Robe", b"second");

    assert_eq!(first["save"]["version"], 1);
    assert_eq!(second["save"]["version"], 2);
    assert_eq!(
        std::fs::read(cwd.join(".termul/generated/shirt/royal-robe/v1.png")).unwrap(),
        b"first",
        "version 1 keeps its own picture"
    );
    assert_eq!(
        std::fs::read(cwd.join(".termul/generated/shirt/royal-robe/v2.png")).unwrap(),
        b"second"
    );

    let record = record(&cwd, "royal-robe");
    assert_eq!(record["current"], 2);
    assert_eq!(record["versions"].as_array().unwrap().len(), 2);
    assert_eq!(record["versions"][0]["n"], 1);
    assert_eq!(record["versions"][1]["n"], 2);
    assert_eq!(record["versions"][1]["prompt"], "a red flannel");
    assert_eq!(record["versions"][1]["ok"], true);
    assert_eq!(record["versions"][1]["atlas"], "v2.png");
    assert!(record["createdAt"].as_u64().is_some());
}

#[test]
fn a_corrupt_record_is_rebuilt_instead_of_failing_the_generation() {
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    let dir = cwd.join(".termul/generated/shirt/royal-robe");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("item.json"), b"this is not json").unwrap();
    let server = garment_server(&root, cwd.clone());

    let saved = garment(&server, "Royal Robe", b"png");

    assert_eq!(saved["save"]["saved"], true, "{saved}");
    assert_eq!(saved["save"]["version"], 1);
    let record = record(&cwd, "royal-robe");
    assert_eq!(record["versions"].as_array().unwrap().len(), 1);
}

#[test]
fn the_review_sheet_is_kept_beside_the_atlas_for_the_same_version() {
    use base64::Engine as _;
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    let server = garment_server(&root, cwd.clone());
    let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
    let runtime = tokio::runtime::Runtime::new().unwrap();

    let saved = runtime
        .block_on(server.save_generated_garment(
            "sess-real",
            Some(serde_json::json!({
                "status": "done",
                "kind": "shirt",
                "name": "Royal Robe",
                "atlas": format!("data:image/png;base64,{}", encode(b"atlas")),
                "image": format!("data:image/png;base64,{}", encode(b"sheet")),
            })),
        ))
        .expect("a result");

    assert_eq!(saved["save"]["saved"], true, "{saved}");
    assert_eq!(
        std::fs::read(cwd.join(".termul/generated/shirt/royal-robe/v1.still.png")).unwrap(),
        b"sheet"
    );
    assert_eq!(record(&cwd, "royal-robe")["versions"][0]["still"], "v1.still.png");
    assert!(
        saved.get("image").is_some(),
        "the sheet stays on the reply: the chat renders it, and child.rs lifts it \
         into an image content block"
    );
}

#[test]
fn two_garments_with_different_names_get_their_own_records() {
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    let server = garment_server(&root, cwd.clone());

    garment(&server, "Royal Robe", b"a");
    garment(&server, "Desert Camo", b"b");

    assert_eq!(record(&cwd, "royal-robe")["current"], 1);
    assert_eq!(record(&cwd, "desert-camo")["current"], 1);
}

// --- the saved event the page listens for --------------------------------

#[derive(Default)]
struct SavedSink {
    events: std::sync::Mutex<Vec<serde_json::Value>>,
}

impl crate::web::EventSink for SavedSink {
    fn emit(&self, event: &crate::web::sink::AcpEvent) {
        if event.type_ == EVENT_ARTIFACT_SAVED {
            self.events.lock().unwrap().push(event.payload.clone());
        }
    }
}

#[test]
fn a_saved_garment_announces_its_slug_and_version_to_the_renderer() {
    let root = std::env::temp_dir().join(format!("termul-garment-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    use crate::acp::session_persistence::SessionPersistence;
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let persistence = runtime
        .block_on(SessionPersistence::open(root.join("store")))
        .unwrap();
    runtime
        .block_on(persistence.register_session(crate::acp::SessionRegistration {
            session_id: "sess-real".into(),
            stable_agent_namespace: Some("config:test".into()),
            runtime_agent_id: Some("agent-1".into()),
            project_id: Some("proj-1".into()),
            cwd: cwd.clone(),
            ..Default::default()
        }))
        .unwrap();
    let sink = std::sync::Arc::new(SavedSink::default());
    let server = HostPlanServer::start(vec![sink.clone()], Some(persistence));

    let saved = garment(&server, "Royal Robe", b"png");
    assert_eq!(saved["save"]["saved"], true, "{saved}");

    let events = sink.events.lock().unwrap();
    assert_eq!(events.len(), 1, "one save, one announcement");
    let event = &events[0];
    assert_eq!(event["slug"], "royal-robe");
    assert_eq!(event["version"], 1);
    assert_eq!(event["kind"], "shirt");
    assert_eq!(event["sessionId"], "sess-real");
    assert!(
        event["itemPath"].as_str().unwrap().ends_with("item.json"),
        "{event}"
    );
}