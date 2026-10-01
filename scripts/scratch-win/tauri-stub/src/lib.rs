//! Compile-check stub of the tauri surface (see the crate docs — this
//! mirrors just enough for the REAL command files to type-check
//! outside the webview stack).

pub use tauri_command_macro::command;

/// The managed-state extractor (`State<'_, AppState>` parameters).
/// Nothing constructs it in the mirror (that is the runtime's job), so
/// the inner reference only exists for `Deref`.
pub struct State<'a, T: ?Sized>(pub &'a T);

impl<T: ?Sized> core::ops::Deref for State<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.0
    }
}

/// The app handle (event emission + process exit).
#[derive(Clone)]
pub struct AppHandle;

impl AppHandle {
    /// Exit the process (the elevated-restart path).
    pub fn exit(&self, exit_code: i32) -> ! {
        std::process::exit(exit_code)
    }
}

/// Event emission (`app.emit("dupes-progress", payload)`).
pub trait Emitter {
    /// Best-effort emit; failures are ignored by every caller.
    fn emit<S: serde::Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), String>;
}

impl Emitter for AppHandle {
    fn emit<S: serde::Serialize + Clone>(&self, _event: &str, _payload: S) -> Result<(), String> {
        Ok(())
    }
}

/// The blocking-task spawner (quick_wins / find_duplicates pipelines).
pub mod async_runtime {
    /// Runs `f` and wraps its output in the join-result shape the
    /// command files expect (`map_err(|e| format!(...))`).
    pub async fn spawn_blocking<F, T>(f: F) -> Result<T, String>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        Ok(f())
    }
}
