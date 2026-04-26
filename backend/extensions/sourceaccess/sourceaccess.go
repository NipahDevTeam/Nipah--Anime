package sourceaccess

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	azuretls "github.com/Noooste/azuretls-client"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"

	"miruro/backend/httpclient"
	"miruro/backend/logger"
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
	log = logger.For("SourceAccess")

	profilesMu sync.RWMutex
	profiles   = map[string]SourceAccessProfile{}

	sessionMu sync.Mutex
	sessions  = map[string]*sessionCache{}

	session = httpclient.NewSession(20)
)

var browserBlockedURLPatterns = []string{
	"*.png*", "*.jpg*", "*.jpeg*", "*.gif*", "*.webp*", "*.svg*", "*.avif*", "*.ico*",
	"*.woff*", "*.woff2*", "*.ttf*", "*.otf*", "*.eot*",
	"*.mp4*", "*.webm*", "*.mp3*", "*.m4a*", "*.ogg*", "*.wav*", "*.avi*", "*.mov*",
	"*googlesyndication.com*", "*doubleclick.net*", "*googletagmanager.com*", "*google-analytics.com*",
	"*googletagservices.com*", "*ads-twitter.com*", "*facebook.net*", "*facebook.com/tr*",
	"*analytics.tiktok.com*", "*clarity.ms*", "*cloudflareinsights.com*", "*hotjar.com*",
	"*newrelic.com*", "*segment.io*", "*intercom.io*", "*disqus.com*", "*amazon-adsystem.com*",
}

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

func ApplyBrowserBlocking(page *rod.Page) error {
	if page == nil {
		return nil
	}
	return page.SetBlockedURLs(browserBlockedURLPatterns)
}

func OpenOptimizedPage(browser *rod.Browser, targetURL string) (*rod.Page, error) {
	page, err := browser.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		return nil, err
	}
	if err := ApplyBrowserBlocking(page); err != nil {
		_ = page.Close()
		return nil, err
	}
	if err := page.Navigate(targetURL); err != nil {
		_ = page.Close()
		return nil, err
	}
	return page, nil
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
	return "http://127.0.0.1:43212/proxy/image?" + params.Encode()
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
		log.Debug().
			Str("source_id", profile.SourceID).
			Int("status", data.status).
			Dur("wait", wait).
			Msg("sourceaccess throttled request retry")
		time.Sleep(wait)

		retryData, retryErr := performRequest(profile, rawURL, opts)
		if retryErr == nil {
			data = retryData
		}
	}

	if allowSolve && looksBlocked(profile, data.status, data.headers, data.body) {
		log.Debug().
			Str("source_id", profile.SourceID).
			Int("status", data.status).
			Str("url", rawURL).
			Msg("sourceaccess blocked request, solving browser session")
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
		method = "GET"
	}

	referer := opts.Referer
	if referer == "" {
		referer = profile.DefaultReferer
	}

	// Build per-request headers (merged on top of session defaults)
	reqHeaders := azuretls.OrderedHeaders{
		{"Referer", referer},
	}
	for k, v := range opts.Headers {
		reqHeaders = append(reqHeaders, []string{k, v})
	}

	// Inject browser-solved cookies if available
	if cookies := validSession(profile.SourceID); cookies != nil {
		var parts []string
		for _, c := range cookies {
			parts = append(parts, c.Name+"="+c.Value)
		}
		reqHeaders = append(reqHeaders, []string{"Cookie", strings.Join(parts, "; ")})
	}

	req := &azuretls.Request{
		Method:         method,
		Url:            rawURL,
		OrderedHeaders: reqHeaders,
	}
	if len(opts.Body) > 0 {
		req.Body = opts.Body
	}

	resp, err := session.Do(req)
	if err != nil {
		return nil, err
	}

	// Convert fhttp.Header to net/http.Header for downstream compatibility
	stdHeaders := make(http.Header)
	for k, v := range resp.Header {
		stdHeaders[k] = v
	}

	data := &responseData{
		status:      resp.StatusCode,
		contentType: stdHeaders.Get("Content-Type"),
		body:        resp.Body,
		headers:     stdHeaders,
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
		log.Debug().Str("source_id", profile.SourceID).Int("cookie_count", len(cookies)).Msg("sourceaccess session cache hit")
		return cookies, nil
	}
	if cached != nil && cached.running {
		waitCh := cached.waitCh
		sessionMu.Unlock()
		log.Debug().Str("source_id", profile.SourceID).Msg("sourceaccess waiting on in-flight session solve")
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
	started := time.Now()
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

	page, err := OpenOptimizedPage(browser, profile.WarmupURL)
	if err != nil {
		return nil, fmt.Errorf("page open failed: %w", err)
	}
	defer page.Close()

	time.Sleep(350 * time.Millisecond)

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
		time.Sleep(250 * time.Millisecond)
	}

	cookies, err := page.Cookies(cookieURLs(profile))
	if err != nil {
		return nil, fmt.Errorf("cookie extraction failed: %w", err)
	}
	httpCookies := filterCookies(convertCookies(cookies), profile.CookieDomains)
	if len(httpCookies) == 0 {
		return nil, fmt.Errorf("no session cookies obtained")
	}
	log.Debug().
		Str("source_id", profile.SourceID).
		Int("cookie_count", len(httpCookies)).
		Dur("took", time.Since(started)).
		Msg("sourceaccess browser session solved")
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
	resp, err := httpclient.Get(session, rawURL, referer)
	if err != nil {
		return nil, "", 0, err
	}
	ct := ""
	if resp.Header != nil {
		ct = resp.Header.Get("Content-Type")
	}
	return resp.Body, ct, resp.StatusCode, nil
}

func ContentTypeOrJPEG(contentType string, body []byte) string {
	if strings.HasPrefix(strings.ToLower(contentType), "image/") {
		return contentType
	}
	return http.DetectContentType(body)
}
