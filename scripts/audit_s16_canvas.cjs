#!/usr/bin/env node
/**
 * Session-16 canvas drill audit: the treemap canvas repaints with the
 * ACTIVE theme (the MutationObserver path). Boot → activate → scan →
 * drill Users (treemap view) → flip themes via the picker → screenshot
 * + pixel-sample the canvas stage background/border per theme.
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SHOTS = `${ROOT}/ci-artifacts/s16`;
const PORT = 5198;
const AB = "/usr/local/bin/agent-browser";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ab(args) {
  return execFileSync(AB, args, { encoding: "utf8", timeout: 90_000 }).trim();
}
const ev = (js) => ab(["eval", js]);
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

  try {
    ab(["open", `http://localhost:${PORT}/`]);
    await sleep(2400);
    ab(["set", "viewport", "1600", "1000"]);

    // activate + scan
    ev(`window.dispatchEvent(new CustomEvent("db-tour-license-key", { detail: { key: "DB-7XK2M-9QF3P-8NR4T-2VW6Y" } }))`);
    await sleep(900);
    ev(`(()=>{
      const b=[...document.querySelectorAll('.db-license-dialog button')].find(x=>x.textContent.trim()==='Activate');
      if(b) b.click(); return 'submitted';
    })()`);
    await sleep(2100);
    ab(["press", "Escape"]);
    await sleep(500);
    clickBtn("Scan This PC", "document.querySelector('.db-sidebar')");
    const has = (sel) => ev(`String(document.querySelector(${JSON.stringify(sel)}) != null)`);
    for (let i = 0; i < 60; i++) {
      await sleep(300);
      if (has('[data-testid="scan-strip"]') === "false" && has(".db-visual-stage") === "true") break;
    }
    await sleep(1000);

    // drill into Users (folder-card dblclick at PC root)
    ev(`(()=>{
      const b=[...document.querySelectorAll('.db-folder-card')].find(x=>x.textContent.trim().includes('Users'));
      if(!b) return 'NOT_FOUND';
      b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return 'ok';
    })()`);
    await sleep(1400);
    // switch to Treemap mode explicitly (if not already)
    ev(`document.querySelector('.db-mode-picker button[aria-label="Treemap"]').click()`);
    await sleep(1400);
    console.log("  [canvas]", ev(`document.querySelectorAll('.db-viz-canvas-shell canvas').length`), "canvases");

    // per-theme: pick via dialog, close, sample the canvas corner + shot
    for (const id of ["dark", "ember", "tide", "blossom"]) {
      ev(`window.dispatchEvent(new CustomEvent("db-open-license"))`);
      await sleep(500);
      ev(`document.querySelector('.db-license-dialog .db-theme-swatch[data-theme-id="${id}"]').click()`);
      await sleep(800);
      ab(["press", "Escape"]);
      await sleep(600);
      // Sample the static canvas's top-left corner region (background
      // fill) via toDataURL pixel read — the repaint proof.
      const px = ev(`(()=>{
        const c=[...document.querySelectorAll('.db-viz-canvas-shell canvas')].find(x=>x.width>200);
        if(!c) return 'NO_CANVAS';
        const t=document.createElement('canvas'); t.width=8; t.height=8;
        const g=t.getContext('2d'); g.drawImage(c,0,0,8,8,0,0,8,8);
        const d=g.getImageData(0,0,4,4).data;
        return [d[0],d[1],d[2]].join(',');
      })()`);
      console.log(`  [canvas px @ ${id}]`, px);
      shot(`treemap-${id}`);
    }
    console.log("SCRIPT_DONE");
  } finally {
    try { ab(["close"]); } catch { /* ignore */ }
    try { process.kill(-vite.pid, "SIGKILL"); } catch { /* ignore */ }
    try { process.kill(vite.pid, "SIGKILL"); } catch { /* ignore */ }
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
