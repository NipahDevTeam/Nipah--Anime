// Package animegg implements AnimeSource for AnimeGG (animegg.org).
// AnimeGG is a standard HTML-rendered site with:
//
//	Search  : GET /search/?q={query}  → cards with /series/{slug} links
//	Episodes: GET /series/{slug}/     → list of /{slug}-episode-{N} links
//	Streams : GET /{slug}-episode-{N}/ → iframes loaded from Animegg player
//
// Note: AnimeGG loads its video player dynamically via JavaScript. The static
// HTML contains tab buttons but no iframe src. We attempt to find any embed
// directly in the HTML; if none is found the episode is reported as unavailable.
package animegg

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	neturl "net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/httpclient"
	"miruro/backend/logger"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

var log = logger.For("AnimeGG")

const baseURL = "https://www.animegg.org"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "animegg-en" }
func (e *Extension) Name() string { return "AnimeGG (English)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — GET /search/?q={query}
//
// Result cards: <a href="/series/{slug}">...<h3>{Title}</h3>...</a>
// Cover images: src="https://vidcache.net:8161/static/{hash}/jpeg"
// ─────────────────────────────────────────────────────────────────────────────

var searchCardBlockRe = regexp.MustCompile(`(?s)<a[^>]+href="/series/([a-zA-Z0-9_-]+)"[^>]*>(.*?)</a>`)
var searchTitleRe = regexp.MustCompile(`<h3[^>]*>([^<]+)</h3>`)
var searchCoverRe = regexp.MustCompile(`<img[^>]+src="(https://vidcache\.net[^"]+)"`)
var tagStripRe = regexp.MustCompile(`<[^>]+>`)

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	var results []extensions.SearchResult
	seen := map[string]bool{}
	var lastErr error

	for _, candidate := range animeGGSearchQueries(query) {
		url := fmt.Sprintf("%s/search/?q=%s", baseURL, urlEncode(candidate))
		body, err := fetchPage(url, baseURL)
		if err != nil {
			lastErr = err
			continue
		}

		for _, sm := range searchCardBlockRe.FindAllStringSubmatch(body, 120) {
			if len(sm) < 3 || seen[sm[1]] {
				continue
			}
			slug := sm[1]
			block := sm[2]
			seen[slug] = true

			title := ""
			if tm := searchTitleRe.FindStringSubmatch(block); len(tm) >= 2 {
				title = normalizeAnimeGGText(tm[1])
			}
			if title == "" {
				title = slugToTitle(slug)
			}

			cover := ""
			if cm := searchCoverRe.FindStringSubmatch(block); len(cm) >= 2 {
				cover = cm[1]
			}

			results = append(results, extensions.SearchResult{
				ID:        "/series/" + slug,
				Title:     title,
				CoverURL:  cover,
				Languages: []extensions.Language{extensions.LangEnglish},
			})
		}
		if len(results) > 0 {
			return results, nil
		}
	}
	if len(results) > 0 {
		return results, nil
	}
	if lastErr != nil {
		return nil, fmt.Errorf("animegg search: %w", lastErr)
	}
	return results, nil
}

func animeGGSearchQueries(query string) []string {
	trimmed := strings.TrimSpace(html.UnescapeString(query))
	if trimmed == "" {
		return nil
	}
	variants := []string{trimmed}
	compact := strings.NewReplacer(":", "", ";", "", "/", " ", "-", " ", "_", " ", ".", " ").Replace(trimmed)
	compact = strings.Join(strings.Fields(compact), " ")
	if compact != "" && !strings.EqualFold(compact, trimmed) {
		variants = append(variants, compact)
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

// slugToTitle: "attack-on-titan" → "Attack On Titan"
func slugToTitle(slug string) string {
	parts := strings.Split(slug, "-")
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}

func normalizeAnimeGGText(raw string) string {
	cleaned := html.UnescapeString(strings.TrimSpace(tagStripRe.ReplaceAllString(raw, " ")))
	return strings.Join(strings.Fields(cleaned), " ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — GET /series/{slug}/
//
// Episode list items: <a href="/{slug}-episode-{N}">{Title}</a>
// Listed in descending order; we sort ascending.
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	// animeID is "/series/{slug}"
	url := baseURL + animeID + "/"
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animegg episodes: %w", err)
	}

	seen := map[int]bool{}
	var episodes []extensions.Episode
	slug := strings.Trim(strings.TrimPrefix(animeID, "/series/"), "/")
	if slug == "" {
		return nil, fmt.Errorf("animegg: invalid anime id %s", animeID)
	}
	epLinkRe := regexp.MustCompile(`(?s)href="/(` + regexp.QuoteMeta(slug) + `-episode-(\d+)(?:[^"/?#]*)?)/?"[^>]*>(.*?)</a>`)

	for _, m := range epLinkRe.FindAllStringSubmatch(body, 2000) {
		if len(m) < 4 {
			continue
		}
		var num int
		if _, err := fmt.Sscanf(m[2], "%d", &num); err != nil {
			num = 0
		}
		if num <= 0 || seen[num] {
			continue
		}
		seen[num] = true
		title := normalizeAnimeGGText(m[3])
		if title == "" || strings.EqualFold(title, slugToTitle(slug)) {
			title = fmt.Sprintf("Episode %d", num)
		}
		episodes = append(episodes, extensions.Episode{
			ID:     "/" + m[1] + "/",
			Number: float64(num),
			Title:  title,
		})
	}

	sort.Slice(episodes, func(i, j int) bool {
		return episodes[i].Number < episodes[j].Number
	})

	if len(episodes) == 0 {
		return nil, fmt.Errorf("animegg: no episodes found for %s", animeID)
	}
	return episodes, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams — GET /{slug}-episode-{N}/
//
// AnimeGG loads its player via JavaScript, but some servers may expose iframes
// in the initial HTML. We also look for any direct m3u8/mp4 links.
// We specifically check for a source URL pattern used by Animegg's server.
// ─────────────────────────────────────────────────────────────────────────────

var iframeRe = regexp.MustCompile(`<iframe[^>]+src="(https?://[^"]+)"`)
var relativeIframeRe = regexp.MustCompile(`<iframe[^>]+src="(/[^"]+)"`)
var directM3U8Re = regexp.MustCompile(`(https?://[^\s"'<>]+\.m3u8[^\s"'<>]*)`)
var directMp4Re = regexp.MustCompile(`(https?://[^\s"'<>]+\.mp4[^\s"'<>]*)`)
var animeGGTabsRe = regexp.MustCompile(`<a[^>]+href="#([^"]+)"[^>]+data-version="([^"]+)"`)
var animeGGPaneIframeRe = regexp.MustCompile(`(?s)<div[^>]+id="([^"]+)"[^>]*>.*?<iframe[^>]+src="([^"]+)"`)
var animeGGVideoSourceItemRe = regexp.MustCompile(`\{[^{}]*file:\s*"([^"]+)"[^{}]*label:\s*"([^"]+)"(?:[^{}]*bk:\s*"([^"]*)")?[^{}]*\}`)
var animeGGOgVideoRe = regexp.MustCompile(`<meta[^>]+property="og:video"[^>]+content="([^"]+)"`)
var animeggPreferredProvider sync.Map
var animeggAudioVariantCache sync.Map
var animeggPlayableValidationCache sync.Map

type animeGGAudioVariantState struct {
	Dub       bool
	CheckedAt time.Time
}

type animeGGPlayableValidationState struct {
	Status    string
	CheckedAt time.Time
}

type animeGGEmbedVariant struct {
	Audio string
	URL   string
}

func animeGGProviderPriority(embedURL string) int {
	switch {
	case strings.Contains(embedURL, ".m3u8"), strings.Contains(embedURL, ".mp4"):
		return 0
	case strings.Contains(embedURL, "streamtape"):
		return 1
	case strings.Contains(embedURL, "ok.ru"), strings.Contains(embedURL, "odnoklassniki"):
		return 2
	case strings.Contains(embedURL, "yourupload"):
		return 3
	default:
		return 6
	}
}

func animeGGPreferredPriority(animeKey, embedURL string) int {
	base := animeGGProviderPriority(embedURL)
	if animeKey == "" {
		return base
	}
	if value, ok := animeggPreferredProvider.Load(animeKey); ok {
		if preferred, ok := value.(string); ok && preferred != "" && strings.Contains(embedURL, preferred) {
			return -1
		}
	}
	return base
}

func animeGGAnimeKey(episodeID string) string {
	value := strings.Trim(strings.TrimSpace(episodeID), "/")
	if value == "" {
		return ""
	}
	if idx := strings.Index(value, "::"); idx >= 0 {
		value = value[:idx]
	}
	if idx := strings.LastIndex(value, "-episode-"); idx > 0 {
		return value[:idx]
	}
	return value
}

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	episodePath, targetAudio := animeGGParseEpisodeRequest(episodeID)
	// episodeID is "/{slug}-episode-{N}/"
	url := baseURL + episodePath
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animegg stream fetch: %w", err)
	}

	var sources []extensions.StreamSource
	seen := map[string]bool{}
	var embeds []string
	animeKey := animeGGAnimeKey(episodePath)
	variantEmbeds := animeGGExtractEmbedVariants(body)
	preferredVariantEmbeds := animeGGOrderVariantEmbeds(variantEmbeds, targetAudio)
	hasDirectVariantSources := false

	// Try iframes
	for _, m := range iframeRe.FindAllStringSubmatch(body, 20) {
		if len(m) < 2 || seen[m[1]] {
			continue
		}
		embedURL := m[1]
		// Skip analytics, ads, social embeds
		if strings.Contains(embedURL, "google") || strings.Contains(embedURL, "facebook") ||
			strings.Contains(embedURL, "twitter") || strings.Contains(embedURL, "disqus") {
			continue
		}
		seen[embedURL] = true
		embeds = append(embeds, embedURL)
	}

	// Direct m3u8
	if len(sources) == 0 {
		if m := directM3U8Re.FindString(body); m != "" && !seen[m] {
			sources = append(sources, extensions.StreamSource{
				URL: m, Quality: animeGGInferQuality(m), Language: extensions.LangEnglish, Audio: targetAudio,
			})
		}
	}

	// Direct mp4
	if len(sources) == 0 {
		if m := directMp4Re.FindString(body); m != "" && !seen[m] {
			sources = append(sources, extensions.StreamSource{
				URL: m, Quality: animeGGInferQuality(m), Language: extensions.LangEnglish, Audio: targetAudio,
			})
		}
	}

	if len(variantEmbeds) > 0 {
		for _, variant := range preferredVariantEmbeds {
			directSources, directErr := animeGGFetchEmbedSources(variant.URL, url, variant.Audio)
			if directErr != nil || len(directSources) == 0 {
				continue
			}
			hasDirectVariantSources = true
			sources = animeGGMergeSources(sources, directSources)
			if animeKey != "" {
				animeggPreferredProvider.Store(animeKey, variant.URL)
			}
		}
	}

	if len(sources) == 0 && len(embeds) > 0 {
		sort.Slice(embeds, func(i, j int) bool {
			return animeGGPreferredPriority(animeKey, embeds[i]) < animeGGPreferredPriority(animeKey, embeds[j])
		})
		for _, embedURL := range embeds {
			resolved, resolveErr := animeflv.ResolvePlayable(embedURL)
			if resolveErr != nil {
				continue
			}
			sources = append(sources, extensions.StreamSource{
				URL:      resolved.URL,
				Quality:  animeGGResolvedQuality(resolved.URL, resolved.Quality),
				Language: extensions.LangEnglish,
				Audio:    targetAudio,
				Referer:  embedURL,
			})
			if animeKey != "" {
				animeggPreferredProvider.Store(animeKey, embedURL)
			}
			break
		}
	}

	// AnimeGG's player is JS-rendered.  The key problem: the /play/ CDN URL
	// is session-gated — the server issues it only for the browser session that
	// visited the episode page first.  We therefore use a SINGLE browser session
	// that visits the episode page (acquiring cookies) and then navigates to the
	// embed iframe, capturing the /play/ or m3u8 request from within that session.
	if len(sources) == 0 || (!hasDirectVariantSources && animeGGNeedsBrowserUpgrade(sources, targetAudio)) {
		quickUpgrade := animeGGNormalizeAudio(targetAudio) == "" && len(sources) > 0
		preferredEmbedURL := ""
		if len(preferredVariantEmbeds) > 0 {
			preferredEmbedURL = preferredVariantEmbeds[0].URL
		}
		if streamSources := browserSessionStream(url, targetAudio, preferredEmbedURL, quickUpgrade); len(streamSources) > 0 {
			sources = animeGGMergeSources(sources, streamSources)
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animegg: no streams found for %s (player is JS-rendered)", episodeID)
	}
	sources = animeGGPreferSessionBackedSources(sources, targetAudio)
	sort.SliceStable(sources, func(i, j int) bool {
		return animeGGStreamPriority(sources[i]) > animeGGStreamPriority(sources[j])
	})
	return sources, nil
}

func (e *Extension) GetAudioVariants(animeID string, episodeID string) (map[string]bool, error) {
	result := map[string]bool{
		"sub": true,
		"dub": false,
	}

	targetEpisode := strings.TrimSpace(episodeID)
	if targetEpisode == "" {
		episodes, err := e.GetEpisodes(animeID)
		if err != nil {
			return result, err
		}
		if len(episodes) == 0 {
			return result, fmt.Errorf("animegg: no episodes found for %s", animeID)
		}
		targetEpisode = strings.TrimSpace(episodes[0].ID)
	}
	if targetEpisode == "" {
		return result, fmt.Errorf("animegg: no episode available to probe audio variants")
	}

	cacheKey := animeGGAnimeKey(targetEpisode)
	if cacheKey != "" {
		if cached, ok := animeggAudioVariantCache.Load(cacheKey); ok {
			if state, ok := cached.(animeGGAudioVariantState); ok && time.Since(state.CheckedAt) < 30*time.Minute {
				result["dub"] = state.Dub
				return result, nil
			}
		}
	}

	episodeURL := baseURL + targetEpisode
	if body, err := fetchPage(episodeURL, baseURL); err == nil && animeGGHTMLShowsDub(body) {
		result["dub"] = true
	}
	if !result["dub"] && animeGGProbeDubVariant(episodeURL) {
		result["dub"] = true
	}

	if cacheKey != "" {
		animeggAudioVariantCache.Store(cacheKey, animeGGAudioVariantState{
			Dub:       result["dub"],
			CheckedAt: time.Now(),
		})
	}
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func fetchPage(url, referer string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, referer, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "en-US,en;q=0.9",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "none",
	})
}

// browserSessionStream uses a SINGLE headless browser session to:
//  1. Visit the episode page (acquires session cookies + the embed URL)
//  2. Navigate to the embed iframe within the same session
//  3. Capture the /play/ or m3u8 CDN request that the player makes
//
// Using one session is essential because AnimeGG's /play/ URLs are
// session-gated and only valid for the browser that loaded the page first.
func browserSessionStream(episodeURL string, targetAudio string, preferredEmbedURL string, quickMode bool) []extensions.StreamSource {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil
	}

	controlURL, err := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("autoplay-policy", "no-user-gesture-required").
		Set("disable-blink-features", "AutomationControlled").
		Set("no-first-run").
		Set("no-default-browser-check").
		Launch()
	if err != nil {
		return nil
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil
	}
	defer browser.Close()

	// Step 1: Capture all network responses (includes /play/ and m3u8 requests).
	// rod's EachEvent returns a blocking wait func — must call in a goroutine,
	// NOT via defer (which deadlocks because it blocks until a handler returns true).
	// Cast a wide net: AnimeGG may serve streams via /play/, /stream/, /video/,
	// /source/, /cdn/, or direct .m3u8/.mp4 requests.
	var capturedURLs []string
	var captureMu sync.Mutex
	go browser.EachEvent(func(e *proto.NetworkResponseReceived) bool {
		u := e.Response.URL
		ct := strings.ToLower(e.Response.MIMEType)
		isMedia := strings.Contains(ct, "video") || strings.Contains(ct, "mpegurl") ||
			strings.Contains(ct, "octet-stream")
		if animeGGPlayableCapture(u, ct, isMedia) {
			// Exclude known non-video URLs
			if !strings.Contains(u, "disqus") && !strings.Contains(u, "google") &&
				!strings.Contains(u, "analytics") && !strings.Contains(u, "facebook") {
				captureMu.Lock()
				capturedURLs = append(capturedURLs, u)
				captureMu.Unlock()
			}
		}
		return false
	})()

	// Step 2: Visit the episode page to establish session.
	episodePage, err := browser.Page(proto.TargetCreateTarget{URL: episodeURL})
	if err != nil {
		return nil
	}
	defer episodePage.Close()
	_ = episodePage.WaitLoad()

	// Wait for the player tab buttons to render.
	time.Sleep(900 * time.Millisecond)
	animeGGSelectAudioTab(episodePage, targetAudio)
	animeGGPreferHD(episodePage)
	time.Sleep(500 * time.Millisecond)

	// Click first server tab if present to trigger player load.
	shortEp := episodePage.Timeout(1500 * time.Millisecond)
	for _, sel := range []string{".server-item", ".tab-server", ".btn-server", ".tab", "[data-src]"} {
		if el, clickErr := shortEp.Element(sel); clickErr == nil {
			_ = el.Click(proto.InputMouseButtonLeft, 1)
			break
		}
	}
	time.Sleep(400 * time.Millisecond)
	animeGGSelectAudioTab(episodePage, targetAudio)
	animeGGPreferHD(episodePage)

	// Prefer the exact embed URL for the selected audio variant when we already
	// know it from the episode page. Falling back to "first iframe wins" can
	// accidentally reopen the wrong edition when AnimeGG renders both tabs.
	embedURL := absolutizeAnimeGGURL(preferredEmbedURL)
	if embedURL == "" {
		html, _ := episodePage.HTML()
		for _, m := range iframeRe.FindAllStringSubmatch(html, 20) {
			if len(m) < 2 {
				continue
			}
			u := m[1]
			if strings.Contains(u, "google") || strings.Contains(u, "facebook") ||
				strings.Contains(u, "disqus") || strings.Contains(u, "twitter") ||
				strings.Contains(u, "ads") || strings.Contains(u, "analytics") {
				continue
			}
			embedURL = u
			break
		}
		if embedURL == "" {
			for _, m := range relativeIframeRe.FindAllStringSubmatch(html, 20) {
				if len(m) < 2 {
					continue
				}
				u := m[1]
				if strings.Contains(u, "disqus") || strings.Contains(u, "ads") {
					continue
				}
				embedURL = baseURL + u
				break
			}
		}
	}
	log.Info().Str("embed", embedURL).Msg("embed URL found via session browser")

	var fallbackSources []extensions.StreamSource

	// Step 3: Navigate the SAME page to the embed URL to preserve all session
	// state (cookies, localStorage, sessionStorage). Opening a new tab loses
	// the session context that AnimeGG's /play/ CDN URLs require.
	if embedURL != "" {
		cookieHeader := animeGGCookieHeader(episodePage, episodeURL, embedURL)
		if resolved, err := animeflv.ResolvePlayable(embedURL); err == nil && animeGGAcceptedStreamURL(resolved.URL) {
			fallbackSources = append(fallbackSources, extensions.StreamSource{
				URL:      resolved.URL,
				Quality:  animeGGResolvedQuality(resolved.URL, resolved.Quality),
				Language: extensions.LangEnglish,
				Audio:    targetAudio,
				Referer:  embedURL,
				Cookie:   cookieHeader,
			})
		}
		if navErr := episodePage.Navigate(embedURL); navErr == nil {
			_ = episodePage.WaitLoad()
			time.Sleep(900 * time.Millisecond)
			animeGGSelectAudioTab(episodePage, targetAudio)
			animeGGPreferHD(episodePage)
			shortEmbed := episodePage.Timeout(1500 * time.Millisecond)
			for _, sel := range []string{".play-btn", "#play-btn", "video", ".jw-icon-display", ".vjs-big-play-button"} {
				if el, clickErr := shortEmbed.Element(sel); clickErr == nil {
					_ = el.Click(proto.InputMouseButtonLeft, 1)
					break
				}
			}
			_, _ = episodePage.Eval(`() => { const v = document.querySelector('video'); if(v) v.play(); }`)
			animeGGSelectAudioTab(episodePage, targetAudio)
			animeGGPreferHD(episodePage)
		}
	}

	// Step 4: Poll the captured URLs for a short upgrade window. Normal sub
	// playback keeps this tight so a usable direct source is not blocked by a
	// long browser wait; explicit dub requests get a longer session window.
	startedAt := time.Now()
	waitWindow := 9 * time.Second
	if quickMode {
		waitWindow = 3 * time.Second
	}
	deadline := startedAt.Add(waitWindow)
	mergedSources := append([]extensions.StreamSource{}, fallbackSources...)
	firstCaptureAt := time.Time{}
	for time.Now().Before(deadline) {
		animeGGPreferHD(episodePage)
		_, _ = episodePage.Eval(`() => { const v = document.querySelector('video'); if(v) v.play(); }`)

		captureMu.Lock()
		snapshot := make([]string, len(capturedURLs))
		copy(snapshot, capturedURLs)
		captureMu.Unlock()

		var sources []extensions.StreamSource
		seen := map[string]bool{}
		for _, u := range snapshot {
			if seen[u] {
				continue
			}
			if !animeGGAcceptedStreamURL(u) {
				continue
			}
			seen[u] = true
			log.Debug().Str("url", u).Msg("captured stream URL")
			sources = append(sources, extensions.StreamSource{
				URL:      u,
				Quality:  animeGGInferQuality(u),
				Language: extensions.LangEnglish,
				Audio:    targetAudio,
				Referer:  embedURL,
				Cookie:   animeGGCookieHeader(episodePage, episodeURL, embedURL, u),
			})
		}
		if len(sources) > 0 {
			mergedSources = animeGGMergeSources(mergedSources, sources)
			if firstCaptureAt.IsZero() {
				firstCaptureAt = time.Now()
			}
		}

		// Also inspect the page directly via JS: check video element, jwplayer,
		// and performance resource entries for any stream URL that the network
		// event listener may have missed (e.g. non-standard CDN paths).
		if embedURL != "" {
			evalResult, evalErr := episodePage.Eval(`async () => {
				// Direct video element src
				const video = document.querySelector('video');
				if (video && video.src && !video.src.startsWith('blob:') && video.src !== window.location.href)
					return JSON.stringify({url: video.src});

				// <source> elements
				const source = document.querySelector('video source, source[src]');
				if (source && source.src && !source.src.startsWith('blob:'))
					return JSON.stringify({url: source.src});

				// jwplayer API
				try {
					if (typeof jwplayer !== 'undefined') {
						const jw = jwplayer();
						if (jw && jw.getPlaylist) {
							const list = jw.getPlaylist();
							if (list && list[0]) {
								const src = list[0].file || (list[0].sources && list[0].sources[0] && list[0].sources[0].file);
								if (src) return JSON.stringify({url: src});
							}
						}
					}
				} catch(e) {}

				// performance resource entries — catches XHR/fetch to CDN
				const resources = performance.getEntriesByType('resource');
				for (const r of resources) {
					const u = r.name;
					if (!u || u.includes('google') || u.includes('analytics') || u.includes('facebook')) continue;
					if (u.includes('.m3u8') || u.includes('.mp4')) {
						return JSON.stringify({url: u});
					}
				}
				return null;
			}`)
			if evalErr == nil && evalResult.Value.Str() != "" && evalResult.Value.Str() != "null" {
				var payload struct {
					URL string `json:"url"`
				}
				if json.Unmarshal([]byte(evalResult.Value.Str()), &payload) == nil && payload.URL != "" {
					if !animeGGAcceptedStreamURL(payload.URL) {
						continue
					}
					log.Info().Str("url", payload.URL).Msg("stream found via JS eval")
					mergedSources = animeGGMergeSources(mergedSources, []extensions.StreamSource{{
						URL:      payload.URL,
						Quality:  animeGGInferQuality(payload.URL),
						Language: extensions.LangEnglish,
						Audio:    targetAudio,
						Referer:  embedURL,
						Cookie:   animeGGCookieHeader(episodePage, episodeURL, embedURL, payload.URL),
					}})
					if firstCaptureAt.IsZero() {
						firstCaptureAt = time.Now()
					}
				}
			}
		}

		if len(mergedSources) > 0 {
			sort.SliceStable(mergedSources, func(i, j int) bool {
				return animeGGStreamPriority(mergedSources[i]) > animeGGStreamPriority(mergedSources[j])
			})
			best := mergedSources[0]
			if quickMode {
				if animeGGQualityScore(best.Quality) >= 720 {
					return mergedSources
				}
				if !firstCaptureAt.IsZero() && time.Since(firstCaptureAt) >= 800*time.Millisecond {
					return mergedSources
				}
				if len(fallbackSources) > 0 && time.Since(startedAt) >= 1100*time.Millisecond {
					return mergedSources
				}
			}
			if animeGGQualityScore(best.Quality) >= 1080 {
				return mergedSources
			}
			if animeGGQualityScore(best.Quality) >= 720 && !firstCaptureAt.IsZero() && time.Since(firstCaptureAt) >= 2*time.Second {
				return mergedSources
			}
			if !firstCaptureAt.IsZero() && time.Since(firstCaptureAt) >= 6*time.Second {
				return mergedSources
			}
		}

		time.Sleep(500 * time.Millisecond)
	}
	if len(mergedSources) > 0 {
		sort.SliceStable(mergedSources, func(i, j int) bool {
			return animeGGStreamPriority(mergedSources[i]) > animeGGStreamPriority(mergedSources[j])
		})
		return mergedSources
	}
	return nil
}

func animeGGHTMLShowsDub(body string) bool {
	if strings.TrimSpace(body) == "" {
		return false
	}
	for _, pattern := range []string{
		`(?i)>\s*dubbed\s*<`,
		`(?i)>\s*dub\s*<`,
		`(?i)audio[^>]*>\s*dubbed\s*<`,
		`(?i)language[^>]*>\s*dubbed\s*<`,
		`(?i)data-(?:audio|lang|variant)="dub"`,
	} {
		if regexp.MustCompile(pattern).MatchString(body) {
			return true
		}
	}
	return false
}

func animeGGExtractEmbedVariants(body string) []animeGGEmbedVariant {
	if strings.TrimSpace(body) == "" {
		return nil
	}

	paneIframes := make(map[string]string)
	for _, match := range animeGGPaneIframeRe.FindAllStringSubmatch(body, 20) {
		if len(match) < 3 {
			continue
		}
		paneID := strings.TrimSpace(match[1])
		if paneID == "" {
			continue
		}
		iframeURL := absolutizeAnimeGGURL(match[2])
		if iframeURL == "" {
			continue
		}
		paneIframes[paneID] = iframeURL
	}
	if len(paneIframes) == 0 {
		return nil
	}

	var variants []animeGGEmbedVariant
	seen := map[string]bool{}
	for _, match := range animeGGTabsRe.FindAllStringSubmatch(body, 20) {
		if len(match) < 3 {
			continue
		}
		paneID := strings.TrimSpace(match[1])
		audio := animeGGNormalizeAudio(match[2])
		if paneID == "" || audio == "" {
			continue
		}
		iframeURL := paneIframes[paneID]
		if iframeURL == "" {
			continue
		}
		key := audio + "|" + iframeURL
		if seen[key] {
			continue
		}
		seen[key] = true
		variants = append(variants, animeGGEmbedVariant{
			Audio: audio,
			URL:   iframeURL,
		})
	}
	return variants
}

func animeGGOrderVariantEmbeds(variants []animeGGEmbedVariant, targetAudio string) []animeGGEmbedVariant {
	if len(variants) <= 1 {
		if len(variants) == 1 {
			normalizedTarget := animeGGNormalizeAudio(targetAudio)
			if normalizedTarget != "" && variants[0].Audio != normalizedTarget {
				return nil
			}
		}
		return variants
	}
	normalizedTarget := animeGGNormalizeAudio(targetAudio)
	if normalizedTarget != "" {
		filtered := make([]animeGGEmbedVariant, 0, len(variants))
		for _, variant := range variants {
			if variant.Audio == normalizedTarget {
				filtered = append(filtered, variant)
			}
		}
		return filtered
	}
	ordered := make([]animeGGEmbedVariant, len(variants))
	copy(ordered, variants)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].Audio == "sub" && ordered[j].Audio != "sub" {
			return true
		}
		if ordered[j].Audio == "sub" && ordered[i].Audio != "sub" {
			return false
		}
		return ordered[i].Audio < ordered[j].Audio
	})
	return ordered
}

func animeGGFetchEmbedSources(embedURL, referer, audio string) ([]extensions.StreamSource, error) {
	body, err := fetchPage(embedURL, referer)
	if err != nil {
		return nil, err
	}

	normalizedAudio := animeGGNormalizeAudio(audio)
	var sources []extensions.StreamSource
	seen := map[string]bool{}

	for _, match := range animeGGVideoSourceItemRe.FindAllStringSubmatch(body, 20) {
		if len(match) < 3 {
			continue
		}
		streamURL := absolutizeAnimeGGURL(match[1])
		if streamURL == "" || seen[streamURL] {
			continue
		}
		seen[streamURL] = true
		quality := strings.TrimSpace(match[2])
		sources = append(sources, extensions.StreamSource{
			URL:      streamURL,
			Quality:  animeGGResolvedQuality(streamURL, quality),
			Language: extensions.LangEnglish,
			Audio:    normalizedAudio,
			Referer:  embedURL,
		})
	}

	if len(sources) == 0 {
		if match := animeGGOgVideoRe.FindStringSubmatch(body); len(match) >= 2 {
			streamURL := absolutizeAnimeGGURL(match[1])
			if streamURL != "" {
				sources = append(sources, extensions.StreamSource{
					URL:      streamURL,
					Quality:  animeGGInferQuality(streamURL),
					Language: extensions.LangEnglish,
					Audio:    normalizedAudio,
					Referer:  embedURL,
				})
			}
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animegg embed: no direct videoSources found")
	}
	sort.SliceStable(sources, func(i, j int) bool {
		return animeGGStreamPriority(sources[i]) > animeGGStreamPriority(sources[j])
	})
	sources = animeGGFilterDeadDirectSources(sources)
	return sources, nil
}

func animeGGFilterDeadDirectSources(sources []extensions.StreamSource) []extensions.StreamSource {
	if len(sources) <= 1 {
		return sources
	}
	valid := make([]extensions.StreamSource, 0, len(sources))
	unknown := make([]extensions.StreamSource, 0, len(sources))

	for _, source := range sources {
		switch animeGGValidateDirectSource(source) {
		case "valid":
			valid = append(valid, source)
		case "unknown":
			unknown = append(unknown, source)
		}
	}

	switch {
	case len(valid) > 0 && len(unknown) > 0:
		return append(valid, unknown...)
	case len(valid) > 0:
		return valid
	case len(unknown) > 0:
		return unknown
	default:
		return sources
	}
}

func animeGGValidateDirectSource(source extensions.StreamSource) string {
	rawURL := strings.TrimSpace(source.URL)
	if rawURL == "" {
		return "invalid"
	}

	cacheKey := rawURL + "|" + strings.TrimSpace(source.Referer) + "|" + strings.TrimSpace(source.Cookie)
	if cached, ok := animeggPlayableValidationCache.Load(cacheKey); ok {
		if state, ok := cached.(animeGGPlayableValidationState); ok && time.Since(state.CheckedAt) < 12*time.Minute {
			return state.Status
		}
	}

	client := httpclient.NewStdClient(8 * time.Second)
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) == 0 {
			return nil
		}
		req.Header = via[len(via)-1].Header.Clone()
		return nil
	}

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "unknown"
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Range", "bytes=0-0")
	if referer := strings.TrimSpace(source.Referer); referer != "" {
		req.Header.Set("Referer", referer)
	}
	if cookie := strings.TrimSpace(source.Cookie); cookie != "" {
		req.Header.Set("Cookie", cookie)
	}

	status := "unknown"
	resp, err := client.Do(req)
	if err != nil {
		lower := strings.ToLower(err.Error())
		switch {
		case strings.Contains(lower, "certificate"),
			strings.Contains(lower, "x509"),
			strings.Contains(lower, "tls:"),
			strings.Contains(lower, "expired"),
			strings.Contains(lower, "not yet valid"),
			strings.Contains(lower, "bad certificate"):
			status = "invalid"
		default:
			status = "unknown"
		}
	} else {
		_ = resp.Body.Close()
		contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
		switch {
		case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusPartialContent:
			if strings.HasSuffix(strings.ToLower(req.URL.Path), ".mp4") ||
				strings.HasSuffix(strings.ToLower(req.URL.Path), ".m3u8") ||
				strings.Contains(contentType, "video/") ||
				strings.Contains(contentType, "mpegurl") ||
				strings.Contains(contentType, "octet-stream") {
				status = "valid"
			}
		case resp.StatusCode >= 400:
			status = "invalid"
		}
	}

	animeggPlayableValidationCache.Store(cacheKey, animeGGPlayableValidationState{
		Status:    status,
		CheckedAt: time.Now(),
	})
	return status
}

func animeGGPreferHD(page *rod.Page) {
	if page == nil {
		return
	}

	animeGGOpenQualityMenu(page)

	bestScore := 0
	var best *rod.Element

	for _, selector := range []string{"button", "a", "[role=button]", ".jw-settings-content-item", ".vjs-menu-item", "li", ".tab"} {
		elements, err := page.Elements(selector)
		if err != nil {
			continue
		}
		for _, element := range elements {
			text, textErr := element.Text()
			if textErr != nil {
				continue
			}
			score := animeGGQualityTargetScore(text)
			if score <= 0 {
				continue
			}
			if score > bestScore {
				bestScore = score
				best = element
			}
		}
	}

	if best != nil {
		_ = best.Click(proto.InputMouseButtonLeft, 1)
		time.Sleep(350 * time.Millisecond)
	}
}

func animeGGOpenQualityMenu(page *rod.Page) {
	if page == nil {
		return
	}
	for _, selector := range []string{"button", "a", "[role=button]", ".jw-icon-settings", ".vjs-menu-button", ".jw-settings-sharing", ".jw-settings-submenu-button"} {
		elements, err := page.Elements(selector)
		if err != nil {
			continue
		}
		for _, element := range elements {
			text, _ := element.Text()
			lower := strings.ToLower(strings.TrimSpace(text))
			html, _ := element.HTML()
			className, _ := element.Attribute("class")
			title, _ := element.Attribute("title")
			ariaLabel, _ := element.Attribute("aria-label")
			if strings.Contains(lower, "quality") ||
				strings.Contains(strings.ToLower(strings.TrimSpace(html)), "quality") ||
				strings.Contains(strings.ToLower(strings.TrimSpace(attrString(className))), "settings") ||
				strings.Contains(strings.ToLower(strings.TrimSpace(attrString(title))), "quality") ||
				strings.Contains(strings.ToLower(strings.TrimSpace(attrString(ariaLabel))), "quality") {
				_ = element.Click(proto.InputMouseButtonLeft, 1)
				time.Sleep(220 * time.Millisecond)
			}
		}
	}
}

func attrString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func animeGGQualityTargetScore(raw string) int {
	text := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(raw)), " "))
	if text == "" {
		return 0
	}
	if strings.Contains(text, "subbed") || strings.Contains(text, "dubbed") {
		return 0
	}
	switch {
	case regexp.MustCompile(`(^|[^\d])1080p?([^\d]|$)`).MatchString(text):
		return 100
	case regexp.MustCompile(`(^|[^\d])720p?([^\d]|$)`).MatchString(text):
		return 80
	case regexp.MustCompile(`(^|[^\d])480p?([^\d]|$)`).MatchString(text):
		return 50
	case strings.Contains(text, "hd") && !strings.Contains(text, "sd"):
		return 30
	default:
		return 0
	}
}

func animeGGParseEpisodeRequest(raw string) (string, string) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return raw, "sub"
	}
	parts := strings.Split(value, "::")
	episodePath := strings.TrimSpace(parts[0])
	targetAudio := ""
	for _, part := range parts[1:] {
		token := strings.TrimSpace(part)
		if !strings.HasPrefix(strings.ToLower(token), "audio=") {
			continue
		}
		targetAudio = animeGGNormalizeAudio(strings.TrimSpace(strings.TrimPrefix(strings.ToLower(token), "audio=")))
	}
	return episodePath, targetAudio
}

func animeGGNormalizeAudio(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "dub", "dubbed":
		return "dub"
	case "sub", "subbed", "subtitle", "subtitles":
		return "sub"
	default:
		return ""
	}
}

func animeGGDecodeBackupURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return ""
	}
	result, unescapeErr := neturl.QueryUnescape(string(decoded))
	if unescapeErr != nil {
		result = string(decoded)
	}
	result = strings.TrimSpace(result)
	if strings.HasPrefix(result, "//") {
		return "https:" + result
	}
	return result
}

func animeGGSelectAudioTab(page *rod.Page, targetAudio string) bool {
	if page == nil {
		return false
	}
	normalized := animeGGNormalizeAudio(targetAudio)
	if normalized == "" {
		return false
	}
	if normalized == "dub" {
		if animeGGClickByText(page, []string{"button", "a", "[role=button]", "li", ".tab", ".server-item"}, []string{"dubbed", "dub"}) {
			time.Sleep(350 * time.Millisecond)
			return true
		}
		return false
	}
	if animeGGClickByText(page, []string{"button", "a", "[role=button]", "li", ".tab", ".server-item"}, []string{"subbed", "sub"}) {
		time.Sleep(350 * time.Millisecond)
		return true
	}
	return false
}

func animeGGHasTextTarget(page *rod.Page, selectors []string, targets []string) bool {
	if page == nil {
		return false
	}
	for _, selector := range selectors {
		elements, err := page.Elements(selector)
		if err != nil {
			continue
		}
		for _, element := range elements {
			text, textErr := element.Text()
			if textErr != nil {
				continue
			}
			lower := strings.ToLower(strings.TrimSpace(text))
			if lower == "" {
				continue
			}
			for _, target := range targets {
				if strings.Contains(lower, target) {
					return true
				}
			}
		}
	}
	return false
}

func animeGGClickByText(page *rod.Page, selectors []string, targets []string) bool {
	for _, selector := range selectors {
		elements, err := page.Elements(selector)
		if err != nil {
			continue
		}
		for _, element := range elements {
			text, textErr := element.Text()
			if textErr != nil {
				continue
			}
			lower := strings.ToLower(strings.TrimSpace(text))
			if lower == "" {
				continue
			}
			for _, target := range targets {
				if strings.Contains(lower, target) {
					if clickErr := element.Click(proto.InputMouseButtonLeft, 1); clickErr == nil {
						return true
					}
				}
			}
		}
	}
	return false
}

func animeGGProbeDubVariant(episodeURL string) bool {
	browserPath, found := launcher.LookPath()
	if !found {
		return false
	}
	controlURL, err := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("disable-blink-features", "AutomationControlled").
		Set("no-first-run").
		Set("no-default-browser-check").
		Launch()
	if err != nil {
		return false
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return false
	}
	defer browser.Close()

	page, err := browser.Page(proto.TargetCreateTarget{URL: episodeURL})
	if err != nil {
		return false
	}
	defer page.Close()

	_ = page.WaitLoad()
	time.Sleep(900 * time.Millisecond)
	if animeGGHasTextTarget(page, []string{"button", "a", "[role=button]", "li", ".tab", ".server-item"}, []string{"dubbed", "dub"}) {
		return true
	}

	shortPage := page.Timeout(1200 * time.Millisecond)
	for _, sel := range []string{".server-item", ".tab-server", ".btn-server", ".tab", "[data-src]"} {
		if el, clickErr := shortPage.Element(sel); clickErr == nil {
			_ = el.Click(proto.InputMouseButtonLeft, 1)
			break
		}
	}
	time.Sleep(450 * time.Millisecond)
	if animeGGHasTextTarget(page, []string{"button", "a", "[role=button]", "li", ".tab", ".server-item"}, []string{"dubbed", "dub"}) {
		return true
	}

	html, _ := page.HTML()
	embedURL := ""
	for _, m := range iframeRe.FindAllStringSubmatch(html, 20) {
		if len(m) >= 2 {
			embedURL = m[1]
			break
		}
	}
	if embedURL == "" {
		for _, m := range relativeIframeRe.FindAllStringSubmatch(html, 20) {
			if len(m) >= 2 {
				embedURL = absolutizeAnimeGGURL(m[1])
				break
			}
		}
	}
	if embedURL == "" {
		return false
	}

	if navErr := page.Navigate(embedURL); navErr != nil {
		return false
	}
	_ = page.WaitLoad()
	time.Sleep(700 * time.Millisecond)
	return animeGGHasTextTarget(page, []string{"button", "a", "[role=button]", "li", ".tab", ".server-item"}, []string{"dubbed", "dub"})
}

func animeGGCookieHeader(page *rod.Page, urls ...string) string {
	if page == nil {
		return ""
	}
	targets := make([]string, 0, len(urls))
	seen := map[string]bool{}
	for _, raw := range urls {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "/") {
			value = baseURL + value
		}
		if seen[value] {
			continue
		}
		seen[value] = true
		targets = append(targets, value)
	}
	if len(targets) == 0 {
		targets = append(targets, baseURL)
	}
	rodCookies, err := page.Cookies(targets)
	if err != nil || len(rodCookies) == 0 {
		return ""
	}
	parts := make([]string, 0, len(rodCookies))
	for _, cookie := range rodCookies {
		if cookie == nil || strings.TrimSpace(cookie.Name) == "" {
			continue
		}
		parts = append(parts, cookie.Name+"="+cookie.Value)
	}
	return strings.Join(parts, "; ")
}

func absolutizeAnimeGGURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	base, err := neturl.Parse(baseURL)
	if err != nil {
		return ""
	}
	ref, err := neturl.Parse(raw)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

func animeGGPlayableCapture(rawURL, contentType string, isMedia bool) bool {
	url := strings.ToLower(strings.TrimSpace(rawURL))
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if url == "" {
		return false
	}
	if strings.HasSuffix(url, ".ico") || strings.Contains(url, "favicon") {
		return false
	}
	if strings.Contains(url, ".m3u8") || strings.Contains(url, ".mp4") {
		return true
	}
	if isMedia && (strings.Contains(ct, "video") || strings.Contains(ct, "mpegurl")) {
		return true
	}
	return false
}

func animeGGAcceptedStreamURL(rawURL string) bool {
	value := strings.ToLower(strings.TrimSpace(rawURL))
	if value == "" {
		return false
	}
	if strings.HasSuffix(value, ".ico") || strings.Contains(value, "favicon") {
		return false
	}
	return strings.Contains(value, ".m3u8") || strings.Contains(value, ".mp4")
}

func animeGGInferQuality(rawURL string) string {
	value := strings.ToLower(strings.TrimSpace(rawURL))
	switch {
	case strings.Contains(value, "1080"):
		return "1080p"
	case strings.Contains(value, "720"):
		return "720p"
	case strings.Contains(value, "480"):
		return "480p"
	case strings.Contains(value, "360"):
		return "360p"
	case strings.Contains(value, ".m3u8"):
		return "720p"
	case strings.Contains(value, ".mp4"):
		return "480p"
	default:
		return "unknown"
	}
}

func animeGGResolvedQuality(rawURL, quality string) string {
	value := strings.TrimSpace(strings.ToLower(quality))
	if value != "" && value != "unknown" {
		return quality
	}
	return animeGGInferQuality(rawURL)
}

func animeGGQualityScore(quality string) int {
	value := strings.ToLower(strings.TrimSpace(quality))
	switch {
	case strings.Contains(value, "2160"):
		return 2160
	case strings.Contains(value, "1440"):
		return 1440
	case strings.Contains(value, "1080"):
		return 1080
	case strings.Contains(value, "720"):
		return 720
	case strings.Contains(value, "480"):
		return 480
	case strings.Contains(value, "360"):
		return 360
	default:
		return 0
	}
}

func animeGGStreamPriority(source extensions.StreamSource) int {
	score := animeGGQualityScore(source.Quality)
	lowerURL := strings.ToLower(strings.TrimSpace(source.URL))
	if strings.Contains(lowerURL, ".m3u8") {
		score += 25
	}
	if strings.TrimSpace(source.Cookie) != "" {
		score += 120
	}
	if strings.TrimSpace(source.Referer) != "" {
		score += 10
	}
	return score
}

func animeGGNeedsBrowserUpgrade(sources []extensions.StreamSource, targetAudio string) bool {
	if len(sources) == 0 {
		return true
	}
	normalizedTarget := animeGGNormalizeAudio(targetAudio)
	if normalizedTarget != "" {
		foundMatching := false
		needsSession := false
		for _, source := range sources {
			audio := animeGGNormalizeAudio(source.Audio)
			if audio != "" && audio != normalizedTarget {
				continue
			}
			foundMatching = true
			if strings.TrimSpace(source.Cookie) != "" {
				return false
			}
			url := strings.ToLower(strings.TrimSpace(source.URL))
			if strings.Contains(url, "animegg.org/play/") || strings.Contains(url, "www.animegg.org/play/") {
				needsSession = true
			}
		}
		if foundMatching {
			return needsSession
		}
	}
	for _, source := range sources {
		audio := animeGGNormalizeAudio(source.Audio)
		matchesTarget := normalizedTarget == "" || audio == normalizedTarget || strings.TrimSpace(source.Audio) == ""
		if !matchesTarget {
			continue
		}
		if strings.TrimSpace(source.Cookie) != "" {
			return false
		}
		qualityScore := animeGGQualityScore(source.Quality)
		if qualityScore >= 720 {
			return false
		}
		if normalizedTarget == "" && qualityScore >= 480 {
			if strings.Contains(strings.ToLower(source.URL), ".m3u8") || strings.TrimSpace(source.Referer) != "" {
				return false
			}
		}
	}
	return true
}

func animeGGMergeSources(base []extensions.StreamSource, extra []extensions.StreamSource) []extensions.StreamSource {
	if len(base) == 0 {
		return extra
	}
	merged := make([]extensions.StreamSource, 0, len(base)+len(extra))
	indexByURL := map[string]int{}

	appendOrUpgrade := func(source extensions.StreamSource) {
		source.Quality = animeGGResolvedQuality(source.URL, source.Quality)
		source.Audio = animeGGNormalizeAudio(source.Audio)
		key := strings.TrimSpace(source.URL) + "|" + animeGGNormalizeAudio(source.Audio)
		if key == "" {
			return
		}
		if idx, ok := indexByURL[key]; ok {
			current := merged[idx]
			if animeGGStreamPriority(source) > animeGGStreamPriority(current) {
				merged[idx] = source
			} else {
				if strings.TrimSpace(current.Cookie) == "" && strings.TrimSpace(source.Cookie) != "" {
					current.Cookie = source.Cookie
				}
				if strings.TrimSpace(current.Referer) == "" && strings.TrimSpace(source.Referer) != "" {
					current.Referer = source.Referer
				}
				if animeGGQualityScore(current.Quality) < animeGGQualityScore(source.Quality) {
					current.Quality = source.Quality
				}
				merged[idx] = current
			}
			return
		}
		indexByURL[key] = len(merged)
		merged = append(merged, source)
	}

	for _, source := range base {
		appendOrUpgrade(source)
	}
	for _, source := range extra {
		appendOrUpgrade(source)
	}
	return merged
}

func animeGGPreferSessionBackedSources(sources []extensions.StreamSource, targetAudio string) []extensions.StreamSource {
	if len(sources) <= 1 {
		return sources
	}
	normalizedTarget := animeGGNormalizeAudio(targetAudio)
	if normalizedTarget == "" {
		return sources
	}
	hasSessionBacked := false
	for _, source := range sources {
		if animeGGNormalizeAudio(source.Audio) != normalizedTarget {
			continue
		}
		if strings.TrimSpace(source.Cookie) != "" {
			hasSessionBacked = true
			break
		}
	}
	if !hasSessionBacked {
		return sources
	}
	filtered := make([]extensions.StreamSource, 0, len(sources))
	for _, source := range sources {
		if animeGGNormalizeAudio(source.Audio) == normalizedTarget &&
			strings.TrimSpace(source.Cookie) == "" &&
			(strings.Contains(strings.ToLower(strings.TrimSpace(source.URL)), "animegg.org/play/") ||
				strings.Contains(strings.ToLower(strings.TrimSpace(source.URL)), "www.animegg.org/play/")) {
			continue
		}
		filtered = append(filtered, source)
	}
	if len(filtered) == 0 {
		return sources
	}
	return filtered
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
