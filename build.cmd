@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if errorlevel 1 pause
