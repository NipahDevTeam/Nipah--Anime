// Package mangadex implements MangaSource for MangaDex (mangadex.org).
// Uses the official public MangaDex API v5.
package mangadex

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"miruro/backend/extensions"
)

const apiBase = "https://api.mangadex.org"

type Extension struct{}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "mangadex-es" }
func (e *Extension) Name() string { return "MangaDex" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish, extensions.LangPortuguese, extensions.LangEnglish}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	if lang == "" {
		lang = extensions.LangSpanish
	}

	// Build search URL — no language filter so we get broad results,
	// but include availableTranslatedLanguage hint for relevance.
	// Limit 32 is MangaDex's practical max for search.
	params := url.Values{}
	params.Set("title", query)
	params.Set("limit", "32")
	params.Set("order[relevance]", "desc")
	params.Add("includes[]", "cover_art")
	params.Add("contentRating[]", "safe")
	params.Add("contentRating[]", "suggestive")
	params.Add("contentRating[]", "erotica")
	// Hint the API toward manga with translations in the requested language
	params.Add("availableTranslatedLanguage[]", normLang(lang))

	endpoint := fmt.Sprintf("%s/manga?%s", apiBase, params.Encode())
	body, err := getJSONWithRetry(endpoint)
	if err != nil {
		return nil, fmt.Errorf("mangadex search: %w", err)
	}

	var resp struct {
		Data []mangaEntry `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("mangadex parse: %w", err)
	}

	// If hint returned too few results, do a second search without language filter
	if len(resp.Data) < 5 {
		params2 := url.Values{}
		params2.Set("title", query)
		params2.Set("limit", "32")
		params2.Set("order[relevance]", "desc")
		params2.Add("includes[]", "cover_art")
		params2.Add("contentRating[]", "safe")
		params2.Add("contentRating[]", "suggestive")
		params2.Add("contentRating[]", "erotica")
		endpoint2 := fmt.Sprintf("%s/manga?%s", apiBase, params2.Encode())
		if body2, err2 := getJSONWithRetry(endpoint2); err2 == nil {
			var resp2 struct{ Data []mangaEntry `json:"data"` }
			if json.Unmarshal(body2, &resp2) == nil && len(resp2.Data) > len(resp.Data) {
				resp.Data = resp2.Data
			}
		}
	}

	out := make([]extensions.SearchResult, 0, len(resp.Data))
	for _, item := range resp.Data {
		out = append(out, extensions.SearchResult{
			ID:          item.ID,
			Title:       item.bestTitle(lang),
			CoverURL:    item.coverURL(),
			Year:        item.Attributes.Year,
			Description: item.bestDesc(lang),
			Languages:   []extensions.Language{lang},
		})
	}
	return out, nil
}

// normLang maps our language codes to MangaDex language codes
func normLang(lang extensions.Language) string {
	switch string(lang) {
	case "pt", "pt-br":
		return "pt-br"
	case "en":
		return "en"
	default:
		return "es"
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapters
// ─────────────────────────────────────────────────────────────────────────────

type Language = extensions.Language

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	if lang == "" {
		lang = extensions.LangSpanish
	}

	// If a specific non-Spanish language is requested, fetch it directly
	if lang != extensions.LangSpanish {
		chapters, err := e.fetchChapters(mangaID, lang)
		if err == nil && len(chapters) > 0 {
			return chapters, nil
		}
		// pt-br fallback to plain pt
		if string(lang) == "pt-br" {
			if chapters, err := e.fetchChapters(mangaID, "pt"); err == nil && len(chapters) > 0 {
				return chapters, nil
			}
		}
		// Return empty — don't fall back to English when user explicitly chose another language
		return []extensions.Chapter{}, nil
	}

	// Spanish: try all variants
	for _, l := range []Language{"es", "es-419", "es-la"} {
		if chapters, err := e.fetchChapters(mangaID, l); err == nil && len(chapters) > 0 {
			return chapters, nil
		}
	}
	// Fallback chain
	for _, l := range []Language{"pt-br", "pt", "en"} {
		if chapters, err := e.fetchChapters(mangaID, l); err == nil && len(chapters) > 0 {
			return chapters, nil
		}
	}
	return nil, fmt.Errorf("no chapters found")
}

func (e *Extension) fetchChapters(mangaID string, lang Language) ([]extensions.Chapter, error) {
	var all []extensions.Chapter
	offset := 0
	limit := 100

	for {
		endpoint := fmt.Sprintf(
			"%s/manga/%s/feed?translatedLanguage[]=%s&order[chapter]=asc&limit=%d&offset=%d&includes[]=scanlation_group",
			apiBase, mangaID, string(lang), limit, offset,
		)
		body, err := getJSONWithRetry(endpoint)
		if err != nil {
			return nil, fmt.Errorf("mangadex chapters: %w", err)
		}

		var resp struct {
			Data  []chapterEntry `json:"data"`
			Total int            `json:"total"`
		}
		if err := json.Unmarshal(body, &resp); err != nil {
			return nil, err
		}

		for _, ch := range resp.Data {
			a := ch.Attributes
			var num float64
			fmt.Sscanf(a.Chapter, "%f", &num)

			var volNum float64
			fmt.Sscanf(a.Volume, "%f", &volNum)

			title := a.Title
			if title == "" {
				if a.Chapter != "" {
					title = "Capítulo " + a.Chapter
				} else {
					title = "Capítulo ?"
				}
			}

			group := ""
			for _, rel := range ch.Relationships {
				if rel.Type == "scanlation_group" && rel.Attributes != nil {
					group = rel.Attributes.Name
					break
				}
			}
			if group != "" {
				title = title + " [" + group + "]"
			}

			all = append(all, extensions.Chapter{
				ID:         ch.ID,
				Number:     num,
				VolumeNum:  volNum,
				Title:      title,
				PageCount:  a.Pages,
				UploadedAt: a.UpdatedAt,
			})
		}

		offset += limit
		if offset >= resp.Total {
			break
		}
	}

	// Deduplicate by chapter number — keep highest page count
	deduped := deduplicateChapters(all)
	return deduped, nil
}

// deduplicateChapters keeps one entry per chapter number, preferring higher page counts
func deduplicateChapters(chapters []extensions.Chapter) []extensions.Chapter {
	seen := map[float64]extensions.Chapter{}
	for _, ch := range chapters {
		if existing, ok := seen[ch.Number]; !ok || ch.PageCount > existing.PageCount {
			seen[ch.Number] = ch
		}
	}
	out := make([]extensions.Chapter, 0, len(seen))
	for _, ch := range seen {
		out = append(out, ch)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Number < out[j].Number })
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	return GetPagesWithQuality(chapterID, false)
}

func GetPagesWithQuality(chapterID string, dataSaver bool) ([]extensions.PageSource, error) {
	endpoint := fmt.Sprintf("%s/at-home/server/%s", apiBase, chapterID)
	body, err := getJSONWithRetry(endpoint)
	if err != nil {
		return nil, fmt.Errorf("mangadex pages: %w", err)
	}

	var resp struct {
		BaseURL string `json:"baseUrl"`
		Chapter struct {
			Hash      string   `json:"hash"`
			Data      []string `json:"data"`
			DataSaver []string `json:"dataSaver"`
		} `json:"chapter"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}

	pages := resp.Chapter.Data
	quality := "data"
	if dataSaver {
		pages = resp.Chapter.DataSaver
		quality = "data-saver"
	}

	out := make([]extensions.PageSource, 0, len(pages))
	for i, filename := range pages {
		out = append(out, extensions.PageSource{
			URL:   fmt.Sprintf("%s/%s/%s/%s", resp.BaseURL, quality, resp.Chapter.Hash, filename),
			Index: i,
		})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed response structs
// ─────────────────────────────────────────────────────────────────────────────

type mangaEntry struct {
	ID         string `json:"id"`
	Attributes struct {
		Title       map[string]string   `json:"title"`
		AltTitles   []map[string]string `json:"altTitles"`
		Description map[string]string   `json:"description"`
		Year        int                 `json:"year"`
		Status      string              `json:"status"`
		LastChapter string              `json:"lastChapter"`
	} `json:"attributes"`
	Relationships []struct {
		ID         string `json:"id"`
		Type       string `json:"type"`
		Attributes *struct {
			FileName string `json:"fileName"`
		} `json:"attributes"`
	} `json:"relationships"`
}

func (m *mangaEntry) bestTitle(lang extensions.Language) string {
	// Try requested language first
	norm := normLang(lang)
	if t := m.Attributes.Title[norm]; t != "" {
		return t
	}
	// Try all alt titles in requested language
	for _, alt := range m.Attributes.AltTitles {
		if t := alt[norm]; t != "" {
			return t
		}
	}
	// Fallback priority: es → pt-br → en → romaji → anything
	for _, l := range []string{"es", "pt-br", "pt", "en", "ja-ro"} {
		if t := m.Attributes.Title[l]; t != "" {
			return t
		}
	}
	for _, v := range m.Attributes.Title {
		if v != "" {
			return v
		}
	}
	return "Sin título"
}

func (m *mangaEntry) bestDesc(lang extensions.Language) string {
	norm := normLang(lang)
	if d := m.Attributes.Description[norm]; d != "" {
		return d
	}
	for _, l := range []string{"es", "pt-br", "pt", "en"} {
		if d := m.Attributes.Description[l]; d != "" {
			return d
		}
	}
	return ""
}

func (m *mangaEntry) coverURL() string {
	for _, rel := range m.Relationships {
		if rel.Type == "cover_art" && rel.Attributes != nil {
			return fmt.Sprintf(
				"https://uploads.mangadex.org/covers/%s/%s.512.jpg",
				m.ID, rel.Attributes.FileName,
			)
		}
	}
	return ""
}

type chapterEntry struct {
	ID         string `json:"id"`
	Attributes struct {
		Chapter   string `json:"chapter"`
		Volume    string `json:"volume"`
		Title     string `json:"title"`
		Pages     int    `json:"pages"`
		UpdatedAt string `json:"updatedAt"`
	} `json:"attributes"`
	Relationships []struct {
		Type       string `json:"type"`
		Attributes *struct {
			Name string `json:"name"`
		} `json:"attributes"`
	} `json:"relationships"`
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP with retry
// ─────────────────────────────────────────────────────────────────────────────

func getJSONWithRetry(endpoint string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
		}
		body, err := getJSON(endpoint)
		if err == nil {
			return body, nil
		}
		lastErr = err
		// Don't retry 4xx errors
		if strings.Contains(err.Error(), "HTTP 4") {
			break
		}
	}
	return nil, lastErr
}

func getJSON(endpoint string) ([]byte, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Nipah-Anime/1.0 (github.com/nipah-anime)")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mangadex request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 429 {
		retryAfter := resp.Header.Get("Retry-After")
		secs := 5
		if retryAfter != "" {
			if n, e := strconv.Atoi(retryAfter); e == nil {
				secs = n
			}
		}
		time.Sleep(time.Duration(secs) * time.Second)
		return nil, fmt.Errorf("HTTP 429 rate limited")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// keep for compatibility
var _ = strconv.Atoi
