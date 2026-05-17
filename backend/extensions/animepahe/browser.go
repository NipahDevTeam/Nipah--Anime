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
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
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

type animePaheCookieCacheEntry struct {
	cookies   []*http.Cookie
	expiresAt time.Time
}

type animePaheCookieSolveState struct {
	done    chan struct{}
	cookies []*http.Cookie
	err     error
}

type animePahePersistedCookie struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Domain string `json:"domain,omitempty"`
	Path   string `json:"path,omitempty"`
}

type animePahePersistedCookieEntry struct {
	Base      string                     `json:"base"`
	ExpiresAt time.Time                  `json:"expires_at"`
	Cookies   []animePahePersistedCookie `json:"cookies"`
}

type animePahePersistedCookieFile struct {
	Entries map[string]animePahePersistedCookieEntry `json:"entries"`
}

var (
	cachedMu            sync.Mutex
	cachedCookiesByBase = map[string]animePaheCookieCacheEntry{}
	inflightSolveByBase = map[string]*animePaheCookieSolveState{}
	cookieTTL           = 2 * time.Hour

	getAnimePaheValidCookies = getValidCookies
	solveAnimePaheDDoSGuard  = solveDDoSGuard
	animePaheCookieCachePath = defaultAnimePaheCookieCachePath
)

// getValidCookies returns cached DDoS-Guard cookies, refreshing if expired.
func getValidCookies(targetBase string) ([]*http.Cookie, error) {
	return getValidCookiesWithContext(context.Background(), targetBase)
}

func getValidCookiesWithContext(ctx context.Context, targetBase string) ([]*http.Cookie, error) {
	targetBase = animePaheOrigin(targetBase)

	cachedMu.Lock()
	if entry, ok := cachedCookiesByBase[targetBase]; ok && time.Now().Before(entry.expiresAt) && animePaheHasUsableCookies(entry.cookies) {
		cookies := cloneAnimePaheCookies(entry.cookies)
		cachedMu.Unlock()
		return cookies, nil
	}
	if cookies, expiresAt, ok := loadPersistedAnimePaheCookies(targetBase); ok {
		cachedCookiesByBase[targetBase] = animePaheCookieCacheEntry{
			cookies:   cloneAnimePaheCookies(cookies),
			expiresAt: expiresAt,
		}
		cachedMu.Unlock()
		return cloneAnimePaheCookies(cookies), nil
	}

	if inflight, ok := inflightSolveByBase[targetBase]; ok {
		cachedMu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-inflight.done:
			if inflight.err != nil {
				return nil, inflight.err
			}
			return cloneAnimePaheCookies(inflight.cookies), nil
		}
	}

	inflight := &animePaheCookieSolveState{done: make(chan struct{})}
	inflightSolveByBase[targetBase] = inflight
	cachedMu.Unlock()

	cookies, err := solveAnimePaheDDoSGuard(ctx, targetBase)
	if err == nil && !animePaheHasUsableCookies(cookies) {
		err = fmt.Errorf("animepahe: DDoS-Guard challenge solved but no usable cookies obtained")
	}

	storedCookies := cloneAnimePaheCookies(cookies)

	cachedMu.Lock()
	delete(inflightSolveByBase, targetBase)
	if err == nil {
		cachedCookiesByBase[targetBase] = animePaheCookieCacheEntry{
			cookies:   cloneAnimePaheCookies(storedCookies),
			expiresAt: time.Now().Add(cookieTTL),
		}
		if persistErr := persistAnimePaheCookies(targetBase, storedCookies, time.Now().Add(cookieTTL)); persistErr != nil {
			browserLog.Debug().Err(persistErr).Str("base", targetBase).Msg("Persisting AnimePahe cookies failed")
		}
		browserLog.Info().Str("base", targetBase).Int("cookies", len(storedCookies)).Dur("ttl", cookieTTL).Msg("DDoS-Guard solved")
	} else {
		delete(cachedCookiesByBase, targetBase)
		_ = clearPersistedAnimePaheCookies(targetBase)
	}
	inflight.cookies = storedCookies
	inflight.err = err
	close(inflight.done)
	cachedMu.Unlock()

	if err != nil {
		return nil, err
	}
	return cloneAnimePaheCookies(storedCookies), nil
}

// invalidateCookies clears the cached cookies so the next request triggers a refresh.
func invalidateCookies(targetBases ...string) {
	cachedMu.Lock()
	defer cachedMu.Unlock()

	if len(targetBases) == 0 {
		cachedCookiesByBase = map[string]animePaheCookieCacheEntry{}
		_ = clearPersistedAnimePaheCookies()
		return
	}

	for _, base := range targetBases {
		normalizedBase := animePaheOrigin(base)
		delete(cachedCookiesByBase, normalizedBase)
		_ = clearPersistedAnimePaheCookies(normalizedBase)
	}
}

func animePaheHasUsableCookies(cookies []*http.Cookie) bool {
	for _, cookie := range cookies {
		name := strings.ToLower(strings.TrimSpace(cookie.Name))
		if strings.HasPrefix(name, "__ddg") || strings.Contains(name, "ddg") {
			return true
		}
	}
	return false
}

func animePaheBrowserReady(cookies []*http.Cookie, title string) bool {
	if !animePaheHasUsableCookies(cookies) {
		return false
	}
	value := strings.ToLower(strings.TrimSpace(title))
	return !strings.Contains(value, "ddos") &&
		!strings.Contains(value, "checking your browser") &&
		!strings.Contains(value, "access denied")
}

func cloneAnimePaheCookies(cookies []*http.Cookie) []*http.Cookie {
	if len(cookies) == 0 {
		return nil
	}
	cloned := make([]*http.Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		if cookie == nil {
			continue
		}
		copyCookie := *cookie
		cloned = append(cloned, &copyCookie)
	}
	return cloned
}

// solveDDoSGuard launches a headless browser to solve the DDoS-Guard challenge.
// Uses the system's Edge or Chrome — no extra browser download needed.
func solveDDoSGuard(ctx context.Context, targetBase string) ([]*http.Cookie, error) {
	targetBase = animePaheOrigin(targetBase)

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	// Find a Chromium-based browser on the system
	browserPath, found := launcher.LookPath()
	if !found {
		if runtime.GOOS == "linux" {
			return nil, fmt.Errorf("animepahe: no Chromium-based browser found for DDoS-Guard bypass; install Chromium or Chrome to use AnimePahe on Linux")
		}
		return nil, fmt.Errorf("animepahe: no Chrome/Edge browser found for DDoS-Guard bypass")
	}
	browserLog.Info().Str("browser", browserPath).Str("base", targetBase).Msg("Solving DDoS-Guard")

	// Launch headless browser — explicitly set Bin to avoid rod downloading Chromium
	l := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("disable-breakpad").
		Set("disable-crash-reporter").
		Set("noerrdialogs").
		Set("autoplay-policy", "no-user-gesture-required").
		Set("disable-blink-features", "AutomationControlled").
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
	page, err := browser.Page(proto.TargetCreateTarget{URL: targetBase})
	if err != nil {
		return nil, fmt.Errorf("animepahe: page open failed: %w", err)
	}
	defer page.Close()

	// Give the page a brief chance to settle, then poll until cookies are ready.
	err = page.WaitStable(500 * time.Millisecond)
	if err != nil {
		browserLog.Warn().Err(err).Msg("WaitStable timeout (may still have cookies)")
	}

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		info, _ := page.Info()
		rodCookies, cookieErr := page.Cookies([]string{targetBase})
		if cookieErr == nil {
			httpCookies := convertCookies(rodCookies)
			if animePaheBrowserReady(httpCookies, pageTitle(info)) {
				return httpCookies, nil
			}
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}

	rodCookies, err := page.Cookies([]string{targetBase})
	if err != nil {
		return nil, fmt.Errorf("animepahe: cookie extraction failed: %w", err)
	}
	httpCookies := convertCookies(rodCookies)
	if !animePaheHasUsableCookies(httpCookies) {
		return nil, fmt.Errorf("animepahe: DDoS-Guard challenge solved but no usable cookies obtained")
	}

	return httpCookies, nil
}

func pageTitle(info *proto.TargetTargetInfo) string {
	if info == nil {
		return ""
	}
	return info.Title
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

func browserFetch(rawURL string, accept string, ajax bool) (string, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		if runtime.GOOS == "linux" {
			return "", fmt.Errorf("animepahe: no Chromium-based browser found for browser-backed fetch")
		}
		return "", fmt.Errorf("animepahe: no Chrome/Edge browser found for browser-backed fetch")
	}

	l := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("disable-breakpad").
		Set("disable-crash-reporter").
		Set("noerrdialogs").
		Set("autoplay-policy", "no-user-gesture-required").
		Set("disable-blink-features", "AutomationControlled").
		Set("no-first-run").
		Set("no-default-browser-check")

	controlURL, err := l.Launch()
	if err != nil {
		return "", fmt.Errorf("animepahe: browser launch failed: %w", err)
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return "", fmt.Errorf("animepahe: browser connect failed: %w", err)
	}
	defer browser.Close()

	base := animePaheOrigin(rawURL)
	page, err := browser.Page(proto.TargetCreateTarget{URL: base})
	if err != nil {
		return "", fmt.Errorf("animepahe: page open failed: %w", err)
	}
	defer page.Close()

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		info, _ := page.Info()
		if info == nil || !strings.Contains(strings.ToLower(info.Title), "ddos") {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if err := page.Navigate(rawURL); err != nil {
		return "", fmt.Errorf("animepahe: browser navigate failed: %w", err)
	}
	_ = page.WaitLoad()
	time.Sleep(1200 * time.Millisecond)

	result, err := page.Eval(`() => JSON.stringify({
		bodyText: (document.body?.innerText || document.documentElement?.innerText || '').trim(),
		preText: (document.querySelector('pre')?.textContent || '').trim(),
		outerHTML: document.documentElement?.outerHTML || '',
	})`)
	if err != nil {
		return "", fmt.Errorf("animepahe: browser content read failed: %w", err)
	}

	var payload struct {
		BodyText  string `json:"bodyText"`
		PreText   string `json:"preText"`
		OuterHTML string `json:"outerHTML"`
	}
	if err := json.Unmarshal([]byte(result.Value.Str()), &payload); err != nil {
		return "", fmt.Errorf("animepahe: browser content parse failed: %w", err)
	}
	body := animePaheSelectBrowserFetchContent(payload.BodyText, payload.PreText, payload.OuterHTML, ajax)
	if body == "" {
		return "", fmt.Errorf("animepahe: browser fetch returned empty response")
	}
	_ = accept
	return body, nil
}

func animePaheSelectBrowserFetchContent(bodyText, preText, outerHTML string, ajax bool) string {
	bodyText = strings.TrimSpace(bodyText)
	preText = strings.TrimSpace(preText)
	outerHTML = strings.TrimSpace(outerHTML)

	if ajax {
		if bodyText != "" {
			return bodyText
		}
		if preText != "" {
			return preText
		}
		return outerHTML
	}

	if outerHTML != "" {
		return outerHTML
	}
	if bodyText != "" {
		return bodyText
	}
	return preText
}

func defaultAnimePaheCookieCachePath() string {
	if configDir, err := os.UserConfigDir(); err == nil && strings.TrimSpace(configDir) != "" {
		return filepath.Join(configDir, "Nipah", "animepahe-cookies.json")
	}
	return filepath.Join(os.TempDir(), "animepahe-cookies.json")
}

func persistAnimePaheCookies(targetBase string, cookies []*http.Cookie, expiresAt time.Time) error {
	targetBase = animePaheOrigin(targetBase)
	path := animePaheCookieCachePath()
	if strings.TrimSpace(path) == "" {
		return nil
	}

	store, err := readAnimePahePersistedCookieFile(path)
	if err != nil {
		return err
	}
	if store.Entries == nil {
		store.Entries = map[string]animePahePersistedCookieEntry{}
	}

	persisted := make([]animePahePersistedCookie, 0, len(cookies))
	for _, cookie := range cookies {
		if cookie == nil {
			continue
		}
		persisted = append(persisted, animePahePersistedCookie{
			Name:   cookie.Name,
			Value:  cookie.Value,
			Domain: cookie.Domain,
			Path:   cookie.Path,
		})
	}

	store.Entries[targetBase] = animePahePersistedCookieEntry{
		Base:      targetBase,
		ExpiresAt: expiresAt,
		Cookies:   persisted,
	}
	return writeAnimePahePersistedCookieFile(path, store)
}

func loadPersistedAnimePaheCookies(targetBase string) ([]*http.Cookie, time.Time, bool) {
	targetBase = animePaheOrigin(targetBase)
	path := animePaheCookieCachePath()
	if strings.TrimSpace(path) == "" {
		return nil, time.Time{}, false
	}

	store, err := readAnimePahePersistedCookieFile(path)
	if err != nil || store.Entries == nil {
		return nil, time.Time{}, false
	}

	entry, ok := store.Entries[targetBase]
	if !ok || time.Now().After(entry.ExpiresAt) {
		return nil, time.Time{}, false
	}

	cookies := make([]*http.Cookie, 0, len(entry.Cookies))
	for _, cookie := range entry.Cookies {
		cookies = append(cookies, &http.Cookie{
			Name:   cookie.Name,
			Value:  cookie.Value,
			Domain: cookie.Domain,
			Path:   cookie.Path,
		})
	}
	if !animePaheHasUsableCookies(cookies) {
		return nil, time.Time{}, false
	}
	return cookies, entry.ExpiresAt, true
}

func clearPersistedAnimePaheCookies(targetBases ...string) error {
	path := animePaheCookieCachePath()
	if strings.TrimSpace(path) == "" {
		return nil
	}

	if len(targetBases) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}

	store, err := readAnimePahePersistedCookieFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if store.Entries == nil {
		return nil
	}
	for _, base := range targetBases {
		delete(store.Entries, animePaheOrigin(base))
	}
	if len(store.Entries) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return writeAnimePahePersistedCookieFile(path, store)
}

func readAnimePahePersistedCookieFile(path string) (animePahePersistedCookieFile, error) {
	var store animePahePersistedCookieFile
	body, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return animePahePersistedCookieFile{Entries: map[string]animePahePersistedCookieEntry{}}, nil
		}
		return animePahePersistedCookieFile{}, err
	}
	if len(body) == 0 {
		return animePahePersistedCookieFile{Entries: map[string]animePahePersistedCookieEntry{}}, nil
	}
	if err := json.Unmarshal(body, &store); err != nil {
		return animePahePersistedCookieFile{}, err
	}
	if store.Entries == nil {
		store.Entries = map[string]animePahePersistedCookieEntry{}
	}
	return store, nil
}

func writeAnimePahePersistedCookieFile(path string, store animePahePersistedCookieFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	body, err := json.Marshal(store)
	if err != nil {
		return err
	}
	return os.WriteFile(path, body, 0600)
}
