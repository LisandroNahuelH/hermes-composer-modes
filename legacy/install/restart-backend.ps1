# Detached backend restart for composer-modes.
# Runs from the one-shot task HermesComposerModesRestart, never inline: killing the
# serve process mid-turn would kill the very agent that is installing. The app
# respawns the backend on its next dial.
param(
  [int]$DelaySeconds = 45,
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'hermes\composer-modes')
)
Start-Sleep -Seconds $DelaySeconds
$killed = @()
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*hermes_cli.main serve*' } |
  ForEach-Object {
    $killed += $_.ProcessId
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
Add-Content -Path (Join-Path $StateDir 'restart.log') -Value ("[{0}] restart-backend: killed serve pid(s): {1}" -f (Get-Date -Format s), ($(if ($killed) { $killed -join ', ' } else { 'none found' })))
