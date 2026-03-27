// Package m440 implements MangaSource for M440 (m440.in).
// M440 is a Spanish manga reader with server-side rendered pages.
//
// URL patterns:
//
//	Search   : GET /search?q={query}  → HTML with .media cards
//	Chapters : GET /manga/{slug}      → HTML with /manga/{slug}/{chapter_slug} links
//	Pages    : GET /manga/{slug}/{chapter_slug}/1 → HTML with JS pages[] array
//	Images   : https://s1.m440.in/uploads/manga/{slug}/chapters/{chapter_slug}/{filename}
package m440

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	neturl "net/url"
	"regexp"
	"strings"
	"time"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

const (
	baseURL = "https://m440.in"
	cdnURL  = "https://s1.m440.in"
)

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "m440-es" }
func (e *Extension) Name() string { return "M440 (Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — GET /search?q={query}
//
// The endpoint returns JSON for XHR requests (autocomplete) with entries:
//   [{"value":"Naruto","data":"naruto"}, ...]
// where "data" is the manga slug. We prefer this over HTML scraping.
// Fallback: parse HTML cards (.media-heading a.chart-title[href="/manga/{slug}"]).
// ─────────────────────────────────────────────────────────────────────────────

var htmlLinkRe = regexp.MustCompile(`href="(?:https://m440\.in)?/manga/([a-zA-Z0-9_-]+)"`)
var htmlTitleRe = regexp.MustCompile(`<strong>([^<]+)</strong>`)
var htmlImgRe = regexp.MustCompile(`src="(/uploads/manga/[^"]+/cover/[^"]+)"`)

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	url := fmt.Sprintf("%s/search?q=%s", baseURL, urlEncode(query))

	// Try JSON autocomplete (XHR request)
	jsonBody, err := fetchAJAX(url)
	if err == nil && strings.HasPrefix(strings.TrimSpace(jsonBody), "[") {
		results := parseSearchJSON(jsonBody)
		if len(results) > 0 {
			return results, nil
		}
	}

	// Fallback: HTML scraping
	htmlBody, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("m440 search: %w", err)
	}
	return parseSearchHTML(htmlBody), nil
}

func parseSearchJSON(body string) []extensions.SearchResult {
	var items []struct {
		Value string `json:"value"`
		Data  string `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &items); err != nil {
		return nil
	}

	var results []extensions.SearchResult
	seen := map[string]bool{}
	for _, item := range items {
		if item.Data == "" || seen[item.Data] {
			continue
		}
		seen[item.Data] = true
		results = append(results, extensions.SearchResult{
			ID:        "/manga/" + item.Data,
			Title:     item.Value,
			CoverURL:  fmt.Sprintf("%s/uploads/manga/%s/cover/cover_250x350.jpg", baseURL, item.Data),
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return results
}

func parseSearchHTML(body string) []extensions.SearchResult {
	slugMatches := htmlLinkRe.FindAllStringSubmatch(body, 60)
	titleMatches := htmlTitleRe.FindAllStringSubmatch(body, 60)
	imgMatches := htmlImgRe.FindAllStringSubmatch(body, 60)

	var results []extensions.SearchResult
	seen := map[string]bool{}

	for i, sm := range slugMatches {
		if len(sm) < 2 || seen[sm[1]] {
			continue
		}
		slug := sm[1]
		seen[slug] = true

		title := ""
		if i < len(titleMatches) && len(titleMatches[i]) >= 2 {
			title = strings.TrimSpace(titleMatches[i][1])
		}
		if title == "" {
			title = slugToTitle(slug)
		}

		cover := fmt.Sprintf("%s/uploads/manga/%s/cover/cover_250x350.jpg", baseURL, slug)
		if i < len(imgMatches) && len(imgMatches[i]) >= 2 {
			cover = baseURL + imgMatches[i][1]
		}

		results = append(results, extensions.SearchResult{
			ID:        "/manga/" + slug,
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangSpanish},
		})
	}
	return results
}

func slugToTitle(slug string) string {
	parts := strings.Split(slug, "-")
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapters — GET /manga/{slug}
//
// Chapter links appear as:
//   href="/manga/{slug}/{chapter_num}-{hash}"  (absolute)
//   href="{slug}/{chapter_num}-{hash}"         (relative, resolved against page)
//
// We extract the chapter slug and parse the leading number for chapter number.
// ─────────────────────────────────────────────────────────────────────────────

var chNumRe = regexp.MustCompile(`^(\d+(?:\.\d+)?)`)
var jsChapterTempRe = regexp.MustCompile(`(?:const|var)\s+jschaptertemp\s*=\s*(\[[\s\S]+?\]);`)

type chapterPayload struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Number    string `json:"number"`
	Volume    string `json:"volume"`
	CreatedAt string `json:"created_at"`
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	// mangaID is "/manga/{slug}"
	slug := strings.TrimPrefix(mangaID, "/manga/")
	url := fmt.Sprintf("%s/manga/%s", baseURL, slug)
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("m440 chapters: %w", err)
	}

	if chapters := parseJSChapters(body, slug); len(chapters) > 0 {
		return chapters, nil
	}

	// The rendered HTML only shows a paginated recent slice plus an injected
	// first chapter, so prefer the runtime JS payload before scraping links.
	if chapters := browserChapters(url, slug); len(chapters) > 0 {
		return chapters, nil
	}

	// Match chapter links: /manga/{slug}/{chapter_slug}
	// The chapter_slug may appear as absolute (/manga/{slug}/...) or relative ({slug}/...)
	chapterLinkRe := regexp.MustCompile(
		`href="(?:(?:https://m440\.in)?/manga/` + regexp.QuoteMeta(slug) + `/|` + regexp.QuoteMeta(slug) + `/)([a-zA-Z0-9_.-]+)"`,
	)

	var chapters []extensions.Chapter
	seen := map[string]bool{}

	for _, m := range chapterLinkRe.FindAllStringSubmatch(body, 2000) {
		if len(m) < 2 || seen[m[1]] {
			continue
		}
		chapterSlug := m[1]
		seen[chapterSlug] = true

		// Extract number from slug prefix (e.g. "1-j462y" → 1, "1000f" → 1000)
		var num float64
		if nm := chNumRe.FindStringSubmatch(chapterSlug); len(nm) >= 2 {
			if _, err := fmt.Sscanf(nm[1], "%f", &num); err != nil {
				num = 0
			}
		}
		if num <= 0 {
			continue
		}

		chapters = append(chapters, extensions.Chapter{
			ID:       fmt.Sprintf("/manga/%s/%s", slug, chapterSlug),
			Number:   num,
			Title:    fmt.Sprintf("Capítulo %g", num),
			Language: extensions.LangSpanish,
		})
	}

	// Sort ascending
	for i := 0; i < len(chapters); i++ {
		for j := i + 1; j < len(chapters); j++ {
			if chapters[i].Number > chapters[j].Number {
				chapters[i], chapters[j] = chapters[j], chapters[i]
			}
		}
	}

	if len(chapters) == 0 {
		return nil, fmt.Errorf("m440: no chapters found for %s", mangaID)
	}
	return chapters, nil
}

func parseJSChapters(body, slug string) []extensions.Chapter {
	match := jsChapterTempRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil
	}
	return parseChapterPayloads(match[1], slug)
}

func parseChapterPayloads(rawJSON, slug string) []extensions.Chapter {
	var raw []chapterPayload
	if err := json.Unmarshal([]byte(rawJSON), &raw); err != nil {
		return nil
	}

	var chapters []extensions.Chapter
	seen := map[string]bool{}
	for _, chapter := range raw {
		if chapter.Slug == "" || seen[chapter.Slug] {
			continue
		}
		number := parseChapterNumber(chapter.Number)
		if number <= 0 {
			number = parseChapterNumber(chapter.Slug)
		}
		if number <= 0 {
			continue
		}
		seen[chapter.Slug] = true

		title := strings.TrimSpace(chapter.Name)
		if title == "" {
			title = fmt.Sprintf("Capítulo %g", number)
		}

		chapters = append(chapters, extensions.Chapter{
			ID:         fmt.Sprintf("/manga/%s/%s", slug, chapter.Slug),
			Number:     number,
			Title:      title,
			Language:   extensions.LangSpanish,
			UploadedAt: chapter.CreatedAt,
		})
	}

	sortChaptersAscending(chapters)
	return chapters
}

func browserChapters(pageURL, slug string) []extensions.Chapter {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil
	}

	l := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check")

	controlURL, err := l.Launch()
	if err != nil {
		return nil
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil
	}
	defer browser.Close()

	page, err := browser.Page(proto.TargetCreateTarget{URL: pageURL})
	if err != nil {
		return nil
	}
	defer page.Close()

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		result, evalErr := page.Eval(`() => typeof jschaptertemp !== "undefined" ? JSON.stringify(jschaptertemp) : ""`)
		if evalErr == nil {
			if payload := strings.TrimSpace(result.Value.Str()); payload != "" && payload != "null" && payload != "undefined" {
				if chapters := parseChapterPayloads(payload, slug); len(chapters) > 0 {
					return chapters
				}
			}
		}
		time.Sleep(400 * time.Millisecond)
	}

	return nil
}

func parseChapterNumber(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if nm := chNumRe.FindStringSubmatch(raw); len(nm) >= 2 {
		var num float64
		if _, err := fmt.Sscanf(nm[1], "%f", &num); err != nil {
			num = 0
		}
		return num
	}
	return 0
}

func sortChaptersAscending(chapters []extensions.Chapter) {
	for i := 0; i < len(chapters); i++ {
		for j := i + 1; j < len(chapters); j++ {
			if chapters[i].Number > chapters[j].Number {
				chapters[i], chapters[j] = chapters[j], chapters[i]
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages — GET /manga/{slug}/{chapter_slug}/1
//
// The reader page contains a JS array:
//   var pages = [{page_image:"38899_1.jpg", page_slug:"1", external:"0"}, ...]
//
// Image URL: https://s1.m440.in/uploads/manga/{slug}/chapters/{chapter_slug}/{page_image}
// ─────────────────────────────────────────────────────────────────────────────

var pagesArrayRe = regexp.MustCompile(`var\s+pages\s*=\s*(\[[\s\S]+?\]);`)

type pagePayload struct {
	PageImage string `json:"page_image"`
	PageSlug  string `json:"page_slug"`
	External  string `json:"external"`
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	// chapterID is "/manga/{slug}/{chapter_slug}"
	// e.g. "/manga/naruto/1-j462y"
	parts := strings.Split(strings.TrimPrefix(chapterID, "/manga/"), "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("m440: invalid chapterID: %s", chapterID)
	}
	slug := parts[0]
	chapterSlug := parts[1]

	// Fetch page 1 of the reader
	url := fmt.Sprintf("%s/manga/%s/%s/1", baseURL, slug, chapterSlug)
	body, err := fetchPage(url, baseURL)
	if err != nil {
		return nil, fmt.Errorf("m440 pages: %w", err)
	}

	var pagePayloads []pagePayload
	if m := pagesArrayRe.FindStringSubmatch(body); len(m) >= 2 {
		_ = json.Unmarshal([]byte(m[1]), &pagePayloads)
	}

	if len(pagePayloads) == 0 {
		return nil, fmt.Errorf("m440: no pages found for %s", chapterID)
	}

	pages := make([]extensions.PageSource, 0, len(pagePayloads))
	for i, payload := range pagePayloads {
		imgURL := decodeM440PageURL(payload.PageImage, slug, chapterSlug)
		if imgURL == "" {
			continue
		}
		pages = append(pages, extensions.PageSource{
			URL:   imgURL,
			Index: i,
		})
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("m440: no decoded page URLs found for %s", chapterID)
	}
	return pages, nil
}

func decodeM440PageURL(raw, slug, chapterSlug string) string {
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		encoded := strings.TrimPrefix(raw, "https://")
		encoded = strings.TrimPrefix(encoded, "http://")
		if decoded, err := base64.StdEncoding.DecodeString(encoded); err == nil {
			if direct, err := neturl.QueryUnescape(string(decoded)); err == nil && strings.HasPrefix(direct, "http") {
				return direct
			}
		}
		if strings.Contains(raw, "/uploads/manga/") {
			return raw
		}
	}
	return fmt.Sprintf("%s/uploads/manga/%s/chapters/%s/%s", cdnURL, slug, chapterSlug, raw)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func fetchPage(url, referer string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, referer, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language":           "es-ES,es;q=0.9",
		"Upgrade-Insecure-Requests": "1",
	})
}

func fetchAJAX(url string) (string, error) {
	return animeflv.FetchPageWithHeaders(url, baseURL, map[string]string{
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
