// src-tauri — Rust core: fs commands (S22 containment), notify watcher, (later) fastembed,
// keychain, sidecar mgmt. Pass 02 wires the vault filesystem surface + watcher.

mod containment;
mod embeddings;
mod fs_commands;
mod sidecar;
mod watcher;

use embeddings::EmbeddingsState;
use fs_commands::VaultRoots;
use sidecar::SidecarState;
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
        .invoke_handler(tauri::generate_handler![
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
            embeddings::embeddings_index,
            embeddings::embeddings_put,
            embeddings::embeddings_remove,
            embeddings::embeddings_remap,
            embeddings::embeddings_topk,
            embeddings::embeddings_vectors,
            sidecar::sidecar_call,
            sidecar::sidecar_capabilities,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
