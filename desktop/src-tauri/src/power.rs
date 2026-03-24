use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static CAFFEINATE: Mutex<Option<Child>> = Mutex::new(None);
static PMSET_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Prevent system sleep while the app is running, including lid-close sleep.
///
/// Strategy:
/// 1. Prompt for admin password (standard macOS dialog) to run `pmset disablesleep 1`
/// 2. Spawn a background root process that monitors our PID — when we exit (even crash),
///    it automatically runs `pmset disablesleep 0`. No second password prompt.
/// 3. If user denies admin prompt, fall back to `caffeinate -s` (idle sleep only, not lid close)
#[cfg(target_os = "macos")]
pub fn prevent_sleep() {
    let pid = std::process::id();

    // AppleScript: run pmset with admin privileges, then spawn a background
    // monitor that re-enables sleep when our process exits.
    let script = format!(
        concat!(
            r#"do shell script ""#,
            r#"pmset disablesleep 1; "#,
            r#"(while kill -0 {} 2>/dev/null; do sleep 5; done; pmset disablesleep 0) &>/dev/null &#,
            r#"" with administrator privileges"#,
        ),
        pid
    );

    match Command::new("osascript")
        .args(["-e", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
    {
        Ok(output) if output.status.success() => {
            PMSET_ACTIVE.store(true, Ordering::SeqCst);
            log::info!(
                "Sleep fully disabled via pmset (including lid close), monitor watching pid {}",
                pid
            );
        }
        _ => {
            log::warn!(
                "Admin auth denied or failed, falling back to caffeinate (idle sleep only)"
            );
            // Fallback: caffeinate -s prevents idle sleep (but not lid close)
            match Command::new("caffeinate")
                .args(["-s", "-w", &pid.to_string()])
                .spawn()
            {
                Ok(child) => {
                    log::info!("Caffeinate fallback active (pid: {})", child.id());
                    *CAFFEINATE.lock().unwrap() = Some(child);
                }
                Err(e) => log::error!("Failed to start caffeinate: {}", e),
            }
        }
    }
}

/// Release sleep prevention (called on app exit).
/// The background monitor also handles this within ~5s, so this is best-effort.
#[cfg(target_os = "macos")]
pub fn allow_sleep() {
    if let Some(mut child) = CAFFEINATE.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("Caffeinate stopped");
    }

    if PMSET_ACTIVE.load(Ordering::SeqCst) {
        log::info!("Sleep will be re-enabled by background monitor within ~5s");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prevent_sleep() {}

#[cfg(not(target_os = "macos"))]
pub fn allow_sleep() {}
