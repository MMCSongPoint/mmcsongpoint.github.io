@echo off
rem SongPoint: save every song's slides as pictures with PowerPoint (into My Drive\SongPoint\Slide Images).
rem Close this window to stop; run it again to carry on where it left off.
title SongPoint - saving slides as pictures
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Export-SlideImages.ps1" %*
echo.
pause
