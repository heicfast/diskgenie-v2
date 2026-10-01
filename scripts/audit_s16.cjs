#!/usr/bin/env node
/**
 * Session-16 browser behavioral proof (single invocation — the sandbox
 * reaps processes between tool calls). All interactions go through
 * eval-dispatched DOM events (React's delegated listeners hear them).
 *
 * The theme system end-to-end, through the REAL user path:
 *  1. boot vite (mock backend) — unlicensed boot auto-opens the
 *     license dialog, which now carries the ThemePicker
 *  2. PHASE A (entry body): click each of the five swatches; verify
 *     data-theme + data-scheme + localStorage persistence + the
 *     computed --ink token + the active-swatch ring + the current-name
 *     label; screenshot the dialog under each palette
 *  3. activate the simulated license (tour-key hook + Activate) — the
 *     dialog closes itself
 *  4. scan This PC (content for the app surfaces)
 *  5. PHASE B (Pro status body): reopen the dialog — the picker must
 *     ALSO live in the status card; pick each theme again, close,
 *     screenshot the full app (treemap + sidebar + inspector)
 *  6. Monitor page under each theme (the data surfaces: segments,
 *     sparklines, ring)
 *  7. the topbar quick-toggle semantics: on Ember it must return to
 *     LIGHT (family flip), not cycle
 *  8. reload: the persisted theme must survive (pre-mount script)
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SHOTS = `${ROOT}/ci-artifacts/s16`;
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
  ab(["screenshot", `${SHOTS}/${name}.png`]);
  console.log(`  [shot] ${name}.png`);
}
const clickBtn = (t, scope = "document") =>
  ev(`(()=>{
    const b=[...${scope}.querySelectorAll('button')].find(x=>x.textContent.trim().includes(${JSON.stringify(t)})&&x.offsetParent!=null);
    if(!b) return 'NOT_FOUND:${t}';
    b.click(); return 'ok:${t}';
  })()`);

/** The expected scheme + ink per theme (mirrors tokens.css). */
const THEMES = [
  { id: "light", scheme: "light", ink: "#ff6b4a" },
  { id: "dark", scheme: "dark", ink: "#ff7a5c" },
  { id: "ember", scheme: "dark", ink: "#f2b04e" },
  { id: "tide", scheme: "dark", ink: "#3fc5f2" },
  { id: "blossom", scheme: "light", ink: "#d8506b" },
];

/** Click a picker swatch inside the license dialog + verify adoption. */
async function pickTheme(t) {
  ev(`(()=>{
    const b=document.querySelector('.db-license-dialog .db-theme-swatch[data-theme-id="${t.id}"]');
    if(!b) return 'NO_SWATCH';
    b.click(); return 'clicked';
  })()`);
  await sleep(650); // view-transition crossfade + canvas repaint
  const themeAttr = ev(`document.documentElement.getAttribute('data-theme')`);
  const schemeAttr = ev(`document.documentElement.getAttribute('data-scheme')`);
  const stored = ev(`localStorage.getItem('diskgenie.theme')`);
  const ink = ev(`getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()`);
  const activeSwatch = ev(`document.querySelector('.db-license-dialog .db-theme-swatch[data-active="true"]')?.getAttribute('data-theme-id')`);
  const currentLabel = ev(`document.querySelector('.db-theme-picker-current')?.textContent`);
  console.log(
    `  [theme ${t.id}] attr=${themeAttr} scheme=${schemeAttr} stored=${stored} ink=${ink} ring=${activeSwatch} label=${currentLabel}`,
  );
  const ok = themeAttr === t.id && schemeAttr === t.scheme && stored === t.id &&
    ink.replace(/\s/g, "") === t.ink.replace("#", "#") && activeSwatch === t.id &&
    currentLabel && currentLabel.toLowerCase() === t.id;
  return ok ? "OK" : "MISMATCH";
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT, stdio: "pipe", detached: true,
  });
  vite.stdout.on("data", () => { /* quiet */ });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    try {
      execFileSync("node", ["-e", `fetch("http://localhost:${PORT}/").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`], { timeout: 4000 });
      ready = true;
    } catch { /* retry */ }
  }
  if (!ready) throw new Error("vite never became ready");
  console.log("vite ready");

  try {
    ab(["open", `http://localhost:${PORT}/`]);
    await sleep(2400);
    ab(["set", "viewport", "1600", "1000"]);

    // ── PHASE A: the auto-opened dialog (entry body) + the picker ──
    console.log("  [boot dialog]", ev(`document.querySelector('.db-license-dialog') ? 'open' : 'closed'`));
    console.log("  [swatch count]", ev(`document.querySelectorAll('.db-license-dialog .db-theme-swatch').length`));
    for (const t of THEMES) {
      console.log(`  [pick A ${t.id}]`, await pickTheme(t));
      shot(`dialog-${t.id}`);
    }

    // ── activate the simulated license ─────────────────────────────
    ev(`window.dispatchEvent(new CustomEvent("db-tour-license-key", { detail: { key: "DB-7XK2M-9QF3P-8NR4T-2VW6Y" } }))`);
    await sleep(900);
    console.log("  [activate]", ev(`(()=>{
      const b=[...document.querySelectorAll('.db-license-dialog button')].find(x=>x.textContent.trim()==='Activate');
      if(!b) return 'no-btn';
      b.click(); return 'submitted';
    })()`));
    await sleep(2100); // success state + auto-close
    ab(["press", "Escape"]);
    await sleep(700);
    console.log("  [scrim]", ev(`document.querySelector('.db-scrim') ? 'open' : 'closed'`));

    // ── scan This PC ────────────────────────────────────────────────
    console.log("  [scan]", clickBtn("Scan This PC", "document.querySelector('.db-sidebar')"));
    const has = (sel) => ev(`String(document.querySelector(${JSON.stringify(sel)}) != null)`);
    for (let i = 0; i < 60; i++) {
      await sleep(300);
      if (has('[data-testid="scan-strip"]') === "false" && has(".db-visual-stage") === "true") break;
    }
    await sleep(1100);
    shot("app-light-baseline");

    // ── PHASE B: the Pro STATUS body must carry the picker too ─────
    for (const t of THEMES) {
      ev(`window.dispatchEvent(new CustomEvent("db-open-license"))`);
      await sleep(500);
      const inStatus = ev(`String(document.querySelector('.db-license-dialog .db-theme-swatch') != null)`);
      console.log(`  [pick B ${t.id}] statusBody=${inStatus}`, await pickTheme(t));
      shot(`dialog-status-${t.id}`);
      ab(["press", "Escape"]);
      await sleep(450);
      shot(`app-${t.id}`);
    }

    // ── Monitor page under each theme ──────────────────────────────
    for (const t of THEMES) {
      ev(`window.dispatchEvent(new CustomEvent("db-open-license"))`);
      await sleep(500);
      ev(`document.querySelector('.db-license-dialog .db-theme-swatch[data-theme-id="${t.id}"]').click()`);
      await sleep(650);
      ab(["press", "Escape"]);
      await sleep(400);
      console.log("  [monitor tab]", clickBtn("Monitor", "document.querySelector('.db-tabcaps')"));
      await sleep(1500);
      shot(`monitor-${t.id}`);
      clickBtn("Explore", "document.querySelector('.db-tabcaps')");
      await sleep(900);
    }

    // ── topbar quick-toggle: family flip, never a cycle ────────────
    ev(`window.dispatchEvent(new CustomEvent("db-open-license"))`);
    await sleep(500);
    ev(`document.querySelector('.db-license-dialog .db-theme-swatch[data-theme-id="ember"]').click()`);
    await sleep(650);
    ab(["press", "Escape"]);
    await sleep(400);
    console.log("  [on ember]", ev(`document.documentElement.getAttribute('data-theme')`));
    ev(`document.querySelector('.db-icon-button[aria-label="Use light theme"]')?.click()`);
    await sleep(650);
    console.log("  [toggle from ember]", ev(`document.documentElement.getAttribute('data-theme')`), "(expect light)");

    // ── persistence across reload (the pre-mount script) ───────────
    ab(["open", `http://localhost:${PORT}/`]);
    await sleep(2200);
    console.log("  [after reload]", ev(`document.documentElement.getAttribute('data-theme')`),
      ev(`document.documentElement.getAttribute('data-scheme')`), "(expect light light — last toggle)");

    console.log("SCRIPT_DONE");
  } finally {
    try { ab(["close"]); } catch { /* ignore */ }
    try { process.kill(-vite.pid, "SIGKILL"); } catch { /* ignore */ }
    try { process.kill(vite.pid, "SIGKILL"); } catch { /* ignore */ }
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
