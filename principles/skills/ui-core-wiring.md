# UI/core-wiring protocol

1. Trace the control/state through React, store, Tauri command/event, core, and
   platform adapter; record the mapping in `codex/index/ui-core-wiring.md`.
2. Define typed idle/running/cancelling/partial/complete/empty/degraded/error states.
3. Keep expensive computation in Rust; batch/page events and virtualize results.
4. Preserve stable shells/keys/providers and the documented anti-flicker motion.
5. Test keyboard, accessibility, reduced motion, light/dark, viewport/scale, and
   Windows/macOS screenshots with deterministic data.
6. Verify every visible action invokes real supported behavior and reports its
   exact outcome.

