# CineForge automation — start the scheduler automatically when you log in to Windows.
#   powershell -ExecutionPolicy Bypass -File automation\install-startup.ps1
#   powershell -ExecutionPolicy Bypass -File automation\install-startup.ps1 -Uninstall
# Creates ONE Task Scheduler task ("CineForge Scheduler") for the current user: runs at logon, hidden, restarts on
# failure, never two at once. No administrator rights needed. The scheduler itself refuses a second instance.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$TaskName = 'CineForge Scheduler'
$Root = Split-Path -Parent $PSScriptRoot

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'. The scheduler will no longer start with Windows."
  } else { Write-Host "No scheduled task '$TaskName' found." }
  exit 0
}

# Node: the portable runtime installed by System Setup, else the one on PATH
$Node = Join-Path $Root 'runtime\node\node.exe'
if (-not (Test-Path $Node)) { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $Node) { throw 'Node.js not found (run CineForge-Setup.bat first).' }
$Script = Join-Path $Root 'automation\scheduler.mjs'
$Log = Join-Path $Root 'logs\automation\scheduler.out'
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null

# hidden console via cmd /c so stdout/stderr go to the log file
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$Node`" `"$Script`" >> `"$Log`" 2>&1`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Trigger.Delay = 'PT1M'   # give Windows a minute after logon
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Hidden
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
  -Description 'CineForge AI: unattended Shorts production scheduler (automation/scheduler.mjs).' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed '$TaskName': starts 1 minute after you log in, restarts on failure (5x, every 5 min)."
Write-Host "It is running now. Check: node automation\cli.mjs status   ·   Remove: install-startup.ps1 -Uninstall"
