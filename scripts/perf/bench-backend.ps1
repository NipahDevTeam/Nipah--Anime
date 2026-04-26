param(
  [string]$Output = ".\profiles\bench.txt",
  [string]$Packages = ".\..."
)

$directory = Split-Path -Parent $Output
if ($directory) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$results = go test -run ^$ -bench . -benchmem $Packages
$results | Set-Content -Path $Output
$results
Write-Host "Saved benchmark output to $Output"
