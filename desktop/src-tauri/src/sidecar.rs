use serde::Deserialize;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::watch;

use crate::events;

// ── Sidecar JSON protocol types ────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SidecarEvent {
    Ready {
        port: u16,
    },
    FirstRun,
    Status {
        tunnel: String,
        subdomain: Option<String>,
    },
    Notification {
        title: String,
        body: String,
        #[serde(rename = "deepLink")]
        deep_link: Option<String>,
        event: String,
    },
}

// ── Sidecar state machine ──────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum SidecarState {
    Starting,
    Ready { port: u16 },
    FirstRun,
    Crashed(String),
    Stopped,
}

// ── Manager ────────────────────────────────────────────────────────

pub struct SidecarManager {
    child: Arc<Mutex<Option<Child>>>,
    state_tx: watch::Sender<SidecarState>,
    state_rx: watch::Receiver<SidecarState>,
    node_path: PathBuf,
    server_path: PathBuf,
    max_restarts: u32,
    restart_count: Arc<Mutex<u32>>,
}

impl SidecarManager {
    pub fn new(node_path: PathBuf, server_path: PathBuf) -> Self {
        let (state_tx, state_rx) = watch::channel(SidecarState::Starting);
        Self {
            child: Arc::new(Mutex::new(None)),
            state_tx,
            state_rx,
            node_path,
            server_path,
            max_restarts: 3,
            restart_count: Arc::new(Mutex::new(0)),
        }
    }

    pub fn state_rx(&self) -> watch::Receiver<SidecarState> {
        self.state_rx.clone()
    }

    /// Spawn the Node.js sidecar process.
    pub fn spawn(&self, app: AppHandle) -> Result<(), String> {
        let entry = self.server_path.join("index.ts");
        let node = &self.node_path;

        log::info!(
            "Spawning sidecar: {} {}",
            node.display(),
            entry.display()
        );

        let child = Command::new(node)
            .arg(entry.to_str().unwrap_or("index.ts"))
            .env("CLAW_DESKTOP", "1")
            .env("NODE_ENV", "production")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string());

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr".to_string());

        // We need to move the child into the mutex but also need stdout/stderr
        // before the move, so we destructure here
        let mut child = child;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        {
            let mut lock = self.child.lock().unwrap();
            *lock = Some(child);
        }

        let _ = self.state_tx.send(SidecarState::Starting);

        // Stdout reader: parse JSON lines
        if let Some(stdout) = stdout {
            let app_handle = app.clone();
            let state_tx = self.state_tx.clone();
            let restart_count = self.restart_count.clone();
            thread::spawn(move || {
                let reader = std::io::BufReader::new(stdout);
                for line in reader.lines() {
                    let line = match line {
                        Ok(l) => l,
                        Err(_) => break,
                    };
                    if line.trim().is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<SidecarEvent>(&line) {
                        Ok(event) => {
                            // Update state based on event
                            match &event {
                                SidecarEvent::Ready { port } => {
                                    let _ = state_tx.send(SidecarState::Ready { port: *port });
                                    // Reset restart count on successful ready
                                    *restart_count.lock().unwrap() = 0;
                                }
                                SidecarEvent::FirstRun => {
                                    let _ = state_tx.send(SidecarState::FirstRun);
                                }
                                _ => {}
                            }
                            // Dispatch to event handler
                            events::handle_sidecar_event(&app_handle, event);
                        }
                        Err(e) => {
                            log::warn!("Failed to parse sidecar stdout: {} (line: {})", e, line);
                        }
                    }
                }
            });
        }

        // Stderr reader: forward to app logs
        if let Some(stderr) = stderr {
            thread::spawn(move || {
                let reader = std::io::BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => log::info!("[sidecar] {}", l),
                        Err(_) => break,
                    }
                }
            });
        }

        // Monitor child process for unexpected exits
        let child_arc = self.child.clone();
        let state_tx = self.state_tx.clone();
        let restart_count = self.restart_count.clone();
        let max_restarts = self.max_restarts;
        let node_path = self.node_path.clone();
        let server_path = self.server_path.clone();
        let app_for_monitor = app.clone();

        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(500));

                let mut lock = child_arc.lock().unwrap();
                if let Some(ref mut child) = *lock {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            log::warn!("Sidecar exited with status: {:?}", status);
                            *lock = None;
                            drop(lock);

                            let mut count = restart_count.lock().unwrap();
                            if *count < max_restarts {
                                *count += 1;
                                log::info!(
                                    "Restarting sidecar (attempt {}/{})",
                                    *count,
                                    max_restarts
                                );
                                drop(count);

                                thread::sleep(Duration::from_secs(2));

                                let new_manager =
                                    SidecarManager::new(node_path.clone(), server_path.clone());
                                // Reuse our restart_count
                                *new_manager.restart_count.lock().unwrap() =
                                    *restart_count.lock().unwrap();
                                if let Err(e) = new_manager.spawn(app_for_monitor.clone()) {
                                    log::error!("Failed to restart sidecar: {}", e);
                                    let _ = state_tx
                                        .send(SidecarState::Crashed(format!("Restart failed: {}", e)));
                                }
                                break;
                            } else {
                                let msg = format!(
                                    "Sidecar crashed {} times. Please restart the app.",
                                    max_restarts
                                );
                                log::error!("{}", msg);
                                let _ = state_tx.send(SidecarState::Crashed(msg));
                                break;
                            }
                        }
                        Ok(None) => {
                            // Still running
                        }
                        Err(e) => {
                            log::error!("Error checking sidecar status: {}", e);
                            break;
                        }
                    }
                } else {
                    // No child, manager was shut down
                    break;
                }
            }
        });

        // Health check fallback: poll /api/auth/status
        let state_tx_health = self.state_tx.clone();
        let mut state_rx_health = self.state_rx.clone();
        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let max_polls = 60; // 30 seconds at 500ms
            for _ in 0..max_polls {
                tokio::time::sleep(Duration::from_millis(500)).await;

                // If we already got Ready from stdout, stop polling
                if matches!(*state_rx_health.borrow(), SidecarState::Ready { .. }) {
                    return;
                }

                match client
                    .get("http://localhost:2222/api/auth/status")
                    .send()
                    .await
                {
                    Ok(res) if res.status().is_success() => {
                        // Server is up — if we haven't gotten Ready event yet, force it
                        if !matches!(*state_rx_health.borrow(), SidecarState::Ready { .. }) {
                            log::info!("Health check detected server ready (fallback)");
                            let _ = state_tx_health.send(SidecarState::Ready { port: 2222 });
                        }
                        return;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Gracefully shut down the sidecar: SIGTERM → 5s grace → SIGKILL.
    pub fn shutdown(&self) {
        let mut lock = self.child.lock().unwrap();
        if let Some(ref mut child) = *lock {
            log::info!("Shutting down sidecar (SIGTERM)...");

            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }
            }

            #[cfg(windows)]
            {
                let _ = child.kill();
            }

            // Wait up to 5 seconds
            let start = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > Duration::from_secs(5) {
                            log::warn!("Sidecar didn't stop in 5s, sending SIGKILL");
                            let _ = child.kill();
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                    Err(_) => break,
                }
            }

            *lock = None;
        }
        let _ = self.state_tx.send(SidecarState::Stopped);
    }
}
