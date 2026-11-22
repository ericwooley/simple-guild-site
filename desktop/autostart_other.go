//go:build !darwin

package main

import "errors"

func isLaunchAtLoginEnabled() bool {
	return false
}

func setLaunchAtLogin(enabled bool, _ string) error {
	if !enabled {
		return nil
	}
	return errors.New("launch at login is currently supported on macOS only")
}
