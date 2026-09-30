//! Shell-delete integration proof (session 13): the REAL IFileOperation
//! pipeline against REAL files on REAL disk — the disk-level test the
//! owner asked for ("test all of these realtime on cl/actions").
//!
//! Windows-only (the whole pipeline is Windows COM): the file compiles
//! to nothing on other hosts.
//!
//! What this proves, beyond the unit suite:
//! 1. **The headless-flags root cause fix.** These tests run on the
//!    plain cargo test-harness thread — NO message pump, exactly like
//!    `spawn_blocking`. Pre-v3 (no FOF_NOCONFIRMMENT/SILENT/NOERRORUI)
//!    this environment made IFileOperation raise shell UI on a thread
//!    that cannot pump messages, so the operation silently failed —
//!    the "Move to Recycle Bin does nothing" report. A green test here
//!    IS the regression proof.
//! 2. **Recycle lands in the bin** (SHQueryRecycleBin count rises).
//! 3. **Permanent skips the bin** (count unchanged, file gone).
//! 4. The owner's edge cases: nested folder+file staged together, the
//!    same file staged twice, already-missing items, protected items.

#![cfg(windows)]
// SAFETY discipline parity with the src tree (unsafe_code=warn +
// clippy -D warnings): the two probes below carry their own SAFETY
// comments; the crate lint is allowed here for the same reason the
// recycle/COM modules allow it — the Win32 boundary is reviewed as a
// unit.
#![allow(unsafe_code)]

use diskbytes_lib::recycle::{delete_permanently, move_to_recycle_bin, StagedPath};
use std::sync::{Mutex, MutexGuard, PoisonError};
use windows::core::PCWSTR;
use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};

/// The destructive-pipeline tests share ONE physical Recycle Bin and
/// ONE probe API — parallel execution raced the count probes (the
/// permanent test's "unchanged" assertion saw a sibling test's
/// recycled item land mid-window). Serial execution is the honest
/// contract for destructive integration tests anyway; the whole file
/// runs in ~2 s.
static BIN_SERIAL: Mutex<()> = Mutex::new(());

/// Take the shared serial lock (held for the test's body).
fn lock_bin() -> MutexGuard<'static, ()> {
    BIN_SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
}

fn staged(id: u32, path: &str, size: u64, protected: bool) -> StagedPath {
    StagedPath {
        id,
        path: path.to_string(),
        size,
        protected,
    }
}

/// Unique per-test scratch root (parallel tests never collide).
fn scratch(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir()
        .join(format!("db-shell-delete-{}", std::process::id()))
        .join(name);
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("scratch dir");
    root
}

/// Count items in the C: Recycle Bin (best-effort: `None` when the
/// query is unavailable — the DISK assertions are the hard requirements,
/// the count is the bin-destination proof when the API answers).
fn bin_count() -> Option<i64> {
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };
    let root: Vec<u16> = "C:\\".encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: NUL-terminated root path; info sized to its own cbSize
    // contract; the out-struct is fully initialized above.
    match unsafe { SHQueryRecycleBinW(PCWSTR(root.as_ptr()), &mut info) } {
        Ok(()) => Some(info.i64NumItems),
        Err(e) => {
            eprintln!("note: SHQueryRecycleBinW unavailable ({e}) — bin-count assertion skipped");
            None
        }
    }
}

/// Write a real file with real content (IFileOperation behaves the same
/// for any size; content keeps the bin copy honest).
fn write_file(path: &std::path::Path, bytes: usize) {
    std::fs::write(path, vec![0x5Au8; bytes]).expect("write scratch file");
}

#[test]
fn recycle_moves_a_real_file_to_the_real_bin() {
    let _serial = lock_bin();
    let root = scratch("recycle-file");
    let file = root.join("recycle-me.bin");
    write_file(&file, 4096);
    let path = file.to_string_lossy().into_owned();

    let before = bin_count();
    let outcome =
        move_to_recycle_bin(vec![staged(1, &path, 4096, false)]).expect("recycle pipeline");
    let after = bin_count();

    // The disk is the authority: the file is GONE.
    assert!(!file.exists(), "recycled file still on disk");
    assert!(
        outcome.failed.is_empty(),
        "no failures expected: {:?}",
        outcome.failed
    );
    assert_eq!(outcome.trashed.len(), 1);
    assert_eq!(outcome.trashed[0].path, path);
    assert!(!outcome.trashed[0].already_gone);
    assert!(!outcome.trashed[0].nested);

    // The bin actually received it (when the count API is available).
    if let (Some(b), Some(a)) = (before, after) {
        assert!(a > b, "recycle bin count did not rise ({b} -> {a})");
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn permanent_delete_removes_without_touching_the_bin() {
    let _serial = lock_bin();
    let root = scratch("permanent-file");
    let file = root.join("gone-forever.bin");
    write_file(&file, 8192);
    let path = file.to_string_lossy().into_owned();

    let before = bin_count();
    let outcome =
        delete_permanently(vec![staged(1, &path, 8192, false)]).expect("permanent pipeline");
    let after = bin_count();

    assert!(!file.exists(), "permanently deleted file still on disk");
    assert!(
        outcome.failed.is_empty(),
        "no failures expected: {:?}",
        outcome.failed
    );
    assert_eq!(outcome.trashed.len(), 1, "one trashed entry (accounting)");

    // THE differentiator: nothing landed in the bin.
    if let (Some(b), Some(a)) = (before, after) {
        assert_eq!(a, b, "permanent delete changed the bin count ({b} -> {a})");
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn recycle_moves_a_real_folder_with_its_children() {
    let _serial = lock_bin();
    let root = scratch("recycle-folder");
    let folder = root.join("staged-folder");
    std::fs::create_dir_all(&folder).expect("folder");
    write_file(&folder.join("inner-a.bin"), 1024);
    write_file(&folder.join("inner-b.bin"), 2048);
    let folder_path = folder.to_string_lossy().into_owned();
    let inner_path = folder.join("inner-a.bin").to_string_lossy().into_owned();

    // The owner's edge case: the FOLDER and a file INSIDE it are both
    // staged (two different surfaces).
    let outcome = move_to_recycle_bin(vec![
        staged(1, &folder_path, 3072, false),
        staged(0, &inner_path, 1024, false),
    ])
    .expect("recycle pipeline");

    assert!(!folder.exists(), "recycled folder still on disk");
    assert!(
        outcome.failed.is_empty(),
        "no failures expected: {:?}",
        outcome.failed
    );
    // One shell move + the nested path re-joins `trashed` for honest
    // queue accounting.
    assert_eq!(outcome.trashed.len(), 2);
    let nested = outcome
        .trashed
        .iter()
        .find(|t| t.path.eq_ignore_ascii_case(&inner_path))
        .expect("nested item accounted");
    assert!(nested.nested, "the inner file must be marked nested");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn the_same_file_staged_twice_is_moved_once() {
    let _serial = lock_bin();
    let root = scratch("dupe-stage");
    let file = root.join("twice.bin");
    write_file(&file, 512);
    let path = file.to_string_lossy().into_owned();

    // The owner's edge case: same path through two queue identities
    // (inspector id vs path-only id 0).
    let outcome = move_to_recycle_bin(vec![
        staged(7, &path, 512, false),
        staged(0, &path, 512, false),
    ])
    .expect("recycle pipeline");

    assert!(!file.exists(), "file still on disk");
    assert!(
        outcome.failed.is_empty(),
        "no failures expected: {:?}",
        outcome.failed
    );
    // Both queue rows clear: the duplicate re-joins trashed (nested).
    assert_eq!(
        outcome.trashed.len(),
        2,
        "both staged rows accounted: {:?}",
        outcome.trashed
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_missing_file_counts_as_already_gone() {
    let _serial = lock_bin();
    let root = scratch("missing");
    let path = root
        .join("never-existed.bin")
        .to_string_lossy()
        .into_owned();

    let outcome = move_to_recycle_bin(vec![staged(1, &path, 10, false)]).expect("recycle pipeline");

    assert!(outcome.failed.is_empty(), "missing is not a failure");
    assert_eq!(outcome.trashed.len(), 1);
    assert!(outcome.trashed[0].already_gone, "counted as already gone");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn protected_items_are_refused_before_any_shell_move() {
    let _serial = lock_bin();
    let root = scratch("protected");
    let file = root.join("protected.bin");
    write_file(&file, 256);
    let path = file.to_string_lossy().into_owned();

    let outcome = move_to_recycle_bin(vec![staged(1, &path, 256, true)]).expect("recycle pipeline");

    // Refused with a readable reason — and the file is untouched.
    assert_eq!(outcome.trashed.len(), 0);
    assert_eq!(outcome.failed.len(), 1);
    assert!(outcome.failed[0].reason.contains("protected"));
    assert!(file.exists(), "protected file must not be touched");
    let _ = std::fs::remove_dir_all(&root);
}

// ── Applications icon pipeline (session 13) ──────────────────────────
// The end-to-end mechanism proofs on real Windows: the registry icon
// extraction (SHGetFileInfoW → PNG data URL) on a real system binary,
// the DisplayIcon-absent fallback (find_main_exe), and the shell
// Apps-folder enumeration contract (no-op with no families; no panic
// with unknown ones; any REAL match must be a valid PNG data URL —
// the CI images carry varying Store-app sets, so presence is
// best-effort, validity is hard).

#[test]
fn registry_icon_pipeline_extracts_a_real_exe_icon() {
    let url = diskbytes_lib::apps_test_probe::icon_png_data_url(r"C:\Windows\System32\notepad.exe");
    let Some(url) = url else {
        panic!("SHGetFileInfoW icon extraction failed on a real system exe");
    };
    assert!(
        url.starts_with("data:image/png;base64,"),
        "not a PNG data URL: {}",
        &url[..40.min(url.len())]
    );
    // The decoded payload must carry the PNG magic.
    let b64 = &url["data:image/png;base64,".len()..];
    let bytes = b64_decode(b64);
    assert!(bytes.len() > 8);
    assert_eq!(&bytes[..4], b"\x89PNG", "decoded payload is not a PNG");
}

#[test]
fn find_main_exe_fallback_finds_a_system_exe() {
    let hit = diskbytes_lib::apps_test_probe::find_main_exe(r"C:\Windows\System32", "notepad");
    assert!(hit.is_some(), "no exe found under System32");
    let p = hit.expect("checked");
    assert!(p.to_lowercase().ends_with(".exe"));
}

#[test]
fn msix_icon_pipeline_contract_holds() {
    use diskbytes_lib::apps_test_probe::msix_icon_data_urls;
    // No families → no work, no panic.
    assert!(msix_icon_data_urls(&[]).is_empty());
    // Unknown families → empty (never a fake), no panic. A few common
    // Store families so real runners with Store components can land a
    // positive; unknown ones stay absent honestly.
    let probes = vec![
        "Microsoft.WindowsCalculator_8wekyb3d8bbwe".to_string(),
        "Microsoft.WindowsNotepad_8wekyb3d8bbwe".to_string(),
        "Definitely.Not.Installed_0000000000000".to_string(),
    ];
    let map = msix_icon_data_urls(&probes);
    for (k, v) in &map {
        assert!(
            probes.iter().any(|p| p.eq_ignore_ascii_case(k)),
            "unexpected key {k}"
        );
        assert!(v.starts_with("data:image/png;base64,"), "non-PNG for {k}");
        let bytes = b64_decode(&v["data:image/png;base64,".len()..]);
        assert_eq!(
            &bytes[..4],
            b"\x89PNG",
            "decoded payload for {k} is not a PNG"
        );
    }
}

/// Minimal standard base64 decode (test-only; the production path uses
/// the core crate's encoder in the other direction).
fn b64_decode(s: &str) -> Vec<u8> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        if c == b'=' {
            break;
        }
        let Some(v) = TABLE.iter().position(|&t| t == c) else {
            continue;
        };
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    out
}
