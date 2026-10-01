//! DiskGenie binary entry (spec §2): starts the Tauri app via
//! `diskgenie_lib::run`.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    diskgenie_lib::run();
}
