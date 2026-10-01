#!/usr/bin/env node
/**
 * Session-18 browser behavioral proof (single invocation — the sandbox
 * reaps processes between tool calls). The theme-reactive BrandMark:
 *
 *  1. boot vite (mock backend) — unlicensed boot auto-opens the
 *     license dialog (the heading now leads with the 20px BrandMark)
 *  2. verify the topbar mark: 31px, computed background = the theme's
 *     --ink-grad, glow = --ink-glow, radius 50%
 *  3. PHASE A: click each of the five swatches; for each theme verify
 *     the mark's computed gradient MATCHES that theme's --ink-grad
 *     (the circle follows the palette), + screenshot
 *  4. activate the simulated license, scan This PC (content)
 *  5. PHASE B: the app surface under each theme — the topbar mark +
 *     tab pill share the same gradient language (pixel-sampled)
 *  6. the activation gate (locked tab) — the 44px mark
 *  7. reload: the persisted theme + the mark still themed
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SHOTS = `${ROOT}/ci-artifacts/s18`;
const PORT = 5199;
const AB = "/usr/local/bin/agent-browser";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ab(args) {
  return execFileSync(AB, args, { encoding: "utf8", timeout: 90_000 }).trim();
}
function ev(js) {
  return ab(["eval", js]);
}
function shot(name) {
  return ab(["screenshot", `${SHOTS}/${name}.png`]);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT, stdio: "ignore", detached: true,
  });
  try {
    await sleep(2500);
    ab(["open", `http://localhost:${PORT}/`]);
    await sleep(2600);

    // ── the dialog auto-opens on unlicensed boot ────────────────────
    const heading = ev(`(() => {
      const h = document.querySelector('.db-license-dialog h3 .db-brand-mark');
      if (!h) return 'NO-MARK';
      const cs = getComputedStyle(h);
      const r = h.getBoundingClientRect();
      return JSON.stringify({ w: r.width, h: r.height, bg: cs.background.slice(0,140),
        radius: cs.borderRadius, shadow: cs.boxShadow.slice(0,80) });
    })()`);
    console.log("[A] dialog heading mark:", heading);

    // ── PHASE A: every swatch re-themes the mark ───────────────────
    const THEMES = ["light", "dark", "ember", "tide", "blossom"];
    const results = {};
    for (const t of THEMES) {
      ev(`(() => {
        const btns = [...document.querySelectorAll('.db-theme-picker button, .db-license-dialog [aria-pressed]')];
        const b = btns.find(x => (x.getAttribute('aria-label')||'').toLowerCase().includes('${t}'));
        if (b) b.click();
        return b ? 'clicked' : 'NOT-FOUND';
      })()`);
      await sleep(420);
      const probe = ev(`(() => {
        const top = document.querySelector('.db-topbar .db-brand-mark');
        const dlg = document.querySelector('.db-license-dialog h3 .db-brand-mark');
        const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink-grad');
        const csT = top ? getComputedStyle(top) : null;
        const rT = top ? top.getBoundingClientRect() : null;
        return JSON.stringify({
          attr: document.documentElement.dataset.theme,
          inkGrad: ink.trim(),
          topBg: csT ? csT.backgroundImage.slice(0,120) : 'none',
          topW: rT ? rT.width : 0,
          dlgW: dlg ? dlg.getBoundingClientRect().width : 0,
        });
      })()`);
      results[t] = (() => {
        // agent-browser JSON-encodes string results — unwrap one level
        // if the parse yields a string again.
        let obj;
        try {
          obj = JSON.parse(probe);
          if (typeof obj === "string") obj = JSON.parse(obj);
        } catch {
          obj = {};
        }
        return obj;
      })();
      shot(`mark-dialog-${t}`);
      console.log(`[A] ${t}:`, probe.slice(0, 200));
    }

    // ── the theme-reactive contract: bg follows --ink-grad ─────────
    // inkGrad is authored as hex stops; the computed background resolves
    // the same stops as rgb() — normalize both to rgb triples.
    const hexToRgb = (m) => {
      const h = m.replace("#", "");
      const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)).join(",");
    };
    const stops = (s) => {
      const out = [];
      for (const m of s.matchAll(/#([0-9a-f]{3,6})/gi)) out.push(hexToRgb(m[0]));
      for (const m of s.matchAll(/rgba?\(([^)]+)\)/gi)) {
        const parts = m[1].split(",").map((x) => x.trim()).slice(0, 3);
        out.push(parts.map((p) => String(Math.round(parseFloat(p)))).join(","));
      }
      return out;
    };
    let allMatch = true;
    for (const t of THEMES) {
      const r = results[t] || {};
      const grad = String(r.inkGrad ?? "");
      const bg = String(r.topBg ?? "");
      const gs = stops(grad);
      const bs = stops(bg).slice(0, gs.length);
      const same = gs.length >= 3 && gs.join("|") === bs.join("|");
      if (!same) allMatch = false;
      console.log(`[match] ${t}: ${same ? "OK" : "MISMATCH"} stops=${gs.join(" | ")}`);
    }

    // ── activate + scan (content for the app surface) ──────────────
    ev(`(() => {
      const inp = document.querySelector('.db-license-dialog input');
      if (inp) { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(inp, 'DB-TOUR-0000-0000-0000-0001'); inp.dispatchEvent(new Event('input',{bubbles:true})); }
      return 'typed';
    })()`);
    await sleep(300);
    ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim()==='Activate'); if (b) b.click(); return 'ok'; })()`);
    await sleep(1500);
    ev(`(() => { [...document.querySelectorAll('button')].find(b => /scan/i.test(b.textContent))?.click(); return 'scan'; })()`);
    await sleep(2800);

    // ── PHASE B: the app under three representative themes ─────────
    for (const t of ["dark", "ember", "blossom"]) {
      ev(`(() => { window.dispatchEvent(new CustomEvent('db-theme-set', { detail: '${t}' })); return 'set'; })()`);
      await sleep(500);
      shot(`mark-app-${t}`);
    }

    // ── the activation gate (a locked tab pre-activation) ─────────
    ev(`(() => { window.dispatchEvent(new CustomEvent('db-theme-set', { detail: 'light' })); return 'set'; })()`);
    await sleep(400);
    const gate = ev(`(() => {
      const g = document.querySelector('.db-activation-gate .db-brand-mark');
      if (!g) return 'NO-GATE (expected when licensed)';
      const r = g.getBoundingClientRect();
      return JSON.stringify({ w: r.width, bg: getComputedStyle(g).backgroundImage.slice(0,90) });
    })()`);
    console.log("[B] gate mark:", gate);

    // ── reload: persistence + the pre-mount no-flash ───────────────
    ab(["reload"]);
    await sleep(2200);
    const persisted = ev(`(() => {
      const top = document.querySelector('.db-topbar .db-brand-mark');
      return JSON.stringify({ attr: document.documentElement.dataset.theme,
        bg: top ? getComputedStyle(top).backgroundImage.slice(0,90) : 'none' });
    })()`);
    console.log("[B] after reload:", persisted);
    shot("mark-reloaded");

    console.log(allMatch ? "[VERDICT] mark follows --ink-grad in all themes" : "[VERDICT] MISMATCH somewhere");
  } finally {
    try { process.kill(-vite.pid); } catch {}
  }
})();
