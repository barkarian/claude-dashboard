use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct PermissionStatus {
    /// false on non-macOS platforms — frontend hides the section
    pub applicable: bool,
    pub full_disk_access: bool,
    pub desktop: bool,
    pub documents: bool,
    pub downloads: bool,
}

#[cfg(target_os = "macos")]
mod macos {
    use std::fs;

    pub fn check_full_disk_access() -> bool {
        let path = "/Library/Application Support/com.apple.TCC/TCC.db";
        fs::metadata(path).is_ok()
    }

    pub fn check_folder_access(folder: &str) -> bool {
        if let Some(home) = dirs::home_dir() {
            // Try to actually list the directory — macOS TCC blocks this if not allowed
            fs::read_dir(home.join(folder)).is_ok()
        } else {
            false
        }
    }
}

#[tauri::command]
pub fn check_macos_permissions() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    {
        PermissionStatus {
            applicable: true,
            full_disk_access: macos::check_full_disk_access(),
            desktop: macos::check_folder_access("Desktop"),
            documents: macos::check_folder_access("Documents"),
            downloads: macos::check_folder_access("Downloads"),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        PermissionStatus {
            applicable: false,
            full_disk_access: true,
            desktop: true,
            documents: true,
            downloads: true,
        }
    }
}

#[tauri::command]
pub fn open_privacy_settings(pane: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = match pane.as_str() {
            "full_disk_access" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
            }
            "files_and_folders" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
            }
            _ => return Err(format!("Unknown pane: {}", pane)),
        };

        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane;
        Err("Not supported on this platform".to_string())
    }
}
