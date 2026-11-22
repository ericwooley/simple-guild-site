//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
extern void hhSetupTray(const void *pngBytes, int pngLen);
extern void hhUpdateWatchLabel(int watching);
extern void hhUpdateReleaseLabel(int available, const char *version);
*/
import "C"

import (
	_ "embed"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed tray-icon.png
var trayIconPNG []byte

var trayApp *App

func setupTray(app *App) {
	trayApp = app
	if len(trayIconPNG) == 0 {
		return
	}
	C.hhSetupTray(unsafe.Pointer(&trayIconPNG[0]), C.int(len(trayIconPNG)))
}

func updateTrayWatchState(watching bool) {
	if watching {
		C.hhUpdateWatchLabel(1)
	} else {
		C.hhUpdateWatchLabel(0)
	}
}

func updateTrayUpdateState(available bool, version string) {
	cVer := C.CString(version)
	defer C.free(unsafe.Pointer(cVer))
	if available {
		C.hhUpdateReleaseLabel(1, cVer)
	} else {
		C.hhUpdateReleaseLabel(0, cVer)
	}
}

//export goTrayUpdate
func goTrayUpdate() {
	if trayApp == nil {
		return
	}
	go func() {
		status := trayApp.GetBridgeStatus()
		if status.UpdateAvailable {
			_, _ = trayApp.InstallUpdate()
			return
		}
		_, _ = trayApp.CheckForUpdates()
	}()
}

//export goTrayOpen
func goTrayOpen() {
	if trayApp == nil {
		return
	}
	trayApp.mu.Lock()
	ctx := trayApp.ctx
	trayApp.mu.Unlock()
	if ctx != nil {
		runtime.WindowShow(ctx)
		runtime.WindowUnminimise(ctx)
	}
}

//export goTraySettings
func goTraySettings() {
	if trayApp == nil {
		return
	}
	trayApp.mu.Lock()
	trayApp.openSettings = true
	ctx := trayApp.ctx
	trayApp.mu.Unlock()
	if ctx != nil {
		runtime.WindowShow(ctx)
		runtime.WindowUnminimise(ctx)
	}
}

//export goTraySyncNow
func goTraySyncNow() {
	if trayApp == nil {
		return
	}
	go func() {
		_, _ = trayApp.SyncNow()
	}()
}

//export goTrayToggleWatch
func goTrayToggleWatch() {
	if trayApp == nil {
		return
	}
	go func() {
		status := trayApp.GetBridgeStatus()
		if status.Watching {
			trayApp.StopWatching()
		} else {
			trayApp.StartWatching()
		}
	}()
}

//export goTrayQuit
func goTrayQuit() {
	if trayApp == nil {
		return
	}
	trayApp.mu.Lock()
	trayApp.quitting = true
	ctx := trayApp.ctx
	trayApp.mu.Unlock()
	if ctx != nil {
		runtime.Quit(ctx)
	}
}
