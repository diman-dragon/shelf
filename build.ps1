$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path 'android\gradlew.bat')) {
  throw 'android\gradlew.bat was not found. Run .\setup.ps1 first.'
}

Set-Location android
Write-Host 'Building debug APK...' -ForegroundColor Yellow
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed.' }

$apk = Join-Path $PWD 'app\build\outputs\apk\debug\app-debug.apk'
Write-Host ''
Write-Host "APK: $apk" -ForegroundColor Green
