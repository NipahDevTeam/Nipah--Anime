package animeflv

// resolvers.go — resolves embedded video players to direct stream URLs.
//
// Each streaming site (Streamtape, Okru, etc.) wraps the real video URL in
// JavaScript or an API call. These resolvers extract the playable URL so
// Nipah! can hand it directly to MPV.
//
// Nipah! never proxies or caches the video data — MPV fetches it directly.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var resolverClient = &http.Client{Timeout: 12 * time.Second}

// ResolvedStream is a direct playable URL returned by a resolver.
type ResolvedStream struct {
	URL     string `json:"url"`
	Quality string `json:"quality"`
	Type    string `json:"type"` // "mp4" or "hls"
}

// Resolve takes an embed URL from AnimeFLV and returns a direct stream URL.
// It detects the provider from the URL and dispatches to the right resolver.
func Resolve(embedURL string) (*ResolvedStream, error) {
	switch {
	case strings.Contains(embedURL, "streamtape"):
		return resolveStreamtape(embedURL)
	case strings.Contains(embedURL, "ok.ru"), strings.Contains(embedURL, "odnoklassniki"):
		return resolveOkru(embedURL)
	case strings.Contains(embedURL, "yourupload"):
		return resolveYourUpload(embedURL)
	case strings.Contains(embedURL, "mp4upload"):
		return resolveMp4Upload(embedURL)
	case strings.Contains(embedURL, "voe.sx"), strings.Contains(embedURL, "voe."):
		return resolveVoe(embedURL)
	case strings.Contains(embedURL, "filemoon"):
		return resolveFilemoon(embedURL)
	case strings.Contains(embedURL, "streamwish"), strings.Contains(embedURL, "wishembed"),
		strings.Contains(embedURL, "sfastwish"), strings.Contains(embedURL, "streamwish.to"),
		strings.Contains(embedURL, "awish"):
		return resolveStreamwish(embedURL)
	case strings.Contains(embedURL, "dood"), strings.Contains(embedURL, "doodstream"):
		return resolveDoodstream(embedURL)
	case strings.Contains(embedURL, "streamhide"), strings.Contains(embedURL, "guccihide"),
		strings.Contains(embedURL, "streamvid"):
		return resolveStreamhide(embedURL)
	case strings.Contains(embedURL, "jkanime.net/jkplayer/"):
		return resolveJKPlayer(embedURL)
	case strings.Contains(embedURL, "jwplayer"), strings.Contains(embedURL, "jwpltx"):
		return resolveGenericM3U8(embedURL)
	default:
		// Try generic m3u8 extraction before giving up
		result, err := resolveGenericM3U8(embedURL)
		if err == nil {
			return result, nil
		}
		return nil, fmt.Errorf("unsupported embed provider: %s", embedURL)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Streamtape
// Streamtape obfuscates the download link by splitting a token across two
// JS variables and concatenating them. We fetch the page and reconstruct it.
// ─────────────────────────────────────────────────────────────────────────────

var streamtapeTokenA = regexp.MustCompile(`robotlink'\)\.innerHTML = '(.+?)'`)
var streamtapeTokenB = regexp.MustCompile(`\+ '(.+?)'`)

func resolveStreamtape(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("streamtape fetch: %w", err)
	}

	matchA := streamtapeTokenA.FindStringSubmatch(body)
	matchB := streamtapeTokenB.FindStringSubmatch(body)
	if len(matchA) < 2 || len(matchB) < 2 {
		return nil, fmt.Errorf("streamtape: token not found in page")
	}

	// Combine token parts — Streamtape's obfuscation is just string concatenation
	tokenA := matchA[1]
	tokenB := matchB[1]
	// tokenA ends partway through, tokenB overlaps — trim tokenA to the overlap
	combined := tokenA[:len(tokenA)-len(tokenB)] + tokenB
	directURL := "https:" + combined

	return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Okru (ok.ru / odnoklassniki)
// Okru exposes video URLs in a JSON metadata blob embedded in the page HTML.
// ─────────────────────────────────────────────────────────────────────────────

var okruDataRe = regexp.MustCompile(`data-options='({.+?})'`)

func resolveOkru(embedURL string) (*ResolvedStream, error) {
	// Normalise URL
	if strings.Contains(embedURL, "odnoklassniki.ru") {
		embedURL = strings.Replace(embedURL, "odnoklassniki.ru", "ok.ru", 1)
	}

	body, err := fetchPage(embedURL, "https://ok.ru")
	if err != nil {
		return nil, fmt.Errorf("okru fetch: %w", err)
	}

	match := okruDataRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil, fmt.Errorf("okru: data-options not found")
	}

	// The JSON is HTML-entity encoded
	jsonStr := htmlDecode(match[1])

	var data struct {
		Flashvars struct {
			Metadata string `json:"metadata"`
		} `json:"flashvars"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, fmt.Errorf("okru: outer json: %w", err)
	}

	var meta struct {
		Videos []struct {
			Name string `json:"name"` // "hd", "sd", "mobile"
			URL  string `json:"url"`
		} `json:"videos"`
	}
	if err := json.Unmarshal([]byte(data.Flashvars.Metadata), &meta); err != nil {
		return nil, fmt.Errorf("okru: metadata json: %w", err)
	}

	// Prefer HD → SD → mobile
	preference := []string{"hd", "sd", "mobile"}
	qualityMap := map[string]string{"hd": "720p", "sd": "480p", "mobile": "360p"}

	for _, pref := range preference {
		for _, v := range meta.Videos {
			if strings.EqualFold(v.Name, pref) {
				return &ResolvedStream{
					URL:     v.URL,
					Quality: qualityMap[pref],
					Type:    "mp4",
				}, nil
			}
		}
	}

	if len(meta.Videos) > 0 {
		return &ResolvedStream{URL: meta.Videos[0].URL, Quality: "unknown", Type: "mp4"}, nil
	}

	return nil, fmt.Errorf("okru: no video streams found")
}

// ─────────────────────────────────────────────────────────────────────────────
// YourUpload
// YourUpload stores the direct URL in a jwplayer setup call in the page JS.
// ─────────────────────────────────────────────────────────────────────────────

var yourUploadFileRe = regexp.MustCompile(`file:"(https?://[^"]+\.mp4[^"]*)"`)

func resolveYourUpload(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("yourupload fetch: %w", err)
	}

	match := yourUploadFileRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil, fmt.Errorf("yourupload: file URL not found")
	}

	return &ResolvedStream{URL: match[1], Quality: "720p", Type: "mp4"}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Mp4Upload
// Mp4Upload embeds the URL in a player config script block.
// ─────────────────────────────────────────────────────────────────────────────

var mp4UploadSrcRe = regexp.MustCompile(`src:"(https?://[^"]+\.mp4[^"]*)"`)

func resolveMp4Upload(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("mp4upload fetch: %w", err)
	}

	match := mp4UploadSrcRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil, fmt.Errorf("mp4upload: src URL not found")
	}

	return &ResolvedStream{URL: match[1], Quality: "720p", Type: "mp4"}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Voe
// Voe serves an HLS (.m3u8) manifest. MPV handles HLS natively.
// ─────────────────────────────────────────────────────────────────────────────

var voeHLSRe = regexp.MustCompile(`'hls': '(https?://[^']+\.m3u8[^']*)'`)
var voeMp4Re = regexp.MustCompile(`'mp4': '(https?://[^']+\.mp4[^']*)'`)

func resolveVoe(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("voe fetch: %w", err)
	}

	// Prefer HLS for better quality switching
	if m := voeHLSRe.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
	}
	if m := voeMp4Re.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "720p", Type: "mp4"}, nil
	}

	return nil, fmt.Errorf("voe: no stream URL found")
}

// ─────────────────────────────────────────────────────────────────────────────
// Filemoon
// Filemoon uses an eval-packed JS blob — we extract the m3u8 with a regex.
// ─────────────────────────────────────────────────────────────────────────────

var filemoonM3U8Re = regexp.MustCompile(`sources:\s*\[{file:"(https?://[^"]+\.m3u8[^"]*)"}]`)

func resolveFilemoon(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("filemoon fetch: %w", err)
	}

	if m := filemoonM3U8Re.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
	}

	return nil, fmt.Errorf("filemoon: m3u8 not found")
}

// ─────────────────────────────────────────────────────────────────────────────
// Streamwish (streamwish.to, wishembed, awish, sfastwish)
// One of the most common providers on LA anime sites as of 2025.
// Stores the HLS URL in a jwplayer setup call or sources array.
// ─────────────────────────────────────────────────────────────────────────────

var streamwishM3U8Re  = regexp.MustCompile(`file\s*:\s*"(https?://[^"]+\.m3u8[^"]*)"`)
var streamwishSrcRe   = regexp.MustCompile(`sources\s*:\s*\[\s*\{[^}]*file\s*:\s*"(https?://[^"]+)"`)

func resolveStreamwish(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("streamwish fetch: %w", err)
	}

	if m := streamwishM3U8Re.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
	}
	if m := streamwishSrcRe.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "720p", Type: "mp4"}, nil
	}
	return nil, fmt.Errorf("streamwish: stream URL not found")
}

// ─────────────────────────────────────────────────────────────────────────────
// Doodstream (dood.watch, doodstream.com)
// Doodstream requires a token fetch — gets a base URL + token from the page,
// then combines them for the final stream URL.
// ─────────────────────────────────────────────────────────────────────────────

var doodPassRe    = regexp.MustCompile(`\$\.get\('/pass_md5/([^']+)'`)
var doodTokenRe   = regexp.MustCompile(`token=([a-zA-Z0-9]+)`)

func resolveDoodstream(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("doodstream fetch: %w", err)
	}

	m := doodPassRe.FindStringSubmatch(body)
	if len(m) < 2 {
		return nil, fmt.Errorf("doodstream: pass_md5 not found")
	}

	// Determine base host
	host := "https://dood.watch"
	if strings.Contains(embedURL, "doodstream.com") {
		host = "https://doodstream.com"
	}

	passURL := host + "/pass_md5/" + m[1]
	passBody, err := fetchPage(passURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("doodstream: pass fetch failed: %w", err)
	}

	tokenMatch := doodTokenRe.FindStringSubmatch(body)
	token := ""
	if len(tokenMatch) >= 2 {
		token = tokenMatch[1]
	}

	directURL := strings.TrimSpace(passBody) + "nipah_" + token + "?token=" + token
	return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Streamhide / Guccihide / Streamvid
// These are rebrands of the same player — HLS URL in a sources config.
// ─────────────────────────────────────────────────────────────────────────────

var streamhideM3U8Re = regexp.MustCompile(`file\s*:\s*"(https?://[^"]+\.m3u8[^"]*)"`)

func resolveStreamhide(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("streamhide fetch: %w", err)
	}
	if m := streamhideM3U8Re.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
	}
	return nil, fmt.Errorf("streamhide: m3u8 not found")
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic m3u8 extractor — last resort for unknown providers
// Scans the page for any m3u8 URL pattern.
// ─────────────────────────────────────────────────────────────────────────────

var genericM3U8Re = regexp.MustCompile(`https?://[^\s"'<>]+\.m3u8[^\s"'<>]*`)
var genericMP4Re  = regexp.MustCompile(`https?://[^\s"'<>]+\.mp4[^\s"'<>]*`)

func resolveGenericM3U8(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("generic fetch: %w", err)
	}

	if m := genericM3U8Re.FindString(body); m != "" {
		return &ResolvedStream{URL: m, Quality: "unknown", Type: "hls"}, nil
	}
	if m := genericMP4Re.FindString(body); m != "" {
		return &ResolvedStream{URL: m, Quality: "unknown", Type: "mp4"}, nil
	}
	return nil, fmt.Errorf("generic: no stream URL found in page")
}

// ─────────────────────────────────────────────────────────────────────────────
// JKPlayer (jkanime.net/jkplayer/um and /umv)
// JKAnime wraps Okru and other providers in their own player page.
// We fetch the player page and extract the real embed URL inside.
// ─────────────────────────────────────────────────────────────────────────────

func resolveJKPlayer(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPageWithHeaders(embedURL, "https://jkanime.net/", map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "es-419,es;q=0.9",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "iframe",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "same-origin",
	})
	if err != nil {
		return nil, fmt.Errorf("jkplayer fetch: %w", err)
	}

	// Look for Okru embed
	if idx := strings.Index(body, "ok.ru"); idx != -1 {
		start := idx - 30
		if start < 0 {
			start = 0
		}
		chunk := body[start : idx+100]
		// Find full URL
		for _, prefix := range []string{`src="`, `src='`, `url:`} {
			if pi := strings.Index(chunk, prefix); pi != -1 {
				val := chunk[pi+len(prefix):]
				end := strings.IndexAny(val, `"' `)
				if end != -1 {
					u := val[:end]
					if strings.HasPrefix(u, "http") {
						return resolveOkru(u)
					}
					if strings.HasPrefix(u, "//") {
						return resolveOkru("https:" + u)
					}
				}
			}
		}
	}

	// Generic m3u8 search
	if m := genericM3U8Re.FindString(body); m != "" {
		return &ResolvedStream{URL: m, Quality: "720p", Type: "hls"}, nil
	}

	// Generic mp4
	if m := genericMP4Re.FindString(body); m != "" {
		return &ResolvedStream{URL: m, Quality: "720p", Type: "mp4"}, nil
	}

	return nil, fmt.Errorf("jkplayer: no stream found in player page")
}

func fetchPageWithHeaders(url, referer string, headers map[string]string) (string, error) {
	return FetchPageWithHeaders(url, referer, headers)
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

// FetchPage fetches a URL with a realistic browser User-Agent and Spanish locale.
// Exported so other extension packages can reuse the same HTTP client.
func FetchPage(url, referer string) (string, error) {
	return fetchPage(url, referer)
}

// FetchPageWithHeaders fetches a URL with additional custom headers.
func FetchPageWithHeaders(url, referer string, headers map[string]string) (string, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", referer)
	req.Header.Set("Accept-Language", "es-419,es;q=0.9")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := resolverClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}

func fetchPage(url, referer string) (string, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", referer)
	req.Header.Set("Accept-Language", "es-419,es;q=0.9")

	resp, err := resolverClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	return string(b), err
}

func htmlDecode(s string) string {
	replacements := []struct{ from, to string }{
		{"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"},
		{"&quot;", "\""}, {"&#39;", "'"}, {"&#x2F;", "/"},
	}
	for _, r := range replacements {
		s = strings.ReplaceAll(s, r.from, r.to)
	}
	return s
}
