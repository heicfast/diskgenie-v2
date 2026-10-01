//! DiskBytes `Tauri` app entry (spec §2; doc 02 §2).
//!
//! The app crate owns the `WebView` shell, plugins and IPC commands; all
//! platform-independent logic lives in `diskbytes-core` so it stays
//! testable on any host (decision D10). M3 registers the scan commands
//! (doc 03 M3.7); later milestones add layout/cleanup/dupes/apps/
//! monitor/snapshot commands.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analytics;
mod commands;
// Public so the live-E2E integration test (tests/live_license.rs, the
// `live-license-e2e` feature) can drive the REAL client against the
// deployed worker. Binary crate — the lib surface is only consumed by
// main.rs + tests, so this widens nothing that ships.
pub mod license;
mod platform;
// Public so the shell-delete integration test (tests/shell_delete.rs)
// can drive the REAL IFileOperation pipeline against real temp files on
// the Windows CI runner (the disk-level proof the owner asked for:
// recycle → gone + bin count +1; permanent → gone + count same).
// Binary crate — the lib surface is only consumed by main.rs + tests,
// so this widens nothing that ships.
pub mod recycle;
mod state;

// Test-accessible re-exports of the platform icon surface for
// tests/shell_delete.rs (binary crate — doc-hidden, ships nothing
// beyond the lib the main binary already links).
#[cfg(windows)]
#[doc(hidden)]
pub mod apps_test_probe {
    pub use crate::platform::os::{find_main_exe, icon_png_data_url, msix_icon_data_urls};
}

#[cfg(test)]
mod tests_support;

use std::sync::Arc;

use platform::HostPlatform;

use tauri::Manager;

/// Comfortable default window size (logical px) — a document-style
/// window, never screen-filling. `tauri.conf.json` creates the window
/// with this size; [`fit_window_to_work_area`] then guarantees it fits
/// the monitor's work area (taskbar / dock / menu bar excluded).
const DEFAULT_WINDOW_W: f64 = 1440.0;
const DEFAULT_WINDOW_H: f64 = 860.0;

/// The design floor (matches `minWidth`/`minHeight` in tauri.conf.json).
/// IMPORTANT: programmatic `set_size` does NOT enforce the configured
/// minimums (those gate user resizes) — on a 1024×768 CI runner the
/// 86% clamp produced a 880px window and the sub-minimum layout
/// squeezed the content header to "DiskB". Clamp up explicitly: on
/// screens smaller than the floor the window simply exceeds the
/// screen (standard min-size app behavior) instead of breaking.
const MIN_WINDOW_W: f64 = 1280.0;
const MIN_WINDOW_H: f64 = 760.0;

/// Never cover more than this fraction of the work area on either
/// axis — the desktop must stay visible around the app (user-reported
/// issue: the old 1680×1050 default clamped to the work area on
/// 1080p Windows and MacBook displays, so the app opened effectively
/// fullscreen on both platforms).
const WORK_AREA_FRACTION: f64 = 0.86;

/// Parse the `DISKBYTES_WINDOW` dev hook (`1280x760`, case-insensitive
/// `X` separator). `None` on any malformed spec — the fit path runs.
fn parse_window_spec(spec: &str) -> Option<(f64, f64)> {
    let (w, h) = spec.trim().to_lowercase().split_once('x')?;
    let (w, h) = (w.trim().parse::<f64>().ok()?, h.trim().parse::<f64>().ok()?);
    (w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0).then_some((w, h))
}

/// Clamp the main window to a premium default size that fits the
/// primary monitor's work area, then center and show it. Runs in
/// `setup` while the window is still hidden (`visible: false` in the
/// config) so the resize never flashes.
///
/// The `DISKBYTES_WINDOW=WxH` dev hook (capture workflows) overrides
/// the fit with an exact logical size — still clamped to the design
/// floor, so on a display smaller than 1280×760 the window exceeds
/// the screen exactly like the fitted default would (the CI display,
/// not the app, must grow — the harness bumps the runner's resolution
/// before launching).
fn fit_window_to_work_area(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Some(spec) = commands::scan::read_dev_hooks().window {
        if let Some((w, h)) = parse_window_spec(&spec) {
            let (w, h) = (w.max(MIN_WINDOW_W), h.max(MIN_WINDOW_H));
            let _ = window.set_size(tauri::LogicalSize::new(w, h));
            let _ = window.center();
            eprintln!("[bench] window size applied: {w}x{h}");
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
    }
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        // Work area is physical px; convert to logical for LogicalSize.
        let area_w = f64::from(area.size.width) / scale;
        let area_h = f64::from(area.size.height) / scale;
        if area_w > 100.0 && area_h > 100.0 {
            let w = DEFAULT_WINDOW_W
                .min((area_w * WORK_AREA_FRACTION).floor())
                .max(MIN_WINDOW_W);
            let h = DEFAULT_WINDOW_H
                .min((area_h * WORK_AREA_FRACTION).floor())
                .max(MIN_WINDOW_H);
            let _ = window.set_size(tauri::LogicalSize::new(w, h));
            let _ = window.center();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Build and run the app (single window configured in `tauri.conf.json`).
///
/// # Panics
/// Panics when the `Tauri` runtime fails to start (event-loop failure,
/// window creation failure). The message surfaces in the crash log; a
/// desktop app cannot meaningfully continue without its window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Spec M0.4: the ONLY plugin is the file/folder dialog.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            fit_window_to_work_area(app);
            app.manage(state::AppState::new());
            app.manage(commands::layout::layout_cache());
            app.manage(commands::layout::regroup_cache());
            app.manage(commands::explore::top_cache());
            app.manage(commands::explore::age_cache());
            app.manage(commands::sidebar::quick_wins_cache());
            app.manage(commands::applications::apps_cache());
            app.manage(commands::monitor::monitor_state());
            app.manage(commands::license::license_manager());
            app.manage(analytics::Analytics::init());
            app.manage(Arc::new(HostPlatform) as Arc<HostPlatform>);
            // Dev hooks (spec §15): auto-start a scan when requested.
            commands::license::start_scheduler(&app.handle().clone());
            commands::store_update::start_store_update_scheduler(&app.handle().clone());
            let hooks = commands::scan::read_dev_hooks();
            if let Some(target) = hooks.scan {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let state = handle.state::<state::AppState>();
                    let platform = handle.state::<Arc<HostPlatform>>();
                    let license = handle.state::<commands::license::LicenseManager>();
                    let _ = tauri::async_runtime::block_on(commands::scan::start_scan(
                        target,
                        None,
                        handle.clone(),
                        state,
                        platform,
                        license,
                    ));
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan::start_scan,
            commands::scan::cancel_scan,
            commands::scan::get_status,
            commands::scan::get_dev_hooks,
            commands::scan::start_scan_turbo,
            commands::layout::get_layout,
            commands::layout::get_names,
            commands::explore::get_folder_view,
            commands::explore::node_details,
            commands::explore::top_sizes,
            commands::explore::age_map,
            commands::explore::list_children,
            commands::explore::get_breadcrumb,
            commands::shell::open_node,
            commands::shell::open_url,
            commands::shell::reveal_in_explorer,
            commands::shell::copy_path,
            commands::shell::preview_text,
            commands::shell::hover_details,
            commands::cleanup::commit_cleanup,
            commands::cleanup::delete_permanently,
            commands::cleanup::open_recycle_bin,
            commands::sidebar::get_drive_chips,
            commands::sidebar::get_home_path,
            commands::sidebar::resolve_path,
            commands::sidebar::disk_storage,
            commands::sidebar::is_elevated,
            commands::sidebar::restart_as_admin,
            commands::sidebar::quick_wins,
            commands::sidebar::quick_win_items,
            commands::sidebar::file_types,
            commands::dupes::find_duplicates,
            commands::dupes::cancel_duplicates,
            commands::dupes::dupes_status,
            commands::applications::list_applications,
            commands::applications::uninstall_app,
            commands::applications::leftover_root_paths,
            commands::monitor::monitor_start,
            commands::monitor::monitor_stop,
            commands::license::license_status,
            commands::license::activate_license,
            commands::license::deactivate_license,
            commands::license::validate_now,
            commands::license::license_sim_set,
            commands::analytics_cmd::analytics_opt_out,
            commands::analytics_cmd::set_analytics_opt_out,
            commands::snapshots_cmd::list_snapshots,
            commands::snapshots_cmd::take_snapshot,
            commands::snapshots_cmd::diff_snapshots,
            commands::snapshots_cmd::delete_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod window_spec_tests {
    use super::parse_window_spec;

    #[test]
    fn parses_width_x_height_with_padding_and_case() {
        assert_eq!(parse_window_spec("1280x760"), Some((1280.0, 760.0)));
        assert_eq!(parse_window_spec(" 1440 X 860 "), Some((1440.0, 860.0)));
    }

    #[test]
    fn rejects_malformed_specs() {
        assert_eq!(parse_window_spec(""), None);
        assert_eq!(parse_window_spec("1280"), None);
        assert_eq!(parse_window_spec("axb"), None);
        assert_eq!(parse_window_spec("0x760"), None);
        assert_eq!(parse_window_spec("-5x760"), None);
        assert_eq!(parse_window_spec("1280x760x9"), None);
    }
}
