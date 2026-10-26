use super::*;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("termul-roblox-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn override_wins_when_it_exists() {
    let dir = temp_dir("override");
    let exe = dir.join("StudioMCP.exe");
    std::fs::write(&exe, b"stub").expect("write stub");

    let found = find_studio_mcp_in(Some(exe.clone()), None);

    assert_eq!(found, Some(exe));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn override_that_does_not_exist_falls_back_to_the_scan() {
    let root = temp_dir("fallback");
    let version_dir = root.join("Roblox").join("Versions").join("version-abc");
    std::fs::create_dir_all(&version_dir).expect("mkdir version");
    let exe = version_dir.join("StudioMCP.exe");
    std::fs::write(&exe, b"stub").expect("write stub");

    let found = find_studio_mcp_in(Some(root.join("missing.exe")), Some(root.clone()));

    assert_eq!(found, Some(exe));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn no_local_app_data_is_none() {
    assert_eq!(find_studio_mcp_in(None, None), None);
}

#[test]
fn version_dir_without_the_exe_is_none() {
    let root = temp_dir("empty");
    std::fs::create_dir_all(root.join("Roblox").join("Versions").join("version-abc"))
        .expect("mkdir version");

    assert_eq!(find_studio_mcp_in(None, Some(root.clone())), None);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn empty_override_is_ignored() {
    let root = temp_dir("empty-override");
    let version_dir = root.join("Roblox").join("Versions").join("version-abc");
    std::fs::create_dir_all(&version_dir).expect("mkdir version");
    let exe = version_dir.join("StudioMCP.exe");
    std::fs::write(&exe, b"stub").expect("write stub");

    let found = find_studio_mcp_in(Some(PathBuf::new()), Some(root.clone()));

    assert_eq!(found, Some(exe));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn workspace_prefers_documents_then_local_app_data() {
    let home = PathBuf::from("C:/Users/someone");
    let local = PathBuf::from("C:/Users/someone/AppData/Local");

    let candidates = workspace_candidates_in(Some(home), Some(local));

    assert_eq!(
        candidates,
        vec![
            PathBuf::from("C:/Users/someone/Documents/RobloxKit"),
            PathBuf::from("C:/Users/someone/AppData/Local/RobloxKit"),
        ]
    );
}

#[test]
fn workspace_without_home_uses_local_app_data_only() {
    let candidates =
        workspace_candidates_in(None, Some(PathBuf::from("C:/Users/someone/AppData/Local")));

    assert_eq!(
        candidates,
        vec![PathBuf::from("C:/Users/someone/AppData/Local/RobloxKit")]
    );
}

#[test]
fn workspace_with_no_roots_has_no_candidates() {
    assert!(workspace_candidates_in(None, None).is_empty());
    assert!(workspace_candidates_in(Some(PathBuf::new()), Some(PathBuf::new())).is_empty());
}

#[test]
fn workspace_is_created_under_documents() {
    let home = temp_dir("home");
    let local = temp_dir("local");

    let resolved = resolve_workspace_in(Some(home.clone()), Some(local.clone()));

    assert_eq!(resolved, Some(home.join("Documents").join(WORKSPACE_DIR_NAME)));
    assert!(home.join("Documents").join(WORKSPACE_DIR_NAME).is_dir());
    let _ = std::fs::remove_dir_all(&home);
    let _ = std::fs::remove_dir_all(&local);
}

#[test]
fn workspace_falls_back_to_local_app_data_when_documents_is_blocked() {
    let home = temp_dir("blocked-home");
    let local = temp_dir("blocked-local");
    std::fs::write(home.join("Documents"), b"not a directory").expect("block Documents");

    let resolved = resolve_workspace_in(Some(home.clone()), Some(local.clone()));

    assert_eq!(resolved, Some(local.join(WORKSPACE_DIR_NAME)));
    assert!(local.join(WORKSPACE_DIR_NAME).is_dir());
    let _ = std::fs::remove_dir_all(&home);
    let _ = std::fs::remove_dir_all(&local);
}

#[test]
fn workspace_icon_is_written_once() {
    let dir = temp_dir("icon");

    write_workspace_icon(&dir);
    let written = std::fs::read_to_string(dir.join("icon.svg")).expect("icon written");
    assert!(written.contains("41.2648,12.6719"));

    std::fs::write(dir.join("icon.svg"), "user icon").expect("overwrite");
    write_workspace_icon(&dir);
    assert_eq!(
        std::fs::read_to_string(dir.join("icon.svg")).expect("read"),
        "user icon"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

mod process {
    use crate::roblox::process::{exe_name_matches, STUDIO_PROCESS_NAME};

    #[test]
    fn matches_the_exact_image_name() {
        assert!(exe_name_matches("RobloxStudioBeta"));
    }

    #[test]
    fn matches_with_the_exe_suffix() {
        assert!(exe_name_matches("RobloxStudioBeta.exe"));
    }

    #[test]
    fn matches_case_insensitively_because_windows_image_names_are() {
        assert!(exe_name_matches("robloxstudiobeta"));
        assert!(exe_name_matches("ROBLOXSTUDIOBETA.EXE"));
        assert!(exe_name_matches("RobloxStudioBeta.EXE"));
    }

    #[test]
    fn does_not_match_another_roblox_process() {
        assert!(!exe_name_matches("RobloxPlayerBeta.exe"));
        assert!(!exe_name_matches("StudioMCP.exe"));
    }

    #[test]
    fn does_not_match_a_prefix_or_suffix_variant() {
        assert!(!exe_name_matches("RobloxStudioBeta2.exe"));
        assert!(!exe_name_matches("MyRobloxStudioBeta.exe"));
        assert!(!exe_name_matches(""));
    }

    #[test]
    fn the_constant_carries_no_suffix_so_matching_adds_it() {
        assert!(!STUDIO_PROCESS_NAME.ends_with(".exe"));
    }
}

mod session {
    use serde_json::json;

    use crate::roblox::session::{entries_from_document, parse_studios};

    #[test]
    fn reads_the_measured_payload_shape() {
        let result = json!({
            "content": [{
                "type": "text",
                "text": "{\"studios\":[{\"id\":\"2f697dcc\",\"name\":\"Untitled Experience (placeId: 93291914711483)\"}]}"
            }],
            "isError": false
        });

        let studios = parse_studios(Some(&result)).expect("parsed");

        assert_eq!(studios.len(), 1);
        assert_eq!(studios[0].id, "2f697dcc");
        assert_eq!(
            studios[0].name.as_deref(),
            Some("Untitled Experience (placeId: 93291914711483)")
        );
    }

    #[test]
    fn a_studio_with_a_null_name_still_counts_as_reachable() {
        // Measured live: Studio reports `"name": null` while no place is loaded.
        // Dropping the entry made a running Studio look absent.
        let result = json!({
            "content": [{
                "type": "text",
                "text": "{\"studios\":[{\"id\":\"bee7f8ce-7366-499d-9591-8ce154cffae2\",\"name\":null}]}"
            }],
            "isError": false
        });

        let studios = parse_studios(Some(&result)).expect("parsed");

        assert_eq!(studios.len(), 1);
        assert_eq!(studios[0].id, "bee7f8ce-7366-499d-9591-8ce154cffae2");
        assert_eq!(studios[0].name, None);
    }

    #[test]
    fn a_studio_with_no_name_key_still_counts_as_reachable() {
        let result = json!({
            "content": [{ "type": "text", "text": "{\"studios\":[{\"id\":\"abc\"}]}" }],
            "isError": false
        });

        let studios = parse_studios(Some(&result)).expect("parsed");

        assert_eq!(studios.len(), 1);
        assert_eq!(studios[0].name, None);
    }

    #[test]
    fn a_blank_name_reads_as_no_place_instead_of_an_empty_label() {
        let result = json!({
            "content": [{ "type": "text", "text": "{\"studios\":[{\"id\":\"abc\",\"name\":\"   \"}]}" }],
            "isError": false
        });

        let studios = parse_studios(Some(&result)).expect("parsed");

        assert_eq!(studios[0].name, None);
    }

    #[test]
    fn an_entry_without_an_id_is_still_skipped() {
        let document = json!({ "studios": [{ "name": "Place" }] });

        assert!(entries_from_document(&document).is_empty());
    }

    #[test]
    fn an_empty_studio_list_is_not_an_error() {
        let result = json!({
            "content": [{ "type": "text", "text": "{\"studios\":[]}" }],
            "isError": false
        });

        assert!(parse_studios(Some(&result)).expect("parsed").is_empty());
    }

    #[test]
    fn a_missing_result_is_no_studio() {
        assert!(parse_studios(None).expect("parsed").is_empty());
    }

    #[test]
    fn an_error_result_is_reported() {
        let result = json!({ "content": [], "isError": true });

        assert!(parse_studios(Some(&result)).is_err());
    }

    #[test]
    fn a_non_json_text_block_is_no_studio_instead_of_a_panic() {
        let result = json!({
            "content": [{ "type": "text", "text": "studio is not open" }],
            "isError": false
        });

        assert!(parse_studios(Some(&result)).expect("parsed").is_empty());
    }

    #[test]
    fn content_that_is_not_an_array_is_no_studio() {
        let result = json!({ "content": "nonsense", "isError": false });

        assert!(parse_studios(Some(&result)).expect("parsed").is_empty());
    }

    #[test]
    fn a_payload_without_a_studios_key_is_no_studio() {
        let result = json!({
            "content": [{ "type": "text", "text": "{\"somethingElse\":true}" }],
            "isError": false
        });

        assert!(parse_studios(Some(&result)).expect("parsed").is_empty());
    }

    #[test]
    fn only_entries_with_an_id_are_kept() {
        let document = json!({
            "studios": [
                { "id": "a", "name": "Place A" },
                { "id": "b" },
                { "name": "Place C" },
            ]
        });

        let studios = entries_from_document(&document);

        assert_eq!(studios.len(), 2);
        assert_eq!(studios[0].name.as_deref(), Some("Place A"));
        assert_eq!(studios[1].id, "b");
        assert_eq!(studios[1].name, None);
    }

    #[test]
    fn only_the_first_text_block_that_parses_is_read() {
        let result = json!({
            "content": [
                { "type": "image", "data": "..." },
                { "type": "text", "text": "not json" },
                { "type": "text", "text": "{\"studios\":[{\"id\":\"a\",\"name\":\"Place\"}]}" }
            ],
            "isError": false
        });

        let studios = parse_studios(Some(&result)).expect("parsed");

        assert_eq!(studios.len(), 1);
        assert_eq!(studios[0].id, "a");
    }
}

mod live_status {
    use crate::roblox::live_status::{resolve_status, RobloxStudioLiveStatus};
    use crate::roblox::session::{StudioEntry, StudioSnapshot};

    fn snapshot(names: &[&str]) -> StudioSnapshot {
        StudioSnapshot {
            studios: names
                .iter()
                .enumerate()
                .map(|(index, name)| StudioEntry {
                    id: format!("studio-{index}"),
                    name: Some((*name).to_string()),
                })
                .collect(),
        }
    }

    fn nameless_snapshot() -> StudioSnapshot {
        StudioSnapshot {
            studios: vec![StudioEntry {
                id: "studio-0".to_string(),
                name: None,
            }],
        }
    }

    #[test]
    fn an_uninstalled_machine_never_probes() {
        let status = tauri::async_runtime::block_on(resolve_status(
            false,
            true,
            async { panic!("must not probe when Studio is not installed") },
            || panic!("must not recheck when Studio is not installed"),
        ));

        assert_eq!(status, RobloxStudioLiveStatus::not_installed());
    }

    #[test]
    fn a_stopped_studio_never_probes() {
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            false,
            async { panic!("must not probe when Studio is not running") },
            || panic!("must not recheck when Studio was never running"),
        ));

        assert_eq!(status, RobloxStudioLiveStatus::idle());
    }

    #[test]
    fn a_connected_studio_carries_the_place_name() {
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            true,
            async { Ok(snapshot(&["Untitled Experience (placeId: 1)"])) },
            || true,
        ));

        assert!(status.connected);
        assert_eq!(
            status.place_name.as_deref(),
            Some("Untitled Experience (placeId: 1)")
        );
    }

    #[test]
    fn the_first_studio_supplies_the_place_name() {
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            true,
            async { Ok(snapshot(&["First Place", "Second Place"])) },
            || true,
        ));

        assert_eq!(status.place_name.as_deref(), Some("First Place"));
    }

    #[test]
    fn no_reachable_studio_reads_as_running_but_not_connected() {
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            true,
            async { Ok(snapshot(&[])) },
            || true,
        ));

        assert_eq!(status, RobloxStudioLiveStatus::running_only());
        assert!(!status.connected);
        assert_eq!(status.place_name, None);
    }

    #[test]
    fn a_reachable_studio_with_no_place_reads_as_connected() {
        // The lamp must be green as soon as Studio answers, even before a place
        // is loaded: reachability is the connection, the name is extra.
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            true,
            async { Ok(nameless_snapshot()) },
            || true,
        ));

        assert!(status.connected);
        assert!(status.running);
        assert_eq!(status.place_name, None);
    }

    #[test]
    fn studio_closing_between_the_check_and_the_probe_reads_as_closed() {
        // The editor was alive when the tick started, but the proxy already
        // answers with no studio: Studio is gone, not "open with no place".
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            true,
            async { Ok(snapshot(&[])) },
            || false,
        ));

        assert_eq!(status, RobloxStudioLiveStatus::idle());
        assert!(!status.running);
    }

    #[test]
    fn a_probe_failure_reads_as_running_but_not_connected() {
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            true,
            async { Err("child died mid-call".to_string()) },
            || true,
        ));

        assert_eq!(status, RobloxStudioLiveStatus::running_only());
    }

    #[test]
    fn a_probe_failure_while_studio_exits_reads_as_closed() {
        let status = tauri::async_runtime::block_on(resolve_status(
            true,
            true,
            async { Err("child died mid-call".to_string()) },
            || false,
        ));

        assert_eq!(status, RobloxStudioLiveStatus::idle());
    }

    #[test]
    fn the_wire_shape_is_camel_case() {
        let status = RobloxStudioLiveStatus::connected(&snapshot(&["Place"]));
        let json = serde_json::to_value(&status).expect("serialized");

        assert_eq!(json["installed"], serde_json::json!(true));
        assert_eq!(json["running"], serde_json::json!(true));
        assert_eq!(json["connected"], serde_json::json!(true));
        assert_eq!(json["placeName"], serde_json::json!("Place"));
        assert!(json.get("place_name").is_none());
    }

    #[test]
    fn a_missing_place_name_serializes_as_null_not_absent() {
        let json = serde_json::to_value(RobloxStudioLiveStatus::idle()).expect("serialized");

        assert_eq!(json["placeName"], serde_json::Value::Null);
    }
}

mod session_protocol {
    use std::time::Duration;

    use serde_json::{json, Value};
    use tokio::io::{AsyncWriteExt, BufReader, DuplexStream};

    use crate::roblox::session::Client;

    fn client_and_child_streams() -> (DuplexStream, DuplexStream) {
        tokio::io::duplex(8 * 1024)
    }

    /// Wraps a mock child's end so a test names only the reply logic.
    fn client_over(reply: fn(Value) -> Option<Value>, timeout: Duration) -> Client {
        let (client_end, child_end) = client_and_child_streams();
        tokio::spawn(mock_child(child_end, reply));
        let (reader, writer) = tokio::io::split(client_end);
        Client::new(Box::new(writer), BufReader::new(reader)).with_request_timeout(timeout)
    }

    /// A mock MCP child: reads one request frame, then answers with whatever
    /// `reply` returns. No real `StudioMCP.exe` is ever spawned.
    async fn mock_child(mut peer: DuplexStream, reply: fn(Value) -> Option<Value>) {
        let mut buffer = Vec::new();
        loop {
            match read_frame(&mut peer, &mut buffer).await {
                Some(line) => {
                    let Ok(request) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    let Some(answer) = reply(request) else {
                        continue;
                    };
                    if write_frame(&mut peer, &answer).await.is_err() {
                        return;
                    }
                }
                None => return,
            }
        }
    }

    async fn read_frame(peer: &mut DuplexStream, buffer: &mut Vec<u8>) -> Option<String> {
        loop {
            if let Some(newline) = buffer.iter().position(|&b| b == b'\n') {
                let line = buffer.drain(..=newline).collect::<Vec<u8>>();
                return Some(String::from_utf8_lossy(&line).trim().to_string());
            }
            let mut chunk = [0u8; 1024];
            let read = tokio::io::AsyncReadExt::read(peer, &mut chunk).await.ok()?;
            if read == 0 {
                return None;
            }
            buffer.extend_from_slice(&chunk[..read]);
        }
    }

    async fn write_frame(peer: &mut DuplexStream, frame: &Value) -> std::io::Result<()> {
        let mut line = serde_json::to_vec(frame).map_err(std::io::Error::other)?;
        line.push(b'\n');
        peer.write_all(&line).await?;
        peer.flush().await
    }

    fn studio_reply(request: Value) -> Option<Value> {
        let id = request.get("id")?.clone();
        match request.get("method").and_then(Value::as_str)? {
            "initialize" => Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": { "tools": { "listChanged": true } },
                    "serverInfo": { "name": "RobloxStudio", "version": "1.0.0" }
                }
            })),
            "tools/call" => Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{
                        "type": "text",
                        "text": "{\"studios\":[{\"id\":\"2f697dcc\",\"name\":\"Untitled Experience (placeId: 93291914711483)\"}]}"
                    }],
                    "isError": false
                }
            })),
            _ => None,
        }
    }

    fn silent_child(request: Value) -> Option<Value> {
        let _ = request;
        None
    }

    const FAST: Duration = Duration::from_millis(100);

    #[tokio::test]
    async fn initialize_then_list_studios_against_a_mock_child() {
        let mut client = client_over(studio_reply, FAST);

        client.initialize().await.expect("initialize");
        assert!(client.is_initialized());
        let studios = client.list_studios().await.expect("list_studios");

        assert_eq!(studios.len(), 1);
        assert_eq!(studios[0].id, "2f697dcc");
        assert_eq!(
            studios[0].name.as_deref(),
            Some("Untitled Experience (placeId: 93291914711483)")
        );
    }

    #[tokio::test]
    async fn a_child_that_never_answers_times_out_instead_of_hanging() {
        let mut client = client_over(silent_child, Duration::from_millis(50));

        let error = client.initialize().await.expect_err("must time out");

        assert!(error.contains("timed out"), "unexpected error: {error}");
        assert!(!client.is_initialized());
    }

    #[tokio::test]
    async fn a_child_that_dies_mid_call_reports_an_error_instead_of_panicking() {
        let (client_end, child_end) = client_and_child_streams();
        let (reader, writer) = tokio::io::split(client_end);
        let mut client = Client::new(Box::new(writer), BufReader::new(reader))
            .with_request_timeout(Duration::from_millis(300));
        drop(child_end);

        let error = client.initialize().await.expect_err("must fail");

        // Either half can notice first: the write hits a broken pipe, or the
        // read loop ends and drops the waiter. Both must be an error, not a panic.
        assert!(
            error.contains("closed")
                || error.contains("timed out")
                || error.contains("could not write"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn an_initialize_error_reply_fails_the_handshake() {
        let mut client = client_over(
            |request| {
                let id = request.get("id")?.clone();
                Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "method not found" }
                }))
            },
            FAST,
        );

        let error = client.initialize().await.expect_err("must fail");

        assert!(error.contains("rejected"), "unexpected error: {error}");
        assert!(!client.is_initialized());
    }

    #[tokio::test]
    async fn a_tools_call_error_reply_is_reported() {
        let mut client = client_over(
            |request| {
                let id = request.get("id")?.clone();
                match request.get("method").and_then(Value::as_str)? {
                    "initialize" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
                    _ => Some(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32603, "message": "studio not open" }
                    })),
                }
            },
            FAST,
        );

        client.initialize().await.expect("initialize");
        let error = client.list_studios().await.expect_err("must fail");

        assert!(error.contains("list_roblox_studios"), "unexpected: {error}");
    }

    #[tokio::test]
    async fn a_notification_between_replies_does_not_steal_the_answer() {
        let (client_end, mut child_end) = client_and_child_streams();
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            while let Some(line) = read_frame(&mut child_end, &mut buffer).await {
                let Ok(request) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let Some(id) = request.get("id").cloned() else {
                    continue;
                };
                let noise = json!({ "jsonrpc": "2.0", "method": "notifications/progress" });
                if write_frame(&mut child_end, &noise).await.is_err() {
                    return;
                }
                let answer = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": "{\"studios\":[]}" }],
                        "isError": false
                    }
                });
                if write_frame(&mut child_end, &answer).await.is_err() {
                    return;
                }
            }
        });
        let (reader, writer) = tokio::io::split(client_end);
        let mut client = Client::new(Box::new(writer), BufReader::new(reader))
            .with_request_timeout(Duration::from_millis(500));

        client.initialize().await.expect("initialize");
        let studios = client.list_studios().await.expect("list_studios");

        assert!(studios.is_empty());
    }

    #[tokio::test]
    async fn a_non_json_frame_does_not_stop_the_read_loop() {
        let (client_end, mut child_end) = client_and_child_streams();
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            while let Some(_line) = read_frame(&mut child_end, &mut buffer).await {
                if child_end.write_all(b"this is not json\n").await.is_err() {
                    return;
                }
                let answer = json!({ "jsonrpc": "2.0", "id": 1, "result": {} });
                if write_frame(&mut child_end, &answer).await.is_err() {
                    return;
                }
            }
        });
        let (reader, writer) = tokio::io::split(client_end);
        let mut client = Client::new(Box::new(writer), BufReader::new(reader))
            .with_request_timeout(Duration::from_millis(500));

        client.initialize().await.expect("initialize");

        assert!(client.is_initialized());
    }
}
