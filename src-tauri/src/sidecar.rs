// src-tauri/src/sidecar.rs — supervisor for the Apple Foundation Models sidecar (D11/S13).
//
// Transport: a child process speaking NDJSON on stdin/stdout — one JSON object per line, no
// Content-Length framing. Requests `{id, method, params}`; responses `{id, result}` or
// `{id, error: {code, message}}`; stderr is logs only. Calls are serialized (one at a time) under
// a mutex — on-device generation is sequential anyway, and it keeps request/response pairing
// trivial without an out-of-order dispatcher.
//
// Supervision (S13):
//   - 30s timeout per call: on timeout the child is killed and a typed `ai-timeout` is returned.
//   - crash / broken pipe: restart, at most 3 restarts per rolling 60s; past that the backend is
//     marked unavailable until app restart or an explicit `retry` (capabilities reports why).
//   - malformed JSON line from the sidecar: dropped (logged to stderr on our side); the read loop
//     keeps going until the matching id or the timeout.
//   - app quit: the child is killed (Drop + the caller wires a RunEvent::Exit kill) — no orphans.
//
// Binary resolution (dev vs bundle): `DENOTE_SIDECAR_BIN` env var wins (points at the
// `swift build` product in dev / tests); otherwise a sibling of the app executable named
// `apple-ai-sidecar` (the Tauri external-binary convention). If neither exists the backend is
// simply unavailable and the app queues jobs — never an error dialog (pass-7 brief).

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

const CALL_TIMEOUT: Duration = Duration::from_secs(30);
const RESTART_WINDOW: Duration = Duration::from_secs(60);
const MAX_RESTARTS_PER_WINDOW: usize = 3;

/// Tauri-managed supervisor state.
#[derive(Default)]
pub struct SidecarState(pub Mutex<Supervisor>);

#[derive(Default)]
pub struct Supervisor {
    proc: Option<Process>,
    restarts: Vec<Instant>,
    /// Set once the restart budget is exhausted; cleared by an explicit retry / app restart.
    disabled_reason: Option<String>,
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    /// Lines from the child's stdout, delivered by a dedicated reader thread so a hung sidecar
    /// can't block us past the call timeout.
    lines: Receiver<String>,
    next_id: u64,
}

enum CallError {
    Transport(String),
    Backend(String),
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn resolve_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("DENOTE_SIDECAR_BIN") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    // Sibling of the current executable (Tauri external-binary layout).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join("apple-ai-sidecar");
            if cand.exists() {
                return Some(cand);
            }
        }
    }
    None
}

impl Supervisor {
    fn spawn(&mut self) -> Result<(), String> {
        if let Some(reason) = &self.disabled_reason {
            return Err(reason.clone());
        }
        let bin = resolve_binary().ok_or_else(|| {
            "Apple sidecar binary not found (set DENOTE_SIDECAR_BIN or bundle apple-ai-sidecar)"
                .to_string()
        })?;
        let mut child = Command::new(&bin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("sidecar spawn failed: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if tx.send(l).is_err() {
                            break; // receiver dropped (process replaced) → stop reading
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        self.proc = Some(Process {
            child,
            stdin,
            lines: rx,
            next_id: 1,
        });
        Ok(())
    }

    /// Record a restart; disable the backend if the budget is blown (S13).
    fn note_restart(&mut self) {
        let now = Instant::now();
        self.restarts
            .retain(|t| now.duration_since(*t) < RESTART_WINDOW);
        self.restarts.push(now);
        if self.restarts.len() > MAX_RESTARTS_PER_WINDOW {
            self.disabled_reason = Some(
                "Apple sidecar crashed repeatedly; disabled until app restart or manual retry"
                    .to_string(),
            );
            self.proc = None;
        }
    }

    /// Clear the disabled flag and restart bookkeeping (explicit user retry).
    pub fn retry(&mut self) {
        self.disabled_reason = None;
        self.restarts.clear();
        self.proc = None;
    }

    /// One request/response round-trip. On any transport failure the child is dropped (killed) and
    /// a restart is recorded, so the next call re-spawns unless the budget is exhausted.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        if let Some(reason) = &self.disabled_reason {
            return Err(reason.clone());
        }
        if self.proc.is_none() {
            self.spawn()?;
        }

        match self.call_inner(method, params) {
            Ok(value) => Ok(value),
            Err(CallError::Backend(reason)) => Err(reason),
            Err(CallError::Transport(reason)) => {
                // Transport-level failure (write/read/timeout): tear down and count a restart.
                self.proc = None;
                self.note_restart();
                Err(reason)
            }
        }
    }

    fn call_inner(&mut self, method: &str, params: Value) -> Result<Value, CallError> {
        let proc = self
            .proc
            .as_mut()
            .ok_or_else(|| CallError::Transport("sidecar not running".to_string()))?;
        let id = proc.next_id;
        proc.next_id += 1;

        let req = Request {
            id,
            method: method.to_string(),
            params,
        };
        let line = serde_json::to_string(&req)
            .map_err(|e| CallError::Transport(format!("encode request: {e}")))?;
        proc.stdin
            .write_all(line.as_bytes())
            .and_then(|_| proc.stdin.write_all(b"\n"))
            .and_then(|_| proc.stdin.flush())
            .map_err(|e| CallError::Transport(format!("sidecar write failed: {e}")))?;

        let deadline = Instant::now() + CALL_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CallError::Transport(
                    "sidecar call timed out (30s)".to_string(),
                ));
            }
            match proc.lines.recv_timeout(remaining) {
                Ok(raw) => {
                    // Malformed line → drop and keep waiting (S13).
                    let Ok(msg) = serde_json::from_str::<Value>(&raw) else {
                        eprintln!("[sidecar] dropping malformed line: {raw}");
                        continue;
                    };
                    if msg.get("id").and_then(Value::as_u64) != Some(id) {
                        continue; // not our response (shouldn't happen with serialized calls)
                    }
                    if let Some(err) = msg.get("error") {
                        let m = err
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("sidecar error");
                        return Err(CallError::Backend(m.to_string()));
                    }
                    return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(CallError::Transport(
                        "sidecar call timed out (30s)".to_string(),
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(CallError::Transport(
                        "sidecar closed unexpectedly".to_string(),
                    ));
                }
            }
        }
    }
}

#[derive(Serialize)]
struct Request {
    id: u64,
    method: String,
    params: Value,
}

// ── commands ─────────────────────────────────────────────────────────────────────

/// Invoke a sidecar method (`summarize` / `enrichNote` / `labelSimilarity`). The result JSON is
/// returned verbatim to the AppleAiClient (apple.ts), which validates the shape. A transport
/// failure is a plain error string the frontend maps to `ai-unavailable`/`ai-timeout` (S20).
#[tauri::command]
pub fn sidecar_call(
    method: String,
    params: Value,
    state: tauri::State<'_, SidecarState>,
) -> Result<Value, String> {
    state.0.lock().unwrap().call(&method, params)
}

/// `capabilities()` never fails hard: an unavailable sidecar returns `{available:false, reason}`
/// so the router can queue jobs + surface a one-line notice instead of an error dialog
/// (pass-7 brief). `retry:true` clears a prior disabled state first (manual retry).
#[tauri::command]
pub fn sidecar_capabilities(
    retry: Option<bool>,
    state: tauri::State<'_, SidecarState>,
) -> Result<Value, String> {
    let mut sup = state.0.lock().unwrap();
    if retry.unwrap_or(false) {
        sup.retry();
    }
    match sup.call("capabilities", Value::Null) {
        Ok(mut v) => {
            if let Value::Object(ref mut object) = v {
                // The Swift protocol reports model capabilities, while the supervisor owns the
                // process lifecycle. Add that fact to the same live status response so the UI can
                // distinguish "spawned but unavailable" from "never spawned".
                object.insert("spawned".to_string(), Value::Bool(true));
            }
            Ok(v)
        }
        Err(reason) => Ok(serde_json::json!({
            "available": false,
            "spawned": sup.proc.is_some(),
            "reason": reason,
            "maxInputTokens": 0,
            "supportsGuidedJson": false,
            "modelVersion": ""
        })),
    }
}
