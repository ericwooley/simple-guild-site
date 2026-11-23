package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type desktopConfig struct {
	SiteURL             string `json:"siteUrl,omitempty"`
	SessionCookie       string `json:"sessionCookie,omitempty"`
	SavedVariablesPath  string `json:"savedVariablesPath"`
	AutoSyncOnStart     *bool  `json:"autoSyncOnStart,omitempty"`
	PollIntervalSeconds int    `json:"pollIntervalSeconds,omitempty"`
}

type BridgeStatus struct {
	Available           bool   `json:"available"`
	Authorized          bool   `json:"authorized"`
	AppVersion          string `json:"appVersion"`
	SiteURL             string `json:"siteUrl"`
	SavedVariablesPath  string `json:"savedVariablesPath"`
	AutoSyncOnStart     bool   `json:"autoSyncOnStart"`
	LaunchAtLogin       bool   `json:"launchAtLogin"`
	PollIntervalSeconds int    `json:"pollIntervalSeconds"`
	Watching            bool   `json:"watching"`
	OpenSettings        bool   `json:"openSettings"`
	LastSyncedAt        string `json:"lastSyncedAt"`
	LastSummary         string `json:"lastSummary"`
	LastError           string `json:"lastError"`
	PairingCode         string `json:"pairingCode,omitempty"`
	UpdateAvailable     bool   `json:"updateAvailable"`
	LatestVersion       string `json:"latestVersion,omitempty"`
	ReleaseURL          string `json:"releaseUrl,omitempty"`
	UpdateChecking      bool   `json:"updateChecking"`
	UpdateInstalling    bool   `json:"updateInstalling"`
	UpdateError         string `json:"updateError,omitempty"`
	UpdateCheckedAt     string `json:"updateCheckedAt,omitempty"`
}

type App struct {
	ctx                 context.Context
	mu                  sync.Mutex
	siteURL             string
	proxy               *httputil.ReverseProxy
	sessionVal          string
	pairingCode         string
	filePath            string
	autoSyncOnStart     bool
	launchAtLogin       bool
	pollIntervalSeconds int
	domReady            bool
	watching            bool
	openSettings        bool
	quitting            bool
	stopWatch           chan struct{}
	stopUpdate          chan struct{}
	lastDigest          string
	lastSyncAt          string
	lastMsg             string
	lastErr             string
	update              UpdateState
}

func NewApp(envSiteURL string) *App {
	app := &App{
		autoSyncOnStart:     true,
		launchAtLogin:       isLaunchAtLoginEnabled(),
		pollIntervalSeconds: 5,
	}
	app.loadConfig()
	if envSiteURL != "" {
		if envSiteURL != app.siteURL {
			app.sessionVal = ""
		}
		app.siteURL = envSiteURL
	}
	app.rebuildProxyLocked()
	if app.filePath == "" {
		app.filePath = discoverSavedVariables()
	}
	return app
}

func (a *App) rebuildProxyLocked() {
	if a.siteURL == "" {
		a.proxy = nil
		return
	}
	parsed, err := validateSiteURL(a.siteURL)
	if err != nil {
		a.proxy = nil
		return
	}
	a.proxy = buildReverseProxy(parsed, a)
}

func (a *App) currentProxy() *httputil.ReverseProxy {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.proxy
}

func (a *App) SetSiteURL(rawURL string) (BridgeStatus, error) {
	norm, err := normalizeSiteURL(rawURL)
	if err != nil {
		return a.GetBridgeStatus(), err
	}
	a.mu.Lock()
	changed := a.siteURL != norm
	a.siteURL = norm
	if changed {
		a.sessionVal = ""
		a.lastDigest = ""
		a.lastErr = ""
	}
	a.rebuildProxyLocked()
	a.saveConfigLocked()
	launchEnabled := a.launchAtLogin
	status := a.statusLocked()
	a.mu.Unlock()
	if launchEnabled {
		_ = setLaunchAtLogin(true, norm)
	}
	a.emitStatus(status)
	return status, nil
}

func discoverSavedVariables() string {
	pattern := "/Applications/World of Warcraft/_forever_/WTF/Account/*/SavedVariables/HelpingHand.lua"
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		return ""
	}
	best := matches[0]
	var bestMod time.Time
	for _, m := range matches {
		if info, statErr := os.Stat(m); statErr == nil && info.ModTime().After(bestMod) {
			bestMod = info.ModTime()
			best = m
		}
	}
	return best
}

func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	a.mu.Unlock()
	setupTray(a)
	a.startAutoUpdateLoop()
}

func (a *App) onDomReady(_ context.Context) {
	a.mu.Lock()
	firstReady := !a.domReady
	a.domReady = true
	autoStart := a.autoSyncOnStart
	hasServer := a.siteURL != ""
	a.mu.Unlock()
	if firstReady && autoStart && hasServer {
		a.StartWatching()
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	quitting := a.quitting
	a.mu.Unlock()
	if quitting {
		return false
	}
	runtime.WindowHide(ctx)
	return true
}

func (a *App) shutdown(_ context.Context) {
	a.stopAutoUpdateLoop()
	a.StopWatching()
}

func configFilePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "helping-hand-desktop", "config.json"), nil
}

func (a *App) loadConfig() {
	path, err := configFilePath()
	if err != nil {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var cfg desktopConfig
	if json.Unmarshal(data, &cfg) == nil {
		if trimmed := strings.TrimSpace(cfg.SiteURL); trimmed != "" {
			if norm, normErr := normalizeSiteURL(trimmed); normErr == nil {
				a.siteURL = norm
			}
		}
		a.sessionVal = strings.TrimSpace(cfg.SessionCookie)
		a.filePath = strings.TrimSpace(cfg.SavedVariablesPath)
		if cfg.AutoSyncOnStart != nil {
			a.autoSyncOnStart = *cfg.AutoSyncOnStart
		}
		if cfg.PollIntervalSeconds >= 2 && cfg.PollIntervalSeconds <= 300 {
			a.pollIntervalSeconds = cfg.PollIntervalSeconds
		}
	}
}

func (a *App) saveConfigLocked() {
	path, err := configFilePath()
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	autoStart := a.autoSyncOnStart
	data, err := json.MarshalIndent(desktopConfig{
		SiteURL:             a.siteURL,
		SessionCookie:       a.sessionVal,
		SavedVariablesPath:  a.filePath,
		AutoSyncOnStart:     &autoStart,
		PollIntervalSeconds: a.pollIntervalSeconds,
	}, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0o600)
}

func (a *App) sessionCookie() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessionVal
}

func (a *App) setSessionCookie(value string) {
	a.mu.Lock()
	changed := a.sessionVal != value
	a.sessionVal = value
	if changed {
		a.saveConfigLocked()
	}
	status := a.statusLocked()
	a.mu.Unlock()
	if changed {
		a.emitStatus(status)
	}
}

func (a *App) StartBattleNetLogin(termsAgreed bool) (bool, error) {
	a.mu.Lock()
	ctx := a.ctx
	siteURL := a.siteURL
	a.mu.Unlock()
	if ctx == nil {
		return false, errors.New("desktop runtime is not ready")
	}
	parsedTarget, err := validateSiteURL(siteURL)
	if err != nil {
		return false, err
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return false, err
	}
	desktopVerifier := base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(desktopVerifier))
	desktopChallenge := base64.RawURLEncoding.EncodeToString(sum[:])
	stateHashSum := sha256.Sum256([]byte(desktopChallenge))
	pairingCode := strings.ToUpper(hex.EncodeToString(stateHashSum[:])[:6])
	a.mu.Lock()
	a.pairingCode = pairingCode
	status := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(status)
	defer func() {
		a.mu.Lock()
		a.pairingCode = ""
		st := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(st)
	}()
	authURL := siteURL + "/auth/battlenet?desktop_challenge=" + url.QueryEscape(desktopChallenge)
	if termsAgreed {
		authURL += "&terms=1"
	}
	runtime.BrowserOpenURL(ctx, authURL)

	client := safeHTTPClient(parsedTarget, 10*time.Second)
	payload, _ := json.Marshal(map[string]string{"desktopVerifier": desktopVerifier})
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		time.Sleep(1 * time.Second)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, siteURL+"/auth/desktop-claim", bytes.NewReader(payload))
		if err != nil {
			return false, err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		var result struct {
			Ok      bool   `json:"ok"`
			Pending bool   `json:"pending"`
			Session string `json:"session"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK && result.Ok && !result.Pending && result.Session != "" {
			a.setSessionCookie(result.Session)
			return true, nil
		}
	}
	return false, errors.New("Battle.net sign-in timed out. Try again.")
}

func (a *App) statusLocked() BridgeStatus {
	return BridgeStatus{
		Available:           true,
		Authorized:          a.sessionVal != "",
		AppVersion:          AppVersion,
		SiteURL:             a.siteURL,
		SavedVariablesPath:  a.filePath,
		AutoSyncOnStart:     a.autoSyncOnStart,
		LaunchAtLogin:       a.launchAtLogin,
		PollIntervalSeconds: a.pollIntervalSeconds,
		Watching:            a.watching,
		OpenSettings:        a.openSettings,
		LastSyncedAt:        a.lastSyncAt,
		LastSummary:         a.lastMsg,
		LastError:           a.lastErr,
		PairingCode:         a.pairingCode,
		UpdateAvailable:     a.update.Available,
		LatestVersion:       a.update.LatestVer,
		ReleaseURL:          a.update.ReleaseURL,
		UpdateChecking:      a.update.Checking,
		UpdateInstalling:    a.update.Installing,
		UpdateError:         a.update.LastError,
		UpdateCheckedAt:     a.update.LastChecked,
	}
}

func (a *App) SetLaunchAtLogin(enabled bool) (BridgeStatus, error) {
	a.mu.Lock()
	siteURL := a.siteURL
	a.mu.Unlock()
	if err := setLaunchAtLogin(enabled, siteURL); err != nil {
		return a.GetBridgeStatus(), err
	}
	a.mu.Lock()
	a.launchAtLogin = isLaunchAtLoginEnabled()
	status := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(status)
	return status, nil
}

func (a *App) UpdateSettings(autoSyncOnStart bool, pollIntervalSeconds int, savedVariablesPath string) BridgeStatus {
	if pollIntervalSeconds < 2 {
		pollIntervalSeconds = 2
	} else if pollIntervalSeconds > 300 {
		pollIntervalSeconds = 300
	}
	a.mu.Lock()
	intervalChanged := a.pollIntervalSeconds != pollIntervalSeconds
	wasWatching := a.watching
	a.autoSyncOnStart = autoSyncOnStart
	a.pollIntervalSeconds = pollIntervalSeconds
	if trimmed := strings.TrimSpace(savedVariablesPath); trimmed != "" {
		if trimmed != a.filePath {
			a.filePath = trimmed
			a.lastDigest = ""
		}
	}
	a.saveConfigLocked()
	status := a.statusLocked()
	a.mu.Unlock()
	if autoSyncOnStart && (!wasWatching || intervalChanged) {
		a.StopWatching()
		return a.StartWatching()
	}
	if !autoSyncOnStart && wasWatching {
		return a.StopWatching()
	}
	a.emitStatus(status)
	return status
}

func (a *App) emitStatus(status BridgeStatus) {
	updateTrayWatchState(status.Watching)
	updateTrayUpdateState(status.UpdateAvailable, status.LatestVersion)
	a.mu.Lock()
	ctx := a.ctx
	a.mu.Unlock()
	if ctx != nil {
		runtime.EventsEmit(ctx, "bridge:status", status)
	}
}

func (a *App) GetBridgeStatus() BridgeStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	status := a.statusLocked()
	a.openSettings = false
	return status
}

func (a *App) PickSavedVariablesFile() (BridgeStatus, error) {
	a.mu.Lock()
	ctx := a.ctx
	a.mu.Unlock()
	if ctx == nil {
		return a.GetBridgeStatus(), errors.New("desktop runtime is not ready")
	}
	selected, err := runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "Select HelpingHand.lua SavedVariables file",
		Filters: []runtime.FileFilter{
			{DisplayName: "SavedVariables (HelpingHand.lua)", Pattern: "*.lua"},
		},
	})
	if err != nil {
		return a.GetBridgeStatus(), err
	}
	if selected != "" {
		a.mu.Lock()
		a.filePath = selected
		a.lastErr = ""
		a.lastDigest = ""
		a.saveConfigLocked()
		status := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(status)
		return status, nil
	}
	return a.GetBridgeStatus(), nil
}

func (a *App) SetSavedVariablesPath(path string) BridgeStatus {
	a.mu.Lock()
	a.filePath = strings.TrimSpace(path)
	a.lastErr = ""
	a.lastDigest = ""
	a.saveConfigLocked()
	status := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(status)
	return status
}

func (a *App) syncInternal(onlyIfChanged bool) (BridgeStatus, error) {
	a.mu.Lock()
	filePath := a.filePath
	siteURL := a.siteURL
	sessionVal := a.sessionVal
	prevDigest := a.lastDigest
	a.mu.Unlock()

	if filePath == "" {
		err := errors.New("Select your SavedVariables/HelpingHand.lua file first.")
		a.mu.Lock()
		a.lastErr = err.Error()
		status := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(status)
		return status, err
	}

	token, body, payload, err := ReadOutbox(filePath)
	if err != nil {
		a.mu.Lock()
		a.lastErr = err.Error()
		status := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(status)
		return status, err
	}

	if _, err := validateSiteURL(siteURL); err != nil {
		a.mu.Lock()
		a.lastErr = err.Error()
		status := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(status)
		return status, err
	}

	if sessionVal == "" && token == "" {
		err := errors.New("Sign in with Battle.net in this app before syncing.")
		a.mu.Lock()
		a.lastErr = err.Error()
		status := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(status)
		return status, err
	}

	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	if onlyIfChanged && digest == prevDigest {
		return a.GetBridgeStatus(), nil
	}

	if err := uploadOutbox(siteURL, sessionVal, token, body); err != nil {
		a.mu.Lock()
		a.lastErr = err.Error()
		status := a.statusLocked()
		a.mu.Unlock()
		a.emitStatus(status)
		return status, err
	}

	charCount := 0
	if list, ok := payload["characters"].([]any); ok {
		charCount = len(list)
	}
	bankCount := 0
	if list, ok := payload["banks"].([]any); ok {
		bankCount = len(list)
	}

	a.mu.Lock()
	a.lastDigest = digest
	a.lastSyncAt = time.Now().UTC().Format(time.RFC3339)
	a.lastMsg = fmt.Sprintf("Synced %d characters, %d banks.", charCount, bankCount)
	a.lastErr = ""
	status := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(status)
	return status, nil
}

func (a *App) SyncNow() (BridgeStatus, error) {
	return a.syncInternal(false)
}

func (a *App) StartWatching() BridgeStatus {
	a.mu.Lock()
	if a.watching {
		status := a.statusLocked()
		a.mu.Unlock()
		return status
	}
	stop := make(chan struct{})
	a.stopWatch = stop
	a.watching = true
	a.lastErr = ""
	interval := time.Duration(a.pollIntervalSeconds) * time.Second
	if interval < 2*time.Second {
		interval = 5 * time.Second
	}
	status := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(status)

	go func() {
		_, _ = a.syncInternal(true)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				_, _ = a.syncInternal(true)
			}
		}
	}()
	return status
}

func (a *App) StopWatching() BridgeStatus {
	a.mu.Lock()
	if a.watching && a.stopWatch != nil {
		close(a.stopWatch)
		a.stopWatch = nil
		a.watching = false
	}
	status := a.statusLocked()
	a.mu.Unlock()
	a.emitStatus(status)
	return status
}

func uploadOutbox(baseURL, sessionVal, token string, body []byte) error {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" {
		return errors.New("Invalid website URL.")
	}
	origin := parsed.Scheme + "://" + parsed.Host
	endpoint := origin + "/api/sync"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	if sessionVal != "" {
		req.Header.Set("Cookie", "hh_session="+sessionVal)
		req.Header.Set("Origin", origin)
	} else {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	client := safeHTTPClient(parsed, 20*time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("Cannot reach the website. Check your connection and retry.")
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 16384))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	var errPayload struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(respBody, &errPayload) == nil && strings.TrimSpace(errPayload.Message) != "" {
		return errors.New(strings.TrimSpace(errPayload.Message))
	}
	switch resp.StatusCode {
	case 401:
		return errors.New("Your session expired. Sign in with Battle.net in this app and retry.")
	case 403:
		return errors.New("The website denied this sync. Check your guild membership and verified characters.")
	case 409:
		return errors.New("The website rejected a conflicting snapshot. Capture again.")
	case 413:
		return errors.New("The website rejected the upload size.")
	case 422:
		return errors.New("The website rejected the snapshot. Check identities and addon version.")
	default:
		return fmt.Errorf("The website rejected the sync (HTTP %d).", resp.StatusCode)
	}
}
