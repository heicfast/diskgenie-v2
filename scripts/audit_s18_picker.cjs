#!/usr/bin/env node
/**
 * Session-18 picker verification (single invocation): the redesigned
 * premium ThemePicker — miniature app windows with labels.
 *  1. geometry: 5 slots, 68x46 windows + name labels, one row, no
 *     overflow of the dialog body
 *  2. every swatch click still applies its theme (attr + storage)
 *  3. the keyboard walk: ArrowRight/Left walk-select (focus + theme)
 *  4. screenshots for the VLM round
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SHOTS = `${ROOT}/ci-artifacts/s18`;
const PORT = 5199;
const AB = "/usr/local/bin/agent-browser";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ab = (args) => execFileSync(AB, args, { encoding: "utf8", timeout: 90_000 }).trim();
const ev = (js) => ab(["eval", js]);

(async () => {
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT, stdio: "ignore", detached: true,
  });
  try {
    await sleep(2500);
    ab(["open", `http://localhost:${PORT}/`]);
    await sleep(2600);

    // geometry
    const geo = ev(`(() => {
      const slots = [...document.querySelectorAll('.db-theme-swatch-slot')];
      const row = document.querySelector('.db-theme-swatches');
      const body = document.querySelector('.db-license-body-swap') || document.querySelector('.db-dialog');
      const sw = document.querySelector('.db-theme-swatch');
      const names = slots.map(s => s.querySelector('.db-theme-swatch-name')?.textContent);
      const rowR = row.getBoundingClientRect();
      const bodyR = body.getBoundingClientRect();
      return JSON.stringify({
        count: slots.length, names,
        swW: sw.getBoundingClientRect().width, swH: sw.getBoundingClientRect().height,
        rowW: rowR.width, rowOverflow: rowR.right > bodyR.right,
        roles: row.getAttribute('role'),
        tabStops: slots.map(s => s.querySelector('button').tabIndex),
      });
    })()`);
    console.log("[geo]", geo);
    const g = JSON.parse(JSON.parse(geo));
    const okGeo = g.count === 5 && g.swW === 68 && g.swH === 46 && !g.rowOverflow;
    console.log("[geo] VERDICT:", okGeo ? "OK" : "FAIL");

    // click each theme
    for (const t of ["dark", "ember", "tide", "blossom", "light"]) {
      ev(`(() => { const b = [...document.querySelectorAll('.db-theme-swatch')].find(x => x.dataset.themeId === '${t}'); b.click(); return 'ok'; })()`);
      await sleep(420);
      const st = ev(`(() => JSON.stringify({ attr: document.documentElement.dataset.theme, stored: localStorage.getItem('diskgenie.theme') }))()`);
      console.log(`[click] ${t}:`, st);
    }
    shot("picker-light");

    // keyboard walk: focus the active swatch, arrow right twice
    ev(`(() => { document.querySelector('.db-theme-swatch[data-active="true"]').focus(); return 'ok'; })()`);
    ev(`(() => { document.querySelector('.db-theme-swatches').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return 'ok'; })()`);
    await sleep(450);
    const walk1 = ev(`(() => JSON.stringify({ focused: document.activeElement?.dataset.themeId, attr: document.documentElement.dataset.theme }))()`);
    console.log("[walk→1]", walk1);
    ev(`(() => { document.querySelector('.db-theme-swatches').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return 'ok'; })()`);
    await sleep(450);
    const walk2 = ev(`(() => JSON.stringify({ focused: document.activeElement?.dataset.themeId, attr: document.documentElement.dataset.theme }))()`);
    console.log("[walk→2]", walk2);
    shot("picker-walked");

    function shot(n) { ab(["screenshot", `${SHOTS}/${n}.png`]); }
  } finally { try { process.kill(-vite.pid); } catch {} }
})();
