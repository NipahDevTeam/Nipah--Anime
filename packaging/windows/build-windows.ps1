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
$goCacheRoot = Join-Path $repoRoot "build\gocache-release"
$goTmpRoot = Join-Path $repoRoot "build\gotmp-release"

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

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    Write-Host $Label
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Copy-TextFileWithLf {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    $destinationDir = Split-Path -Parent $Destination
    if ($destinationDir) {
        New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    }

    $content = [System.IO.File]::ReadAllText($Source)
    $normalizedContent = $content -replace "`r`n?", "`n"
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Destination, $normalizedContent, $utf8NoBom)
}

$projectInfo = Get-Content wails.json | ConvertFrom-Json
$productVersion = $projectInfo.info.productVersion

if (-not $env:GOROOT) {
    $resolvedGoRoot = (& go env GOROOT).Trim()
    if ($LASTEXITCODE -eq 0 -and $resolvedGoRoot) {
        $env:GOROOT = $resolvedGoRoot
    }
}
if (-not $env:GOPATH) {
    $resolvedGoPath = (& go env GOPATH).Trim()
    if ($LASTEXITCODE -eq 0 -and $resolvedGoPath) {
        $env:GOPATH = $resolvedGoPath
    }
}

New-Item -ItemType Directory -Force -Path $goCacheRoot | Out-Null
New-Item -ItemType Directory -Force -Path $goTmpRoot | Out-Null
$env:GOCACHE = $goCacheRoot
$env:GOTMPDIR = $goTmpRoot

Write-Host "[Windows] Building Nipah! Anime v$productVersion"
Write-Host "[Windows] Building Wails app + NSIS installer"

$preservedArtifacts = @()
if (Test-Path "build\bin") {
    New-Item -ItemType Directory -Force -Path $preserveRoot | Out-Null
    $preservedArtifacts = Get-ChildItem "build\bin" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @(".AppImage", ".deb") -or $_.Name -eq "PKGBUILD" }
    foreach ($artifact in $preservedArtifacts) {
        $preservedTarget = Join-Path $preserveRoot $artifact.Name
        if ($artifact.Name -eq "PKGBUILD") {
            Copy-TextFileWithLf -Source $artifact.FullName -Destination $preservedTarget
        } else {
            Copy-Item $artifact.FullName $preservedTarget -Force
        }
    }
}

$usedFallback = $false
& $wailsCmd.Source build -clean -s -nsis -platform windows/amd64
if ($LASTEXITCODE -ne 0) {
    $usedFallback = $true
    Write-Warning "[Windows] Wails packaging failed; falling back to direct Go build + NSIS packaging."

    if (-not (Test-Path "frontend\dist\index.html")) {
        throw "[Windows] Frontend dist assets are missing. Run 'npm.cmd --prefix frontend run build' before fallback packaging."
    }
    Invoke-Step "[Windows] Building app binary" { go build -o "build\bin\Nipah! Anime.exe" . }

    $makensisCmd = Get-Command makensis -ErrorAction SilentlyContinue
    if (-not $makensisCmd) {
        throw "[Windows] makensis.exe not found in PATH or portable NSIS bundle."
    }

    Push-Location "build\windows\installer"
    try {
        Invoke-Step "[Windows] Building NSIS installer" {
            & $makensisCmd.Source /V2 "/DINFO_PRODUCTVERSION=$productVersion" "/DARG_WAILS_AMD64_BINARY=..\..\bin\Nipah! Anime.exe" "project.nsi"
        }
    } finally {
        Pop-Location
    }
}

foreach ($artifact in $preservedArtifacts) {
    $preservedPath = Join-Path $preserveRoot $artifact.Name
    if (Test-Path $preservedPath) {
        $buildBinTarget = Join-Path $repoRoot "build\bin\$($artifact.Name)"
        if ($artifact.Name -eq "PKGBUILD") {
            Copy-TextFileWithLf -Source $preservedPath -Destination $buildBinTarget
        } else {
            Copy-Item $preservedPath $buildBinTarget -Force
        }
    }
}

Copy-TextFileWithLf -Source "packaging\arch\PKGBUILD" -Destination "build\bin\PKGBUILD"

$installer = Get-ChildItem "build\bin\*-installer.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $buildStartedAt } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($installer) {
    if ($usedFallback) {
        Write-Host "[Windows] Installer ready via fallback path: $($installer.FullName)"
    } else {
        Write-Host "[Windows] Installer ready: $($installer.FullName)"
    }
} else {
    Write-Error "[Windows] Fresh installer not found in build\\bin\\ - check Wails output above"
}
