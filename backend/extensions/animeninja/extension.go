// Package animeninja implements AnimeSource for AnimeNinjax (animeninjax.com).
// AnimeNinjax runs WordPress + DooPlay theme. Key endpoints:
//
//	Search : GET /wp-json/dooplay/search/?search={query}&nonce={nonce}
//	Nonce  : extracted from homepage JS variable dtGonza
//	Anime  : /online/{slug}/   → episode links: /ver/{slug}-episodio-{num}/
//	Streams: GET /wp-json/dooplayer/v2/{post_id}/{type}/{server}
//	         post_id extracted from body class postid-{N}
package animeninja

import (
	"encoding/json"
	"fmt"
	neturl "net/url"
	"regexp"
	"strings"
	"time"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/httpclient"
	"miruro/backend/logger"

	azuretls "github.com/Noooste/azuretls-client"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

var log = logger.For("AnimeNinja")

const baseURL = "https://animeninjax.com"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "animeninja-es" }
func (e *Extension) Name() string { return "AnimeNinja (Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Nonce — extracted from the dtGonza JS variable on any page.
// Pattern: var dtGonza = {"api":"...","nonce":"ac1536374d",...}
// ─────────────────────────────────────────────────────────────────────────────

var nonceRe = regexp.MustCompile(`"nonce"\s*:\s*"([a-f0-9]+)"`)

func fetchNonce() (string, error) {
	body, err := fetchPage(baseURL+"/", baseURL)
	if err != nil {
		return "", fmt.Errorf("animeninja nonce: %w", err)
	}
	m := nonceRe.FindStringSubmatch(body)
	if len(m) < 2 {
		return "", fmt.Errorf("animeninja: nonce not found")
	}
	return m[1], nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — GET /wp-json/dooplay/search/?search={query}&nonce={nonce}
//
// Response JSON: {"slug":{"title":"...","permalink":"https://animeninjax.com/online/{slug}/","img":"..."}, ...}
// Keys are the slug strings; values are objects with title, permalink, img.
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	nonce, err := fetchNonce()
	if err != nil {
		log.Warn().Err(err).Msg("Nonce error")
		// Try HTML fallback
		return e.searchHTML(query)
	}

	url := fmt.Sprintf("%s/wp-json/dooplay/search/?search=%s&nonce=%s", baseURL, urlEncode(query), nonce)
	body, err := fetchAJAX(url, baseURL)
	if err != nil || body == "" || body == "[]" || strings.HasPrefix(body, `{"error"`) {
		log.Warn().Err(err).Msg("REST search failed, trying HTML")
		return e.searchHTML(query)
	}

	results := parseSearchJSON(body)
	if len(results) == 0 {
		return e.searchHTML(query)
	}
	return results, nil
}

func parseSearchJSON(body string) []extensions.SearchResult {
	// Response is a JSON object where each key is a slug and value has title/permalink/img.
	var raw map[string]struct {
		Title     string `json:"title"`
		Permalink string `json:"permalink"`
		Img       string `json:"img"`
	}
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil
	}

	var results []extensions.SearchResult
	for _, item := range raw {
		id := extractSlugFromPermalink(item.Permalink)
		if id == "" {
			continue
		}
		results = append(results, extensions.SearchResult{
			ID:        id,
			Title:     item.Title,
			CoverURL:  item.Img,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return results
}

// extractSlugFromPermalink: "https://animeninjax.com/online/naruto/" → "/online/naruto/"
func extractSlugFromPermalink(permalink string) string {
	permalink = strings.TrimPrefix(permalink, baseURL)
	if !strings.HasPrefix(permalink, "/online/") {
		return ""
	}
	return permalink
}

// searchHTML — fallback: scrape /?s={query}
var htmlBlockRe = regexp.MustCompile(`<div class=['"]result-item['"][\s\S]*?</article>\s*</div>`)
var htmlLinkRe = regexp.MustCompile(`<div class=['"]title['"]>\s*<a href=['"](https://animeninjax\.com/online/[^'"]+/?)['"][^>]*>([^<]+)</a>`)
var htmlImgRe = regexp.MustCompile(`<img[^>]+src=['"]([^'"]+)['"]`)

func (e *Extension) searchHTML(query string) ([]extensions.SearchResult, error) {
	url := fmt.Sprintf("%s/?s=%s", baseURL, urlEncode(query))
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animeninja HTML search: %w", err)
	}

	var results []extensions.SearchResult
	seen := map[string]bool{}

	for _, block := range htmlBlockRe.FindAllString(body, 60) {
		link := htmlLinkRe.FindStringSubmatch(block)
		if len(link) < 3 || seen[link[1]] {
			continue
		}
		seen[link[1]] = true
		permalink := link[1]
		id := strings.TrimPrefix(permalink, baseURL)
		title := strings.TrimSpace(link[2])
		cover := ""
		if img := htmlImgRe.FindStringSubmatch(block); len(img) >= 2 {
			cover = img[1]
		}

		if title == "" {
			continue
		}
		results = append(results, extensions.SearchResult{
			ID:        id,
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return results, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — scrape /online/{slug}/
//
// Episode links appear as: href="https://animeninjax.com/ver/{anime-slug}-episodio-{num}/"
// ─────────────────────────────────────────────────────────────────────────────

var epLinkRe = regexp.MustCompile(`href=['"](https://animeninjax\.com/ver/[^'"]+?-episodio-(\d+(?:\.\d+)?)/?)['"]`)

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	// animeID is "/online/{slug}/"
	url := baseURL + animeID
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animeninja episodes: %w", err)
	}

	var episodes []extensions.Episode
	seen := map[float64]bool{}

	for _, m := range epLinkRe.FindAllStringSubmatch(body, 1000) {
		if len(m) < 3 {
			continue
		}
		var num float64
		if _, err := fmt.Sscanf(m[2], "%f", &num); err != nil {
			num = 0
		}
		if num <= 0 || seen[num] {
			continue
		}
		seen[num] = true

		// Episode ID is the path portion of the permalink
		epPath := strings.TrimPrefix(m[1], baseURL)
		episodes = append(episodes, extensions.Episode{
			ID:     epPath,
			Number: num,
			Title:  fmt.Sprintf("Episodio %s", formatEpisodeNumber(num)),
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
		return nil, fmt.Errorf("animeninja: no episodes found for %s", animeID)
	}
	return episodes, nil
}

func formatEpisodeNumber(num float64) string {
	if num == float64(int(num)) {
		return fmt.Sprintf("%d", int(num))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", num), "0"), ".")
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams — scrape /ver/{slug}-episodio-{num}/ → extract post_id from body class
// Then call /wp-json/dooplayer/v2/{post_id}/{server_type}/{server_num}
//
// DooPlay REST format: GET /wp-json/dooplayer/v2/{post_id}/{type}/{source}
// Response: {"embed_url": "https://...", "type": "iframe"}
// ─────────────────────────────────────────────────────────────────────────────

var postIDRe = regexp.MustCompile(`postid-(\d+)`)
var iframeRe = regexp.MustCompile(`<iframe[^>]+src=['"](https?://[^'"]+)['"]`)
var dooPlayerRe = regexp.MustCompile(`data-post=['"](\d+)['"][^>]*data-nume=['"]([^'"]+)['"][^>]*data-type=['"]([^'"]+)['"]|data-type=['"]([^'"]+)['"][^>]*data-post=['"](\d+)['"][^>]*data-nume=['"]([^'"]+)['"]`)

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	// episodeID is "/ver/{slug}-episodio-{num}/"
	url := baseURL + episodeID
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animeninja stream fetch: %w", err)
	}

	// Extract WordPress post ID from body class
	postMatch := postIDRe.FindStringSubmatch(body)
	if len(postMatch) < 2 {
		return nil, fmt.Errorf("animeninja: post_id not found for %s", episodeID)
	}
	postID := postMatch[1]

	// Try the DooPlay REST API using the actual server descriptors embedded in the page.
	var sources []extensions.StreamSource
	seen := map[string]bool{}
	started := time.Now()
	descriptors := parseDooPlayServers(body, postID)
	log.Debug().Int("servers", len(descriptors)).Str("episode", episodeID).Msg("AnimeNinja server descriptors")
	for i, descriptor := range descriptors {
		if i >= 4 || time.Since(started) > 5*time.Second {
			break
		}
		embedURL, err := fetchEmbedURL(url, descriptor)
		if err != nil || embedURL == "" {
			continue
		}

		if seen[embedURL] {
			continue
		}
		seen[embedURL] = true

		resolved, err := animeflv.ResolvePlayable(embedURL)
		if err != nil {
			continue
		}
		sources = append(sources, extensions.StreamSource{
			URL:      resolved.URL,
			Quality:  resolved.Quality,
			Language: extensions.LangSpanish,
			Referer:  embedURL,
		})
		log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Msg("AnimeNinja AJAX stream resolved")
		return sources, nil
	}

	// Fallback: look for any iframe in the page HTML
	if len(sources) == 0 {
		for _, m := range iframeRe.FindAllStringSubmatch(body, 10) {
			if len(m) < 2 || seen[m[1]] {
				continue
			}
			seen[m[1]] = true
			resolved, err := animeflv.ResolvePlayable(m[1])
			if err != nil {
				continue
			}
			sources = append(sources, extensions.StreamSource{
				URL:      resolved.URL,
				Quality:  resolved.Quality,
				Language: extensions.LangSpanish,
				Referer:  m[1],
			})
			log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Msg("AnimeNinja iframe stream resolved")
			return sources, nil
		}
	}

	// Last resort: use a headless browser to render the episode page and
	// capture the iframe that DooPlay injects dynamically via JS.
	if len(sources) == 0 {
		log.Warn().Str("episode", episodeID).Str("postID", postID).Msg("REST+iframe failed, trying browser")
		if browserSources := ninjaaBrowserSources(url); len(browserSources) > 0 {
			log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Msg("AnimeNinja browser stream resolved")
			return browserSources, nil
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animeninja: no streams found for %s (post_id=%s)", episodeID, postID)
	}
	return sources, nil
}

// ninjaaBrowserSources renders the episode page in a headless browser and
// waits for DooPlay to inject the player iframe, then resolves it.
func ninjaaBrowserSources(episodeURL string) []extensions.StreamSource {
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

	page, err := browser.Page(proto.TargetCreateTarget{URL: episodeURL})
	if err != nil {
		return nil
	}
	defer page.Close()

	time.Sleep(800 * time.Millisecond)

	result, evalErr := page.Eval(`async () => {
		const iframeSelectors = [
			'iframe[src]',
			'.dooplay_player iframe[src]',
			'.video-player iframe[src]',
			'#player-embed iframe[src]'
		];
		const clickSelectors = [
			'.dooplay_player_option',
			'li[data-post][data-nume]',
			'[data-type][data-post][data-nume]',
			'.server-item',
			'.server'
		];
		const getEmbeds = () => {
			const urls = [];
			for (const sel of iframeSelectors) {
				for (const node of document.querySelectorAll(sel)) {
					const src = (node.getAttribute('src') || '').trim();
					if (src) urls.push(src);
				}
			}
			return urls;
		};

		const initial = getEmbeds();
		if (initial.length > 0) {
			return JSON.stringify([{embed: initial[0], selector: 'initial'}]);
		}

		const candidates = [];
		const seen = new Set();
		for (const sel of clickSelectors) {
			for (const node of document.querySelectorAll(sel)) {
				const label = [
					node.getAttribute('data-type') || '',
					node.getAttribute('data-post') || '',
					node.getAttribute('data-nume') || '',
					(node.textContent || '').trim()
				].join('|');
				if (seen.has(label)) continue;
				seen.add(label);
				candidates.push({ selector: sel, label });
			}
		}

		for (const info of candidates.slice(0, 4)) {
			const node = Array.from(document.querySelectorAll(info.selector)).find((el) => {
				const label = [
					el.getAttribute('data-type') || '',
					el.getAttribute('data-post') || '',
					el.getAttribute('data-nume') || '',
					(el.textContent || '').trim()
				].join('|');
				return label === info.label;
			});
			if (!node) continue;
			node.click();
			await new Promise((resolve) => setTimeout(resolve, 800));
			const embeds = getEmbeds();
			if (embeds.length > 0) {
				return JSON.stringify(embeds.map((embed) => ({ embed, selector: info.selector, label: info.label })));
			}
		}
		return '[]';
	}`)
	if evalErr != nil {
		return nil
	}

	var embedItems []struct {
		Embed    string `json:"embed"`
		Selector string `json:"selector"`
		Label    string `json:"label"`
	}
	if err := json.Unmarshal([]byte(result.Value.Str()), &embedItems); err != nil {
		embedItems = nil
	}

	seen := map[string]bool{}
	for _, item := range embedItems {
		embedURL := strings.TrimSpace(item.Embed)
		if embedURL == "" || seen[embedURL] {
			continue
		}
		seen[embedURL] = true
		if strings.Contains(embedURL, "animeninjax") || strings.Contains(embedURL, "google") || animeflv.IsAnalyticsURL(embedURL) {
			continue
		}
		resolved, err := animeflv.ResolvePlayable(embedURL)
		if err != nil {
			log.Warn().Err(err).Str("embed", embedURL).Str("selector", item.Selector).Msg("AnimeNinja browser embed failed")
			continue
		}
		return []extensions.StreamSource{{
			URL:      resolved.URL,
			Quality:  resolved.Quality,
			Language: extensions.LangSpanish,
			Referer:  embedURL,
		}}
	}

	iframeRe := regexp.MustCompile(`<iframe[^>]+src="(https?://[^"]+)"`)
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		html, htmlErr := page.HTML()
		if htmlErr == nil {
			for _, m := range iframeRe.FindAllStringSubmatch(html, 10) {
				if len(m) < 2 {
					continue
				}
				embedURL := strings.TrimSpace(m[1])
				if embedURL == "" || seen[embedURL] {
					continue
				}
				seen[embedURL] = true
				if strings.Contains(embedURL, "animeninjax") || strings.Contains(embedURL, "google") || animeflv.IsAnalyticsURL(embedURL) {
					continue
				}
				resolved, err := animeflv.ResolvePlayable(embedURL)
				if err != nil {
					continue
				}
				return []extensions.StreamSource{{
					URL:      resolved.URL,
					Quality:  resolved.Quality,
					Language: extensions.LangSpanish,
					Referer:  embedURL,
				}}
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	return nil
}

type dooPlayServer struct {
	PostID string
	Nume   string
	Type   string
}

func parseDooPlayServers(body, fallbackPostID string) []dooPlayServer {
	var servers []dooPlayServer
	seen := map[string]bool{}

	for _, match := range dooPlayerRe.FindAllStringSubmatch(body, 20) {
		server := dooPlayServer{}
		switch {
		case len(match) >= 4 && match[1] != "":
			server = dooPlayServer{PostID: match[1], Nume: match[2], Type: match[3]}
		case len(match) >= 7 && match[4] != "":
			server = dooPlayServer{PostID: match[5], Nume: match[6], Type: match[4]}
		default:
			continue
		}
		if server.PostID == "" {
			server.PostID = fallbackPostID
		}
		key := server.PostID + "|" + server.Type + "|" + server.Nume
		if server.Nume == "" || server.Type == "" || seen[key] {
			continue
		}
		seen[key] = true
		servers = append(servers, server)
	}

	if len(servers) == 0 && fallbackPostID != "" {
		for _, t := range []string{"tv", "movie", "anime", "1", "2", "3"} {
			for _, n := range []string{"1", "2", "3", "4", "5", "0"} {
				key := fallbackPostID + "|" + t + "|" + n
				if seen[key] {
					continue
				}
				seen[key] = true
				servers = append(servers, dooPlayServer{PostID: fallbackPostID, Type: t, Nume: n})
			}
		}
	}

	return servers
}

func fetchEmbedURL(referer string, descriptor dooPlayServer) (string, error) {
	if embedURL, err := fetchEmbedURLAdminAjax(referer, descriptor); err == nil && embedURL != "" {
		return embedURL, nil
	}

	apiURL := fmt.Sprintf("%s/wp-json/dooplayer/v2/%s/%s/%s", baseURL, descriptor.PostID, descriptor.Type, descriptor.Nume)
	apiBody, err := fetchAJAX(apiURL, referer)
	if err != nil {
		return "", err
	}

	var resp struct {
		EmbedURL string `json:"embed_url"`
		Type     string `json:"type"`
	}
	if err := json.Unmarshal([]byte(apiBody), &resp); err != nil || resp.EmbedURL == "" {
		return "", fmt.Errorf("animeninja: empty REST player response")
	}
	return resp.EmbedURL, nil
}

func fetchEmbedURLAdminAjax(referer string, descriptor dooPlayServer) (string, error) {
	form := neturl.Values{}
	form.Set("action", "doo_player_ajax")
	form.Set("post", descriptor.PostID)
	form.Set("nume", descriptor.Nume)
	form.Set("type", descriptor.Type)

	session := httpclient.NewSession(12)
	httpResp, err := session.Do(&azuretls.Request{
		Url:    baseURL + "/wp-admin/admin-ajax.php",
		Method: "POST",
		Body:   form.Encode(),
		OrderedHeaders: azuretls.OrderedHeaders{
			{"Referer", referer},
			{"Origin", baseURL},
			{"Accept", "application/json, text/javascript, */*; q=0.01"},
			{"Content-Type", "application/x-www-form-urlencoded; charset=UTF-8"},
			{"X-Requested-With", "XMLHttpRequest"},
			{"Accept-Language", "es-ES,es;q=0.9"},
		},
	})
	if err != nil {
		return "", err
	}
	body := string(httpResp.Body)

	var resp struct {
		EmbedURL string `json:"embed_url"`
		Type     string `json:"type"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil || resp.EmbedURL == "" {
		return "", fmt.Errorf("animeninja: empty admin_ajax player response")
	}
	return resp.EmbedURL, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// extractYandexPageURL extracts the real embed URL from a Yandex Metrica
// pixel URL's "page-url" query parameter.
func extractYandexPageURL(yandexURL string) string {
	parsed, err := neturl.Parse(yandexURL)
	if err != nil {
		return ""
	}
	pageURL := parsed.Query().Get("page-url")
	if pageURL == "" {
		return ""
	}
	// Validate it looks like a real URL
	if !strings.HasPrefix(pageURL, "http://") && !strings.HasPrefix(pageURL, "https://") {
		return ""
	}
	return pageURL
}

func fetchPage(url, referer string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, referer, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "es-ES,es;q=0.9",
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
		"Accept-Language":  "es-ES,es;q=0.9",
	})
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
