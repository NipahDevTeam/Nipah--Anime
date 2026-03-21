package mangapill

import (
	"fmt"
	"html"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"miruro/backend/extensions"
	"miruro/backend/extensions/sourceaccess"
)

const (
	sourceID = "mangapill-en"
	baseURL  = "https://mangapill.com"
)

var (
	searchItemRe   = regexp.MustCompile(`(?is)<a[^>]+href="(/manga/[^"]+)"[^>]*>(.*?)</a>`)
	chapterItemRe  = regexp.MustCompile(`(?is)<a[^>]+href="(/chapters/[^"]+)"[^>]*>(.*?)</a>`)
	imageRe        = regexp.MustCompile(`(?is)<img[^>]+(?:data-src|src)="([^"]+)"`)
	numberRe       = regexp.MustCompile(`(?i)chapter\s+([0-9]+(?:\.[0-9]+)?)`)
	chapterPathRe  = regexp.MustCompile(`/chapters/\d+-([0-9]+(?:\.[0-9]+)?)`)
	tagRe          = regexp.MustCompile(`(?s)<[^>]+>`)
	spaceRe        = regexp.MustCompile(`\s+`)
)

type Extension struct{}

func init() {
	sourceaccess.RegisterProfile(sourceaccess.SourceAccessProfile{
		SourceID:             sourceID,
		BaseURL:              baseURL,
		WarmupURL:            baseURL + "/search?q=one+piece",
		DefaultReferer:       baseURL + "/",
		CookieDomains:        []string{"mangapill.com", "cdn.readdetectiveconan.com"},
		ChallengeStatusCodes: []int{403},
	})
}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return sourceID }
func (e *Extension) Name() string { return "MangaPill" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}

	body, err := sourceaccess.FetchHTML(sourceID, baseURL+"/search?q="+url.QueryEscape(query), sourceaccess.RequestOptions{})
	if err != nil {
		return nil, fmt.Errorf("mangapill search: %w", err)
	}

	matches := searchItemRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return []extensions.SearchResult{}, nil
	}

	results := make([]extensions.SearchResult, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		id := normalizeMangaID(match[1])
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true

		title := bestTitle(cleanTitle(match[2]), humanizeMangaID(id))
		cover := absoluteURL(firstImage(match[2]))

		results = append(results, extensions.SearchResult{
			ID:        id,
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangEnglish},
		})
	}
	return results, nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	mangaID = normalizeMangaID(mangaID)
	if mangaID == "" {
		return nil, fmt.Errorf("mangapill: invalid manga id")
	}

	body, err := sourceaccess.FetchHTML(sourceID, baseURL+mangaID, sourceaccess.RequestOptions{})
	if err != nil {
		return nil, fmt.Errorf("mangapill chapters: %w", err)
	}

	matches := chapterItemRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil, fmt.Errorf("mangapill: no chapters found")
	}

	chapters := make([]extensions.Chapter, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		chapterURL := normalizeChapterURL(match[1])
		if chapterURL == "" || seen[chapterURL] {
			continue
		}
		seen[chapterURL] = true

		text := cleanText(match[2])
		number := parseChapterNumber(text, chapterURL)
		if number <= 0 {
			continue
		}
		title := strings.TrimSpace(numberRe.ReplaceAllString(text, ""))
		title = strings.TrimLeft(title, ":- ")
		if title == "" {
			title = fmt.Sprintf("Chapter %s", formatNumber(number))
		}

		chapters = append(chapters, extensions.Chapter{
			ID:       chapterURL,
			Number:   number,
			Title:    title,
			Language: extensions.LangEnglish,
		})
	}

	sort.Slice(chapters, func(i, j int) bool { return chapters[i].Number < chapters[j].Number })
	if len(chapters) == 0 {
		return nil, fmt.Errorf("mangapill: no valid chapters found")
	}
	return chapters, nil
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	chapterURL := normalizeChapterURL(chapterID)
	if chapterURL == "" {
		return nil, fmt.Errorf("mangapill: invalid chapter id")
	}

	body, err := sourceaccess.FetchHTML(sourceID, chapterURL, sourceaccess.RequestOptions{})
	if err != nil {
		return nil, fmt.Errorf("mangapill pages: %w", err)
	}

	matches := imageRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil, fmt.Errorf("mangapill: no pages found")
	}

	pages := make([]extensions.PageSource, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		raw := absoluteURL(match[1])
		if raw == "" || seen[raw] {
			continue
		}
		seen[raw] = true
		pages = append(pages, extensions.PageSource{
			URL:   sourceaccess.BuildImageProxyURL(sourceID, raw, chapterURL),
			Index: len(pages),
		})
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("mangapill: no valid pages found")
	}
	return pages, nil
}

func normalizeMangaID(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL)
	raw = strings.Trim(raw, "/")
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "manga/") {
		return ""
	}
	return "/" + raw
}

func normalizeChapterURL(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL)
	raw = strings.Trim(raw, "/")
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "chapters/") {
		return ""
	}
	return baseURL + "/" + raw
}

func absoluteURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	if strings.HasPrefix(raw, "/") {
		return baseURL + raw
	}
	return baseURL + "/" + strings.TrimPrefix(raw, "./")
}

func firstImage(raw string) string {
	match := imageRe.FindStringSubmatch(raw)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func cleanTitle(raw string) string {
	text := cleanText(raw)
	if text == "" {
		return ""
	}
	lines := strings.Split(text, " ")
	return strings.Join(lines, " ")
}

func cleanText(raw string) string {
	raw = html.UnescapeString(raw)
	raw = tagRe.ReplaceAllString(raw, " ")
	raw = strings.ReplaceAll(raw, "\\/", "/")
	raw = spaceRe.ReplaceAllString(raw, " ")
	return strings.TrimSpace(raw)
}

func humanizeMangaID(mangaID string) string {
	mangaID = strings.Trim(mangaID, "/")
	parts := strings.Split(mangaID, "/")
	if len(parts) < 3 {
		return ""
	}
	replacer := strings.NewReplacer("-", " ", "_", " ", ".", " ")
	return strings.Title(strings.Join(strings.Fields(replacer.Replace(parts[2])), " "))
}

func bestTitle(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func parseChapterNumber(text, chapterURL string) float64 {
	if match := numberRe.FindStringSubmatch(text); len(match) >= 2 {
		if number, err := strconv.ParseFloat(strings.TrimSpace(match[1]), 64); err == nil {
			return number
		}
	}
	if match := chapterPathRe.FindStringSubmatch(chapterURL); len(match) >= 2 {
		if number, err := strconv.ParseFloat(strings.TrimSpace(match[1]), 64); err == nil {
			return number / 1000
		}
	}
	return 0
}

func formatNumber(value float64) string {
	if value == float64(int64(value)) {
		return strconv.FormatInt(int64(value), 10)
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}
