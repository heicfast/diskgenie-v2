//! Cleanup commit commands (spec §9; doc 03 M5): the SAFETY-CRITICAL
//! flow — pre-flight + shell delete (Recycle Bin or owner-sanctioned
//! permanent, session 13) on a background thread, then in-memory tree
//! surgery (no rescan), cache clears, generation bump,
//! navigation/selection fixups and the `cleanup-committed` event.
//!
//! Recycle remains the default (`recycle::move_to_recycle_bin`);
//! permanent delete is the owner-sanctioned "Delete permanently"
//! popover action (`recycle::delete_permanently`) — both verified
//! against the disk post-operation (see `recycle.rs`).

use std::sync::Arc;

use diskbytes_core::scan::node::Tree;
use diskbytes_core::scan::surgery;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::recycle::{self, DeleteMode, StagedPath};
use crate::state::AppState;

/// One staged item from the JS queue (spec §9 shape).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitItem {
    /// Real node id (0 = path-only item).
    pub id: u32,
    /// Display path.
    pub path: String,
    /// Size on disk.
    pub size: u64,
    /// Stage reason (kept for queue parity; unused by the commit path).
    #[allow(dead_code)]
    pub reason: String,
}

/// The `cleanup-committed` payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCommitted {
    /// New tree generation (the UI re-keys every cache on it).
    pub generation: u64,
    /// Recycled items (incl. already-gone + nested).
    pub trashed: Vec<recycle::TrashedItem>,
    /// Refused items with reasons.
    pub failed: Vec<recycle::FailedItem>,
    /// Root stats after surgery (logical, on_disk, files, folders).
    pub stats: Option<(u64, u64, u64, u64)>,
    /// UI fixups: where navigation/selection landed after removal.
    pub current_folder: u32,
    pub selected_node: Option<u32>,
}

/// Commit the staged queue to the Recycle Bin (spec §9): pre-flight
/// refusals → IFileOperation → tree surgery without rescan.
///
/// `current_folder`/`selected_node` are the UI's live navigation (the
/// surgery may REMOVE the folder on screen — the response carries the
/// fixup so the frontend lands on a survivor instead of a dead node).
///
/// # Errors
/// String error when the generation is stale or COM setup fails;
/// per-item problems land in the response's `failed` list.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // State extraction is the tauri command contract
pub async fn commit_cleanup(
    generation: u64,
    items: Vec<CommitItem>,
    current_folder: Option<u32>,
    selected_node: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
    license: State<'_, crate::commands::license::LicenseManager>,
    analytics: State<'_, crate::analytics::Analytics>,
) -> Result<CleanupCommitted, String> {
    commit_shell_delete(
        generation,
        items,
        current_folder,
        selected_node,
        DeleteMode::Recycle,
        state,
        app,
        license,
        analytics,
    )
    .await
}

/// Permanently delete the staged queue (owner decision, session 13 —
/// the popover's "Delete permanently" action): the same pre-flight +
/// tree-surgery lifecycle, WITHOUT the undo/recycle flags.
///
/// # Errors
/// String error when the generation is stale or COM setup fails;
/// per-item problems land in the response's `failed` list.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // State extraction is the tauri command contract
pub async fn delete_permanently(
    generation: u64,
    items: Vec<CommitItem>,
    current_folder: Option<u32>,
    selected_node: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
    license: State<'_, crate::commands::license::LicenseManager>,
    analytics: State<'_, crate::analytics::Analytics>,
) -> Result<CleanupCommitted, String> {
    commit_shell_delete(
        generation,
        items,
        current_folder,
        selected_node,
        DeleteMode::Permanent,
        state,
        app,
        license,
        analytics,
    )
    .await
}

/// The shared commit lifecycle for BOTH delete modes: gate → resolve →
/// shell delete (disk-verified) → surgery → swap → caches → event.
/// The ordering invariants are documented in-body (same posture as
/// start_scan/start_scan_turbo).
#[allow(clippy::too_many_lines)]
#[allow(clippy::needless_pass_by_value)] // State extraction is the tauri command contract
async fn commit_shell_delete(
    generation: u64,
    items: Vec<CommitItem>,
    current_folder: Option<u32>,
    selected_node: Option<u32>,
    mode: DeleteMode,
    state: State<'_, AppState>,
    app: AppHandle,
    license: State<'_, crate::commands::license::LicenseManager>,
    analytics: State<'_, crate::analytics::Analytics>,
) -> Result<CleanupCommitted, String> {
    // The hard license gate (docs §2 L6; no free tier — owner decision,
    // session 10): unlicensed/degraded refuse, PRO/grace commit.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(0));
    crate::commands::license::require_licensed(&license, now)?;
    // Queue total (telemetry only — the cap itself is gone).
    let queue_total: u64 = items.iter().map(|i| i.size).sum();

    // Resolve the tree + protected flags under a short lock, then work
    // on the snapshot.
    let tree = {
        let guard = state.tree.read();
        let Some(tree) = guard.as_ref() else {
            return Err("no scan yet".into());
        };
        if tree.generation != generation {
            return Err(format!(
                "stale generation {} (current {})",
                generation, tree.generation
            ));
        }
        Arc::clone(tree)
    };

    // Join tree flags (protected) onto the staged paths.
    let staged: Vec<StagedPath> = items
        .into_iter()
        .map(|i| {
            let protected = tree
                .node(i.id)
                .is_some_and(|n| n.is_protected() || n.is_cloud_placeholder());
            // Path-less synthetic entries are refused outright (never
            // attempt a meaningless shell move).
            let empty_path = i.path.is_empty();
            StagedPath {
                id: i.id,
                path: i.path,
                size: i.size,
                protected: protected || empty_path,
            }
        })
        .collect();

    // The shell delete runs on the blocking pool (COM thread) — the
    // mode selects recycle vs permanent (owner-sanctioned, session 13).
    let outcome = tauri::async_runtime::spawn_blocking(move || match mode {
        DeleteMode::Recycle => recycle::move_to_recycle_bin(staged),
        DeleteMode::Permanent => recycle::delete_permanently(staged),
    })
    .await
    .map_err(|e| format!("cleanup thread failed: {e}"))??;

    // Engine telemetry (doc 07 §4): counts only, never paths.
    analytics.capture(
        if mode == DeleteMode::Permanent {
            "cleanup_deleted_permanently"
        } else {
            "cleanup_committed"
        },
        &[
            ("items", serde_json::json!(outcome.trashed.len())),
            ("bytes", serde_json::json!(queue_total)),
            ("failed", serde_json::json!(outcome.failed.len())),
        ],
    );

    // Path→id resolution + CoW surgery run on the blocking pool: the
    // arena scan per trashed item is O(items × arena) and the deep copy
    // is O(arena) — neither belongs on the async runtime thread (they
    // would stall every other concurrent command).
    let trashed_paths: Vec<String> = outcome.trashed.iter().map(|t| t.path.clone()).collect();
    let tree_for_surgery = Arc::clone(&tree);
    let nav_folder = current_folder.unwrap_or(0);
    let nav_selection = selected_node;
    let surgery_result = tauri::async_runtime::spawn_blocking(move || {
        // Tree surgery for every successfully recycled REAL node
        // (path-only items like leftovers have no node to remove).
        let removed_ids: Vec<u32> = trashed_paths
            .iter()
            .map(|p| tree_lookup_id(&tree_for_surgery, p))
            .filter(|&id| id > 0)
            .collect();
        if removed_ids.is_empty() {
            return None;
        }
        // CoW surgery WITHOUT the tree-vanish window: deep-copy
        // OUTSIDE any lock; the caller swaps in under the write
        // lock ONLY when the slot still holds our generation's
        // tree. The old take-then-surgery-then-reinsert left the
        // slot `None` for the whole surgery (concurrent readers
        // spuriously errored "no scan yet", a scan finishing in the
        // window got clobbered by the stale surgery tree, and a
        // panic mid-surgery poisoned the slot forever). The
        // always-copy costs one deep clone per commit — user-rare
        // and off the UI thread; correctness wins.
        let mut owned: Tree = Tree::deep_from(&tree_for_surgery);
        surgery::remove_subtrees(&mut owned, &removed_ids);
        let new_generation = owned.generation;
        let stats_after = owned.root_stats();
        // UI fixups against the REAL live navigation (session 13: the
        // frontend now sends its current folder + selection — the old
        // call hard-wired 0, so a commit that removed the ON-SCREEN
        // folder left the view pointed at a dead node): the removed
        // navigation point walks up to a survivor, a removed selection
        // clears.
        let fixed_folder = surgery::fixup_navigation(&owned, nav_folder);
        let fixed_selection = nav_selection.filter(|&id| !surgery::node_gone(&owned, id));
        Some((
            owned,
            new_generation,
            stats_after,
            fixed_folder,
            fixed_selection,
        ))
    })
    .await
    .map_err(|e| format!("surgery thread failed: {e}"))?;

    let (new_generation, root_stats, fixed_folder, fixed_selection) = match surgery_result {
        None => (
            tree.generation,
            Some(tree.root_stats()),
            nav_folder,
            nav_selection,
        ),
        Some((owned, new_generation, stats_after, fixed_folder, fixed_selection)) => {
            // Swap under the write lock, generation-guarded: a scan that
            // finished while we were surgering owns the slot — its fresh
            // tree (which already reflects the recycled files on disk)
            // wins; our surgically-modified copy is dropped.
            {
                let mut guard = state.tree.write();
                let still_ours = guard.as_ref().is_some_and(|t| t.generation == generation);
                if still_ours {
                    *guard = Some(Arc::new(owned));
                }
            }
            // ONE generation authority: `AppState.generation` must catch
            // up to the surgery-bumped `Tree.generation` or the next
            // start_scan's fetch_add hands out the SAME number the UI
            // now holds (a stale in-flight request tagged N+1 would
            // silently pass the guard against a DIFFERENT new tree) and
            // get_status / consecutive commits mis-report.
            state
                .generation
                .fetch_max(new_generation, std::sync::atomic::Ordering::SeqCst);
            (
                new_generation,
                Some(stats_after),
                fixed_folder,
                fixed_selection,
            )
        }
    };

    // Generation-keyed caches ALL drop (scan-swap path clears the same
    // set — one shared helper, no hand-duplicated list). The apps
    // snapshot additionally refreshes: recycled leftovers shrink the
    // bundle/leftover sizes it reports.
    crate::commands::scan::clear_all_caches(&app);
    app.state::<crate::commands::applications::AppsCache>()
        .clear();

    let payload = CleanupCommitted {
        generation: new_generation,
        trashed: outcome.trashed,
        failed: outcome.failed,
        stats: root_stats,
        current_folder: fixed_folder,
        selected_node: fixed_selection,
    };
    let _ = app.emit("cleanup-committed", &payload);
    Ok(payload)
}

/// Find the node id for a display path (cheap parent-chain walk is not
/// possible without an index; scan the arena once per commit — commits
/// are rare and the arena walk is branch-predictable).
fn tree_lookup_id(tree: &Tree, path: &str) -> u32 {
    if path.is_empty() {
        return 0;
    }
    for (idx, n) in tree.arena.iter().enumerate() {
        if n.is_removed() || n.parent == u32::MAX {
            continue;
        }

        // Full-path compare via the parent-chain walk (no String per node).
        if path_matches(tree, idx, path) {
            return idx as u32;
        }
    }
    0
}

/// Fast full-path equality without building every String: walk the
/// parent chain comparing name slices right-to-left.
///
/// Unicode-correct: tree names are UTF-16 code units; the incoming
/// path is UTF-8. The old per-`char` compare only matched BMP
/// characters — a surrogate pair in the name (emoji, supplementary-
/// plane CJK) never matched its UTF-8 encoding, so those files were
/// recycled but never tree-surgically removed (stale tree until a
/// rescan). Encoding the path to UTF-16 once and comparing units
/// side-by-side fixes every plane.
fn path_matches(tree: &Tree, idx: usize, path: &str) -> bool {
    // Building one String per candidate is wasteful at 1M nodes; the
    // parent-walk compare avoids it: collect ancestor name slices and
    // compare against the path from the end.
    let mut chain: Vec<(usize, usize)> = Vec::with_capacity(8); // (off, len)
    let mut id = idx as u32;
    loop {
        let n = &tree.arena[id as usize];
        chain.push((n.name_off as usize, usize::from(n.name_len)));
        if n.parent == u32::MAX {
            break;
        }
        id = n.parent;
    }
    // Compare the chain (root→leaf) joined by '\' against `path` —
    // both sides as UTF-16 code units.
    let path_units: Vec<u16> = path.encode_utf16().collect();
    let mut consumed = 0usize;
    for (i, (off, len)) in chain.iter().rev().enumerate() {
        if i > 0 {
            match path_units.get(consumed) {
                Some(0x5C) => consumed += 1, // '\'
                _ => return false,
            }
        }
        let name = &tree.names[*off..off + len];
        if path_units.len() < consumed + name.len() {
            return false;
        }
        if path_units[consumed..consumed + name.len()] != *name {
            return false;
        }
        consumed += name.len();
    }
    consumed == path_units.len()
}

/// Open the Recycle Bin folder (the confirmation dialog's link —
/// spec §9 `shell:RecycleBinFolder`).
///
/// # Errors
/// String error when the shell cannot open it.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // State extraction is the tauri command contract
pub fn open_recycle_bin() -> Result<(), String> {
    crate::platform::HostPlatform::open_path("shell:RecycleBinFolder")
}
