' Starts the SongPoint PowerPoint helper with no window (for the Startup folder).
' What it does is written to Documents\SongPoint slides\helper log.txt. To stop it, run "Stop SongPoint PowerPoint helper.cmd".
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\SongPoint-PowerPoint.ps1"" -Hidden", 0, False
