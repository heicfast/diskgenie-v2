#!/bin/bash
# mac-benchmark.sh — the macOS performance harness (session 17): launch
# the real app with the bench tour, sample memory/CPU throughout, then
# distill the [bench] lines + samples into a markdown report artifact.
#
# The [bench] lines come from the app itself (stderr):
#   [bench] window size applied: 1280x760    (the DISKGENIE_WINDOW hook)
#   [bench] scan done engine=… ms=… files=… dirs=… bytes=…
#   [bench] scan restored gen=… files=… …     (the flip-cache restore)
#   [dupes] compute finished at …             (the 3-pass pipeline)
# Plus this harness's own launch metric (time-to-window).
#
# Usage:
#   APP_BIN=… OUT_DIR=… LAUNCH_ENV="…" RUN_SECONDS=90 scripts/ci/mac-benchmark.sh
set -uo pipefail

APP_BIN=${APP_BIN:?APP_BIN required}
OUT_DIR=${OUT_DIR:?OUT_DIR required}
RUN_SECONDS=${RUN_SECONDS:-90}
SAMPLE_MS=${SAMPLE_MS:-500}

mkdir -p "$OUT_DIR"
STDOUT_LOG="$OUT_DIR/app-stdout.log"
STDERR_LOG="$OUT_DIR/app-stderr.log"
SAMPLES_CSV="$OUT_DIR/memory-samples.csv"

LAUNCH_T0=$(python3 -c 'import time; print(int(time.time()*1000))')
# shellcheck disable=SC2086
env $LAUNCH_ENV "$APP_BIN" >"$STDOUT_LOG" 2>"$STDERR_LOG" &
APP_PID=$!

# Time-to-window: same CGWindowList poll as the capture harness.
win_id() {
  osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var list;
    try { list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1, 0)); }
    catch (e) { list = []; }
    if (!list) list = [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      var owner = String(w.kCGWindowOwnerName || "").toLowerCase();
      var layer = Number(w.kCGWindowLayer || 0);
      if (layer === 0 && owner.indexOf("diskgenie") !== -1) {
        console.log(String(w.kCGWindowNumber));
      }
    }
  ' 2>/dev/null | head -1
}
for _ in $(seq 1 200); do
  if [ -n "$(win_id)" ]; then break; fi
  sleep 0.1
done
LAUNCH_T1=$(python3 -c 'import time; print(int(time.time()*1000))')
T2W=$((LAUNCH_T1 - LAUNCH_T0))
echo "[bench] window visible after=${T2W}ms"

# Memory/CPU sampling for the whole run (rss kb + cpu %).
echo "t_s,rss_mb,cpu_pct" >"$SAMPLES_CSV"
T_START=$(python3 -c 'import time; print(time.time())')
while kill -0 "$APP_PID" 2>/dev/null; do
  now=$(python3 -c 'import time; print(round(time.time() - '"$T_START"', 1))')
  rss=$(ps -o rss= -p "$APP_PID" 2>/dev/null | tr -d ' ')
  cpu=$(ps -o %cpu= -p "$APP_PID" 2>/dev/null | tr -d ' ')
  if [ -n "$rss" ]; then
    echo "${now},$(python3 -c "print(round($rss/1024, 1))"),${cpu:-0}" >>"$SAMPLES_CSV"
  fi
  sleep "$(python3 -c "print($SAMPLE_MS/1000)")"
done &
SAMPLER_PID=$!
sleep "$RUN_SECONDS"
kill "$SAMPLER_PID" 2>/dev/null || true
kill "$APP_PID" 2>/dev/null || true
for _ in $(seq 1 30); do
  kill -0 "$APP_PID" 2>/dev/null || break
  sleep 0.2
done
kill -9 "$APP_PID" 2>/dev/null || true

# ── Distill the report ────────────────────────────────────────────
python3 - "$OUT_DIR" "$T2W" "$RUN_SECONDS" << 'PYEOF'
import csv
import json
import re
import sys
import pathlib

out_dir = pathlib.Path(sys.argv[1])
t2w = int(sys.argv[2])
run_seconds = int(sys.argv[3])
stderr = (out_dir / "app-stderr.log").read_text(errors="replace")
stdout = (out_dir / "app-stdout.log").read_text(errors="replace")

scan_done = re.findall(r"\[bench\] scan done engine=(\S+) gen=\d+ ms=(\d+) files=(\d+) dirs=(\d+) bytes=(\d+)", stderr)
scan_restored = re.findall(r"\[bench\] scan restored gen=\d+ files=(\d+) dirs=(\d+) bytes=(\d+)", stderr)
dupes = re.findall(r"\[dupes\] compute finished at ([0-9a-z. ]+)", stderr)
window = re.findall(r"\[bench\] window size applied: (\S+)", stderr)

rows = []
with open(out_dir / "memory-samples.csv") as f:
    for row in csv.DictReader(f):
        try:
            rows.append((float(row["t_s"]), float(row["rss_mb"]), float(row["cpu_pct"])))
        except (ValueError, KeyError):
            pass

def human(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024.0 or unit == "TB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} TB"

lines = []
lines.append("# DiskGenie — macOS benchmark report")
lines.append("")
lines.append(f"Runner: `macos-latest` · Run window: {run_seconds} s · Time-to-window: **{t2w} ms**")
if window:
    lines.append(f"Window hook applied: {window[0]}")
lines.append("")
lines.append("## Scan engine (the staged synthetic tree)")
if scan_done:
    lines.append("| pass | engine | ms | files | folders | bytes |")
    lines.append("|---|---|---|---|---|---|")
    for i, (engine, ms, files, dirs, byts) in enumerate(scan_done):
        lines.append(f"| {i + 1} | {engine} | {ms} | {int(files):,} | {int(dirs):,} | {human(int(byts))} |")
else:
    lines.append("_(no `[bench] scan done` line — the scan never completed; see app-stderr.log)_")
lines.append("")
lines.append("## Flip-cache restore (re-scan of the same target)")
if scan_restored:
    lines.append(f"**Instant restore confirmed** — {len(scan_restored)} restore probe(s):")
    lines.append("")
    lines.append("| files | folders | bytes |")
    lines.append("|---|---|---|")
    for files, dirs, byts in scan_restored:
        lines.append(f"| {int(files):,} | {int(dirs):,} | {human(int(byts))} |")
else:
    lines.append("_(no `[bench] scan restored` line — the cache did not serve; investigate)_")
lines.append("")
lines.append("## Duplicates pipeline")
lines.append(f"Compute finished at: {dupes[0] if dupes else '_(not observed)_'}")
lines.append("")
lines.append("## Memory / CPU (whole run)")
if rows:
    peak = max(r[1] for r in rows)
    peak_t = [r[0] for r in rows if r[1] == peak][0]
    final = rows[-1][1]
    peak_cpu = max(r[2] for r in rows)
    lines.append(f"- Peak RSS: **{peak:.0f} MB** at t={peak_t:.0f}s (scan window)")
    lines.append(f"- Resting RSS (end of run): {final:.0f} MB")
    lines.append(f"- Peak process CPU: {peak_cpu:.0f}%")
else:
    lines.append("_(no memory samples)_")
lines.append("")
lines.append("## Raw `[bench]` lines")
for line in stderr.splitlines():
    if "[bench]" in line or "[dupes]" in line:
        lines.append(f"- `{line.strip()}`")
lines.append("")
extra = [l for l in stderr.splitlines() if "panicked" in l or "ERROR" in l]
if extra:
    lines.append("## ⚠ Panics / errors in stderr")
    for line in extra[:20]:
        lines.append(f"- `{line.strip()}`")

(out_dir / "BENCHMARK.md").write_text("\n".join(lines) + "\n")
print(f"report written: {out_dir / 'BENCHMARK.md'}")
PYEOF
exit 0
