use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static CAFFEINATE: Mutex<Option<Child>> = Mutex::new(None);

/// Path to the control file that signals the LaunchDaemon to activate pmset disablesleep.
/// The daemon polls this file every 3 seconds.
const CONTROL_FILE: &str = "/tmp/com.claw-dev.sleep-active";

/// Path to the LaunchDaemon plist — used to detect if the daemon is installed.
const DAEMON_PLIST: &str = "/Library/LaunchDaemons/com.claw-dev.sleep-prevention.plist";

/// Prevent system sleep while the app is running, including lid-close sleep.
///
/// Strategy:
/// 1. Start `caffeinate -si` immediately (idle sleep prevention, no admin needed)
/// 2. If the LaunchDaemon is installed, write our PID to the control file.
///    The daemon detects this and runs `pmset disablesleep 1` (no admin prompt needed).
#[cfg(target_os = "macos")]
pub fn prevent_sleep() {
    let pid = std::process::id();

    // Immediate baseline: caffeinate prevents idle sleep (no admin required)
    match Command::new("caffeinate")
        .args(["-s", "-i", "-w", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => {
            log::info!("Caffeinate started (pid: {}), idle sleep prevented", child.id());
            *CAFFEINATE.lock().unwrap() = Some(child);
        }
        Err(e) => log::error!("Failed to start caffeinate: {}", e),
    }

    // If the LaunchDaemon is installed, write our PID to the control file
    // so the daemon can activate pmset disablesleep 1 (no admin prompt needed).
    if std::path::Path::new(DAEMON_PLIST).exists() {
        match std::fs::write(CONTROL_FILE, pid.to_string()) {
            Ok(_) => log::info!(
                "Wrote PID {} to control file {}, daemon will activate pmset disablesleep",
                pid, CONTROL_FILE
            ),
            Err(e) => log::warn!("Failed to write control file {}: {}", CONTROL_FILE, e),
        }
    }
}

/// Release sleep prevention (called on app exit).
/// Removes caffeinate and deletes the control file so the daemon
/// detects the change and runs `pmset disablesleep 0` within ~3s.
#[cfg(target_os = "macos")]
pub fn allow_sleep() {
    // Stop caffeinate
    if let Some(mut child) = CAFFEINATE.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("Caffeinate stopped");
    }

    // Delete the control file — daemon will detect and disable pmset disablesleep
    match std::fs::remove_file(CONTROL_FILE) {
        Ok(_) => log::info!("Removed control file {}, daemon will deactivate pmset disablesleep", CONTROL_FILE),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // File didn't exist — nothing to clean up
        }
        Err(e) => log::warn!("Failed to remove control file {}: {}", CONTROL_FILE, e),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prevent_sleep() {}

#[cfg(not(target_os = "macos"))]
pub fn allow_sleep() {}
