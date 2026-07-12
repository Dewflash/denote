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
    const N_KEY_CODE: UInt32 = 45;

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
    }

    pub fn install(app: tauri::AppHandle) -> Result<(), String> {
        let boxed = Box::new(app);
        let user_data = Box::into_raw(boxed) as *mut c_void;
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
        let hotkey = EventHotKeyID {
            signature: fourcc(b"DNCT"),
            id: 1,
        };
        let mut hotkey_ref: EventHotKeyRef = std::ptr::null_mut();
        let status = unsafe { RegisterEventHotKey(N_KEY_CODE, CMD_KEY | SHIFT_KEY, hotkey, target, 0, &mut hotkey_ref) };
        if status != 0 {
            return Err(format!("RegisterEventHotKey failed: {status}"));
        }
        Ok(())
    }

    extern "C" fn handler(_next: EventHandlerCallRef, _event: EventRef, user_data: *mut c_void) -> OSStatus {
        if !user_data.is_null() {
            let app = unsafe { (&*(user_data as *const tauri::AppHandle)).clone() };
            emit_capture(app);
        }
        0
    }
}
