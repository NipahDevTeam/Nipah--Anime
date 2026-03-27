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
	neturl "net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	azuretls "github.com/Noooste/azuretls-client"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"miruro/backend/httpclient"
)

var resolverSession = httpclient.NewSession(12)

type cachedResolvedStream struct {
	stream    *ResolvedStream
	expiresAt time.Time
}

var (
	resolvePlayableCache   sync.Map
	resolvePlayableSuccess = 30 * time.Minute
	resolvePlayableFailure = 2 * time.Minute
)

// IsAnalyticsURL returns true if the URL belongs to a known analytics/tracking
// service. These must never be returned as stream URLs.
func IsAnalyticsURL(u string) bool {
	for _, domain := range []string{
		"mc.yandex.ru", "yandex.ru/metrika",
		"google-analytics.com", "googletagmanager.com",
		"googlesyndication.com", "doubleclick.net",
		"facebook.com/tr", "connect.facebook.net",
	} {
		if strings.Contains(u, domain) {
			return true
		}
	}
	return false
}

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
	case strings.Contains(embedURL, "megaup"):
		return resolveMegaUp(embedURL)
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

func inferResolvedType(raw string) string {
	if strings.Contains(strings.ToLower(strings.TrimSpace(raw)), ".m3u8") {
		return "hls"
	}
	return "mp4"
}

func extractAnalyticsWrappedURL(raw string) string {
	parsed, err := neturl.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}

	for _, key := range []string{"page-url", "url", "target"} {
		value := strings.TrimSpace(parsed.Query().Get(key))
		if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
			return value
		}
	}
	return ""
}

// LooksLikePlayableURL returns true for URLs that can be handed to MPV or the
// integrated player directly without another embed-resolution pass.
func LooksLikePlayableURL(raw string) bool {
	value := strings.TrimSpace(raw)
	return (strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://")) &&
		!IsAnalyticsURL(value) &&
		!IsEmbedPageURL(value)
}

// ResolvePlayable follows nested embed pages until it reaches a direct stream
// URL or clearly fails. This protects the player from opening HTML/embed pages
// that only look like media URLs.
func ResolvePlayable(embedURL string) (*ResolvedStream, error) {
	current := strings.TrimSpace(embedURL)
	if current == "" {
		return nil, fmt.Errorf("empty embed url")
	}
	if cached, ok := cachedPlayableStream(current); ok {
		return cached, nil
	}

	seen := map[string]bool{}
	for depth := 0; depth < 4; depth++ {
		if seen[current] {
			return nil, fmt.Errorf("embed resolution loop detected")
		}
		seen[current] = true

		if LooksLikePlayableURL(current) {
			resolved := &ResolvedStream{
				URL:     current,
				Quality: "unknown",
				Type:    inferResolvedType(current),
			}
			storePlayableStream(current, resolved, true)
			return resolved, nil
		}

		resolved, err := Resolve(current)
		if err != nil || resolved == nil || strings.TrimSpace(resolved.URL) == "" {
			resolved, err = BrowserResolveMedia(current)
			if err != nil || resolved == nil || strings.TrimSpace(resolved.URL) == "" {
				if err != nil {
					storePlayableStream(embedURL, nil, false)
					return nil, err
				}
				storePlayableStream(embedURL, nil, false)
				return nil, fmt.Errorf("resolver returned empty stream")
			}
		}

		next := strings.TrimSpace(resolved.URL)
		if IsAnalyticsURL(next) {
			if wrapped := extractAnalyticsWrappedURL(next); wrapped != "" {
				current = wrapped
				continue
			}
			return nil, fmt.Errorf("resolver returned analytics url")
		}

		if LooksLikePlayableURL(next) {
			final := &ResolvedStream{
				URL:     next,
				Quality: firstNonEmptyResolvedQuality(resolved.Quality),
				Type:    firstNonEmptyResolvedType(resolved.Type, inferResolvedType(next)),
			}
			storePlayableStream(embedURL, final, true)
			return final, nil
		}

		if !IsEmbedPageURL(next) {
			storePlayableStream(embedURL, nil, false)
			return nil, fmt.Errorf("resolver returned non-playable url")
		}
		current = next
	}

	storePlayableStream(embedURL, nil, false)
	return nil, fmt.Errorf("could not resolve playable stream")
}

func cachedPlayableStream(embedURL string) (*ResolvedStream, bool) {
	value, ok := resolvePlayableCache.Load(strings.TrimSpace(embedURL))
	if !ok {
		return nil, false
	}
	entry, ok := value.(cachedResolvedStream)
	if !ok || time.Now().After(entry.expiresAt) {
		resolvePlayableCache.Delete(strings.TrimSpace(embedURL))
		return nil, false
	}
	if entry.stream == nil {
		return nil, false
	}
	copy := *entry.stream
	return &copy, true
}

func storePlayableStream(embedURL string, stream *ResolvedStream, success bool) {
	ttl := resolvePlayableFailure
	if success {
		ttl = resolvePlayableSuccess
	}
	var copyStream *ResolvedStream
	if stream != nil {
		copyValue := *stream
		copyStream = &copyValue
	}
	resolvePlayableCache.Store(strings.TrimSpace(embedURL), cachedResolvedStream{
		stream:    copyStream,
		expiresAt: time.Now().Add(ttl),
	})
}

func firstNonEmptyResolvedQuality(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "unknown"
}

func firstNonEmptyResolvedType(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "mp4"
}

// ─────────────────────────────────────────────────────────────────────────────
// Streamtape
// Streamtape obfuscates the download link by splitting a token across two
// JS variables and concatenating them. We fetch the page and reconstruct it.
// ─────────────────────────────────────────────────────────────────────────────

// Streamtape obfuscation patterns — they periodically change the JS format
// but the CDN URL always comes from tapecontent.net.
var streamtapeTokenA = regexp.MustCompile(`robotlink'\)\.innerHTML = '(.+?)'`)
var streamtapeTokenB = regexp.MustCompile(`\+ '(.+?)'`)

// Broader patterns that survive obfuscation changes:
// Matches two adjacent string concatenations forming the CDN path
var streamtapeInnerRe = regexp.MustCompile(`innerHTML\s*=\s*["']([^"']+)["']\s*\+\s*["']([^"']+)["']`)
var streamtapeInner2Re = regexp.MustCompile(`innerHTML\s*=\s*["']([^"']+)["']`)
var streamtapeSubstrRe = regexp.MustCompile(`innerHTML\s*=\s*\(["']([^"']+)["']\)\.substring\((\d+)\)`)
var streamtapeVarConcatRe = regexp.MustCompile(`(?:var\s+\w+\s*=\s*|=\s*)["'](/[^"']*tapecontent[^"']+)["']`)

// Last resort: find any tapecontent.net path fragment in the JS
var streamtapeCDNRe = regexp.MustCompile(`//([\d]+\.tapecontent\.net/[^"'\s<>\]\\)]+)`)

func resolveStreamtape(embedURL string) (*ResolvedStream, error) {
	// Streamtape redirects /e/ to /v/ sometimes — normalise
	body, err := fetchPage(embedURL, "https://streamtape.com")
	if err != nil {
		return nil, fmt.Errorf("streamtape fetch: %w", err)
	}

	// Pattern 1 (classic): robotlink innerHTML = 'A' + 'B'
	matchA := streamtapeTokenA.FindStringSubmatch(body)
	matchB := streamtapeTokenB.FindStringSubmatch(body)
	if len(matchA) >= 2 && len(matchB) >= 2 {
		tokenA := matchA[1]
		tokenB := matchB[1]
		combined := tokenA[:len(tokenA)-len(tokenB)] + tokenB
		directURL := "https:" + combined
		if isValidStreamURL(directURL) {
			return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
		}
	}

	// Pattern 2: innerHTML = 'A' + 'B'  (newer format, no robotlink prefix)
	if m := streamtapeInnerRe.FindStringSubmatch(body); len(m) >= 3 {
		directURL := "https:" + m[1] + m[2]
		if isValidStreamURL(directURL) && !IsEmbedPageURL(directURL) {
			return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
		}
	}

	// Pattern 3: innerHTML = ('longstring').substring(N)
	if m := streamtapeSubstrRe.FindStringSubmatch(body); len(m) >= 3 {
		var start int
		if _, err := fmt.Sscanf(m[2], "%d", &start); err != nil {
			start = -1
		}
		if start >= 0 && start < len(m[1]) {
			directURL := "https:" + m[1][start:]
			if isValidStreamURL(directURL) && !IsEmbedPageURL(directURL) {
				return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
			}
		}
	}

	// Pattern 4: variable assignment with tapecontent in value
	if m := streamtapeVarConcatRe.FindStringSubmatch(body); len(m) >= 2 {
		directURL := "https:" + m[1]
		if isValidStreamURL(directURL) {
			return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
		}
	}

	// Pattern 5: raw CDN URL fragment anywhere in the page JS
	if m := streamtapeCDNRe.FindStringSubmatch(body); len(m) >= 2 {
		directURL := "https://" + m[1]
		if isValidStreamURL(directURL) {
			return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
		}
	}

	// Browser fallback — also tries clicking Streamtape's download/play button
	if resolved, err := browserResolveStreamtape(embedURL); err == nil {
		return resolved, nil
	}
	return nil, fmt.Errorf("streamtape: CDN URL not found in page")
}

func isValidStreamURL(u string) bool {
	return strings.HasPrefix(u, "https://") &&
		!strings.ContainsAny(u, "<>\"' \t\n") &&
		len(u) < 600
}

// browserResolveStreamtape uses a headless browser to load the Streamtape embed,
// captures the tapecontent.net CDN request via network events, and returns it.
func browserResolveStreamtape(embedURL string) (*ResolvedStream, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("browser not found")
	}

	controlURL, err := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check").
		Launch()
	if err != nil {
		return nil, err
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil, err
	}
	defer browser.Close()

	// Capture tapecontent.net CDN requests via network events
	var capturedURL string
	var captureMu sync.Mutex
	go browser.EachEvent(func(ev *proto.NetworkResponseReceived) bool {
		u := ev.Response.URL
		if strings.Contains(u, "tapecontent.net") {
			captureMu.Lock()
			capturedURL = u
			captureMu.Unlock()
		}
		return false
	})()

	page, err := browser.Page(proto.TargetCreateTarget{URL: embedURL})
	if err != nil {
		return nil, err
	}
	defer page.Close()

	time.Sleep(1500 * time.Millisecond)

	// Click Streamtape's download/play button
	shortPage := page.Timeout(1500 * time.Millisecond)
	for _, sel := range []string{"#downloadbtn", ".downloadbtn", ".btn-download", "#btn-download", "video", "[id*=download]"} {
		if el, clickErr := shortPage.Element(sel); clickErr == nil {
			_ = el.Click(proto.InputMouseButtonLeft, 1)
			break
		}
	}

	// Wait for the CDN request
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		captureMu.Lock()
		u := capturedURL
		captureMu.Unlock()
		if u != "" {
			return &ResolvedStream{URL: u, Quality: "720p", Type: "mp4"}, nil
		}

		// Also check JS for the CDN URL
		result, evalErr := page.Eval(`() => {
			const el = document.getElementById('robotlink');
			if (el && el.innerHTML) return el.innerHTML;
			return null;
		}`)
		if evalErr == nil && result.Value.Str() != "" {
			v := strings.TrimSpace(result.Value.Str())
			if strings.Contains(v, "tapecontent.net") {
				directURL := "https:" + v
				if !strings.HasPrefix(v, "//") {
					directURL = v
				}
				if isValidStreamURL(directURL) {
					return &ResolvedStream{URL: directURL, Quality: "720p", Type: "mp4"}, nil
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return nil, fmt.Errorf("streamtape browser: CDN URL not captured")
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

// MP4Upload uses Video.js: player.src({src: "https://a4.mp4upload.com:183/d/.../video.mp4", type: "video/mp4"})
// The src key may use single or double quotes, with optional whitespace.
var mp4UploadSrcRe = regexp.MustCompile(`src:\s*["'](https?://[^"']+\.mp4[^"']*)["']`)
var mp4UploadFileRe = regexp.MustCompile(`file:\s*["'](https?://[^"']+\.mp4[^"']*)["']`)

func resolveMp4Upload(embedURL string) (*ResolvedStream, error) {
	// Normalize URL: /embed-CODE.html and /CODE both need the embed format
	if !strings.Contains(embedURL, "/embed-") {
		parts := strings.Split(strings.TrimRight(embedURL, "/"), "/")
		code := parts[len(parts)-1]
		embedURL = fmt.Sprintf("https://www.mp4upload.com/embed-%s.html", code)
	}

	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("mp4upload fetch: %w", err)
	}

	match := mp4UploadSrcRe.FindStringSubmatch(body)
	if len(match) < 2 {
		match = mp4UploadFileRe.FindStringSubmatch(body)
	}
	if len(match) < 2 {
		// Last resort: any mp4upload CDN URL in the page
		cdnRe := regexp.MustCompile(`(https?://[a-z0-9]+\.mp4upload\.com[^\s"'<>]+\.mp4[^\s"'<>]*)`)
		match = cdnRe.FindStringSubmatch(body)
	}
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

	// Filemoon also uses eval-packed JS
	for _, unpacked := range unpackAllEvals(body) {
		if m := filemoonM3U8Re.FindStringSubmatch(unpacked); len(m) >= 2 {
			return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
		}
		// Broader search in unpacked JS
		if m := streamwishM3U8Re.FindStringSubmatch(unpacked); len(m) >= 2 {
			return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
		}
	}

	return nil, fmt.Errorf("filemoon: m3u8 not found")
}

// ─────────────────────────────────────────────────────────────────────────────
// Streamwish (streamwish.to, wishembed, awish, sfastwish)
// One of the most common providers on LA anime sites as of 2025.
// Stores the HLS URL in a jwplayer setup call or sources array.
// ─────────────────────────────────────────────────────────────────────────────

var streamwishM3U8Re = regexp.MustCompile(`file\s*:\s*"(https?://[^"]+\.m3u8[^"]*)"`)
var streamwishSrcRe = regexp.MustCompile(`sources\s*:\s*\[\s*\{[^}]*file\s*:\s*"(https?://[^"]+)"`)

func resolveStreamwish(embedURL string) (*ResolvedStream, error) {
	body, err := fetchPage(embedURL, embedURL)
	if err != nil {
		return nil, fmt.Errorf("streamwish fetch: %w", err)
	}

	// Try direct extraction first (unobfuscated pages)
	if m := streamwishM3U8Re.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
	}
	if m := streamwishSrcRe.FindStringSubmatch(body); len(m) >= 2 {
		return &ResolvedStream{URL: m[1], Quality: "720p", Type: "mp4"}, nil
	}

	// Streamwish often uses eval(function(p,a,c,k,e,d){...}) packing.
	// Unpack all eval blocks and search for the m3u8 URL inside.
	for _, unpacked := range unpackAllEvals(body) {
		if m := streamwishM3U8Re.FindStringSubmatch(unpacked); len(m) >= 2 {
			return &ResolvedStream{URL: m[1], Quality: "1080p", Type: "hls"}, nil
		}
		if m := streamwishSrcRe.FindStringSubmatch(unpacked); len(m) >= 2 {
			return &ResolvedStream{URL: m[1], Quality: "720p", Type: "mp4"}, nil
		}
	}
	// Browser fallback intentionally omitted — too slow when many providers are tried
	// sequentially. Faster providers (Streamtape, OkRu, YourUpload) are preferred.
	return nil, fmt.Errorf("streamwish: stream URL not found")
}

func resolveMegaUp(embedURL string) (*ResolvedStream, error) {
	if resolved, err := browserResolveMedia(embedURL); err == nil {
		return resolved, nil
	}
	return nil, fmt.Errorf("megaup: stream URL not found")
}

// ─────────────────────────────────────────────────────────────────────────────
// Doodstream (dood.watch, doodstream.com)
// Doodstream requires a token fetch — gets a base URL + token from the page,
// then combines them for the final stream URL.
// ─────────────────────────────────────────────────────────────────────────────

var doodPassRe = regexp.MustCompile(`\$\.get\('/pass_md5/([^']+)'`)
var doodTokenRe = regexp.MustCompile(`token=([a-zA-Z0-9]+)`)

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
var genericMP4Re = regexp.MustCompile(`https?://[^\s"'<>]+\.mp4[^\s"'<>]*`)

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

func browserResolveMedia(embedURL string) (*ResolvedStream, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("browser not found")
	}

	controlURL, err := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check").
		Launch()
	if err != nil {
		return nil, err
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil, err
	}
	defer browser.Close()

	page, err := browser.Page(proto.TargetCreateTarget{URL: embedURL})
	if err != nil {
		return nil, err
	}
	defer page.Close()

	// Give the page a moment to start loading, then trigger play.
	time.Sleep(2 * time.Second)

	// Try clicking play buttons with a SHORT timeout per selector.
	// rod's default Element() timeout is ~30s which causes multi-minute hangs
	// when selectors don't exist on the page.
	shortPage := page.Timeout(1500 * time.Millisecond)
	for _, selector := range []string{
		".play-btn", "#play-btn", ".plyr__control--overlaid",
		".jw-icon-display", ".jw-display-icon-container",
		".vjs-big-play-button", "button[title='Play']",
		"video",
	} {
		if el, clickErr := shortPage.Element(selector); clickErr == nil {
			_ = el.Click(proto.InputMouseButtonLeft, 1)
			break // no sleep — polling loop below handles waiting
		}
	}
	// Also try JS-level play trigger
	_, _ = page.Eval(`() => { const v = document.querySelector('video'); if(v) v.play(); }`)

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		result, evalErr := page.Eval(`() => JSON.stringify({
			media: Array.from(document.querySelectorAll('video, video source')).map(node => node.currentSrc || node.src || '').filter(Boolean),
			resources: (performance.getEntriesByType ? performance.getEntriesByType('resource') : []).map(entry => entry.name || '').filter(Boolean),
			html: document.documentElement.outerHTML || '',
		})`)
		if evalErr == nil {
			var payload struct {
				Media     []string `json:"media"`
				Resources []string `json:"resources"`
				HTML      string   `json:"html"`
			}
			if json.Unmarshal([]byte(result.Value.Str()), &payload) == nil {
				for _, mediaURL := range payload.Media {
					if IsAnalyticsURL(mediaURL) {
						continue
					}
					if strings.Contains(mediaURL, ".m3u8") {
						return &ResolvedStream{URL: mediaURL, Quality: "unknown", Type: "hls"}, nil
					}
					if strings.Contains(mediaURL, ".mp4") {
						return &ResolvedStream{URL: mediaURL, Quality: "unknown", Type: "mp4"}, nil
					}
				}
				for _, resourceURL := range payload.Resources {
					if IsAnalyticsURL(resourceURL) {
						continue
					}
					// Check only the URL path — not query string — so analytics
					// pixels (e.g. Yandex Metrica) that encode ".mp4" in their
					// page-url query param are not mistaken for video streams.
					rp := resourceURL
					if parsed, parseErr := neturl.Parse(resourceURL); parseErr == nil {
						rp = parsed.Path
					}
					if strings.Contains(rp, ".m3u8") {
						return &ResolvedStream{URL: resourceURL, Quality: "unknown", Type: "hls"}, nil
					}
					if strings.Contains(rp, ".mp4") {
						return &ResolvedStream{URL: resourceURL, Quality: "unknown", Type: "mp4"}, nil
					}
				}
				if m := genericM3U8Re.FindString(payload.HTML); m != "" {
					if !IsAnalyticsURL(m) {
						return &ResolvedStream{URL: m, Quality: "unknown", Type: "hls"}, nil
					}
				}
				if m := genericMP4Re.FindString(payload.HTML); m != "" {
					// genericMP4Re can match embed-page URLs whose path contains
					// ".mp4" as a filename (e.g. streamtape.com/e/xxx/video.mp4).
					// These are HTML pages, not playable streams — never return them raw.
					if IsEmbedPageURL(m) || IsAnalyticsURL(m) {
						// silently skip — returning an embed page URL to MPV is fatal
					} else {
						return &ResolvedStream{URL: m, Quality: "unknown", Type: "mp4"}, nil
					}
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}

	return nil, fmt.Errorf("browser media url not found")
}

// IsEmbedPageURL returns true if the URL is clearly an embed *page* (HTML)
// rather than a direct video stream file. These must never be sent to MPV.
func IsEmbedPageURL(u string) bool {
	return strings.Contains(u, "streamtape.com/e/") ||
		strings.Contains(u, "mp4upload.com/embed") ||
		strings.Contains(u, "filemoon.") && strings.Contains(u, "/e/") ||
		strings.Contains(u, "streamwish.") && strings.Contains(u, "/e/") ||
		strings.Contains(u, "ok.ru/videoembed") ||
		strings.Contains(u, "saidochesto.") ||
		strings.Contains(u, "/embed")
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

// BrowserResolveMedia is an exported wrapper around browserResolveMedia,
// allowing other extension packages to leverage the shared rod-based resolver.
func BrowserResolveMedia(embedURL string) (*ResolvedStream, error) {
	return browserResolveMedia(embedURL)
}

// FetchPageWithHeaders fetches a URL with additional custom headers.
func FetchPageWithHeaders(url, referer string, headers map[string]string) (string, error) {
	oh := azuretls.OrderedHeaders{
		{"Referer", referer},
	}
	for k, v := range headers {
		oh = append(oh, []string{k, v})
	}
	req := &azuretls.Request{
		Url:            url,
		Method:         "GET",
		OrderedHeaders: oh,
	}
	resp, err := resolverSession.Do(req)
	if err != nil {
		return "", err
	}
	return string(resp.Body), nil
}

func fetchPage(url, referer string) (string, error) {
	resp, err := httpclient.Get(resolverSession, url, referer)
	if err != nil {
		return "", err
	}
	return string(resp.Body), nil
}

// ─────────────────────────────────────────────────────────────────────────────
// eval(function(p,a,c,k,e,d){...}) unpacker
// Many embed providers (Streamwish, Filemoon, etc.) hide the real stream URL
// inside a JavaScript packer. This unpacker extracts the encoded string and
// keyword table, then reconstructs the original JS containing the stream URL.
// ─────────────────────────────────────────────────────────────────────────────

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
