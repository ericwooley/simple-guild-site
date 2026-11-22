//go:build darwin

package main

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const launchAgentLabel = "com.helpinghand.sync"

func launchAgentPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return "", errors.New("unable to determine user home directory")
	}
	return filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist"), nil
}

func xmlEscapeString(s string) string {
	var buf bytes.Buffer
	_ = xml.EscapeText(&buf, []byte(s))
	return buf.String()
}

func renderLaunchAgentPlist(execPath, siteURL string) string {
	var envBlock string
	if strings.TrimSpace(siteURL) != "" {
		envBlock = fmt.Sprintf(`	<key>EnvironmentVariables</key>
	<dict>
		<key>HELPING_HAND_URL</key>
		<string>%s</string>
	</dict>
`, xmlEscapeString(siteURL))
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
	</array>
%s	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<false/>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
`, launchAgentLabel, xmlEscapeString(execPath), envBlock)
}

func isLaunchAtLoginEnabled() bool {
	p, err := launchAgentPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

func setLaunchAtLogin(enabled bool, siteURL string) error {
	p, err := launchAgentPath()
	if err != nil {
		return err
	}
	if !enabled {
		if rmErr := os.Remove(p); rmErr != nil && !errors.Is(rmErr, os.ErrNotExist) {
			return rmErr
		}
		return nil
	}
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("unable to locate application executable: %w", err)
	}
	if resolved, evalErr := filepath.EvalSymlinks(execPath); evalErr == nil && resolved != "" {
		execPath = resolved
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	content := renderLaunchAgentPlist(execPath, siteURL)
	return os.WriteFile(p, []byte(content), 0o644)
}
