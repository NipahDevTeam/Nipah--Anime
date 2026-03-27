#!/usr/bin/env pwsh
# build-windows.ps1 - builds the Nipah! Anime Windows NSIS installer.
# Run from any directory; script changes to the repo root automatically.
# Output: build\bin\Nipah! Anime-amd64-installer.exe

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot
$buildStartedAt = Get-Date
$toolsRoot = Join-Path $repoRoot "tools\windows-build"
$preserveRoot = Join-Path $repoRoot "build\preserved-cross-platform"

$wailsCmd = Get-Command wails -ErrorAction SilentlyContinue
if (-not $wailsCmd) {
    $candidate = Join-Path $HOME "go\bin\wails.exe"
    if (Test-Path $candidate) {
        $wailsCmd = Get-Item $candidate
    }
}
if (-not $wailsCmd) {
    throw "[Windows] Wails CLI not found in PATH or `$HOME\\go\\bin"
}

$gccCmd = Get-Command gcc -ErrorAction SilentlyContinue
if (-not $gccCmd) {
    $zigCC = Join-Path $toolsRoot "zigcc-shim.exe"
    $zigCXX = Join-Path $toolsRoot "zigcxx-shim.exe"
    if ((Test-Path $zigCC) -and (Test-Path $zigCXX)) {
        $env:CC = $zigCC
        $env:CXX = $zigCXX
        Write-Host "[Windows] Using portable Zig shim toolchain for cgo"
    } else {
        throw "[Windows] gcc not found in PATH and no portable Zig toolchain is available."
    }
}

$localNSISBin = Join-Path $toolsRoot "nsis\nsis-3.11\Bin"
if (Test-Path (Join-Path $localNSISBin "makensis.exe")) {
    $env:Path = "$localNSISBin;$env:Path"
    Write-Host "[Windows] Using portable NSIS from $localNSISBin"
}

Write-Host "[Windows] Building Nipah! Anime v$(((Get-Content wails.json | ConvertFrom-Json).info.productVersion))"
Write-Host "[Windows] Building Wails app + NSIS installer"

$preservedArtifacts = @()
if (Test-Path "build\bin") {
    New-Item -ItemType Directory -Force -Path $preserveRoot | Out-Null
    $preservedArtifacts = Get-ChildItem "build\bin" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @(".AppImage", ".deb") -or $_.Name -eq "PKGBUILD" }
    foreach ($artifact in $preservedArtifacts) {
        Copy-Item $artifact.FullName (Join-Path $preserveRoot $artifact.Name) -Force
    }
}

& $wailsCmd.Source build -clean -nsis -platform windows/amd64

foreach ($artifact in $preservedArtifacts) {
    $preservedPath = Join-Path $preserveRoot $artifact.Name
    if (Test-Path $preservedPath) {
        Copy-Item $preservedPath (Join-Path $repoRoot "build\bin\$($artifact.Name)") -Force
    }
}

$installer = Get-ChildItem "build\bin\*-installer.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $buildStartedAt } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($installer) {
    Write-Host "[Windows] Installer ready: $($installer.FullName)"
} else {
    Write-Error "[Windows] Fresh installer not found in build\\bin\\ - check Wails output above"
}
