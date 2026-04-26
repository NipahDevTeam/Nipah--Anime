param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$BackupRoot = '',
  [switch]$SkipRepo,
  [switch]$SkipAppData
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  $BackupRoot = Join-Path $RepoRoot 'backups'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $BackupRoot $timestamp
$repoBackupDir = Join-Path $backupDir 'repo'
$appDataBackupDir = Join-Path $backupDir 'appdata'

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$manifest = [System.Collections.Generic.List[string]]::new()
$manifest.Add("created_at=$(Get-Date -Format o)")
$manifest.Add("repo_root=$RepoRoot")
$manifest.Add("backup_dir=$backupDir")

function Copy-RepoSnapshot {
  param(
    [string]$SourceRoot,
    [string]$DestinationRoot
  )

  $excludeSegments = @(
    '\.git\',
    '\frontend\node_modules\',
    '\build\',
    '\backups\',
    '\.gocache\',
    '\frontend\dist\',
    '\downloads\',
    '\download\',
    '\torrents\',
    '\torrent\'
  )

  Get-ChildItem -Path $SourceRoot -Recurse -Force -File | ForEach-Object {
    $fullName = $_.FullName
    $skip = $false
    foreach ($segment in $excludeSegments) {
      if ($fullName -like "*$segment*") {
        $skip = $true
        break
      }
    }
    if ($skip) {
      return
    }

    $relative = $fullName.Substring($SourceRoot.Length).TrimStart('\')
    $target = Join-Path $DestinationRoot $relative
    $targetDir = Split-Path -Parent $target
    if (-not (Test-Path $targetDir)) {
      New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    }
    Copy-Item -LiteralPath $fullName -Destination $target -Force
  }
}

if (-not $SkipRepo) {
  New-Item -ItemType Directory -Force -Path $repoBackupDir | Out-Null
  Copy-RepoSnapshot -SourceRoot $RepoRoot -DestinationRoot $repoBackupDir
  git -C $RepoRoot status --short | Out-File -FilePath (Join-Path $backupDir 'git-status.txt') -Encoding utf8
  git -C $RepoRoot diff --binary | Out-File -FilePath (Join-Path $backupDir 'git-diff.patch') -Encoding utf8
  $manifest.Add("repo_snapshot=ok")
}

if (-not $SkipAppData) {
  $appDataRoot = Join-Path $env:APPDATA 'Nipah'
  $dbBase = Join-Path $appDataRoot 'nipah.db'
  $dbFiles = @($dbBase, "$dbBase-wal", "$dbBase-shm")
  New-Item -ItemType Directory -Force -Path $appDataBackupDir | Out-Null

  if (Test-Path -LiteralPath $dbBase) {
    $sqliteSnapshot = Join-Path $appDataBackupDir 'nipah.db'
    $sqliteHelper = Join-Path $RepoRoot 'scripts\backup_sqlite.go'
    $originalGoCache = $env:GOCACHE
    try {
      $env:GOCACHE = Join-Path $RepoRoot '.gocache'
      & go run $sqliteHelper --source $dbBase --dest $sqliteSnapshot
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sqliteSnapshot)) {
        throw "sqlite snapshot command failed"
      }
      $manifest.Add("appdata_snapshot=$dbBase")
    } catch {
      $manifest.Add("appdata_snapshot_failed=$dbBase")
      Write-Warning "Could not snapshot $dbBase while it is locked. Close the app and rerun the backup script to capture the live DB."
    } finally {
      $env:GOCACHE = $originalGoCache
    }
  }

  foreach ($path in $dbFiles[1..($dbFiles.Length - 1)]) {
    if (Test-Path -LiteralPath $path) {
      try {
        Copy-Item -LiteralPath $path -Destination (Join-Path $appDataBackupDir ([IO.Path]::GetFileName($path))) -Force
        $manifest.Add("appdata_file=$path")
      } catch {
        $manifest.Add("appdata_file_skipped=$path")
      }
    }
  }

  $settingsPath = Join-Path $appDataRoot 'settings.json'
  if (Test-Path -LiteralPath $settingsPath) {
    Copy-Item -LiteralPath $settingsPath -Destination (Join-Path $appDataBackupDir 'settings.json') -Force
    $manifest.Add("appdata_file=$settingsPath")
  }
}

$manifest | Out-File -FilePath (Join-Path $backupDir 'manifest.txt') -Encoding utf8
Write-Output $backupDir
