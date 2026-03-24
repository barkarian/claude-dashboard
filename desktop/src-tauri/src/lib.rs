mod events;
mod permissions;
mod power;
mod sidecar;
mod tray;

use std::sync::Arc;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            permissions::check_macos_permissions,
            permissions::open_privacy_settings,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Resolve resource paths
            let resource_path = handle
                .path()
                .resource_dir()
                .expect("Failed to resolve resource dir");
            let node_path = resource_path.join("resources").join("node");
            let server_path = resource_path.join("resources").join("server");

            log::info!("Node path: {}", node_path.display());
            log::info!("Server path: {}", server_path.display());

            // Create and spawn sidecar
            let manager = Arc::new(sidecar::SidecarManager::new(node_path, server_path));
            if let Err(e) = manager.spawn(handle.clone()) {
                log::error!("Failed to spawn sidecar: {}", e);
            }

            // Store manager in Tauri state for shutdown
            app.manage(manager.clone());

            // Prevent system sleep while app is running
            power::prevent_sleep();

            // Setup system tray
            if let Err(e) = tray::setup(&handle) {
                log::error!("Failed to setup tray: {}", e);
            }

            // Listen for state changes to control the window
            let app_handle = handle.clone();
            let mut state_rx = manager.state_rx();
            tauri::async_runtime::spawn(async move {
                loop {
                    if state_rx.changed().await.is_err() {
                        break;
                    }
                    let state = state_rx.borrow().clone();
                    match state {
                        sidecar::SidecarState::Ready { port } => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let url = format!("http://localhost:{}", port);
                                let _ = window.navigate(url.parse().unwrap());
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        sidecar::SidecarState::FirstRun => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.navigate("tauri://localhost/wizard.html".parse().unwrap());
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        sidecar::SidecarState::Crashed(ref msg) => {
                            let _ = app_handle.emit("sidecar-crashed", serde_json::json!({ "error": msg }));
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                            }
                        }
                        _ => {}
                    }
                }
            });

            // Auto-update check (10s after startup, then every 6 hours)
            let update_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                check_for_update(&update_handle).await;

                let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 60 * 60));
                loop {
                    interval.tick().await;
                    check_for_update(&update_handle).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray behavior
            if let WindowEvent::CloseRequested { api, .. } = event {
                let should_hide = true; // TODO: read from tauri-plugin-store
                if should_hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Error building Tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                power::allow_sleep();
                if let Some(manager) = app.try_state::<Arc<sidecar::SidecarManager>>() {
                    manager.shutdown();
                }
            }
        });
}

async fn check_for_update(app: &tauri::AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("Failed to create updater: {}", e);
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            log::info!("Update available: {}", update.version);
            let _ = app.emit(
                "update-available",
                serde_json::json!({
                    "version": update.version,
                    "body": update.body,
                }),
            );
        }
        Ok(None) => {
            log::info!("No updates available");
        }
        Err(e) => {
            log::warn!("Update check failed: {}", e);
        }
    }
}
