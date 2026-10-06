#!/usr/bin/env node
/**
 * Session-15 browser behavioral proof (single invocation — the sandbox
 * reaps processes between tool calls). All interactions go through
 * eval-dispatched DOM events (React's delegated listeners hear them),
 * which sidesteps agent-browser's text-finder quirks with
 * icon+label buttons.
 *
 *  1. boot vite (mock backend), activate the simulated license (the
 *     LicenseDialog's own tour-key hook + its Activate button)
 *  2. scan This PC → at the WHOLE-PC view the sidebar storage card
 *     must read the AGGREGATE ("This PC", 2.56 TB = the mock's
 *     C: 512 GB + D: 2 TB), no chip current
 *  3. C: chip → the card swaps to "Local Disk (C:)" 512 GB AND the C:
 *     chip is marked current — THE owner report (the card used to
 *     never change on a flip)
 *  4. drill Users → dev → Documents — the card stays the C: volume
 *  5. select a file → "Duplicates here" is disabled (honest tooltip);
 *     back on the folder → click → the Duplicates tab opens with the
 *     scoped busy row, then the scoped result: "inside
 *     C:\Users\dev\Documents" with exactly the 1 fully-internal group
 *  6. screenshots for the VLM audit
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");

const ROOT = "/home/z/my-project/workspace/diskgenie-v2";
const SHOTS = `${ROOT}/ci-artifacts/s15`;
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
/** Click the first button in `scope` whose textContent contains `t`. */
const clickBtn = (t, scope = "document") =>
  ev(`(()=>{
    const b=[...${scope}.querySelectorAll('button')].find(x=>x.textContent.trim().includes(${JSON.stringify(t)})&&x.offsetParent!=null);
    if(!b) return 'NOT_FOUND:${t}';
    b.click(); return 'ok:${t}';
  })()`);
/** Double-click a folder card / file row by contained text. */
const dblCard = (t) =>
  ev(`(()=>{
    const b=[...document.querySelectorAll('.db-folder-card,.db-file-row')].find(x=>x.textContent.trim().includes(${JSON.stringify(t)}));
    if(!b) return 'NOT_FOUND:${t}';
    b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return 'ok:${t}';
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
  console.log("vite ready");

  try {
    ab(["open", `http://localhost:${PORT}/`]);
    await sleep(2400);
    ab(["set", "viewport", "1600", "1000"]);

    // ── license: fill via the dialog's tour hook, submit via its button ──
    ev(`window.dispatchEvent(new CustomEvent("db-tour-license-key", { detail: { key: "DB-7XK2M-9QF3P-8NR4T-2VW6Y" } }))`);
    await sleep(900);
    console.log("  [activate]", ev(`(()=>{
      const b=[...document.querySelectorAll('.db-license-dialog button')].find(x=>x.textContent.trim()==='Activate');
      if(!b) return 'no-btn';
      b.click(); return 'submitted';
    })()`));
    await sleep(1600);
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
    shot("01-pc-root");
    console.log("  [label @ root]", ev(`[...document.querySelectorAll('.db-section-meta')].map(e=>e.textContent).join('|')`));
    console.log("  [total @ root]", ev(`document.querySelector('.db-storage dl div:nth-child(1) dd')?.textContent`));
    console.log("  [active chips @ root]", ev(`document.querySelectorAll('.db-chip[data-active="true"]').length`));

    // ── C: chip ─────────────────────────────────────────────────────
    console.log("  [C: chip]", clickBtn("C:", "document.querySelector('.db-drives')"));
    await sleep(1200);
    shot("02-c-drive");
    console.log("  [label @ C:]", ev(`[...document.querySelectorAll('.db-section-meta')].map(e=>e.textContent).join('|')`));
    console.log("  [total @ C:]", ev(`document.querySelector('.db-storage dl div:nth-child(1) dd')?.textContent`));
    console.log("  [current chip @ C:]", ev(`document.querySelector('.db-chip[data-active="true"]')?.textContent.trim()`));
    console.log("  [view name @ C:]", ev(`document.querySelector('.db-current strong')?.textContent`));

    // ── drill Users → dev, then SELECT Documents (single click) ────
    for (const f of ["Users", "dev"]) {
      console.log(`  [drill ${f}]`, dblCard(f));
      await sleep(1000);
    }
    // Single-click the Documents card: the inspector target becomes
    // Documents (selectedNode wins) while the view stays at dev.
    console.log("  [select Documents]", ev(`(()=>{
      const b=[...document.querySelectorAll('.db-folder-card')].find(x=>x.textContent.trim().includes('Documents'));
      if(!b) return 'NOT_FOUND';
      b.click(); return 'ok';
    })()`));
    await sleep(900);
    shot("03-documents-selected");
    console.log("  [label @ Documents sel]", ev(`[...document.querySelectorAll('.db-section-meta')].map(e=>e.textContent).join('|')`));
    console.log("  [total @ C: view]", ev(`document.querySelector('.db-storage dl div:nth-child(1) dd')?.textContent`));
    console.log("  [view path @ dev]", ev(`document.querySelector('.db-current-path')?.textContent`));
    console.log("  [current chip]", ev(`document.querySelector('.db-chip[data-active="true"]')?.textContent.trim()`));
    console.log("  [inspector name]", ev(`document.querySelector('.db-inspector-title h2')?.textContent`));

    // ── inspector: file vs folder on the new button ─────────────────
    console.log("  [select file]", ev(`(()=>{
      const b=document.querySelector('.db-file-row');
      if(!b) return 'no-file-rows';
      b.click(); return 'selected';
    })()`));
    await sleep(800);
    console.log("  [insp name]", ev(`document.querySelector('.db-inspector-title h2')?.textContent`));
    console.log("  [dupes-here disabled @ file]", ev(`(()=>{
      const b=[...document.querySelectorAll('.db-inspector-actions button')].find(x=>x.textContent.includes('Duplicates here'));
      return b ? String(b.disabled) : 'NO_BUTTON';
    })()`));
    shot("04-file-selected");
    // Re-select the Documents folder card (the file selection loses).
    ev(`(()=>{
      const b=[...document.querySelectorAll('.db-folder-card')].find(x=>x.textContent.trim().includes('Documents'));
      if(b) b.click(); return 'reselected';
    })()`);
    await sleep(600);

    // ── the handoff: Duplicates here on Documents ───────────────────
    console.log("  [dupes-here @ folder]", clickBtn("Duplicates here", "document.querySelector('.db-inspector')"));
    await sleep(500);
    shot("05-dupes-busy");
    console.log("  [dupes tab sub (busy)]", ev(`document.querySelector('.db-tab-sub')?.textContent ?? 'NO_SUB'`));
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      if (ev(`String(document.querySelector('.db-dup-group') != null)`) === "true") break;
    }
    await sleep(700);
    shot("06-dupes-scoped-result");
    console.log("  [dupes subtitle]", ev(`document.querySelector('.db-tab-sub')?.textContent ?? 'NO_SUB'`));
    console.log("  [scoped groups]", ev(`document.querySelectorAll('.db-dup-group').length`));
    console.log("  [scoped paths]", ev(`[...document.querySelectorAll('.db-dup-file')].slice(0,3).map(e=>e.textContent.trim()).join(' || ')`));

    // ── back to Explore: the card is STILL C: (no drift) ────────────
    clickBtn("Explore", "document.querySelector('.db-tabcaps')");
    await sleep(1000);
    console.log("  [label back @ Documents]", ev(`[...document.querySelectorAll('.db-section-meta')].map(e=>e.textContent).join('|')`));
    shot("07-back-to-explore");

    console.log("SCRIPT_DONE");
  } finally {
    try { ab(["close"]); } catch { /* ignore */ }
    try { process.kill(-vite.pid, "SIGKILL"); } catch { /* ignore */ }
    try { process.kill(vite.pid, "SIGKILL"); } catch { /* ignore */ }
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
