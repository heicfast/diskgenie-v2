//! The mirrored command modules: the three REAL files under test plus
//! the license-manager stub their gates call.

#[path = "../../../src-tauri/src/commands/dupes.rs"]
pub mod dupes;
#[path = "../../../src-tauri/src/commands/sidebar.rs"]
pub mod sidebar;
#[path = "../../../src-tauri/src/commands/snapshots_cmd.rs"]
pub mod snapshots_cmd;

/// The license gate stub (`crate::commands::license`): every mirrored
/// command's `require_licensed` call must type-check; the REAL gate is
/// unchanged this session and not under mirror coverage.
pub mod license {
    /// The real manager's stand-in.
    pub struct LicenseManager;
    /// The real gate's signature (`&license` derefs through State) —
    /// always Ok in the stub (signature parity is the point).
    #[allow(clippy::unnecessary_wraps)]
    pub fn require_licensed(_mgr: &LicenseManager, _now: i64) -> Result<(), String> {
        Ok(())
    }
}
