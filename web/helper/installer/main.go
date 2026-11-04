// SongPoint PowerPoint helper installer (Windows).
// Copies the helper into %LOCALAPPDATA%\SongPoint helper, makes it start with Windows (hidden, from the
// Startup folder), and starts it now. Running it again updates the helper in place.
// Build: ./build.sh (copies the helper files next to this file and cross-compiles with Go).
package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed files/SongPoint-PowerPoint.ps1
var ps1 []byte

//go:embed "files/READ ME.txt"
var readme []byte

//go:embed "files/Start SongPoint PowerPoint helper.cmd"
var startCmd []byte

//go:embed "files/Stop SongPoint PowerPoint helper.cmd"
var stopCmd []byte

const startupName = "SongPoint PowerPoint helper.vbs"

var (
	user32     = syscall.NewLazyDLL("user32.dll")
	messageBox = user32.NewProc("MessageBoxW")
)

func msg(text string, icon uint32) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString("SongPoint PowerPoint helper")
	r, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), uintptr(icon))
	return int(r)
}

const (
	mbOK       = 0x0
	mbOKCancel = 0x1
	mbInfo     = 0x40
	mbError    = 0x10
	mbQuestion = 0x20
	idOK       = 1
)

func hidden(name string, args ...string) *exec.Cmd {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return c
}

// stops a helper that's already running (an older copy, or this one from before)
func stopRunning() {
	hidden("powershell", "-NoProfile", "-Command",
		`Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*SongPoint-PowerPoint.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`).Run()
	time.Sleep(800 * time.Millisecond)
}

// a .vbs that starts the helper with no window
func launcher(dir string) []byte {
	ps := filepath.Join(dir, "SongPoint-PowerPoint.ps1")
	return []byte("' Starts the SongPoint PowerPoint helper with no window (put here by the SongPoint helper installer).\r\n" +
		"' What it does is written to Documents\\SongPoint slides\\helper log.txt.\r\n" +
		"CreateObject(\"WScript.Shell\").Run \"powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"\"" +
		strings.ReplaceAll(ps, `"`, `""`) + "\"\" -Hidden\", 0, False\r\n")
}

func uninstaller(dir, startup string) []byte {
	return []byte("@echo off\r\n" +
		"echo Removing the SongPoint PowerPoint helper...\r\n" +
		"powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='powershell.exe'\\\" | Where-Object { $_.CommandLine -like '*SongPoint-PowerPoint.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\"\r\n" +
		"del \"" + startup + "\" 2>nul\r\n" +
		"echo Done. It no longer starts with Windows. You can delete this folder:\r\n" +
		"echo " + dir + "\r\n" +
		"pause\r\n")
}

func run() error {
	local := os.Getenv("LOCALAPPDATA")
	appdata := os.Getenv("APPDATA")
	if local == "" || appdata == "" {
		return fmt.Errorf("couldn't find this user's AppData folders")
	}
	dir := filepath.Join(local, "SongPoint helper")
	startupDir := filepath.Join(appdata, `Microsoft\Windows\Start Menu\Programs\Startup`)
	startup := filepath.Join(startupDir, startupName)

	stopRunning()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	files := map[string][]byte{
		"SongPoint-PowerPoint.ps1": ps1,
		"READ ME.txt":              readme,
		"Start SongPoint PowerPoint helper (window).cmd": startCmd,
		"Stop SongPoint PowerPoint helper.cmd":           stopCmd,
		"Start SongPoint PowerPoint helper (hidden).vbs": launcher(dir),
		"Remove SongPoint PowerPoint helper.cmd":         uninstaller(dir, startup),
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			return fmt.Errorf("couldn't write %s: %v", name, err)
		}
	}
	if err := os.MkdirAll(startupDir, 0o755); err != nil {
		return err
	}
	// shortcuts to the old helper someone put in Startup by hand would start a second copy
	if old, _ := filepath.Glob(filepath.Join(startupDir, "*SongPoint*.lnk")); len(old) > 0 {
		for _, f := range old {
			os.Remove(f)
		}
	}
	if err := os.WriteFile(startup, launcher(dir), 0o644); err != nil {
		return fmt.Errorf("couldn't add it to the Startup folder: %v", err)
	}
	// start it now
	if err := hidden("wscript.exe", startup).Start(); err != nil {
		return fmt.Errorf("installed, but couldn't start it: %v", err)
	}
	// check it's listening
	for i := 0; i < 20; i++ {
		time.Sleep(500 * time.Millisecond)
		if out, err := hidden("powershell", "-NoProfile", "-Command",
			"try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:47321/status).Content } catch { '' }").Output(); err == nil && strings.Contains(string(out), "songpoint-ppt") {
			return nil
		}
	}
	return fmt.Errorf("it's installed and will start with Windows, but it didn't answer yet. Restart the computer, or open \"%s\" and run \"Start SongPoint PowerPoint helper (window).cmd\" to see what's wrong", dir)
}

func main() {
	if msg("This sets up the SongPoint PowerPoint helper on this computer:\n\n"+
		"• it starts hidden every time Windows starts\n"+
		"• it starts now\n\n"+
		"It lets SongPoint's presenter play speakers' PowerPoints in PowerPoint. Continue?", mbOKCancel|mbQuestion) != idOK {
		return
	}
	if err := run(); err != nil {
		msg("Something went wrong:\n\n"+err.Error(), mbOK|mbError)
		os.Exit(1)
	}
	msg("Done. The helper is running and will start with Windows.\n\n"+
		"It's in "+filepath.Join(os.Getenv("LOCALAPPDATA"), "SongPoint helper")+" (with Stop and Remove).\n\n"+
		"The first time you present, Chrome may ask to let mmcsongpoint.github.io access other apps on this device: choose Allow.", mbOK|mbInfo)
}
