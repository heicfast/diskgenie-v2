import brandMark from "../assets/brand-mark.png";

/**
 * The DiskGenie product mark, theme-reactive everywhere it appears.
 *
 * The asset is the photoreal disk + broom cutout (background removed at
 * the pixel level — the orange circle is gone, the soft shadow survives
 * as a black-alpha layer). The CIRCLE is painted by CSS with
 * `var(--ink-grad)` — the exact gradient every ink-filled control uses —
 * so the mark follows the selected theme live and rides the same
 * View-Transition crossfade as the rest of the chrome (the token change
 * re-paints the background; the transition wraps the whole app).
 *
 * The glow matches the tab pill / ink-button language (`--ink-glow`),
 * keeping the mark in symmetry with the interactive ink surfaces.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <span
      className="db-brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src={brandMark} alt="" draggable={false} />
    </span>
  );
}
