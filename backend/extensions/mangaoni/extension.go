package mangaoni

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"miruro/backend/extensions"
	"miruro/backend/extensions/sourceaccess"
)

const (
	sourceID           = "mangaoni-es"
	baseURL            = "https://manga-oni.com"
	searchBootstrapTTL = 10 * time.Minute
	searchCacheTTL     = 10 * time.Minute
	searchMissTTL      = 30 * time.Second
	chapterCacheTTL    = 20 * time.Minute
	chapterMissTTL     = 30 * time.Second
	pageCacheTTL       = 30 * time.Minute
)

var (
	csrfTokenRe = regexp.MustCompile(`<meta name="csrf-token" content="([^"]+)"`)
	chapterRe   = regexp.MustCompile(`(?s)<a\s+href="(https://manga-oni\.com/lector/[^"]+/[0-9]+/(?:cascada/|p[0-9]+/?|)?)"[^>]*>.*?<span[^>]*class="timeago"[^>]*data-num="([^"]+)"[^>]*datetime="([^"]+)"[^>]*></span><h3[^>]*class="entry-title-h2">([^<]+)</h3>`)
	unicapRe    = regexp.MustCompile(`var unicap = '([^']+)';`)
)

type Extension struct{}

type cachedToken struct {
	token   string
	expires time.Time
}

type cachedSearch struct {
	results []extensions.SearchResult
	expires time.Time
}

type cachedChapters struct {
	chapters []extensions.Chapter
	expires  time.Time
}

type cachedPages struct {
	pages   []extensions.PageSource
	expires time.Time
}

var (
	tokenMu        sync.Mutex
	searchToken    cachedToken
	searchCacheMu  sync.Mutex
	searchCache    = map[string]cachedSearch{}
	chapterCacheMu sync.Mutex
	chapterCache   = map[string]cachedChapters{}
	pageCacheMu    sync.Mutex
	pageCache      = map[string]cachedPages{}
)

func init() {
	sourceaccess.RegisterProfile(sourceaccess.SourceAccessProfile{
		SourceID:             sourceID,
		BaseURL:              baseURL,
		WarmupURL:            baseURL + "/",
		DefaultReferer:       baseURL + "/",
		CookieDomains:        []string{"manga-oni.com"},
		ChallengeStatusCodes: []int{403},
	})
}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return sourceID }
func (e *Extension) Name() string { return "MangaOni" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}

	if cached, ok := readSearchCache(query); ok {
		return cached, nil
	}

	token, err := cachedSearchTokenValue()
	if err != nil {
		return nil, fmt.Errorf("mangaoni search init: %w", err)
	}

	form := url.Values{}
	form.Set("buscar", query)
	form.Set("_token", token)

	body, err := sourceaccess.FetchJSON(sourceID, baseURL+"/buscar", sourceaccess.RequestOptions{
		Method:  "POST",
		Body:    []byte(form.Encode()),
		Referer: baseURL + "/",
		Headers: map[string]string{
			"Origin":           baseURL,
			"Accept":           "application/json, text/plain, */*",
			"Accept-Language":  "es-419,es;q=0.9,en;q=0.8",
			"Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
			"X-Requested-With": "XMLHttpRequest",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("mangaoni search request: %w", err)
	}

	var payload struct {
		Mangas []struct {
			Nombre      string `json:"nombre"`
			Alterno     string `json:"alterno"`
			Lanzamiento int    `json:"lanzamiento"`
			URL         string `json:"url"`
			Img         string `json:"img"`
			Autor       string `json:"autor"`
		} `json:"mangas"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("mangaoni search parse: %w", err)
	}

	results := make([]extensions.SearchResult, 0, len(payload.Mangas))
	for _, item := range payload.Mangas {
		title := cleanText(item.Nombre)
		if title == "" {
			continue
		}
		results = append(results, extensions.SearchResult{
			ID:          normalizeMangaURL(item.URL),
			Title:       title,
			CoverURL:    strings.TrimSpace(item.Img),
			Year:        item.Lanzamiento,
			Description: buildDescription(cleanText(item.Alterno), cleanText(item.Autor)),
			Languages:   []extensions.Language{extensions.LangSpanish},
		})
	}

	storeSearchCache(query, results)
	return results, nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	normalizedID := normalizeMangaURL(mangaID)
	if cached, ok := readChapterCache(normalizedID); ok {
		return cached, nil
	}

	body, err := fetchPage(normalizedID, baseURL+"/")
	if err != nil {
		return nil, fmt.Errorf("mangaoni chapters: %w", err)
	}

	matches := chapterRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		storeChapterCache(normalizedID, nil)
		return nil, fmt.Errorf("mangaoni: no chapters found")
	}

	seen := make(map[string]bool)
	chapters := make([]extensions.Chapter, 0, len(matches))
	for _, match := range matches {
		chapterURL := normalizeChapterURL(match[1])
		if chapterURL == "" || seen[chapterURL] {
			continue
		}
		seen[chapterURL] = true

		number := parseChapterNumber(match[2])
		title := cleanText(match[4])
		if title == "" {
			title = fmt.Sprintf("CapÃ­tulo %s", strings.TrimSpace(match[2]))
		}

		chapters = append(chapters, extensions.Chapter{
			ID:         chapterURL,
			Number:     number,
			Title:      title,
			Language:   extensions.LangSpanish,
			UploadedAt: strings.TrimSpace(match[3]),
		})
	}

	sort.Slice(chapters, func(i, j int) bool {
		if chapters[i].Number == chapters[j].Number {
			return chapters[i].UploadedAt < chapters[j].UploadedAt
		}
		return chapters[i].Number < chapters[j].Number
	})

	storeChapterCache(normalizedID, chapters)
	return chapters, nil
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	chapterURL := normalizeChapterURL(chapterID)
	if cached, ok := readPageCache(chapterURL); ok {
		return cached, nil
	}

	body, err := fetchPage(chapterURL, chapterURL)
	if err != nil {
		return nil, fmt.Errorf("mangaoni pages: %w", err)
	}

	match := unicapRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil, fmt.Errorf("mangaoni: chapter payload not found")
	}

	decoded, err := base64.StdEncoding.DecodeString(match[1])
	if err != nil {
		return nil, fmt.Errorf("mangaoni decode: %w", err)
	}

	parts := strings.Split(string(decoded), "||")
	if len(parts) < 2 {
		return nil, fmt.Errorf("mangaoni: malformed page payload")
	}

	dir := strings.TrimSpace(parts[0])
	files, err := parsePageList(parts[1])
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("mangaoni: no page files found")
	}

	pages := make([]extensions.PageSource, 0, len(files))
	for i, file := range files {
		file = strings.TrimSpace(file)
		if file == "" {
			continue
		}
		pages = append(pages, extensions.PageSource{
			URL:   joinURL(dir, file),
			Index: i,
		})
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("mangaoni: no valid pages found")
	}

	storePageCache(chapterURL, pages)
	return pages, nil
}

func cachedSearchTokenValue() (string, error) {
	tokenMu.Lock()
	cached := searchToken
	tokenMu.Unlock()

	if cached.token != "" && time.Now().Before(cached.expires) {
		return cached.token, nil
	}

	body, err := fetchPage(baseURL+"/", baseURL+"/")
	if err != nil {
		return "", err
	}

	match := csrfTokenRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return "", fmt.Errorf("mangaoni csrf token not found")
	}

	token := strings.TrimSpace(match[1])
	tokenMu.Lock()
	searchToken = cachedToken{token: token, expires: time.Now().Add(searchBootstrapTTL)}
	tokenMu.Unlock()
	return token, nil
}

func fetchPage(pageURL, referer string) (string, error) {
	return sourceaccess.FetchHTML(sourceID, pageURL, sourceaccess.RequestOptions{
		Referer: referer,
		Headers: map[string]string{
			"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
			"Accept-Language":           "es-419,es;q=0.9,en;q=0.8",
			"Upgrade-Insecure-Requests": "1",
			"Sec-Fetch-Dest":            "document",
			"Sec-Fetch-Mode":            "navigate",
			"Sec-Fetch-Site":            "same-origin",
			"Cache-Control":             "max-age=0",
		},
	})
}

func normalizeMangaURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return strings.TrimRight(raw, "/") + "/"
	}
	if strings.HasPrefix(raw, "/") {
		return baseURL + strings.TrimRight(raw, "/") + "/"
	}
	return baseURL + "/" + strings.TrimRight(raw, "/") + "/"
}

func normalizeChapterURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		if strings.HasPrefix(raw, "/") {
			raw = baseURL + raw
		} else {
			raw = baseURL + "/" + raw
		}
	}
	if strings.Contains(raw, "/p") || strings.HasSuffix(strings.TrimRight(raw, "/"), "/cascada") {
		return strings.TrimRight(raw, "/") + "/"
	}
	return strings.TrimRight(raw, "/") + "/"
}

func parseChapterNumber(raw string) float64 {
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0
	}
	return n
}

func buildDescription(alterno, autor string) string {
	parts := make([]string, 0, 2)
	if alterno != "" {
		parts = append(parts, "Alterno: "+alterno)
	}
	if autor != "" {
		parts = append(parts, "Autor: "+autor)
	}
	return strings.Join(parts, " | ")
}

func cleanText(raw string) string {
	raw = html.UnescapeString(raw)
	raw = strings.ReplaceAll(raw, "\u00a0", " ")
	raw = strings.TrimSpace(raw)
	return strings.Join(strings.Fields(raw), " ")
}

func parsePageList(raw string) ([]string, error) {
	raw = strings.TrimSpace(html.UnescapeString(raw))
	if raw == "" || raw == "[]" {
		return nil, nil
	}

	var pages []string
	if err := json.Unmarshal([]byte(raw), &pages); err == nil {
		return pages, nil
	}

	cleaned := strings.TrimPrefix(raw, `["`)
	cleaned = strings.TrimSuffix(cleaned, `"]`)
	if cleaned == raw {
		return nil, fmt.Errorf("mangaoni: unable to parse page list")
	}
	return strings.Split(cleaned, `","`), nil
}

func joinURL(dir, file string) string {
	if strings.HasSuffix(dir, "/") {
		return dir + strings.TrimLeft(file, "/")
	}
	return dir + "/" + strings.TrimLeft(file, "/")
}

func readSearchCache(query string) ([]extensions.SearchResult, bool) {
	key := strings.ToLower(strings.TrimSpace(query))
	searchCacheMu.Lock()
	defer searchCacheMu.Unlock()

	entry, ok := searchCache[key]
	if !ok || time.Now().After(entry.expires) {
		delete(searchCache, key)
		return nil, false
	}
	return cloneSearchResults(entry.results), true
}

func storeSearchCache(query string, results []extensions.SearchResult) {
	key := strings.ToLower(strings.TrimSpace(query))
	ttl := searchCacheTTL
	if len(results) == 0 {
		ttl = searchMissTTL
	}
	searchCacheMu.Lock()
	searchCache[key] = cachedSearch{
		results: cloneSearchResults(results),
		expires: time.Now().Add(ttl),
	}
	searchCacheMu.Unlock()
}

func readChapterCache(mangaID string) ([]extensions.Chapter, bool) {
	chapterCacheMu.Lock()
	defer chapterCacheMu.Unlock()

	entry, ok := chapterCache[mangaID]
	if !ok || time.Now().After(entry.expires) {
		delete(chapterCache, mangaID)
		return nil, false
	}
	return cloneChapters(entry.chapters), true
}

func storeChapterCache(mangaID string, chapters []extensions.Chapter) {
	ttl := chapterCacheTTL
	if len(chapters) == 0 {
		ttl = chapterMissTTL
	}
	chapterCacheMu.Lock()
	chapterCache[mangaID] = cachedChapters{
		chapters: cloneChapters(chapters),
		expires:  time.Now().Add(ttl),
	}
	chapterCacheMu.Unlock()
}

func readPageCache(chapterURL string) ([]extensions.PageSource, bool) {
	pageCacheMu.Lock()
	defer pageCacheMu.Unlock()

	entry, ok := pageCache[chapterURL]
	if !ok || time.Now().After(entry.expires) {
		delete(pageCache, chapterURL)
		return nil, false
	}
	return clonePages(entry.pages), true
}

func storePageCache(chapterURL string, pages []extensions.PageSource) {
	pageCacheMu.Lock()
	pageCache[chapterURL] = cachedPages{
		pages:   clonePages(pages),
		expires: time.Now().Add(pageCacheTTL),
	}
	pageCacheMu.Unlock()
}

func cloneSearchResults(values []extensions.SearchResult) []extensions.SearchResult {
	if len(values) == 0 {
		return []extensions.SearchResult{}
	}
	out := make([]extensions.SearchResult, len(values))
	copy(out, values)
	return out
}

func cloneChapters(values []extensions.Chapter) []extensions.Chapter {
	if len(values) == 0 {
		return []extensions.Chapter{}
	}
	out := make([]extensions.Chapter, len(values))
	copy(out, values)
	return out
}

func clonePages(values []extensions.PageSource) []extensions.PageSource {
	if len(values) == 0 {
		return []extensions.PageSource{}
	}
	out := make([]extensions.PageSource, len(values))
	copy(out, values)
	return out
}
