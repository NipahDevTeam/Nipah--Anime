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
	"html"
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

const baseURL = "https://anikai.to"

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

var searchAnchorRe = regexp.MustCompile(`(?s)<a class="aitem" href="/watch/([a-zA-Z0-9_-]+)"[^>]*>(.*?)</a>`)
var searchTitleRe = regexp.MustCompile(`class="title"[^>]*>([^<]+)<`)
var searchCoverRe = regexp.MustCompile(`<img[^>]+src="(https?://[^"]+)"`)
var searchYearRe = regexp.MustCompile(`<span>(\d{4})</span>`)

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	var results []extensions.SearchResult
	seen := map[string]bool{}
	var lastErr error

	for _, candidate := range animeKaiSearchQueries(query) {
		url := fmt.Sprintf("%s/ajax/anime/search?keyword=%s", baseURL, urlEncode(candidate))
		body, err := fetchAJAX(url, baseURL)
		if err != nil {
			lastErr = err
			log.Error().Err(err).Str("query", candidate).Msg("Search failed")
			continue
		}
		if animeKaiCloudflareBlock(body) {
			lastErr = fmt.Errorf("animekai: search blocked by Cloudflare challenge")
			continue
		}

		var resp searchResponse
		if err := json.Unmarshal([]byte(body), &resp); err != nil || !animeKaiStatusOK(resp.Status) {
			lastErr = fmt.Errorf("animekai search unavailable")
			log.Warn().Interface("status", resp.Status).Str("query", candidate).Msg("Unexpected search response status")
			continue
		}

		html := resp.Result.HTML
		for _, match := range searchAnchorRe.FindAllStringSubmatch(html, 1000) {
			if len(match) < 3 || seen[match[1]] {
				continue
			}
			slug := match[1]
			block := match[2]
			seen[slug] = true

			cover := ""
			if cm := searchCoverRe.FindStringSubmatch(block); len(cm) >= 2 {
				cover = cm[1]
			}
			year := 0
			if ym := searchYearRe.FindStringSubmatch(block); len(ym) >= 2 {
				_, _ = fmt.Sscanf(ym[1], "%d", &year)
			}

			title := ""
			if tm := searchTitleRe.FindStringSubmatch(block); len(tm) >= 2 {
				title = normalizeAnimeKaiText(tm[1])
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
				Year:      year,
				Languages: []extensions.Language{extensions.LangEnglish},
			})
		}
	}
	if len(results) == 0 && lastErr != nil {
		return nil, lastErr
	}
	return results, nil
}

func animeKaiSearchQueries(query string) []string {
	trimmed := normalizeAnimeKaiText(query)
	if trimmed == "" {
		return nil
	}
	variants := []string{trimmed}
	sanitized := strings.NewReplacer(
		":", " ",
		";", " ",
		"/", " ",
		"-", " ",
		"_", " ",
		".", " ",
	).Replace(trimmed)
	sanitized = strings.Join(strings.Fields(sanitized), " ")
	if sanitized != "" && !strings.EqualFold(sanitized, trimmed) {
		variants = append(variants, sanitized)
	}
	base := regexp.MustCompile(`(?i)\b(?:\d{1,2}(?:st|nd|rd|th)\s+season|season\s+\d{1,2}|part\s+\d{1,2}|cour\s+\d{1,2}|ova|ona|special|movie|film)\b`).ReplaceAllString(trimmed, " ")
	base = strings.Join(strings.Fields(base), " ")
	if base != "" && !strings.EqualFold(base, trimmed) {
		variants = append(variants, base)
	}
	if strings.Contains(strings.ToLower(trimmed), "re:zero") {
		variants = append(variants, "Re Zero", "Re Zero kara Hajimeru Isekai Seikatsu")
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

var syncDataRe = regexp.MustCompile(`<script id="syncData" type="application/json">([^<]+)</script>`)

type animeKaiSyncData struct {
	Page      string `json:"page"`
	Name      string `json:"name"`
	AnimeID   string `json:"anime_id"`
	MalID     string `json:"mal_id"`
	AniListID string `json:"al_id"`
	SeriesURL string `json:"series_url"`
	Episode   int    `json:"episode"`
}

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
	body, err := fetchPage(watchURL, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animekai: fetch watch page failed: %w", err)
	}
	var lastErr error
	if animeKaiCloudflareBlock(body) {
		lastErr = fmt.Errorf("animekai: episode list blocked by Cloudflare challenge")
	} else {

		if syncData, ok := extractAnimeKaiSyncData(body); ok && syncData.AnimeID != "" {
			internalID := syncData.AnimeID
			ajaxURL := fmt.Sprintf("%s/ajax/episode/list/%s", baseURL, internalID)
			ajaxBody, err := fetchAJAX(ajaxURL, watchURL)
			if err == nil {
				if animeKaiCloudflareBlock(ajaxBody) {
					lastErr = fmt.Errorf("animekai: episode AJAX blocked by Cloudflare challenge")
				} else {
					var ajaxResp struct {
						Status int    `json:"status"`
						Result string `json:"result"`
					}
					if json.Unmarshal([]byte(ajaxBody), &ajaxResp) == nil && ajaxResp.Status == 200 && ajaxResp.Result != "" {
						if episodes := parseEpisodeList(ajaxResp.Result); len(episodes) > 0 {
							return normalizeAnimeKaiEpisodesForAnime(episodes, animeID), nil
						}
					}
				}
			} else {
				lastErr = err
			}
		}
	}

	if episodes := browserEpisodeList(watchURL); len(episodes) > 0 {
		return normalizeAnimeKaiEpisodesForAnime(episodes, animeID), nil
	}

	if lastErr != nil {
		return nil, lastErr
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

		id := composeAnimeKaiEpisodeID(epID, href)
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

var serverItemRe = regexp.MustCompile(`<li[^>]*data-id="([^"]+)"[^>]*>([\s\S]*?)</li>`)
var serverTagRe = regexp.MustCompile(`<[^>]+>`)

type animeKaiServerCandidate struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Audio string `json:"audio"`
}

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	serverEpisodeID, watchURL := splitAnimeKaiEpisodeID(episodeID)
	if watchURL == "" && strings.HasPrefix(episodeID, "/watch/") {
		watchURL = baseURL + episodeID
	}
	started := time.Now()
	sawCloudflare := false

	if strings.TrimSpace(serverEpisodeID) == "" {
		if watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Msg("AnimeKai browser-only stream resolved")
				return browserSources, nil
			} else if browserErr != nil {
				log.Warn().Err(browserErr).Str("episode", episodeID).Msg("AnimeKai browser-only stream resolution failed")
				if animeKaiChallengeError(browserErr) {
					sawCloudflare = true
				}
			}
		}
		if sawCloudflare {
			return nil, fmt.Errorf("animekai: stream resolution blocked by Cloudflare challenge for episode %s", episodeID)
		}
		return nil, fmt.Errorf("animekai: no playable streams resolved for episode %s", episodeID)
	}

	serversURL := fmt.Sprintf("%s/ajax/episode/servers?episodeId=%s", baseURL, serverEpisodeID)
	serversBody, err := fetchAJAX(serversURL, firstNonEmptyAnimeKaiURL(watchURL, baseURL))
	if err != nil {
		if watchURL := firstNonEmptyAnimeKaiURL(watchURL, e.watchURLForEpisode(episodeID)); watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				return browserSources, nil
			}
		}
		return nil, fmt.Errorf("animekai: server list failed: %w", err)
	}
	if animeKaiCloudflareBlock(serversBody) {
		return nil, fmt.Errorf("animekai: server discovery blocked by Cloudflare challenge")
	}

	var serversResp struct {
		Status int    `json:"status"`
		Result string `json:"result"`
	}
	if err := json.Unmarshal([]byte(serversBody), &serversResp); err != nil || serversResp.Status != 200 {
		if watchURL := firstNonEmptyAnimeKaiURL(watchURL, e.watchURLForEpisode(episodeID)); watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				return browserSources, nil
			}
		}
		return nil, fmt.Errorf("animekai: server list status %d", serversResp.Status)
	}

	var serverIDs []animeKaiServerCandidate
	for _, m := range serverItemRe.FindAllStringSubmatch(serversResp.Result, 20) {
		if len(m) >= 3 {
			label := strings.TrimSpace(serverTagRe.ReplaceAllString(m[2], " "))
			serverIDs = append(serverIDs, animeKaiServerCandidate{
				ID:    m[1],
				Label: label,
				Audio: inferAnimeKaiAudio(label),
			})
		}
	}
	if len(serverIDs) == 0 {
		if watchURL := firstNonEmptyAnimeKaiURL(watchURL, e.watchURLForEpisode(episodeID)); watchURL != "" {
			if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
				return browserSources, nil
			}
		}
		return nil, fmt.Errorf("animekai: no servers for episode %s", episodeID)
	}

	if watchURL != "" {
		if browserSources, browserErr := e.browserStreamSourcesForCandidates(watchURL, serverIDs); browserErr == nil && len(browserSources) > 0 {
			log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Int("servers", len(serverIDs)).Msg("AnimeKai watch-session stream resolved")
			return browserSources, nil
		} else if browserErr != nil {
			log.Warn().Err(browserErr).Str("episode", episodeID).Int("servers", len(serverIDs)).Msg("AnimeKai watch-session stream resolution failed")
			if animeKaiChallengeError(browserErr) {
				sawCloudflare = true
			}
		}
	}

	var sources []extensions.StreamSource
	seenSources := map[string]bool{}
	log.Debug().Int("servers", len(serverIDs)).Str("episode", episodeID).Msg("AnimeKai server candidates")
	for i, server := range serverIDs {
		if i >= 8 || time.Since(started) > 10*time.Second {
			break
		}
		sourcesURL := fmt.Sprintf("%s/ajax/episode/sources?id=%s", baseURL, server.ID)
		sourcesBody, err := fetchAJAX(sourcesURL, firstNonEmptyAnimeKaiURL(watchURL, baseURL))
		if err != nil {
			log.Debug().Err(err).Str("server", server.ID).Str("label", server.Label).Msg("AnimeKai source AJAX failed")
			continue
		}
		if animeKaiCloudflareBlock(sourcesBody) {
			sawCloudflare = true
			log.Warn().Str("server", server.ID).Str("label", server.Label).Msg("AnimeKai source AJAX blocked by Cloudflare")
			continue
		}
		var sourcesResp struct {
			Status int    `json:"status"`
			URL    string `json:"url"`
		}
		if err := json.Unmarshal([]byte(sourcesBody), &sourcesResp); err != nil || sourcesResp.URL == "" {
			log.Debug().Err(err).Str("server", server.ID).Str("label", server.Label).Msg("AnimeKai source payload invalid")
			continue
		}
		embedURL := sourcesResp.URL
		if watchURL != "" {
			if browserSources := browserAnimeKaiEmbedSession(watchURL, embedURL, server.Audio); len(browserSources) > 0 {
				for _, source := range browserSources {
					if seenSources[source.URL] {
						continue
					}
					seenSources[source.URL] = true
					sources = append(sources, source)
				}
				log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Str("server", server.ID).Str("audio", server.Audio).Msg("AnimeKai session-backed stream resolved")
				if len(sources) > 0 {
					break
				}
			}
		}

		resolved, err := animeflv.ResolvePlayable(embedURL)
		if err != nil {
			log.Debug().Err(err).Str("server", server.ID).Str("label", server.Label).Str("embed", embedURL).Msg("AnimeKai embed resolve failed")
			continue
		}
		if seenSources[resolved.URL] {
			continue
		}
		seenSources[resolved.URL] = true
		sources = append(sources, extensions.StreamSource{
			URL:      resolved.URL,
			Quality:  animeKaiResolvedQuality(resolved.URL, resolved.Quality),
			Language: extensions.LangEnglish,
			Audio:    server.Audio,
			Referer:  embedURL,
		})
		log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Str("server", server.ID).Str("audio", server.Audio).Msg("AnimeKai AJAX stream resolved")
		if len(sources) >= 3 {
			break
		}
	}

	if len(sources) > 0 {
		return sources, nil
	}

	if watchURL := firstNonEmptyAnimeKaiURL(watchURL, e.watchURLForEpisode(episodeID)); watchURL != "" {
		if browserSources, browserErr := e.browserStreamSources(watchURL); browserErr == nil && len(browserSources) > 0 {
			log.Debug().Dur("duration", time.Since(started)).Str("episode", episodeID).Msg("AnimeKai browser fallback stream resolved")
			return browserSources, nil
		} else if browserErr != nil {
			log.Warn().Err(browserErr).Str("episode", episodeID).Msg("AnimeKai browser fallback failed")
			if animeKaiChallengeError(browserErr) {
				sawCloudflare = true
			}
		}
	}
	if sawCloudflare {
		return nil, fmt.Errorf("animekai: stream resolution blocked by Cloudflare challenge for episode %s", episodeID)
	}
	if len(sources) == 0 {
		return nil, fmt.Errorf("animekai: no playable streams resolved for episode %s", episodeID)
	}
	return sources, nil
}

func inferAnimeKaiAudio(label string) string {
	value := strings.ToLower(strings.TrimSpace(label))
	switch {
	case strings.Contains(value, "dub"), strings.Contains(value, "lat"), strings.Contains(value, "cast"):
		return "dub"
	case strings.Contains(value, "sub"), strings.Contains(value, "raw"), strings.Contains(value, "softsub"):
		return "sub"
	default:
		return ""
	}
}

func animeKaiCloudflareBlock(body string) bool {
	value := strings.ToLower(body)
	return strings.Contains(value, "cloudflare") ||
		strings.Contains(value, "just a moment") ||
		strings.Contains(value, "attention required") ||
		strings.Contains(value, "cf-turnstile") ||
		strings.Contains(value, "challenge-platform")
}

func animeKaiChallengeError(err error) bool {
	if err == nil {
		return false
	}
	return animeKaiCloudflareBlock(err.Error())
}

func (e *Extension) watchURLForEpisode(episodeID string) string {
	_, watchURL := splitAnimeKaiEpisodeID(episodeID)
	if watchURL != "" {
		return watchURL
	}
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

func composeAnimeKaiEpisodeID(ajaxID, watchURL string) string {
	trimmedID := strings.TrimSpace(ajaxID)
	trimmedWatch := strings.TrimSpace(watchURL)
	if strings.HasPrefix(trimmedWatch, baseURL) {
		trimmedWatch = strings.TrimPrefix(trimmedWatch, baseURL)
	}
	if trimmedID == "" {
		if trimmedWatch == "" {
			return ""
		}
		if strings.HasPrefix(trimmedWatch, "/") {
			return trimmedWatch
		}
		return "/" + strings.TrimPrefix(trimmedWatch, "/")
	}
	if trimmedWatch == "" {
		return trimmedID
	}
	if !strings.HasPrefix(trimmedWatch, "/") {
		trimmedWatch = "/" + strings.TrimPrefix(trimmedWatch, "/")
	}
	return trimmedID + "::" + trimmedWatch
}

func animeKaiEpisodeNumberToken(number float64) string {
	if number <= 0 {
		return ""
	}
	if number == float64(int(number)) {
		return fmt.Sprintf("%d", int(number))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", number), "0"), ".")
}

func normalizeAnimeKaiEpisodesForAnime(episodes []extensions.Episode, animeID string) []extensions.Episode {
	baseWatch := strings.TrimSpace(animeID)
	if baseWatch == "" {
		return episodes
	}
	if strings.HasPrefix(baseWatch, baseURL) {
		baseWatch = strings.TrimPrefix(baseWatch, baseURL)
	}
	if !strings.HasPrefix(baseWatch, "/") {
		baseWatch = "/" + strings.TrimPrefix(baseWatch, "/")
	}

	for i := range episodes {
		ajaxID, _ := splitAnimeKaiEpisodeID(episodes[i].ID)
		epToken := animeKaiEpisodeNumberToken(episodes[i].Number)
		if epToken == "" {
			continue
		}
		episodes[i].ID = composeAnimeKaiEpisodeID(ajaxID, fmt.Sprintf("%s#ep=%s", strings.TrimRight(baseWatch, "/"), epToken))
	}
	return episodes
}

func splitAnimeKaiEpisodeID(value string) (string, string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", ""
	}
	parts := strings.SplitN(trimmed, "::", 2)
	if len(parts) == 2 {
		watchURL := strings.TrimSpace(parts[1])
		if watchURL != "" && !strings.HasPrefix(watchURL, "http://") && !strings.HasPrefix(watchURL, "https://") {
			watchURL = baseURL + watchURL
		}
		return strings.TrimSpace(parts[0]), watchURL
	}
	return trimmed, ""
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

	page, err := browser.Page(proto.TargetCreateTarget{URL: watchURL})
	if err != nil {
		return nil
	}
	defer page.Close()

	deadline := time.Now().Add(14 * time.Second)
	for time.Now().Before(deadline) {
		result, evalErr := page.Eval(`() => new Promise((resolve) => {
			const collect = () => Array.from(document.querySelectorAll(
				'.episode-section a[href*="#ep="], .episode-section a[href*="?ep="], ' +
				'.episode-section .ep-range a, .episode-section [data-ep-id], .episode-section [data-id], ' +
				'.episode-range a[href*="#ep="], .episode-range a[href*="?ep="], ' +
				'.ep-range a[href*="#ep="], .ep-range a[href*="?ep="]'
			)).map((node) => {
				const holder = node.closest('[data-id], [data-ep-id]') || node.parentElement || node
				return {
					href: node.href || holder?.getAttribute?.('href') || '',
					text: (node.textContent || holder?.textContent || '').trim(),
					dataId: node.getAttribute('data-id')
						|| node.getAttribute('data-ep-id')
						|| holder?.getAttribute?.('data-id')
						|| holder?.getAttribute?.('data-ep-id')
						|| '',
				}
			}).filter((item) => item.href || item.dataId)

			const startedAt = Date.now()
			const tick = () => {
				const items = collect()
				if (items.length > 0 || Date.now() - startedAt > 12000) {
					resolve(JSON.stringify(items))
					return
				}
				setTimeout(tick, 350)
			}
			tick()
		})`)
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

		id := composeAnimeKaiEpisodeID(item.DataID, item.Href)
		if id == "" {
			continue
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
	return e.browserStreamSourcesWithMode(episodeURL, true, nil)
}

func (e *Extension) browserStreamSourcesForCandidates(episodeURL string, candidates []animeKaiServerCandidate) ([]extensions.StreamSource, error) {
	return e.browserStreamSourcesWithMode(episodeURL, true, candidates)
}

func (e *Extension) browserStreamSourcesWithMode(episodeURL string, headless bool, candidates []animeKaiServerCandidate) ([]extensions.StreamSource, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("animekai: browser not found for JS player")
	}

	controlURL, err := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(headless).
		Set("disable-gpu").
		Set("autoplay-policy", "no-user-gesture-required").
		Set("disable-blink-features", "AutomationControlled").
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

	// Wait for the episode page to render and let AnimeKai hydrate its player.
	time.Sleep(2200 * time.Millisecond)

	// Strategy A: drive the live player page directly. AnimeKai now hydrates
	// episodes and server controls in the browser, so the most reliable path is
	// to select the requested episode, click a server, trigger playback, and
	// capture the resulting iframe/video URL from the DOM.
	candidateJSON, _ := json.Marshal(candidates)
	domResult, domErr := page.Eval(fmt.Sprintf(`() => new Promise((resolve) => {
		const candidates = %s
		const wait = (ms) => new Promise((done) => setTimeout(done, ms))
		const clickNode = (node) => {
			if (!node) return false
			const target = node.closest?.('button, a, li, [role="tab"], .server, .server-item, .server-tab, span, div') || node
			target.scrollIntoView?.({ block: 'center', inline: 'center' })
			for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
				target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
			}
			if (typeof target.click === 'function') target.click()
			return true
		}
		const queryAll = (selectors) => {
			for (const selector of selectors) {
				const nodes = Array.from(document.querySelectorAll(selector))
				if (nodes.length > 0) return nodes
			}
			return []
		}
		const textOf = (node) => ((node?.textContent || '').trim().toLowerCase())
		const snapshot = () => {
			const iframe = document.querySelector('#player iframe[src], .player-main iframe[src], iframe[src]')
			const video = document.querySelector('#player video, .player-main video, video')
			return {
				iframe: iframe?.src || '',
				video: video?.currentSrc || video?.src || '',
				html: document.documentElement.outerHTML || '',
			}
		}
		const findTabNodes = () => queryAll([
			'#player-server .server-tabs [data-id]',
			'#player-server .server-head [data-id]',
			'#player-server .types [data-id]',
			'.server-tabs [data-id]',
			'.server-head [data-id]',
			'.lang-tabs [data-id]',
			'.types [data-id]',
		]).filter((node) => {
			const text = textOf(node)
			const dataId = (node.getAttribute('data-id') || '').toLowerCase()
			if (node.classList?.contains('server-items') || node.classList?.contains('lang-group')) return false
			return Boolean(dataId) || /sub|dub/.test(text)
		})
		const findGroupNodes = () => queryAll([
			'#player-server .server-items[data-id]',
			'#player-server .lang-group[data-id]',
			'.server-items[data-id]',
			'.lang-group[data-id]',
		])
		const findServerButtons = (groupId = '') => {
			const groups = findGroupNodes()
			const group = groups.find((node) => (node.getAttribute('data-id') || '').toLowerCase() === groupId.toLowerCase())
				|| groups.find((node) => !node.classList?.contains('hidden'))
				|| document
			const holders = new Set()
			for (const node of Array.from(group.querySelectorAll('[data-sv-id], [data-server-id], .server, button, li, span, a, div'))) {
				const holder = node.closest?.('.server, [data-sv-id], [data-server-id], li, button, a, span, div') || node
				if (holder) holders.add(holder)
			}
			return Array.from(holders).filter((node) => {
					if (!node) return false
					if (groups.includes(node)) return false
					const text = textOf(node)
					if (!text) return false
					if (/hard sub|soft sub|dub/.test(text)) return false
					return /server|vid|ok|stream|mp4|hls|filemoon|voe|wish|tape|\b1\b|\b2\b|\b3\b/.test(text)
				})
		}
		const labelTokens = (value) => ((value || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length >= 3)
		const preferredTabs = Array.from(new Set(
			candidates
				.map((candidate) => (candidate.audio || '').toLowerCase())
				.filter(Boolean)
				.concat(['sub', 'softsub', 'dub'])
		))

		;(async () => {
			const epMatch = window.location.href.match(/[?#]ep=(\d+(?:\.\d+)?)/i)
			const targetEp = epMatch?.[1] || ''
			if (targetEp) {
				const episodeNodes = queryAll([
					'.episode-section a[href*="#ep=' + targetEp + '"]',
					'.episode-section a[href*="?ep=' + targetEp + '"]',
					'.episode-section [data-id="' + targetEp + '"]',
					'.episode-section [data-ep-id="' + targetEp + '"]',
				])
				clickNode(episodeNodes[0] || null)
				await wait(900)
			}

			clickNode(document.querySelector('.play-btn, #player .play-btn, .player-main .play-btn'))
			await wait(700)

			const tabNodes = findTabNodes()
			const tabMap = new Map()
			for (const node of tabNodes) {
				const text = textOf(node)
				const dataId = (node.getAttribute('data-id') || '').toLowerCase()
				if (dataId) {
					if (!tabMap.has(dataId)) tabMap.set(dataId, node)
				} else if (text.includes('soft')) {
					if (!tabMap.has('softsub')) tabMap.set('softsub', node)
				} else if (text.includes('dub')) {
					if (!tabMap.has('dub')) tabMap.set('dub', node)
				} else if (text.includes('sub')) {
					if (!tabMap.has('sub')) tabMap.set('sub', node)
				}
			}

			const trySnapshot = async () => {
				clickNode(document.querySelector('.play-btn, #player .play-btn, .player-main .play-btn'))
				await wait(900)
				const shot = snapshot()
				if (shot.iframe || shot.video) {
					resolve(JSON.stringify(shot))
					return true
				}
				return false
			}

			for (const candidate of candidates) {
				const tabKey = (candidate.audio || '').toLowerCase()
				if (tabKey) {
					clickNode(tabMap.get(tabKey) || null)
					await wait(700)
				}
				const serverNodes = findServerButtons(tabKey)
				const exactNode = serverNodes.find((node) => {
					const ids = [
						node.getAttribute('data-sv-id') || '',
						node.getAttribute('data-server-id') || '',
						node.getAttribute('data-id') || '',
						node.closest?.('[data-sv-id]')?.getAttribute?.('data-sv-id') || '',
						node.closest?.('[data-server-id]')?.getAttribute?.('data-server-id') || '',
						node.closest?.('[data-id]')?.getAttribute?.('data-id') || '',
					].map((value) => value.trim()).filter(Boolean)
					if (ids.includes(candidate.id || '')) return true
					const text = textOf(node)
					const tokens = labelTokens(candidate.label)
					return tokens.length > 0 && tokens.every((token) => text.includes(token))
				})
				if (exactNode) {
					clickNode(exactNode)
					if (await trySnapshot()) return
				}
			}

			for (const tabKey of preferredTabs) {
				clickNode(tabMap.get(tabKey) || null)
				await wait(700)
				const serverNodes = findServerButtons(tabKey)
				for (const node of serverNodes.slice(0, 5)) {
					clickNode(node)
					if (await trySnapshot()) return
				}
			}

			const startedAt = Date.now()
			while (Date.now() - startedAt < 12000) {
				clickNode(findServerButtons('')[0] || null)
				if (await trySnapshot()) return
				await wait(350)
			}

			resolve(JSON.stringify(snapshot()))
		})()
	})`, string(candidateJSON)))
	if domErr == nil && domResult.Value.Str() != "" && domResult.Value.Str() != "null" {
		var payload struct {
			Iframe string `json:"iframe"`
			Video  string `json:"video"`
			HTML   string `json:"html"`
		}
		if json.Unmarshal([]byte(domResult.Value.Str()), &payload) == nil {
			resources := []string{}
			if payload.Video != "" {
				resources = append(resources, payload.Video)
			}
			fallbackReferer := firstNonEmptyAnimeKaiURL(payload.Iframe, episodeURL)
			cookieHeader := animeKaiCookieHeader(page, firstNonEmptyAnimeKaiURL(payload.Iframe, fallbackReferer, episodeURL))
			if sources := animekaiStreamCandidates([]string{payload.Iframe}, resources, payload.HTML, fallbackReferer, cookieHeader); len(sources) > 0 {
				return sources, nil
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
	deadline := time.Now().Add(14 * time.Second)
	for time.Now().Before(deadline) {
		captureMu.Lock()
		captured := make([]string, len(capturedURLs))
		copy(captured, capturedURLs)
		captureMu.Unlock()

		if len(captured) > 0 {
			referer := baseURL
			if snapshot, evalErr := page.Eval(`() => {
				const iframe = document.querySelector('#player iframe[src], .player-main iframe[src], iframe[src]')
				return iframe?.src || ''
			}`); evalErr == nil && snapshot.Value.Str() != "" {
				referer = snapshot.Value.Str()
			}
			cookieHeader := animeKaiCookieHeader(page, firstNonEmptyAnimeKaiURL(referer, episodeURL))
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
					Quality:  animeKaiResolvedQuality(u, "unknown"),
					Language: extensions.LangEnglish,
					Referer:  referer,
					Cookie:   cookieHeader,
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
				cookieHeader := animeKaiCookieHeader(page, append(payload.Iframes, episodeURL)...)
				if sources := animekaiStreamCandidates(payload.Iframes, nil, payload.HTML, episodeURL, cookieHeader); len(sources) > 0 {
					return sources, nil
				}
			}
		}

		time.Sleep(250 * time.Millisecond)
	}

	return nil, fmt.Errorf("animekai: no browser-rendered streams for %s", episodeURL)
}

func animekaiStreamCandidates(iframes []string, resources []string, html string, fallbackReferer string, cookieHeader string) []extensions.StreamSource {
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
				Quality:  animeKaiResolvedQuality(resolved.URL, resolved.Quality),
				Language: extensions.LangEnglish,
				Referer:  iframe,
				Cookie:   cookieHeader,
			})
			continue
		}

		if direct := browserResolvedMediaURL(iframe); direct != "" && !seen[direct] {
			seen[direct] = true
			sources = append(sources, extensions.StreamSource{
				URL:      direct,
				Quality:  animeKaiResolvedQuality(direct, "unknown"),
				Language: extensions.LangEnglish,
				Referer:  firstNonEmptyAnimeKaiURL(iframe, fallbackReferer),
				Cookie:   cookieHeader,
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
				Quality:  animeKaiResolvedQuality(resourceURL, "unknown"),
				Language: extensions.LangEnglish,
				Referer:  firstNonEmptyAnimeKaiURL(fallbackReferer, baseURL),
				Cookie:   cookieHeader,
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
					Quality:  animeKaiResolvedQuality(match, "unknown"),
					Language: extensions.LangEnglish,
					Referer:  firstNonEmptyAnimeKaiURL(fallbackReferer, baseURL),
					Cookie:   cookieHeader,
				})
			}
		}
	}

	return sources
}

func animeKaiResolvedQuality(rawURL, quality string) string {
	value := strings.TrimSpace(strings.ToLower(quality))
	if value != "" && value != "unknown" {
		return quality
	}
	lowerURL := strings.ToLower(strings.TrimSpace(rawURL))
	switch {
	case strings.Contains(lowerURL, "1080"):
		return "1080p"
	case strings.Contains(lowerURL, "720"):
		return "720p"
	case strings.Contains(lowerURL, "480"):
		return "480p"
	case strings.Contains(lowerURL, ".m3u8"):
		return "720p"
	case strings.Contains(lowerURL, ".mp4"):
		return "480p"
	default:
		return "unknown"
	}
}

func animeKaiCookieHeader(page *rod.Page, urls ...string) string {
	if page == nil {
		return ""
	}
	targets := make([]string, 0, len(urls))
	seen := map[string]bool{}
	for _, raw := range urls {
		value := absolutizeAnimeKaiURL(raw)
		if value == "" {
			value = firstNonEmptyAnimeKaiURL(raw, baseURL)
		}
		if value == "" || seen[value] {
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

func browserAnimeKaiEmbedSession(watchURL, embedURL, audio string) []extensions.StreamSource {
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

	var capturedURLs []string
	var captureMu sync.Mutex
	go browser.EachEvent(func(e *proto.NetworkResponseReceived) bool {
		u := e.Response.URL
		if strings.Contains(u, ".m3u8") || strings.Contains(u, ".mp4") {
			captureMu.Lock()
			capturedURLs = append(capturedURLs, u)
			captureMu.Unlock()
		}
		return false
	})()

	page, err := browser.Page(proto.TargetCreateTarget{URL: watchURL})
	if err != nil {
		return nil
	}
	defer page.Close()

	time.Sleep(1400 * time.Millisecond)

	if navErr := page.Navigate(embedURL); navErr != nil {
		return nil
	}
	_ = page.WaitLoad()
	time.Sleep(1600 * time.Millisecond)

	shortPage := page.Timeout(1500 * time.Millisecond)
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
	_, _ = page.Eval(`() => { const v = document.querySelector('video'); if (v) v.play(); }`)

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		captureMu.Lock()
		snapshot := make([]string, len(capturedURLs))
		copy(snapshot, capturedURLs)
		captureMu.Unlock()

		seen := map[string]bool{}
		sources := make([]extensions.StreamSource, 0, len(snapshot))
		cookieHeader := animeKaiCookieHeader(page, watchURL, embedURL)
		for _, raw := range snapshot {
			if seen[raw] {
				continue
			}
			seen[raw] = true
			sources = append(sources, extensions.StreamSource{
				URL:      raw,
				Quality:  animeKaiResolvedQuality(raw, "unknown"),
				Language: extensions.LangEnglish,
				Audio:    audio,
				Referer:  embedURL,
				Cookie:   cookieHeader,
			})
		}
		if len(sources) > 0 {
			return sources
		}

		if html, htmlErr := page.HTML(); htmlErr == nil {
			if sources := animekaiStreamCandidates([]string{embedURL}, nil, html, embedURL, animeKaiCookieHeader(page, watchURL, embedURL)); len(sources) > 0 {
				for i := range sources {
					if sources[i].Audio == "" {
						sources[i].Audio = audio
					}
				}
				return sources
			}
		}

		time.Sleep(400 * time.Millisecond)
	}

	return nil
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
		Set("autoplay-policy", "no-user-gesture-required").
		Set("disable-blink-features", "AutomationControlled").
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

func extractAnimeKaiSyncData(body string) (animeKaiSyncData, bool) {
	match := syncDataRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return animeKaiSyncData{}, false
	}

	var payload animeKaiSyncData
	if err := json.Unmarshal([]byte(match[1]), &payload); err != nil {
		return animeKaiSyncData{}, false
	}

	return payload, true
}

func normalizeAnimeKaiText(value string) string {
	value = html.UnescapeString(strings.ToValidUTF8(strings.TrimSpace(value), ""))
	value = strings.ReplaceAll(value, "\u00a0", " ")
	return strings.Join(strings.Fields(value), " ")
}

func firstNonEmptyAnimeKaiURL(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
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
