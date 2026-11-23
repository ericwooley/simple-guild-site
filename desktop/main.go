package main

import (
	"bytes"
	"embed"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func serveSetupPage(w http.ResponseWriter, statusCode int, errorMsg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(statusCode)
	f, openErr := assets.Open("frontend/dist/index.html")
	if openErr != nil {
		_, _ = w.Write([]byte("Helping Hand Desktop setup unavailable."))
		return
	}
	defer f.Close()
	body, err := io.ReadAll(f)
	if err != nil {
		_, _ = w.Write([]byte("Unable to load setup page."))
		return
	}
	if !bytes.Contains(body, []byte("/wails/ipc.js")) {
		inject := []byte(`<script src="/wails/ipc.js"></script><script src="/wails/runtime.js"></script>`)
		if idx := bytes.Index(body, []byte("<head>")); idx >= 0 {
			pos := idx + len("<head>")
			body = append(append(append([]byte{}, body[:pos]...), inject...), body[pos:]...)
		} else {
			body = append(inject, body...)
		}
	}
	if errorMsg != "" {
		safeErr := strings.ReplaceAll(strings.ReplaceAll(errorMsg, "<", "&lt;"), ">", "&gt;")
		body = bytes.Replace(body, []byte("<!--SETUP_ERROR-->"), []byte(safeErr), 1)
	}
	_, _ = w.Write(body)
}

func buildReverseProxy(target *url.URL, app *App) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	if isLoopbackHost(target.Hostname()) {
		tr := http.DefaultTransport.(*http.Transport).Clone()
		tr.Proxy = nil
		proxy.Transport = tr
	}
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		req.Header.Del("Accept-Encoding")
		if c, err := req.Cookie("hh_session"); err == nil && c.Value != "" {
			app.setSessionCookie(c.Value)
		} else if sess := app.sessionCookie(); sess != "" {
			req.AddCookie(&http.Cookie{Name: "hh_session", Value: sess})
		}
		if req.Header.Get("Origin") != "" || (req.Method != http.MethodGet && req.Method != http.MethodHead && req.Method != http.MethodOptions) {
			req.Header.Set("Origin", target.Scheme+"://"+target.Host)
		}
		if ref := req.Header.Get("Referer"); ref != "" {
			if parsed, err := url.Parse(ref); err == nil {
				parsed.Scheme = target.Scheme
				parsed.Host = target.Host
				req.Header.Set("Referer", parsed.String())
			}
		}
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		for _, c := range resp.Cookies() {
			if c.Name == "hh_session" {
				if c.MaxAge < 0 || c.Value == "" {
					app.setSessionCookie("")
				} else {
					app.setSessionCookie(c.Value)
				}
			}
		}
		if loc := resp.Header.Get("Location"); loc != "" {
			prefix := target.Scheme + "://" + target.Host
			if strings.HasPrefix(loc, prefix) {
				rel := strings.TrimPrefix(loc, prefix)
				if rel == "" {
					rel = "/"
				}
				resp.Header.Set("Location", rel)
			}
		}
		// Allow Wails runtime to stay attached cleanly without frame-blocking errors inside the webview.
		resp.Header.Del("X-Frame-Options")
		if resp.StatusCode == http.StatusOK && strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
			body, err := io.ReadAll(resp.Body)
			if err == nil {
				_ = resp.Body.Close()
				if !bytes.Contains(body, []byte("/wails/ipc.js")) {
					inject := []byte(`<script src="/wails/ipc.js"></script><script src="/wails/runtime.js"></script>`)
					if idx := bytes.Index(body, []byte("<head>")); idx >= 0 {
						pos := idx + len("<head>")
						body = append(append(append([]byte{}, body[:pos]...), inject...), body[pos:]...)
					} else {
						body = append(inject, body...)
					}
				}
				resp.Body = io.NopCloser(bytes.NewReader(body))
				resp.ContentLength = int64(len(body))
				resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
			}
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		serveSetupPage(w, http.StatusBadGateway, "Unable to reach "+target.String()+". Verify the server URL or check your connection.")
	}
	return proxy
}

func dynamicSiteProxyHandler(app *App) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy := app.currentProxy()
		if proxy == nil {
			serveSetupPage(w, http.StatusOK, "")
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

func isLoopbackHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

func safeHTTPClient(target *url.URL, timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if target != nil && isLoopbackHost(target.Hostname()) {
		transport.Proxy = nil
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func validateSiteURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid HELPING_HAND_URL %q", raw)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && !(scheme == "http" && isLoopbackHost(parsed.Hostname())) {
		return nil, fmt.Errorf("HELPING_HAND_URL must use https for non-loopback hosts: %q", raw)
	}
	return parsed, nil
}

func normalizeSiteURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("enter your guild website URL (for example, https://bandofthehelpinghand.com)")
	}
	if !strings.Contains(trimmed, "://") {
		hostPart := strings.SplitN(trimmed, "/", 2)[0]
		hostOnly := strings.SplitN(hostPart, ":", 2)[0]
		if isLoopbackHost(hostOnly) {
			trimmed = "http://" + trimmed
		} else {
			trimmed = "https://" + trimmed
		}
	}
	parsed, err := validateSiteURL(trimmed)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(parsed.Scheme+"://"+parsed.Host, "/"), nil
}

func resolveEnvSiteURL() string {
	raw := strings.TrimSpace(os.Getenv("HELPING_HAND_URL"))
	if raw == "" {
		return ""
	}
	norm, err := normalizeSiteURL(raw)
	if err != nil {
		log.Fatalf("%v", err)
	}
	return norm
}

func main() {
	envSiteURL := resolveEnvSiteURL()
	app := NewApp(envSiteURL)

	appMenu := menu.NewMenu()
	appMenu.Append(menu.AppMenu())
	appMenu.Append(menu.EditMenu())
	viewMenu := appMenu.AddSubmenu("View")
	viewMenu.AddText("Reload", keys.CmdOrCtrl("r"), func(_ *menu.CallbackData) {
		app.mu.Lock()
		ctx := app.ctx
		app.mu.Unlock()
		if ctx != nil {
			runtime.WindowReload(ctx)
		}
	})

	err := wails.Run(&options.App{
		Title:     "Band of the Helping Hand",
		Width:     1280,
		Height:    840,
		MinWidth:  420,
		MinHeight: 600,
		Menu:      appMenu,
		AssetServer: &assetserver.Options{
			Handler: dynamicSiteProxyHandler(app),
		},
		BackgroundColour: &options.RGBA{R: 21, G: 19, B: 15, A: 255},
		OnStartup:        app.startup,
		OnDomReady:       app.onDomReady,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		Bind: []any{
			app,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
