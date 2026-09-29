# JAVE in one line (Windows PowerShell):
#
#   irm https://raw.githubusercontent.com/Kjellwebsite/Jave/HEAD/install.ps1 | iex
#
# Installs into %USERPROFILE%\JAVE: its own Node.js (unless a recent one is
# installed), the latest JAVE, and "JAVE starten" on the desktop. Then starts
# JAVE (start.mjs). Running it again updates JAVE; settings (.env) and data
# stay. Messages are ASCII so every console shows them.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # downloads are far faster without the progress bar
# Windows PowerShell 5.1 may still default to TLS 1.0, which nodejs.org and GitHub refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'Kjellwebsite/Jave'
$JaveDir = if ($env:JAVE_HOME) { $env:JAVE_HOME } else { Join-Path $env:USERPROFILE 'JAVE' }
$AppDir = Join-Path $JaveDir 'app'
$NodeDir = Join-Path $JaveDir 'node'
# Where JAVE comes from; overridable for testing an unreleased copy.
$Source = if ($env:JAVE_TARBALL) { $env:JAVE_TARBALL } else { "https://github.com/$Repo/archive/HEAD.tar.gz" }
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  & node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
  return $LASTEXITCODE -eq 0
}

if (Test-Path (Join-Path $NodeDir 'node.exe')) { $env:Path = "$NodeDir;$env:Path" }
if (-not (Test-Node)) {
  Write-Host '> Lade Node.js (einmalig) ...'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  # index.json lists releases newest first: the first v22 is the latest. (Held in a
  # variable first: piped straight on, the whole JSON array would pass as one item.)
  $releases = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
  $version = ($releases | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version
  $zip = Join-Path $env:TEMP "node-$version.zip"
  $unpack = Join-Path $env:TEMP "node-$version"
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$version/node-$version-win-$arch.zip" -OutFile $zip
  if (Test-Path $unpack) { Remove-Item -Recurse -Force $unpack }
  New-Item -ItemType Directory -Force -Path $unpack | Out-Null
  # tar (built into Windows 10+) unpacks zip files far faster than Expand-Archive.
  tar -xf $zip -C $unpack
  if ($LASTEXITCODE -ne 0) { throw 'Node.js konnte nicht entpackt werden.' }
  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  Move-Item (Join-Path $unpack "node-$version-win-$arch") $NodeDir
  Remove-Item $zip
  $env:Path = "$NodeDir;$env:Path"
}

Write-Host '> Lade JAVE ...'
$tarball = Join-Path $env:TEMP 'jave.tar.gz'
Invoke-WebRequest -UseBasicParsing $Source -OutFile $tarball
tar -xzf $tarball -C $AppDir --strip-components=1
if ($LASTEXITCODE -ne 0) { throw 'JAVE konnte nicht entpackt werden.' }
Remove-Item $tarball

# A starter for next time: double-click "JAVE starten" on the desktop. It names the
# folder through %USERPROFILE%, so a user name with umlauts survives the ASCII file.
$starter = Join-Path ([Environment]::GetFolderPath('Desktop')) 'JAVE starten.cmd'
$StartDir = if ($env:JAVE_HOME) { $env:JAVE_HOME } else { '%USERPROFILE%\JAVE' }
@"
@echo off
set "PATH=$StartDir\node;%PATH%"
cd /d "$StartDir\app"
node start.mjs
pause
"@ | Set-Content -Path $starter -Encoding ASCII
Write-Host 'OK: Zum naechsten Start: Doppelklick auf "JAVE starten" auf dem Desktop.'

Set-Location $AppDir
& node start.mjs
