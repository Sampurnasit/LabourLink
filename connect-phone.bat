@echo off
echo ==============================================
echo LabourLink Android Phone Port Forwarding
echo ==============================================
echo Enabling ADB reverse forwarding on port 3000...
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" reverse tcp:3000 tcp:3000
if %ERRORLEVEL% EQU 0 (
    echo [OK] Port 3000 forwarded to physical Android device!
    echo Your phone can now talk directly to the Node backend at http://localhost:3000.
) else (
    echo [ERROR] Could not forward port. Ensure your phone has USB debugging enabled and is connected.
)
pause
