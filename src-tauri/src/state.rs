//! App state (spec §4): the finished tree is `Arc<Tree>` behind an
//! `RwLock`; IPC commands take a read lock. Scan replacement drops the
//! old `Arc` on a background thread so the UI never stalls freeing a
//! million nodes. Every tree request carries the scan **generation**.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use diskbytes_core::scan::node::Tree;
use diskbytes_core::scan::scanner::Progress;
use parking_lot::{Mutex, RwLock};

use crate::commands::dupes::{DupesProgress, DupesResult};

/// The live progress sink the scanner updates once per directory batch
/// (spec §4); the 150 ms ticker and `get_status` read it.
pub type ProgressSink = Arc<Mutex<Progress>>;

/// Control over the one running scan (starting a new scan cancels the
/// old — spec §4).
pub struct ScanHandle {
    /// The generation this scan writes (kept for `get_status` /
    /// future cancel-status reporting).
    #[allow(dead_code)]
    pub generation: u64,
    /// Cancel flag shared with the scanner workers.
    pub cancel: Arc<AtomicBool>,
    /// The scan thread (joins itself into the state swap; never joined
    /// from the command layer — cancellation is cooperative).
    #[allow(dead_code)]
    pub join: Option<std::thread::JoinHandle<()>>,
}

/// The sticky outcome of the last COMPLETED scan (not cancellations):
/// the UI reconciles against it because a `scan-done` event can fire
/// before the `start_scan` round-trip resolves (tiny trees finish in
/// milliseconds — the event lands while the store still holds the old
/// generation and gets dropped as stale). `get_status` replays it.
#[derive(Debug, Clone, Default)]
pub struct DoneRecord {
    /// The generation that finished.
    pub generation: u64,
    /// Final stats (logical, onDisk, files, folders).
    pub stats: Option<(u64, u64, u64, u64)>,
    /// Terminal error, if the scan failed.
    pub error: Option<String>,
}

/// App-lifetime duplicates-scan state (the "page switch killed my
/// scan" fix): the pipeline runs on a background task while THIS
/// record lives in `AppState`, so any tab can re-attach at any time
/// via `dupes_status` — the scan, its live progress and the sticky
/// last result survive every view mount/unmount cycle. The old design
/// kept all of it in the DuplicatesView's component state; leaving the
/// tab orphaned a running multi-GB hash and showed "Start scan"
/// again over a pipeline that was still hashing.
#[derive(Debug, Clone, Default)]
pub struct DupesStatus {
    /// A pipeline is running (a fresh `find_duplicates` is rejected
    /// while true; cancel + terminal resolution clear it).
    pub running: bool,
    /// The tree generation the run (or sticky result) belongs to.
    pub generation: u64,
    /// The last ticker snapshot (valid while running; the terminal
    /// phase — `done` / `cancelled` — after resolution).
    pub progress: Option<DupesProgress>,
    /// The sticky last result (kept until a new run or tree change).
    pub result: Option<DupesResult>,
    /// Terminal error, if the last run failed (cancellations excluded).
    pub error: Option<String>,
}

/// How many finished trees the flip cache keeps (the current tree is
/// NOT one of them — only trees displaced by a different-target scan).
/// Three covers the realistic mix: This PC + two drives, or three
/// drives; each entry is bounded by whatever the user actually
/// scanned, and evictions drop on a background thread.
pub const TREE_CACHE_CAPACITY: usize = 3;

/// The flip-cache key for a scan target: the same normalization the
/// scan layer's `parse_target` applies, plus the identity the CACHE
/// needs — Windows paths are case-insensitive so the key lowercases
/// (ASCII only: drive letters and separator shape; full Unicode case
/// folding on Windows paths is locale-dependent and deliberately out
/// of scope), macOS paths are case-sensitive so they fold verbatim,
/// and every "This PC" spelling collapses to one key. The key must be
/// a pure function of the target — same input, same key — so a chip's
/// `"C:\"` and a picked `"c:"` file the SAME cache entry.
#[must_use]
pub fn tree_cache_key(target: &str) -> String {
    if target.eq_ignore_ascii_case("thispc") || target.eq_ignore_ascii_case("this pc") {
        return "thispc".into();
    }
    let trimmed = target.trim_end_matches(['\\', '/']);
    if cfg!(target_os = "macos") {
        format!("{trimmed}/")
    } else {
        format!("{}\\", trimmed.to_ascii_lowercase())
    }
}

/// One cached scan result (session 14, the drive-flip fix): the tree a
/// PREVIOUS scan of this target built, kept so switching back to the
/// target is instant instead of a full rescan (the owner's C:→D:→C:
/// report — every flip re-scanned because the swap DISCARDED the old
/// tree). Entries are `Arc` snapshots: long-lived readers (a running
/// duplicates pipeline) keep reading the tree they latched, exactly
/// like the pre-cache behavior where their clone outlived the swap.
///
/// INVARIANT: the CURRENT tree (the one in `AppState::tree`) is never
/// also a cache entry — entries are pushed only when a swap displaces
/// a tree. That makes surgery interplay trivial: tree surgery only
/// ever produces a descendant of the CURRENT tree, and the cache holds
/// only OTHER targets' trees, which surgery cannot touch (cleanup
/// stages nodes visible in the current tree only).
#[derive(Debug, Default)]
pub struct TreeCache {
    /// LRU order: front = most recently pushed. Guarded by its own
    /// mutex; every operation is O(capacity).
    entries: Mutex<VecDeque<TreeCacheEntry>>,
}

/// One entry: the normalized target key + the tree it produced.
#[derive(Debug, Clone)]
struct TreeCacheEntry {
    key: String,
    tree: Arc<Tree>,
}

impl TreeCache {
    /// Remove and return the entry for `key` (a restore is a HIT: the
    /// tree leaves the cache and becomes the current tree, keeping the
    /// current-tree-never-cached invariant).
    pub fn take(&self, key: &str) -> Option<Arc<Tree>> {
        let mut guard = self.entries.lock();
        if let Some(pos) = guard.iter().position(|e| e.key == key) {
            guard.remove(pos).map(|e| e.tree)
        } else {
            None
        }
    }

    /// Insert (or replace) the entry for `key`; returns the LRU entry
    /// evicted by this insertion, if any, so the caller can drop it on
    /// a background thread (a million-node dealloc never touches the
    /// UI thread — same discipline as the tree swap).
    pub fn insert(&self, key: String, tree: Arc<Tree>) -> Option<Arc<Tree>> {
        let mut guard = self.entries.lock();
        // Replace-in-place keeps the key's position; a fresh key goes
        // to the FRONT (most recently used).
        if let Some(existing) = guard.iter_mut().find(|e| e.key == key) {
            existing.tree = tree;
            return None;
        }
        guard.push_front(TreeCacheEntry { key, tree });
        if guard.len() > TREE_CACHE_CAPACITY {
            guard.pop_back().map(|e| e.tree)
        } else {
            None
        }
    }

    /// Number of entries (assertions in tests).
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.lock().len()
    }

    /// True when no entries are cached (assertions in tests).
    #[cfg(test)]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.lock().is_empty()
    }
}

/// Shared application state managed by Tauri.
pub struct AppState {
    /// The finished tree (`None` before the first scan completes).
    pub tree: RwLock<Option<Arc<Tree>>>,
    /// Monotonic scan generation (IPC staleness contract).
    pub generation: AtomicU64,
    /// The running scan, if any.
    pub scan: Mutex<Option<ScanHandle>>,
    /// Generation-owned scanning flag: `0` = idle, otherwise the
    /// generation of the running scan. A bare `AtomicBool` could not
    /// distinguish "the scan that just exited" from "the newer scan
    /// that superseded it": a superseded worker storing `false` killed
    /// the NEW scan's progress ticker and made `get_status` lie for the
    /// whole scan. Workers clear ONLY their own generation
    /// (compare_exchange), so a superseded exit can never clobber a
    /// successor's running state.
    pub scanning: AtomicU64,
    /// The live progress snapshot (valid while `scanning != 0`).
    pub progress: ProgressSink,
    /// The last completed scan's outcome (see `DoneRecord` — the
    /// lost-event reconcile path; written by the scan thread before
    /// the `scan-done` emit, read by `get_status`).
    pub last_done: Mutex<DoneRecord>,
    /// Duplicates-run cancel generation (see `commands::dupes`):
    /// `cancel_duplicates` bumps it; a run latches the value at start
    /// and reports cancelled once the counter moves. Shared as an
    /// `Arc` so the blocking pipeline can read it without borrowing
    /// the state.
    pub dupes_cancel: Arc<AtomicU64>,
    /// App-lifetime duplicates state (see [`DupesStatus`]) — the
    /// queryable half of the page-switch fix.
    pub dupes_status: Arc<Mutex<DupesStatus>>,
    /// The target-key flip cache (session 14 — see [`TreeCache`]).
    /// Lives in the state so `start_scan` can restore instantly.
    pub tree_cache: TreeCache,
    /// The cache key of the tree currently in the `tree` slot
    /// ("" before the first scan). Tracked so a swap can file the
    /// DISPLACED tree into the cache under the key it was scanned
    /// with — the symmetric flip (C:→D:→C:) restores both directions.
    pub target_key: Mutex<String>,
}

impl AppState {
    /// Fresh state at generation 1 (the first scan takes it).
    #[must_use]
    pub fn new() -> Self {
        Self {
            tree: RwLock::new(None),
            generation: AtomicU64::new(1),
            scan: Mutex::new(None),
            scanning: AtomicU64::new(0),
            progress: Arc::new(Mutex::new(Progress::default())),
            last_done: Mutex::new(DoneRecord::default()),
            dupes_cancel: Arc::new(AtomicU64::new(0)),
            dupes_status: Arc::new(Mutex::new(DupesStatus::default())),
            tree_cache: TreeCache::default(),
            target_key: Mutex::new(String::new()),
        }
    }

    /// The current generation for request tagging.
    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Mark `generation` as the running scan (idempotent for the same
    /// generation; never overwrites a different running generation —
    /// callers only mark a generation they freshly allocated).
    pub fn mark_scanning(&self, generation: u64) {
        self.scanning.store(generation, Ordering::SeqCst);
    }

    /// True while a scan is running.
    pub fn is_scanning(&self) -> bool {
        self.scanning.load(Ordering::SeqCst) != 0
    }

    /// Clear the running flag ONLY when it still names `generation`
    /// (a superseded worker's exit must not clobber a successor).
    pub fn end_scanning(&self, generation: u64) {
        self.scanning
            .compare_exchange(generation, 0, Ordering::SeqCst, Ordering::SeqCst)
            .ok();
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{tree_cache_key, AppState, TreeCache, TREE_CACHE_CAPACITY};

    /// A tree the tests can identify: `Tree::new(gen)` is empty (arena
    /// = one root node); identity is the Arc pointer.
    fn tree(gen: u64) -> std::sync::Arc<diskbytes_core::scan::node::Tree> {
        std::sync::Arc::new(diskbytes_core::scan::node::Tree::new(gen))
    }

    #[test]
    fn cache_key_is_stable_across_spellings() {
        // The chip's "C:\", a picked "c:", and a double-slashed variant
        // must file ONE cache entry (the restore is keyed by identity,
        // not spelling). The host (linux CI) and Windows share the
        // lowercase+backslash family; macOS folds verbatim with "/".
        #[cfg(target_os = "macos")]
        {
            assert_eq!(tree_cache_key("/"), "/");
            assert_eq!(tree_cache_key("/Users/me/"), "/Users/me/");
            assert_eq!(tree_cache_key("/users/ME"), "/users/ME/");
            assert_eq!(tree_cache_key("C:\\"), "C:/");
        }
        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(tree_cache_key("C:\\"), "c:\\");
            assert_eq!(tree_cache_key("c:"), "c:\\");
            assert_eq!(tree_cache_key("C:\\\\"), "c:\\");
            assert_eq!(tree_cache_key("C:\\Users"), "c:\\users\\");
            assert_eq!(tree_cache_key("c:\\users\\me\\"), "c:\\users\\me\\");
        }
    }

    #[test]
    fn cache_key_collapses_this_pc_spellings() {
        assert_eq!(tree_cache_key("ThisPC"), "thispc");
        assert_eq!(tree_cache_key("this pc"), "thispc");
        assert_eq!(tree_cache_key("THIS PC"), "thispc");
        assert_eq!(tree_cache_key("ThisPc"), "thispc");
    }

    #[test]
    fn cache_take_misses_then_hits() {
        let cache = TreeCache::default();
        assert!(cache.take("c:\\").is_none(), "empty cache must miss");
        let t = tree(1);
        cache.insert("c:\\".into(), std::sync::Arc::clone(&t));
        let got = cache.take("c:\\").expect("inserted key must hit");
        assert!(std::sync::Arc::ptr_eq(&t, &got), "the SAME Arc comes back");
        assert!(
            cache.take("c:\\").is_none(),
            "a take REMOVES the entry (the tree becomes current)"
        );
    }

    #[test]
    fn cache_insert_replaces_same_key_without_evicting() {
        let cache = TreeCache::default();
        cache.insert("c:\\".into(), tree(1));
        cache.insert("d:\\".into(), tree(2));
        cache.insert("c:\\".into(), tree(3));
        assert_eq!(
            cache.len(),
            2,
            "a same-key insert replaces, never grows the cache"
        );
        assert!(cache.take("c:\\").is_some());
        // The replacement won: the second c:\ tree is what remains...
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn cache_evicts_lru_at_capacity() {
        let cache = TreeCache::default();
        for (i, key) in ["a:\\", "b:\\", "c:\\"].into_iter().enumerate() {
            let evicted = cache.insert(key.into(), tree(u64::try_from(i).unwrap_or(0)));
            assert!(evicted.is_none(), "no eviction under capacity");
        }
        // Inserting a 4th evicts the LEAST recently used ("a:\\"), and
        // hands the displaced Arc back for the background drop.
        let evicted = cache
            .insert("d:\\".into(), tree(9))
            .expect("capacity eviction");
        drop(evicted);
        assert_eq!(cache.len(), TREE_CACHE_CAPACITY);
        assert!(cache.take("a:\\").is_none(), "the LRU key was evicted");
        assert!(cache.take("d:\\").is_some(), "the new key is present");
    }

    #[test]
    fn cache_take_refreshes_nothing_but_stays_consistent() {
        // The take-then-insert dance a drive flip performs: after a
        // flip the DISPLACED tree re-enters under ITS key, so both
        // directions of C:↔D: keep restoring.
        let cache = TreeCache::default();
        cache.insert("c:\\".into(), tree(1));
        let _c = cache.take("c:\\");
        cache.insert("d:\\".into(), tree(2));
        cache.insert("c:\\".into(), tree(3));
        assert_eq!(cache.len(), 2);
        assert!(cache.take("d:\\").is_some());
        assert!(cache.take("c:\\").is_some());
    }

    #[test]
    fn app_state_carries_the_cache_and_key() {
        let state = AppState::new();
        assert!(state.tree_cache.is_empty());
        assert_eq!(*state.target_key.lock(), "");
    }
}
