// Package lectormanga implements MangaSource for LectorManga (lectormangaa.com).
// The largest Spanish-language manga site with 100M+ monthly visits.
// URL structure: /biblioteca/SLUG/ for manga, /biblioteca/SLUG/capitulo-N/ for chapters.
package lectormanga

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/logger"
)

var log = logger.For("LectorManga")

const baseURL = "https://lectormangaa.com"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "lectormanga-es" }
func (e *Extension) Name() string { return "LectorManga (Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — WordPress ?s= search endpoint
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	// LectorManga uses WordPress search
	url := fmt.Sprintf("%s/?s=%s", baseURL, urlEncode(query))
	body, err := fetchLM(url)
	if err != nil {
		return nil, fmt.Errorf("lectormanga search: %w", err)
	}
	log.Debug().Int("bytes", len(body)).Msg("Search response")
	// Debug: show first href with biblioteca
	if idx := strings.Index(body, "biblioteca"); idx != -1 {
		start := max(0, idx-50)
		end := min(len(body), idx+100)
		log.Debug().Str("sample", body[start:end]).Msg("Sample href")
	} else {
		log.Debug().Msg("No 'biblioteca' found in response")
		// Show a snippet to understand structure
		if len(body) > 500 {
			log.Debug().Str("snippet", body[:500]).Msg("Body snippet")
		}
	}
	results := parseSearchResults(body)
	log.Info().Int("count", len(results)).Msg("Parsed results")
	return results, nil
}

var (
	// Manga cards: <article ...><a href="/biblioteca/SLUG/">
	searchCardRe = regexp.MustCompile(`href="(https://lectormangaa\.com/biblioteca/[^"]+/)"`)
	// Cover image: <img ... src="URL" alt="TITLE"
	coverRe = regexp.MustCompile(`<img[^>]+src="(https://[^"]+)"[^>]+alt="([^"]+)"`)
	// Title from heading inside card
	titleRe = regexp.MustCompile(`<h\d[^>]*class="[^"]*titulo[^"]*"[^>]*>([^<]+)</h`)
)

func parseSearchResults(html string) []extensions.SearchResult {
	var out []extensions.SearchResult
	seen := map[string]bool{}

	links := searchCardRe.FindAllStringSubmatch(html, 30)
	for _, m := range links {
		href := m[1]
		slug := strings.TrimPrefix(href, baseURL+"/biblioteca/")
		slug = strings.TrimSuffix(slug, "/")

		if seen[slug] || slug == "" || strings.Contains(slug, "/") {
			continue
		}
		seen[slug] = true

		// Extract title and cover from the surrounding HTML context
		idx := strings.Index(html, href)
		if idx == -1 {
			continue
		}
		chunk := html[max(0, idx-200):min(len(html), idx+600)]

		title := slugToTitle(slug)
		cover := ""

		if m2 := titleRe.FindStringSubmatch(chunk); len(m2) >= 2 {
			title = strings.TrimSpace(m2[1])
		}
		if m2 := coverRe.FindStringSubmatch(chunk); len(m2) >= 2 {
			cover = m2[1]
		}

		out = append(out, extensions.SearchResult{
			ID:        "/biblioteca/" + slug + "/",
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapters — parse manga page for chapter list
// ─────────────────────────────────────────────────────────────────────────────

var (
	// Chapter links: /biblioteca/SLUG/capitulo-N/
	chapterLinkRe = regexp.MustCompile(`href="(https://lectormangaa\.com/biblioteca/[^"]+/capitulo-([^/]+)/)"`)
	// Chapter count from JSON embedded in page
	chapCountJSONRe = regexp.MustCompile(`"numberOfPages"\s*:\s*(\d+)`)
)

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	url := baseURL + mangaID
	body, err := fetchLM(url)
	if err != nil {
		return nil, fmt.Errorf("lectormanga chapters: %w", err)
	}
	return parseChapters(body, mangaID), nil
}

func parseChapters(html, mangaID string) []extensions.Chapter {
	slug := strings.TrimPrefix(mangaID, "/biblioteca/")
	slug = strings.TrimSuffix(slug, "/")

	matches := chapterLinkRe.FindAllStringSubmatch(html, -1)
	seen := map[string]bool{}
	var out []extensions.Chapter

	for _, m := range matches {
		numStr := m[2]
		if seen[numStr] {
			continue
		}
		seen[numStr] = true

		var num float64
		if _, err := fmt.Sscanf(numStr, "%f", &num); err != nil {
			num = 0
		}

		out = append(out, extensions.Chapter{
			ID:     "/biblioteca/" + slug + "/capitulo-" + numStr + "/",
			Number: num,
			Title:  fmt.Sprintf("Capítulo %s", numStr),
		})
	}

	// Sort ascending by chapter number
	for i := 0; i < len(out)-1; i++ {
		for j := i + 1; j < len(out); j++ {
			if out[i].Number > out[j].Number {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages — extract image URLs from chapter page
// ─────────────────────────────────────────────────────────────────────────────

var (
	// Pages often embedded as JS array or JSON
	pagesJSRe  = regexp.MustCompile(`pages\s*=\s*(\[[\s\S]+?\])`)
	pageImgRe  = regexp.MustCompile(`<img[^>]+class="[^"]*chapter[^"]*"[^>]+src="(https?://[^"]+)"`)
	pageImgRe2 = regexp.MustCompile(`data-src="(https?://[^"]+\.(?:jpg|png|webp|jpeg))"`)
	pageJSONRe = regexp.MustCompile(`"url"\s*:\s*"(https?://[^"]+)"`)
)

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	url := baseURL + chapterID
	body, err := fetchLM(url)
	if err != nil {
		return nil, fmt.Errorf("lectormanga pages: %w", err)
	}

	var pages []extensions.PageSource

	// Try JS pages array first
	if m := pagesJSRe.FindStringSubmatch(body); len(m) >= 2 {
		var urls []string
		// Try as JSON array of strings
		if err := json.Unmarshal([]byte(m[1]), &urls); err == nil {
			for i, u := range urls {
				if strings.HasPrefix(u, "http") {
					pages = append(pages, extensions.PageSource{
						Index: i,
						URL:   u,
					})
				}
			}
			if len(pages) > 0 {
				return pages, nil
			}
		}
		// Try as JSON array of objects with "url" field
		for _, u := range pageJSONRe.FindAllStringSubmatch(m[1], -1) {
			if strings.HasPrefix(u[1], "http") {
				pages = append(pages, extensions.PageSource{
					Index: len(pages),
					URL:   u[1],
				})
			}
		}
		if len(pages) > 0 {
			return pages, nil
		}
	}

	// Fallback: data-src lazy loading images
	seen := map[string]bool{}
	for _, m := range pageImgRe2.FindAllStringSubmatch(body, -1) {
		u := m[1]
		if !seen[u] {
			seen[u] = true
			pages = append(pages, extensions.PageSource{Index: len(pages), URL: u})
		}
	}
	if len(pages) > 0 {
		return pages, nil
	}

	// Final fallback: img tags with chapter class
	for _, m := range pageImgRe.FindAllStringSubmatch(body, -1) {
		u := m[1]
		if !seen[u] {
			seen[u] = true
			pages = append(pages, extensions.PageSource{Index: len(pages), URL: u})
		}
	}

	if len(pages) == 0 {
		return nil, fmt.Errorf("lectormanga: no pages found for %s", chapterID)
	}
	return pages, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper — full browser headers to bypass 403
// ─────────────────────────────────────────────────────────────────────────────

func fetchLM(url string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, baseURL, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
		"Accept-Language":           "es-419,es;q=0.9,en;q=0.8",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "none",
		"Cache-Control":             "max-age=0",
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func slugToTitle(slug string) string {
	words := strings.Split(slug, "-")
	for i, w := range words {
		if i == 0 && len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
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

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
