# LabourLink Flutter Run Script
# Kills lingering build processes, clears corrupted build artifacts, then runs the app.
# Usage: Right-click -> "Run with PowerShell" OR run: .\run_app.ps1

$device = "53a231b2"
$appDir = $PSScriptRoot

Write-Host "==> Stopping lingering Java/Gradle/Dart processes..." -ForegroundColor Cyan
Get-Process | Where-Object { $_.Name -match 'java|gradle|dart|flutter' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "==> Clearing build directory..." -ForegroundColor Cyan
if (Test-Path "$appDir\build") {
    cmd /c "rd /s /q `"$appDir\build`"" 2>$null
}

Write-Host "==> Starting Node.js backend server..." -ForegroundColor Cyan
$serverPath = "$appDir\..\server.js"
Start-Process -FilePath "node" -ArgumentList $serverPath -WorkingDirectory "$appDir\.." -WindowStyle Minimized -ErrorAction SilentlyContinue

Start-Sleep -Seconds 1
Write-Host "==> Launching Flutter app on device $device..." -ForegroundColor Green
Set-Location $appDir
flutter run -d $device
