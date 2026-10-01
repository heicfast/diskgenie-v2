#!/bin/bash
# mac-stage-tree.sh — stage the synthetic scan tree for the macOS
# workflows (session 17). BALANCED top-level branches (the Windows
# staging's discipline: an unbalanced tree renders one 99% branch and
# the by-folder treemap reads monochrome) + mac-realistic paths
# (~/Library layers, .app bundle). Sparse files via mkfile (instant on
# APFS) with a dd fallback. Total ≈ 12 GB logical — the runner's free
# disk is limited (the Windows staging's 15 GB ceiling lesson).
#
# Usage: ROOT=${1:-$HOME/diskbytes-test}
set -uo pipefail

R=${1:-$HOME/diskbytes-test}
big() { # big <bytes> <path>
  mkdir -p "$(dirname "$2")"
  mkfile "$1" "$2" 2>/dev/null || dd if=/dev/zero of="$2" bs=1048576 count=$(( $1 / 1048576 )) status=none
}
rand() { # rand <min> <max> <path>
  mkdir -p "$(dirname "$3")"
  head -c $(( (RANDOM % ( ($2 - $1) + 1 )) + $1 )) /dev/urandom >"$3"
}

mkdir -p "$R/Users/dev/Desktop" \
  "$R/Users/dev/Documents/Work/Invoices 2026" \
  "$R/Users/dev/Downloads" \
  "$R/Users/dev/Pictures/Camera Roll" \
  "$R/Users/dev/Videos" \
  "$R/Users/dev/Projects/website-2026/node_modules/react" \
  "$R/Users/dev/Projects/scanner/target/debug" \
  "$R/Users/dev/Library/Caches/Google/Chrome/Default" \
  "$R/Users/dev/Library/Logs" \
  "$R/Users/dev/Library/Application Support/MobileSync/Backup" \
  "$R/Applications/Tools.app/Contents/MacOS" \
  "$R/Applications/Photo Studio 2027.app/Contents/Resources" \
  "$R/Library/Developer/Xcode/DerivedData" \
  "$R/private/var/log" \
  "$R/System/Library/Extensions"

# Big media + VM images (sparse — instant):
big 2684354560 "$R/Users/dev/Videos/holiday-4k.mov"
big 1288490188 "$R/Users/dev/Videos/render-final.mp4"
big 2147483648 "$R/Users/dev/Downloads/ubuntu-26.04.iso"
big 1342177280 "$R/Users/dev/Downloads/backup-2026.qcow2"
big 104857600  "$R/Users/dev/Pictures/raw-shoot-001.cr3"
big 47185920   "$R/Users/dev/Documents/annual-report.pdf"
big 1342177280 "$R/Applications/Photo Studio 2027.app/Contents/Resources/psresources.psr"
big 536870912  "$R/Applications/Tools.app/Contents/MacOS/toolsd"
big 1342177280 "$R/Library/Developer/Xcode/DerivedData/build-index.dat"
big 805306368  "$R/private/var/log/system.log"
big 536870912  "$R/System/Library/Extensions/BigDriver.kext/Contents/MacOS/BigDriver"

# Medium + small real files across categories (the age map + type mix):
for i in $(seq 1 30); do rand 4096 2097152 "$R/Users/dev/Desktop/notes-$i.txt"; done
for i in $(seq 1 24); do rand 8192 8388608 "$R/Users/dev/Projects/website-2026/node_modules/react/chunk-$i.js"; done
for i in $(seq 1 18); do rand 1024 1048576 "$R/Users/dev/Library/Logs/app-$i.log"; done
for i in $(seq 1 12); do rand 262144 262144 "$R/Users/dev/Library/Caches/Google/Chrome/Default/data-$i"; done
for i in $(seq 1 10); do rand 65536 5242880 "$R/Users/dev/Documents/Work/Invoices 2026/invoice-2026-$i.pdf"; done
for i in $(seq 1 9);  do rand 32768 2097152 "$R/Users/dev/Pictures/Camera Roll/IMG_26$(printf '%02d' "$i").jpg"; done
for i in $(seq 1 14); do rand 2048 1048576 "$R/Applications/Tools.app/Contents/MacOS/tool-$i.dylib"; done
for i in $(seq 1 7);  do rand 4096 52428800 "$R/Users/dev/Projects/scanner/target/debug/scanner-$i.bin"; done
for i in $(seq 1 8);  do rand 1048576 8388608 "$R/Users/dev/Library/Application Support/MobileSync/Backup/backup-$i.db"; done

# A duplicate pair (the dupes pipeline's group): same bytes, two paths.
rand 8388608 8388608 "$R/Users/dev/Downloads/photo-archive.zip"
cp "$R/Users/dev/Downloads/photo-archive.zip" "$R/Users/dev/Pictures/Camera Roll/photo-archive.zip"

echo "staged $(find "$R" | wc -l | tr -d ' ') entries under $R"
