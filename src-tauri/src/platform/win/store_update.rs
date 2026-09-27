//! Store auto-update (docs/LICENSING-ARCHITECTURE.md §9): the WinRT
//! `Windows.Services.Store` calls the owner named —
//! `StoreContext::GetAppAndOptionalStorePackageUpdatesAsync()` →
//! `RequestDownloadAndInstallStorePackageUpdatesAsync()` — invoked
//! automatically on a 24 h cadence by `commands::store_update`.
//!
//! Runs ONLY when the package is Microsoft-Store-signed
//! (`PackageSignatureKind::Store`): NSIS/portable builds keep the
//! DISTRIBUTION.md channel. Async ops are polled exactly like the
//! existing `RemovePackageAsync` call site (windows-future 0.3 exposes
//! no blocking get()).
//!
//! NOTE on UX: `RequestDownloadAndInstallStorePackageUpdatesAsync`
//! shows the Store's consent/progress UI when the OS requires it
//! (mandatory updates or user policy); silent installs happen
//! otherwise. That is the documented contract for these APIs.

use windows::core::Interface;
use windows::Services::Store::StoreContext;

/// Is this executable running as a Microsoft-Store (MSIX) package?
#[must_use]
pub fn is_store_signed() -> bool {
    let Ok(package) = windows::ApplicationModel::Package::Current() else {
        return false;
    };
    package
        .SignatureKind()
        .is_ok_and(|kind| kind == windows::ApplicationModel::PackageSignatureKind::Store)
}

/// One update cycle: returns `Ok(true)` when updates were downloaded
/// and installed, `Ok(false)` when the app is current (or this is not
/// a Store build — no WinRT touch at all).
///
/// # Errors
/// String error carrying the Store API failure text (logged by the
/// scheduler; auto-update is best-effort, never a user-facing error).
pub fn check_and_install_updates() -> Result<bool, String> {
    use windows::Services::Store::StorePackageUpdate;

    if !is_store_signed() {
        return Ok(false);
    }
    // WinRT on a background thread: MTA apartment guard (the apps.rs
    // pattern — balanced CoUninitialize on drop).
    let _com = MtaGuard::init()?;

    let context =
        StoreContext::GetDefault().map_err(|e| format!("StoreContext::GetDefault: {e}"))?;
    let updates_op = context
        .GetAppAndOptionalStorePackageUpdatesAsync()
        .map_err(|e| format!("GetAppAndOptionalStorePackageUpdatesAsync: {e}"))?;
    let updates = wait_updates(&updates_op)?;

    let count = updates.Size().map_err(|e| format!("Size: {e}"))?;
    if count == 0 {
        return Ok(false);
    }

    // IVectorView<T> is an IIterable<T> in the WinRT type system; the
    // cast is a hierarchy QueryInterface (always succeeds).
    let iterable = updates
        .cast::<windows_collections::IIterable<StorePackageUpdate>>()
        .map_err(|e| format!("IIterable cast: {e}"))?;
    let install_op = context
        .RequestDownloadAndInstallStorePackageUpdatesAsync(&iterable)
        .map_err(|e| format!("RequestDownloadAndInstallStorePackageUpdatesAsync: {e}"))?;
    wait_install(&install_op)?;
    Ok(true)
}

/// Poll the updates query (plain operation) to completion.
fn wait_updates(
    op: &windows_future::IAsyncOperation<
        windows_collections::IVectorView<windows::Services::Store::StorePackageUpdate>,
    >,
) -> Result<windows_collections::IVectorView<windows::Services::Store::StorePackageUpdate>, String>
{
    loop {
        let status = op.Status().map_err(|e| format!("Status: {e}"))?;
        match status {
            windows_future::AsyncStatus::Completed => break,
            windows_future::AsyncStatus::Started => {
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            other => return Err(format!("store operation failed (status {other:?})")),
        }
    }
    op.GetResults()
        .map_err(|e| format!("store operation failed: {e}"))
}

/// Poll the download+install operation (with progress) to completion.
fn wait_install(
    op: &windows_future::IAsyncOperationWithProgress<
        windows::Services::Store::StorePackageUpdateResult,
        windows::Services::Store::StorePackageUpdateStatus,
    >,
) -> Result<(), String> {
    loop {
        let status = op.Status().map_err(|e| format!("Status: {e}"))?;
        match status {
            windows_future::AsyncStatus::Completed => break,
            windows_future::AsyncStatus::Started => {
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
            other => return Err(format!("store install failed (status {other:?})")),
        }
    }
    op.GetResults()
        .map_err(|e| format!("store install failed: {e}"))
        .map(|_| ())
}

/// COM MTA initialization guard (the apps.rs `ComGuard` pattern —
/// duplicated here because that one is private to `apps`).
struct MtaGuard;

impl MtaGuard {
    /// Initialize COM MTA on this thread; S_FALSE is fine.
    ///
    /// # Errors
    /// String error when `CoInitializeEx` refuses.
    fn init() -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        // SAFETY: no apartment-sensitive state is being carried across
        // this call; balanced by Drop exactly once per success.
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_err() {
            return Err(format!("CoInitializeEx: {hr}"));
        }
        Ok(Self)
    }
}

impl Drop for MtaGuard {
    fn drop(&mut self) {
        // SAFETY: balances this guard's CoInitializeEx exactly once.
        unsafe { windows::Win32::System::Com::CoUninitialize() };
    }
}
