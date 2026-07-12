// src-tauri/src/keychain.rs — macOS Keychain storage for the BYO Anthropic API key (D13).
//
// The key is a generic password under service = the app bundle identifier, account = the caller-
// supplied account string ("anthropic-api-key"). It is NEVER written to any file, settings JSON,
// or env var — the Keychain is the only home (D13). The webview can set / test-for-presence /
// delete the key; only the anthropic transport reads the value back, and only to place it in an
// Authorization header for an outbound request.
//
// Guarded for macOS (the app is macOS-first, D1). On other targets the commands return a typed
// error so a non-macOS `cargo check`/`cargo test --lib` still compiles.

const SERVICE: &str = "com.dewflash.denote";

#[cfg(target_os = "macos")]
mod imp {
    use super::SERVICE;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    pub fn set(account: &str, secret: &str) -> Result<(), String> {
        set_generic_password(SERVICE, account, secret.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn get(account: &str) -> Result<Option<String>, String> {
        match get_generic_password(SERVICE, account) {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            // A missing item is not an error to the caller — it's simply "no key set".
            Err(_) => Ok(None),
        }
    }

    pub fn has(account: &str) -> bool {
        get_generic_password(SERVICE, account).is_ok()
    }

    pub fn delete(account: &str) -> Result<(), String> {
        match delete_generic_password(SERVICE, account) {
            Ok(()) => Ok(()),
            // Deleting a key that isn't there is a no-op success (idempotent).
            Err(_) => Ok(()),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn set(_account: &str, _secret: &str) -> Result<(), String> {
        Err("Keychain is only available on macOS".into())
    }
    pub fn get(_account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn has(_account: &str) -> bool {
        false
    }
    pub fn delete(_account: &str) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn keychain_set(account: String, secret: String) -> Result<(), String> {
    imp::set(&account, &secret)
}

#[tauri::command]
pub fn keychain_get(account: String) -> Result<Option<String>, String> {
    imp::get(&account)
}

#[tauri::command]
pub fn keychain_has(account: String) -> Result<bool, String> {
    Ok(imp::has(&account))
}

#[tauri::command]
pub fn keychain_delete(account: String) -> Result<(), String> {
    imp::delete(&account)
}
