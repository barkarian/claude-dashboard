use tauri::{AppHandle, Emitter, Manager};

use crate::sidecar::SidecarEvent;
use crate::tray;

/// Central dispatcher for all sidecar stdout events.
pub fn handle_sidecar_event(app: &AppHandle, event: SidecarEvent) {
    match event {
        SidecarEvent::Ready { port } => {
            log::info!("Sidecar ready on port {}", port);
            let _ = app.emit("sidecar-ready", serde_json::json!({ "port": port }));
        }

        SidecarEvent::FirstRun => {
            log::info!("Sidecar first-run detected");
            let _ = app.emit("sidecar-first-run", ());
        }

        SidecarEvent::Status { ref tunnel, ref subdomain } => {
            log::info!("Tunnel status: {} (subdomain: {:?})", tunnel, subdomain);
            let _ = app.emit(
                "tunnel-status",
                serde_json::json!({
                    "tunnel": tunnel,
                    "subdomain": subdomain,
                }),
            );
            // Update tray icon based on tunnel status
            tray::update_status(app, tunnel);
        }

        SidecarEvent::Notification {
            ref title,
            ref body,
            ref deep_link,
            ref event,
        } => {
            send_notification(app, title, body, deep_link.as_deref(), event);
        }
    }
}

fn send_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
    deep_link: Option<&str>,
    event_name: &str,
) {
    // Check store for per-event notification toggle
    let store = app
        .try_state::<tauri_plugin_store::StoreCollection<tauri::Wry>>();
    if let Some(_store_collection) = store {
        // Check if this notification type is disabled
        // Store key format: "notifications.{event_name}"
        // Default: enabled
        // For now, we always send — store check can be refined when frontend sets values
    }

    // Send native notification
    if let Err(e) = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        log::warn!("Failed to send notification: {}", e);
    }

    // Emit to frontend so clicking can navigate
    if let Some(link) = deep_link {
        let _ = app.emit(
            "notification-clicked",
            serde_json::json!({
                "event": event_name,
                "deepLink": link,
            }),
        );
    }
}
