/**
 * Theme picker (session 16 → redesigned session 18 — the appearance
 * settings inside the Pro/Activate dialog). Five palettes: the shipped
 * light/dark pair plus Ember, Tide and Blossom.
 *
 * THE PREMIUM REDESIGN: each swatch is a miniature of the app itself —
 * a tiny window with the palette's titlebar (traffic-light dots), its
 * sidebar sliver, a two-block mini treemap (the product's core visual),
 * and the accent gradient pill. The palette's whole personality reads
 * in 68px. The name sits UNDER its swatch (a labeled control, not a
 * tooltip riddle), the selected one carries the LIVE theme's ink ring +
 * check badge + ink label, and hover lifts with a soft ink glow.
 *
 * Keyboard: the row is a roving-tabindex group — ←/→ walk the palettes,
 * Home/End jump; the walked swatch gets focus, Enter/Space (native
 * button) selects. Premium software is reachable without a mouse.
 *
 * Motion contract (the app's settle-in family — same as the dialog's
 * own state swaps): the picker enters with the body it lives in, and a
 * SELECTION rides the document-wide View Transitions crossfade
 * (useTheme.setTheme) — the entire app, dialog included, crossfades
 * between palettes. The only local transitions are micro-feels (hover
 * lift, ring fade); no new animation families.
 *
 * Preview colors are FIXED LITERALS by design — a preview must show
 * its palette even when that palette is NOT active (CSS vars would
 * resolve to the ACTIVE theme and every swatch would look identical).
 * Only the ring, check, glow, and labels speak live tokens.
 */
import { useRef } from "react";
import { CheckIcon } from "./Icon";
import { useTheme } from "../theme/useTheme";
import { THEME_LIST, type ThemeId } from "../theme/themes";

/**
 * Each swatch's miniature-app preview: titlebar / sidebar / canvas
 * surfaces, two treemap block tones, and the accent gradient pill.
 * Fixed literals (see the module doc); values sit next to the tokens
 * they preview.
 */
const SWATCH_PREVIEW: Record<
  string,
  { titlebar: string; sidebar: string; canvas: string; blocks: [string, string]; pill: string }
> = {
  light: {
    titlebar: "#e9e9ee", sidebar: "#f1f1f4", canvas: "#f8f8fa",
    blocks: ["#ffd9cd", "#cfe3d8"], pill: "linear-gradient(135deg, #ff7e5f, #f96036)",
  },
  dark: {
    titlebar: "#27272b", sidebar: "#222226", canvas: "#1c1c1f",
    blocks: ["#e08a6e", "#7fb8a2"], pill: "linear-gradient(135deg, #ff9070, #f96c48)",
  },
  ember: {
    titlebar: "#2a221b", sidebar: "#241d17", canvas: "#1c1511",
    blocks: ["#e8b477", "#a8845a"], pill: "linear-gradient(135deg, #ffd27a, #d9902c)",
  },
  tide: {
    titlebar: "#18202e", sidebar: "#141b27", canvas: "#0f151e",
    blocks: ["#7ec8e8", "#5aa3c8"], pill: "linear-gradient(135deg, #71d9fb, #1fa6d8)",
  },
  blossom: {
    titlebar: "#f3e5e1", sidebar: "#f7ebe8", canvas: "#fdf7f5",
    blocks: ["#f2c3cd", "#e8a9b8"], pill: "linear-gradient(135deg, #ec6d84, #c43b58)",
  },
};

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAt = (index: number) => {
    const n = THEME_LIST.length;
    const i = ((index % n) + n) % n;
    swatchRefs.current[i]?.focus();
    // Walk-select (the System-Settings pattern): arrowing through the
    // row previews each palette LIVE — the whole app crossfades as you
    // walk. Trivially reversible, and the delight is the point.
    setTheme(THEME_LIST[i].id as ThemeId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = THEME_LIST.findIndex((t) => t.id === theme);
    if (e.key === "ArrowRight") { e.preventDefault(); focusAt(current + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); focusAt(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(THEME_LIST.length - 1); }
  };

  return (
    <div className="db-theme-picker" role="group" aria-label="Theme">
      <div className="db-theme-picker-head">
        <span>THEME</span>
        <span className="db-theme-picker-current">{THEME_LIST.find((t) => t.id === theme)?.label}</span>
      </div>
      {/* Roving tabindex: the ACTIVE swatch is the tab stop; ←/→ walk.
       * role="toolbar" carries the keyboard semantics honestly. */}
      <div className="db-theme-swatches" role="toolbar" aria-label="Theme palettes" onKeyDown={onKeyDown}>
        {THEME_LIST.map(({ id, label }, i) => {
          const preview = SWATCH_PREVIEW[id];
          const active = id === theme;
          return (
            <div key={id} className="db-theme-swatch-slot">
              <button
                ref={(el) => { swatchRefs.current[i] = el; }}
                type="button"
                className="db-theme-swatch"
                data-theme-id={id}
                data-active={active || undefined}
                aria-pressed={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setTheme(id)}
                title={label}
                aria-label={`Theme: ${label}`}
              >
                {/* The palette preview — a miniature app window (fixed
                 * preview colors by design; see SWATCH_PREVIEW). */}
                <span className="db-theme-swatch-window" aria-hidden="true">
                  <span className="db-theme-swatch-titlebar" style={{ background: preview.titlebar }}>
                    <i /><i /><i />
                  </span>
                  <span className="db-theme-swatch-body">
                    <span className="db-theme-swatch-side" style={{ background: preview.sidebar }} />
                    <span className="db-theme-swatch-canvas" style={{ background: preview.canvas }}>
                      <span
                        className="db-theme-swatch-block b1"
                        style={{ background: preview.blocks[0] }}
                      />
                      <span
                        className="db-theme-swatch-block b2"
                        style={{ background: preview.blocks[1] }}
                      />
                      <span className="db-theme-swatch-pill" style={{ background: preview.pill }} />
                    </span>
                  </span>
                </span>
                {active && (
                  <span className="db-theme-swatch-check" aria-hidden="true">
                    <CheckIcon size={11} />
                  </span>
                )}
              </button>
              <span className="db-theme-swatch-name" data-active={active || undefined}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
