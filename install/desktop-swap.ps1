# composer-modes -- detached swap: move the staged win-unpacked.new into place.
#
# Runs detached (started by install/build-desktop-seam.ps1) so a live turn is
# never killed mid-flight. Verifies the staged build once more before touching
# anything; retries the moves; restores the old build if the second move fails.
# Then relaunches Hermes (the backend respawns with it, by design).
param(
  [string]$AgentDir,
  [string]$StateDir,
  [int]$DelaySeconds = 8
)

$ErrorActionPreference = 'Continue'
$log = Join-Path $StateDir 'app-swap.log'
function L($m) { ('[{0}] {1}' -f (Get-Date -Format s), $m) | Add-Content $log }
L 'swap start (desktop seam)'
Start-Sleep -Seconds $DelaySeconds

$rel = Join-Path $AgentDir 'apps\desktop\release'
$new = Join-Path $rel 'win-unpacked.new'
if (-not (Test-Path (Join-Path $new 'Hermes.exe') -PathType Leaf)) {
  L 'ERROR: win-unpacked.new missing or incomplete -- nothing touched'
  exit 1
}

# 1. kill the running app (the backend dies with it by design; a fresh one
#    spawns when the app dials again)
$killed = @()
Get-Process -Name Hermes -ErrorAction SilentlyContinue | ForEach-Object {
  $killed += $_.Id
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 5
L ("killed Hermes pid(s): " + (($killed -join ',') -replace '^$', 'none found'))

# 2. swap (move retries; restore the old build if the second move fails)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bakDir = Join-Path $StateDir 'backups'
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir "win-unpacked.pre-seam-$stamp"
$ok = $false
foreach ($i in 1..5) {
  try { Move-Item (Join-Path $rel 'win-unpacked') $bak -ErrorAction Stop; $ok = $true; break }
  catch { Start-Sleep -Seconds 3 }
}
if (-not $ok) { L 'ERROR: could not move the old build aside (locked) -- aborting, app left as-is'; exit 1 }
L "old build -> $bak"

$ok = $false
foreach ($i in 1..5) {
  try { Move-Item $new (Join-Path $rel 'win-unpacked') -ErrorAction Stop; $ok = $true; break }
  catch { Start-Sleep -Seconds 3 }
}
if (-not $ok) {
  L 'ERROR: could not move the new build in -- restoring old'
  Move-Item $bak (Join-Path $rel 'win-unpacked')
  exit 1
}
L 'new build in place (win-unpacked)'

# 3. relaunch
Start-Sleep -Seconds 1
Start-Process (Join-Path $rel 'win-unpacked\Hermes.exe')
L 'relaunched Hermes (seam build)'
