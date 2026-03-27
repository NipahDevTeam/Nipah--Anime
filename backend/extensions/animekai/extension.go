// Package animekai implements AnimeSource for AnimeKai (animekai.to).
// Search uses the AJAX endpoint /ajax/anime/search?keyword= which returns
// JSON with an `html` field containing rendered anime cards.
// Episodes use /ajax/episode/list/{anime_id} (requires the internal anime_id
// extracted from the watch page's embedded JS config object).
// Streams use /ajax/episode/servers + /ajax/episode/sources AJAX endpoints.
package animekai

import (
	"encoding/json"
	"fmt"
	neturl "net/url"
	"regexp"
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

var log = logger.For("AnimeKai")

const baseURL = "https://animekai.to"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "animekai-en" }
func (e *Extension) Name() string { return "AnimeKai (English)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — GET /ajax/anime/search?keyword={query}
//
// Response JSON:
//   {"status":200,"result":{"html":"<div>...<a class=\"aitem\" href=\"/watch/{slug}\">
//     ...<h6 class=\"title\">{Title}</h6>...</a>...</div>","count":N}}
// ─────────────────────────────────────────────────────────────────────────────

type searchResponse struct {
	Status interface{} `json:"status"`
	Result struct {
		HTML  string `json:"html"`
		Count int    `json:"count"`
	} `json:"result"`
}

var searchCardRe = regexp.MustCompile(`class="aitem"[^>]*href="/watch/([a-zA-Z0-9_-]+)"`)
var searchTitleRe = regexp.MustCompile(`class="title"[^>]*>([^<]+)<`)
var searchCoverRe = regexp.MustCompile(`<img[^>]+src="(https?://[^"]+)"`)
var searchTagRe = regexp.MustCompile(`<[^>]+>`)

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	url := fmt.Sprintf("%s/ajax/anime/search?keyword=%s", baseURL, urlEncode(query))
	body, err := fetchAJAX(url, baseURL)
	if err != nil {
		log.Error().Err(err).Msg("Search failed")
		return nil, err
	}

	var resp searchResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil || !animeKaiStatusOK(resp.Status) {
		log.Warn().Interface("status", resp.Status).Msg("Unexpected search response status")
		return nil, fmt.Errorf("animekai search unavailable")
	}

	html := resp.Result.HTML
	var results []extensions.SearchResult
	seen := map[string]bool{}

	// Split into per-card blocks at each aitem anchor
	blocks := splitOnPattern(html, `class="aitem"`)
	for _, block := range blocks {
		slugMatch := searchCardRe.FindStringSubmatch(block)
		if len(slugMatch) < 2 || seen[slugMatch[1]] {
			continue
		}
		slug := slugMatch[1]
		seen[slug] = true

		cover := ""
		if cm := searchCoverRe.FindStringSubmatch(block); len(cm) >= 2 {
			cover = cm[1]
		}

		title := ""
		if tm := searchTitleRe.FindStringSubmatch(block); len(tm) >= 2 {
			title = strings.TrimSpace(tm[1])
		}
		if title == "" {
			title = slugToTitle(slug)
		}
		if title == "" {
			continue
		}

		results = append(results, extensions.SearchResult{
			ID:        "/watch/" + slug,
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangEnglish},
		})
	}
	return results, nil
}

func animeKaiStatusOK(status interface{}) bool {
	switch v := status.(type) {
	case string:
		return strings.EqualFold(v, "ok") || v == "200"
	case float64:
		return int(v) == 200
	case int:
		return v == 200
	default:
		return false
	}
}

// splitOnPattern splits html into blocks starting at each occurrence of marker.
func splitOnPattern(html, marker string) []string {
	re := regexp.MustCompile(regexp.QuoteMeta(marker))
	locs := re.FindAllStringIndex(html, -1)
	if len(locs) == 0 {
		return nil
	}
	var blocks []string
	for i, loc := range locs {
		start := loc[0]
		end := len(html)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		blocks = append(blocks, html[start:end])
	}
	return blocks
}

// slugToTitle converts "attack-on-titan-ab3d" → "Attack On Titan"
func slugToTitle(slug string) string {
	parts := strings.Split(slug, "-")
	if len(parts) > 1 {
		last := parts[len(parts)-1]
		if len(last) <= 5 {
			parts = parts[:len(parts)-1]
		}
	}
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — two steps:
//   1. Fetch /watch/{slug} → extract anime_id from embedded JS config
//   2. GET /ajax/episode/list/{anime_id} → JSON with result HTML
//
// The watch page contains a JS object like:
//   {"page":"episode","anime_id":"c4Oz9KU","mal_id":"...","al_id":"..."}
// ─────────────────────────────────────────────────────────────────────────────

var animeIDRe = regexp.MustCompile(`"anime_id"\s*:\s*"([^"]+)"`)

// Episode list AJAX response:
//
//	{"status":200,"result":"<HTML with <li> items>"}
//
// Each item: <li data-id="{epId}"><a ...><div class="ep-num">N</div>...</a></li>
var epItemBlockRe = regexp.MustCompile(`<li[^>]*data-id="([^"]+)"[\s\S]*?</li>`)
var epHrefRe = regexp.MustCompile(`<a[^>]+href="([^"]+)"`)
var epNumRe = regexp.MustCompile(`class="ep-num"[^>]*>([^<]+)<`)
var epNumOnlyRe = regexp.MustCompile(`data-id="([^"]+)"`)

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	watchURL := baseURL + animeID
	if episodes := browserEpisodeList(watchURL); len(episodes) > 0 {
		return episodes, nil
	}

	body, err := fetchPage(watchURL, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animekai: fetch watch page failed: %w", err)
	}

	if idMatch := animeIDRe.FindStringSubmatch(body); len(idMatch) >= 2 {
		internalID := idMatch[1]
		ajaxURL := fmt.Sprintf("%s/ajax/episode/list/%s", baseURL, internalID)
		ajaxBody, err := fetchAJAX(ajaxURL, watchURL)
		if err == nil {
			var ajaxResp struct {
				Status int    `json:"status"`
				Result string `json:"result"`
			}
			if json.Unmarshal([]byte(ajaxBody), &ajaxResp) == nil && ajaxResp.Status == 200 && ajaxResp.Result != "" {
				if episodes := parseEpisodeList(ajaxResp.Result); len(episodes) > 0 {
					return episodes, nil
				}
			}
		}
	}

	return nil, fmt.Errorf("animekai: no episodes found for %s", animeID)
}

func parseEpisodeList(html string) []extensions.Episode {
	var episodes []extensions.Episode
	seen := map[string]bool{}

	for _, m := range epItemBlockRe.FindAllStringSubmatch(html, 1000) {
		if len(m) < 2 || seen[m[1]] {
			continue
		}
		epID := m[1]
		seen[epID] = true
		block := m[0]

		href := ""
		if hrefMatch := epHrefRe.FindStringSubmatch(block); len(hrefMatch) >= 2 {
			href = absolutizeAnimeKaiURL(hrefMatch[1])
		}

		label := ""
		if numMatch := epNumRe.FindStringSubmatch(block); len(numMatch) >= 2 {
			label = strings.TrimSpace(numMatch[1])
		}

		var num float64
		if _, err := fmt.Sscanf(label, "%f", &num); err != nil {
			num = 0
		}
		if num <= 0 {
			num = float64(len(episodes) + 1)
		}

		id := epID
		if strings.Contains(href, "#ep=") || strings.Contains(href, "?ep=") {
			id = strings.TrimPrefix(href, baseURL)
			if !strings.HasPrefix(id, "/") {
				id = "/" + strings.TrimPrefix(id, "/")
			}
		}
		episodes = append(episodes, extensions.Episode{
			ID:     id,
			Number: num,
			Title:  fmt.Sprintf("Episode %g", num),
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
	return episodes
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams — two AJAX calls:
//   1. GET /ajax/episode/servers?episodeId={epId}
//      → {"status":200,"result":"<HTML with server items>"}
//   2. GET /ajax/episode/sources?id={serverId}
//      → {"status":200,"url":"https://embed...","type":"iframe"}
// ─────────────────────────────────────────────────────────────────────────────

var serverItemRe = regexp.MustCompile(`data-id="([^"]+)"[^>]*>[\s\S]*?</li>`)
var serverTagRe = regexp.MustCompile(`<[^>]+>`)

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	if strings.HasPrefix(episodeID, "/watch/") && (strings.Contains(episodeID, "#ep=") || strings.Contains(episodeID, "?ep=")) {
		return e.browserStreamSources(baseURL + episodeID)
	}
	started := time.Now()

	serversURL := fmt.Sprintf("%s/ajax/episode/servers?episodeId=%s", baseURL, episodeID)
	serversBody, err := fetchAJAX(serversURL, baseURL)
	if err != nil {
		if watchURL := e.watchURLForEpisode(episodeID); watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				return browserSources, nil
			}
		}
		return nil, fmt.Errorf("animekai: server list failed: %w", err)
	}

	var serversResp struct {
		Status int    `json:"status"`
		Result string `json:"result"`
	}
	if err := json.Unmarshal([]byte(serversBody), &serversResp); err != nil || serversResp.Status != 200 {
		if watchURL := e.watchURLForEpisode(episodeID); watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				return browserSources, nil
			}
		}
		return nil, fmt.Errorf("animekai: server list status %d", serversResp.Status)
	}

	var serverIDs []string
	for _, m := range serverItemRe.FindAllStringSubmatch(serversResp.Result, 20) {
		if len(m) >= 2 {
			serverIDs = append(serverIDs, m[1])
		}
	}
	if len(serverIDs) == 0 {
		if watchURL := e.watchURLForEpisode(episodeID); watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				return browserSources, nil
			}
		}
		return nil, fmt.Errorf("animekai: no servers for episode %s", episodeID)
	}

	var sources []extensions.StreamSource
	log.Debug().Int("servers", len(serverIDs)).Str("episode", episodeID).Msg("AnimeKai server candidates")
	for i, srvID := range serverIDs {
		if i >= 4 || time.Since(started) > 5*time.Second {
			break
		}
		sourcesURL := fmt.Sprintf("%s/ajax/episode/sources?id=%s", baseURL, srvID)
		sourcesBody, err := fetchAJAX(sourcesURL, baseURL)
		if err != nil {
			continue
		}
		var sourcesResp struct {
			Status int    `json:"status"`
			URL    string `json:"url"`
		}
		if err := json.Unmarshal([]byte(sourcesBody), &sourcesResp); err != nil || sourcesResp.URL == "" {
			continue
		}
		embedURL := sourcesResp.URL
		resolved, err := animeflv.ResolvePlayable(embedURL)
		if err != nil {
			continue
		}
		sources = append(sources, extensions.StreamSource{
			URL:      resolved.URL,
			Quality:  resolved.Quality,
			Language: extensions.LangEnglish,
			Referer:  embedURL,
		})
		log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Msg("AnimeKai AJAX stream resolved")
		return sources, nil
	}

	if len(sources) == 0 {
		if watchURL := e.watchURLForEpisode(episodeID); watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Msg("AnimeKai browser fallback stream resolved")
				return browserSources, nil
			}
		}
		return nil, fmt.Errorf("animekai: all ajax servers failed for episode %s", episodeID)
	}
	return sources, nil
}

func (e *Extension) watchURLForEpisode(episodeID string) string {
	if strings.HasPrefix(episodeID, "/watch/") {
		return baseURL + episodeID
	}
	trimmed := strings.TrimSpace(episodeID)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	return ""
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

func fetchAJAX(url, referer string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, referer, map[string]string{
		"Accept":           "application/json, text/javascript, */*; q=0.01",
		"X-Requested-With": "XMLHttpRequest",
		"Accept-Language":  "en-US,en;q=0.9",
		"Origin":           baseURL,
	})
}

func animeKaiMaintenance(body string) bool {
	value := strings.ToLower(strings.TrimSpace(body))
	return strings.Contains(value, "site is under maintenance") &&
		strings.Contains(value, "currently performing maintenance") &&
		!strings.Contains(value, `"status"`) &&
		!strings.Contains(value, `"result"`) &&
		!strings.Contains(value, `"anime_id"`)
}

func browserEpisodeList(watchURL string) []extensions.Episode {
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

	page, err := browser.Page(proto.TargetCreateTarget{URL: watchURL})
	if err != nil {
		return nil
	}
	defer page.Close()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		result, evalErr := page.Eval(`() => JSON.stringify(Array.from(document.querySelectorAll('.episode-section a[href*="#ep="], .episode-section a[href*="?ep="], .ep-range a[data-id], [data-ep-id], a[href*="?ep="], a[href*="#ep="]')).map((node) => ({
			href: node.href || '',
			text: (node.textContent || '').trim(),
			dataId: node.getAttribute('data-id') || node.getAttribute('data-ep-id') || '',
		})).filter(item => item.href || item.dataId))`)
		if evalErr == nil {
			if episodes := parseBrowserEpisodes(result.Value.Str()); len(episodes) > 0 {
				return episodes
			}
		}
		time.Sleep(500 * time.Millisecond)
	}

	return nil
}

func parseBrowserEpisodes(raw string) []extensions.Episode {
	var items []struct {
		Href   string `json:"href"`
		Text   string `json:"text"`
		DataID string `json:"dataId"`
	}
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil
	}

	var episodes []extensions.Episode
	seen := map[float64]bool{}
	for _, item := range items {
		if item.Href == "" && item.DataID == "" {
			continue
		}

		var num float64
		if hashMatch := regexp.MustCompile(`#ep=(\d+(?:\.\d+)?)`).FindStringSubmatch(item.Href); len(hashMatch) >= 2 {
			if _, err := fmt.Sscanf(hashMatch[1], "%f", &num); err != nil {
				num = 0
			}
		}
		if num <= 0 {
			if textMatch := regexp.MustCompile(`(\d+(?:\.\d+)?)`).FindStringSubmatch(item.Text); len(textMatch) >= 2 {
				if _, err := fmt.Sscanf(textMatch[1], "%f", &num); err != nil {
					num = 0
				}
			}
		}
		if num <= 0 || seen[num] {
			continue
		}
		seen[num] = true

		// Prefer the full watch URL with #ep= so stream extraction can reuse
		// the browser-backed player path on sites that hydrate everything via JS.
		id := ""
		if item.Href != "" {
			id = strings.TrimPrefix(item.Href, baseURL)
			if !strings.HasPrefix(id, "/") {
				id = "/" + strings.TrimPrefix(id, "/")
			}
		}
		if id == "" {
			id = item.DataID
		}

		episodes = append(episodes, extensions.Episode{
			ID:     id,
			Number: num,
			Title:  fmt.Sprintf("Episode %g", num),
		})
	}

	for i := 0; i < len(episodes); i++ {
		for j := i + 1; j < len(episodes); j++ {
			if episodes[i].Number > episodes[j].Number {
				episodes[i], episodes[j] = episodes[j], episodes[i]
			}
		}
	}

	return episodes
}

func (e *Extension) browserStreamSources(episodeURL string) ([]extensions.StreamSource, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("animekai: browser not found for JS player")
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

	// Intercept ALL network responses across every frame (including iframes).
	// This is the only reliable way to capture m3u8/mp4 requests made by the
	// embedded video player, which runs in a cross-origin iframe.
	//
	// rod's EachEvent() returns a BLOCKING wait func. The goroutine pattern
	// `go EachEvent(handler)()` is correct: it calls wait() in a background
	// goroutine that processes events until the browser closes.
	// Using `defer` would deadlock because wait() blocks until a handler
	// returns true (ours never does).
	var capturedURLs []string
	var captureMu sync.Mutex

	go browser.EachEvent(func(e *proto.NetworkResponseReceived) bool {
		u := e.Response.URL
		if strings.Contains(u, ".m3u8") || strings.Contains(u, ".mp4") {
			captureMu.Lock()
			capturedURLs = append(capturedURLs, u)
			captureMu.Unlock()
		}
		return false // keep listening
	})()

	page, err := browser.Page(proto.TargetCreateTarget{URL: episodeURL})
	if err != nil {
		return nil, err
	}
	defer page.Close()

	// Wait for the episode page to render.
	time.Sleep(1500 * time.Millisecond)

	// Strategy A: Use JS fetch from within the browser page so all session
	// cookies are included automatically. We look for server items in the DOM
	// and call /ajax/episode/sources?id= for each one.
	// We use specific selectors for the SERVER list (not episode list) to avoid
	// picking up the 40+ episode items that also have data-id attributes.
	serverResult, serverErr := page.Eval(`async () => {
		// Try server-specific selectors first
		const serverSels = [
			'.servers-sub li[data-sv-id]', '.servers-sub li[data-id]',
			'.server-list li[data-sv-id]', '.server-list li[data-id]',
			'.servers li[data-sv-id]', '.servers li[data-id]',
			'ul.server-list li', '.server-item[data-sv-id]',
			'[data-sv-id]',
		];
		let serverEls = [];
		for (const sel of serverSels) {
			serverEls = Array.from(document.querySelectorAll(sel));
			if (serverEls.length > 0 && serverEls.length < 20) break; // reasonable server count
		}
		for (const el of serverEls.slice(0, 4)) {
			const id = el.getAttribute('data-sv-id') || el.getAttribute('data-id');
			if (!id) continue;
			try {
				const r = await fetch('/ajax/episode/sources?id=' + id, {
					headers: {'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*'}
				});
				const data = await r.json();
				if (data && data.url) return JSON.stringify({url: data.url, id: id});
			} catch(e) {}
		}
		return null;
	}`)
	if serverErr == nil && serverResult.Value.Str() != "" && serverResult.Value.Str() != "null" {
		var resp struct {
			URL string `json:"url"`
			ID  string `json:"id"`
		}
		if json.Unmarshal([]byte(serverResult.Value.Str()), &resp) == nil && resp.URL != "" {
			log.Info().Str("serverID", resp.ID).Str("embed", resp.URL).Msg("Browser-AJAX source found")
			if resolved, resolveErr := animeflv.ResolvePlayable(resp.URL); resolveErr == nil {
				return []extensions.StreamSource{{
					URL:      resolved.URL,
					Quality:  resolved.Quality,
					Language: extensions.LangEnglish,
					Referer:  resp.URL,
				}}, nil
			}
		}
	}

	// Strategy B: Fall back to clicking server tabs with broad selectors.
	shortPage := page.Timeout(1200 * time.Millisecond)
	for _, selector := range []string{
		".server-item", ".sl-btn", ".btn-server",
		".servers-tab li", ".tab-server", ".server-tab",
		"[data-id]", ".server",
	} {
		if el, clickErr := shortPage.Element(selector); clickErr == nil {
			_ = el.Click(proto.InputMouseButtonLeft, 1)
			time.Sleep(800 * time.Millisecond)
			break
		}
	}
	_, _ = page.Eval(`() => {
		const selectors = ['.server-item', '.sl-btn', '.btn-server', '[data-id]', '.server'];
		for (const sel of selectors) {
			const el = document.querySelector(sel);
			if (el) { el.click(); break; }
		}
	}`)
	time.Sleep(800 * time.Millisecond)

	// Try clicking play buttons within the loaded player.
	for _, selector := range []string{
		".play-btn", "#play-btn", ".jw-icon-display",
		".jw-display-icon-container", ".vjs-big-play-button",
		"video",
	} {
		if el, clickErr := shortPage.Element(selector); clickErr == nil {
			_ = el.Click(proto.InputMouseButtonLeft, 1)
			break
		}
	}
	// JS-level play trigger
	_, _ = page.Eval(`() => { const v = document.querySelector('video'); if(v) v.play(); }`)

	// Poll until we capture at least one HLS/MP4 URL (up to 12 s).
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		captureMu.Lock()
		captured := make([]string, len(capturedURLs))
		copy(captured, capturedURLs)
		captureMu.Unlock()

		if len(captured) > 0 {
			var sources []extensions.StreamSource
			seen := map[string]bool{}
			for _, u := range captured {
				if seen[u] {
					continue
				}
				seen[u] = true
				typ := "mp4"
				if strings.Contains(u, ".m3u8") {
					typ = "hls"
				}
				_ = typ // type info embedded in URL (.m3u8 vs .mp4); MPV detects automatically
				sources = append(sources, extensions.StreamSource{
					URL:      u,
					Quality:  "unknown",
					Language: extensions.LangEnglish,
					Referer:  baseURL,
				})
			}
			if len(sources) > 0 {
				return sources, nil
			}
		}

		// Also check iframe src + page HTML as fallback.
		result, evalErr := page.Eval(`() => JSON.stringify({
			iframes: Array.from(document.querySelectorAll('iframe')).map(i => i.getAttribute('src') || '').filter(Boolean),
			html: document.documentElement.outerHTML || '',
		})`)
		if evalErr == nil {
			var payload struct {
				Iframes []string `json:"iframes"`
				HTML    string   `json:"html"`
			}
			if json.Unmarshal([]byte(result.Value.Str()), &payload) == nil {
				if sources := animekaiStreamCandidates(payload.Iframes, nil, payload.HTML); len(sources) > 0 {
					return sources, nil
				}
			}
		}

		time.Sleep(250 * time.Millisecond)
	}

	return nil, fmt.Errorf("animekai: no browser-rendered streams for %s", episodeURL)
}

func animekaiStreamCandidates(iframes []string, resources []string, html string) []extensions.StreamSource {
	var sources []extensions.StreamSource
	seen := map[string]bool{}

	for _, iframe := range iframes {
		iframe = absolutizeAnimeKaiURL(iframe)
		if iframe == "" || seen[iframe] {
			continue
		}
		seen[iframe] = true

		if resolved, err := animeflv.ResolvePlayable(iframe); err == nil {
			sources = append(sources, extensions.StreamSource{
				URL:      resolved.URL,
				Quality:  resolved.Quality,
				Language: extensions.LangEnglish,
				Referer:  iframe,
			})
			continue
		}

		if direct := browserResolvedMediaURL(iframe); direct != "" && !seen[direct] {
			seen[direct] = true
			sources = append(sources, extensions.StreamSource{
				URL:      direct,
				Quality:  "unknown",
				Language: extensions.LangEnglish,
				Referer:  iframe,
			})
		}
	}

	if len(sources) == 0 {
		for _, resourceURL := range resources {
			if (!strings.Contains(resourceURL, ".m3u8") && !strings.Contains(resourceURL, ".mp4")) || seen[resourceURL] {
				continue
			}
			seen[resourceURL] = true
			sources = append(sources, extensions.StreamSource{
				URL:      resourceURL,
				Quality:  "unknown",
				Language: extensions.LangEnglish,
				Referer:  baseURL,
			})
		}
	}

	if len(sources) == 0 {
		for _, re := range []*regexp.Regexp{
			regexp.MustCompile(`https?://[^"'\\s<>]+\.m3u8[^"'\\s<>]*`),
			regexp.MustCompile(`https?://[^"'\\s<>]+\.mp4[^"'\\s<>]*`),
		} {
			if match := re.FindString(html); match != "" && !seen[match] {
				seen[match] = true
				sources = append(sources, extensions.StreamSource{
					URL:      match,
					Quality:  "unknown",
					Language: extensions.LangEnglish,
				})
			}
		}
	}

	return sources
}

func browserResolvedMediaURL(pageURL string) string {
	browserPath, found := launcher.LookPath()
	if !found {
		return ""
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
		return ""
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return ""
	}
	defer browser.Close()

	page, err := browser.Page(proto.TargetCreateTarget{URL: pageURL})
	if err != nil {
		return ""
	}
	defer page.Close()

	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		html, htmlErr := page.HTML()
		if htmlErr == nil {
			for _, re := range []*regexp.Regexp{
				regexp.MustCompile(`https?://[^"'\\s<>]+\.m3u8[^"'\\s<>]*`),
				regexp.MustCompile(`https?://[^"'\\s<>]+\.mp4[^"'\\s<>]*`),
			} {
				if match := re.FindString(html); match != "" {
					return match
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}

	return ""
}

func absolutizeAnimeKaiURL(raw string) string {
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
