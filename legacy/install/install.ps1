# composer-modes installer — idempotent, reversible, auditable.
# Copies the plugin, applies the transactional core patch, verifies, applies the
# desktop-renderer seam (desktop-patch + app rebuild + staged swap), and schedules
# a detached backend restart when the core changed.
#
#   .\install.ps1            apply (no-op when already installed)
#   .\install.ps1 -Repair    same, meant for the scheduled task
#   .\install.ps1 -WhatIf    full dry run: writes nothing, schedules nothing
#   .\install.ps1 -SkipDesktopSeam    skip the renderer patch + app rebuild
#
# Exit codes: 0 ok/no-op | 1 error | 2 preflight failed | 3 already running
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Repair,
  [switch]$SkipDesktopSeam,
  [string]$HermesHome,
  [string]$AgentDir,
  [string]$LogPath
)

$ErrorActionPreference = 'Stop'
$RepoRoot   = Split-Path -Parent $PSScriptRoot
$VersionsJ  = Join-Path $RepoRoot 'versions.json'

function Fail([int]$code, [string]$msg) {
  Write-Host "[composer-modes] ERROR: $msg" -ForegroundColor Red
  if ($script:Log) { Add-Content -Path $script:Log -Value ("[{0}] ERROR {1}" -f (Get-Date -Format s), $msg) }
  exit $code
}

# ── preflight: Windows ────────────────────────────────────────────────────────
if (-not $IsWindows -and $env:OS -notlike '*Windows*') {
  Fail 2 'Windows-only release (v1). macOS/Linux: see README, do not improvise.'
}

# ── preflight: Hermes home (ladder) ──────────────────────────────────────────
function Get-Sha([string]$p) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $fs = [System.IO.File]::OpenRead($p)
    try { ($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $fs.Dispose() }
  } finally { $sha.Dispose() }
}

function Test-Home([string]$p) { $p -and ((Test-Path (Join-Path $p 'hermes-agent') -PathType Container) -or (Test-Path (Join-Path $p 'config.yaml') -PathType Leaf)) }
$candidates = @($HermesHome, $env:HERMES_HOME, (Join-Path $env:LOCALAPPDATA 'hermes'), (Join-Path $env:USERPROFILE '.hermes'))
$HermesDir = $null
foreach ($c in $candidates) { if (Test-Home $c) { $HermesDir = $c; break } }
if (-not $HermesDir) { Fail 2 "could not find the Hermes home (tried: $($candidates -join '; ')). Pass -HermesHome." }

# ── preflight: agent checkout + interpreter (ladder) ─────────────────────────
if (-not $AgentDir) { $AgentDir = Join-Path $HermesDir 'hermes-agent' }
if (-not (Test-Path (Join-Path $AgentDir 'tui_gateway\methods_prompt.py') -PathType Leaf)) {
  Fail 2 "Hermes Agent checkout not found at $AgentDir (pass -AgentDir)."
}
$py = $null
foreach ($p in @((Join-Path $AgentDir 'venv\Scripts\python.exe'), (Join-Path $AgentDir '.venv\Scripts\python.exe'))) {
  if (Test-Path $p -PathType Leaf) { $py = $p; break }
}
if (-not $py) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { $py = $cmd.Source }
}
if (-not $py) { Fail 2 'no Python interpreter found (looked for venv/.venv/python on PATH).' }

# ── log + lock (skipped entirely under -WhatIf) ──────────────────────────────
$StateDir = Join-Path $HermesDir 'composer-modes'
$script:Log = if ($LogPath) { $LogPath } else { Join-Path $StateDir 'install.log' }
$lock = Join-Path $StateDir 'install.lock'
if (-not $WhatIfPreference) {
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  if (Test-Path $lock) {
    $age = (Get-Date) - (Get-Item $lock).LastWriteTime
    if ($age.TotalMinutes -lt 30) { Write-Host '[composer-modes] another run holds the lock (fresh) — no-op.'; exit 0 }
    Write-Host '[composer-modes] stale lock (>30 min) — overriding.'
    Remove-Item $lock -Force
  }
  Set-Content -Path $lock -Value ("{0} {1}" -f $PID, (Get-Date -Format s))
}
function Log([string]$m) {
  Write-Host "[composer-modes] $m"
  if ($script:Log -and -not $WhatIfPreference) {
    Add-Content -Path $script:Log -Value ("[{0}] {1}" -f (Get-Date -Format s), $m)
  }
}

try {
  Log ("start ({0}) home={1} agent={2}" -f $(if ($Repair) { 'repair' } elseif ($WhatIfPreference) { 'dry-run' } else { 'install' }), $HermesDir, $AgentDir)

  # ── 1. plugin: verify sha then copy (hot-reloads in a running app) ─────────
  $srcPlugin = Join-Path $RepoRoot 'plugin\composer-modes\plugin.js'
  if (-not (Test-Path $srcPlugin -PathType Leaf)) { Fail 1 "plugin source missing: $srcPlugin" }
  $expected = (Get-Content $VersionsJ -Raw | ConvertFrom-Json).plugin_sha256
  $actual = Get-Sha $srcPlugin
  if ($expected -and ($actual -ne $expected.ToLower())) {
    Fail 1 "plugin sha256 mismatch (versions.json=$($expected.Substring(0,12))... source=$($actual.Substring(0,12))...) - refusing a degraded copy."
  }
  $dstDir = Join-Path $HermesDir 'desktop-plugins\composer-modes'
  $dstPlugin = Join-Path $dstDir 'plugin.js'
  $pluginAction = 'up-to-date'
  if ((Test-Path $dstPlugin) -and ((Get-Sha $dstPlugin) -eq $actual)) {
    Log 'plugin already current'
  } elseif ($PSCmdlet.ShouldProcess($dstPlugin, 'install plugin')) {
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    if (Test-Path $dstPlugin) {
      $bak = "$dstPlugin.bak-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss')
      Copy-Item $dstPlugin $bak -Force
      Log "plugin backup: $(Split-Path -Leaf $bak)"
    }
    Copy-Item $srcPlugin $dstPlugin -Force
    $pluginAction = 'installed'
    Log 'plugin installed (the running app hot-reloads it)'
  } else { $pluginAction = 'whatif' }

  # ── 2. core patch: transactional, all-or-nothing ───────────────────────────
  $patchPy = Join-Path $RepoRoot 'core-patch\patch.py'
  $verifyPy = Join-Path $RepoRoot 'core-patch\verify_core.py'
  $patchArgs = @($patchPy, '--repo', $AgentDir)
  if ($WhatIfPreference) { $patchArgs += '--verify-only' }
  $out = & $py @patchArgs 2>&1 | Out-String
  $code = $LASTEXITCODE
  Log ("core patch exit=$code")
  $out.Trim() -split "`n" | ForEach-Object { if ($_) { Log ("  " + $_.Trim()) } }
  if ($code -ne 0) { Fail 1 "core patch failed (exit $code) - tree untouched or rolled back; see docs/troubleshooting.md" }
  $coreApplied = ($out -match 'patched .*\.py') -or ($out -match 'patched .*AGENTS\.md')

  # ── 3. verify gate (before any restart) ────────────────────────────────────
  $vout = & $py $verifyPy --repo $AgentDir --python $py 2>&1 | Out-String
  $vcode = $LASTEXITCODE
  Log ("verify exit=$vcode")
  if ($vcode -ne 0 -and -not $WhatIfPreference) {
    $vout.Trim() -split "`n" | Where-Object { $_ -match 'FAIL' } | ForEach-Object { Log ("  " + $_.Trim()) }
    Fail 1 'verification failed - NOT restarting the backend.'
  }

  # -- 3b. desktop seam: renderer patch + app rebuild + staged swap -----------
  $desktop = 'skipped (-SkipDesktopSeam)'
  $desktopSwapScheduled = $false
  if (-not $SkipDesktopSeam) {
    $buildPs1 = Join-Path $PSScriptRoot 'build-desktop-seam.ps1'
    if (-not (Test-Path $buildPs1 -PathType Leaf)) {
      $desktop = 'skipped (build-desktop-seam.ps1 not found)'
    } else {
      $bargs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $buildPs1, '-HermesHome', $HermesDir, '-AgentDir', $AgentDir)
      if ($WhatIfPreference) { $bargs += '-WhatIf' }
      $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      $bout = & powershell.exe @bargs 2>&1 | Out-String
      $bcode = $LASTEXITCODE
      $ErrorActionPreference = $prevEap
      $bout.Trim() -split "`n" | ForEach-Object { if ($_) { Log ("  " + $_.Trim()) } }
      if ($bcode -eq 2) {
        $desktop = 'skipped (node/npm toolchain missing - the staged-note channel still covers stock builds; see docs/limits.md)'
        Log ("desktop seam " + $desktop)
      } elseif ($bcode -ne 0) {
        Fail 1 "desktop seam failed (exit $bcode) - see docs/troubleshooting.md"
      } else {
        $dline = @($bout -split "`n" | Where-Object { $_ -match 'done desktop=' } | Select-Object -Last 1)
        if ($dline.Count -gt 0) {
          $desktop = ($dline[0].Trim() -replace '^\[composer-modes\]\s*', '' -replace '^done\s+', '' -replace '^desktop=', '')
          $desktopSwapScheduled = [bool]($dline[0] -match 'swap=scheduled')
        } else { $desktop = 'ok' }
      }
    }
  }

  # ── 4. detached backend restart (only when the core changed) ───────────────
  $restart = 'skipped (core unchanged)'
  if ($coreApplied -and $desktopSwapScheduled -and -not $WhatIfPreference) {
    $restart = 'covered by the desktop swap (the relaunched app dials a fresh backend)'
    Log "backend restart $restart"
  } elseif ($coreApplied -and -not $WhatIfPreference) {
    $restartPs1 = Join-Path $PSScriptRoot 'restart-backend.ps1'
    $task = 'HermesComposerModesRestart'
    schtasks /create /tn $task /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$restartPs1`"" /sc once /st 00:00 /f | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 1 "could not schedule the backend restart task (schtasks exit $LASTEXITCODE)" }
    # schtasks defaults to "do not start on battery": on a laptop that silently blocks the
    # one-shot (0x41303, never runs) even for /run. Match the guardian's battery-safe flags.
    try {
      $st = Get-ScheduledTask -TaskName $task
      $st.Settings.DisallowStartIfOnBatteries = $false
      $st.Settings.StopIfGoingOnBatteries = $false
      $st.Settings.StartWhenAvailable = $true
      Set-ScheduledTask -TaskName $task -Settings $st.Settings | Out-Null
    } catch { Log "WARN: could not make the restart task battery-safe: $_" }
    schtasks /run /tn $task | Out-Null
    $restart = 'scheduled (the app respawns the backend on its next dial)'
    Log "backend restart $restart"
  } elseif ($coreApplied) { $restart = 'whatif' }

  # ── 5. soft hot-reload check (informational) ───────────────────────────────
  $logFile = Join-Path $HermesDir 'logs\desktop.log'
  if (Test-Path $logFile) {
    $reg = Get-Content $logFile -Tail 400 -ErrorAction SilentlyContinue | Select-String 'composer-modes.*register' | Select-Object -Last 1
    if ($reg) { Log ('plugin register probe: ' + $reg.Line.Trim()) }
  }

  Log ("done plugin=$pluginAction core=" + $(if ($coreApplied) { 'patched' } else { 'unchanged' }) + " desktop=$desktop restart=$restart")
  if ($Repair -and -not $coreApplied -and $pluginAction -eq 'up-to-date') { }
  exit 0
}
finally {
  if (-not $WhatIfPreference -and (Test-Path $lock)) { Remove-Item $lock -Force -ErrorAction SilentlyContinue }
}
