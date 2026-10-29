//! `save_artifact`: write a finished artifact the user asked for from a feature
//! page.
//!
//! Every other write of a generated artifact happens inside
//! `answer_generator_call`, which needs an agent's tool call parked and waiting.
//! That makes a feature page unable to produce anything on its own: the user has
//! to leave for a chat and type there. This command is the seam that removes that
//! detour, and it deliberately reuses `save_artifact_result`, so the record on
//! disk is written by the same code, under the same lock, as an agent's write.
//!
//! It is desktop-only. On the web client the renderer has no binary write path
//! and the host owns the project folders, so the page composer there keeps
//! sending the prompt to the agent instead.

use serde_json::Value;
use std::sync::Arc;
use tauri::State;

use super::{validate_project_path, IpcResult};
use crate::acp::host_mcp::parent::{save_artifact_result, SavedArtifact};
use crate::web::ProjectRegistry;

/// Write one finished artifact into a registered project.
///
/// `project_path` is validated the way every project command validates it, and
/// must name a registered project, so a page cannot write into an arbitrary
/// folder it happens to know the path of. The result is the shape the renderer
/// already reports for a finished poll: `atlas` plus optional `image`, `kind`,
/// `name`, `prompt`, `design`, `report`.
///
/// The write itself goes through `write_project_file`, which canonicalises and
/// refuses a symlink escape, so a slug the model chose cannot leave the project.
#[tauri::command]
pub async fn save_artifact(
    project_path: String,
    result: Value,
    registry: State<'_, Arc<ProjectRegistry>>,
) -> Result<IpcResult<SavedArtifact>, String> {
    let root = match validate_project_path(&project_path) {
        Ok(root) => root,
        Err(error) => return Ok(IpcResult::error(error, "PATH_VALIDATION_FAILED")),
    };

    // `validate_project_path` strips the `\\?\` verbatim prefix so external tools
    // accept the path, but the registry stores the path the picker produced,
    // which still carries it. Comparing the two as-is rejected every project, so
    // a page generation finished and then silently failed to save. Compare both
    // forms.
    let plain = root.to_string_lossy().to_string();
    let verbatim = format!(r"\\?\{plain}");
    let registered = registry.find_by_path(&plain).or_else(|| registry.find_by_path(&verbatim));
    if registered.is_none() {
        return Ok(IpcResult::error(
            "this folder is not a registered project",
            "PROJECT_NOT_REGISTERED",
        ));
    }

    let written = tokio::task::spawn_blocking(move || save_artifact_result(&root, &result))
        .await
        .map_err(|error| format!("the write stopped: {error}"))?;

    Ok(match written {
        Ok(saved) => IpcResult::success(saved),
        Err(reason) => IpcResult::error(reason, "ARTIFACT_WRITE_FAILED"),
    })
}
