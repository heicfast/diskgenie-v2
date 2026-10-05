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
