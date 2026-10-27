//! The generative engines' agent surface in the host `termul` MCP child.
//!
//! Same shape as [`super::canvas_tools`]: the tools are described here, and
//! every call is forwarded to the parent over the loopback frame channel,
//! because the engines themselves run in the renderer (they need a canvas and
//! the model transport, neither of which exists in the child).
//!
//! The split of responsibility mirrors RobloxKit's: the **agent** authors a
//! spec, the **engine** turns it into an artifact, and a review loop shows the
//! render back to the model until it accepts. The loop lives in
//! `src/renderer/lib/generator`; this module only carries calls to it.
//!
//! Reference: `re/full-reverse/01-generator-loop/REPORT.md` §16.5 (the result
//! envelope) and §3.7 of `10-tool-surface/REPORT.md` (why a generation returns
//! a task id instead of blocking).

use rmcp::model::Tool;
use serde_json::{json, Value};

/// Prefixed to every generator tool's description. Some MCP clients never show
/// the server `instructions` to the model, so a tool that renders an artifact
/// has to say so itself, or an agent reads "generate_clothing" as a file
/// operation and writes a `.lua` instead.
pub const DESCRIPTION_TAG: &str = "Termul generator (renders a real Roblox asset in the project; \
it does not write source files): ";

/// The generator section of the session `instructions`.
///
/// Names the tools, says what triggers them, and forbids the wrong behaviour —
/// the same four moves `CANVAS_GUIDE` makes, for the same reason. The negative
/// case is load-bearing: the observed failure mode for a Roblox project is an
/// agent writing `Meja.lua` to disk instead of producing the artifact.
const GENERATOR_GUIDE: &str = "Asset generators: this project can generate Roblox assets — \
clothing, 3D models, sound effects, textures, skyboxes, icons, VFX, GFX renders, animations and \
cutscenes — with this server's generator tools: generate_clothing, get_clothing_task, \
generate_3d, get_3d_task, generate_sfx, get_sfx_task, generate_texture, get_texture_task, \
generate_skybox, get_skybox_task, generate_icon, get_icon_task, generate_vfx, get_vfx_task, \
generate_gfx, get_gfx_task, generate_animation, get_animation_task, generate_cutscene, \
get_cutscene_task. When the user asks for a garment, a model, a sound, a texture, a sky, an icon, \
an effect, a render, an animation or a cutscene, call the matching generate_* tool. Each one \
returns a task id immediately because a generation takes minutes: poll the matching get_*_task \
tool with that id rather than calling generate_* again, which would start a second, different \
artifact. Do not write .lua files, .obj files or image files to disk to stand in for an asset, \
and do not hand-author a Roblox instance in place of a generator: these tools produce the \
artifact and hand it back. A generator that rejects a spec returns the problems it found; pass \
them back to the user rather than silently retrying with a different idea. Publishing a \
generated garment is the user's step, not yours: Roblox does not let an app publish classic \
clothing, so a clothing image has to be uploaded by hand at \
https://create.roblox.com/dashboard/creations?activeTab=Shirt (Pants and TShirt for the other \
two types). Do not stand up a local HTTP server, do not look for an asset-upload tool here, and \
do not guess at ShirtTemplate: tell the user to upload the picture they were shown, then carry \
on with whatever they ask next.";

/// The generator part of the session `instructions`.
#[must_use]
pub fn instructions() -> String {
    GENERATOR_GUIDE.to_string()
}

/// One `generate_*` / `get_*_task` pair, so the tool list and the dispatch
/// table cannot drift apart.
struct Family {
    /// Engine id as the renderer's `designLoop` names it (`clothing`, `3d`, …).
    engine: &'static str,
    /// What the artifact is, in the user's words, for the description.
    noun: &'static str,
    /// Whether the engine accepts a free-text prompt (all but `music` do).
    accepts_prompt: bool,
}

const FAMILIES: &[Family] = &[
    Family { engine: "clothing", noun: "garment (shirt, pants or t-shirt) as a Roblox clothing PNG", accepts_prompt: true },
    Family { engine: "3d", noun: "3D model as Roblox geometry", accepts_prompt: true },
    Family { engine: "sfx", noun: "sound effect as a Roblox audio asset", accepts_prompt: true },
    Family { engine: "texture", noun: "seamless texture set (colour, normal, roughness, metal)", accepts_prompt: true },
    Family { engine: "skybox", noun: "six-face skybox", accepts_prompt: true },
    Family { engine: "icon", noun: "UI icon as SVG and raster sizes", accepts_prompt: true },
    Family { engine: "vfx", noun: "particle effect sprite sheet", accepts_prompt: true },
    Family { engine: "gfx", noun: "rendered scene image", accepts_prompt: true },
    Family { engine: "animation", noun: "R15/R6 animation as a KeyframeSequence", accepts_prompt: true },
    Family { engine: "cutscene", noun: "cutscene timeline as Luau", accepts_prompt: true },
];

/// The garment types the clothing engine validates against. Must match
/// `DESIGN_TYPES` in the renderer's `engines/clothing/schema.ts`: the tool
/// requires a value from this list, so a mismatch makes the tool uncallable.
const CLOTHING_TYPES: &[&str] = &["shirt", "pants", "tshirt"];

/// The enum a family needs at the top level, if any.
///
/// The renderer's validator reads the garment type from the tool call, not
/// from the spec, so it has to be an argument the agent can actually set.
fn kind_field(family: &Family) -> Option<(&'static str, &'static [&'static str])> {
    match family.engine {
        "clothing" => Some(("type", CLOTHING_TYPES)),
        _ => None,
    }
}

/// A sentence naming the required argument, so a description-only client
/// still learns it exists.
fn kind_hint(family: &Family) -> String {
    match kind_field(family) {
        Some((field, values)) => {
            format!(" Required argument `{field}`: one of {}.", values.join(", "))
        }
        None => String::new(),
    }
}

/// `generate_<engine>` for one family.
fn generate_tool(family: &Family) -> Tool {
    let mut properties = serde_json::Map::new();
    let mut required: Vec<&str> = Vec::new();
    if let Some((field, values)) = kind_field(family) {
        properties.insert(
            field.to_string(),
            json!({
                "type": "string",
                "enum": values,
                "description": format!("Which {} to make. Required.", family.engine)
            }),
        );
        required.push(field);
    }
    if family.accepts_prompt {
        properties.insert(
            "prompt".to_string(),
            json!({
                "type": "string",
                "description": "What the user asked for, in their words. Leave it out when passing a complete `spec`."
            }),
        );
    }
    properties.insert(
        "spec".to_string(),
        json!({
            "type": "object",
            "description": "Optional: a complete spec instead of a prompt, which skips the authoring stage and goes straight to build and review."
        }),
    );

    let description = format!(
        "Generate a {}. Returns a task id at once; the artifact takes minutes, so poll \
         `get_{}_task` with that id instead of calling this again. An invalid spec comes back \
         as a list of problems to fix, not as a crash.{}",
        family.noun,
        family.engine,
        kind_hint(family)
    );

    Tool::new(
        format!("generate_{}", family.engine),
        format!("{DESCRIPTION_TAG}{description}"),
        json!({
            "type": "object",
            "properties": Value::Object(properties),
            "required": required,
        })
        .as_object()
        .cloned()
        .unwrap_or_default(),
    )
}

/// `get_<engine>_task` for one family.
///
/// The wording matches what the model actually receives. `child.rs` lifts
/// `image` out of the JSON and into an MCP image content block, so describing it
/// as a base64 field inside the JSON is wrong and sent a model looking on disk
/// for a file that was never written.
fn task_tool(family: &Family) -> Tool {
    Tool::new(
        format!("get_{}_task", family.engine),
        format!(
            "{DESCRIPTION_TAG}Read a {} generation started by `generate_{}`. Status is one of \
             queued, running, done, failed or cancelled. When it is done the rendered picture \
             arrives as an image content block beside this reply, so look at it; the JSON \
             alongside carries `design` (the spec the engine accepted), `report` (what the \
             checks found, including any region left bare) and `layout` (the render in words, \
             for when you cannot see pictures). While it is still running the reply carries the \
             stage the engine is on; poll again rather than starting a second generation.",
            family.noun, family.engine
        ),
        json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The id `generate_*` returned."
                }
            },
            "required": ["task_id"],
        })
        .as_object()
        .cloned()
        .unwrap_or_default(),
    )
}

/// Every generator tool, ready for the child's router.
#[must_use]
pub fn tools() -> Vec<Tool> {
    FAMILIES
        .iter()
        .flat_map(|family| [generate_tool(family), task_tool(family)])
        .collect()
}

/// The engine id a tool name belongs to, and whether it starts or reads a
/// generation. `None` for a name this module does not own, so the caller can
/// keep looking.
#[must_use]
pub fn parse_tool(name: &str) -> Option<(&'static str, Call)> {
    let (rest, call) = match name.strip_prefix("generate_") {
        Some(engine) => (engine, Call::Generate),
        None => (name.strip_prefix("get_")?.strip_suffix("_task")?, Call::Read),
    };
    FAMILIES
        .iter()
        .find(|family| family.engine == rest)
        .map(|family| (family.engine, call))
}

/// Which half of the pair a tool name is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Call {
    /// Start a generation; the reply is a task id.
    Generate,
    /// Read a generation; the reply is its status and artifact.
    Read,
}

#[cfg(test)]
mod tests;
