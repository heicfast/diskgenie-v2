//! Store auto-update scheduler (docs/LICENSING-ARCHITECTURE.md §9):
//! a 24-hour cadence that, when the app runs as a Microsoft-Store
//! (MSIX) package, calls `GetAppAndOptionalStorePackageUpdatesAsync()`
//! and — when updates exist — `RequestDownloadAndInstallStorePackage
//! UpdatesAsync()` (the owner-named WinRT APIs). Non-Store builds
//! (NSIS/portable) no-op; their channel is docs/DISTRIBUTION.md.
//!
//! Best-effort by design: failures log and wait for the next cycle —
//! an update check must never disturb the user's session.

use tauri::AppHandle;

/// The auto-check interval (24 h, per the owner decision).
const STORE_UPDATE_INTERVAL_S: u64 = 24 * 60 * 60;

/// Start the scheduler thread (called from `setup`; Windows only —
/// the macOS Store distribution isn't in scope yet).
#[cfg(windows)]
pub fn start_store_update_scheduler(app: &AppHandle) {
    use tauri::Manager;
    let handle = std::sync::Arc::new(app.clone());
    std::thread::Builder::new()
        .name("db-store-update".into())
        .spawn(move || {
            loop {
                let result = crate::platform::win::store_update::check_and_install_updates();
                match result {
                    Ok(true) => {
                        // Updates were installed (the Store may relaunch
                        // the app per its own policy).
                        if let Some(an) = handle.try_state::<crate::analytics::Analytics>() {
                            an.capture("store_update_installed", &[]);
                        }
                    }
                    Ok(false) => {}
                    Err(reason) => {
                        // Best-effort: log + telemetry, next cycle retries.
                        eprintln!("store update check failed: {reason}");
                        if let Some(an) = handle.try_state::<crate::analytics::Analytics>() {
                            an.capture("store_update_failed", &[]);
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(STORE_UPDATE_INTERVAL_S));
            }
        })
        .expect("store update scheduler thread");
}

/// Non-Windows no-op (the scheduler only exists for Store builds).
#[cfg(not(windows))]
pub fn start_store_update_scheduler(_app: &AppHandle) {}
