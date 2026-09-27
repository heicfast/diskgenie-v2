# DiskBytes icon fan-out (doc 03 M11.1, updated for the PhotoIcon pack —
# the photorealistic "hard drive + brush" circular badge): the brand
# source is a COMMITTED design asset (packaging/icon/icon-source.png —
# the pack's 1254x1254 transparent master; a raster illustration with the
# orange background baked in and transparent corners, full-bleed circle).
# `npx tauri icon` fans it out to every platform size, THEN the pack's own
# hand-tuned Windows ico and macOS icns are overlaid on top:
#   packaging/icon/DiskBytes.ico  (16-256 multi-size; Lanczos + light
#                                  unsharp at <=48px so the photoreal
#                                  badge stays crisp at taskbar sizes)
#   packaging/icon/DiskBytes.icns (the pack's full 10-image iconset,
#                                  packed by the designer)
# The overlay is what makes small sizes survive: tauri's plain area
# resample softens a detailed raster into mush at 16px; the pack's
# exports keep the silhouette readable (per the pack's own README).
#
# To update the brand: replace the three files in packaging/icon/
# (icon-source.png + DiskBytes.ico + DiskBytes.icns), then run this
# script (or push — CI runs it on every Windows build).
param(
    [string]$AppRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"
$source = Join-Path $AppRoot "packaging/icon/icon-source.png"
$ico    = Join-Path $AppRoot "packaging/icon/DiskBytes.ico"
$icns   = Join-Path $AppRoot "packaging/icon/DiskBytes.icns"
if (-not (Test-Path $source)) { throw "brand source missing: $source" }
if (-not (Test-Path $ico))    { throw "brand ico missing: $ico" }
if (-not (Test-Path $icns))   { throw "brand icns missing: $icns" }

Write-Host "== DiskBytes icon: fanning out sizes (npx tauri icon) =="
Set-Location $AppRoot
npx tauri icon $source
if ($LASTEXITCODE -ne 0) { throw "tauri icon failed" }

# Overlay the designer's hand-tuned ico/icns over the generated ones —
# CI output then matches the committed src-tauri/icons/ exactly.
Copy-Item $ico  (Join-Path $AppRoot "src-tauri/icons/icon.ico")  -Force
Copy-Item $icns (Join-Path $AppRoot "src-tauri/icons/icon.icns") -Force
Write-Host "Overlaid the pack's DiskBytes.ico + DiskBytes.icns on the generated set."

Write-Host "Done — src-tauri/icons/ regenerated from the brand source."
