/**
 * Motion presets (design system v2) — the ONE source for every
 * framer-motion spring in the app.
 *
 * framer-motion's remaining footprint (session-7) is deliberately
 * narrow: the two LAYOUT pills (tab pill in TopBar, mode pill in
 * ExploreHeader — `layoutId` sliding, no opacity ramp) and the scan
 * live-counter value tween in ExploreView. Every mount/unmount
 * surface — tab swap, stage swap, cleanup popover, toast, queue
 * badge — is CSS now (see the session-5/-7 notes below): WAAPI-driven
 * enter/exit tweens parked the inline style at the initial value and
 * framer cleaned them up asynchronously, leaving one painted frame
 * where the finished animation was gone but the final style hadn't
 * landed (element blanked, or flashed back before unmount).
 *
 * CSS-side motion tokens (--dur-*, --ease-*, see tokens.css) cover
 * stylesheet animations; the two systems share the same tempo ladder.
 */
import type { Transition } from "framer-motion";

/** Small UI elements: fast settle, no visible overshoot. Used by the
 * sliding layout pills (tab strip, mode picker). */
export const SPRING_UI: Transition = { type: "spring", stiffness: 480, damping: 38 };

/* Retired presets (session-7): SPRING_POP / SPRING_TOAST / EXIT_FAST /
 * FADE_SWAP belonged to the popover, toast, badge, and swap surfaces —
 * all now CSS keyframe + transition:
 *
 *   .db-tab-swap / .db-stage-swap  db-settle-in          (shell/explore.css)
 *   .db-pop                        db-pop-in + [data-closing] (overlays.css)
 *   .db-toast                      db-toast-in + [data-closing]
 *   .db-queue-button b             db-badge-in + [data-closing] (shell.css)
 *
 * The CSS route reverts to the underlying value in the same style
 * recalc the moment an animation ends, so the cleanup gap cannot
 * exist; data-closing exits transition FROM the live computed value
 * (interrupt-safe even mid-entrance). The exit fades are 120–140 ms
 * (ease-in) and entrances 160–200 ms with a soft overshoot bezier —
 * the same feel as the old springs. prefers-reduced-motion is
 * honored twice: the base.css kill switch flattens durations, and
 * App.tsx keeps MotionConfig reducedMotion="user" for the pills. */
