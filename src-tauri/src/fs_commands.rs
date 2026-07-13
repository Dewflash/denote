// src-tauri/src/fs_commands.rs — the vault filesystem commands exposed to the webview. Every
// command routes through `containment::contained_path` (S22). Writes are atomic: bytes are
// written to a sibling `*.denote-tmp`, fsync'd, then renamed over the target (S7). Note bytes
// are never interpreted — they round-trip verbatim so contentHash (D3a) stays byte-stable.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

use crate::containment::{contained_path, is_ignored};

/// Registered canonical vault roots. The only paths any command will touch (S22/D33).
#[derive(Default)]
pub struct VaultRoots(pub Mutex<Vec<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryDto {
    pub rel_path: String,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub mtime: u64,
    pub btime: u64,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatDto {
    pub mtime: u64,
    pub btime: u64,
    pub size: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Birthtime (creation time), used for Today view / note-dates precedence (S26). Falls back to
/// mtime when the platform/filesystem doesn't report it (mirrors `mtime_ms`'s error handling).
fn btime_ms(meta: &fs::Metadata) -> u64 {
    meta.created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_else(|| mtime_ms(meta))
}

fn is_md(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".md")
}

fn roots(state: &VaultRoots) -> Vec<PathBuf> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn register_vault_root(root: String, state: tauri::State<'_, VaultRoots>) -> Result<(), String> {
    let canon = fs::canonicalize(&root).map_err(|e| format!("cannot canonicalize root: {e}"))?;
    let mut guard = state.0.lock().unwrap();
    if !guard.contains(&canon) {
        guard.push(canon);
    }
    Ok(())
}

/// Resolve (and create if missing) the OS-conventional per-app data directory (macOS:
/// `~/Library/Application Support/{bundle identifier}`) — the home of `vaults.json` and future
/// app-support stores (D17/S24/S26). A "separate, equally-guarded command" per S22: it never
/// returns file CONTENTS, only a fixed system path; every actual read/write against it still
/// goes through `register_vault_root` + the same `contained_path` boundary as any vault.
#[tauri::command]
pub fn app_support_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir failed: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_note(
    root: String,
    rel_path: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<String, String> {
    let path = contained_path(&roots(&state), &root, &rel_path)?;
    fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))
}

/// Read a non-`.md` asset's raw bytes (S26: image embeds `![[img.png]]` render read-only in the
/// editor). Same containment boundary as every other command (S22) — there is still no generic
/// `read_file(path)` escape hatch; this only ever returns bytes for a path inside a registered
/// vault root, and the frontend never sends this content to any AI backend or the parse pipeline.
#[tauri::command]
pub fn read_asset(
    root: String,
    rel_path: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<Vec<u8>, String> {
    let path = contained_path(&roots(&state), &root, &rel_path)?;
    fs::read(&path).map_err(|e| format!("read failed: {e}"))
}

#[tauri::command]
pub fn write_note(
    root: String,
    rel_path: String,
    content: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<(), String> {
    let path = contained_path(&roots(&state), &root, &rel_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    // Append (not with_extension, which would REPLACE .md and let `a.md`/`a.txt` collide on
    // one tmp name — S7 says path + ".denote-tmp").
    let tmp = PathBuf::from(format!("{}.denote-tmp", path.display()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("tmp create failed: {e}"))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("write failed: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync failed: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("atomic rename failed: {e}"))
}

#[tauri::command]
pub fn create_dir(
    root: String,
    rel_path: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<(), String> {
    let path = contained_path(&roots(&state), &root, &rel_path)?;
    fs::create_dir_all(&path).map_err(|e| format!("mkdir failed: {e}"))
}

#[tauri::command]
pub fn delete_path(
    root: String,
    rel_path: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<(), String> {
    let path = contained_path(&roots(&state), &root, &rel_path)?;
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("remove dir failed: {e}"))
    } else {
        fs::remove_file(&path).map_err(|e| format!("remove file failed: {e}"))
    }
}

#[tauri::command]
pub fn rename_path(
    root: String,
    from: String,
    to: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<(), String> {
    let rs = roots(&state);
    let src = contained_path(&rs, &root, &from)?;
    let dst = contained_path(&rs, &root, &to)?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("rename failed: {e}"))
}

#[tauri::command]
pub fn stat_path(
    root: String,
    rel_path: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<Option<FileStatDto>, String> {
    let path = contained_path(&roots(&state), &root, &rel_path)?;
    match fs::metadata(&path) {
        Ok(meta) => Ok(Some(FileStatDto {
            mtime: mtime_ms(&meta),
            btime: btime_ms(&meta),
            size: meta.len(),
        })),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn path_exists(
    root: String,
    rel_path: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<bool, String> {
    let path = contained_path(&roots(&state), &root, &rel_path)?;
    Ok(path.exists())
}

/// Recursive listing of the whole vault, excluding the ignore set (S22). Directories are returned
/// as well so empty user folders can be indexed and survive a reload.
#[tauri::command]
pub fn list_vault_files(
    root: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<Vec<DirEntryDto>, String> {
    let base = contained_path(&roots(&state), &root, "")?;
    let mut out = Vec::new();
    walk(&base, &base, &mut out)?;
    Ok(out)
}

fn walk(base: &PathBuf, dir: &PathBuf, out: &mut Vec<DirEntryDto>) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let rel = match path.strip_prefix(base) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if is_ignored(&rel) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            out.push(DirEntryDto {
                rel_path: rel.clone(),
                is_dir: true,
                is_markdown: false,
                mtime: mtime_ms(&meta),
                btime: btime_ms(&meta),
                size: 0,
            });
            walk(base, &path, out)?;
        } else {
            let name = entry.file_name().to_string_lossy().to_string();
            out.push(DirEntryDto {
                rel_path: rel.clone(),
                is_dir: false,
                is_markdown: is_md(&name),
                mtime: mtime_ms(&meta),
                btime: btime_ms(&meta),
                size: meta.len(),
            });
        }
    }
    Ok(())
}

/// Non-recursive listing of a single directory (used for `.denote/` stores + snapshot dirs);
/// NOT ignore-filtered, since callers pass paths under `.denote/` deliberately.
#[tauri::command]
pub fn list_dir(
    root: String,
    rel_path: String,
    state: tauri::State<'_, VaultRoots>,
) -> Result<Vec<DirEntryDto>, String> {
    let base = contained_path(&roots(&state), &root, "")?;
    let dir = contained_path(&roots(&state), &root, &rel_path)?;
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out), // missing dir → empty listing
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let rel = match path.strip_prefix(&base) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        out.push(DirEntryDto {
            rel_path: rel,
            is_dir: meta.is_dir(),
            is_markdown: is_md(&name),
            mtime: mtime_ms(&meta),
            btime: btime_ms(&meta),
            size: meta.len(),
        });
    }
    Ok(out)
}
