// Package jkanime implements AnimeSource for JKAnime (jkanime.net).
// Uses JKAnime's AJAX/API endpoints to avoid 403 on direct page scraping.
package jkanime

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	azuretls "github.com/Noooste/azuretls-client"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/httpclient"
	"miruro/backend/logger"
)

var log = logger.For("JKAnime")

const baseURL = "https://jkanime.net"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "jkanime-es" }
func (e *Extension) Name() string { return "JKAnime (Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — direct slug lookup + buscar page scraping
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	var results []extensions.SearchResult
	seen := map[string]bool{}

	for _, candidate := range buildSearchQueries(query) {
		// Strategy 0: convert query to a slug, check if the page exists on JKAnime.
		// This bypasses the often-unreliable /buscar/ endpoint.
		if direct := e.tryDirectSlug(candidate); direct != nil && !seen[direct.ID] {
			seen[direct.ID] = true
			results = append(results, *direct)
		}

		// Strategy 1: scrape the /buscar/ results page
		searchURL := fmt.Sprintf("%s/buscar/%s", baseURL, urlEncode(candidate))
		if body, err := fetchFullBrowser(searchURL); err == nil {
			for _, r := range parseSearchPage(body) {
				if isNotFoundTitle(r.Title) {
					continue
				}
				if !seen[r.ID] {
					seen[r.ID] = true
					results = append(results, r)
				}
			}
		}

		if len(results) >= 8 {
			break
		}
	}

	for _, r := range e.searchDirectoryRecent(query) {
		if !seen[r.ID] {
			seen[r.ID] = true
			results = append(results, r)
		}
	}

	if len(results) > 1 {
		sort.SliceStable(results, func(i, j int) bool {
			return scoreSearchResult(results[i], query) > scoreSearchResult(results[j], query)
		})
	}

	return results, nil
}

// tryDirectSlug converts a title to a kebab-case slug and checks if the anime
// page exists on JKAnime. Returns nil when no valid page is found.
func (e *Extension) tryDirectSlug(query string) *extensions.SearchResult {
	for _, slug := range buildSlugVariants(query) {
		pageURL := fmt.Sprintf("%s/%s/", baseURL, slug)
		body, finalURL, err := fetchFullBrowserWithFinalURL(pageURL)
		if err != nil || len(body) < 500 {
			continue
		}
		finalSlug := extractAnimeSlugFromURL(finalURL)
		if finalSlug != "" && finalSlug != slug {
			continue
		}

		// Must look like a real anime page — check for typical anime page markers
		isAnime := strings.Contains(body, `Episodios:`) ||
			strings.Contains(body, `Géneros:`) ||
			strings.Contains(body, `Generos:`) ||
			strings.Contains(body, `anime__details`) ||
			strings.Contains(body, `episodesList`)
		if !isAnime {
			continue
		}

		title := extractPageTitle(body)
		if isNotFoundTitle(title) {
			continue
		}
		if title == "" {
			title = slugToTitle(slug)
		}

		if finalSlug == "" {
			finalSlug = slug
		}
		cover := fmt.Sprintf("https://cdn.jkdesa.com/assets/images/animes/image/%s.jpg", finalSlug)

		return &extensions.SearchResult{
			ID:        "/" + finalSlug + "/",
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		}
	}
	return nil
}

// toSlug converts "Yuusha Party ni Kawaii Ko ga Ita node, Kokuhaku shitemita."
// → "yuusha-party-ni-kawaii-ko-ga-ita-node-kokuhaku-shitemita"
func toSlug(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			if b.Len() > 0 {
				last := b.String()
				if last[len(last)-1] != '-' {
					b.WriteByte('-')
				}
			}
			// Everything else (punctuation, unicode) is stripped
		}
	}
	return strings.Trim(b.String(), "-")
}

func buildSlugVariants(query string) []string {
	base := toSlug(query)
	if base == "" || len(base) < 3 {
		return nil
	}

	seen := map[string]bool{}
	out := make([]string, 0, 8)
	push := func(value string) {
		value = strings.Trim(value, "-")
		if value == "" || len(value) < 3 || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}

	push(base)

	parts := strings.Split(base, "-")
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 2 {
			continue
		}
		merged := make([]string, 0, len(parts)-1)
		merged = append(merged, parts[:i-1]...)
		merged = append(merged, parts[i-1]+parts[i])
		merged = append(merged, parts[i+1:]...)
		push(strings.Join(merged, "-"))
	}

	return out
}

func buildSearchQueries(query string) []string {
	normalized := strings.TrimSpace(strings.Join(strings.Fields(query), " "))
	if normalized == "" {
		return nil
	}

	seen := map[string]bool{}
	out := make([]string, 0, 8)
	push := func(value string) {
		value = strings.TrimSpace(strings.Join(strings.Fields(value), " "))
		if value == "" || len(value) < 3 || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}

	push(normalized)
	push(strings.ToLower(normalized))

	for _, sep := range []string{":", " - ", " | "} {
		if before, _, ok := strings.Cut(normalized, sep); ok {
			push(before)
			push(strings.ToLower(before))
		}
	}

	slugParts := strings.Split(toSlug(normalized), "-")
	if len(slugParts) > 3 {
		push(strings.Join(slugParts[:3], " "))
		push(strings.Join(slugParts[:4], " "))
	}

	return out
}

type directoryPagePayload struct {
	Data []directoryAnime `json:"data"`
}

type directoryAnime struct {
	Title string `json:"title"`
	Slug  string `json:"slug"`
	Image string `json:"image"`
	URL   string `json:"url"`
}

type cachedDirectoryPayload struct {
	items   []directoryAnime
	expires time.Time
}

var (
	directoryCacheMu sync.Mutex
	directoryCache   cachedDirectoryPayload
)

func (e *Extension) searchDirectoryRecent(query string) []extensions.SearchResult {
	items, err := loadDirectoryItems()
	if err != nil {
		return nil
	}

	var results []extensions.SearchResult
	seen := map[string]bool{}
	searchTerms := buildSearchTerms(query)
	for _, item := range items {
		if !matchesSearchTerms(item.Title, searchTerms) {
			continue
		}

		id := "/" + strings.Trim(item.Slug, "/") + "/"
		if item.Slug == "" || seen[id] {
			continue
		}
		seen[id] = true
		results = append(results, extensions.SearchResult{
			ID:        id,
			Title:     item.Title,
			CoverURL:  item.Image,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}

	return results
}

func loadDirectoryItems() ([]directoryAnime, error) {
	directoryCacheMu.Lock()
	cached := directoryCache
	directoryCacheMu.Unlock()

	if len(cached.items) > 0 && time.Now().Before(cached.expires) {
		return append([]directoryAnime(nil), cached.items...), nil
	}

	body, err := fetchFullBrowser(baseURL + "/directorio")
	if err != nil {
		return nil, err
	}

	matches := directoryPayloadRegex.FindStringSubmatch(body)
	if len(matches) < 2 {
		return nil, fmt.Errorf("jkanime: directory payload not found")
	}

	var payload directoryPagePayload
	if err := json.Unmarshal([]byte(matches[1]), &payload); err != nil {
		return nil, err
	}

	items := append([]directoryAnime(nil), payload.Data...)

	directoryCacheMu.Lock()
	directoryCache = cachedDirectoryPayload{
		items:   append([]directoryAnime(nil), items...),
		expires: time.Now().Add(15 * time.Minute),
	}
	directoryCacheMu.Unlock()

	return items, nil
}

var directoryPayloadRegex = regexp.MustCompile(`(?s)var animes = (\{.*?\});`)

func buildSearchTerms(query string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, 10)
	push := func(value string) {
		value = normalizeSearchText(value)
		if value == "" || len(value) < 3 || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}

	for _, candidate := range buildSearchQueries(query) {
		push(candidate)
	}

	slugWords := strings.Fields(strings.ReplaceAll(toSlug(query), "-", " "))
	if len(slugWords) > 1 {
		push(strings.Join(slugWords[:2], " "))
	}

	return out
}

func matchesSearchTerms(title string, terms []string) bool {
	normalizedTitle := normalizeSearchText(title)
	for _, term := range terms {
		if strings.Contains(normalizedTitle, term) || strings.Contains(term, normalizedTitle) {
			return true
		}
	}
	return false
}

func normalizeSearchText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.NewReplacer(":", " ", "-", " ", "|", " ", "_", " ").Replace(value)
	return strings.Join(strings.Fields(value), " ")
}

func scoreSearchResult(result extensions.SearchResult, query string) int {
	title := normalizeSearchText(result.Title)
	score := 0
	for idx, term := range buildSearchTerms(query) {
		weight := 40 - idx*3
		if weight < 10 {
			weight = 10
		}
		switch {
		case title == term:
			score += weight + 40
		case strings.Contains(title, term):
			score += weight + 25
		case strings.Contains(term, title):
			score += weight + 10
		}
	}
	return score
}

// extractPageTitle pulls the anime title from the <title> tag.
func extractPageTitle(body string) string {
	idx := strings.Index(body, "<title>")
	if idx == -1 {
		return ""
	}
	rest := body[idx+7:]
	end := strings.Index(rest, "</title>")
	if end == -1 || end > 300 {
		return ""
	}
	full := strings.TrimSpace(rest[:end])
	// Strip " | JKAnime" or " - JKAnime" suffix
	for _, sep := range []string{" | ", " - ", " – "} {
		if i := strings.Index(full, sep); i > 0 {
			full = full[:i]
		}
	}
	full = strings.TrimSpace(full)
	full = html.UnescapeString(full)
	if full == "" || strings.EqualFold(full, "jkanime") {
		return ""
	}
	return full
}

func parseSearchPage(html string) []extensions.SearchResult {
	out := parseByClass(html)
	// If class-based parse found nothing (site may have changed markup),
	// fall back to extracting every single-segment jkanime.net href.
	if len(out) == 0 {
		out = parseByHref(html)
	}
	return out
}

// parseByClass is the primary strategy: find anime__item containers.
func parseByClass(html string) []extensions.SearchResult {
	var out []extensions.SearchResult
	pos := 0

	for len(out) < 20 {
		idx := strings.Index(html[pos:], `class="anime__item"`)
		if idx == -1 {
			break
		}
		pos += idx + 1

		end := pos + 1200
		if end > len(html) {
			end = len(html)
		}
		card := html[pos:end]

		slug, cover, title := extractCardFields(card)
		if slug == "" {
			continue
		}
		out = append(out, extensions.SearchResult{
			ID:        "/" + slug + "/",
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return out
}

// parseByHref is the fallback: collect every unique single-segment jkanime.net link.
// This is resilient to class-name changes on the site.
func parseByHref(html string) []extensions.SearchResult {
	var out []extensions.SearchResult
	seen := map[string]bool{}

	// Non-anime path segments to skip — covers all JKAnime navigation/system paths
	skipExact := map[string]bool{
		"buscar": true, "genero": true, "tipo": true, "temporada": true,
		"tag": true, "ajax": true, "api": true, "login": true,
		"register": true, "perfil": true, "assets": true,
		"directorio": true, "horario": true, "comunidad": true,
		"aplicacion": true, "historial": true, "estrenos": true,
		"top": true, "guardado": true, "dash": true, "usuario": true,
		"notificaciones": true, "contacto": true, "privacidad": true,
		"terminos": true, "dmca": true, "faq": true, "about": true,
		"cuenta": true, "favoritos": true, "configuracion": true,
		"lista": true, "listas": true, "calendario": true,
	}
	isSkip := func(s string) bool {
		return skipExact[s]
	}

	pos := 0
	prefix := `href="https://jkanime.net/`
	for len(out) < 20 {
		idx := strings.Index(html[pos:], prefix)
		if idx == -1 {
			break
		}
		pos += idx + len(prefix)
		end := strings.IndexByte(html[pos:], '"')
		if end == -1 {
			break
		}
		raw := strings.Trim(html[pos:pos+end], "/")
		pos += end + 1

		// Must be a single-path-segment slug (no nested slashes after trim)
		if raw == "" || strings.Contains(raw, "/") || strings.Contains(raw, "?") || strings.Contains(raw, "#") {
			continue
		}
		if isSkip(raw) || seen[raw] {
			continue
		}
		seen[raw] = true

		// Try to grab a small window around this href to find the card's title
		windowStart := pos - end - len(prefix) - 20
		if windowStart < 0 {
			windowStart = 0
		}
		windowEnd := pos + 800
		if windowEnd > len(html) {
			windowEnd = len(html)
		}
		card := html[windowStart:windowEnd]

		cover := fmt.Sprintf("https://cdn.jkdesa.com/assets/images/animes/image/%s.jpg", raw)
		if bgIdx := strings.Index(card, `data-setbg="`); bgIdx != -1 {
			bgStart := card[bgIdx+12:]
			if bgEnd := strings.Index(bgStart, `"`); bgEnd != -1 && bgEnd < 200 {
				cover = bgStart[:bgEnd]
			}
		}

		title := extractCardTitle(card)
		if title == "" {
			title = slugToTitle(raw)
		}

		out = append(out, extensions.SearchResult{
			ID:        "/" + raw + "/",
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return out
}

// extractCardFields pulls slug, cover URL, and title from a card HTML fragment.
func extractCardFields(card string) (slug, cover, title string) {
	linkIdx := strings.Index(card, `href="https://jkanime.net/`)
	if linkIdx == -1 {
		return "", "", ""
	}
	linkStart := linkIdx + len(`href="https://jkanime.net/`)
	linkEnd := strings.Index(card[linkStart:], `"`)
	if linkEnd == -1 {
		return "", "", ""
	}
	slug = strings.Trim(card[linkStart:linkStart+linkEnd], "/")
	if slug == "" || strings.Contains(slug, "?") || strings.Contains(slug, "#") {
		return "", "", ""
	}

	cover = fmt.Sprintf("https://cdn.jkdesa.com/assets/images/animes/image/%s.jpg", slug)
	if bgIdx := strings.Index(card, `data-setbg="`); bgIdx != -1 {
		bgStart := card[bgIdx+12:]
		if bgEnd := strings.Index(bgStart, `"`); bgEnd != -1 && bgEnd < 200 {
			cover = bgStart[:bgEnd]
		}
	}

	title = extractCardTitle(card)
	if title == "" {
		title = slugToTitle(slug)
	}
	return slug, cover, title
}

// slugToTitle converts "kono-subarashii-sekai-ni-shukufuku-wo-2" to
// "Kono Subarashii Sekai ni Shukufuku wo 2"
func slugToTitle(slug string) string {
	// Don't capitalize certain particles
	lower := map[string]bool{
		"ni": true, "no": true, "wa": true, "wo": true, "to": true,
		"ga": true, "de": true, "na": true, "mo": true,
	}
	words := strings.Split(slug, "-")
	for i, w := range words {
		if i == 0 || !lower[w] {
			if len(w) > 0 {
				words[i] = strings.ToUpper(w[:1]) + w[1:]
			}
		}
	}
	return strings.Join(words, " ")
}

func extractAnimeSlugFromURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 1 {
		return ""
	}
	return parts[0]
}

func isNotFoundTitle(title string) bool {
	normalized := strings.ToLower(strings.TrimSpace(title))
	return normalized == "pagina no encontrada" || normalized == "página no encontrada"
}

// extractCardTitle tries to read the actual displayed title from a search card's HTML.
// JKAnime typically places it in <h5><a>Title</a></h5> inside each .anime__item.
func extractCardTitle(card string) string {
	for _, tag := range []string{"<h5", "<h4", "<h3"} {
		idx := strings.Index(card, tag)
		if idx == -1 {
			continue
		}
		// Skip to end of opening tag
		closeAngle := strings.Index(card[idx:], ">")
		if closeAngle == -1 {
			continue
		}
		inner := card[idx+closeAngle+1:]
		// If the content starts with an <a> tag, skip past it
		if strings.HasPrefix(inner, "<a") {
			aClose := strings.Index(inner, ">")
			if aClose != -1 {
				inner = inner[aClose+1:]
			}
		}
		// Extract plain text up to the next tag
		if end := strings.IndexByte(inner, '<'); end != -1 {
			text := strings.TrimSpace(html.UnescapeString(inner[:end]))
			if text != "" && len(text) < 200 && !strings.ContainsAny(text, "{}") {
				return text
			}
		}
	}
	return ""
}

// ─────────────────────────────────────────────────────────────────────────────
// Episodes — use AJAX episode list endpoint to avoid 403 on page scraping
// JKAnime has: /ajax/pagination_episodes/SLUG/?page=1
// which returns episode numbers without needing to load the main page
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	slug := strings.Trim(animeID, "/")
	pageURL := fmt.Sprintf("%s/%s/", baseURL, slug)

	// Try with same-origin referer — often bypasses 403 checks
	body, err := animeflv.FetchPageWithHeaders(pageURL, pageURL, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "es-419,es;q=0.9",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "same-origin",
		"Sec-Fetch-User":            "?1",
	})
	if err != nil {
		return nil, fmt.Errorf("jkanime: could not load anime page for %s", slug)
	}

	// Parse episode count — pattern: <li><span>Episodios:</span> 12</li>
	total := 0
	if idx := strings.Index(body, `<span>Episodios:</span>`); idx != -1 {
		chunk := body[idx+len(`<span>Episodios:</span>`):]
		chunk = strings.TrimSpace(chunk)
		if _, err := fmt.Sscanf(chunk, "%d", &total); err != nil {
			total = 0
		}
	}

	if total == 0 {
		if eps := getEpisodesFromLatestMarker(slug, body); len(eps) > 0 {
			return eps, nil
		}
		// Fallback 1: scan the anime page HTML for the latest episode number.
		// For newly airing anime this is often more reliable than the legacy
		// pagination endpoint, which can leak planned totals.
		if eps := e.getEpisodesFromPageHTML(slug, body); len(eps) > 0 {
			return eps, nil
		}
		// Fallback 2: pagination AJAX endpoint
		if eps, err := e.getEpisodesFromPagination(slug); err == nil && len(eps) > 0 {
			return eps, nil
		}
		return nil, fmt.Errorf("jkanime: could not determine episode count for %s", slug)
	}

	// For newly releasing anime JKAnime may expose the planned total here
	// even when only a few episodes are actually published. Prefer real
	// released episodes when pagination/page HTML returns a smaller valid set.
	if eps := getEpisodesFromLatestMarker(slug, body); len(eps) > 0 && len(eps) <= total {
		return eps, nil
	}
	if eps, err := e.getEpisodesFromPagination(slug); err == nil && len(eps) > 0 {
		if len(eps) <= total {
			return eps, nil
		}
	}
	if eps := e.getEpisodesFromPageHTML(slug, body); len(eps) > 0 && len(eps) <= total {
		return eps, nil
	}

	out := make([]extensions.Episode, 0, total)
	for i := 1; i <= total; i++ {
		out = append(out, extensions.Episode{
			ID:     fmt.Sprintf("/%s/%d/", slug, i),
			Number: float64(i),
			Title:  fmt.Sprintf("Episodio %d", i),
		})
	}
	return out, nil
}

// getEpisodesFromPageHTML is a last-resort fallback for airing anime.
// It scans the anime page HTML for the latest episode number by looking for:
//  1. "Último episodio: Anime Title - N" patterns
//  2. Any /{slug}/NUMBER/ href patterns embedded in the page
//  3. JavaScript data (render_caps, episode arrays)
func (e *Extension) getEpisodesFromPageHTML(slug, body string) []extensions.Episode {
	maxEp := 0
	latestFromMarker := 0

	// Strategy A: "Último episodio" or last-episode marker
	// Pattern: "- 8" or "- 11" at the end of "último episodio" text
	for _, marker := range []string{"ltimo episodio", "ltimo Episodio", "ultimo-episodio", "last-episode"} {
		idx := strings.Index(body, marker)
		if idx == -1 {
			continue
		}
		chunk := body[idx : idx+300]
		if end := len(chunk); end > 300 {
			chunk = chunk[:300]
		}
		// Look for " - N" pattern (episode number after dash)
		for i := len(chunk) - 1; i > 0; i-- {
			if chunk[i] >= '0' && chunk[i] <= '9' {
				// Found a digit; extract the full number going backwards
				j := i
				for j > 0 && chunk[j-1] >= '0' && chunk[j-1] <= '9' {
					j--
				}
				var num int
				if _, err := fmt.Sscanf(chunk[j:i+1], "%d", &num); err != nil {
					num = 0
				}
				if num > maxEp && num < 2000 {
					maxEp = num
					latestFromMarker = num
				}
				break
			}
		}
	}

	if latestFromMarker > 0 {
		out := make([]extensions.Episode, 0, latestFromMarker)
		for i := 1; i <= latestFromMarker; i++ {
			out = append(out, extensions.Episode{
				ID:     fmt.Sprintf("/%s/%d/", slug, i),
				Number: float64(i),
				Title:  fmt.Sprintf("Episodio %d", i),
			})
		}
		return out
	}

	// Strategy B: scan for /{slug}/NUMBER/ href patterns on the page
	prefix := "/" + slug + "/"
	searchIn := body
	for {
		idx := strings.Index(searchIn, prefix)
		if idx == -1 {
			break
		}
		searchIn = searchIn[idx+len(prefix):]
		var num int
		if _, err := fmt.Sscanf(searchIn, "%d", &num); err == nil && num > 0 && num < 2000 {
			if num > maxEp {
				maxEp = num
			}
		}
	}

	if maxEp == 0 {
		return nil
	}

	out := make([]extensions.Episode, 0, maxEp)
	for i := 1; i <= maxEp; i++ {
		out = append(out, extensions.Episode{
			ID:     fmt.Sprintf("/%s/%d/", slug, i),
			Number: float64(i),
			Title:  fmt.Sprintf("Episodio %d", i),
		})
	}
	return out
}

func getEpisodesFromLatestMarker(slug, body string) []extensions.Episode {
	latestMarkerRe := regexp.MustCompile(`(?is)(?:ltimo episodio|last-episode).*?-\s*(\d{1,4})\b`)
	match := latestMarkerRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil
	}

	var latest int
	if _, err := fmt.Sscanf(match[1], "%d", &latest); err != nil {
		latest = 0
	}
	if latest <= 0 || latest >= 2000 {
		return nil
	}

	out := make([]extensions.Episode, 0, latest)
	for i := 1; i <= latest; i++ {
		out = append(out, extensions.Episode{
			ID:     fmt.Sprintf("/%s/%d/", slug, i),
			Number: float64(i),
			Title:  fmt.Sprintf("Episodio %d", i),
		})
	}
	return out
}

// getEpisodeCount fetches episode count via the anime info AJAX endpoint
func (e *Extension) getEpisodeCount(slug string) (int, error) {
	// Try the anime info endpoint
	url := fmt.Sprintf("%s/ajax/anime/info/?id=%s", baseURL, slug)
	body, err := fetchAJAX(url)
	if err == nil {
		var resp struct {
			Episodes int    `json:"episodes"`
			Count    int    `json:"count"`
			Total    string `json:"total"`
		}
		if json.Unmarshal([]byte(body), &resp) == nil {
			if resp.Episodes > 0 {
				return resp.Episodes, nil
			}
			if resp.Count > 0 {
				return resp.Count, nil
			}
			var total int
			if _, err := fmt.Sscanf(resp.Total, "%d", &total); err == nil && total > 0 {
				return total, nil
			}
		}
	}
	return 0, fmt.Errorf("count not found")
}

// getEpisodesFromPagination scrapes episode links from the pagination AJAX endpoint.
// Extracts all episode numbers found in any page of results.
func (e *Extension) getEpisodesFromPagination(slug string) ([]extensions.Episode, error) {
	seen := map[int]bool{}
	var maxEp int

	for page := 1; page <= 20; page++ {
		url := fmt.Sprintf("%s/ajax/pagination_episodes/%s/?page=%d", baseURL, slug, page)
		body, err := fetchAJAX(url)
		if err != nil || len(body) < 10 {
			break
		}

		// Extract all episode numbers: look for /{slug}/NUMBER/ patterns
		foundOnPage := false
		searchIn := body
		prefix := "/" + slug + "/"
		for {
			idx := strings.Index(searchIn, prefix)
			if idx == -1 {
				break
			}
			searchIn = searchIn[idx+len(prefix):]
			var num int
			if _, err := fmt.Sscanf(searchIn, "%d", &num); err == nil && num > 0 {
				if !seen[num] {
					seen[num] = true
					if num > maxEp {
						maxEp = num
					}
				}
				foundOnPage = true
			}
		}

		if !foundOnPage {
			break
		}
	}

	// If pagination found nothing, try a simpler approach: assume episodes 1..N
	// by fetching the anime page and looking for episode-related JS/HTML
	if len(seen) == 0 {
		return nil, fmt.Errorf("jkanime: no episodes found for %s", slug)
	}

	// Build sorted episode list
	out := make([]extensions.Episode, 0, len(seen))
	for i := 1; i <= maxEp; i++ {
		// Include all numbers up to max (fills gaps in pagination)
		out = append(out, extensions.Episode{
			ID:     fmt.Sprintf("/%s/%d/", slug, i),
			Number: float64(i),
			Title:  fmt.Sprintf("Episodio %d", i),
		})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams — get embed URLs from episode page
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) GetEmbedURLs(episodeID string) ([]string, error) {
	slug := strings.Trim(episodeID, "/")
	parts := strings.Split(slug, "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("jkanime: invalid episode ID %s", episodeID)
	}
	animeName := parts[0]
	epNum := parts[1]

	// Step 1: load episode page to get CSRF token
	pageURL := fmt.Sprintf("%s/%s/%s", baseURL, animeName, epNum)
	body, err := fetchFullBrowser(pageURL)
	if err != nil {
		return nil, fmt.Errorf("jkanime: episode page failed: %w", err)
	}

	// Extract CSRF token: <meta name="csrf-token" content="TOKEN">
	csrfToken := ""
	if idx := strings.Index(body, `name="csrf-token"`); idx != -1 {
		chunk := body[idx:]
		if ci := strings.Index(chunk, `content="`); ci != -1 {
			val := chunk[ci+9:]
			if end := strings.Index(val, `"`); end != -1 {
				csrfToken = val[:end]
			}
		}
	}

	// Step 2: request servers with CSRF token
	// Try multiple endpoint patterns JKAnime has used
	endpoints := []string{
		fmt.Sprintf("%s/ajax/servers/%s/%s/", baseURL, animeName, epNum),
		fmt.Sprintf("%s/ajax/video_servers/%s/%s/", baseURL, animeName, epNum),
	}

	headers := map[string]string{
		"X-Requested-With": "XMLHttpRequest",
		"Accept":           "application/json, text/javascript, */*; q=0.01",
		"Origin":           baseURL,
	}
	if csrfToken != "" {
		headers["X-CSRF-TOKEN"] = csrfToken
	}

	for _, endpoint := range endpoints {
		resp, err2 := animeflv.FetchPageWithHeaders(endpoint, pageURL, headers)
		if err2 != nil || len(resp) < 20 {
			continue
		}
		embeds := extractServerURLs(resp)
		if len(embeds) > 0 {
			return embeds, nil
		}
	}

	// Step 3: fallback — extract iframes from episode page itself
	embeds := extractServerURLs(body)
	return embeds, nil
}

func (e *Extension) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	embeds, err := e.GetEmbedURLs(episodeID)
	if err != nil || len(embeds) == 0 {
		return nil, fmt.Errorf("jkanime: no embeds for %s", episodeID)
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
		return nil, fmt.Errorf("jkanime: all resolvers failed")
	}
	return sources, nil
}

func extractServerURLs(body string) []string {
	var out []string
	seen := map[string]bool{}

	skip := func(u string) bool {
		// Strip query string for extension check
		base := u
		if qi := strings.Index(u, "?"); qi != -1 {
			base = u[:qi]
		}
		for _, ext := range []string{".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".map"} {
			if strings.HasSuffix(strings.ToLower(base), ext) {
				return true
			}
		}
		// Skip known static asset domains/paths
		if strings.Contains(u, "cdn.jkdesa.com") {
			return true
		}
		if strings.Contains(u, "googleapis.com") || strings.Contains(u, "jquery") {
			return true
		}
		return false
	}

	// JSON "remote" field
	i := 0
	for {
		idx := strings.Index(body[i:], `"remote"`)
		if idx == -1 {
			break
		}
		i += idx + 8
		start := strings.Index(body[i:], `"`)
		if start == -1 {
			break
		}
		i += start + 1
		end := strings.Index(body[i:], `"`)
		if end == -1 {
			break
		}
		u := body[i : i+end]
		i += end + 1
		if strings.HasPrefix(u, "http") && !seen[u] && !skip(u) {
			seen[u] = true
			out = append(out, u)
		}
	}

	// iframe src
	for _, part := range strings.Split(body, `src="`) {
		if !strings.HasPrefix(part, "http") {
			continue
		}
		end := strings.Index(part, `"`)
		if end == -1 {
			continue
		}
		u := part[:end]
		if strings.Contains(u, ".") && !seen[u] && !skip(u) {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Synopsis — extract Spanish synopsis from anime detail page
// ─────────────────────────────────────────────────────────────────────────────

// GetSynopsisFromTitle converts a title string to a JKAnime slug and fetches
// the Spanish synopsis. Used for local library anime matched by title.
func (e *Extension) GetSynopsisFromTitle(title string) (string, error) {
	slug := toSlug(title)
	if slug == "" || len(slug) < 3 {
		return "", fmt.Errorf("jkanime: could not generate slug from title %q", title)
	}
	return e.GetSynopsis("/" + slug + "/")
}

// GetSynopsis fetches the anime page and extracts the Spanish synopsis text.
func (e *Extension) GetSynopsis(animeID string) (string, error) {
	slug := strings.Trim(animeID, "/")
	pageURL := fmt.Sprintf("%s/%s/", baseURL, slug)

	body, err := fetchFullBrowser(pageURL)
	if err != nil {
		return "", fmt.Errorf("jkanime: could not load anime page for %s", slug)
	}

	return extractSynopsis(body), nil
}

// extractSynopsis tries multiple strategies to pull the synopsis text from a
// JKAnime anime detail page. The result is plain text (HTML stripped).
func extractSynopsis(body string) string {
	// Strategy 1: <p class="tab sinopsis"> … </p>  (most common layout)
	if syn := extractBetweenTags(body, `class="tab sinopsis"`, "</p>"); syn != "" {
		return syn
	}

	// Strategy 2: <div class="sinopsis"> … </div>
	if syn := extractBetweenTags(body, `class="sinopsis"`, "</div>"); syn != "" {
		return syn
	}

	// Strategy 3: <p class="anime__details__text"> or similar
	if syn := extractBetweenTags(body, `class="anime__details__text"`, "</p>"); syn != "" {
		return syn
	}

	// Strategy 4: look for "Sinopsis" header followed by <p>
	if idx := strings.Index(body, "Sinopsis"); idx != -1 {
		chunk := body[idx:]
		if pIdx := strings.Index(chunk, "<p"); pIdx != -1 && pIdx < 300 {
			inner := chunk[pIdx:]
			// Skip past opening <p...>
			if close := strings.Index(inner, ">"); close != -1 {
				inner = inner[close+1:]
				if end := strings.Index(inner, "</p>"); end != -1 && end < 3000 {
					text := stripHTMLTags(inner[:end])
					if len(text) > 20 {
						return text
					}
				}
			}
		}
	}

	return ""
}

// extractBetweenTags finds an element by a class attribute substring and
// extracts its text content up to the given closing tag.
func extractBetweenTags(body, classAttr, closeTag string) string {
	idx := strings.Index(body, classAttr)
	if idx == -1 {
		return ""
	}
	rest := body[idx:]
	// Skip past the opening tag's closing >
	start := strings.Index(rest, ">")
	if start == -1 {
		return ""
	}
	rest = rest[start+1:]
	end := strings.Index(rest, closeTag)
	if end == -1 || end > 5000 {
		return ""
	}
	text := stripHTMLTags(rest[:end])
	if len(text) < 10 {
		return ""
	}
	return text
}

// stripHTMLTags removes HTML tags and collapses whitespace.
func stripHTMLTags(s string) string {
	// Remove tags
	var b strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			b.WriteByte(' ')
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			b.WriteRune(r)
		}
	}
	// Collapse whitespace
	result := strings.Join(strings.Fields(b.String()), " ")
	return strings.TrimSpace(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Downloads — extract download links from episode pages
// ─────────────────────────────────────────────────────────────────────────────

// DownloadLink represents an available download option for an episode.
type DownloadLink struct {
	URL     string `json:"url"`
	Host    string `json:"host"`    // "Mediafire", "Mega", "Streamwish", etc.
	Quality string `json:"quality"` // "720p", "1080p", etc. if detectable
}

// GetDownloadLinks scrapes an episode page for download links.
// JKAnime provides download options (typically Mediafire, Mega, Streamwish)
// in the episode page HTML, separate from streaming embeds.
func (e *Extension) GetDownloadLinks(episodeID string) ([]DownloadLink, error) {
	slug := strings.Trim(episodeID, "/")
	parts := strings.Split(slug, "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("jkanime: invalid episode ID %s", episodeID)
	}

	pageURL := fmt.Sprintf("%s/%s", baseURL, slug)
	body, err := fetchFullBrowser(pageURL)
	if err != nil {
		return nil, fmt.Errorf("jkanime: episode page failed: %w", err)
	}

	if links := parseDownloadLinksFromServers(body); len(links) > 0 {
		return links, nil
	}

	var links []DownloadLink
	seen := map[string]bool{}

	// Known download host domains and their display names
	hostMap := map[string]string{
		"mediafire.com":   "Mediafire",
		"mega.nz":         "Mega",
		"mega.co.nz":      "Mega",
		"streamwish":      "Streamwish",
		"filelions":       "FileLions",
		"wishfast":        "WishFast",
		"uploadhaven":     "UploadHaven",
		"zippyshare.com":  "Zippyshare",
		"1fichier.com":    "1Fichier",
		"gofile.io":       "Gofile",
		"send.cm":         "Send.cm",
		"pixeldrain.com":  "Pixeldrain",
		"buzzheavier.com": "BuzzHeavier",
	}

	identifyHost := func(u string) string {
		lower := strings.ToLower(u)
		for domain, name := range hostMap {
			if strings.Contains(lower, domain) {
				return name
			}
		}
		return ""
	}

	// Strategy 1: Look for links in download-related sections
	// Common patterns: class="download", id="download", "Descargar", "Download"
	// Extract all href values that point to known download hosts
	for _, part := range strings.Split(body, `href="`) {
		if !strings.HasPrefix(part, "http") {
			continue
		}
		end := strings.Index(part, `"`)
		if end == -1 || end > 500 {
			continue
		}
		u := strings.TrimSpace(part[:end])
		host := identifyHost(u)
		if host == "" || seen[u] {
			continue
		}
		seen[u] = true
		links = append(links, DownloadLink{URL: u, Host: host})
	}

	// Strategy 2: Look for links in onclick/data attributes (some sites use JS)
	for _, attr := range []string{`onclick="window.open('`, `data-url="`, `data-href="`} {
		searchIn := body
		for {
			idx := strings.Index(searchIn, attr)
			if idx == -1 {
				break
			}
			searchIn = searchIn[idx+len(attr):]
			end := strings.IndexAny(searchIn, `"'`)
			if end == -1 || end > 500 {
				break
			}
			u := strings.TrimSpace(searchIn[:end])
			if !strings.HasPrefix(u, "http") {
				continue
			}
			host := identifyHost(u)
			if host == "" || seen[u] {
				continue
			}
			seen[u] = true
			links = append(links, DownloadLink{URL: u, Host: host})
		}
	}

	// Try to detect quality from surrounding HTML context
	for i := range links {
		lower := strings.ToLower(links[i].URL)
		switch {
		case strings.Contains(lower, "1080"):
			links[i].Quality = "1080p"
		case strings.Contains(lower, "720"):
			links[i].Quality = "720p"
		case strings.Contains(lower, "480"):
			links[i].Quality = "480p"
		case strings.Contains(lower, "360"):
			links[i].Quality = "360p"
		}
	}

	// Sort: Mediafire first (most reliable), then others
	sortedLinks := make([]DownloadLink, 0, len(links))
	for _, l := range links {
		if l.Host == "Mediafire" {
			sortedLinks = append(sortedLinks, l)
		}
	}
	for _, l := range links {
		if l.Host != "Mediafire" {
			sortedLinks = append(sortedLinks, l)
		}
	}

	return sortedLinks, nil
}

type jkanimeDownloadServer struct {
	Remote string `json:"remote"`
	Slug   string `json:"slug"`
	Server string `json:"server"`
	Size   string `json:"size"`
}

func parseDownloadLinksFromServers(body string) []DownloadLink {
	serversJSON := extractJSArray(body, "var servers = ")
	if serversJSON == "" {
		return nil
	}

	var servers []jkanimeDownloadServer
	if err := json.Unmarshal([]byte(serversJSON), &servers); err != nil {
		return nil
	}

	remoteHost := extractJSString(body, "var remote = '")
	seen := map[string]bool{}
	out := make([]DownloadLink, 0, len(servers))

	for _, server := range servers {
		url := decodeRemoteURL(server.Remote)
		if url == "" && remoteHost != "" && server.Slug != "" {
			url = strings.TrimRight(remoteHost, "/") + "/d/" + server.Slug + "/"
		}
		if url == "" || seen[url] {
			continue
		}
		seen[url] = true

		out = append(out, DownloadLink{
			URL:     url,
			Host:    server.Server,
			Quality: detectDownloadQuality(url, server.Size),
		})
	}

	sortDownloadLinks(out)
	return out
}

func extractJSArray(body, prefix string) string {
	start := strings.Index(body, prefix)
	if start == -1 {
		return ""
	}
	rest := body[start+len(prefix):]
	end := strings.Index(rest, "];")
	if end == -1 {
		return ""
	}
	return strings.TrimSpace(rest[:end+1])
}

func extractJSString(body, prefix string) string {
	start := strings.Index(body, prefix)
	if start == -1 {
		return ""
	}
	rest := body[start+len(prefix):]
	end := strings.Index(rest, "'")
	if end == -1 {
		return ""
	}
	return strings.TrimSpace(rest[:end])
}

func decodeRemoteURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(decoded))
}

func detectDownloadQuality(url, size string) string {
	lower := strings.ToLower(url + " " + size)
	switch {
	case strings.Contains(lower, "1080"):
		return "1080p"
	case strings.Contains(lower, "720"):
		return "720p"
	case strings.Contains(lower, "480"):
		return "480p"
	case strings.Contains(lower, "360"):
		return "360p"
	default:
		return ""
	}
}

func sortDownloadLinks(links []DownloadLink) {
	priority := func(host string) int {
		switch strings.ToLower(host) {
		case "mediafire":
			return 0
		case "mp4upload":
			return 1
		case "streamtape":
			return 2
		case "doodstream":
			return 3
		case "voe":
			return 4
		case "streamwish":
			return 5
		case "vidhide":
			return 6
		case "mega":
			return 7
		default:
			return 99
		}
	}

	for i := 0; i < len(links); i++ {
		for j := i + 1; j < len(links); j++ {
			if priority(links[j].Host) < priority(links[i].Host) {
				links[i], links[j] = links[j], links[i]
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

func fetchAJAX(url string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, baseURL, map[string]string{
		"X-Requested-With": "XMLHttpRequest",
		"Accept":           "application/json, text/javascript, */*; q=0.01",
		"Accept-Language":  "es-419,es;q=0.9",
	})
}

func fetchFullBrowser(url string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, baseURL, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "es-419,es;q=0.9",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "none",
		"Cache-Control":             "max-age=0",
	})
}

var jkSession = httpclient.NewSession(12)

func fetchFullBrowserWithFinalURL(rawURL string) (string, string, error) {
	req := &azuretls.Request{
		Url:    rawURL,
		Method: "GET",
		OrderedHeaders: azuretls.OrderedHeaders{
			{"Referer", baseURL},
			{"Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
			{"Accept-Language", "es-419,es;q=0.9"},
			{"Upgrade-Insecure-Requests", "1"},
			{"Sec-Fetch-Dest", "document"},
			{"Sec-Fetch-Mode", "navigate"},
			{"Sec-Fetch-Site", "none"},
			{"Cache-Control", "max-age=0"},
		},
	}

	resp, err := jkSession.Do(req)
	if err != nil {
		return "", "", err
	}

	finalURL := resp.Url
	if finalURL == "" {
		finalURL = rawURL
	}

	return string(resp.Body), finalURL, nil
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
