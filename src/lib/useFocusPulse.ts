/**
 * Focus-pulse host hook (session 13): mounted ONCE by ExploreView —
 * owns the pulse's lifecycle (clear after the animation window) and
 * the DOM-mode affordances: the matching `[data-pulse-id]` row gets
 * the pulse class + scrolls smoothly into view ("focus" in a list
 * mode means SEE the row, not just select it). CanvasViz renders the
 * ring separately from the same store state.
 */
import { useEffect } from "react";
import { useExploreStore } from "../state/explore";

export function useFocusPulseHost(): void {
  const pulse = useExploreStore((s) => s.focusPulse);
  const clear = useExploreStore((s) => s.clearFocusPulse);

  useEffect(() => {
    if (!pulse) return;
    // DOM rows: pulse class + smooth scroll (guarding the CSS class
    // removal against unmounts — the timeout's element reference is
    // captured, and a detached node simply no-ops).
    const el = document.querySelector<HTMLElement>(`[data-pulse-id="${pulse.id}"]`);
    let removeTimer: number | null = null;
    if (el) {
      el.classList.remove("db-row-pulse");
      // Force a style flush so consecutive pulses on the same element
      // REPLAY the animation (a bare re-add within one frame is a
      // no-op for CSS animations).
      void el.offsetWidth;
      el.classList.add("db-row-pulse");
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      removeTimer = window.setTimeout(() => el.classList.remove("db-row-pulse"), 1400);
    }
    // The store-level clear (1.5s) retires the pulse for every
    // consumer (canvas ring + rows).
    const clearTimer = window.setTimeout(() => clear(), 1500);
    return () => {
      if (removeTimer !== null) window.clearTimeout(removeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [pulse, clear]);
}
