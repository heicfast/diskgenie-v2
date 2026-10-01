/**
 * Theme picker (session 16 — the appearance settings inside the
 * Pro/Activate dialog). Five palettes: the shipped light/dark pair
 * plus Ember, Tide and Blossom.
 *
 * Design: one row of miniature "app window" swatches — each shows the
 * palette's canvas with its accent gradient pill, so the richness is
 * visible BEFORE selecting. The selected swatch carries the current
 * theme's ink ring + a check.
 *
 * Motion contract (the app's settle-in family — same as the dialog's
 * own state swaps): the picker itself enters with the body it lives
 * in (no separate entrance), and a SELECTION rides the document-wide
 * View Transitions crossfade (useTheme.setTheme) — the entire app,
 * dialog included, crossfades between palettes. No local animation is
 * needed or added; the swatch ring flips with the theme tokens.
 */
import { CheckIcon } from "./Icon";
import { useTheme } from "../theme/useTheme";
import { THEME_LIST } from "../theme/themes";

/**
 * Each swatch's preview colors. Fixed literals by design — a preview
 * must show its palette even when that palette is NOT active (CSS
 * vars would resolve to the ACTIVE theme and every swatch would look
 * identical). Kept adjacent to the tokens they preview; the ring +
 * check are the only live-token parts.
 */
const SWATCH_PREVIEW: Record<string, { canvas: string; pill: string }> = {
  light: { canvas: "#f5f5f7", pill: "linear-gradient(135deg, #ff7e5f, #f96036)" },
  dark: { canvas: "#1e1e20", pill: "linear-gradient(135deg, #ff9070, #f96c48)" },
  ember: { canvas: "#201a15", pill: "linear-gradient(135deg, #ffd27a, #d9902c)" },
  tide: { canvas: "#101722", pill: "linear-gradient(135deg, #71d9fb, #1fa6d8)" },
  blossom: { canvas: "#fbf1ee", pill: "linear-gradient(135deg, #ec6d84, #c43b58)" },
};

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="db-theme-picker" role="group" aria-label="Theme">
      <div className="db-theme-picker-head">
        <span>THEME</span>
        <span className="db-theme-picker-current">{THEME_LIST.find((t) => t.id === theme)?.label}</span>
      </div>
      <div className="db-theme-swatches">
        {THEME_LIST.map(({ id, label }) => {
          const preview = SWATCH_PREVIEW[id];
          const active = id === theme;
          return (
            <button
              key={id}
              type="button"
              className="db-theme-swatch"
              data-theme-id={id}
              data-active={active || undefined}
              aria-pressed={active}
              onClick={() => setTheme(id)}
              title={label}
              aria-label={`Theme: ${label}`}
            >
              {/* The palette preview — a miniature canvas with the
               * accent gradient pill (fixed preview colors by
               * design; see SWATCH_PREVIEW). */}
              <span
                className="db-theme-swatch-canvas"
                style={{ background: preview.canvas }}
                aria-hidden="true"
              >
                <span className="db-theme-swatch-pill" style={{ background: preview.pill }} />
              </span>
              {active && (
                <span className="db-theme-swatch-check" aria-hidden="true">
                  <CheckIcon size={11} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
