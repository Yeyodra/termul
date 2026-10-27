//! A live JSON-RPC session with `StudioMCP.exe`.
//!
//! Spawning the child and completing `initialize` costs ~69 ms, but every later
//! `tools/call` on the same child costs 1-2 ms. The lamp polls, so the session is
//! kept alive for as long as the Roblox project is active and torn down when the
//! user leaves it.
//!
//! The wire is newline-framed JSON-RPC 2.0 over the child's stdio. [`Client`]
//! owns the protocol and is generic over its byte streams, so the tests drive it
//! over an in-memory duplex instead of a real `StudioMCP.exe`; [`StudioSession`]
//! adds the process.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

use crate::process_util::hide_console;
#[cfg(windows)]
use crate::process_util::KillOnCloseJob;

/// MCP protocol revision this client speaks. The measured `initialize` result
/// negotiates the same value.
pub const PROTOCOL_VERSION: &str = "2025-11-25";

/// Tool that lists the Studio instances the MCP proxy can reach.
pub const LIST_STUDIOS_TOOL: &str = "list_roblox_studios";

/// Deadline for one request. The measured round-trip is 1-2 ms; this only
/// bounds the pathological cases (a child that never answers, a wedged Studio).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// One Studio instance as `list_roblox_studios` reports it.
///
/// `name` is nullable on the wire: Studio reports `"name": null` while no place
/// is loaded (the Home screen, or mid-load). The entry itself still proves a
/// Studio is reachable, so it is kept and only the display name is absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StudioEntry {
    pub id: String,
    pub name: Option<String>,
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

/// The protocol half of a session: a framed writer plus the replies in flight.
pub struct Client {
    writer: Box<dyn AsyncWrite + Unpin + Send>,
    pending: Pending,
    next_id: AtomicU64,
    request_timeout: Duration,
    initialized: bool,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("initialized", &self.initialized)
            .field("request_timeout", &self.request_timeout)
            .finish_non_exhaustive()
    }
}

impl Client {
    /// Build a client over `writer`, resolving replies read from `reader` on a
    /// background task. `reader` ends when the peer closes its side.
    pub fn new(
        writer: Box<dyn AsyncWrite + Unpin + Send>,
        reader: impl AsyncBufRead + Unpin + Send + 'static,
    ) -> Self {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        tokio::spawn(read_loop(reader, Arc::clone(&pending)));
        Self {
            writer,
            pending,
            next_id: AtomicU64::new(1),
            request_timeout: REQUEST_TIMEOUT,
            initialized: false,
        }
    }

    /// Shorten the per-request deadline so a peer that never answers fails fast
    /// instead of holding the suite for the production timeout.
    #[cfg(test)]
    #[must_use]
    pub fn with_request_timeout(mut self, timeout: Duration) -> Self {
        self.request_timeout = timeout;
        self
    }

    /// `initialize`, then the `notifications/initialized` acknowledgement.
    pub async fn initialize(&mut self) -> Result<(), String> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "termul", "version": env!("CARGO_PKG_VERSION") },
        });
        let reply = self.request("initialize", params).await?;
        if let Some(error) = reply.get("error") {
            return Err(format!("initialize rejected: {error}"));
        }
        self.write_frame(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }))
        .await?;
        self.initialized = true;
        Ok(())
    }

    /// Whether [`Client::initialize`] has completed.
    #[must_use]
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Studios the proxy can reach. An empty vector means Studio is not open
    /// (or has no place loaded) — not an error.
    pub async fn list_studios(&mut self) -> Result<Vec<StudioEntry>, String> {
        let reply = self
            .request(
                "tools/call",
                json!({ "name": LIST_STUDIOS_TOOL, "arguments": {} }),
            )
            .await?;
        if let Some(error) = reply.get("error") {
            return Err(format!("{LIST_STUDIOS_TOOL} failed: {error}"));
        }
        parse_studios(reply.get("result"))
    }

    /// Send one request and await its reply by id.
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "Studio MCP pending map is poisoned".to_string())?
            .insert(id, sender);

        let frame = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(error) = self.write_frame(&frame).await {
            // Never leave a resolver behind: the read loop cannot reach it.
            self.forget(id);
            return Err(error);
        }

        match tokio::time::timeout(self.request_timeout, receiver).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => Err(format!("{method}: the connection closed before the reply")),
            Err(_elapsed) => {
                self.forget(id);
                Err(format!("{method} timed out after {:?}", self.request_timeout))
            }
        }
    }

    async fn write_frame(&mut self, frame: &Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(frame)
            .map_err(|error| format!("could not encode the request: {error}"))?;
        line.push(b'\n');
        self.writer
            .write_all(&line)
            .await
            .map_err(|error| format!("could not write to StudioMCP: {error}"))?;
        self.writer
            .flush()
            .await
            .map_err(|error| format!("could not flush StudioMCP stdin: {error}"))
    }

    fn forget(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }
}

/// A live `StudioMCP.exe` child speaking JSON-RPC over its stdio.
pub struct StudioSession {
    child: Child,
    client: Client,
    // Windows: kills the child (and any descendant) when the session drops.
    #[cfg(windows)]
    _tree: Option<KillOnCloseJob>,
}

impl std::fmt::Debug for StudioSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StudioSession")
            .field("initialized", &self.client.is_initialized())
            .finish_non_exhaustive()
    }
}

/// The result of one live probe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StudioSnapshot {
    /// Studios the proxy can reach right now.
    pub studios: Vec<StudioEntry>,
}

impl StudioSession {
    /// Spawn `exe` and complete the MCP handshake. The child's stderr is
    /// discarded so a chatty proxy cannot pollute Termul's log.
    pub async fn spawn(exe: &std::path::Path) -> Result<Self, String> {
        let mut command = Command::new(exe);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        hide_console(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("could not start StudioMCP: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "StudioMCP has no stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "StudioMCP has no stdout".to_string())?;

        #[cfg(windows)]
        let tree = child
            .id()
            .and_then(|pid| KillOnCloseJob::new_assigned_pid(pid, "Roblox Studio MCP", false));

        let mut client = Client::new(Box::new(stdin), BufReader::new(stdout));
        client.initialize().await?;
        log::info!("[roblox] Studio MCP session initialized");

        Ok(Self {
            child,
            client,
            #[cfg(windows)]
            _tree: tree,
        })
    }

    /// Studios the proxy can reach.
    pub async fn list_studios(&mut self) -> Result<Vec<StudioEntry>, String> {
        self.client.list_studios().await
    }

    /// Call one MCP tool and hand back the raw reply envelope, not the payload.
    ///
    /// `list_studios` above is the only tool this module parses itself; the
    /// place probe parses its own reply in `place_key`.
    pub async fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
    ) -> Result<Value, String> {
        let reply = self
            .client
            .request("tools/call", json!({ "name": name, "arguments": arguments }))
            .await?;
        if let Some(error) = reply.get("error") {
            return Err(format!("{name} failed: {error}"));
        }
        Ok(reply)
    }

    /// Whether the child is still alive, without reaping it.
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

impl Drop for StudioSession {
    fn drop(&mut self) {
        // `kill_on_drop` reaps the child; the job handle (Windows) takes the
        // whole tree. Best effort: the process may already be gone.
        let _ = self.child.start_kill();
        log::info!("[roblox] Studio MCP session closed");
    }
}

/// The process-wide session. The status command is called repeatedly, so a
/// per-call spawn would pay the 69 ms handshake every tick.
static SESSION: LazyLock<tokio::sync::Mutex<Option<StudioSession>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));

/// Resolve every reply the peer writes, by id. Ends when the reader closes.
async fn read_loop(reader: impl AsyncBufRead + Unpin, pending: Pending) {
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
            log::debug!("[roblox] ignoring a non-JSON StudioMCP frame");
            continue;
        };
        // Notifications carry no id; only replies resolve a waiter.
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let waiter = pending.lock().ok().and_then(|mut map| map.remove(&id));
        if let Some(sender) = waiter {
            let _ = sender.send(message);
        }
    }
    // Closing the stream means the peer exited. Drop the waiters so no caller
    // waits out its timeout on a session that can never answer.
    if let Ok(mut map) = pending.lock() {
        map.clear();
    }
}

/// Read the studio list out of a `tools/call` result.
///
/// The proxy answers with MCP content blocks whose text is a JSON document:
/// `{"studios":[{"id":..,"name":..}]}`. A missing or malformed payload reads as
/// "no studio", never as an error — the lamp then shows Studio as not connected.
pub fn parse_studios(result: Option<&Value>) -> Result<Vec<StudioEntry>, String> {
    let Some(result) = result else {
        return Ok(Vec::new());
    };
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err("list_roblox_studios reported an error".to_string());
    }

    let document = result
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .find_map(|text| serde_json::from_str::<Value>(text).ok());

    let Some(document) = document else {
        return Ok(Vec::new());
    };
    Ok(entries_from_document(&document))
}

/// The `studios` array of a decoded payload. Split out so the mapping is
/// testable without a full MCP envelope.
///
/// Only `id` is required. A `null` or absent `name` means "reachable, no place
/// loaded yet" and must still count as a Studio, otherwise a running Studio at
/// its Home screen would be indistinguishable from no Studio at all.
pub(crate) fn entries_from_document(document: &Value) -> Vec<StudioEntry> {
    document
        .get("studios")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|studio| {
            let id = studio.get("id").and_then(Value::as_str)?;
            Some(StudioEntry {
                id: id.to_string(),
                name: studio
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.trim().is_empty())
                    .map(str::to_string),
            })
        })
        .collect()
}

/// Borrow the process-wide session for a multi-step conversation, spawning it on
/// first use and replacing it when the child died.
///
/// The guard is held for the whole borrow, so two callers cannot interleave
/// requests on one JSON-RPC pipe. Keep the work short: the lamp polls through
/// the same mutex.
pub async fn probe_session(
    exe: &std::path::Path,
) -> Result<tokio::sync::MutexGuard<'static, Option<StudioSession>>, String> {
    let mut guard = SESSION.lock().await;

    if let Some(session) = guard.as_mut() {
        if !session.is_alive() {
            log::info!("[roblox] Studio MCP child exited; respawning");
            *guard = None;
        }
    }

    if guard.is_none() {
        *guard = Some(StudioSession::spawn(exe).await?);
    }

    if guard.is_none() {
        return Err("Studio MCP session is unavailable".to_string());
    }
    Ok(guard)
}

/// Probe through the process-wide session, spawning it on first use and
/// respawning it when the child died.
pub async fn probe(exe: &std::path::Path) -> Result<StudioSnapshot, String> {
    let mut guard = probe_session(exe).await?;

    let session = guard
        .as_mut()
        .ok_or_else(|| "Studio MCP session is unavailable".to_string())?;
    match session.list_studios().await {
        Ok(studios) => Ok(StudioSnapshot { studios }),
        Err(error) => {
            // A failed call leaves the session in an unknown state; drop it so
            // the next tick starts clean instead of retrying a broken child.
            *guard = None;
            Err(error)
        }
    }
}

/// Close the session if one is open, so the ~14 MB child does not outlive its
/// purpose once Studio is gone.
pub async fn shutdown() {
    let mut guard = SESSION.lock().await;
    if guard.take().is_some() {
        log::info!("[roblox] Studio MCP session shut down");
    }
}
