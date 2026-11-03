@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*SongPoint-PowerPoint.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host 'SongPoint PowerPoint helper stopped.'"
timeout /t 3 >nul
