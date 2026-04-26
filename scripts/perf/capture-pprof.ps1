param(
  [ValidateSet("cpu", "heap", "goroutine", "allocs", "trace")]
  [string]$Profile = "cpu",
  [int]$Seconds = 20,
  [string]$OutFile = ".\profiles\capture.pprof"
)

$baseUrl = "http://127.0.0.1:43212/debug/pprof"
$target = switch ($Profile) {
  "cpu" { "$baseUrl/profile?seconds=$Seconds" }
  "trace" { "$baseUrl/trace?seconds=$Seconds" }
  default { "$baseUrl/$Profile?debug=0" }
}

$directory = Split-Path -Parent $OutFile
if ($directory) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

Invoke-WebRequest -Uri $target -OutFile $OutFile
Write-Host "Saved $Profile profile to $OutFile"
