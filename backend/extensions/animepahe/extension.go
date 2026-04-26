// Package animepahe implements AnimeSource for AnimePahe (animepahe.pw).
// Uses AnimePahe's JSON API for search and episode listing, and resolves
// kwik.si embeds to direct HLS stream URLs.
package animepahe

import (
	"encoding/json"
	"fmt"
	"html"
	neturl "net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"

	azuretls "github.com/Noooste/azuretls-client"

	"miruro/backend/extensions"
	"miruro/backend/httpclient"
	"miruro/backend/logger"
)

var log = logger.For("AnimePahe")

const baseURL = "https://animepahe.pw"

var animePaheMirrorBases = []string{
	"https://animepahe.pw",
	"https://animepahe.si",
	"https://animepahe.com",
	"https://animepahe.org",
}

var httpSession = httpclient.NewSession(15)

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "animepahe-en" }
func (e *Extension) Name() string { return "AnimePahe (English)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — uses AnimePahe's JSON search API
// ─────────────────────────────────────────────────────────────────────────────

type searchResponse struct {
	Data []searchItem `json:"data"`
}

type searchItem struct {
	Session string  `json:"session"`
	Title   string  `json:"title"`
	Poster  string  `json:"poster"`
	Year    int     `json:"year"`
	Score   float64 `json:"score"`
	Type    string  `json:"type"`
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	var lastErr error
	seen := map[string]bool{}
	out := make([]extensions.SearchResult, 0, 24)
	for _, candidate := range animePaheSearchQueries(query) {
		for _, base := range animePaheBaseCandidates() {
			apiURL := fmt.Sprintf("%s/api?m=search&q=%s", base, urlEncode(candidate))
			body, err := fetchAPIWithBrowserFallback(apiURL)
			if err != nil {
				lastErr = err
				continue
			}

			var resp searchResponse
			if err := json.Unmarshal([]byte(body), &resp); err != nil {
				lastErr = fmt.Errorf("animepahe: search parse failed: %w", err)
				continue
			}

			rememberAnimePaheBase(base)
			for _, item := range resp.Data {
				if item.Session == "" || seen[item.Session] {
					continue
				}
				seen[item.Session] = true
				out = append(out, extensions.SearchResult{
					ID:        item.Session,
					Title:     item.Title,
					CoverURL:  item.Poster,
					Year:      item.Year,
					Languages: []extensions.Language{extensions.LangEnglish},
				})
			}
			if len(out) > 0 {
				return out, nil
			}
		}
	}
	if len(out) > 0 {
		return out, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("animepahe: search failed")
	}
	return nil, fmt.Errorf("animepahe: search failed: %w", lastErr)
}

func animePaheSearchQueries(query string) []string {
	trimmed := strings.TrimSpace(html.UnescapeString(query))
	if trimmed == "" {
		return nil
	}
	variants := []string{trimmed}
	sanitized := strings.NewReplacer(":", " ", ";", " ", "/", " ", "-", " ", "_", " ", ".", " ").Replace(trimmed)
	sanitized = strings.Join(strings.Fields(sanitized), " ")
	if sanitized != "" && !strings.EqualFold(sanitized, trimmed) {
		variants = append(variants, sanitized)
	}
	base := regexp.MustCompile(`(?i)\b(?:\d{1,2}(?:st|nd|rd|th)\s+season|season\s+\d{1,2}|part\s+\d{1,2}|cour\s+\d{1,2}|ova|ona|special|movie|film)\b`).ReplaceAllString(trimmed, " ")
	base = strings.Join(strings.Fields(base), " ")
	if base != "" && !strings.EqualFold(base, trimmed) {
		variants = append(variants, base)
	}
	out := make([]string, 0, len(variants))
	seen := map[string]bool{}
	for _, variant := range variants {
		key := strings.ToLower(strings.TrimSpace(variant))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, variant)
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — paginated via AnimePahe's release API
// ─────────────────────────────────────────────────────────────────────────────

type releaseResponse struct {
	Total       int           `json:"total"`
	CurrentPage int           `json:"current_page"`
	LastPage    int           `json:"last_page"`
	Data        []releaseItem `json:"data"`
}

type releaseItem struct {
	Episode  float64 `json:"episode"`
	Session  string  `json:"session"`
	Snapshot string  `json:"snapshot"`
	Duration string  `json:"duration"`
}

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	var all []extensions.Episode

	var lastErr error
	for _, base := range animePaheBaseCandidates() {
		all = all[:0]
		for page := 1; ; page++ {
			apiURL := fmt.Sprintf("%s/api?m=release&id=%s&sort=episode_asc&page=%d", base, animeID, page)
			body, err := fetchAPIWithBrowserFallback(apiURL)
			if err != nil {
				lastErr = err
				if page == 1 {
					break
				}
				break
			}

			var resp releaseResponse
			if err := json.Unmarshal([]byte(body), &resp); err != nil {
				lastErr = err
				break
			}

			for _, item := range resp.Data {
				all = append(all, extensions.Episode{
					ID:        animeID + "/" + item.Session,
					Number:    item.Episode,
					Title:     fmt.Sprintf("Episode %g", item.Episode),
					Thumbnail: item.Snapshot,
				})
			}

			if resp.CurrentPage >= resp.LastPage || len(resp.Data) == 0 {
				break
			}
		}

		if len(all) > 0 {
			rememberAnimePaheBase(base)
			return all, nil
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("animepahe: no episodes found")
	}
	return nil, fmt.Errorf("animepahe: episodes failed: %w", lastErr)
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams — load play page, extract kwik embeds, resolve to m3u8
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	idx := strings.LastIndex(episodeID, "/")
	if idx == -1 {
		return nil, fmt.Errorf("animepahe: invalid episode ID: %s", episodeID)
	}
	animeSession := episodeID[:idx]
	epSession := episodeID[idx+1:]

	var lastErr error
	for _, base := range animePaheBaseCandidates() {
		playURL := fmt.Sprintf("%s/play/%s/%s", base, animeSession, epSession)
		body, err := fetchPageWithBrowserFallback(playURL, base)
		if err != nil {
			lastErr = err
			continue
		}

		kwikEntries := extractKwikURLs(body)
		if len(kwikEntries) == 0 {
			lastErr = fmt.Errorf("animepahe: no embeds found on play page")
			continue
		}

		var sources []extensions.StreamSource
		for _, ke := range kwikEntries {
			m3u8, qual := resolveKwik(ke.url, playURL)
			if m3u8 == "" {
				continue
			}
			if qual == "" {
				qual = ke.quality
			}
			sources = append(sources, extensions.StreamSource{
				URL:      m3u8,
				Quality:  qual,
				Language: extensions.LangEnglish,
				Referer:  streamRefererForAnimePahe(ke.url, m3u8, playURL),
			})
		}

		if len(sources) > 0 {
			rememberAnimePaheBase(base)
			return sources, nil
		}
		lastErr = fmt.Errorf("animepahe: all kwik streams failed to resolve")
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("animepahe: all mirrors failed")
	}
	return nil, lastErr
}

// ─────────────────────────────────────────────────────────────────────────────
// kwik.si resolver
// ─────────────────────────────────────────────────────────────────────────────

type kwikEntry struct {
	url     string
	quality string
}

// cleanQualityLabel extracts the resolution from quality labels like
// "FLE &middot; 1080p" or "SubsPlease · 720p" → "1080p" / "720p"
func cleanQualityLabel(raw string) string {
	raw = html.UnescapeString(raw)
	// Extract NNNp pattern
	re := regexp.MustCompile(`(\d{3,4}p)`)
	if m := re.FindString(raw); m != "" {
		return m
	}
	return strings.TrimSpace(raw)
}

func streamRefererForAnimePahe(embedURL, streamURL, playURL string) string {
	if embedURL != "" {
		return embedURL
	}
	if streamURL != "" {
		if parsed, err := neturl.Parse(streamURL); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			return fmt.Sprintf("%s://%s/", parsed.Scheme, parsed.Host)
		}
	}
	return playURL
}

// extractKwikURLs finds all kwik embed links in the AnimePahe play page.
// Quality buttons use data-src attributes pointing to kwik.* /e/ URLs.
func extractKwikURLs(body string) []kwikEntry {
	var entries []kwikEntry
	seen := map[string]bool{}

	// Primary: data-src="https://kwik.*" attributes (quality dropdown buttons)
	dataSrcRe := regexp.MustCompile(`data-src="(https?://kwik\.[a-z]+/[^"]+)"[^>]*>([^<]*)`)
	for _, m := range dataSrcRe.FindAllStringSubmatch(body, -1) {
		if seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		quality := strings.TrimSpace(m[2])
		// Clean HTML entities from quality string (e.g. "FLE &middot; 1080p" → "1080p")
		quality = cleanQualityLabel(quality)
		entries = append(entries, kwikEntry{url: m[1], quality: quality})
	}

	// Fallback: any kwik.*/e/ URL in the page
	if len(entries) == 0 {
		kwikRe := regexp.MustCompile(`https?://kwik\.[a-z]+/e/\w+`)
		for _, u := range kwikRe.FindAllString(body, -1) {
			if seen[u] {
				continue
			}
			seen[u] = true
			entries = append(entries, kwikEntry{url: u})
		}
	}

	return entries
}

// resolveKwik fetches a kwik embed and extracts the m3u8 stream URL.
// kwik uses eval(function(p,a,c,k,e,d){...}) JS obfuscation to hide the URL.
func resolveKwik(kwikURL, referer string) (m3u8URL, quality string) {
	body, err := fetchPage(kwikURL, referer)
	if err != nil {
		return "", ""
	}

	// Try direct extraction first (occasionally unobfuscated)
	if m := extractM3U8(body); m != "" {
		return m, detectQuality(kwikURL + " " + m)
	}

	// Unpack ALL eval(function(p,a,c,k,e,d){...}) blocks — kwik has multiple,
	// and the video source is typically in the second one (first is a cookie util).
	for _, unpacked := range unpackAllEvals(body) {
		if m := extractM3U8(unpacked); m != "" {
			return m, detectQuality(unpacked + " " + m)
		}
	}

	return "", ""
}

func extractM3U8(s string) string {
	// The unpacked JS uses escaped quotes: const source=\'https://...m3u8\';
	// Normalize escaped quotes first
	normalized := strings.ReplaceAll(s, `\'`, `'`)
	normalized = strings.ReplaceAll(normalized, `\"`, `"`)

	// source='https://...m3u8...' or source="..."
	re := regexp.MustCompile(`source\s*=\s*['"]?(https?://[^\s'"\\;]+\.m3u8[^\s'"\\;]*)`)
	if m := re.FindStringSubmatch(normalized); len(m) >= 2 {
		url := strings.SplitN(m[1], "|", 2)[0] // strip |Expires=... suffix
		if strings.HasPrefix(url, "http") {
			return url
		}
	}
	// Generic bare m3u8 URL
	re2 := regexp.MustCompile(`(https?://[^\s'"\\;]+\.m3u8)`)
	if m := re2.FindStringSubmatch(normalized); len(m) >= 2 {
		return m[1]
	}
	return ""
}

func detectQuality(s string) string {
	switch {
	case strings.Contains(s, "1080"):
		return "1080p"
	case strings.Contains(s, "720"):
		return "720p"
	case strings.Contains(s, "480"):
		return "480p"
	case strings.Contains(s, "360"):
		return "360p"
	default:
		return ""
	}
}

// unpackAllEvals finds and unpacks ALL eval(function(p,a,c,k,e,d){...}) blocks
// in the page. kwik.cx has multiple: the first is a cookie utility, the second
// contains the actual video source URL.
func unpackAllEvals(body string) []string {
	evalRe := regexp.MustCompile(`eval\(function\(p,a,c,k,e,(?:r|d)\)`)
	argsRe := regexp.MustCompile(`\}\s*\('([\s\S]+?)',\s*(\d+),\s*\d+,\s*'([\s\S]+?)'\.split\('\|'\)`)
	wordRe := regexp.MustCompile(`\b(\w+)\b`)

	locs := evalRe.FindAllStringIndex(body, -1)
	var results []string

	for _, loc := range locs {
		packed := body[loc[0]:]
		m := argsRe.FindStringSubmatch(packed)
		if len(m) < 4 {
			continue
		}

		encodedStr := m[1]
		base, err := strconv.Atoi(m[2])
		if err != nil || base < 2 {
			continue
		}
		keywords := strings.Split(m[3], "|")

		result := wordRe.ReplaceAllStringFunc(encodedStr, func(token string) string {
			idx := parseBaseN(token, base)
			if idx < 0 || idx >= len(keywords) || keywords[idx] == "" {
				return token
			}
			return keywords[idx]
		})
		results = append(results, result)
	}
	return results
}

// parseBaseN converts a string from the given base to an integer.
// Supports base 2–62 (base 62 uses 0-9, a-z, A-Z).
func parseBaseN(s string, base int) int {
	if s == "" {
		return -1
	}
	if base <= 36 {
		n, err := strconv.ParseInt(s, base, 64)
		if err != nil {
			return -1
		}
		return int(n)
	}
	// Base 37–62: custom charset matching JavaScript's parseInt behavior
	const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	result := 0
	for _, c := range s {
		idx := strings.IndexRune(chars, c)
		if idx == -1 {
			return -1
		}
		result = result*base + idx
	}
	return result
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers — all requests go through DDoS-Guard cookie authentication
// ─────────────────────────────────────────────────────────────────────────────

func fetchAPI(rawURL string) (string, error) {
	return fetchWithCookies(rawURL, animePaheOrigin(rawURL), map[string]string{
		"Accept":           "application/json, */*;q=0.9",
		"X-Requested-With": "XMLHttpRequest",
	}, true)
}

func fetchPage(rawURL, referer string) (string, error) {
	return fetchWithCookies(rawURL, referer, map[string]string{
		"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
	}, true)
}

func fetchAPIWithBrowserFallback(rawURL string) (string, error) {
	body, err := fetchAPI(rawURL)
	if err == nil && !animePaheBlockedBody(body) {
		return body, nil
	}
	browserBody, browserErr := browserFetch(rawURL, "application/json, */*;q=0.9", true)
	if browserErr == nil && !animePaheBlockedBody(browserBody) {
		return browserBody, nil
	}
	if err != nil {
		if browserErr != nil {
			return "", fmt.Errorf("%w; browser fallback failed: %v", err, browserErr)
		}
		return "", err
	}
	if browserErr != nil {
		return "", browserErr
	}
	return "", fmt.Errorf("animepahe: blocked response")
}

func fetchPageWithBrowserFallback(rawURL, referer string) (string, error) {
	body, err := fetchPage(rawURL, referer)
	if err == nil && !animePaheBlockedBody(body) {
		return body, nil
	}
	browserBody, browserErr := browserFetch(rawURL, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false)
	if browserErr == nil && !animePaheBlockedBody(browserBody) {
		return browserBody, nil
	}
	if err != nil {
		if browserErr != nil {
			return "", fmt.Errorf("%w; browser fallback failed: %v", err, browserErr)
		}
		return "", err
	}
	if browserErr != nil {
		return "", browserErr
	}
	return "", fmt.Errorf("animepahe: blocked page response")
}

func fetchWithCookies(rawURL, referer string, extraHeaders map[string]string, retryOnBlock bool) (string, error) {
	body, status, err := doAnimePaheRequest(rawURL, referer, extraHeaders, "")
	if err == nil && status < 400 && !animePaheBlockedBody(body) {
		return body, nil
	}

	cookies, cookieErr := getValidCookies(animePaheOrigin(rawURL))
	if cookieErr != nil {
		if err != nil {
			return "", err
		}
		return "", fmt.Errorf("animepahe: DDoS-Guard bypass failed: %w", cookieErr)
	}

	cookieParts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		cookieParts = append(cookieParts, c.Name+"="+c.Value)
	}
	cookieHeader := strings.Join(cookieParts, "; ")

	body, status, err = doAnimePaheRequest(rawURL, referer, extraHeaders, cookieHeader)
	if err != nil {
		return "", err
	}

	// DDoS-Guard blocked us again — invalidate cookies and retry once
	if (status == 403 || animePaheBlockedBody(body)) && retryOnBlock {
		log.Warn().Msg("got blocked response, refreshing DDoS-Guard cookies")
		invalidateCookies()
		return fetchWithCookies(rawURL, referer, extraHeaders, false)
	}

	if status >= 400 {
		return "", fmt.Errorf("HTTP %d", status)
	}
	return body, nil
}

func doAnimePaheRequest(rawURL, referer string, extraHeaders map[string]string, cookieHeader string) (string, int, error) {
	oh := azuretls.OrderedHeaders{
		{"Referer", referer},
	}
	for k, v := range extraHeaders {
		oh = append(oh, []string{k, v})
	}
	if cookieHeader != "" {
		oh = append(oh, []string{"Cookie", cookieHeader})
	}

	req := &azuretls.Request{
		Url:            rawURL,
		Method:         "GET",
		OrderedHeaders: oh,
	}

	resp, err := httpSession.Do(req)
	if err != nil {
		return "", 0, err
	}
	return string(resp.Body), resp.StatusCode, nil
}

func animePaheBlockedBody(body string) bool {
	value := strings.ToLower(body)
	return strings.Contains(value, "ddos-guard") ||
		strings.Contains(value, "enable javascript") ||
		strings.Contains(value, "checking your browser") ||
		strings.Contains(value, "access denied")
}

func animePaheOrigin(rawURL string) string {
	parsed, err := neturl.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return baseURL
	}
	return parsed.Scheme + "://" + parsed.Host
}

var (
	animePaheBaseMu     sync.RWMutex
	animePaheActiveBase = baseURL
)

func animePaheBaseCandidates() []string {
	animePaheBaseMu.RLock()
	active := animePaheActiveBase
	animePaheBaseMu.RUnlock()

	out := []string{}
	seen := map[string]bool{}
	for _, base := range append([]string{active}, animePaheMirrorBases...) {
		base = strings.TrimSpace(base)
		if base == "" || seen[base] {
			continue
		}
		seen[base] = true
		out = append(out, base)
	}
	return out
}

func rememberAnimePaheBase(base string) {
	base = strings.TrimSpace(base)
	if base == "" {
		return
	}
	animePaheBaseMu.Lock()
	animePaheActiveBase = base
	animePaheBaseMu.Unlock()
}

func urlEncode(s string) string {
	var b strings.Builder
	for _, c := range s {
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '.', c == '~':
			b.WriteRune(c)
		case c == ' ':
			b.WriteByte('+')
		default:
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}
