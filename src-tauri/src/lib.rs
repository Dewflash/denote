// src-tauri — Rust core: fs commands (S22 containment), notify watcher, (later) fastembed,
// keychain, sidecar mgmt. Pass 02 wires the vault filesystem surface + watcher.

mod containment;
mod capture;
mod embeddings;
mod fs_commands;
mod git_history;
mod import_scan;
mod keychain;
mod sidecar;
mod watcher;

use capture::emit_capture;
use embeddings::EmbeddingsState;
use fs_commands::VaultRoots;
use sidecar::SidecarState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use watcher::Watchers;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultRoots::default())
        .manage(Watchers::default())
        .manage(EmbeddingsState::default())
        .manage(SidecarState::default())
        .setup(|app| {
            setup_tray(app.handle())?;
            if let Err(err) = capture::install_global_hotkey(app.handle().clone()) {
                let _ = app
                    .handle()
                    .emit("denote://global-capture-error", format!("cmd-shift-N registration failed: {err}"));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            capture::capture_current_context,
            capture::set_global_hotkey,
            fs_commands::register_vault_root,
            fs_commands::app_support_dir,
            fs_commands::read_note,
            fs_commands::read_asset,
            fs_commands::write_note,
            fs_commands::create_dir,
            fs_commands::delete_path,
            fs_commands::rename_path,
            fs_commands::stat_path,
            fs_commands::path_exists,
            fs_commands::list_vault_files,
            fs_commands::list_dir,
            watcher::watch_vault,
            watcher::unwatch_vault,
            embeddings::embed_texts,
            embeddings::embedding_model_status,
            embeddings::embeddings_index,
            embeddings::embeddings_put,
            embeddings::embeddings_remove,
            embeddings::embeddings_remap,
            embeddings::embeddings_topk,
            embeddings::embeddings_topk_vector,
            embeddings::embeddings_vectors,
            sidecar::sidecar_call,
            sidecar::sidecar_capabilities,
            git_history::git_history_enable,
            git_history::git_history_status,
            git_history::git_commit_all,
            git_history::git_file_history,
            git_history::git_read_file_at,
            git_history::git_set_remote,
            git_history::git_push_origin,
            git_history::git_pull_fast_forward,
            import_scan::scan_import_folder,
            keychain::keychain_set,
            keychain::keychain_get,
            keychain::keychain_has,
            keychain::keychain_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show DeNote", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Capture now", true, Some("CmdOrCtrl+Shift+N"))?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &capture, &quit])?;
    let mut builder = TrayIconBuilder::with_id("denote")
        .menu(&menu)
        .tooltip("DeNote")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "capture" => emit_capture(app.clone()),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
