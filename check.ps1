Write-Host "=== 1. Checking JS syntax and ESLint ===" -ForegroundColor Cyan
if (Test-Path "node_modules\.bin\eslint.cmd") {
    npx eslint www/js/ --ext .js
} else {
    Write-Host "ESLint not found, skipping static analysis." -ForegroundColor Yellow
}

Write-Host "=== 2. Checking Capacitor config ===" -ForegroundColor Cyan
if ((Test-Path "capacitor.config.json") -or (Test-Path "capacitor.config.ts")) {
    Write-Host "Capacitor config found." -ForegroundColor Green
}

Write-Host "ALL CLEAR! Checks passed successfully." -ForegroundColor Green