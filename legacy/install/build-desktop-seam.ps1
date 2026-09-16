# composer-modes -- patch the renderer sources and build + stage the desktop-seam app.
#
# The queue-freeze seam lives in the renderer (apps/desktop/src): the installer
# cannot patch the packaged app, so this step applies desktop-patch/ops.json to
# the checkout, rebuilds the app with the checkout's own toolchain
# (npm run build + electron-builder --dir into a staging dir), verifies the
# staged build (Hermes.exe + the `fromQueue` seam marker), copies it next to the
# live build (win-unpacked.new) and -- unless -NoSwap -- schedules the detached
# swap (desktop-swap.ps1) that closes the app, moves the new build in, and
# relaunches it.
#
#   .\build-desktop-seam.ps1            apply -> build -> stage -> swap (detached)
#   .\build-desktop-seam.ps1 -NoSwap    apply -> build -> stage only
#   .\build-desktop-seam.ps1 -WhatIf    verify anchors only; no writes, no build
#
# Exit codes: 0 ok/no-op | 1 error | 2 preflight failed (paths/node/npm) | 5 patch failed
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Force,
  [switch]$NoSwap,
  [string]$HermesHome,
  [string]$AgentDir,
  [string]$LogPath
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Fail([int]$code, [string]$msg) {
  Write-Host "[composer-modes] ERROR: $msg" -ForegroundColor Red
  if ($script:Log) { Add-Content -Path $script:Log -Value ("[{0}] ERROR {1}" -f (Get-Date -Format s), $msg) }
  exit $code
}

# -- preflight: Hermes home + checkout + python (same ladders as install.ps1) ?
function Test-Home([string]$p) { $p -and ((Test-Path (Join-Path $p 'hermes-agent') -PathType Container) -or (Test-Path (Join-Path $p 'config.yaml') -PathType Leaf)) }
$homeCandidates = @($HermesHome, $env:HERMES_HOME, (Join-Path $env:LOCALAPPDATA 'hermes'), (Join-Path $env:USERPROFILE '.hermes'))
$HermesDir = $null
foreach ($c in $homeCandidates) { if (Test-Home $c) { $HermesDir = $c; break } }
if (-not $HermesDir) { Fail 2 "could not find the Hermes home (tried: $($homeCandidates -join '; ')). Pass -HermesHome." }

if (-not $AgentDir) { $AgentDir = Join-Path $HermesDir 'hermes-agent' }
$desktopProbe = Join-Path $AgentDir 'apps\desktop\src\app\chat\composer\hooks\use-composer-queue.ts'
if (-not (Test-Path $desktopProbe -PathType Leaf)) { Fail 2 "desktop renderer not found under $AgentDir (pass -AgentDir)." }

$py = $null
foreach ($p in @((Join-Path $AgentDir 'venv\Scripts\python.exe'), (Join-Path $AgentDir '.venv\Scripts\python.exe'))) {
  if (Test-Path $p -PathType Leaf) { $py = $p; break }
}
if (-not $py) { Fail 2 'no Python interpreter found under the checkout (venv/.venv).' }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd  = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCmd -or -not $npmCmd) { Fail 2 'node/npm not found on PATH -- the desktop seam needs the checkout toolchain (see docs/limits.md).' }

# -- log ----------------------------------------------------------------------
$StateDir = Join-Path $HermesDir 'composer-modes'
if (-not $WhatIfPreference) { New-Item -ItemType Directory -Force -Path $StateDir | Out-Null }
$script:Log = if ($LogPath) { $LogPath } else { Join-Path $StateDir 'desktop-build.log' }
function Log([string]$m) {
  Write-Host "[composer-modes] $m"
  if ($script:Log -and -not $WhatIfPreference) {
    Add-Content -Path $script:Log -Value ("[{0}] {1}" -f (Get-Date -Format s), $m)
  }
}
function LogTail([string]$text, [int]$lines) {
  $arr = @($text -split "`r?`n" | Where-Object { $_ -ne '' })
  $arr | Select-Object -Last $lines | ForEach-Object { Log ("  " + $_.Trim()) }
}

function Get-SeamMarker([string]$unpacked) {
  # the renderer bundle keeps the seam's `fromQueue` token through minification
  $assets = Join-Path $unpacked 'resources\app.asar.unpacked\dist\assets'
  if (-not (Test-Path $assets -PathType Container)) { return $false }
  $hit = Get-ChildItem -Path $assets -Filter *.js -File -ErrorAction SilentlyContinue |
    Select-String -SimpleMatch 'fromQueue' -List -ErrorAction SilentlyContinue |
    Select-Object -First 1
  return [bool]$hit
}

Log ("start ({0}) home={1} agent={2}" -f $(if ($WhatIfPreference) { 'dry-run' } else { 'build' }), $HermesDir, $AgentDir)

# -- 1. desktop patch (transactional, all-or-nothing) ------------------------
$patchPs = Join-Path $RepoRoot 'desktop-patch\patch_desktop.py'
$patchArgs = @($patchPs, '--repo', $AgentDir)
if ($WhatIfPreference) { $patchArgs += '--verify-only' }
$prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$pout = & $py @patchArgs 2>&1 | Out-String
$pcode = $LASTEXITCODE
$ErrorActionPreference = $prevEap
Log ("desktop patch exit=$pcode")
LogTail $pout 12
if ($pcode -ne 0) { Fail 5 "desktop patch failed (exit $pcode) -- tree untouched or rolled back; see docs/troubleshooting.md" }
$patched = [bool]($pout -match '\b(patched|created|tokened) apps/desktop')

$rel = Join-Path $AgentDir 'apps\desktop\release'
$live = Join-Path $rel 'win-unpacked'
$markerLive = (Test-Path (Join-Path $live 'Hermes.exe') -PathType Leaf) -and (Get-SeamMarker $live)

if ($WhatIfPreference) {
  Log ("done desktop=" + $(if ($patched) { 'would patch' } else { 'anchors ok' }) + " build=whatif swap=whatif")
  exit 0
}
if (-not $Force -and -not $patched -and $markerLive) {
  Log 'desktop seam already current -- nothing to build'
  Log 'done desktop=current build=skipped swap=skipped'
  exit 0
}

# -- 2. build: renderer + electron-builder --dir into the staging dir --------
$stageRoot = Join-Path $StateDir 'desktop-build'
$stage = Join-Path $stageRoot 'win-unpacked'
if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

Push-Location (Join-Path $AgentDir 'apps\desktop')
try {
  Log 'npm run build ...'
  $ErrorActionPreference = 'Continue'   # npm writes warnings to stderr; never abort on them
  $b1 = & npm.cmd run build 2>&1 | Out-String
  $c1 = $LASTEXITCODE
  if ($c1 -ne 0) { LogTail $b1 30; Fail 1 "npm run build failed (exit $c1)" }
  Log 'npm run build ok'
  Log 'electron-builder --dir ...'
  $b2 = & npm.cmd run builder -- --dir "-c.directories.output=$stageRoot" 2>&1 | Out-String
  $c2 = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($c2 -ne 0) { LogTail $b2 30; Fail 1 "electron-builder failed (exit $c2)" }
  Log 'electron-builder ok'
} finally { Pop-Location }

if (-not (Test-Path (Join-Path $stage 'Hermes.exe') -PathType Leaf)) { Fail 1 "staged build has no Hermes.exe ($stage)" }
if (-not (Get-SeamMarker $stage)) { Fail 1 'staged build does not carry the seam marker (fromQueue) -- refusing to swap' }
Log "staged build ok: $stage"

# -- 3. stage next to the live build (copy verified before anything moves) --?
$new = Join-Path $rel 'win-unpacked.new'
if (Test-Path $new) { Remove-Item $new -Recurse -Force }
robocopy $stage $new /E /NFL /NDL /NJH /NJS /NP | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8 -or -not (Test-Path (Join-Path $new 'Hermes.exe') -PathType Leaf) -or -not (Get-SeamMarker $new)) {
  Fail 1 "staging copy failed (robocopy $rc) -- nothing touched"
}
Log 'win-unpacked.new staged + verified'

# -- 4. swap: detached, so no in-flight turn is ever killed ------------------
$swap = 'skipped (-NoSwap)'
if (-not $NoSwap) {
  $swapPs1 = Join-Path $PSScriptRoot 'desktop-swap.ps1'
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$swapPs1`"",
    '-AgentDir', "`"$AgentDir`"", '-StateDir', "`"$StateDir`""
  ) | Out-Null
  $swap = 'scheduled (detached; the app closes + relaunches when it lands)'
  Log "swap $swap"
}

Log ("done desktop=" + $(if ($patched) { 'patched' } else { 'anchors ok' }) + " build=built swap=$swap")
exit 0
