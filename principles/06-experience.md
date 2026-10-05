# Product experience and UI/core wiring

## User-value rule

Every mode answers: what is consuming space, how certain is the result, what can
the user safely do, what will be reclaimed, and how can the action be reversed?
Charts and color exist to make those decisions faster and safer.

## Core wiring

- One canonical typed view model per operation maps Rust state to UI state.
- UI controls have a traceable command, validation, core capability, response,
  progress/error/cancel state, and test. No decorative control implies behavior.
- Do not recompute core facts in React. Do not send huge result sets or high-rate
  per-file events through IPC; page/virtualize and batch.
- Model idle, preparing, running, paused/cancelling where supported, partial,
  complete, empty, degraded, and failed states explicitly.

## Motion and rendering

- Preserve the existing anti-flicker strategy after locating and documenting it.
- Stable shells, layout dimensions, keys, and providers prevent remount flashes.
- Animate opacity/transform when useful; avoid layout-thrashing properties.
- Short motion should explain state continuity, not delay input. Honor reduced
  motion and make correctness independent of animation completion.
- Keep expensive derivation memoized or in the core; virtualize large lists;
  batch store updates; measure React commits and UI input latency.

## Visual system

- Centralize semantic design tokens for surface, glass, text, border, accent,
  chart series, success/warning/danger, shadow, radius, spacing, and motion.
- Light and dark themes have deliberate contrast, not mechanical inversion.
- Glass/gradient effects retain legibility and hierarchy on both WebViews.
- Color is never the sole carrier of category or status; use labels/icons/pattern.
- Alignment follows a consistent grid. Responsive behavior is specified for
  minimum, typical, and large windows and common scale factors.

## Duplicate experience

Organize by duplicate set with an explicit recommended keeper, reclaimable bytes,
path/location context, confidence/equality state, preview where safe, selection
rules, undo/recovery explanation, and per-item results. Never preselect all copies
in a way that can remove the final verified copy.

## Version display

Free/Pro/Activate surfaces obtain the installed version from the build/runtime
source of truth and present it near theme/account information. It must not be a
manually duplicated string.

## Screenshot review

Keep one purposeful screenshot per page/mode/action/state rather than repeated
frames. Cover light/dark and Windows/macOS through a declared matrix, stable seed
data, hidden secrets, deterministic motion, and named diff thresholds.

