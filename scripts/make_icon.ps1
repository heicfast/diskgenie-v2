# DiskBytes icon fan-out (doc 03 M11.1, updated for Icon Pack v2): the
# 1024x1024 brand source is a COMMITTED design asset
# (packaging/icon/icon-source.png — the orange squircle HDD + broom from
# DiskBytes-Icon-Pack-v2; superseded the programmatic ink-square
# generator, which was retired with its example). This script only fans
# the source out to every platform size via `npx tauri icon`.
#
# To update the brand: replace packaging/icon/icon-source.png with the
# new 1024x1024 RGBA source, then run this script (or push — CI runs it
# on every Windows build).
param(
    [string]$AppRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"
$source = Join-Path $AppRoot "packaging/icon/icon-source.png"
if (-not (Test-Path $source)) { throw "brand source missing: $source" }

Write-Host "== DiskBytes icon: fanning out sizes (npx tauri icon) =="
Set-Location $AppRoot
npx tauri icon $source
if ($LASTEXITCODE -ne 0) { throw "tauri icon failed" }

Write-Host "Done — src-tauri/icons/ regenerated from the brand source."
