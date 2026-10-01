//! The mirrored command modules: the REAL files under test plus the
//! stubs their cross-module references call.

#[path = "../../../src-tauri/src/commands/dupes.rs"]
pub mod dupes;
#[path = "../../../src-tauri/src/commands/scan.rs"]
pub mod scan;
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

/// The layout cache stubs (`crate::commands::layout`): scan.rs's
/// clear_all_caches calls these on every tree swap. Units — only the
/// CALL SITES are under mirror coverage (the real caches are
/// generation-keyed and unaffected by this session's changes).
pub mod layout {
    /// The real layout cache (stub shape).
    pub struct Cache;
    /// The real regroup cache (stub shape).
    pub struct RegroupCache;
    /// Real signature (clears every entry).
    pub fn clear_cache(_cache: &Cache) {}
    /// Real signature.
    pub fn clear_regroup_cache(_cache: &RegroupCache) {}
}

/// The explore cache stubs (`crate::commands::explore`).
pub mod explore {
    /// The Top Sizes cache (stub shape).
    pub struct TopCache;
    impl TopCache {
        /// Real signature (clears done + inflight).
        #[allow(clippy::unused_self)] // signature parity with the real cache
        pub fn clear(&self) {}
    }
    /// The Age Map cache (stub shape).
    pub struct AgeCache;
    impl AgeCache {
        /// Real signature.
        #[allow(clippy::unused_self)] // signature parity with the real cache
        pub fn clear(&self) {}
    }
}
