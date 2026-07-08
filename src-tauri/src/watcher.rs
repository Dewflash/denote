// src-tauri/src/watcher.rs — a `notify`-based recursive watcher per vault root. It maps native
// fs events to `{root, relPath, kind}` and emits them to the frontend as `denote://fs-event`.
// Ignored paths (`.denote/`, `.git/`, dotfiles — the SAME set as list_vault_files, S22) are
// dropped here in Rust before they ever reach the webview. Per-path debouncing and app-write
// classification happen on the frontend (watcherBridge.ts + AppWriteRegistry).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::containment::is_ignored;

pub const FS_EVENT: &str = "denote://fs-event";

/// Active watchers, keyed by canonical root, kept alive in managed state (dropping stops them).
#[derive(Default)]
pub struct Watchers(pub Mutex<HashMap<PathBuf, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEventPayload {
    root: String,
    rel_path: String,
    kind: &'static str,
}

fn rel_of(base: &Path, p: &Path) -> Option<String> {
    p.strip_prefix(base)
        .ok()
        .map(|r| r.to_string_lossy().replace('\\', "/"))
}

/// Map a native event into zero or more (relPath, kind) pairs relative to `base`.
fn map_event(base: &Path, ev: &notify::Event) -> Vec<(String, &'static str)> {
    let kind: Option<&'static str> = match ev.kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Remove(_) => Some("delete"),
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => Some("delete"),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => Some("create"),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => None, // handled below
        EventKind::Modify(_) => Some("modify"),
        _ => return Vec::new(), // Access / Other → ignore
    };

    if let EventKind::Modify(ModifyKind::Name(RenameMode::Both)) = ev.kind {
        // paths = [from, to]
        let mut out = Vec::new();
        if let Some(from) = ev.paths.first().and_then(|p| rel_of(base, p)) {
            if !is_ignored(&from) {
                out.push((from, "delete"));
            }
        }
        if let Some(to) = ev.paths.get(1).and_then(|p| rel_of(base, p)) {
            if !is_ignored(&to) {
                out.push((to, "create"));
            }
        }
        return out;
    }

    let kind = match kind {
        Some(k) => k,
        None => return Vec::new(),
    };
    ev.paths
        .iter()
        .filter_map(|p| rel_of(base, p))
        .filter(|rel| !is_ignored(rel))
        .map(|rel| (rel, kind))
        .collect()
}

/// Start watching `root` recursively, emitting fs events to the frontend. Registers first via
/// register_vault_root so the caller cannot watch an uncontained path.
#[tauri::command]
pub fn watch_vault(
    app: AppHandle,
    root: String,
    state: tauri::State<'_, Watchers>,
) -> Result<(), String> {
    let canon = std::fs::canonicalize(&root).map_err(|e| format!("cannot canonicalize root: {e}"))?;
    let base = canon.clone();
    let root_str = root.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let ev = match res {
            Ok(ev) => ev,
            Err(_) => return,
        };
        for (rel_path, kind) in map_event(&base, &ev) {
            let _ = app.emit(
                FS_EVENT,
                FsEventPayload {
                    root: root_str.clone(),
                    rel_path,
                    kind,
                },
            );
        }
    })
    .map_err(|e| format!("watcher init failed: {e}"))?;

    watcher
        .watch(&canon, RecursiveMode::Recursive)
        .map_err(|e| format!("watch failed: {e}"))?;

    state.0.lock().unwrap().insert(canon, watcher);
    Ok(())
}

/// Stop watching a root (drops the watcher).
#[tauri::command]
pub fn unwatch_vault(root: String, state: tauri::State<'_, Watchers>) -> Result<(), String> {
    if let Ok(canon) = std::fs::canonicalize(&root) {
        state.0.lock().unwrap().remove(&canon);
    }
    Ok(())
}
