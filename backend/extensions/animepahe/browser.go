package animepahe

// browser.go — solves DDoS-Guard JS challenges using the system's Edge/Chrome
// browser via the Chrome DevTools Protocol (rod library).
//
// Flow:
//  1. First AnimePahe request gets blocked by DDoS-Guard (403 + JS challenge)
//  2. We launch headless Edge (already installed — Wails requires WebView2)
//  3. Edge solves the JS challenge automatically
//  4. We extract the DDoS-Guard session cookies
//  5. Cache them (~2 hours TTL) for all subsequent Go HTTP requests
//  6. If a request gets 403 again, refresh cookies automatically

import (
	"fmt"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"

	"miruro/backend/logger"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

var browserLog = logger.For("AnimePahe")

var (
	cachedCookies []*http.Cookie
	cachedMu      sync.Mutex
	cachedExpiry  time.Time
	cookieTTL     = 2 * time.Hour
)

// getValidCookies returns cached DDoS-Guard cookies, refreshing if expired.
func getValidCookies() ([]*http.Cookie, error) {
	cachedMu.Lock()
	defer cachedMu.Unlock()

	if len(cachedCookies) > 0 && time.Now().Before(cachedExpiry) {
		return cachedCookies, nil
	}

	cookies, err := solveDDoSGuard()
	if err != nil {
		return nil, err
	}

	cachedCookies = cookies
	cachedExpiry = time.Now().Add(cookieTTL)
	browserLog.Info().Int("cookies", len(cookies)).Dur("ttl", cookieTTL).Msg("DDoS-Guard solved")
	return cookies, nil
}

// invalidateCookies clears the cached cookies so the next request triggers a refresh.
func invalidateCookies() {
	cachedMu.Lock()
	cachedCookies = nil
	cachedMu.Unlock()
}

// solveDDoSGuard launches a headless browser to solve the DDoS-Guard challenge.
// Uses the system's Edge or Chrome — no extra browser download needed.
func solveDDoSGuard() ([]*http.Cookie, error) {
	// Find a Chromium-based browser on the system
	browserPath, found := launcher.LookPath()
	if !found {
		if runtime.GOOS == "linux" {
			return nil, fmt.Errorf("animepahe: no Chromium-based browser found for DDoS-Guard bypass; install Chromium or Chrome to use AnimePahe on Linux")
		}
		return nil, fmt.Errorf("animepahe: no Chrome/Edge browser found for DDoS-Guard bypass")
	}
	browserLog.Info().Str("browser", browserPath).Msg("Solving DDoS-Guard")

	// Launch headless browser — explicitly set Bin to avoid rod downloading Chromium
	l := launcher.New().
		Bin(browserPath).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check")

	controlURL, err := l.Launch()
	if err != nil {
		return nil, fmt.Errorf("animepahe: browser launch failed: %w", err)
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("animepahe: browser connect failed: %w", err)
	}
	defer browser.Close()

	// Navigate to AnimePahe — DDoS-Guard will challenge then redirect
	page, err := browser.Page(proto.TargetCreateTarget{URL: baseURL})
	if err != nil {
		return nil, fmt.Errorf("animepahe: page open failed: %w", err)
	}

	// Give the page a brief chance to settle, then poll until cookies are ready.
	err = page.WaitStable(500 * time.Millisecond)
	if err != nil {
		browserLog.Warn().Err(err).Msg("WaitStable timeout (may still have cookies)")
	}

	deadline := time.Now().Add(12 * time.Second)
	for {
		info, _ := page.Info()
		rodCookies, cookieErr := page.Cookies([]string{baseURL})
		if cookieErr == nil {
			httpCookies := convertCookies(rodCookies)
			// Exit early as soon as we have cookies and we're no longer visibly on the challenge page.
			if len(httpCookies) > 0 && (info == nil || !strings.Contains(strings.ToLower(info.Title), "ddos")) {
				return httpCookies, nil
			}
		}

		if time.Now().After(deadline) {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	rodCookies, err := page.Cookies([]string{baseURL})
	if err != nil {
		return nil, fmt.Errorf("animepahe: cookie extraction failed: %w", err)
	}
	httpCookies := convertCookies(rodCookies)
	if len(httpCookies) == 0 {
		return nil, fmt.Errorf("animepahe: DDoS-Guard challenge solved but no cookies obtained")
	}

	return httpCookies, nil
}

func convertCookies(rodCookies []*proto.NetworkCookie) []*http.Cookie {
	httpCookies := make([]*http.Cookie, 0, len(rodCookies))
	for _, c := range rodCookies {
		httpCookies = append(httpCookies, &http.Cookie{
			Name:   c.Name,
			Value:  c.Value,
			Domain: c.Domain,
			Path:   c.Path,
		})
	}
	return httpCookies
}
