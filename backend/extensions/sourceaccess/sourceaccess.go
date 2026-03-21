package sourceaccess

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

type SourceAccessProfile struct {
	SourceID               string
	BaseURL                string
	WarmupURL              string
	DefaultReferer         string
	CookieDomains          []string
	ChallengeStatusCodes   []int
	ChallengeBodyMarkers   []string
	ChallengeHeaderMarkers map[string]string
	SessionTTL             time.Duration
}

type RequestOptions struct {
	Method  string
	Body    []byte
	Referer string
	Headers map[string]string
}

type sessionCache struct {
	cookies []*http.Cookie
	expires time.Time
	running bool
	waitCh  chan struct{}
}

type responseData struct {
	status      int
	contentType string
	body        []byte
	headers     http.Header
}

var (
	profilesMu sync.RWMutex
	profiles   = map[string]SourceAccessProfile{}

	sessionMu sync.Mutex
	sessions  = map[string]*sessionCache{}

	httpClient = &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			MaxIdleConns:        64,
			MaxIdleConnsPerHost: 16,
			IdleConnTimeout:     90 * time.Second,
		},
	}
)

func RegisterProfile(profile SourceAccessProfile) {
	if profile.SourceID == "" || profile.BaseURL == "" {
		return
	}
	if profile.WarmupURL == "" {
		profile.WarmupURL = profile.BaseURL
	}
	if profile.DefaultReferer == "" {
		profile.DefaultReferer = profile.BaseURL
	}
	if len(profile.ChallengeStatusCodes) == 0 {
		profile.ChallengeStatusCodes = []int{403}
	}
	if len(profile.ChallengeBodyMarkers) == 0 {
		profile.ChallengeBodyMarkers = []string{
			"just a moment",
			"cf-mitigated",
			"ddos-guard",
			"enable javascript and cookies to continue",
		}
	}
	if profile.ChallengeHeaderMarkers == nil {
		profile.ChallengeHeaderMarkers = map[string]string{
			"Cf-Mitigated": "challenge",
		}
	}
	if profile.SessionTTL <= 0 {
		profile.SessionTTL = 90 * time.Minute
	}

	profilesMu.Lock()
	profiles[profile.SourceID] = profile
	profilesMu.Unlock()
}

func GetProfile(sourceID string) (SourceAccessProfile, bool) {
	profilesMu.RLock()
	profile, ok := profiles[sourceID]
	profilesMu.RUnlock()
	return profile, ok
}

func EnsureSession(sourceID string) error {
	profile, ok := GetProfile(sourceID)
	if !ok {
		return fmt.Errorf("source access profile not found: %s", sourceID)
	}
	_, err := ensureSession(profile)
	return err
}

func BuildImageProxyURL(sourceID, rawURL, referer string) string {
	params := url.Values{}
	params.Set("url", rawURL)
	if sourceID != "" {
		params.Set("source", sourceID)
	}
	if referer != "" {
		params.Set("referer", referer)
	}
	return "http://localhost:43212/proxy/image?" + params.Encode()
}

func FetchHTML(sourceID, rawURL string, opts RequestOptions) (string, error) {
	body, _, err := FetchBytes(sourceID, rawURL, opts)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func FetchJSON(sourceID, rawURL string, opts RequestOptions) ([]byte, error) {
	if opts.Headers == nil {
		opts.Headers = map[string]string{}
	}
	if _, ok := opts.Headers["Accept"]; !ok {
		opts.Headers["Accept"] = "application/json, text/plain, */*"
	}
	body, _, err := FetchBytes(sourceID, rawURL, opts)
	return body, err
}

func FetchBytes(sourceID, rawURL string, opts RequestOptions) ([]byte, string, error) {
	profile, ok := GetProfile(sourceID)
	if !ok {
		return nil, "", fmt.Errorf("source access profile not found: %s", sourceID)
	}
	resp, err := doRequest(profile, rawURL, opts, true)
	if err != nil {
		return nil, "", err
	}
	if resp.status >= 400 {
		return nil, resp.contentType, fmt.Errorf("%s request failed: HTTP %d", sourceID, resp.status)
	}
	return resp.body, resp.contentType, nil
}

func doRequest(profile SourceAccessProfile, rawURL string, opts RequestOptions, allowSolve bool) (*responseData, error) {
	data, err := performRequest(profile, rawURL, opts)
	if err != nil {
		return nil, err
	}

	// Some providers briefly rate-limit normal clients before a browser-backed
	// session or after short bursts. Respect Retry-After and retry once with the
	// same plain HTTP path before escalating to a browser solve.
	if allowSolve && data.status == http.StatusTooManyRequests {
		wait := retryAfterDelay(data.headers.Get("Retry-After"))
		if wait <= 0 {
			wait = 1200 * time.Millisecond
		}
		time.Sleep(wait)

		retryData, retryErr := performRequest(profile, rawURL, opts)
		if retryErr == nil {
			data = retryData
		}
	}

	if allowSolve && looksBlocked(profile, data.status, data.headers, data.body) {
		if _, err := ensureSession(profile); err != nil {
			return nil, fmt.Errorf("%s session solve failed: %w", profile.SourceID, err)
		}
		return doRequest(profile, rawURL, opts, false)
	}

	return data, nil
}

func performRequest(profile SourceAccessProfile, rawURL string, opts RequestOptions) (*responseData, error) {
	method := strings.TrimSpace(opts.Method)
	if method == "" {
		method = http.MethodGet
	}

	var bodyReader io.Reader
	if len(opts.Body) > 0 {
		bodyReader = bytes.NewReader(opts.Body)
	}

	req, err := http.NewRequest(method, rawURL, bodyReader)
	if err != nil {
		return nil, err
	}

	referer := opts.Referer
	if referer == "" {
		referer = profile.DefaultReferer
	}

	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Referer", referer)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,es;q=0.8")
	for k, v := range opts.Headers {
		req.Header.Set(k, v)
	}

	if session := validSession(profile.SourceID); session != nil {
		for _, cookie := range session {
			req.AddCookie(cookie)
		}
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	data := &responseData{
		status:      resp.StatusCode,
		contentType: resp.Header.Get("Content-Type"),
		body:        body,
		headers:     resp.Header.Clone(),
	}
	return data, nil
}

func retryAfterDelay(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if seconds, err := time.ParseDuration(raw + "s"); err == nil && seconds > 0 {
		if seconds > 10*time.Second {
			return 10 * time.Second
		}
		return seconds
	}
	if until, err := http.ParseTime(raw); err == nil {
		wait := time.Until(until)
		if wait < 0 {
			return 0
		}
		if wait > 10*time.Second {
			return 10 * time.Second
		}
		return wait
	}
	return 0
}

func looksBlocked(profile SourceAccessProfile, status int, headers http.Header, body []byte) bool {
	for _, candidate := range profile.ChallengeStatusCodes {
		if status == candidate {
			return true
		}
	}
	for key, needle := range profile.ChallengeHeaderMarkers {
		if value := headers.Get(key); value != "" && strings.Contains(strings.ToLower(value), strings.ToLower(needle)) {
			return true
		}
	}
	lowerBody := strings.ToLower(string(body))
	for _, marker := range profile.ChallengeBodyMarkers {
		if marker != "" && strings.Contains(lowerBody, strings.ToLower(marker)) {
			return true
		}
	}
	return false
}

func validSession(sourceID string) []*http.Cookie {
	sessionMu.Lock()
	defer sessionMu.Unlock()

	cached := sessions[sourceID]
	if cached == nil || len(cached.cookies) == 0 || time.Now().After(cached.expires) {
		return nil
	}

	out := make([]*http.Cookie, 0, len(cached.cookies))
	for _, cookie := range cached.cookies {
		clone := *cookie
		out = append(out, &clone)
	}
	return out
}

func ensureSession(profile SourceAccessProfile) ([]*http.Cookie, error) {
	sessionMu.Lock()
	cached := sessions[profile.SourceID]
	if cached != nil && len(cached.cookies) > 0 && time.Now().Before(cached.expires) {
		cookies := cloneCookies(cached.cookies)
		sessionMu.Unlock()
		return cookies, nil
	}
	if cached != nil && cached.running {
		waitCh := cached.waitCh
		sessionMu.Unlock()
		<-waitCh
		return validSession(profile.SourceID), nil
	}

	waitCh := make(chan struct{})
	sessions[profile.SourceID] = &sessionCache{running: true, waitCh: waitCh}
	sessionMu.Unlock()

	cookies, err := solveBrowserSession(profile)

	sessionMu.Lock()
	defer sessionMu.Unlock()
	cache := sessions[profile.SourceID]
	cache.running = false
	close(cache.waitCh)

	if err != nil {
		cache.cookies = nil
		cache.expires = time.Time{}
		return nil, err
	}

	cache.cookies = cloneCookies(cookies)
	cache.expires = time.Now().Add(profile.SessionTTL)
	return cloneCookies(cookies), nil
}

func solveBrowserSession(profile SourceAccessProfile) ([]*http.Cookie, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("no Chrome/Edge browser found")
	}

	l := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check")

	controlURL, err := l.Launch()
	if err != nil {
		return nil, fmt.Errorf("browser launch failed: %w", err)
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("browser connect failed: %w", err)
	}
	defer browser.Close()

	page, err := browser.Page(proto.TargetCreateTarget{URL: profile.WarmupURL})
	if err != nil {
		return nil, fmt.Errorf("page open failed: %w", err)
	}

	_ = page.WaitStable(1500 * time.Millisecond)

	deadline := time.Now().Add(14 * time.Second)
	for time.Now().Before(deadline) {
		cookies, cookieErr := page.Cookies(cookieURLs(profile))
		if cookieErr == nil {
			httpCookies := filterCookies(convertCookies(cookies), profile.CookieDomains)
			if len(httpCookies) > 0 {
				info, _ := page.Info()
				title := ""
				if info != nil {
					title = strings.ToLower(info.Title)
				}
				if !strings.Contains(title, "just a moment") && !strings.Contains(title, "ddos") {
					return httpCookies, nil
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}

	cookies, err := page.Cookies(cookieURLs(profile))
	if err != nil {
		return nil, fmt.Errorf("cookie extraction failed: %w", err)
	}
	httpCookies := filterCookies(convertCookies(cookies), profile.CookieDomains)
	if len(httpCookies) == 0 {
		return nil, fmt.Errorf("no session cookies obtained")
	}
	return httpCookies, nil
}

func cookieURLs(profile SourceAccessProfile) []string {
	seen := map[string]bool{}
	var urls []string
	for _, raw := range []string{profile.BaseURL, profile.WarmupURL} {
		if raw == "" || seen[raw] {
			continue
		}
		seen[raw] = true
		urls = append(urls, raw)
	}
	for _, domain := range profile.CookieDomains {
		domain = strings.TrimSpace(strings.TrimPrefix(domain, "."))
		if domain == "" {
			continue
		}
		for _, raw := range []string{"https://" + domain + "/", "http://" + domain + "/"} {
			if seen[raw] {
				continue
			}
			seen[raw] = true
			urls = append(urls, raw)
		}
	}
	return urls
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

func filterCookies(cookies []*http.Cookie, domains []string) []*http.Cookie {
	if len(domains) == 0 {
		return cloneCookies(cookies)
	}
	var out []*http.Cookie
	for _, cookie := range cookies {
		for _, domain := range domains {
			domain = strings.TrimSpace(strings.TrimPrefix(domain, "."))
			if domain == "" {
				continue
			}
			cookieDomain := strings.TrimPrefix(strings.TrimSpace(cookie.Domain), ".")
			if cookieDomain == domain || strings.HasSuffix(cookieDomain, "."+domain) {
				out = append(out, &http.Cookie{
					Name:   cookie.Name,
					Value:  cookie.Value,
					Domain: cookie.Domain,
					Path:   cookie.Path,
				})
				break
			}
		}
	}
	return out
}

func cloneCookies(cookies []*http.Cookie) []*http.Cookie {
	out := make([]*http.Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		clone := *cookie
		out = append(out, &clone)
	}
	return out
}

func IsBlocked(sourceID string, status int, headers http.Header, body []byte) bool {
	profile, ok := GetProfile(sourceID)
	if !ok {
		return false
	}
	return looksBlocked(profile, status, headers, body)
}

func FetchExternalImage(rawURL, referer string) ([]byte, string, int, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", 0, err
	}
	req.Header.Set("User-Agent", browserUA)
	if referer != "" {
		req.Header.Set("Referer", referer)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, "", 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", 0, err
	}

	return body, resp.Header.Get("Content-Type"), resp.StatusCode, nil
}

func ContentTypeOrJPEG(contentType string, body []byte) string {
	if strings.HasPrefix(strings.ToLower(contentType), "image/") {
		return contentType
	}
	return http.DetectContentType(bytes.TrimSpace(body))
}
