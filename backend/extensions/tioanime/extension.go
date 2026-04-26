// Package tioanime implements the AnimeSource interface for TioAnime (tioanime.com).
// TioAnime focuses on sub-español content with a clean, stable site structure.
package tioanime

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/logger"
)

var log = logger.For("TioAnime")

const baseURL = "https://tioanime.com"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "tioanime-es" }
func (e *Extension) Name() string { return "TioAnime (Sub Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// TioAnime has a JSON search API at /api/search?title=
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	apiURL := fmt.Sprintf("%s/directorio?q=%s", baseURL, urlEncode(query))
	body, err := fetchPage(apiURL, baseURL)
	if err != nil {
		// Return empty rather than error — don't block other sources
		log.Error().Err(err).Msg("Search failed")
		return nil, nil
	}
	results := parseResults(body)
	return results, nil
}

// TioAnime may embed results as a JS variable or serve plain HTML cards.
// We try both strategies; the HTML fallback handles their current structure:
//   <li><a href="/anime/slug"><img src="..."><h3>Title</h3></a></li>
var jsonRe = regexp.MustCompile(`var animes\s*=\s*(\[[\s\S]+?\]);`)

func parseResults(html string) []extensions.SearchResult {
	// Strategy 1: embedded JSON variable (older TioAnime builds)
	if m := jsonRe.FindStringSubmatch(html); len(m) >= 2 {
		var items []struct {
			Slug  string `json:"slug"`
			Title string `json:"title"`
			Cover string `json:"cover"`
		}
		if err := json.Unmarshal([]byte(m[1]), &items); err == nil && len(items) > 0 {
			out := make([]extensions.SearchResult, 0, len(items))
			for _, item := range items {
				cover := item.Cover
				if strings.HasPrefix(cover, "/") {
					cover = baseURL + cover
				}
				out = append(out, extensions.SearchResult{
					ID:        "/anime/" + item.Slug,
					Title:     item.Title,
					CoverURL:  cover,
					Languages: []extensions.Language{extensions.LangSpanish},
				})
			}
			return out
		}
	}

	// Strategy 2: HTML card parsing — current TioAnime structure:
	//   <a href="/anime/slug">...<img src="...">...<h3>Title</h3>...
	// Works for both <li> and <article> wrappers.
	cardRe := regexp.MustCompile(
		`href="(/anime/[^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)</h3>`,
	)
	var out []extensions.SearchResult
	seen := map[string]bool{}
	for _, m := range cardRe.FindAllStringSubmatch(html, 30) {
		if len(m) < 4 || seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		cover := m[2]
		if strings.HasPrefix(cover, "/") {
			cover = baseURL + cover
		}
		out = append(out, extensions.SearchResult{
			ID: m[1], Title: strings.TrimSpace(m[3]), CoverURL: cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes
// TioAnime stores episode list as JS array: var episodes = [1,2,3,...,n];
// Episode URLs: /ver/anime-slug-1, /ver/anime-slug-2, etc.
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	url := baseURL + animeID
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("tioanime episodes: %w", err)
	}
	return parseEpisodes(body, animeID), nil
}

var epListRe = regexp.MustCompile(`var episodes\s*=\s*(\[[^\]]+\])`)

func parseEpisodes(html, animeSlug string) []extensions.Episode {
	slug := strings.TrimPrefix(animeSlug, "/anime/")

	if m := epListRe.FindStringSubmatch(html); len(m) >= 2 {
		var nums []int
		if err := json.Unmarshal([]byte(m[1]), &nums); err == nil {
			out := make([]extensions.Episode, 0, len(nums))
			for _, n := range nums {
				out = append(out, extensions.Episode{
					ID:     fmt.Sprintf("/ver/%s-%d", slug, n),
					Number: float64(n),
					Title:  fmt.Sprintf("Episodio %d", n),
				})
			}
			return out
		}
	}

	// Fallback: count from page
	countRe := regexp.MustCompile(`<span[^>]*class="[^"]*chapters[^"]*"[^>]*>(\d+)`)
	total := 0
	if m := countRe.FindStringSubmatch(html); len(m) >= 2 {
		if _, err := fmt.Sscanf(m[1], "%d", &total); err != nil {
			total = 0
		}
	}
	if total == 0 {
		return nil
	}
	out := make([]extensions.Episode, 0, total)
	for i := 1; i <= total; i++ {
		out = append(out, extensions.Episode{
			ID:     fmt.Sprintf("/ver/%s-%d", slug, i),
			Number: float64(i),
			Title:  fmt.Sprintf("Episodio %d", i),
		})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams
// TioAnime embeds servers as JSON: var videos = [["streamtape","https://..."],...];
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	url := baseURL + episodeID
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("tioanime stream fetch: %w", err)
	}

	embeds := extractEmbeds(body)
	if len(embeds) == 0 {
		return nil, fmt.Errorf("tioanime: no embeds for %s", episodeID)
	}

	var sources []extensions.StreamSource
	for _, embed := range embeds {
		resolved, err := animeflv.Resolve(embed)
		if err != nil {
			continue
		}
		sources = append(sources, extensions.StreamSource{
			URL: resolved.URL, Quality: resolved.Quality,
			Language: extensions.LangSpanish,
		})
	}
	if len(sources) == 0 {
		return nil, fmt.Errorf("tioanime: all resolvers failed for %s", episodeID)
	}
	return sources, nil
}

// TioAnime stores videos as: var videos = [["server","url"],...]
var videosRe = regexp.MustCompile(`var videos\s*=\s*(\[[\s\S]+?\]);`)
var iframeRe = regexp.MustCompile(`<iframe[^>]+src="(https?://[^"]+)"`)

func extractEmbeds(html string) []string {
	var out []string
	seen := map[string]bool{}

	if m := videosRe.FindStringSubmatch(html); len(m) >= 2 {
		var rows [][]string
		if err := json.Unmarshal([]byte(m[1]), &rows); err == nil {
			for _, row := range rows {
				if len(row) >= 2 && !seen[row[1]] {
					seen[row[1]] = true
					out = append(out, row[1])
				}
			}
		}
	}
	for _, m := range iframeRe.FindAllStringSubmatch(html, 10) {
		if len(m) >= 2 && !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

func fetchPage(url, referer string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, referer, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "es-419,es;q=0.9,en;q=0.8",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "none",
		"Cache-Control":             "max-age=0",
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
