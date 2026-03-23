use std::process::{Child, Command};
use std::sync::Mutex;

static CAFFEINATE: Mutex<Option<Child>> = Mutex::new(None);

/// Prevent system sleep while the app is running.
/// Uses `caffeinate -s -w <pid>`:
///   -s  prevents system sleep (display can still turn off)
///   -w  ties the assertion to our process — if we crash, caffeinate exits automatically
#[cfg(target_os = "macos")]
pub fn prevent_sleep() {
    let pid = std::process::id();
    match Command::new("caffeinate")
        .args(["-s", "-w", &pid.to_string()])
        .spawn()
    {
        Ok(child) => {
            log::info!("Sleep prevention enabled (caffeinate pid: {})", child.id());
            *CAFFEINATE.lock().unwrap() = Some(child);
        }
        Err(e) => {
            log::error!("Failed to start caffeinate: {}", e);
        }
    }
}

/// Release sleep prevention (called on app exit).
#[cfg(target_os = "macos")]
pub fn allow_sleep() {
    if let Some(mut child) = CAFFEINATE.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("Sleep prevention disabled");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prevent_sleep() {}

#[cfg(not(target_os = "macos"))]
pub fn allow_sleep() {}
