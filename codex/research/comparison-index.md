# Comparison repository index

The comparison work is evidence gathering, not source copying. Licenses and
architecture boundaries remain binding. See [the core audit](diskgenie-audit.md)
and [the implementation ledger](../WORKLOG.md).

| Repository | Revision reviewed | Useful patterns | Constraints / rejected patterns |
|---|---:|---|---|
| `tobi/disktree` | `6c8d4ce` | Flat pending-directory traversal; native macOS and Windows enumeration; allocated-size accounting; cached treemap geometry; descriptor-relative Unix deletion | No duplicate engine; nondeterministic hardlink attribution; APFS clone overcount; stale MFT risk; lossy names; Windows deletion is less defensive than DiskGenie requires |
| `Byron/dua-cli` | `d11cb9c` | Bounded work stealing and backpressure; typed streaming events; cancellation; compact arena; native byte names; stable IDs; APFS clone accounting; transactional candidate staging; snapshot/diff | No representative benchmark suite; CLI interaction model is not directly transferable |
| `vyrti/cleaner` | `98cf6d6` | macOS bulk enumeration; risk tiers; report-only targets; safe defaults | Lexical containment and symlink/TOCTOU gaps make its deletion design unsuitable for reuse |
| `IgorMundstein/WinMemoryCleaner` | reviewed 2026-10-05 | Capability-labelled operations; named progress; monitoring UX | GPL-3: ideas only, no source/assets. Privilege, handle lifetime, busy-loop, updater, and aggressive-default defects were rejected |

## Adoption order

1. Close DiskGenie's destructive-operation and duplicate-verification safety
   gaps before performance work.
2. Introduce bounded traversal and typed event/backpressure contracts.
3. Improve platform enumerators and allocation accounting behind the existing
   platform seam.
4. Benchmark each change with deterministic, device-shaped fixtures; retain it
   only when measured regressions and correctness checks pass.

No statement that DiskGenie “beats” another product is permitted until a
reproducible benchmark matrix records hardware, filesystem, corpus, cold/warm
cache state, tool revision, and confidence intervals.
