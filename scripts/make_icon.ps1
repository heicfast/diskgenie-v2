# DiskBytes icon fan-out (doc 03 M11.1, updated for the DiskBytes Icon Pack
# redesign): the brand source is a COMMITTED design asset
# (packaging/icon/icon-source.png — the pack's transparent 1024 master:
# a flat coral-orange circle with the white DiskBytes spiral mark,
# floating with transparent margins; macOS additionally ships the pack's
# own DiskBytes.icns verbatim). Supersedes the v3 3D HDD+broom squircle.
# This script only fans the source out to every platform size via
# `npx tauri icon`.
#
# To update the brand: replace packaging/icon/icon-source.png with the
# new square RGBA source (>=1024px, transparent corners OK), then run
# this script (or push — CI runs it on every Windows build).
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
