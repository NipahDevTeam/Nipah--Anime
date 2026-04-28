// Package animeav1 implements AnimeSource for AnimeAV1 (animeav1.com).
// AnimeAV1 is a SvelteKit SSR application. All data is embedded server-side
// in a script tag; the ?__data.json suffix returns the same data as clean JSON
// which we can regex-parse without running JavaScript.
//
// URL patterns:
//
//	Search  : /catalogo?search={query}&__data.json
//	Anime   : /media/{slug}?__data.json
//	Episode : /media/{slug}/{num}?__data.json
package animeav1

import (
	"fmt"
	"html"
	"regexp"
	"sort"
	"strings"

	"github.com/sourcegraph/conc/pool"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/logger"
)

var log = logger.For("AnimeAV1")

const baseURL = "https://animeav1.com"
const cdnURL = "https://cdn.animeav1.com"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "animeav1-es" }
func (e *Extension) Name() string { return "AnimeAV1 (Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — GET /catalogo?search={query}
//
// AnimeAV1 now returns full SSR HTML, with both visible cards and Svelte
// hydration data embedded in the page. The visible cards are the most stable
// contract, so we parse those first.
// ─────────────────────────────────────────────────────────────────────────────

var av1CardBlockRe = regexp.MustCompile(`<article\b[\s\S]*?</article>`)
var av1HrefRe = regexp.MustCompile(`href="/media/([^"]+)"`)
var av1CardTitleRe = regexp.MustCompile(`<h3[^>]*>([^<]+)</h3>`)
var av1CoverRe = regexp.MustCompile(`src="(https://cdn\.animeav1\.com/covers/\d+\.jpg)"`)
var av1HydratedRe = regexp.MustCompile(`results:\[(.*?)\],total:`)
var av1HydratedItemRe = regexp.MustCompile(`\{id:"(\d+)",title:"([^"]+)"[\s\S]*?slug:"([^"]+)"`)
var av1FallbackAnchorRe = regexp.MustCompile(`(?is)<a[^>]+href="/media/([^"]+)"[^>]*>(.*?)</a>`)
var av1FallbackTitleAttrRe = regexp.MustCompile(`(?i)(?:alt|title|data-title)="([^"]+)"`)
var av1FallbackCoverRe = regexp.MustCompile(`(?i)src="(https?://[^"]+)"`)

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	url := fmt.Sprintf("%s/catalogo?search=%s", baseURL, urlEncode(query))
	body, err := fetchJSON(url)
	if err != nil {
		return nil, fmt.Errorf("animeav1 search: %w", err)
	}

	return parseSearchData(body), nil
}

func parseSearchData(body string) []extensions.SearchResult {
	var results []extensions.SearchResult
	seen := map[string]bool{}

	for _, block := range av1CardBlockRe.FindAllString(body, 80) {
		hrefMatch := av1HrefRe.FindStringSubmatch(block)
		titleMatch := av1CardTitleRe.FindStringSubmatch(block)
		if len(hrefMatch) < 2 || len(titleMatch) < 2 || seen[hrefMatch[1]] {
			continue
		}
		seen[hrefMatch[1]] = true

		cover := ""
		if coverMatch := av1CoverRe.FindStringSubmatch(block); len(coverMatch) >= 2 {
			cover = coverMatch[1]
		}

		results = append(results, extensions.SearchResult{
			ID:        "/media/" + hrefMatch[1],
			Title:     strings.TrimSpace(titleMatch[1]),
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	if len(results) > 0 {
		return results
	}

	// Fallback to the embedded Svelte hydration payload if card markup changes.
	for _, payload := range av1HydratedRe.FindAllStringSubmatch(body, 4) {
		if len(payload) < 2 {
			continue
		}
		for _, item := range av1HydratedItemRe.FindAllStringSubmatch(payload[1], 80) {
			if len(item) < 4 || seen[item[3]] {
				continue
			}
			seen[item[3]] = true
			results = append(results, extensions.SearchResult{
				ID:        "/media/" + item[3],
				Title:     item[2],
				CoverURL:  fmt.Sprintf("%s/covers/%s.jpg", cdnURL, item[1]),
				Languages: []extensions.Language{extensions.LangSpanish},
			})
		}
	}

	for _, anchor := range av1FallbackAnchorRe.FindAllStringSubmatch(body, 120) {
		if len(anchor) < 3 || seen[anchor[1]] {
			continue
		}
		title := ""
		if titleMatch := av1FallbackTitleAttrRe.FindStringSubmatch(anchor[2]); len(titleMatch) >= 2 {
			title = strings.TrimSpace(html.UnescapeString(titleMatch[1]))
		}
		if title == "" {
			continue
		}
		seen[anchor[1]] = true
		cover := ""
		if coverMatch := av1FallbackCoverRe.FindStringSubmatch(anchor[2]); len(coverMatch) >= 2 {
			cover = coverMatch[1]
		}
		results = append(results, extensions.SearchResult{
			ID:        "/media/" + anchor[1],
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — GET /media/{slug}?__data.json
//
// The payload contains an episodes array: [{id:2623,number:1},{id:2624,number:2}...]
// We extract episode numbers from it.
// ─────────────────────────────────────────────────────────────────────────────

var av1EpisodeHrefRe = regexp.MustCompile(`href="/media/[^"/]+/(\d+(?:\.\d+)?)"`)

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	url := fmt.Sprintf("%s%s", baseURL, animeID)
	body, err := fetchJSON(url)
	if err != nil {
		return nil, fmt.Errorf("animeav1 episodes: %w", err)
	}

	slug := strings.TrimPrefix(animeID, "/media/")
	return parseEpisodes(body, slug), nil
}

func parseEpisodes(body, slug string) []extensions.Episode {
	var episodes []extensions.Episode
	seen := map[float64]bool{}

	for _, match := range av1EpisodeHrefRe.FindAllStringSubmatch(body, 2000) {
		if len(match) < 2 {
			continue
		}
		var num float64
		if _, err := fmt.Sscanf(match[1], "%f", &num); err != nil {
			num = 0
		}
		if num <= 0 || seen[num] {
			continue
		}
		seen[num] = true

		label := formatEpisodeNumber(num)
		episodes = append(episodes, extensions.Episode{
			ID:     fmt.Sprintf("/media/%s/%s", slug, label),
			Number: num,
			Title:  fmt.Sprintf("Episodio %s", label),
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
		return nil
	}
	return episodes
}

func formatEpisodeNumber(num float64) string {
	if num == float64(int(num)) {
		return fmt.Sprintf("%d", int(num))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", num), "0"), ".")
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams — GET /media/{slug}/{num}?__data.json
//
// The payload has an embeds object keyed by type (DUB/SUB) and server name:
//   embeds:{DUB:{StreamTape:"https://streamtape.com/e/...",HLS:"https://player.zilla-networks.com/..."},...}
//
// We try StreamTape first (already supported by resolvers.go), then fall back
// to MP4Upload. HLS/Zilla and others require JS execution so we skip them.
// ─────────────────────────────────────────────────────────────────────────────

// AnimeAV1's __data.json uses SvelteKit's unquoted-key JS object notation:
//
//	{server:"HLS",url:"https://player.zilla-networks.com/..."}
//
// Standard JSON regexes ("key":"value") will NOT match — we must use bare-key patterns.
var av1EmbedUrlRe = regexp.MustCompile(`url:"(https?://[^"]+)"`)
var av1EmbedSectionRe = regexp.MustCompile(`([A-Z]+):\{`)

// av1InternalRe matches AnimeAV1's own cdn/internal URLs that can't be resolved externally.
// animeav1.uns.bio is their custom UPNShare domain (JS hash-based player, not resolvable).
var av1InternalRe = regexp.MustCompile(`animeav1\.com|animeav1\.uns\.bio`)

// av1SlowPlayerRe matches JS-heavy embed players that always require a browser
// and take 15+ seconds without reliably succeeding. We try these last.
// mega.nz requires their JS SDK and can't be resolved by our browser fallback either.
var av1SlowPlayerRe = regexp.MustCompile(`player\.zilla-networks\.com|pixeldrain\.com|1fichier\.com|mega\.nz`)

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	// episodeID is "/media/{slug}/{num}"
	url := fmt.Sprintf("%s%s?__data.json", baseURL, episodeID)
	body, err := fetchJSON(url)
	if err != nil {
		return nil, fmt.Errorf("animeav1 stream fetch: %w", err)
	}

	var sources []extensions.StreamSource
	seen := map[string]bool{}

	// Collect embed URLs with explicit language priority.
	// AnimeAV1 often exposes DUB first in the page object, but we want
	// SUB/original-first behavior in the app.
	var fastCandidates, slowCandidates []embedCandidate
	for _, candidate := range collectEmbedCandidates(body) {
		u := candidate.url
		if seen[u] || av1InternalRe.MatchString(u) {
			continue
		}
		seen[u] = true
		if av1SlowPlayerRe.MatchString(u) {
			slowCandidates = append(slowCandidates, candidate)
		} else {
			fastCandidates = append(fastCandidates, candidate)
		}
	}

	// Try all fast candidates concurrently — first 2 winners are used.
	type resolveResult struct {
		source extensions.StreamSource
		ok     bool
	}
	maxFast := len(fastCandidates)
	if maxFast == 0 {
		maxFast = 1
	}
	p := pool.NewWithResults[resolveResult]().WithMaxGoroutines(maxFast)
	for _, candidate := range fastCandidates {
		candidate := candidate
		p.Go(func() resolveResult {
			log.Info().Str("embed", candidate.url).Str("track", candidate.track).Msg("trying embed")
			resolved, err := animeflv.Resolve(candidate.url)
			if err != nil {
				log.Error().Err(err).Str("embed", candidate.url).Str("track", candidate.track).Msg("failed to resolve embed")
				return resolveResult{}
			}
			log.Info().Str("url", resolved.URL).Msg("resolved embed")
			return resolveResult{
				source: extensions.StreamSource{
					URL:      resolved.URL,
					Quality:  resolved.Quality,
					Language: extensions.LangSpanish,
					Audio:    embedTrackAudio(candidate.track),
					Referer:  candidate.url,
				},
				ok: true,
			}
		})
	}
	for _, r := range p.Wait() {
		if r.ok {
			sources = append(sources, r.source)
			if len(sources) >= 2 {
				break
			}
		}
	}

	// Slow candidates: sequential, browser allowed, last resort
	if len(sources) == 0 {
		for _, candidate := range slowCandidates {
			log.Info().Str("embed", candidate.url).Str("track", candidate.track).Msg("trying slow embed")
			resolved, err := animeflv.Resolve(candidate.url)
			if err != nil {
				resolved, err = animeflv.BrowserResolveMedia(candidate.url)
			}
			if err != nil {
				log.Error().Err(err).Str("embed", candidate.url).Str("track", candidate.track).Msg("failed to resolve slow embed")
				continue
			}
			log.Info().Str("url", resolved.URL).Msg("resolved slow embed")
			sources = append(sources, extensions.StreamSource{
				URL:      resolved.URL,
				Quality:  resolved.Quality,
				Language: extensions.LangSpanish,
				Audio:    embedTrackAudio(candidate.track),
				Referer:  candidate.url,
			})
			if len(sources) >= 2 {
				break
			}
		}
	}

	if len(sources) == 0 {
		return nil, fmt.Errorf("animeav1: no streams resolved for %s", episodeID)
	}
	return sources, nil
}

type embedCandidate struct {
	url   string
	track string
}

func collectEmbedCandidates(body string) []embedCandidate {
	embedsBody := extractEmbedsObject(body)
	if embedsBody == "" {
		return extractFallbackCandidates(body)
	}

	sections := parseEmbedSections(embedsBody)
	order := make([]string, 0, len(sections))
	for key := range sections {
		order = append(order, key)
	}
	sort.SliceStable(order, func(i, j int) bool {
		return embedTrackRank(order[i]) < embedTrackRank(order[j])
	})

	var out []embedCandidate
	for _, track := range order {
		for _, m := range av1EmbedUrlRe.FindAllStringSubmatch(sections[track], 12) {
			if len(m) < 2 {
				continue
			}
			out = append(out, embedCandidate{url: m[1], track: track})
		}
	}
	if len(out) > 0 {
		return out
	}
	return extractFallbackCandidates(body)
}

func extractFallbackCandidates(body string) []embedCandidate {
	var out []embedCandidate
	for _, m := range av1EmbedUrlRe.FindAllStringSubmatch(body, 40) {
		if len(m) < 2 {
			continue
		}
		out = append(out, embedCandidate{url: m[1], track: "UNKNOWN"})
	}
	return out
}

func extractEmbedsObject(body string) string {
	start := strings.Index(body, "embeds:{")
	if start == -1 {
		return ""
	}
	start += len("embeds:")
	if start >= len(body) || body[start] != '{' {
		return ""
	}
	end := matchClosingBrace(body, start)
	if end == -1 {
		return ""
	}
	return body[start+1 : end]
}

func parseEmbedSections(body string) map[string]string {
	out := map[string]string{}
	matches := av1EmbedSectionRe.FindAllStringSubmatchIndex(body, -1)
	for _, match := range matches {
		if len(match) < 4 {
			continue
		}
		label := body[match[2]:match[3]]
		braceIndex := match[1] - 1
		if braceIndex < 0 || braceIndex >= len(body) || body[braceIndex] != '{' {
			continue
		}
		end := matchClosingBrace(body, braceIndex)
		if end == -1 {
			continue
		}
		out[label] = body[braceIndex+1 : end]
	}
	return out
}

func matchClosingBrace(body string, openIndex int) int {
	depth := 0
	for i := openIndex; i < len(body); i++ {
		switch body[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func embedTrackRank(track string) int {
	switch strings.ToUpper(strings.TrimSpace(track)) {
	case "SUB", "VOSE", "CAST":
		return 0
	case "LAT", "ESP":
		return 1
	case "DUB":
		return 3
	default:
		return 2
	}
}

func embedTrackAudio(track string) string {
	switch strings.ToUpper(strings.TrimSpace(track)) {
	case "DUB", "LAT", "ESP":
		return "dub"
	case "SUB", "VOSE", "CAST", "RAW":
		return "sub"
	default:
		return ""
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func fetchJSON(url string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, baseURL, map[string]string{
		"Accept":          "application/json, */*; q=0.9",
		"Accept-Language": "es-ES,es;q=0.9",
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
