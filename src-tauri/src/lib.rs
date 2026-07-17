use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// ---------- Data model ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Note {
    id: String,
    text: String,
    #[serde(rename = "type")]
    kind: String, // "inspiration" | "todo"
    done: bool,
    ts: i64, // unix millis
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Settings {
    shortcut: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            shortcut: "CmdOrCtrl+Shift+A".to_string(),
        }
    }
}

struct AppState {
    settings: Mutex<Settings>,
}

// ---------- Path helpers ----------

fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    let notes_dir = dir.join("notes");
    let _ = fs::create_dir_all(&notes_dir);
    notes_dir
}

fn day_file(app: &AppHandle, day: &str) -> PathBuf {
    data_dir(app).join(format!("{day}.json"))
}

fn settings_file(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("failed to resolve app config dir");
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

fn load_day(app: &AppHandle, day: &str) -> Vec<Note> {
    let path = day_file(app, day);
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_day(app: &AppHandle, day: &str, notes: &[Note]) -> Result<(), String> {
    let path = day_file(app, day);
    let json = serde_json::to_string_pretty(notes).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn parse_day(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

// ---------- Commands ----------

#[tauri::command]
fn add_note(app: AppHandle, text: String, kind: String) -> Result<Note, String> {
    let day = today();
    let mut notes = load_day(&app, &day);
    let now = Local::now().timestamp_millis();
    let note = Note {
        id: format!("{}-{}", now, notes.len()),
        text: text.trim().to_string(),
        kind: if kind == "todo" {
            "todo".into()
        } else {
            "inspiration".into()
        },
        done: false,
        ts: now,
    };
    notes.push(note.clone());
    save_day(&app, &day, &notes)?;
    Ok(note)
}

/// Save several notes of the same kind in a single write.
#[tauri::command]
fn add_notes(app: AppHandle, texts: Vec<String>, kind: String) -> Result<Vec<Note>, String> {
    let day = today();
    let mut notes = load_day(&app, &day);
    let now = Local::now().timestamp_millis();
    let kind = if kind == "todo" {
        "todo".to_string()
    } else {
        "inspiration".to_string()
    };
    let mut added: Vec<Note> = Vec::new();
    for text in texts {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        let note = Note {
            id: format!("{}-{}", now, notes.len()),
            text: trimmed.to_string(),
            kind: kind.clone(),
            done: false,
            ts: now,
        };
        notes.push(note.clone());
        added.push(note);
    }
    if !added.is_empty() {
        save_day(&app, &day, &notes)?;
    }
    Ok(added)
}

#[tauri::command]
fn get_day(app: AppHandle, day: String) -> Vec<Note> {
    load_day(&app, &day)
}

/// Return all notes within [start, end] inclusive (YYYY-MM-DD), flattened & sorted desc by ts.
#[tauri::command]
fn get_range(app: AppHandle, start: String, end: String) -> Vec<Note> {
    let (Some(mut cur), Some(end_d)) = (parse_day(&start), parse_day(&end)) else {
        return Vec::new();
    };
    let mut out: Vec<Note> = Vec::new();
    while cur <= end_d {
        let day = cur.format("%Y-%m-%d").to_string();
        out.extend(load_day(&app, &day));
        match cur.succ_opt() {
            Some(next) => cur = next,
            None => break,
        }
    }
    out.sort_by(|a, b| b.ts.cmp(&a.ts));
    out
}

#[tauri::command]
fn toggle_todo(app: AppHandle, id: String, done: bool) -> Result<(), String> {
    // id embeds the timestamp; derive its day to locate the correct file.
    let ts: i64 = id
        .split('-')
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or("invalid id")?;
    let day = day_of_ts(ts);
    let mut notes = load_day(&app, &day);
    if let Some(n) = notes.iter_mut().find(|n| n.id == id) {
        n.done = done;
    }
    save_day(&app, &day, &notes)
}

#[tauri::command]
fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    let ts: i64 = id
        .split('-')
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or("invalid id")?;
    let day = day_of_ts(ts);
    let mut notes = load_day(&app, &day);
    notes.retain(|n| n.id != id);
    save_day(&app, &day, &notes)
}

fn day_of_ts(ts: i64) -> String {
    use chrono::TimeZone;
    Local
        .timestamp_millis_opt(ts)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(today)
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_shortcut(app: AppHandle, state: State<AppState>, shortcut: String) -> Result<(), String> {
    let old = state.settings.lock().unwrap().shortcut.clone();
    // Re-register: unregister old, register new.
    let gs = app.global_shortcut();
    if let Some(parsed_old) = parse_shortcut(&old) {
        let _ = gs.unregister(parsed_old);
    }
    let parsed_new = parse_shortcut(&shortcut).ok_or("无法解析快捷键")?;
    gs.register(parsed_new).map_err(|e| e.to_string())?;

    {
        let mut s = state.settings.lock().unwrap();
        s.shortcut = shortcut.clone();
        let json = serde_json::to_string_pretty(&*s).map_err(|e| e.to_string())?;
        fs::write(settings_file(&app), json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings_window(&app);
}

fn show_settings_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.center();
    }
}

// ---------- Window / shortcut helpers ----------

fn toggle_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        match w.is_visible() {
            Ok(true) => {
                let _ = w.hide();
            }
            _ => {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.emit("focus-input", ());
            }
        }
    }
}

/// Parse a string like "CmdOrCtrl+Shift+A" into a Shortcut.
fn parse_shortcut(s: &str) -> Option<Shortcut> {
    let mut mods = Modifiers::empty();
    let mut key_code: Option<Code> = None;
    for part in s.split('+') {
        match part.trim().to_ascii_lowercase().as_str() {
            "cmdorctrl" | "commandorcontrol" => {
                #[cfg(target_os = "macos")]
                {
                    mods |= Modifiers::SUPER;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    mods |= Modifiers::CONTROL;
                }
            }
            "cmd" | "command" | "super" | "meta" => mods |= Modifiers::SUPER,
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            other => key_code = code_from_str(other),
        }
    }
    key_code.map(|code| Shortcut::new(Some(mods), code))
}

fn code_from_str(s: &str) -> Option<Code> {
    let c = s.to_ascii_uppercase();
    Some(match c.as_str() {
        "A" => Code::KeyA,
        "B" => Code::KeyB,
        "C" => Code::KeyC,
        "D" => Code::KeyD,
        "E" => Code::KeyE,
        "F" => Code::KeyF,
        "G" => Code::KeyG,
        "H" => Code::KeyH,
        "I" => Code::KeyI,
        "J" => Code::KeyJ,
        "K" => Code::KeyK,
        "L" => Code::KeyL,
        "M" => Code::KeyM,
        "N" => Code::KeyN,
        "O" => Code::KeyO,
        "P" => Code::KeyP,
        "Q" => Code::KeyQ,
        "R" => Code::KeyR,
        "S" => Code::KeyS,
        "T" => Code::KeyT,
        "U" => Code::KeyU,
        "V" => Code::KeyV,
        "W" => Code::KeyW,
        "X" => Code::KeyX,
        "Y" => Code::KeyY,
        "Z" => Code::KeyZ,
        "SPACE" => Code::Space,
        "ENTER" | "RETURN" => Code::Enter,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        _ => return None,
    })
}

fn load_settings(app: &AppHandle) -> Settings {
    match fs::read_to_string(settings_file(app)) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

// ---------- App entry ----------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = load_settings(&handle);

            // Register global shortcut from settings.
            if let Some(sc) = parse_shortcut(&settings.shortcut) {
                let _ = handle.global_shortcut().register(sc);
            }

            app.manage(AppState {
                settings: Mutex::new(settings),
            });

            // ---- System tray ----
            let show_i = MenuItem::with_id(app, "show", "显示速记", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &settings_i, &quit_i])?;

            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("FlashNote")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main_window(app),
                    "settings" => show_settings_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Hide on blur so it behaves like a quick flash input.
            if let Some(w) = app.get_webview_window("main") {
                let wh = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = wh.hide();
                    }
                });
            }

            // Settings window: hide instead of close so it can be reopened.
            if let Some(sw) = app.get_webview_window("settings") {
                let swh = sw.clone();
                sw.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = swh.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_note,
            add_notes,
            get_day,
            get_range,
            toggle_todo,
            delete_note,
            get_settings,
            set_shortcut,
            hide_window,
            open_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
