<#
  CineForge AI bootstrap: gets the dashboard running on a PC that has nothing installed yet.

  The dashboard needs Node.js to run, so it cannot install Node itself. This script:
    1. uses runtime\node\node.exe, or a system Node.js >= 22, if present;
    2. otherwise (after asking) downloads the portable Node.js zip pinned in config\dependencies.json from nodejs.org,
       checks its SHA-256 against that pin, and unpacks it into runtime\node
       (no installer, no administrator rights, no PATH or registry change);
    3. starts the dashboard on 127.0.0.1 and opens Settings -> System Setup, where everything else
       (Python, FFmpeg, models, ComfyUI ...) is installed from the UI.

  Usage:  CineForge-Setup.bat  [-Port 3000] [-NoBrowser] [-CheckOnly] [-Yes]
#>
param(
  [int]$Port = 0,
  [switch]$NoBrowser,
  [switch]$CheckOnly,
  [switch]$Yes,
  [string]$NodeDir = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is 10x slower with the progress bar
$Root = $PSScriptRoot
if (-not $NodeDir) { $NodeDir = Join-Path $Root 'runtime\node' }
$MinMajor = 22

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

function Get-NodeVersion($exe) {
  try { $v = (& $exe --version 2>$null) -replace '^v', ''; if ($v -match '^(\d+)\.') { return [version]($v -replace '[^\d.].*$', '') } } catch {}
  return $null
}

function Find-Node {
  $local = Join-Path $NodeDir 'node.exe'
  if (Test-Path $local) { $v = Get-NodeVersion $local; if ($v -and $v.Major -ge $MinMajor) { return @{ exe = $local; version = $v; how = 'portable (runtime\node)' } } }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $v = Get-NodeVersion $cmd.Source; if ($v -and $v.Major -ge $MinMajor) { return @{ exe = $cmd.Source; version = $v; how = 'system install' } } }
  return $null
}

function Install-PortableNode {
  $reg = Get-Content (Join-Path $Root 'config\dependencies.json') -Raw | ConvertFrom-Json
  $art = ($reg.components | Where-Object { $_.id -eq 'node' }).install.artifact
  if (-not $art -or $art.url -notmatch '^https://nodejs\.org/dist/') { throw 'config\dependencies.json has no trusted Node.js artifact' }
  $mb = [math]::Round($art.size / 1MB, 1)
  Say ''
  Say "Node.js $MinMajor+ was not found. CineForge AI can download the portable Node.js zip ($mb MB) from" 'Yellow'
  Say "  $($art.url)" 'Yellow'
  Say "and unpack it into $NodeDir. No installer, no administrator rights, no PATH change." 'Yellow'
  if (-not $Yes) { $a = Read-Host 'Download it now? [Y/n]'; if ($a -and $a -notmatch '^[Yy]') { Say 'Cancelled. Install Node.js 22 LTS from https://nodejs.org/ and run this again.'; exit 1 } }

  $dl = Join-Path $Root 'runtime\.downloads'; New-Item -ItemType Directory -Force $dl | Out-Null
  $zip = Join-Path $dl ([IO.Path]::GetFileName($art.url))
  $ok = $false
  if (Test-Path $zip) { $ok = ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -eq $art.sha256) ; if ($ok) { Say 'Using the already downloaded zip (checksum matches).' } }
  if (-not $ok) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    for ($i = 1; $i -le 4 -and -not $ok; $i++) {
      try {
        Say "Downloading ($i/4)..."
        Invoke-WebRequest -Uri $art.url -OutFile "$zip.part" -UseBasicParsing -TimeoutSec 600
        $h = (Get-FileHash "$zip.part" -Algorithm SHA256).Hash.ToLower()
        if ($h -ne $art.sha256) { Remove-Item "$zip.part" -Force; throw "SHA-256 mismatch ($h): file discarded" }
        Move-Item "$zip.part" $zip -Force; $ok = $true
      } catch { Say "  $($_.Exception.Message)" 'Red'; if ($i -lt 4) { Start-Sleep -Seconds (2 * $i * $i) } }
    }
    if (-not $ok) { throw 'Node.js download failed. Check the internet connection, or install Node.js 22 LTS from https://nodejs.org/ and run this again.' }
  }
  Say 'SHA-256 verified. Unpacking...' 'Green'
  $staging = Join-Path $dl 'node-staging'
  if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
  $inner = Get-ChildItem $staging -Directory | Select-Object -First 1
  if (-not (Test-Path (Join-Path $inner.FullName 'node.exe'))) { throw 'node.exe not found in the archive' }
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  New-Item -ItemType Directory -Force (Split-Path $NodeDir) | Out-Null
  Move-Item $inner.FullName $NodeDir
  Remove-Item $staging -Recurse -Force; Remove-Item $zip -Force
  Say "Portable Node.js installed in $NodeDir" 'Green'
}

Say '=============================================================================='
Say '  CineForge AI - bootstrap'
Say '=============================================================================='
if ([Environment]::OSVersion.Version.Build -lt 17134) { Say 'Windows 10 version 1803 or newer is required.' 'Red'; exit 1 }
if (-not [Environment]::Is64BitOperatingSystem) { Say 'A 64-bit Windows is required.' 'Red'; exit 1 }

$node = Find-Node
if (-not $node) {
  if ($CheckOnly) { Say 'Node.js: not found (would offer the portable download)'; exit 2 }
  Install-PortableNode
  $node = Find-Node
  if (-not $node) { throw 'Node.js still not usable after installation.' }
}
Say "Node.js $($node.version) - $($node.how)" 'Green'
if ($CheckOnly) { exit 0 }

if ($Port -eq 0) { $Port = if ($env:PORT) { [int]$env:PORT } else { (Get-Content (Join-Path $Root 'config\studio-config.json') -Raw | ConvertFrom-Json).port } }

# one server per workspace: if one is already running, just open it
$lock = Join-Path $Root 'logs\jobs\.server.lock'
if (Test-Path $lock) {
  try {
    $l = Get-Content $lock -Raw | ConvertFrom-Json
    if (Get-Process -Id $l.pid -ErrorAction SilentlyContinue) {
      Say "The studio is already running (pid $($l.pid)) at http://127.0.0.1:$($l.port)/" 'Yellow'
      if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$($l.port)/#setup" }
      exit 0
    }
  } catch {}
}

# a port taken by another program is reported, never taken over
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { Say "Port $Port is used by another program (pid $($busy[0].OwningProcess)). Run: CineForge-Setup.bat -Port 3200" 'Red'; exit 1 }

Say "Starting the dashboard at http://127.0.0.1:$Port/  (close this window or press Ctrl+C to stop)" 'Cyan'
if (-not $NoBrowser) {
  Start-Job -ScriptBlock { param($p) for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Milliseconds 500; try { Invoke-WebRequest "http://127.0.0.1:$p/api/setup/session" -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process "http://127.0.0.1:$p/#setup"; return } catch {} } } -ArgumentList $Port | Out-Null
}
$env:PORT = "$Port"
& $node.exe (Join-Path $Root 'dashboard\server.js')
