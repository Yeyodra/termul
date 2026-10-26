//! Is Roblox Studio running on this machine?
//!
//! The cheap tier of the status lamp: a process-name check that costs about a
//! millisecond, so it can run every 5 s while Studio is closed. It never talks
//! to `StudioMCP.exe`, so it answers even when the MCP child is not spawned.
//!
//! Studio's image name has been `RobloxStudioBeta` for years; it is a constant
//! here rather than a configuration knob.

/// Studio's process image name, without the `.exe` suffix.
pub const STUDIO_PROCESS_NAME: &str = "RobloxStudioBeta";

/// Whether `exe_name` names Studio. Windows image names are case-insensitive,
/// and the Toolhelp snapshot reports the name as recorded at spawn, so the
/// comparison folds case and tolerates a trailing `.exe`.
#[must_use]
pub fn exe_name_matches(exe_name: &str) -> bool {
    let stem = exe_name
        .strip_suffix(".exe")
        .or_else(|| exe_name.strip_suffix(".EXE"))
        .unwrap_or(exe_name);
    stem.eq_ignore_ascii_case(STUDIO_PROCESS_NAME)
}

/// Whether any process on this machine is Roblox Studio.
///
/// Returns `false` when the snapshot itself fails (no permission, unsupported
/// platform): the lamp then reads "not running", which is the same answer a
/// failed check would give and cannot be mistaken for "connected".
#[must_use]
pub fn studio_running() -> bool {
    studio_running_with(process_names)
}

/// Testable core of [`studio_running`]: `names` supplies the running image
/// names so a test never depends on what this machine happens to run.
fn studio_running_with(names: impl FnOnce() -> Vec<String>) -> bool {
    let running = names().iter().any(|name| exe_name_matches(name));
    log::debug!("[roblox] Studio process check: running={running}");
    running
}

/// Every running process image name, as the OS reports it.
#[cfg(windows)]
fn process_names() -> Vec<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    let mut out = Vec::new();
    // SAFETY: the snapshot handle is checked against INVALID_HANDLE_VALUE and
    // closed exactly once below; `entry` is a valid, zero-initialised struct
    // whose `dwSize` the API requires to be set before the first call.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            log::warn!(
                "[roblox] CreateToolhelp32Snapshot failed: {}",
                std::io::Error::last_os_error()
            );
            return out;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(0);
        let mut more = Process32FirstW(snapshot, std::ptr::addr_of_mut!(entry)) != 0;
        while more {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            if let Ok(name) = String::from_utf16(&entry.szExeFile[..len]) {
                out.push(name);
            }
            more = Process32NextW(snapshot, std::ptr::addr_of_mut!(entry)) != 0;
        }

        CloseHandle(snapshot);
    }
    out
}

/// Studio cannot run on any other platform, so the check is always false.
#[cfg(not(windows))]
fn process_names() -> Vec<String> {
    Vec::new()
}
