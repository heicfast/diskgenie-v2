# DiskGenie icon fan-out (doc 03 M11.1, updated session 18 — the
# theme-gradient master): the brand source is a COMMITTED design asset
# (packaging/icon/icon-source.png — the pack's 1254x1254 photoreal
# "hard drive + brush" badge, background-removed at the pixel level and
# re-composited over the DEFAULT theme's --ink-grad coral gradient,
# full-bleed circle; the disk+broom cutout keeps its soft shadow as a
# black-alpha layer so the depth survives the gradient base). `npx tauri
# icon` fans it out to every platform size, THEN the hand-packed Windows
# ico and macOS icns are overlaid on top:
#   packaging/icon/DiskGenie.ico  (16-256 multi-size; BMP entries <=48px +
#                                  PNG >=64px, Lanczos + light unsharp at
#                                  <=48px so the badge stays crisp at
#                                  taskbar sizes)
#   packaging/icon/DiskGenie.icns (ic07..ic14 PNG chunks, 32..1024)
# The in-app mark is the SEPARATE transparent cutout
# (src/assets/brand-mark.png) painted over var(--ink-grad) by CSS — it
# follows the selected theme live; this static set carries the default
# (light) gradient for the OS surfaces (taskbar, dock, installers).
#
# To update the brand: replace the three files in packaging/icon/
# (icon-source.png + DiskGenie.ico + DiskGenie.icns), then run this
# script (or push — CI runs it on every Windows build).
param(
    [string]$AppRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"
$source = Join-Path $AppRoot "packaging/icon/icon-source.png"
$ico    = Join-Path $AppRoot "packaging/icon/DiskGenie.ico"
$icns   = Join-Path $AppRoot "packaging/icon/DiskGenie.icns"
if (-not (Test-Path $source)) { throw "brand source missing: $source" }
if (-not (Test-Path $ico))    { throw "brand ico missing: $ico" }
if (-not (Test-Path $icns))   { throw "brand icns missing: $icns" }

Write-Host "== DiskGenie icon: fanning out sizes (npx tauri icon) =="
Set-Location $AppRoot
npx tauri icon $source
if ($LASTEXITCODE -ne 0) { throw "tauri icon failed" }

# Overlay the designer's hand-tuned ico/icns over the generated ones —
# CI output then matches the committed src-tauri/icons/ exactly.
Copy-Item $ico  (Join-Path $AppRoot "src-tauri/icons/icon.ico")  -Force
Copy-Item $icns (Join-Path $AppRoot "src-tauri/icons/icon.icns") -Force
Write-Host "Overlaid the pack's DiskGenie.ico + DiskGenie.icns on the generated set."

Write-Host "Done — src-tauri/icons/ regenerated from the brand source."
