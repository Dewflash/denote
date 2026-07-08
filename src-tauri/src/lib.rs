// src-tauri — Rust core: fs commands, notify watcher, fastembed, keychain, sidecar mgmt.
// No commands are registered yet; this pass is scaffold-only (see docs/passes/pass-00).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
