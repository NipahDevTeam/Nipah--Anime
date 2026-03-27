// Package animeheaven implements AnimeSource for AnimeHeaven (animeheaven.me).
// Uses AnimeHeaven's AJAX fast-search for search, and HTML scraping for
// episode listing and stream extraction.
//
// NOTE: This extension was built from structural analysis of the site.
// If the site updates its HTML layout, the regexes here may need adjustment.
package animeheaven

import (
	"fmt"
	"html"
	"regexp"
	"strings"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/logger"
)

var log = logger.For("AnimeHeaven")

const baseURL = "https://animeheaven.me"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "animeheaven-en" }
func (e *Extension) Name() string { return "AnimeHeaven (English)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — uses AnimeHeaven's AJAX fast-search endpoint
// GET /fastsearch.php?xhr=1&s={query} → HTML
//
// Response structure:
//   <a href="/anime.php?{id}"><img src="/image.php?{id}">Title</a>
// ─────────────────────────────────────────────────────────────────────────────

var searchCardRe = regexp.MustCompile(`<a href=['"]anime\.php\?([a-zA-Z0-9]+)['"]>\s*<img[^>]+src=['"]image\.php\?([^"'&]+)[^>]+alt=['"]([^'"]+)['"][^>]*>\s*</a>\s*<div class=['"]similarname c['"]>\s*<a href=['"]anime\.php\?[a-zA-Z0-9]+['"][^>]*>([^<]+)</a>`)

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	// Strategy 1: AJAX fast-search (returns HTML fragment)
	url := fmt.Sprintf("%s/fastsearch.php?xhr=1&s=%s", baseURL, urlEncode(query))
	body, err := fetchAJAX(url, baseURL)
	if err != nil {
		log.Warn().Err(err).Msg("AJAX search failed")
		body = "" // fall through to full-page search
	}

	results := parseSearchHTML(body)

	// Strategy 2: full search page if AJAX returned nothing
	if len(results) == 0 {
		fullURL := fmt.Sprintf("%s/search.php?s=%s", baseURL, urlEncode(query))
		fullBody, err := fetchPage(fullURL, baseURL)
		if err != nil {
			log.Warn().Err(err).Msg("full search failed")
			return nil, nil
		}
		results = parseSearchHTML(fullBody)
	}

	return results, nil
}

func parseSearchHTML(body string) []extensions.SearchResult {
	var results []extensions.SearchResult
	seen := map[string]bool{}

	for _, m := range searchCardRe.FindAllStringSubmatch(body, 60) {
		if len(m) < 5 || seen[m[1]] {
			continue
		}
		id := m[1]
		seen[id] = true

		cover := fmt.Sprintf("%s/image.php?%s", baseURL, m[2])
		title := strings.TrimSpace(html.UnescapeString(m[4]))
		if title == "" {
			title = strings.TrimSpace(html.UnescapeString(m[3]))
		}
		if title == "" {
			continue
		}

		results = append(results, extensions.SearchResult{
			ID:        id,
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangEnglish},
		})
	}
	return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — scrapes /anime.php?{id}
//
// AnimeHeaven episode links appear as:
//   <a href="/watch.php?{animeId}&ep={num}">
// ─────────────────────────────────────────────────────────────────────────────

var epLinkRe = regexp.MustCompile(`onclick=['"]gatea\("([a-f0-9]+)"\)['"][^>]*id=["'][a-f0-9]+["'][^>]*>[\s\S]*?<div class=['"]\s*watch2 bc['"]>\s*(\d+)`)
var epCountRe = regexp.MustCompile(`(?i)(\d+)\s*episodes?`)

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	url := fmt.Sprintf("%s/anime.php?%s", baseURL, animeID)
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("animeheaven episodes: %w", err)
	}

	seen := map[int]bool{}
	var episodes []extensions.Episode

	for _, m := range epLinkRe.FindAllStringSubmatch(body, 1000) {
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
			ID:     m[1],
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
		return nil, fmt.Errorf("animeheaven: no episodes found for %s", animeID)
	}
	return episodes, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams — scrapes /watch.php?{animeId}&ep={num}
//
// Looks for:
//   1. <iframe src="https://..."> embeds — resolved via animeflv.Resolve
//   2. Direct .m3u8 or .mp4 URLs in the page source
// ─────────────────────────────────────────────────────────────────────────────

var iframeRe = regexp.MustCompile(`<iframe[^>]+src="(https?://[^"]+)"`)
var directM3U8Re = regexp.MustCompile(`(https?://[^\s"'<>]+\.m3u8[^\s"'<>]*)`)
var directMp4Re = regexp.MustCompile(`(https?://[^\s"'<>]+\.mp4[^\s"'<>]*)`)

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	url := fmt.Sprintf("%s/gate.php", baseURL)
	body, err := fetchGatePage(url, episodeID)
	if err != nil {
		return nil, fmt.Errorf("animeheaven stream fetch: %w", err)
	}

	// Collect embed URLs
	var embeds []string
	seen := map[string]bool{}
	for _, m := range iframeRe.FindAllStringSubmatch(body, 20) {
		if len(m) >= 2 && !seen[m[1]] {
			seen[m[1]] = true
			embeds = append(embeds, m[1])
		}
	}

	var sources []extensions.StreamSource

	// Resolve embeds through animeflv resolver library
	for _, embed := range embeds {
		resolved, err := animeflv.Resolve(embed)
		if err != nil {
			continue
		}
		sources = append(sources, extensions.StreamSource{
			URL:      resolved.URL,
			Quality:  resolved.Quality,
			Language: extensions.LangEnglish,
			Referer:  url,
		})
	}

	// Fallback: direct URLs in page source (some older AnimeHeaven pages)
	if len(sources) == 0 {
		if m := directM3U8Re.FindString(body); m != "" {
			sources = append(sources, extensions.StreamSource{
				URL: m, Quality: "unknown", Language: extensions.LangEnglish, Referer: url,
			})
		} else if m := directMp4Re.FindString(body); m != "" {
			sources = append(sources, extensions.StreamSource{
				URL: m, Quality: "unknown", Language: extensions.LangEnglish, Referer: url,
			})
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animeheaven: no streams found for %s", episodeID)
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
		"Cache-Control":             "max-age=0",
	})
}

// fetchAJAX is used for AJAX endpoints like fastsearch.php which require
// the X-Requested-With header to return the HTML fragment rather than a full page.
func fetchAJAX(url, referer string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, referer, map[string]string{
		"Accept":           "text/html, */*; q=0.01",
		"Accept-Language":  "en-US,en;q=0.9",
		"X-Requested-With": "XMLHttpRequest",
	})
}

func fetchGatePage(url, episodeKey string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, baseURL, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "en-US,en;q=0.9",
		"Upgrade-Insecure-Requests": "1",
		"Cookie":                    "key=" + episodeKey,
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
