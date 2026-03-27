// Package animepahe implements AnimeSource for AnimePahe (animepahe.si).
// Uses AnimePahe's JSON API for search and episode listing, and resolves
// kwik.si embeds to direct HLS stream URLs.
package animepahe

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	azuretls "github.com/Noooste/azuretls-client"

	"miruro/backend/extensions"
	"miruro/backend/httpclient"
	"miruro/backend/logger"
)

var log = logger.For("AnimePahe")

const baseURL = "https://animepahe.si"

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
	apiURL := fmt.Sprintf("%s/api?m=search&q=%s", baseURL, urlEncode(query))
	body, err := fetchAPI(apiURL)
	if err != nil {
		return nil, fmt.Errorf("animepahe: search failed: %w", err)
	}

	var resp searchResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return nil, fmt.Errorf("animepahe: search parse failed: %w", err)
	}

	out := make([]extensions.SearchResult, 0, len(resp.Data))
	for _, item := range resp.Data {
		out = append(out, extensions.SearchResult{
			ID:        item.Session,
			Title:     item.Title,
			CoverURL:  item.Poster,
			Year:      item.Year,
			Languages: []extensions.Language{extensions.LangEnglish},
		})
	}
	return out, nil
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

	for page := 1; ; page++ {
		apiURL := fmt.Sprintf("%s/api?m=release&id=%s&sort=episode_asc&page=%d", baseURL, animeID, page)
		body, err := fetchAPI(apiURL)
		if err != nil {
			if page == 1 {
				return nil, fmt.Errorf("animepahe: episodes failed: %w", err)
			}
			break
		}

		var resp releaseResponse
		if err := json.Unmarshal([]byte(body), &resp); err != nil {
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

	return all, nil
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

	playURL := fmt.Sprintf("%s/play/%s/%s", baseURL, animeSession, epSession)
	body, err := fetchPage(playURL, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animepahe: play page failed: %w", err)
	}

	kwikEntries := extractKwikURLs(body)
	if len(kwikEntries) == 0 {
		return nil, fmt.Errorf("animepahe: no embeds found on play page")
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
			Referer:  "https://kwik.cx/",
		})
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animepahe: all kwik streams failed to resolve")
	}
	return sources, nil
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
	// Extract NNNp pattern
	re := regexp.MustCompile(`(\d{3,4}p)`)
	if m := re.FindString(raw); m != "" {
		return m
	}
	return strings.TrimSpace(raw)
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
	return fetchWithCookies(rawURL, baseURL, map[string]string{
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

func fetchWithCookies(rawURL, referer string, extraHeaders map[string]string, retryOnBlock bool) (string, error) {
	cookies, err := getValidCookies()
	if err != nil {
		return "", fmt.Errorf("animepahe: DDoS-Guard bypass failed: %w", err)
	}

	// Build cookie header string from http.Cookie slice
	cookieParts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		cookieParts = append(cookieParts, c.Name+"="+c.Value)
	}
	cookieHeader := strings.Join(cookieParts, "; ")

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
		return "", err
	}

	// DDoS-Guard blocked us again — invalidate cookies and retry once
	if resp.StatusCode == 403 && retryOnBlock {
		log.Warn().Msg("got 403, refreshing DDoS-Guard cookies")
		invalidateCookies()
		return fetchWithCookies(rawURL, referer, extraHeaders, false)
	}

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return string(resp.Body), nil
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
