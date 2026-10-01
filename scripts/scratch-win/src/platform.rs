//! The platform-seam stub (`crate::platform`): signature-compatible
//! shapes for the surface the REAL mirrored files call. The seam
//! itself is unchanged this session — disk_storage's callers, not the
//! probe, are what the mirror checks.

pub use diskbytes_core::platform::{DirListing, KnownFolder, Platform};

/// The OS dispatch module (`platform::os`).
pub mod os {
    /// A small owned UTF-16 label (the real seam's shape).
    pub struct String16(pub Vec<u16>);

    /// The volume snapshot (label + totals).
    pub struct StorageSnapshot {
        /// Volume label (empty when unavailable).
        pub label: String16,
        /// Total bytes.
        pub total: u64,
        /// Used bytes (total − free).
        pub used: u64,
        /// Free bytes.
        pub free: u64,
    }

    /// Read the storage snapshot for a volume (the stub answers None;
    /// only the CALLERS are under mirror coverage).
    #[must_use]
    pub fn disk_storage(_display_path: &str) -> Option<StorageSnapshot> {
        None
    }

    /// Elevation probe.
    #[must_use]
    pub fn is_elevated() -> bool {
        false
    }

    /// Elevated relaunch (the restart_as_admin path).
    pub fn relaunch_elevated_with(_scan_target: &str, _args: &str) -> Result<(), String> {
        Err("stub".into())
    }

    /// Hardlink identity ((volume-serial, file-index); None = unique).
    #[must_use]
    pub fn hardlink_identity(_path: &std::path::Path) -> Option<(u64, u64)> {
        None
    }
}

/// The platform host (`Arc<HostPlatform>` in managed state) — a Copy
/// unit struct, exactly like the real `WindowsPlatform`.
#[derive(Debug, Clone, Copy, Default)]
pub struct HostPlatform;

impl Platform for HostPlatform {
    fn list_dir(&self, _verbatim_dir: &str) -> DirListing {
        unimplemented!("compile-check stub")
    }
    fn fixed_drive_roots(&self) -> Vec<String> {
        Vec::new()
    }
    fn known_folder(&self, _folder: KnownFolder) -> Option<String> {
        None
    }
    fn volume_serial(&self, _verbatim_path: &str) -> Option<u64> {
        None
    }
}
