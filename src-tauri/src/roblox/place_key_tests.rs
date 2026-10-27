//! The place key: how a published and an unpublished place become addressable.

use serde_json::json;

use crate::roblox::place_key::{parse_probe, PlaceProbe};

fn reply_with(text: &str) -> serde_json::Value {
    json!({ "result": { "content": [{ "type": "text", "text": text }] } })
}

#[test]
fn published_place_keys_on_its_place_id() {
    let probe = PlaceProbe {
        place_id: 1234,
        game_id: 99,
        name: "My Obby".to_string(),
        guid: None,
        created: false,
    };

    assert_eq!(probe.place_key().as_deref(), Some("place-1234"));
}

#[test]
fn unpublished_place_keys_on_its_guid() {
    let probe = PlaceProbe {
        place_id: 0,
        game_id: 0,
        name: "Untitled".to_string(),
        guid: Some("7F3A2C91-0000-4A1B-8C2D-1234567890AB".to_string()),
        created: true,
    };

    assert_eq!(
        probe.place_key().as_deref(),
        Some("unpub-7f3a2c91-0000-4a1b-8c2d-1234567890ab")
    );
}

#[test]
fn unpublished_place_without_a_guid_is_not_addressable() {
    let probe = PlaceProbe {
        place_id: 0,
        game_id: 0,
        name: "Untitled".to_string(),
        guid: None,
        created: false,
    };

    assert_eq!(probe.place_key(), None);
}

#[test]
fn a_guid_of_the_wrong_shape_is_rejected() {
    let probe = PlaceProbe {
        place_id: 0,
        game_id: 0,
        name: "Untitled".to_string(),
        guid: Some("not-a-guid".to_string()),
        created: false,
    };

    assert_eq!(probe.place_key(), None);
}

#[test]
fn a_published_place_ignores_a_stray_guid() {
    let probe = PlaceProbe {
        place_id: 42,
        game_id: 7,
        name: "Published".to_string(),
        guid: Some("7f3a2c91-0000-4a1b-8c2d-1234567890ab".to_string()),
        created: false,
    };

    assert_eq!(probe.place_key().as_deref(), Some("place-42"));
}

#[test]
fn parses_the_json_inside_the_mcp_content_block() {
    let reply = reply_with(
        r#"{"placeId":1234,"gameId":99,"name":"My Obby","guid":null,"created":false}"#,
    );

    let probe = parse_probe(reply.get("result")).expect("probe");

    assert_eq!(probe.place_id, 1234);
    assert_eq!(probe.name, "My Obby");
    assert_eq!(probe.place_key().as_deref(), Some("place-1234"));
}

#[test]
fn treats_a_missing_created_flag_as_false() {
    let reply = reply_with(r#"{"placeId":0,"gameId":0,"name":"U","guid":null}"#);

    let probe = parse_probe(reply.get("result")).expect("probe");

    assert!(!probe.created);
}

#[test]
fn returns_none_for_a_reply_without_content() {
    assert_eq!(parse_probe(Some(&json!({ "content": [] }))), None);
    assert_eq!(parse_probe(None), None);
}

#[test]
fn returns_none_when_the_text_is_not_json() {
    let reply = reply_with("not json");
    assert_eq!(parse_probe(reply.get("result")), None);
}
