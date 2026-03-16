use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use std::sync::Mutex;

/// Tray state: current tunnel status and subdomain.
pub struct TrayState {
    pub tunnel_status: String,
    pub subdomain: Option<String>,
}

static TRAY_STATE: Mutex<TrayState> = Mutex::new(TrayState {
    tunnel_status: String::new(),
    subdomain: None,
});

/// Build and register the system tray.
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    {
        let mut state = TRAY_STATE.lock().unwrap();
        state.tunnel_status = "disconnected".to_string();
    }

    let open_item = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
    let copy_url_item = MenuItem::with_id(app, "copy_url", "Copy URL", true, None::<&str>)?;
    let status_item = MenuItem::with_id(app, "status", "Connection: Offline", false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &copy_url_item,
            &status_item,
            &separator,
            &settings_item,
            &quit_item,
        ],
    )?;

    // Use a simple colored square as tray icon (red = disconnected)
    let icon = create_status_icon("disconnected");

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Claw Dev — Disconnected")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "open" => show_main_window(app),
                "copy_url" => {
                    let state = TRAY_STATE.lock().unwrap();
                    if let Some(ref sub) = state.subdomain {
                        let url = format!("https://{}.claw-dev.com", sub);
                        // Use clipboard (via app emit — frontend handles it)
                        let _ = app.emit("copy-to-clipboard", url);
                    }
                }
                "settings" => {
                    show_main_window(app);
                    let _ = app.emit("navigate", "/settings");
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Update tray icon and tooltip based on tunnel status.
pub fn update_status(app: &AppHandle, status: &str) {
    let mut state = TRAY_STATE.lock().unwrap();
    state.tunnel_status = status.to_string();

    let tooltip = match status {
        "connected" => {
            if let Some(ref sub) = state.subdomain {
                format!("Claw Dev — {}.claw-dev.com", sub)
            } else {
                "Claw Dev — Connected".to_string()
            }
        }
        "connecting" => "Claw Dev — Connecting...".to_string(),
        _ => "Claw Dev — Disconnected".to_string(),
    };

    let icon = create_status_icon(status);

    // Update tray icon — Tauri v2 doesn't have a direct set_icon on app,
    // so we emit an event that can be used to update. For now, the initial
    // icon is set and we update tooltip via the tray handle if available.
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(icon));
        let _ = tray.set_tooltip(Some(&tooltip));

        // Update the status menu item text
        let status_text = match status {
            "connected" => "Connection: Online",
            "connecting" => "Connection: Connecting...",
            _ => "Connection: Offline",
        };
        // Menu item updates require rebuilding — emit event for frontend to track
        let _ = app.emit("tray-status-update", status_text);
    }
}

/// Update the stored subdomain (called from events).
pub fn set_subdomain(subdomain: Option<String>) {
    let mut state = TRAY_STATE.lock().unwrap();
    state.subdomain = subdomain;
}

/// Create a simple 16x16 icon with a status-colored dot.
fn create_status_icon(status: &str) -> Image<'static> {
    let (r, g, b) = match status {
        "connected" => (34u8, 197u8, 94u8),    // green
        "connecting" => (234u8, 179u8, 8u8),    // yellow
        _ => (239u8, 68u8, 68u8),               // red
    };

    // Create a 16x16 RGBA image with a centered dot
    let size = 16usize;
    let mut rgba = vec![0u8; size * size * 4];
    let center = size as f64 / 2.0;
    let radius = 5.0f64;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - center + 0.5;
            let dy = y as f64 - center + 0.5;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = (y * size + x) * 4;
            if dist <= radius {
                rgba[idx] = r;
                rgba[idx + 1] = g;
                rgba[idx + 2] = b;
                rgba[idx + 3] = 255;
            }
        }
    }

    Image::new_owned(rgba, size as u32, size as u32)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
