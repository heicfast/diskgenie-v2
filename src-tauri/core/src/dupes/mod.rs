//! Duplicate grouping and wasted-space ranking (spec §10; doc 02 §7).
//!
//! The v3 engine (`engine` module — screens + lockstep verification)
//! is core-side so it unit-tests on any host; THIS module owns the
//! pure data logic downstream of it:
//!
//! 1. [`group_by_size`] — bucketing by logical size, dropping
//!    zero-length files (spec: "ignoring zero-length files").
//! 2. [`rank`] — hardlink exclusion by (volume serial, file index)
//!    identity, grouping by (size, verification class),
//!    wasted-space ranking `size × (count − 1)` largest first.
//!
//! The UI consumes [`DupeGroup`]s: "X could be reclaimed across N groups",
//! each group listing files with "Keep this, stage the rest" (the first
//! entry of each group is the natural "keep" anchor).

pub mod engine;

pub use engine::{
    EngineCandidate, EngineConfig, EngineError, ProgressSink, QuietSink, VerifiedFile,
    VerifiedGroup, DEFAULT_PREFIX, DEFAULT_SAMPLE, DEFAULT_VERIFY_BLOCK, PHASE_SCREEN,
    PHASE_VERIFY,
};

use std::collections::HashMap;

/// Minimum size a file must have to be a duplicate candidate (spec §10:
/// zero-length files are ignored — they can never waste space).
pub const MIN_CANDIDATE_SIZE: u64 = 1;

/// One verified file as fed back into the ranking (the engine's
/// verified groups + the app's hardlink identities + tree facts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashedFile {
    /// Display path (the staged reason text uses it verbatim).
    pub path: String,
    /// Logical size in bytes.
    pub size: u64,
    /// Volume serial number from the platform's file-information
    /// query.
    pub volume_serial: u64,
    /// File index from the platform's file-information query (with
    /// the high part on FAT/exFAT already folded in by the caller).
    pub file_index: u64,
    /// Verification class (the engine's group id): files share a
    /// class iff their contents were verified equal. Replaces the
    /// v2 SHA-256 digest — the engine's chain-equality IS the
    /// content equality claim; the class id just names it.
    pub class: u64,
    /// Tree node id (reveal/jump support in the UI).
    pub node_id: u32,
    /// Last-write time (unix seconds; 0 = unknown) — the UI's
    /// keep-newest/oldest smart rules read it.
    pub modified: i64,
}

impl HashedFile {
    /// Hardlink identity: two entries sharing volume serial AND file index
    /// are the same physical file (spec: "hardlinks are not duplicates").
    #[must_use]
    fn hardlink_id(&self) -> (u64, u64) {
        (self.volume_serial, self.file_index)
    }
}

/// One member of a finished duplicate group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DupeFile {
    /// Display path.
    pub path: String,
    /// Tree node id (reveal/jump support in the UI).
    pub node_id: u32,
    /// Last-write time (unix seconds; 0 = unknown) — the UI's
    /// keep-newest/oldest smart rules read it.
    pub modified: i64,
}

/// A finished duplicate group (spec §10 UI contract).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DupeGroup {
    /// Per-file logical size (identical across the group).
    pub size: u64,
    /// `size × (count − 1)` — what staging "the rest" would reclaim.
    pub wasted: u64,
    /// Members; the FIRST entry is the "keep" anchor the UI preselects.
    pub files: Vec<DupeFile>,
}

/// Pass 1 (spec §10): bucket candidate files by logical size.
///
/// Zero-length files are dropped; only buckets with ≥ 2 members survive
/// (a single file of one size is not a duplicate candidate). Order of
/// members inside a bucket follows input order.
#[must_use]
pub fn group_by_size(files: &[HashedFile]) -> Vec<Vec<&HashedFile>> {
    let mut by_size: HashMap<u64, Vec<&HashedFile>> = HashMap::new();
    for f in files {
        if f.size >= MIN_CANDIDATE_SIZE {
            by_size.entry(f.size).or_default().push(f);
        }
    }
    let mut buckets: Vec<Vec<&HashedFile>> = by_size.into_values().collect();
    buckets.retain(|b| b.len() >= 2);
    buckets
}

/// Hardlink exclusion + (size, class) grouping + wasted-space ranking
/// (the v3 ranking pass).
///
/// - Hardlinks: within one size bucket, entries whose
///   `(volume_serial, file_index)` was already seen are dropped —
///   deduplication happens BEFORE grouping so a hardlink pair never
///   forms a group of "duplicates" with itself.
/// - A group survives only with ≥ 2 distinct physical files.
/// - Output is sorted by wasted space, largest first; ties break by
///   size (larger first) then by the first member's path so the order
///   is deterministic for tests and the UI.
#[must_use]
pub fn rank(files: &[HashedFile]) -> Vec<DupeGroup> {
    // Size buckets (zero-length already dropped by group_by_size).
    let mut groups: Vec<DupeGroup> = Vec::new();
    for bucket in group_by_size(files) {
        // Hardlink exclusion inside the bucket.
        let mut seen_hardlinks = std::collections::HashSet::new();
        let mut members: Vec<&HashedFile> = Vec::with_capacity(bucket.len());
        for f in bucket {
            if seen_hardlinks.insert(f.hardlink_id()) {
                members.push(f);
            }
        }
        if members.len() < 2 {
            continue;
        }
        // (size, class) sub-grouping.
        let mut by_class: HashMap<u64, Vec<&HashedFile>> = HashMap::new();
        for f in members {
            by_class.entry(f.class).or_default().push(f);
        }
        for class_members in by_class.into_values() {
            if class_members.len() < 2 {
                continue;
            }
            let size = class_members[0].size;
            let count = class_members.len() as u64;
            groups.push(DupeGroup {
                size,
                wasted: size * (count - 1),
                files: class_members
                    .iter()
                    .map(|f| DupeFile {
                        path: f.path.clone(),
                        node_id: f.node_id,
                        modified: f.modified,
                    })
                    .collect(),
            });
        }
    }
    groups.sort_by(|a, b| {
        b.wasted
            .cmp(&a.wasted)
            .then(b.size.cmp(&a.size))
            .then_with(|| a.files[0].path.cmp(&b.files[0].path))
    });
    groups
}

/// Total reclaimable bytes and group count (header line
/// "X could be reclaimed across N groups").
#[must_use]
pub fn totals(groups: &[DupeGroup]) -> (u64, usize) {
    (groups.iter().map(|g| g.wasted).sum(), groups.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, size: u64, serial: u64, index: u64, class: u64) -> HashedFile {
        HashedFile {
            path: path.to_string(),
            size,
            volume_serial: serial,
            file_index: index,
            class,
            node_id: 0,
            modified: 0,
        }
    }

    /// The paths of a group's members (test shorthand).
    fn paths_of(g: &DupeGroup) -> Vec<&str> {
        g.files.iter().map(|f| f.path.as_str()).collect()
    }

    #[test]
    fn zero_length_and_singletons_are_not_candidates() {
        let files = vec![
            f("empty.txt", 0, 1, 1, 0xAA),
            f("only-one.bin", 100, 1, 2, 0xBB),
        ];
        assert_eq!(rank(&files).len(), 0);
        assert_eq!(group_by_size(&files).len(), 0);
    }

    #[test]
    fn hardlinks_are_not_duplicates() {
        // Two hardlinks: same (volume serial, file index), same class.
        let files = vec![
            f("a/link1.dat", 500, 7, 42, 0xCC),
            f("b/link2.dat", 500, 7, 42, 0xCC),
        ];
        let groups = rank(&files);
        assert!(groups.is_empty(), "hardlink pair must not be reported");
    }

    #[test]
    fn same_size_different_class_is_not_a_group() {
        let files = vec![
            f("a/x.dat", 500, 7, 42, 0x01),
            f("b/y.dat", 500, 7, 43, 0x02),
        ];
        assert_eq!(rank(&files).len(), 0);
    }

    #[test]
    fn wasted_space_math_and_ranking_order() {
        // Group A: 3 files × 100 → wasted 200.
        // Group B: 2 files × 900 → wasted 900 (must rank first).
        let files = vec![
            f("a1", 100, 1, 1, 0x10),
            f("a2", 100, 1, 2, 0x10),
            f("a3", 100, 1, 3, 0x10),
            f("b1", 900, 1, 4, 0x20),
            f("b2", 900, 1, 5, 0x20),
        ];
        let groups = rank(&files);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].wasted, 900);
        assert_eq!(groups[0].size, 900);
        assert_eq!(groups[0].files.len(), 2);
        assert_eq!(groups[1].wasted, 200);
        assert_eq!(groups[1].files.len(), 3);
        assert_eq!(totals(&groups), (1100, 2));
    }

    #[test]
    fn hardlink_exclusion_prunes_before_grouping() {
        // Three physical entries, two of them the same physical file.
        // One true duplicate remains + the hardlink clone is dropped.
        let files = vec![
            f("real1.doc", 50, 2, 10, 0x30),
            f("real2.doc", 50, 2, 11, 0x30),
            f("hard2.doc", 50, 2, 11, 0x30), // hardlink of real2
        ];
        let groups = rank(&files);
        assert_eq!(groups.len(), 1);
        assert_eq!(paths_of(&groups[0]), vec!["real1.doc", "real2.doc"]);
        assert_eq!(groups[0].wasted, 50);
    }

    #[test]
    fn keep_anchor_is_first_member() {
        let files = vec![f("z-last", 10, 1, 1, 0x40), f("a-first", 10, 1, 2, 0x40)];
        let groups = rank(&files);
        // Input order preserved inside the group (a-first was fed second).
        assert_eq!(paths_of(&groups[0]), vec!["z-last", "a-first"]);
    }

    #[test]
    fn member_facts_round_trip_through_rank() {
        // The UI's keep-newest/oldest rules + reveal-in-explore need
        // modified dates and node ids per member — rank must carry
        // them through from HashedFile to DupeFile.
        let mk = |path: &str, class: u64, node_id: u32, modified: i64| HashedFile {
            path: path.into(),
            size: 10,
            volume_serial: 1,
            file_index: node_id as u64 + 7,
            class,
            node_id,
            modified,
        };
        let files = vec![
            mk("a.bin", 1, 11, 1_700_000_000),
            mk("b.bin", 1, 12, 1_600_000_000),
        ];
        let groups = rank(&files);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert_eq!(groups[0].files[0].path, "a.bin");
        assert_eq!(groups[0].files[0].node_id, 11);
        assert_eq!(groups[0].files[0].modified, 1_700_000_000);
        assert_eq!(groups[0].files[1].modified, 1_600_000_000);
    }

    #[test]
    fn hardlinks_across_classes_still_excluded_per_class() {
        // A hardlink pair inside one size bucket where a THIRD file
        // (different class) also lives: the hardlink twin drops, and
        // the different-class member never groups with either.
        let files = vec![
            f("one.doc", 50, 2, 10, 0x30),
            f("two.doc", 50, 2, 10, 0x30), // hardlink of one
            f("other.doc", 50, 2, 12, 0x31),
        ];
        assert_eq!(rank(&files).len(), 0);
    }
}
