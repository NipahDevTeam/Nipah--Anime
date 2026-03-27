// Package animeflv implements AnimeSource for AnimeFLV (www3.animeflv.net).
// Uses AnimeFLV's internal JSON API for search — much more reliable than HTML parsing.
package animeflv

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/sourcegraph/conc/pool"

	"miruro/backend/extensions"
	"miruro/backend/logger"
)

var log = logger.For("AnimeFLV")

const (
	baseURL      = "https://www4.animeflv.net"
	searchAPIURL = "https://www4.animeflv.net/api/animes/search?value=%s"
)

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "animeflv-es" }
func (e *Extension) Name() string { return "AnimeFLV (Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — uses AnimeFLV JSON API
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	url := fmt.Sprintf(searchAPIURL, urlEncode(query))
	body, err := FetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animeflv search: %w", err)
	}

	// AnimeFLV API returns: [{"id":"...","title":"...","cover":"...","slug":"..."}]
	var items []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Cover string `json:"cover"`
		Slug  string `json:"slug"`
		Type  string `json:"type"`
	}

	if err := json.Unmarshal([]byte(body), &items); err != nil {
		// API may have changed — fall back to browse page scraping
		return e.searchFallback(query)
	}

	out := make([]extensions.SearchResult, 0, len(items))
	for _, item := range items {
		cover := item.Cover
		if cover != "" && !strings.HasPrefix(cover, "http") {
			cover = baseURL + cover
		}
		slug := item.Slug
		if slug == "" {
			slug = item.ID
		}
		out = append(out, extensions.SearchResult{
			ID:        "/anime/" + slug,
			Title:     item.Title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return out, nil
}

// searchFallback uses the browse page if the API fails
var listAnimesRe = regexp.MustCompile(`var listAnimes\s*=\s*(\[[\s\S]+?\]);`)

func (e *Extension) searchFallback(query string) ([]extensions.SearchResult, error) {
	url := fmt.Sprintf("%s/browse?q=%s", baseURL, urlEncode(query))
	body, err := FetchPage(url, baseURL)
	if err != nil {
		return nil, err
	}

	m := listAnimesRe.FindStringSubmatch(body)
	if len(m) < 2 {
		return nil, nil
	}

	var items []struct {
		Title string `json:"title"`
		Cover string `json:"cover"`
		Link  string `json:"link"`
	}
	if err := json.Unmarshal([]byte(m[1]), &items); err != nil {
		return nil, nil
	}

	out := make([]extensions.SearchResult, 0, len(items))
	for _, item := range items {
		cover := item.Cover
		if cover != "" && !strings.HasPrefix(cover, "http") {
			cover = baseURL + cover
		}
		link := item.Link
		if !strings.HasPrefix(link, "/") {
			link = "/anime/" + link
		}
		out = append(out, extensions.SearchResult{
			ID: link, Title: item.Title, CoverURL: cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes
// ─────────────────────────────────────────────────────────────────────────────

var episodesJSRe = regexp.MustCompile(`var episodes\s*=\s*(\[\[.+?\]\]);`)

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	url := baseURL + animeID
	body, err := FetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animeflv episodes: %w", err)
	}

	m := episodesJSRe.FindStringSubmatch(body)
	if len(m) < 2 {
		return nil, fmt.Errorf("animeflv: episode list not found")
	}

	var raw [][]interface{}
	if err := json.Unmarshal([]byte(m[1]), &raw); err != nil {
		return nil, err
	}

	slug := strings.TrimPrefix(animeID, "/anime/")
	out := make([]extensions.Episode, 0, len(raw))
	for _, ep := range raw {
		if len(ep) < 1 {
			continue
		}
		num, _ := toFloat64(ep[0])
		out = append(out, extensions.Episode{
			ID:     fmt.Sprintf("/ver/%s-%s", slug, formatNum(num)),
			Number: num,
			Title:  fmt.Sprintf("Episodio %s", formatNum(num)),
		})
	}
	// Reverse to ascending order
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams
// ─────────────────────────────────────────────────────────────────────────────

var videosJSRe = regexp.MustCompile(`var videos\s*=\s*(\{.+?\});`)

var animeflvPreferredProvider sync.Map

// providerPriority returns lower numbers for providers that resolve faster
// and more reliably without a browser, so we try them first.
func providerPriority(embedURL string) int {
	switch {
	case strings.Contains(embedURL, "ok.ru"), strings.Contains(embedURL, "odnoklassniki"):
		return 0
	case strings.Contains(embedURL, "yourupload"):
		return 1
	case strings.Contains(embedURL, "mp4upload"):
		return 2
	case strings.Contains(embedURL, "streamtape"):
		return 3
	case strings.Contains(embedURL, "voe"):
		return 4
	case strings.Contains(embedURL, "my.mail.ru"):
		return 5
	case strings.Contains(embedURL, "streamhide"), strings.Contains(embedURL, "streamvid"),
		strings.Contains(embedURL, "guccihide"):
		return 6
	case strings.Contains(embedURL, "streamwish"), strings.Contains(embedURL, "filemoon"):
		return 7 // these may need eval-unpack or browser
	case strings.Contains(embedURL, "hqq.tv"), strings.Contains(embedURL, "netu"):
		return 8
	default:
		return 10
	}
}

func preferredProviderPriority(animeKey string, embedURL string) int {
	base := providerPriority(embedURL)
	if animeKey == "" {
		return base
	}
	if value, ok := animeflvPreferredProvider.Load(animeKey); ok {
		if preferred, ok := value.(string); ok && preferred != "" && strings.Contains(embedURL, preferred) {
			return -1
		}
	}
	return base
}

func animeKeyFromEpisodeID(episodeID string) string {
	value := strings.TrimPrefix(strings.TrimSpace(episodeID), "/ver/")
	if value == "" {
		return ""
	}
	if idx := strings.LastIndex(value, "-"); idx > 0 {
		return value[:idx]
	}
	return value
}

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	url := baseURL + episodeID
	body, err := FetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animeflv stream fetch: %w", err)
	}

	embeds := extractEmbeds(body)
	if len(embeds) == 0 {
		return nil, fmt.Errorf("animeflv: no embeds for %s", episodeID)
	}

	// Sort: fast providers first so we don't wait for a slow browser resolver
	// before trying Streamtape/OkRu/YourUpload which resolve in milliseconds.
	sorted := make([]string, len(embeds))
	copy(sorted, embeds)
	animeKey := animeKeyFromEpisodeID(episodeID)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if preferredProviderPriority(animeKey, sorted[j]) < preferredProviderPriority(animeKey, sorted[i]) {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	// Try the first 3 sorted providers concurrently — fastest win.
	// We cap at 3 to avoid hammering slow browser-based resolvers in parallel.
	type result struct {
		source extensions.StreamSource
		prio   int
	}
	limit := 3
	if len(sorted) < limit {
		limit = len(sorted)
	}

	p := pool.NewWithResults[result]().WithMaxGoroutines(limit)
	for i, embed := range sorted[:limit] {
		embed, prio := embed, i
		p.Go(func() result {
			log.Info().Str("provider", embed).Msg("trying provider")
			resolved, err := ResolvePlayable(embed)
			if err != nil {
				log.Warn().Err(err).Str("provider", embed).Msg("provider failed")
				return result{prio: -1} // sentinel for failed resolution
			}
			log.Info().Str("url", resolved.URL).Msg("resolved")
			return result{
				source: extensions.StreamSource{
					URL:      resolved.URL,
					Quality:  resolved.Quality,
					Language: extensions.LangSpanish,
					Referer:  embed,
				},
				prio: prio,
			}
		})
	}

	// Collect results, filter out failures, sort by priority
	allResults := p.Wait()
	var validResults []result
	for _, r := range allResults {
		if r.prio >= 0 {
			validResults = append(validResults, r)
		}
	}
	sort.Slice(validResults, func(i, j int) bool {
		return validResults[i].prio < validResults[j].prio
	})
	var sources []extensions.StreamSource
	for _, r := range validResults {
		sources = append(sources, r.source)
		if len(sources) >= 1 {
			if animeKey != "" {
				animeflvPreferredProvider.Store(animeKey, r.source.Referer)
			}
			break
		}
	}

	// If parallel batch failed, try remaining providers sequentially
	if len(sources) == 0 {
		for _, embed := range sorted[limit:] {
			resolved, err := ResolvePlayable(embed)
			if err != nil {
				continue
			}
			source := extensions.StreamSource{
				URL:      resolved.URL,
				Quality:  resolved.Quality,
				Language: extensions.LangSpanish,
				Referer:  embed,
			}
			sources = append(sources, source)
			if animeKey != "" {
				animeflvPreferredProvider.Store(animeKey, source.Referer)
			}
			break
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animeflv: all resolvers failed for %s", episodeID)
	}
	return sources, nil
}

var iframeSrcRe = regexp.MustCompile(`<iframe[^>]+src="(https?://[^"]+)"`)

func extractEmbeds(html string) []string {
	var out []string
	seen := map[string]bool{}

	if m := videosJSRe.FindStringSubmatch(html); len(m) >= 2 {
		var data map[string][]struct {
			Server string `json:"server"`
			URL    string `json:"url"`
			Code   string `json:"code"`
		}
		if err := json.Unmarshal([]byte(m[1]), &data); err == nil {
			for _, key := range []string{"SUB", "DUB"} {
				for _, entry := range data[key] {
					// Prefer Code (direct embed URL) over URL (tracking redirect)
					u := entry.Code
					if u == "" {
						u = entry.URL
					}
					if u != "" && !seen[u] {
						seen[u] = true
						out = append(out, u)
					}
				}
			}
		}
	}
	for _, m := range iframeSrcRe.FindAllStringSubmatch(html, 10) {
		if len(m) >= 2 && !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func formatNum(n float64) string {
	if n == float64(int(n)) {
		return strconv.Itoa(int(n))
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}

func toFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
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

var tagRe = regexp.MustCompile(`<[^>]+>`)

func stripTags(s string) string {
	return strings.TrimSpace(tagRe.ReplaceAllString(s, ""))
}
