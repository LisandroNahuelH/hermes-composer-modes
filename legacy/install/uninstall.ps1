# composer-modes uninstaller — hash-verified, with three fallback layers.
#
#   .\uninstall.ps1            restore the core, remove the plugin and the tasks
#   .\uninstall.ps1 -WhatIf    show everything it would do, write nothing
#
# Restore order per file:
#   1. composer-modes-patch-manifest.json  (verifies sha256_after before touching,
#      restores the matching backup, then verifies sha256_before)
#   2. newest sibling backup               (<file>.bak-<stamp>-<rand>)
#   3. git checkout origin/main -- <file>  (only when the checkout is a git repo)
# The desktop seam restores from composer-modes-desktop-patch-manifest.json (and its
# tests twin); the newest pre-seam app build is staged for a detached swap-back.
# Exit codes: 0 ok | 1 problems | 2 preflight failed
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$HermesHome,
  [string]$AgentDir
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Files = @(
  'tui_gateway/prompt_turn.py',
  'tui_gateway/methods_prompt.py',
  'tui_gateway/session_auto_continue.py',
  'agent/turn_context.py',
  'tui_gateway/AGENTS.md'
)

function Fail([int]$code, [string]$msg) { Write-Host "[composer-modes] ERROR: $msg" -ForegroundColor Red; exit $code }

if (-not $IsWindows -and $env:OS -notlike '*Windows*') { Fail 2 'Windows-only release (v1).' }

function Test-Home([string]$p) { $p -and ((Test-Path (Join-Path $p 'hermes-agent') -PathType Container) -or (Test-Path (Join-Path $p 'config.yaml') -PathType Leaf)) }
$HermesDir = $null
foreach ($c in @($HermesHome, $env:HERMES_HOME, (Join-Path $env:LOCALAPPDATA 'hermes'), (Join-Path $env:USERPROFILE '.hermes'))) {
  if (Test-Home $c) { $HermesDir = $c; break }
}
if (-not $HermesDir) { Fail 2 'could not find the Hermes home; pass -HermesHome.' }
if (-not $AgentDir) { $AgentDir = Join-Path $HermesDir 'hermes-agent' }
if (-not (Test-Path (Join-Path $AgentDir 'tui_gateway\methods_prompt.py') -PathType Leaf)) { Fail 2 "no agent checkout at $AgentDir" }

$problems = @()
$appSwapScheduled = $false
$manifestPath = Join-Path $AgentDir 'composer-modes-patch-manifest.json'
$restored = @()

function Get-Sha([string]$p) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $fs = [System.IO.File]::OpenRead($p)
    try { ($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $fs.Dispose() }
  } finally { $sha.Dispose() }
}

function Sha([string]$p) { Get-Sha $p }

if (Test-Path $manifestPath) {
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  foreach ($entry in $manifest.files) {
    $target = Join-Path $AgentDir ($entry.file -replace '/', '\')
    if (-not (Test-Path $target)) { $problems += "missing target: $($entry.file)"; continue }
    if ((Sha $target) -ne $entry.sha_after.ToLower()) {
      $problems += "REFUSED $($entry.file): current hash differs from the recorded patched hash (edited after patching?)"
      continue
    }
    if (-not (Test-Path $entry.bak)) { $problems += "backup gone: $($entry.bak)"; continue }
    if ($PSCmdlet.ShouldProcess($target, "restore from $($entry.bak)")) {
      Copy-Item $entry.bak $target -Force
      if ((Sha $target) -ne $entry.sha_before.ToLower()) { $problems += "restore hash mismatch: $($entry.file)" }
      else { $restored += $entry.file }
    }
  }
  if ($PSCmdlet.ShouldProcess($manifestPath, 'remove manifest')) { Remove-Item $manifestPath -Force }
} else {
  foreach ($rel in $Files) {
    $target = Join-Path $AgentDir ($rel -replace '/', '\')
    if (-not (Test-Path $target)) { continue }
    $bak = Get-ChildItem (Split-Path $target) -Filter ((Split-Path $target -Leaf) + '.bak-*') -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($bak) {
      if ($PSCmdlet.ShouldProcess($target, "restore from $($bak.Name)")) {
        Copy-Item $bak.FullName $target -Force
        $restored += $rel
      }
      continue
    }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
      if ($PSCmdlet.ShouldProcess($target, 'git checkout origin/main')) {
        & git -C $AgentDir checkout origin/main -- $rel 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $restored += "$rel (git)" } else { $problems += "git restore failed: $rel" }
      }
    } else { $problems += "no backup and no git for: $rel" }
  }
}

# -- desktop seam: restore the renderer sources, then the app itself ---------
foreach ($mName in @('composer-modes-desktop-patch-manifest.json', 'composer-modes-desktop-tests-manifest.json')) {
  $mPath = Join-Path $AgentDir $mName
  if (-not (Test-Path $mPath)) { continue }
  $dmanifest = Get-Content $mPath -Raw | ConvertFrom-Json
  foreach ($entry in $dmanifest.files) {
    $target = Join-Path $AgentDir ($entry.file -replace '/', '\')
    if ($entry.kind -eq 'create') {
      if (Test-Path $target) {
        if ($PSCmdlet.ShouldProcess($target, 'remove created file')) {
          Remove-Item $target -Force
          $restored += "$($entry.file) (created file removed)"
        }
      }
      continue
    }
    if (-not (Test-Path $target)) { $problems += "missing target: $($entry.file)"; continue }
    if ((Sha $target) -ne $entry.sha_after.ToLower()) {
      $problems += "REFUSED $($entry.file): current hash differs from the recorded patched hash (edited after patching?)"
      continue
    }
    if (-not (Test-Path $entry.bak)) { $problems += "backup gone: $($entry.bak)"; continue }
    if ($PSCmdlet.ShouldProcess($target, "restore from $($entry.bak)")) {
      Copy-Item $entry.bak $target -Force
      if ((Sha $target) -ne $entry.sha_before.ToLower()) { $problems += "restore hash mismatch: $($entry.file)" }
      else { $restored += $entry.file }
    }
  }
  if ($PSCmdlet.ShouldProcess($mPath, 'remove manifest')) { Remove-Item $mPath -Force }
}

$relDir = Join-Path $AgentDir 'apps\desktop\release'
$bakRoot = Join-Path $HermesDir 'composer-modes\backups'
$seamBackup = Get-ChildItem $bakRoot -Filter 'win-unpacked.pre-seam-*' -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if ($seamBackup -and (Test-Path (Join-Path $seamBackup.FullName 'Hermes.exe')) -and (Test-Path $relDir)) {
  if ($PSCmdlet.ShouldProcess($relDir, "restore app from $($seamBackup.Name)")) {
    $newDir = Join-Path $relDir 'win-unpacked.new'
    if (Test-Path $newDir) { Remove-Item $newDir -Force -Recurse -ErrorAction SilentlyContinue }
    robocopy $seamBackup.FullName $newDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -lt 8 -and (Test-Path (Join-Path $newDir 'Hermes.exe'))) {
      $swapPs1 = Join-Path $PSScriptRoot 'desktop-swap.ps1'
      if (Test-Path $swapPs1) {
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$swapPs1`"", '-AgentDir', "`"$AgentDir`"", '-StateDir', "`"$HermesDir\composer-modes`"") | Out-Null
        $appSwapScheduled = $true
        Write-Host '[composer-modes] app restore scheduled (detached swap of the pre-seam build).'
      }
    } else { $problems += 'could not stage the pre-seam app build for restore' }
  }
} elseif (-not $WhatIfPreference) {
  Write-Host '[composer-modes] note: no pre-seam app backup found - the installed app stays a seam build until the next Hermes update rebuilds it.'
}


# ── plugin: back it up next to the state dir, then remove ────────────────────
$pluginDir = Join-Path $HermesDir 'desktop-plugins\composer-modes'
$pluginFile = Join-Path $pluginDir 'plugin.js'
if (Test-Path $pluginFile) {
  $stateDir = Join-Path $HermesDir 'composer-modes'
  if ($PSCmdlet.ShouldProcess($pluginFile, 'remove plugin')) {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    $keep = Join-Path $stateDir ("plugin.removed-{0}.js" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Copy-Item $pluginFile $keep -Force
    Remove-Item $pluginFile -Force
    Write-Host "[composer-modes] plugin removed (kept a copy at $keep)"
  }
} else { Write-Host '[composer-modes] plugin not installed - nothing to remove' }

# ── scheduled tasks ──────────────────────────────────────────────────────────
foreach ($task in @('HermesComposerModesEnsure', 'HermesComposerModesRestart')) {
  if (schtasks /query /tn $task 2>$null) {
    if ($PSCmdlet.ShouldProcess($task, 'delete scheduled task')) {
      schtasks /delete /tn $task /f | Out-Null
      Write-Host "[composer-modes] scheduled task removed: $task"
    }
  }
}
Write-Host '[composer-modes] reminder: delete the update cronjob in Hermes (ask your agent: "remove the composer-modes update cronjob").'

# ── restart the backend so the unpatched core loads (detached) ───────────────
if ($restored.Count -gt 0 -and -not $WhatIfPreference -and -not $appSwapScheduled) {
  $restartPs1 = Join-Path $PSScriptRoot 'restart-backend.ps1'
  schtasks /create /tn 'HermesComposerModesRestart' /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$restartPs1`"" /sc once /st 00:00 /f | Out-Null
  # schtasks defaults to "do not start on battery" - laptops never fire the one-shot.
  try {
    $st = Get-ScheduledTask -TaskName 'HermesComposerModesRestart'
    $st.Settings.DisallowStartIfOnBatteries = $false
    $st.Settings.StopIfGoingOnBatteries = $false
    $st.Settings.StartWhenAvailable = $true
    Set-ScheduledTask -TaskName 'HermesComposerModesRestart' -Settings $st.Settings | Out-Null
  } catch { Write-Host "[composer-modes] WARN: could not make the restart task battery-safe: $_" }
  schtasks /run /tn 'HermesComposerModesRestart' | Out-Null
  Write-Host '[composer-modes] backend restart scheduled (detached).'
}

if ($restored.Count) { Write-Host ("[composer-modes] restored: " + ($restored -join ', ')) }
if ($problems.Count) { $problems | ForEach-Object { Write-Host "[composer-modes] PROBLEM: $_" -ForegroundColor Yellow }; exit 1 }
Write-Host '[composer-modes] uninstall clean.'
exit 0
