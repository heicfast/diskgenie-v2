# Worklog

## 2026-10-05 — bootstrap and principles

- Cloned original DiskGenie and license-server repositories.
- Created and pushed `heictojpgpics/diskgenie-v2` and
  `heictojpgpics/diskgenie-license-server-v2`; retained originals as `upstream`.
- Cloned required Rust references into the workspace `references/` directory.
- Retrieved the optimization gist and OneUptime article caches; JetBrains content
  was read through its published page because direct download returned HTTP 403.
- Added one-per-source notes under workspace `references/notes/`.
- Created the cross-linked production engineering principles and acceptance
  gates before implementation analysis.

Next: read/validate the complete principles set, clone and index the four
comparison repositories, then baseline DiskGenie before any optimization claim.

## 2026-10-05 — comparison read and baseline audit

- Indexed and read DiskTree, dua-cli, Cleaner, and WinMemoryCleaner in parallel.
- Recorded transferable architecture patterns and explicit rejection/licensing
  boundaries in [research/comparison-index.md](research/comparison-index.md).
- Audited the Rust core, Tauri commands, mock IPC seam, UI state, license client
  and server, workflows, screenshot tours, and anti-flicker implementation.
- Recorded prioritized findings in
  [research/diskgenie-audit.md](research/diskgenie-audit.md).
- Established a reproducible baseline: frontend typecheck, 112 tests, and build
  passed; license server typecheck and 58 tests passed. Rust tooling is not
  installed in the local executor, so Rust checks must be performed by the
  platform CI runners and cannot be claimed locally.

## 2026-10-05 — release-blocker slice 1

- Removed raw license key/email analytics identification; telemetry remains
  anonymous and opt-out aware.
- Added nonce consumption and replay coverage to `/v1/verify`.
- Made cleanup path identity case-insensitive only on Windows, preserving
  case-distinct paths on macOS; added regression coverage.
- Enabled the existing macOS hardlink identity seam in duplicate grouping.
- Reworked duplicate choice so the user explicitly picks the survivor and the
  remaining copies are staged together. Removed the silent first-path default.
- Added the installed bundle version below appearance settings in unlicensed,
  Pro/grace, and degraded dialogs, plus a manifest version-sync gate.
- Local post-change gates: frontend typecheck, 113 tests, and production build
  passed; license-server typecheck and 59 tests passed. Bundle-size and static /
  dynamic import warnings remain tracked performance work.
- Local browser rendering was attempted through the available browser surface,
  but loopback navigation was blocked by the browser provider. Visual review is
  therefore deferred to the Windows/macOS screenshot runners; no visual-pass
  claim is made from this environment.

## 2026-10-06 — duplicates engine v3 (session core-24)

- Replaced the v2 full-SHA-256 authority pass with lockstep
  chain-partition verification (`core/src/dupes/engine.rs`): every
  screen-bucket member streams its unverified range in 4 MiB lockstep
  rounds into a personal running XXH3-128 chain; members partition by
  chain digest each round; diverging members retire at the first
  differing block, tied classes stream to end-of-range and group.
- Screens now use ONE open per file (prefix + both mid windows in the
  same handle). Verify ranges start past the screened bytes (chains
  seed with the screen digests), so every byte is read at most once
  across the whole pipeline. Files ≤ 64 KiB are decided by their
  full-content prefix screen directly.
- `HashedFile.sha256` → `class: u64`; `rank()` groups by (size,
  class). App-side `commands/dupes.rs` is collect → engine → hardlink
  → rank wiring. Phases: collect | screen | verify | done |
  cancelled (UI labels + mock updated in lockstep).
- Local measurement (1 GiB real staged corpus, release profile):
  0.09 s, 6,631 MiB/s effective, 0.52× read amplification, all 32
  planted groups found, near-dups rejected. Cold-NVMe extrapolation:
  16 GB ≈ 6–8 s, I/O-bound with no CPU bottleneck.
- Gates: core 179+21+16 tests green; clippy pedantic + fmt clean;
  scratch-win mirror: 45/45 host tests + msvc cross-lint clean;
  frontend tsc 0 errors, 113/113 vitest; version-sync green.

## 2026-10-06 — workflow consolidation + title-synced screenshots (session 19, part 3)

- Consolidated 10 workflows → 6 (the owner's target set + the weekly
  benchmark): ci.yml absorbs test-matrix (mac core/platform jobs),
  license-e2e (the live-worker lifecycle job, secrets-presence guard
  kept), and gains a version-sync gate + the v3 engine benchmark in
  its Benchmarks job. DELETED: nsis-bundle.yml (byte-duplicate of
  ci.yml's bundle), test-matrix.yml, license-e2e.yml (merged),
  macos-license-e2e.yml (the Windows headless live test covers the
  lifecycle; the mac UI-drive variant cost 10x minutes for overlapping
  coverage — its keychain-setup knowledge stays in git history).
- macos-ui-audit.yml → macos-screenshots.yml; macos-build.yml drops
  its duplicated test steps (ci.yml's core-mac covers both mac
  images); macos-benchmark.yml gains the engine benchmark
  (DB_BENCH_GB=2) beside the app-level timings.
- TITLE-SYNCED screenshots ("one for one page/mode/action"): the
  TourDriver stamps `DiskGenie · tNN-name` into document.title per
  step (+ `tour-done` marker); the Windows harness polls
  MainWindowTitle, settles 1.3 s, shoots ONE NAMED frame per step
  (48 anonymous cadence frames → ~35 named ones); mac-capture.sh
  gained SYNC_TITLE mode (the CGWindowList Swift probe now reads the
  title too; sed marker extraction verified live). The fixed-cadence
  loop remains as the zero-marker fallback on both platforms.
- Verified all push triggers are `branches: [main]` at the BYTE level
  (the `ain]` display was a display-layer artifact — `[m` eaten as
  an ANSI reset; od hex proves `5b 6d 61 69 6e 5d`).
- YAML validated (python yaml.safe_load) for all six files.

## 2026-10-06 — engine property tests (session 19, part 4)

- Added core/tests/dupes_engine.rs: 96-case proptest over random
  populations staged as REAL files (2–6 unique contents at random
  KiB-scale sizes, 0–3 planted copy-groups, 0–2 near-dup pairs that
  share screens but differ in the gap). Asserts the engine finds
  exactly the planted structure: every group ≥ 2 members, sizes map
  to staged files, near-dups never group. Plus a geometry-invariant
  property (mid_threshold algebra + end-to-end at odd prefix/sample
  lengths). Fixed a test-authoring bug the shrink found (duplicate
  group indices double-counting the planted expectation).
- Gates: core 180 lib + 21 platform + 16 properties + 2 engine
  properties green; clippy + fmt clean.
