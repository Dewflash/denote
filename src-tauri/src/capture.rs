// src-tauri/src/capture.rs — pass-10 native capture.
//
// macOS global hotkey uses Carbon directly so we do not need an extra Tauri plugin. The capture
// payload is collected before DeNote is focused, preserving the user's clipboard where possible.

use serde::Serialize;
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePayload {
    pub text: String,
    pub source_app: Option<String>,
    pub source_url: Option<String>,
    pub source_title: Option<String>,
    pub captured_at: String,
    pub mode: String,
    pub warning: Option<String>,
}

#[tauri::command]
pub fn capture_current_context() -> CapturePayload {
    collect_capture_payload()
}

#[tauri::command]
pub fn set_global_hotkey(app: tauri::AppHandle, combo: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return carbon_hotkey::set(app, &combo);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, combo);
        Err("global capture hotkeys are only available on macOS".into())
    }
}

pub fn emit_capture(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let payload = collect_capture_payload();
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        let _ = app.emit("denote://global-capture", payload);
    });
}

pub fn collect_capture_payload() -> CapturePayload {
    let source_app = frontmost_app();
    let browser = source_app.as_deref().and_then(browser_context);
    let before = run("pbpaste", &[]);
    let selected = copy_selection();
    // Restore the user's clipboard unconditionally (checkpoint E): an empty prior clipboard is
    // restored to empty, not left holding the grabbed selection. Known limitation (logged in
    // PROGRESS): pbpaste/pbcopy round-trips TEXT only — rich/image clipboard content is not
    // preserved by the fallback path.
    let _ = write_stdin("pbcopy", before.as_deref().unwrap_or(""));
    let fallback = before.unwrap_or_default();
    let text = selected.clone().filter(|s| !s.trim().is_empty()).unwrap_or(fallback);
    CapturePayload {
        text,
        source_app,
        source_url: browser.as_ref().and_then(|b| b.0.clone()),
        source_title: browser.and_then(|b| b.1),
        captured_at: now_iso(),
        mode: if selected.is_some() { "selection".into() } else { "clipboard".into() },
        warning: if selected.is_none() {
            Some("Accessibility selection read failed; used clipboard fallback.".into())
        } else {
            None
        },
    }
}

fn copy_selection() -> Option<String> {
    let _ = run(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to keystroke \"c\" using {command down}",
        ],
    );
    std::thread::sleep(std::time::Duration::from_millis(180));
    run("pbpaste", &[]).filter(|s| !s.trim().is_empty())
}

fn frontmost_app() -> Option<String> {
    run(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ],
    )
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

fn browser_context(app: &str) -> Option<(Option<String>, Option<String>)> {
    let script = match app {
        "Safari" => {
            r#"tell application "Safari"
if not (exists front document) then return ""
set u to URL of front document
set t to name of front document
return u & "\n" & t
end tell"#
        }
        "Google Chrome" | "Chromium" | "Brave Browser" | "Microsoft Edge" | "Arc" => {
            r#"tell application "%APP%"
if not (exists front window) then return ""
set u to URL of active tab of front window
set t to title of active tab of front window
return u & "\n" & t
end tell"#
        }
        _ => return None,
    }
    .replace("%APP%", app);
    let out = run("osascript", &["-e", &script])?;
    let mut lines = out.lines();
    let url = lines.next().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let title = lines.next().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    Some((url, title))
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

fn write_stdin(cmd: &str, stdin: &str) -> Result<(), String> {
    let mut child = Command::new(cmd)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut pipe) = child.stdin.take() {
        use std::io::Write;
        pipe.write_all(stdin.as_bytes()).map_err(|e| e.to_string())?;
    }
    child.wait().map_err(|e| e.to_string()).map(|_| ())
}

fn now_iso() -> String {
    let script = r#"use framework "Foundation"
set d to current application's NSDate's date()
set f to current application's NSISO8601DateFormatter's new()
return (f's stringFromDate:d) as text"#;
    run("osascript", &["-e", script]).unwrap_or_default().trim().to_string()
}

#[cfg(target_os = "macos")]
pub fn install_global_hotkey(app: tauri::AppHandle) -> Result<(), String> {
    carbon_hotkey::install(app)
}

#[cfg(not(target_os = "macos"))]
pub fn install_global_hotkey(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
mod carbon_hotkey {
    use super::emit_capture;
    use std::ffi::c_void;
    use std::fs;
    use std::sync::{Mutex, OnceLock};
    use tauri::Manager;

    type OSStatus = i32;
    type UInt32 = u32;
    type EventHandlerCallRef = *mut c_void;
    type EventRef = *mut c_void;
    type EventTargetRef = *mut c_void;
    type EventHandlerRef = *mut c_void;
    type EventHotKeyRef = *mut c_void;
    type EventHotKeyIDSignature = u32;

    #[repr(C)]
    struct EventTypeSpec {
        event_class: UInt32,
        event_kind: UInt32,
    }

    #[repr(C)]
    struct EventHotKeyID {
        signature: EventHotKeyIDSignature,
        id: UInt32,
    }

    const fn fourcc(bytes: &[u8; 4]) -> u32 {
        ((bytes[0] as u32) << 24) | ((bytes[1] as u32) << 16) | ((bytes[2] as u32) << 8) | bytes[3] as u32
    }

    const EVENT_CLASS_KEYBOARD: UInt32 = fourcc(b"keyb");
    const EVENT_HOTKEY_PRESSED: UInt32 = 6;
    const CMD_KEY: UInt32 = 1 << 8;
    const SHIFT_KEY: UInt32 = 1 << 9;
    const OPTION_KEY: UInt32 = 1 << 11;
    const CONTROL_KEY: UInt32 = 1 << 12;

    extern "C" {
        fn GetApplicationEventTarget() -> EventTargetRef;
        fn InstallEventHandler(
            target: EventTargetRef,
            handler: extern "C" fn(EventHandlerCallRef, EventRef, *mut c_void) -> OSStatus,
            count: UInt32,
            list: *const EventTypeSpec,
            user_data: *mut c_void,
            out_ref: *mut EventHandlerRef,
        ) -> OSStatus;
        fn RegisterEventHotKey(
            key_code: UInt32,
            modifiers: UInt32,
            hotkey_id: EventHotKeyID,
            target: EventTargetRef,
            options: UInt32,
            out_ref: *mut EventHotKeyRef,
        ) -> OSStatus;
        fn UnregisterEventHotKey(hotkey: EventHotKeyRef) -> OSStatus;
    }

    #[derive(Default)]
    struct State {
        handler_ref: usize,
        hotkey_ref: usize,
        user_data: usize,
    }

    static STATE: OnceLock<Mutex<State>> = OnceLock::new();

    fn state() -> &'static Mutex<State> {
        STATE.get_or_init(|| Mutex::new(State::default()))
    }

    pub fn install(app: tauri::AppHandle) -> Result<(), String> {
        let combo = load_saved_combo(&app).unwrap_or_else(|| "cmd-shift-n".to_string());
        register(app, &combo, true)
    }

    pub fn set(app: tauri::AppHandle, combo: &str) -> Result<(), String> {
        let result = register(app.clone(), combo, false);
        if result.is_ok() {
            save_combo(&app, combo)?;
        }
        result
    }

    fn register(app: tauri::AppHandle, combo: &str, initial: bool) -> Result<(), String> {
        let (key_code, modifiers) = parse_combo(combo)?;
        let mut current = state().lock().map_err(|_| "hotkey state is unavailable".to_string())?;
        if current.handler_ref == 0 {
            let boxed = Box::new(app);
            let user_data = Box::into_raw(boxed) as *mut c_void;
            current.user_data = user_data as usize;
            let spec = EventTypeSpec {
                event_class: EVENT_CLASS_KEYBOARD,
                event_kind: EVENT_HOTKEY_PRESSED,
            };
            let mut handler_ref: EventHandlerRef = std::ptr::null_mut();
            let target = unsafe { GetApplicationEventTarget() };
            let status = unsafe { InstallEventHandler(target, handler, 1, &spec, user_data, &mut handler_ref) };
            if status != 0 {
                return Err(format!("InstallEventHandler failed: {status}"));
            }
            current.handler_ref = handler_ref as usize;
        }
        let target = unsafe { GetApplicationEventTarget() };
        let hotkey = EventHotKeyID {
            signature: fourcc(b"DNCT"),
            id: 1,
        };
        let mut hotkey_ref: EventHotKeyRef = std::ptr::null_mut();
        let status = unsafe { RegisterEventHotKey(key_code, modifiers, hotkey, target, 0, &mut hotkey_ref) };
        if status != 0 {
            return Err(format!("RegisterEventHotKey failed for {combo}: {status}"));
        }
        if current.hotkey_ref != 0 && !initial {
            unsafe { UnregisterEventHotKey(current.hotkey_ref as EventHotKeyRef) };
        }
        current.hotkey_ref = hotkey_ref as usize;
        Ok(())
    }

    fn parse_combo(combo: &str) -> Result<(UInt32, UInt32), String> {
        let lowered = combo.to_ascii_lowercase();
        let parts: Vec<&str> = lowered.split('-').collect();
        if parts.len() < 2 || parts[0] != "cmd" {
            return Err("global capture must be a cmd-... shortcut".into());
        }
        let mut modifiers = CMD_KEY;
        for part in &parts[1..parts.len() - 1] {
            modifiers |= match *part {
                "shift" => SHIFT_KEY,
                "alt" | "option" => OPTION_KEY,
                "ctrl" | "control" => CONTROL_KEY,
                _ => return Err(format!("unsupported global capture modifier: {part}")),
            };
        }
        let key = parts[parts.len() - 1];
        let code = match key {
            "a" => 0, "s" => 1, "d" => 2, "f" => 3, "h" => 4, "g" => 5,
            "z" => 6, "x" => 7, "c" => 8, "v" => 9, "b" => 11, "q" => 12,
            "w" => 13, "e" => 14, "r" => 15, "y" => 16, "t" => 17, "1" => 18,
            "2" => 19, "3" => 20, "4" => 21, "6" => 22, "5" => 23, "=" => 24,
            "9" => 25, "7" => 26, "-" => 27, "8" => 28, "0" => 29, "]" => 30,
            "o" => 31, "u" => 32, "[" => 33, "i" => 34, "p" => 35, "l" => 37,
            "j" => 38, "k" => 40, "n" => 45, "m" => 46, "," => 43, "." => 47,
            "/" => 44, "`" => 50, ";" => 41, "'" => 39,
            _ => return Err(format!("unsupported global capture key: {key}")),
        };
        Ok((code, modifiers))
    }

    fn combo_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
        app.path().app_data_dir().map(|root| root.join("hotkey.txt")).map_err(|e| e.to_string())
    }

    fn load_saved_combo(app: &tauri::AppHandle) -> Option<String> {
        fs::read_to_string(combo_path(app).ok()?).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    fn save_combo(app: &tauri::AppHandle, combo: &str) -> Result<(), String> {
        let path = combo_path(app)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(path, combo).map_err(|e| e.to_string())
    }

    extern "C" fn handler(_next: EventHandlerCallRef, _event: EventRef, user_data: *mut c_void) -> OSStatus {
        if !user_data.is_null() {
            let app = unsafe { (&*(user_data as *const tauri::AppHandle)).clone() };
            emit_capture(app);
        }
        0
    }
}
