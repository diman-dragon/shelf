$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '== Shelf Android setup ==' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found. Install Node.js 20+ and run this script again.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm was not found. Install Node.js 20+ and run this script again.'
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw 'Python was not found. Install Python 3 and run this script again.'
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 20) {
  throw "Node.js 20+ is required. Current version: $(node -v)"
}

Write-Host '1/4 Installing npm dependencies...' -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

New-Item -ItemType Directory -Force -Path 'www/lib' | Out-Null
Copy-Item 'node_modules/idb-keyval/dist/umd.js' 'www/lib/idb-keyval.js' -Force
Copy-Item 'node_modules/jsmediatags/dist/jsmediatags.min.js' 'www/lib/jsmediatags.min.js' -Force

if (-not (Test-Path 'android')) {
  Write-Host '2/4 Creating Android project with Capacitor...' -ForegroundColor Yellow
  npx cap add android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor could not create the android directory.' }
} else {
  Write-Host '2/4 Existing android directory found.' -ForegroundColor Yellow
}

Write-Host '3/4 Installing Shelf native Android code...' -ForegroundColor Yellow
python patch_android.py
if ($LASTEXITCODE -ne 0) { throw 'patch_android.py failed.' }

Write-Host '4/4 Synchronizing Capacitor...' -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }

Write-Host ''
Write-Host 'SETUP COMPLETE.' -ForegroundColor Green
Write-Host "Android project: $PSScriptRoot\android"
Write-Host 'Next command: .\build.ps1'
