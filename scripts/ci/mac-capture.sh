#!/bin/bash
# mac-capture.sh — launch the REAL app on a macOS runner and capture
# the screenshot tour (session 17). ONE implementation shared by the
# macOS workflows (ui-audit, license-e2e, benchmark, and the build's
# smoke pass), replacing the broken per-workflow capture blocks.
#
# What was broken before (the owner's "zoomed on every screenshot"):
#   1. The runner's display is 1024x768; the app's design floor is
#      1280x760 — the window physically exceeded the screen, so every
#      capture cropped the right column (the inspector) away and the
#      UI read as "zoomed". The Windows flow bumps its display to
#      1920x1080; the mac flow never did. → bump here, best-effort.
#   2. `screencapture -x` (full screen) includes the menu bar + dock
#      and only the ON-SCREEN part of the window. → capture the WINDOW
#      itself (`screencapture -l <id>`), which composites the window's
#      full bounds, plus periodic full-screen context frames.
#   3. `open --env` hides stdout/stderr — no diagnostics. → launch the
#      release binary directly with env vars and redirected logs.
#   4. (round 2) The JXA CGWindowList probe failed on the runner
#      ("window NOT FOUND") → the 20 s poll + fallback made frame 00
#      land ~64 s into the tour (the early steps ran uncaptured). → a
#      compiled Swift probe (real CoreGraphics, no JXA bridging) + an
#      8 s poll budget + a 5 s boot wait — frame 00 lands at ~7 s.
#
# Usage (env-driven):
#   APP_BIN=src-tauri/target/release/diskgenie  # required
#   OUT_DIR=$RUNNER_TEMP/shots                  # required
#   FRAMES=48                                   # capture count
#   CADENCE_MS=2600                             # frame cadence
#   BOOT_WAIT_S=5                               # pre-first-frame settle
#   LAUNCH_ENV="DISKGENIE_SCAN=... DISKGENIE_TOUR=1"  # app env
#   DISPLAY_BUMP=1920x1080                      # 0 = skip the bump
#   KEEP_RUNNING=1                              # do not quit at the end
#   FULL_CONTEXT=1                              # also capture whole-screen frames
#
# Emits (stdout, for the workflow log + benchmark parsing):
#   [bench] display before=1024x768 after=1920x1080
#   [bench] window visible after=1234ms winid=123  (launch metric)
#   [bench] captured frame=00 …
set -uo pipefail

APP_BIN=${APP_BIN:?APP_BIN required}
OUT_DIR=${OUT_DIR:?OUT_DIR required}
FRAMES=${FRAMES:-48}
CADENCE_MS=${CADENCE_MS:-2600}
BOOT_WAIT_S=${BOOT_WAIT_S:-5}
DISPLAY_BUMP=${DISPLAY_BUMP:-1920x1080}
KEEP_RUNNING=${KEEP_RUNNING:-0}
FULL_CONTEXT=${FULL_CONTEXT:-1}

mkdir -p "$OUT_DIR"
LOG_DIR="$OUT_DIR"
STDOUT_LOG="$LOG_DIR/app-stdout.log"
STDERR_LOG="$LOG_DIR/app-stderr.log"

# ── 1. Display: probe, then bump when a tool exists (best-effort) ──
display_px() {
  local tmp
  tmp=$(mktemp -t probe).png || return 0
  screencapture -x "$tmp" 2>/dev/null || return 0
  sips -g pixelWidth -g pixelHeight "$tmp" 2>/dev/null | awk '/pixelWidth|pixelHeight/ {printf "%s", $2}' && rm -f "$tmp"
}
before_px=$(display_px)
if [ -n "$DISPLAY_BUMP" ] && [ "$DISPLAY_BUMP" != "0" ]; then
  # screenresolution (fast, preinstalled on some images) or displayplacer
  # (brew). Both are best-effort: a failed bump still leaves window
  # captures usable — only the full-screen context frames stay 1024x768.
  if command -v screenresolution >/dev/null 2>&1; then
    screenresolution set "$DISPLAY_BUMP" 2>&1 | head -1 || true
  elif command -v displayplacer >/dev/null 2>&1; then
    displayplacer "res:$DISPLAY_BUMP" 2>&1 | head -2 || true
  else
    echo "[bench] note=no resolution tool (screenresolution/displayplacer) — capturing at the default"
  fi
fi
after_px=$(display_px)
echo "[bench] display before=${before_px:-unknown} after=${after_px:-unknown}"

# ── 2. The window-id probe: a compiled Swift CLI (real CoreGraphics —
# the JXA ObjC bridge proved unreliable on the runner) with the JXA
# form as fallback. Compiled ONCE here; the poll re-runs the binary.
WINID_BIN=""
make_winid_bin() {
  local src bin
  src=$(mktemp -t winid).swift
  bin="$RUNNER_TEMP/diskgenie-winid"
  cat >"$src" <<'SWIFT'
import CoreGraphics
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly)
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
for w in list {
    let owner = (w["kCGWindowOwnerName"] as? String ?? "").lowercased()
    let layer = (w["kCGWindowLayer"] as? Int) ?? 0
    if layer == 0 && owner.contains("diskgenie") {
        if let num = w["kCGWindowNumber"] as? Int { print(num); exit(0) }
    }
}
exit(1)
SWIFT
  if swiftc -O -o "$bin" "$src" 2>/dev/null; then
    echo "$bin"
  fi
  rm -f "$src"
}
win_id() {
  if [ -n "$WINID_BIN" ]; then
    "$WINID_BIN" 2>/dev/null && return 0 || return 1
  fi
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

# ── 3. Launch the release binary (env + redirected logs) ──────────
# shellcheck disable=SC2086
env $LAUNCH_ENV "$APP_BIN" >"$STDOUT_LOG" 2>"$STDERR_LOG" &
APP_PID=$!

# ── 4. Time-to-window (the launch metric) — 8 s budget ───────────
WINID_BIN=$(make_winid_bin)
LAUNCH_T0=$(python3 -c 'import time; print(int(time.time()*1000))')
WINDOW_ID=""
# TIME-bounded, not iteration-bounded: each osascript invocation costs
# ~300 ms when the JXA path fails, so an iteration budget silently
# became a 77 s poll (the first benchmark's time-to-window). 8 s of
# WALL CLOCK, enforced here.
WIN_DEADLINE=$(python3 -c 'import time; print(time.time() + 8)')
# NOTE: the -c body must be DOUBLE-quoted so $WIN_DEADLINE expands before
# python parses it — the single-quoted form shipped a Python SyntaxError on
# every iteration (the literal `$WIN_DEADLINE` is invalid Python), so the
# "time-bounded" loop body NEVER RAN and the probe was never given a chance.
while [ "$(python3 -c "import time; print(time.time() < $WIN_DEADLINE)")" = "True" ]; do
  WINDOW_ID=$(win_id)
  if [ -n "$WINDOW_ID" ]; then break; fi
  sleep 0.1
done
if [ -n "$WINDOW_ID" ]; then
  LAUNCH_T1=$(python3 -c 'import time; print(int(time.time()*1000))')
  echo "[bench] window visible after=$((LAUNCH_T1 - LAUNCH_T0))ms winid=$WINDOW_ID probe=${WINID_BIN:+swift}${WINID_BIN:-jxa}"
else
  echo "[bench] window NOT FOUND within 8s — falling back to full-screen capture"
  # Diagnostics: WHY did the probe miss? Dump the layer-0 window owners the
  # runner actually exposes (the owner name may differ from the expected
  # bundle name; privacy filtering may return empty names — both visible
  # in one line).
  osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var list;
    try { list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1, 0)); }
    catch (e) { list = []; }
    if (!list) list = [];
    var owners = [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (Number(w.kCGWindowLayer || 0) === 0) {
        owners.push(String(w.kCGWindowOwnerName || "<no-name>"));
      }
    }
    console.log("layer0 owners: " + owners.join(" | "));
  ' 2>/dev/null || true
fi

# ── 5. Boot settle, then the cadence loop ─────────────────────────
sleep "$BOOT_WAIT_S"
i=0
while [ "$i" -lt "$FRAMES" ]; do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[bench] app exited before frame=$i"
    break
  fi
  f="$OUT_DIR/step-$(printf '%02d' "$i")"
  if [ -n "$WINDOW_ID" ]; then
    # Re-resolve each loop: a fullscreen transition can recreate the
    # window id (the id is stable in practice, but the re-probe costs
    # ~10 ms and makes the loop self-healing).
    WINDOW_ID=$(win_id || echo "$WINDOW_ID")
    # -l takes its value attached (`-l<id>` per the screencapture man
    # page); the fallback keeps the loop alive on any capture error.
    screencapture -x -o -l"$WINDOW_ID" "$f.png" 2>/dev/null || screencapture -x "$f.png" 2>/dev/null || true
  else
    screencapture -x "$f.png" 2>/dev/null || true
  fi
  if [ "$FULL_CONTEXT" = "1" ] && [ $((i % 12)) -eq 0 ]; then
    screencapture -x "$f-full.png" 2>/dev/null || true
  fi
  echo "[bench] captured frame=$(printf '%02d' "$i")"
  i=$((i + 1))
  sleep "$(python3 -c "print($CADENCE_MS/1000)")"
done

# ── 6. Quit ───────────────────────────────────────────────────────
if [ "$KEEP_RUNNING" != "1" ]; then
  kill "$APP_PID" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$APP_PID" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$APP_PID" 2>/dev/null || true
fi
echo "[bench] capture complete: $(ls "$OUT_DIR" | grep -c 'step-.*\.png') frames in $OUT_DIR"
exit 0
