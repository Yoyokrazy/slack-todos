use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};
// tauri-plugin-shell is still registered for ACL compatibility

/// JSON messages emitted by the Node.js sidecar on stdout.
#[derive(Deserialize)]
struct SidecarMessage {
    event: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    count: Option<u32>,
}

/// Shared tray state updated from sidecar stdout.
struct TrayState {
    status: String,
    sync_count: u32,
}

/// macOS app data directory for persistent config and state.
fn app_data_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join("Library/Application Support/com.slack-todos.tray")
}

/// Path to the persistent state file (sync count, etc.).
fn state_path() -> std::path::PathBuf {
    app_data_dir().join("state.json")
}

/// Load persisted sync count from state.json (returns 0 if missing/corrupt).
fn load_sync_count() -> u32 {
    let path = state_path();
    if !path.exists() {
        return 0;
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("sync_count")?.as_u64())
        .map(|n| n as u32)
        .unwrap_or(0)
}

/// Persist sync count to state.json.
fn save_sync_count(count: u32) {
    let dir = app_data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let json = serde_json::json!({ "sync_count": count });
    let _ = std::fs::write(state_path(), serde_json::to_string_pretty(&json).unwrap_or_default());
}

/// Resolve the path to the `.env` configuration file.
///
/// Checks (in order): bundled resources → app data dir → cwd.
fn env_path() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // Bundled: Contents/MacOS/../Resources/resources/.env
            let bundled = exe_dir.join("../Resources/resources/.env");
            if bundled.exists() || exe_dir.join("../Resources/resources").exists() {
                return bundled;
            }
        }
    }
    // App data dir (user-modified config from settings window)
    let app_env = app_data_dir().join(".env");
    if app_env.exists() {
        return app_env;
    }
    std::env::current_dir()
        .unwrap_or_default()
        .join(".env")
}

/// Read configuration values from the `.env` file.
#[tauri::command]
fn read_config() -> Result<HashMap<String, String>, String> {
    let path = env_path();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    Ok(map)
}

/// Write configuration values to the `.env` file in the app data directory.
#[tauri::command]
fn write_config(config: HashMap<String, String>) -> Result<(), String> {
    let path = app_data_dir().join(".env");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut lines = Vec::new();
    lines.push("# Slack App Credentials (Socket Mode)".to_string());
    if let Some(v) = config.get("SLACK_USER_TOKEN") {
        lines.push(format!("SLACK_USER_TOKEN={}", v));
    }
    if let Some(v) = config.get("SLACK_APP_TOKEN") {
        lines.push(format!("SLACK_APP_TOKEN={}", v));
    }
    lines.push(String::new());
    lines.push("# Your Slack user ID".to_string());
    if let Some(v) = config.get("SLACK_USER_ID") {
        lines.push(format!("SLACK_USER_ID={}", v));
    }
    lines.push(String::new());
    lines.push("# Emoji that triggers a todo".to_string());
    if let Some(v) = config.get("TODO_EMOJI") {
        lines.push(format!("TODO_EMOJI={}", v));
    }
    lines.push(String::new());
    lines.push("# Absolute path to the todo file (including filename)".to_string());
    if let Some(v) = config.get("TODO_FILE_PATH") {
        lines.push(format!("TODO_FILE_PATH={}", v));
    }
    lines.push(String::new());
    std::fs::write(&path, lines.join("\n")).map_err(|e| e.to_string())
}

/// Open a native file save dialog and return the selected path.
/// Kept as a fallback but the frontend uses the JS dialog API directly.
#[allow(dead_code)]
fn pick_file(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Select Todo File")
        .add_filter("Markdown", &["md"])
        .blocking_save_file()
        .map(|fp| fp.to_string())
}

/// Close the settings window without quitting the app.
#[tauri::command]
fn close_settings(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.destroy();
    }
}

/// Restart the application.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    tauri::process::restart(&app.env());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let persisted_count = load_sync_count();
    let state = Arc::new(Mutex::new(TrayState {
        status: "Starting...".to_string(),
        sync_count: persisted_count,
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![read_config, write_config, restart_app, close_settings])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Hide from Dock programmatically
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
                unsafe {
                    NSApp().setActivationPolicy_(
                        NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory,
                    );
                }
            }

            // Enable launch at login
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                if !autostart.is_enabled().unwrap_or(false) {
                    let _ = autostart.enable();
                }
            }

            // Load the template tray icon
            let icon = Image::from_path("icons/iconTemplate.png")
                .or_else(|_| {
                    // In bundled app, resolve relative to the app's resource dir
                    let resource_dir = app.path().resource_dir()
                        .unwrap_or_default();
                    Image::from_path(resource_dir.join("icons/iconTemplate.png"))
                })
                .unwrap_or_else(|_| {
                    // Last resort: use the app icon
                    app.default_window_icon().cloned().unwrap()
                });

            // Build tray menu — keep references for live updates
            let status_item = MenuItemBuilder::with_id("status", "Status: Starting...")
                .enabled(false)
                .build(app)?;
            let sync_item = MenuItemBuilder::with_id("sync", format!("Todos synced: {}", persisted_count))
                .enabled(false)
                .build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "Settings...").build(app)?;
            let readme_item = MenuItemBuilder::with_id("readme", "README").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let title_item = MenuItemBuilder::with_id("title", "Slack Todos")
                .enabled(false)
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&title_item)
                .separator()
                .item(&status_item)
                .item(&sync_item)
                .separator()
                .item(&settings_item)
                .item(&readme_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("Slack Todos — Starting...")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "settings" => {
                        #[cfg(target_os = "macos")]
                        {
                            use cocoa::appkit::{NSApp, NSApplication};
                            unsafe {
                                NSApp().activateIgnoringOtherApps_(true);
                            }
                        }
                        if let Some(win) = app.get_webview_window("settings") {
                            let _ = win.set_focus();
                        } else {
                            let _ = WebviewWindowBuilder::new(
                                app,
                                "settings",
                                WebviewUrl::default(),
                            )
                            .title("Slack Todos \u{2014} Settings")
                            .inner_size(500.0, 550.0)
                            .resizable(false)
                            .minimizable(false)
                            .center()
                            .focused(true)
                            .build();
                        }
                    }
                    "readme" => {
                        let _ = std::process::Command::new("open")
                            .arg("https://github.com/Yoyokrazy/slack-todos")
                            .spawn();
                    }
                    _ => {}
                })
                .build(app)?;

            // Spawn the Node.js sidecar directly (bypasses shell plugin path resolution)
            let sidecar_path = std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|p| p.join("slack-todos-sidecar")));

            let sidecar_child = sidecar_path.as_ref().and_then(|path| {
                std::process::Command::new(path)
                    .arg("--initial-count")
                    .arg(persisted_count.to_string())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .map_err(|e| eprintln!("Spawn error: {}", e))
                    .ok()
            });

            let mut child = match sidecar_child {
                Some(child) => child,
                None => {
                    let mut s = state.lock().unwrap();
                    s.status = "Error: sidecar not found".to_string();
                    let _ = status_item.set_text(format!("Status: {}", s.status));
                    let _ = tray.set_tooltip(Some(&format!("Slack Todos — {}", s.status)));
                    return Ok(());
                }
            };

            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            // Clone references for the async task
            let state_clone = state.clone();
            let status_item_clone = status_item.clone();
            let sync_item_clone = sync_item.clone();
            let tray_clone = tray.clone();
            let status_item_clone2 = status_item.clone();
            let tray_clone2 = tray.clone();
            let state_clone2 = state.clone();

            // Read stdout for JSON IPC messages
            if let Some(stdout) = stdout {
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(stdout);
                    for line in reader.lines() {
                        let Ok(line) = line else { break };
                        if let Ok(msg) = serde_json::from_str::<SidecarMessage>(&line) {
                            let mut s = state_clone.lock().unwrap();
                            match msg.event.as_str() {
                                "status" => {
                                    if let Some(v) = msg.value {
                                        s.status = v;
                                    }
                                }
                                "sync" => {
                                    if let Some(c) = msg.count {
                                        s.sync_count = c;
                                        save_sync_count(c);
                                    }
                                }
                                _ => {}
                            }
                            let _ = status_item_clone
                                .set_text(format!("Status: {}", s.status));
                            let _ = sync_item_clone
                                .set_text(format!("Todos synced: {}", s.sync_count));
                            let _ = tray_clone.set_tooltip(Some(&format!(
                                "Slack Todos — {}",
                                s.status
                            )));
                        }
                    }
                    // Stdout closed = sidecar exited
                    let mut s = state_clone2.lock().unwrap();
                    s.status = "Error (sidecar exited)".to_string();
                    let _ = status_item_clone2
                        .set_text(format!("Status: {}", s.status));
                    let _ = tray_clone2.set_tooltip(Some(&format!(
                        "Slack Todos — {}",
                        s.status
                    )));
                });
            }

            // Log stderr
            if let Some(stderr) = stderr {
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines() {
                        let Ok(line) = line else { break };
                        eprintln!("sidecar stderr: {}", line);
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Prevent the app from exiting when the settings window is closed
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
