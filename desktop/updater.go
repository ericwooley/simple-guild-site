package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

type githubRelease struct {
	TagName string               `json:"tag_name"`
	Name    string               `json:"name"`
	HTMLURL string               `json:"html_url"`
	Draft   bool                 `json:"draft"`
	Assets  []githubReleaseAsset `json:"assets"`
}

type UpdateState struct {
	Available    bool
	LatestVer    string
	ReleaseURL   string
	AssetURL     string
	AssetName    string
	ChecksumURL  string
	Checking     bool
	Installing   bool
	LastError    string
	LastChecked  string
}

func normalizeVersion(raw string) (major, minor, patch int, isDev bool, ok bool) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "desktop-")
	s = strings.TrimPrefix(s, "v")
	if s == "" {
		return 0, 0, 0, false, false
	}
	if idx := strings.IndexByte(s, '-'); idx >= 0 {
		suffix := strings.ToLower(s[idx+1:])
		if strings.Contains(suffix, "dev") || strings.Contains(suffix, "alpha") || strings.Contains(suffix, "beta") {
			isDev = true
		}
		s = s[:idx]
	}
	parts := strings.Split(s, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, 0, 0, false, false
	}
	maj, err1 := strconv.Atoi(parts[0])
	min, err2 := strconv.Atoi(parts[1])
	pat := 0
	var err3 error
	if len(parts) == 3 {
		pat, err3 = strconv.Atoi(parts[2])
	}
	if err1 != nil || err2 != nil || err3 != nil || maj < 0 || min < 0 || pat < 0 {
		return 0, 0, 0, false, false
	}
	return maj, min, pat, isDev, true
}

// isNewerVersion returns true when candidate is strictly newer than current.
func isNewerVersion(current, candidate string) bool {
	cMaj, cMin, cPat, cDev, cOk := normalizeVersion(current)
	nMaj, nMin, nPat, nDev, nOk := normalizeVersion(candidate)
	if !nOk {
		return false
	}
	if !cOk {
		return !nDev
	}
	if nMaj != cMaj {
		return nMaj > cMaj
	}
	if nMin != cMin {
		return nMin > cMin
	}
	if nPat != cPat {
		return nPat > cPat
	}
	// Same numeric version: a non-dev release is newer than a -dev build.
	return cDev && !nDev
}

func formatDisplayVersion(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "desktop-")
	s = strings.TrimPrefix(s, "v")
	if s == "" {
		return "0.1.0-dev"
	}
	return s
}

func selectMacOSDMGAsset(assets []githubReleaseAsset, arch string) (dmg *githubReleaseAsset, checksum *githubReleaseAsset) {
	archLower := strings.ToLower(strings.TrimSpace(arch))
	var universal *githubReleaseAsset
	var archMatch *githubReleaseAsset
	var fallback *githubReleaseAsset

	for i := range assets {
		a := &assets[i]
		lower := strings.ToLower(a.Name)
		if lower == "sha256sums.txt" || lower == "checksums.txt" {
			checksum = a
			continue
		}
		if !strings.HasSuffix(lower, ".dmg") {
			continue
		}
		if strings.Contains(lower, "universal") {
			universal = a
		} else if archLower != "" && (strings.Contains(lower, archLower) || (archLower == "amd64" && strings.Contains(lower, "x86_64"))) {
			archMatch = a
		} else if fallback == nil {
			fallback = a
		}
	}

	switch {
	case archMatch != nil:
		dmg = archMatch
	case universal != nil:
		dmg = universal
	default:
		dmg = fallback
	}
	return dmg, checksum
}

func isTrustedReleaseAssetURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || strings.ToLower(parsed.Scheme) != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" ||
		host == "api.github.com" ||
		host == "objects.githubusercontent.com" ||
		host == "release-assets.githubusercontent.com" ||
		strings.HasSuffix(host, ".githubusercontent.com")
}

func parseChecksumForFile(checksumText, filename string) string {
	target := strings.TrimSpace(filename)
	for _, line := range strings.Split(checksumText, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		hash := strings.ToLower(fields[0])
		name := strings.TrimPrefix(fields[1], "*")
		name = filepath.Base(name)
		if len(hash) == 64 && strings.EqualFold(name, target) {
			return hash
		}
	}
	return ""
}

func updateHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects while downloading update")
			}
			if !isTrustedReleaseAssetURL(req.URL.String()) {
				return fmt.Errorf("refusing redirect to untrusted host %q", req.URL.Hostname())
			}
			return nil
		},
	}
}

func fetchLatestRelease(ctx context.Context, repo string) (*githubRelease, error) {
	endpoint := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "HelpingHandDesktop/"+AppVersion)

	client := updateHTTPClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not check for updates: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub release check returned HTTP %d", resp.StatusCode)
	}
	var rel githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rel); err != nil {
		return nil, err
	}
	if rel.Draft {
		return nil, nil
	}
	return &rel, nil
}

func (a *App) startAutoUpdateLoop() {
	a.mu.Lock()
	if a.stopUpdate != nil {
		a.mu.Unlock()
		return
	}
	stop := make(chan struct{})
	a.stopUpdate = stop
	a.mu.Unlock()

	go func() {
		// Brief delay after startup so UI and proxy initialize first.
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		select {
		case <-stop:
			return
		case <-timer.C:
			_, _ = a.CheckForUpdates()
		}

		ticker := time.NewTicker(60 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				_, _ = a.CheckForUpdates()
			}
		}
	}()
}

func (a *App) stopAutoUpdateLoop() {
	a.mu.Lock()
	if a.stopUpdate != nil {
		close(a.stopUpdate)
		a.stopUpdate = nil
	}
	a.mu.Unlock()
}

func (a *App) CheckForUpdates() (BridgeStatus, error) {
	a.mu.Lock()
	if a.update.Checking || a.update.Installing {
		st := a.statusLocked()
		a.mu.Unlock()
		return st, nil
	}
	a.update.Checking = true
	a.update.LastError = ""
	st := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(st)

	repo := strings.TrimSpace(os.Getenv("HELPING_HAND_UPDATE_REPO"))
	if repo == "" {
		repo = effectiveUpdateRepo()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	rel, err := fetchLatestRelease(ctx, repo)

	a.mu.Lock()
	a.update.Checking = false
	a.update.LastChecked = time.Now().UTC().Format(time.RFC3339)
	if err != nil {
		a.update.LastError = err.Error()
		st = a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(st)
		return st, err
	}
	if rel == nil {
		a.update.Available = false
		a.update.LatestVer = ""
		a.update.AssetURL = ""
		a.update.AssetName = ""
		a.update.ChecksumURL = ""
		a.update.ReleaseURL = ""
		st = a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(st)
		return st, nil
	}

	dmg, checksum := selectMacOSDMGAsset(rel.Assets, runtime.GOARCH)
	latestDisplay := formatDisplayVersion(rel.TagName)
	available := isNewerVersion(AppVersion, rel.TagName) && dmg != nil && isTrustedReleaseAssetURL(dmg.BrowserDownloadURL)

	a.update.Available = available
	a.update.LatestVer = latestDisplay
	a.update.ReleaseURL = rel.HTMLURL
	if dmg != nil {
		a.update.AssetURL = dmg.BrowserDownloadURL
		a.update.AssetName = dmg.Name
	} else {
		a.update.AssetURL = ""
		a.update.AssetName = ""
	}
	if checksum != nil && isTrustedReleaseAssetURL(checksum.BrowserDownloadURL) {
		a.update.ChecksumURL = checksum.BrowserDownloadURL
	} else {
		a.update.ChecksumURL = ""
	}
	a.update.LastError = ""
	st = a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(st)
	return st, nil
}

func downloadToFile(ctx context.Context, rawURL, destPath string) (string, error) {
	if !isTrustedReleaseAssetURL(rawURL) {
		return "", errors.New("refusing to download update from untrusted URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "HelpingHandDesktop/"+AppVersion)

	client := updateHTTPClient(5 * time.Minute)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download failed with HTTP %d", resp.StatusCode)
	}
	f, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", err
	}
	defer f.Close()

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(f, hasher), io.LimitReader(resp.Body, 256<<20)); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func findAppBundleForExecutable(execPath string) string {
	cur := execPath
	for i := 0; i < 6; i++ {
		if strings.HasSuffix(strings.ToLower(cur), ".app") {
			return cur
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			break
		}
		cur = parent
	}
	return ""
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func (a *App) InstallUpdate() (BridgeStatus, error) {
	if runtime.GOOS != "darwin" {
		return a.GetBridgeStatus(), errors.New("one-click updates are currently supported on macOS only")
	}

	a.mu.Lock()
	if a.update.Installing {
		st := a.statusLocked()
		a.mu.Unlock()
		return st, nil
	}
	assetURL := a.update.AssetURL
	assetName := a.update.AssetName
	checksumURL := a.update.ChecksumURL
	ctx := a.ctx
	a.mu.Unlock()

	if assetURL == "" {
		// Try refreshing release info first.
		st, err := a.CheckForUpdates()
		if err != nil {
			return st, err
		}
		a.mu.Lock()
		assetURL = a.update.AssetURL
		assetName = a.update.AssetName
		checksumURL = a.update.ChecksumURL
		a.mu.Unlock()
		if assetURL == "" {
			return st, errors.New("no macOS DMG update asset found in the latest release")
		}
	}

	a.mu.Lock()
	a.update.Installing = true
	a.update.LastError = ""
	st := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(st)

	fail := func(err error) (BridgeStatus, error) {
		a.mu.Lock()
		a.update.Installing = false
		a.update.LastError = err.Error()
		s := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(s)
		return s, err
	}

	tmpDir, err := os.MkdirTemp("", "helpinghand-update-*")
	if err != nil {
		return fail(err)
	}
	cleanupTmp := true
	defer func() {
		if cleanupTmp {
			_ = os.RemoveAll(tmpDir)
		}
	}()

	dlCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	dmgPath := filepath.Join(tmpDir, "HelpingHand.dmg")
	actualHash, err := downloadToFile(dlCtx, assetURL, dmgPath)
	if err != nil {
		return fail(fmt.Errorf("failed to download update: %w", err))
	}

	if checksumURL != "" {
		sumPath := filepath.Join(tmpDir, "SHA256SUMS.txt")
		if _, err := downloadToFile(dlCtx, checksumURL, sumPath); err != nil {
			return fail(fmt.Errorf("failed to download checksum file: %w", err))
		}
		sumBytes, err := os.ReadFile(sumPath)
		if err != nil {
			return fail(err)
		}
		expected := parseChecksumForFile(string(sumBytes), assetName)
		if expected == "" {
			return fail(fmt.Errorf("checksum entry for %s not found in SHA256SUMS.txt", assetName))
		}
		if !strings.EqualFold(expected, actualHash) {
			return fail(errors.New("downloaded update failed SHA-256 checksum verification"))
		}
	}

	mountDir := filepath.Join(tmpDir, "mnt")
	if err := os.MkdirAll(mountDir, 0o700); err != nil {
		return fail(err)
	}
	attachCmd := exec.Command("/usr/bin/hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mountDir, dmgPath)
	if out, err := attachCmd.CombinedOutput(); err != nil {
		return fail(fmt.Errorf("failed to mount update DMG: %v (%s)", err, strings.TrimSpace(string(out))))
	}
	defer func() {
		_ = exec.Command("/usr/bin/hdiutil", "detach", mountDir, "-quiet").Run()
	}()

	matches, _ := filepath.Glob(filepath.Join(mountDir, "*.app"))
	if len(matches) == 0 {
		return fail(errors.New("mounted update DMG did not contain a .app bundle"))
	}
	srcApp := matches[0]

	execPath, err := os.Executable()
	if err != nil {
		return fail(err)
	}
	if resolved, evalErr := filepath.EvalSymlinks(execPath); evalErr == nil && resolved != "" {
		execPath = resolved
	}
	targetApp := findAppBundleForExecutable(execPath)
	pid := os.Getpid()

	if targetApp != "" {
		if strings.HasPrefix(targetApp, "/Volumes/") {
			targetApp = "/Applications/HelpingHand.app"
		}
		// Stage the new .app next to the current .app so permission failures surface before quitting.
		stagedApp := filepath.Join(filepath.Dir(targetApp), ".HelpingHand.app.new")
		_ = os.RemoveAll(stagedApp)
		dittoCmd := exec.Command("/usr/bin/ditto", srcApp, stagedApp)
		if out, err := dittoCmd.CombinedOutput(); err != nil {
			// Fall back to opening the DMG in Finder so the user can drag-and-drop into Applications.
			_ = exec.Command("/usr/bin/hdiutil", "detach", mountDir, "-quiet").Run()
			cleanupTmp = false
			_ = exec.Command("/usr/bin/open", dmgPath).Start()
			return fail(fmt.Errorf("macOS blocked direct write to %s — opened the update DMG in Finder so you can drag HelpingHand.app into Applications (%s)", filepath.Dir(targetApp), strings.TrimSpace(string(out))))
		}
		_ = exec.Command("/usr/bin/xattr", "-dr", "com.apple.quarantine", stagedApp).Run()

		backupApp := filepath.Join(filepath.Dir(targetApp), ".HelpingHand.app.old")
		logPath := "/tmp/helpinghand-update.log"
		if home, hErr := os.UserHomeDir(); hErr == nil && home != "" {
			_ = os.MkdirAll(filepath.Join(home, "Library", "Logs"), 0o755)
			logPath = filepath.Join(home, "Library", "Logs", "HelpingHand-update.log")
		}
		script := fmt.Sprintf(`#!/bin/sh
exec >>%s 2>&1
echo "[$(date -u +%%FT%%TZ)] Applying HelpingHand update to %s (waiting for PID %d)"
PID=%d
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 100 ]; do
  sleep 0.2
  i=$((i + 1))
done
/bin/rm -rf %s
if [ -e %s ]; then
  /bin/mv %s %s && /bin/mv %s %s
else
  /bin/mv %s %s
fi
if [ $? -eq 0 ]; then
  /bin/rm -rf %s
  echo "[$(date -u +%%FT%%TZ)] Update swapped cleanly, relaunching..."
  /usr/bin/open -n %s
else
  echo "[$(date -u +%%FT%%TZ)] ERROR swapping app bundle, restoring backup..."
  [ -e %s ] && /bin/mv %s %s 2>/dev/null
fi
`, shellQuote(logPath), targetApp, pid, pid,
			shellQuote(backupApp),
			shellQuote(targetApp),
			shellQuote(targetApp), shellQuote(backupApp),
			shellQuote(stagedApp), shellQuote(targetApp),
			shellQuote(stagedApp), shellQuote(targetApp),
			shellQuote(backupApp),
			shellQuote(targetApp),
			shellQuote(backupApp), shellQuote(backupApp), shellQuote(targetApp),
		)
		scriptPath := filepath.Join(tmpDir, "apply-update.sh")
		if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
			_ = os.RemoveAll(stagedApp)
			return fail(err)
		}
		// Detach DMG before spawning helper and quitting.
		_ = exec.Command("/usr/bin/hdiutil", "detach", mountDir, "-quiet").Run()
		_ = os.Remove(dmgPath)
		cleanupTmp = false

		cmd := exec.Command("/bin/sh", "-c", fmt.Sprintf("%s; /bin/rm -rf %s", shellQuote(scriptPath), shellQuote(tmpDir)))
		detachCmd(cmd)
		if err := cmd.Start(); err != nil {
			return fail(err)
		}
	} else {
		// Running as a standalone binary (e.g. during local dev): replace binary in place and relaunch.
		srcBin := filepath.Join(srcApp, "Contents", "MacOS", "HelpingHand")
		stagedBin := execPath + ".new"
		in, err := os.Open(srcBin)
		if err != nil {
			return fail(fmt.Errorf("could not read binary from update bundle: %w", err))
		}
		outFile, err := os.OpenFile(stagedBin, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			_ = in.Close()
			return fail(fmt.Errorf("cannot write updated binary: %w", err))
		}
		if _, err := io.Copy(outFile, in); err != nil {
			_ = in.Close()
			_ = outFile.Close()
			_ = os.Remove(stagedBin)
			return fail(err)
		}
		_ = in.Close()
		_ = outFile.Close()

		script := fmt.Sprintf(`#!/bin/sh
PID=%d
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 100 ]; do
  sleep 0.2
  i=$((i + 1))
done
/bin/mv -f %s %s && nohup %s >/dev/null 2>&1 </dev/null &
`, pid, shellQuote(stagedBin), shellQuote(execPath), shellQuote(execPath))
		scriptPath := filepath.Join(tmpDir, "apply-update.sh")
		if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
			_ = os.Remove(stagedBin)
			return fail(err)
		}
		_ = exec.Command("/usr/bin/hdiutil", "detach", mountDir, "-quiet").Run()
		_ = os.Remove(dmgPath)
		cleanupTmp = false

		cmd := exec.Command("/bin/sh", "-c", fmt.Sprintf("%s; /bin/rm -rf %s", shellQuote(scriptPath), shellQuote(tmpDir)))
		detachCmd(cmd)
		if err := cmd.Start(); err != nil {
			return fail(err)
		}
	}

	a.mu.Lock()
	a.quitting = true
	st = a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(st)

	if ctx != nil {
		go func() {
			time.Sleep(150 * time.Millisecond)
			wailsruntime.Quit(ctx)
		}()
	}
	return st, nil
}
