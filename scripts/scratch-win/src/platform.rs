//! The platform-seam stub (`crate::platform`): signature-compatible
//! shapes for the surface the REAL mirrored files call. The seam
//! itself is unchanged this session — disk_storage's callers, not the
//! probe, are what the mirror checks.

pub use diskgenie_core::platform::{DirListing, KnownFolder, Platform};

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

    /// The NTFS turbo geometry (compile-check shape; the fields mirror
    /// the real win.rs struct).
    #[derive(Debug, Clone, Copy)]
    pub struct TurboGeometry {
        /// Bytes per logical sector.
        pub bytes_per_sector: u32,
        /// Bytes per filesystem cluster.
        pub bytes_per_cluster: u32,
        /// Bytes per MFT record.
        pub bytes_per_record: u32,
        /// Valid data length of the $MFT stream.
        pub mft_valid_data_length: u64,
    }

    /// Always errors (the turbo engine is Windows-only; the callers
    /// under mirror coverage check the Err arm).
    pub fn turbo_geometry(_drive_root: &str) -> Result<(std::fs::File, TurboGeometry), String> {
        Err("stub".into())
    }

    /// Always errors (see turbo_geometry).
    pub fn turbo_read_mft(
        _volume: &mut std::fs::File,
        _geo: &TurboGeometry,
    ) -> Result<Vec<u8>, String> {
        Err("stub".into())
    }

    /// The elevation grant probe (false on the stub).
    #[must_use]
    pub fn enable_backup_privilege() -> bool {
        false
    }

    // ── The license-facts surface (license.rs's collect_device_facts) ──
    // Signature-parity stubs: the REAL collectors are platform code
    // (sysctl/IOKit/Registry) and not under mirror coverage; only the
    // CALLERS are.

    /// The machine GUID analogue (IOPlatformUUID / MachineGuid).
    #[must_use]
    pub fn machine_guid() -> Option<String> {
        None
    }

    /// The system drive's volume serial.
    #[must_use]
    pub fn system_drive_serial() -> Option<u32> {
        None
    }

    /// The CPU brand string.
    #[must_use]
    pub fn cpuid_brand() -> Option<String> {
        None
    }

    /// The hostname.
    #[must_use]
    pub fn hostname() -> Option<String> {
        None
    }

    /// The OS version string.
    #[must_use]
    pub fn os_version() -> String {
        "stub".into()
    }

    /// Physical RAM in MB.
    #[must_use]
    pub fn ram_mb() -> Option<u64> {
        None
    }

    /// The machine model identifier.
    #[must_use]
    pub fn machine_model() -> Option<String> {
        None
    }

    /// The baseboard serial.
    #[must_use]
    pub fn baseboard_serial() -> Option<String> {
        None
    }

    /// The firmware UUID.
    #[must_use]
    pub fn firmware_uuid() -> Option<String> {
        None
    }

    /// The firmware version.
    #[must_use]
    pub fn firmware_version() -> Option<String> {
        None
    }

    /// Logical CPU cores.
    #[must_use]
    pub fn cpu_cores() -> Option<u32> {
        None
    }

    /// The CPU architecture.
    #[must_use]
    pub fn arch() -> &'static str {
        "stub"
    }

    /// The app data dir (license.bin's parent).
    #[must_use]
    pub fn app_data_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(".")
    }

    /// DPAPI/Keychain protect (the stub is a passthrough — the CALLERS
    /// are under coverage, not the Keychain itself).
    #[allow(clippy::unnecessary_wraps)] // signature parity with the real Keychain seam
    pub fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }

    /// DPAPI/Keychain unprotect (stub: not-found, exactly like a fresh
    /// machine — the load path's cold branch).
    pub fn dpapi_unprotect(_data: &[u8]) -> Result<Vec<u8>, String> {
        Err("stub: not found".into())
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
