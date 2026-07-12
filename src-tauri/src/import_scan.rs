// src-tauri/src/import_scan.rs — user-selected external folder import scan.
// This reads only .md/.txt files from a folder selected by the native dialog.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileDto {
    rel_path: String,
    content: String,
}

#[tauri::command]
pub fn scan_import_folder(source_root: String) -> Result<Vec<ImportFileDto>, String> {
    let root = fs::canonicalize(&source_root).map_err(|e| format!("cannot open import folder: {e}"))?;
    if !root.is_dir() {
        return Err("import source must be a folder".into());
    }
    let mut out = Vec::new();
    walk(&root, &root, &mut out)?;
    Ok(out)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<ImportFileDto>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            if name == ".obsidian" {
                continue;
            }
            walk(root, &path, out)?;
            continue;
        }
        if !is_text_note(&path) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let rel = if rel.to_ascii_lowercase().ends_with(".txt") {
            format!("{}.md", rel.trim_end_matches(".txt"))
        } else {
            rel
        };
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        out.push(ImportFileDto { rel_path: rel, content });
    }
    Ok(())
}

fn is_text_note(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "txt"))
        .unwrap_or(false)
}
