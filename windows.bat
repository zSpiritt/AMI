@echo off
echo.
echo   AMI - Installation...
echo.
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/zSpiritt/AMI/main/setup.ps1' -OutFile '%TEMP%\ami-setup.ps1'; & '%TEMP%\ami-setup.ps1'"
