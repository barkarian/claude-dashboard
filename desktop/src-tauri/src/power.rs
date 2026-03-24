use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static CAFFEINATE: Mutex<Option<Child>> = Mutex::new(None);
static PMSET_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Try to activate pmset disablesleep via admin prompt.
/// Returns true if successful, false if denied/failed.
#[cfg(target_os = "macos")]
fn try_activate_pmset() -> bool {
    let pid = std::process::id();

    // IMPORTANT: /bin/sh on macOS is bash in POSIX mode, which does NOT support
    // the &> redirect operator. Using &>/dev/null causes the background process
    // to keep stdout open, which makes `do shell script` hang forever.
    // Use the POSIX-compatible >/dev/null 2>&1 instead.
    let script = format!(
        concat!(
            r#"do shell script ""#,
            r#"pmset disablesleep 1; "#,
            r#"(while kill -0 {} 2>/dev/null; do sleep 5; done; pmset disablesleep 0) >/dev/null 2>&1 &"#,
            r#"" with administrator privileges"#,
        ),
        pid
    );

    match Command::new("osascript")
        .args(["-e", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) if output.status.success() => {
            PMSET_ACTIVE.store(true, Ordering::SeqCst);
            log::info!(
                "pmset disablesleep 1 active (including lid close), monitor watching pid {}",
                pid
            );
            true
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!(
                "Admin denied or pmset failed: {}. Caffeinate active (idle sleep only).",
                stderr.trim()
            );
            false
        }
        Err(e) => {
            log::warn!(
                "osascript failed: {}. Caffeinate active (idle sleep only).",
                e
            );
            false
        }
    }
}

/// Prevent system sleep while the app is running, including lid-close sleep.
///
/// Strategy:
/// 1. Start `caffeinate -s` immediately (idle sleep prevention, no admin needed)
/// 2. In background thread: prompt for admin password to run `pmset disablesleep 1`
///    - Also spawns a root monitor process that re-enables sleep when our app exits
///    - Uses POSIX-compatible shell syntax (`>/dev/null 2>&1`, NOT `&>` which
///      silently breaks in `/bin/sh` and causes `do shell script` to hang forever)
/// 3. If user denies admin, caffeinate remains active as fallback (idle sleep only)
#[cfg(target_os = "macos")]
pub fn prevent_sleep() {
    let pid = std::process::id();

    // Immediate baseline: caffeinate prevents idle sleep (no admin required)
    match Command::new("caffeinate")
        .args(["-s", "-w", &pid.to_string()])
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

    // pmset disablesleep prevents ALL sleep including lid-close, but requires
    // an admin password prompt every launch (macOS doesn't cache osascript creds).
    // Skip it by default — caffeinate is sufficient for most users.
    // TODO: Make lid-close sleep prevention opt-in via a settings toggle.
}

/// Release sleep prevention (called on app exit).
/// The background monitor also re-enables sleep within ~5s of our PID dying,
/// so this is best-effort for faster cleanup on graceful shutdown.
#[cfg(target_os = "macos")]
pub fn allow_sleep() {
    // Stop caffeinate
    if let Some(mut child) = CAFFEINATE.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("Caffeinate stopped");
    }

    if PMSET_ACTIVE.load(Ordering::SeqCst) {
        // Best-effort: try non-interactive sudo (works if credential timestamp is cached).
        // This avoids waiting the full ~5s for the background monitor to notice we exited.
        let result = Command::new("sudo")
            .args(["-n", "pmset", "disablesleep", "0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();

        match result {
            Ok(output) if output.status.success() => {
                log::info!("Sleep re-enabled via sudo -n pmset");
            }
            _ => {
                log::info!(
                    "Could not re-enable sleep directly; background monitor will handle it within ~5s"
                );
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prevent_sleep() {}

#[cfg(not(target_os = "macos"))]
pub fn allow_sleep() {}
