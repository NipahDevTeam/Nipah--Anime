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
	"encoding/json"
	"fmt"
	neturl "net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
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

var searchCardRe = regexp.MustCompile(`href="/series/([a-zA-Z0-9_-]+)"`)
var searchTitleRe = regexp.MustCompile(`<h3[^>]*>([^<]+)</h3>`)
var searchCoverRe = regexp.MustCompile(`<img[^>]+src="(https://vidcache\.net[^"]+)"`)

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	url := fmt.Sprintf("%s/search/?q=%s", baseURL, urlEncode(query))
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animegg search: %w", err)
	}

	var results []extensions.SearchResult
	seen := map[string]bool{}

	slugs := searchCardRe.FindAllStringSubmatch(body, 60)
	titles := searchTitleRe.FindAllStringSubmatch(body, 60)
	covers := searchCoverRe.FindAllStringSubmatch(body, 60)

	for i, sm := range slugs {
		if len(sm) < 2 || seen[sm[1]] {
			continue
		}
		slug := sm[1]
		seen[slug] = true

		title := ""
		if i < len(titles) && len(titles[i]) >= 2 {
			title = strings.TrimSpace(titles[i][1])
		}
		if title == "" {
			title = slugToTitle(slug)
		}

		cover := ""
		if i < len(covers) && len(covers[i]) >= 2 {
			cover = covers[i][1]
		}

		results = append(results, extensions.SearchResult{
			ID:        "/series/" + slug,
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangEnglish},
		})
	}
	return results, nil
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

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — GET /series/{slug}/
//
// Episode list items: <a href="/{slug}-episode-{N}">{Title}</a>
// Listed in descending order; we sort ascending.
// ─────────────────────────────────────────────────────────────────────────────

var epLinkRe = regexp.MustCompile(`href="/([a-zA-Z0-9_-]+-episode-(\d+))"`)

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	// animeID is "/series/{slug}"
	url := baseURL + animeID + "/"
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animegg episodes: %w", err)
	}

	seen := map[int]bool{}
	var episodes []extensions.Episode

	for _, m := range epLinkRe.FindAllStringSubmatch(body, 2000) {
		if len(m) < 3 {
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
		episodes = append(episodes, extensions.Episode{
			ID:     "/" + m[1] + "/",
			Number: float64(num),
			Title:  fmt.Sprintf("Episode %d", num),
		})
	}

	// Sort ascending
	for i := 0; i < len(episodes); i++ {
		for j := i + 1; j < len(episodes); j++ {
			if episodes[i].Number > episodes[j].Number {
				episodes[i], episodes[j] = episodes[j], episodes[i]
			}
		}
	}

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
var animeggPreferredProvider sync.Map

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
	if idx := strings.LastIndex(value, "-episode-"); idx > 0 {
		return value[:idx]
	}
	return value
}

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	// episodeID is "/{slug}-episode-{N}/"
	url := baseURL + episodeID
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animegg stream fetch: %w", err)
	}

	var sources []extensions.StreamSource
	seen := map[string]bool{}
	var embeds []string
	animeKey := animeGGAnimeKey(episodeID)

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
				URL: m, Quality: "unknown", Language: extensions.LangEnglish,
			})
		}
	}

	// Direct mp4
	if len(sources) == 0 {
		if m := directMp4Re.FindString(body); m != "" && !seen[m] {
			sources = append(sources, extensions.StreamSource{
				URL: m, Quality: "unknown", Language: extensions.LangEnglish,
			})
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
				Quality:  resolved.Quality,
				Language: extensions.LangEnglish,
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
	if len(sources) == 0 {
		if streamSources := browserSessionStream(url); len(streamSources) > 0 {
			sources = append(sources, streamSources...)
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animegg: no streams found for %s (player is JS-rendered)", episodeID)
	}
	return sources, nil
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
func browserSessionStream(episodeURL string) []extensions.StreamSource {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil
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
		if isMedia ||
			strings.Contains(u, ".m3u8") ||
			strings.Contains(u, ".mp4") ||
			strings.Contains(u, "/play/") ||
			strings.Contains(u, "/stream/") ||
			strings.Contains(u, "/video/") ||
			strings.Contains(u, "/source/") ||
			strings.Contains(u, "/cdn/") {
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

	// Wait for the player tab buttons to render.
	time.Sleep(1500 * time.Millisecond)

	// Click first server tab if present to trigger player load.
	shortEp := episodePage.Timeout(1500 * time.Millisecond)
	for _, sel := range []string{".server-item", ".tab-server", ".btn-server", ".tab", "[data-src]"} {
		if el, clickErr := shortEp.Element(sel); clickErr == nil {
			_ = el.Click(proto.InputMouseButtonLeft, 1)
			break
		}
	}

	// Find the embed iframe (scan all, skip social/analytics embeds).
	html, _ := episodePage.HTML()
	embedURL := ""
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
	log.Info().Str("embed", embedURL).Msg("embed URL found via session browser")

	// Step 3: Navigate the SAME page to the embed URL to preserve all session
	// state (cookies, localStorage, sessionStorage). Opening a new tab loses
	// the session context that AnimeGG's /play/ CDN URLs require.
	if embedURL != "" {
		if navErr := episodePage.Navigate(embedURL); navErr == nil {
			_ = episodePage.WaitLoad()
			time.Sleep(1200 * time.Millisecond)
			shortEmbed := episodePage.Timeout(1500 * time.Millisecond)
			for _, sel := range []string{".play-btn", "#play-btn", "video", ".jw-icon-display", ".vjs-big-play-button"} {
				if el, clickErr := shortEmbed.Element(sel); clickErr == nil {
					_ = el.Click(proto.InputMouseButtonLeft, 1)
					break
				}
			}
			_, _ = episodePage.Eval(`() => { const v = document.querySelector('video'); if(v) v.play(); }`)
		}
	}

	// Step 4: Poll the captured URLs for up to 12 seconds.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
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
			seen[u] = true
			log.Debug().Str("url", u).Msg("captured stream URL")
			sources = append(sources, extensions.StreamSource{
				URL:      u,
				Quality:  "unknown",
				Language: extensions.LangEnglish,
				Referer:  embedURL,
			})
		}
		if len(sources) > 0 {
			return sources
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
					if (u.includes('.m3u8') || u.includes('.mp4') || u.includes('/play/') ||
						u.includes('/stream/') || u.includes('/video/') || u.includes('/source/')) {
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
					log.Info().Str("url", payload.URL).Msg("stream found via JS eval")
					return []extensions.StreamSource{{
						URL:      payload.URL,
						Quality:  "unknown",
						Language: extensions.LangEnglish,
						Referer:  embedURL,
					}}
				}
			}
		}

		time.Sleep(500 * time.Millisecond)
	}
	return nil
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
