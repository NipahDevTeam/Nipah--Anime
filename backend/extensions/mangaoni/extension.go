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

	azuretls "github.com/Noooste/azuretls-client"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/httpclient"
)

const baseURL = "https://manga-oni.com"

var (
	csrfTokenRe = regexp.MustCompile(`<meta name="csrf-token" content="([^"]+)"`)
	chapterRe   = regexp.MustCompile(`(?s)<a\s+href="(https://manga-oni\.com/lector/[^"]+/[0-9]+/(?:cascada/|p[0-9]+/?|)?)"[^>]*>.*?<span[^>]*class="timeago"[^>]*data-num="([^"]+)"[^>]*datetime="([^"]+)"[^>]*></span><h3[^>]*class="entry-title-h2">([^<]+)</h3>`)
	unicapRe    = regexp.MustCompile(`var unicap = '([^']+)';`)
)

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "mangaoni-es" }
func (e *Extension) Name() string { return "MangaOni" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}

	token, session, err := newSearchSession()
	if err != nil {
		return nil, fmt.Errorf("mangaoni search init: %w", err)
	}

	form := url.Values{}
	form.Set("buscar", query)
	form.Set("_token", token)

	req := &azuretls.Request{
		Url:    baseURL + "/buscar",
		Method: "POST",
		Body:   form.Encode(),
		OrderedHeaders: azuretls.OrderedHeaders{
			{"Referer", baseURL + "/"},
			{"Origin", baseURL},
			{"Accept", "application/json, text/plain, */*"},
			{"Accept-Language", "es-419,es;q=0.9,en;q=0.8"},
			{"Content-Type", "application/x-www-form-urlencoded; charset=UTF-8"},
			{"X-Requested-With", "XMLHttpRequest"},
		},
	}

	resp, err := session.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mangaoni search request: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("mangaoni search http %d", resp.StatusCode)
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
	if err := json.Unmarshal(resp.Body, &payload); err != nil {
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
	return results, nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	body, err := fetchPage(normalizeMangaURL(mangaID), baseURL+"/")
	if err != nil {
		return nil, fmt.Errorf("mangaoni chapters: %w", err)
	}

	matches := chapterRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil, fmt.Errorf("mangaoni: no chapters found")
	}

	seen := make(map[string]bool)
	chapters := make([]extensions.Chapter, 0, len(matches))
	for _, match := range matches {
		chapterURL := normalizeChapterURL(match[1])
		if seen[chapterURL] {
			continue
		}
		seen[chapterURL] = true

		number := parseChapterNumber(match[2])
		title := cleanText(match[4])
		if title == "" {
			title = fmt.Sprintf("Capítulo %s", strings.TrimSpace(match[2]))
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

	return chapters, nil
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	chapterURL := normalizeChapterURL(chapterID)
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
	return pages, nil
}

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

func newSearchSession() (string, *azuretls.Session, error) {
	session := httpclient.NewSession(15)

	req := &azuretls.Request{
		Url:    baseURL + "/",
		Method: "GET",
		OrderedHeaders: azuretls.OrderedHeaders{
			{"Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
			{"Accept-Language", "es-419,es;q=0.9,en;q=0.8"},
			{"Referer", baseURL + "/"},
		},
	}

	resp, err := session.Do(req)
	if err != nil {
		return "", nil, err
	}
	if resp.StatusCode != 200 {
		return "", nil, fmt.Errorf("mangaoni home http %d", resp.StatusCode)
	}

	match := csrfTokenRe.FindStringSubmatch(string(resp.Body))
	if len(match) < 2 {
		return "", nil, fmt.Errorf("mangaoni csrf token not found")
	}
	return match[1], session, nil
}

func fetchPage(pageURL, referer string) (string, error) {
	return animeflv.FetchPageWithHeaders(pageURL, referer, map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
		"Accept-Language":           "es-419,es;q=0.9,en;q=0.8",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "same-origin",
		"Cache-Control":             "max-age=0",
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
