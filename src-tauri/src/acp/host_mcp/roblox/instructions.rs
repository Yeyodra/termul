//! The Roblox instruction block appended to a Roblox project's session context.
//!
//! Why this exists: Claude Code defers MCP tool schemas when their combined
//! descriptions are large, so the agent knew the Roblox tool names but could not
//! call them, and answered "buatkan gw objek meja" by writing `Meja.lua` to disk
//! instead of building the table in Studio. This text names the tools, forbids
//! the file fallback, and tells the agent to fetch a schema via `ToolSearch`
//! before giving up.
//!
//! [`STUDIO_MCP_TOOLS`] is frozen: it is the exact `tools/list` of the installed
//! `StudioMCP.exe` (`.omo/roblox-re/00-runtime-evidence.md` §E2). Renaming or
//! adding to it would describe tools the server does not have.

/// Every tool the installed `StudioMCP.exe` advertises, by bare name.
///
/// Bare names only — each agent prefixes them itself (`mcp__<server>__<tool>` in
/// Claude Code, `<server>_<tool>` in OpenCode), so naming a prefix here would be
/// wrong for half of them.
pub const STUDIO_MCP_TOOLS: [&str; 28] = [
    "upload_image",
    "search_game_tree",
    "script_search",
    "skill",
    "multi_edit",
    "start_stop_play",
    "get_console_output",
    "user_mouse_input",
    "store_image",
    "http_get",
    "character_navigation",
    "script_read",
    "get_studio_state",
    "screen_capture",
    "script_grep",
    "wait_job_finished",
    "generate_procedural_model",
    "generate_texture",
    "segment_mesh",
    "user_keyboard_input",
    "generate_mesh",
    "subagent",
    "execute_luau",
    "generate_material",
    "inspect_instance",
    "search_asset",
    "insert_asset",
    "list_roblox_studios",
];

/// The instruction block. `place_name` is user content (a private experience
/// title may be in it), so callers must not log the returned string.
#[must_use]
pub fn roblox_instructions(place_name: Option<&str>) -> String {
    let tools = STUDIO_MCP_TOOLS.join(", ");
    let target = match place_name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => format!("The open place is \"{name}\"."),
        None => "A place is open in Roblox Studio.".to_string(),
    };
    format!(
        "Roblox Studio: this project drives the live place through Roblox Studio's own MCP \
tools, so a change to the place is a tool call, never a file. {target} These tools are \
{tools}. Use them for anything the user asks for in the place — build and move instances \
with execute_luau, read the tree with search_game_tree, check state with get_studio_state, \
and screenshot with screen_capture to verify your own work. Do NOT write .lua files, \
Rojo projects, or any other file to disk to represent a place change: a file does nothing \
to the open place, and the user asked for the place to change. Pass studio_id only when \
more than one Studio is open; with a single Studio you may omit it and the call goes to \
that one. If a tool above is not in your current tool list, its schema is not loaded yet — \
call ToolSearch(\"select:<name>\") to load it, then call the tool. Never conclude a Roblox \
tool is unavailable without trying ToolSearch first."
    )
}

/// The open place's name, for the instruction block.
///
/// Resolves the exe per call (`find_studio_mcp`), because the version directory
/// changes on every Studio update. Every failure — not installed, proxy error,
/// no place loaded — is `None`: this runs on the session-creation path, so it
/// must never fail a session. The name is never logged (user content).
pub async fn resolve_place_name() -> Option<String> {
    let exe = crate::roblox::find_studio_mcp()?;
    match crate::roblox::session::probe(&exe).await {
        Ok(snapshot) => snapshot.place_name(),
        Err(error) => {
            log::debug!("[roblox] place-name probe failed: {error}");
            None
        }
    }
}
