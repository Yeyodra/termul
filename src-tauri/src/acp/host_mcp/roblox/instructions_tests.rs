//! Tests for the Roblox instruction block.

use super::instructions::{resolve_place_name, roblox_instructions, STUDIO_MCP_TOOLS};

/// Names that belong to the separate RobloxKit project (Open Cloud admin and
/// generative tools). They must never appear here: the agent would try to call
/// tools that no connected server provides.
const FORBIDDEN_TOOLS: [&str; 20] = [
    "generate_3d",
    "generate_skybox",
    "generate_icon",
    "generate_vfx",
    "generate_sfx",
    "generate_gfx",
    "generate_clothing",
    "generate_cutscene",
    "create_animation",
    "insert_music",
    "publish_place",
    "publish_message",
    "update_experience",
    "update_place",
    "restart_servers",
    "ban_user",
    "unban_user",
    "spawn_task",
    "ytdl_",
    "generate_terrain",
];

#[test]
fn names_every_studio_mcp_tool() {
    let text = roblox_instructions(None);
    for tool in STUDIO_MCP_TOOLS {
        assert!(text.contains(tool), "instruction block is missing tool `{tool}`");
    }
}

/// Guards against a vacuous list assertion: a plausible-but-fake name must be
/// absent, so `names_every_studio_mcp_tool` cannot pass on a text that happens to
/// contain every string it checks.
#[test]
fn rejects_a_tool_name_that_does_not_exist() {
    let text = roblox_instructions(None);
    assert!(
        !text.contains("read_script"),
        "`read_script` is not a StudioMCP tool (the real one is `script_read`)"
    );
}

#[test]
fn forbids_writing_lua_files() {
    let text = roblox_instructions(None);
    assert!(text.contains("Do NOT write .lua files"));
}

#[test]
fn explains_when_studio_id_may_be_omitted() {
    let text = roblox_instructions(None);
    assert!(text.contains("studio_id"));
    assert!(text.contains("more than one Studio is open"));
}

#[test]
fn mentions_the_tool_search_safety_net() {
    let text = roblox_instructions(None);
    assert!(text.contains("ToolSearch"));
    assert!(text.contains("select:<name>"));
}

#[test]
fn never_uses_an_agent_specific_tool_prefix() {
    let text = roblox_instructions(Some("My Place"));
    assert!(!text.contains("mcp__"), "tool names must be bare");
    assert!(!text.contains("roblox-studio_"), "tool names must be bare");
}

#[test]
fn never_names_a_robloxkit_only_tool() {
    let text = roblox_instructions(Some("My Place"));
    for tool in FORBIDDEN_TOOLS {
        assert!(!text.contains(tool), "`{tool}` is not a StudioMCP tool");
    }
}

#[test]
fn embeds_the_place_name_when_supplied() {
    let text = roblox_instructions(Some("My Place"));
    assert!(text.contains("My Place"));
    assert!(text.contains("\"My Place\""));
}

#[test]
fn leaves_no_dangling_placeholder_without_a_place_name() {
    let unknown = roblox_instructions(None);
    let known = roblox_instructions(Some("My Place"));

    assert!(!unknown.ends_with(": "), "block must not end with a colon placeholder");
    assert!(!unknown.contains("place: "), "no empty `place: ` label");
    assert!(!unknown.contains("\"\""), "no empty quoted name");
    assert!(!unknown.contains("(unknown)"), "no placeholder token");
    assert!(unknown.contains("A place is open in Roblox Studio."));

    // The only difference between the two variants is the sentence naming the
    // place, so the unknown variant must be shorter by exactly that difference.
    let place_sentence = format!("The open place is \"{}\".", "My Place");
    assert_eq!(
        known.replace(&place_sentence, "A place is open in Roblox Studio."),
        unknown,
        "unknown variant must be the known variant with the place sentence swapped"
    );
}

#[test]
fn treats_a_blank_place_name_as_unknown() {
    assert_eq!(roblox_instructions(Some("   ")), roblox_instructions(None));
    assert_eq!(roblox_instructions(Some("")), roblox_instructions(None));
}

#[test]
fn stays_short_enough_to_be_read() {
    // The tool-name list alone is ~460 chars; OpenCode succeeded with no
    // instructions at all, so the prose must stay a paragraph, not a tutorial.
    let text = roblox_instructions(Some("My Place"));
    assert!(text.len() < 1500, "instruction block grew to {} chars", text.len());
}

#[tokio::test]
#[ignore = "spawns the real StudioMCP.exe; needs Studio open, so it is not part of the default suite"]
async fn resolve_place_name_never_fails_without_studio() {
    // On a machine with no Studio this is `None`; on a machine with Studio it is
    // `Some` or `None`. Either way it must return, not panic or hang the caller.
    let _ = resolve_place_name().await;
}
