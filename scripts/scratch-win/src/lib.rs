//! The local compile gate for the app-crate files session 15 touched
//! (the same discipline as session 14's scratch mirror, now COMMITTED
//! so a sandbox reset cannot lose it). The real files are pulled in
//! with `#[path]`:
//!
//! - `state.rs` — the TreeCache + the app state (host-testable).
//! - `commands/dupes.rs` — the 3-pass engine + the scope support.
//! - `commands/sidebar.rs` — `disk_storage(path)` + the drive chips.
//! - `commands/snapshots_cmd.rs` — the node-honoring take_snapshot.
//!
//! Everything the real files reach through `crate::` that is NOT one
//! of those (the platform seam, the license manager) is stubbed here
//! with signature-compatible shapes — the platform seam is UNTOUCHED
//! this session, so stubbing it carries no false confidence.
//!
//! Host mode runs the real unit tests (`cargo test`); the msvc target
//! compiles + lints the windows-cfg halves (`cargo clippy
//! --target x86_64-pc-windows-msvc`).
//!
//! Modules are PRIVATE (the real crate's shape — lib.rs keeps
//! `mod commands; mod platform; mod state;`), so `missing_docs` sees
//! the same surface the real crate does; dead code is allowed because
//! the tauri handler registration that consumes the commands lives
//! only in the real build.

#![allow(dead_code)]

mod commands;
mod platform;
#[path = "../../../src-tauri/src/state.rs"]
mod state;
