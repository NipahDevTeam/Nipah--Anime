package weebcentral

import (
	"encoding/xml"
	"fmt"
	"html"
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
	sourceID         = "weebcentral-en"
	baseURL          = "https://weebcentral.com"
	sitemapURL       = baseURL + "/sitemap.xml"
	inventoryTTL     = 6 * time.Hour
	detailCacheTTL   = 6 * time.Hour
	maxSearchResults = 12
	maxHydratedItems = 6
)

var (
	seriesLocRe      = regexp.MustCompile(`https://weebcentral\.com/series/([^/]+)/([^<]+)`)
	chapterRowRe     = regexp.MustCompile(`(?is)<a[^>]+href="((?:https://weebcentral\.com)?/chapters/[^"]+)"[^>]*>(.*?)</a>`)
	imageRe          = regexp.MustCompile(`(?is)<img[^>]+(?:src|data-src)="([^"]+)"`)
	numberRe         = regexp.MustCompile(`(?i)(?:chapter|chap|ch\.?|episode|ep\.?)\s*#?\s*([0-9]+(?:\.[0-9]+)?)`)
	trailingNumberRe = regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?)`)
	ogTitleRe        = regexp.MustCompile(`(?is)<meta\s+property="og:title"\s+content="([^"]+)"`)
	ogImageRe        = regexp.MustCompile(`(?is)<meta\s+property="og:image"\s+content="([^"]+)"`)
	tagRe            = regexp.MustCompile(`(?s)<[^>]+>`)
	spaceRe          = regexp.MustCompile(`\s+`)
)

type Extension struct{}

type sitemapURLSet struct {
	URLs []struct {
		Loc string `xml:"loc"`
	} `xml:"url"`
}

type inventoryEntry struct {
	ID    string
	Title string
	Score int
}

type seriesMeta struct {
	Title string
	Cover string
}

var (
	inventoryMu    sync.Mutex
	inventoryCache []string
	inventoryUntil time.Time

	detailMu    sync.Mutex
	detailCache = map[string]cachedDetail{}
)

type cachedDetail struct {
	meta    seriesMeta
	expires time.Time
}

func init() {
	sourceaccess.RegisterProfile(sourceaccess.SourceAccessProfile{
		SourceID:             sourceID,
		BaseURL:              baseURL,
		WarmupURL:            baseURL + "/search",
		DefaultReferer:       baseURL + "/search",
		CookieDomains:        []string{"weebcentral.com", "temp.compsci88.com", "hot.planeptune.us"},
		ChallengeStatusCodes: []int{403},
	})
}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return sourceID }
func (e *Extension) Name() string { return "WeebCentral" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}

	seriesIDs, err := loadInventory()
	if err != nil {
		return nil, fmt.Errorf("weebcentral search inventory: %w", err)
	}
	if len(seriesIDs) == 0 {
		return []extensions.SearchResult{}, nil
	}

	candidates := rankInventory(seriesIDs, query)
	if len(candidates) == 0 {
		return []extensions.SearchResult{}, nil
	}
	if len(candidates) > maxSearchResults {
		candidates = candidates[:maxSearchResults]
	}

	results := make([]extensions.SearchResult, 0, len(candidates))
	for index, candidate := range candidates {
		title := candidate.Title
		cover := ""
		if index < maxHydratedItems {
			meta, metaErr := loadSeriesMeta(candidate.ID)
			if metaErr == nil {
				title = bestTitle(meta.Title, title)
				cover = meta.Cover
			}
		}
		results = append(results, extensions.SearchResult{
			ID:        candidate.ID,
			Title:     title,
			CoverURL:  cover,
			Languages: []extensions.Language{extensions.LangEnglish},
		})
	}
	return results, nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	seriesID := normalizeSeriesID(mangaID)
	if seriesID == "" {
		return nil, fmt.Errorf("weebcentral: invalid manga id")
	}

	seriesKey := strings.SplitN(seriesID, "/", 2)[0]
	seriesURL := fmt.Sprintf("%s/series/%s", baseURL, seriesID)
	listURL := fmt.Sprintf("%s/series/%s/full-chapter-list", baseURL, seriesKey)

	body, err := sourceaccess.FetchHTML(sourceID, listURL, sourceaccess.RequestOptions{
		Referer: seriesURL,
	})
	if err != nil {
		body, err = sourceaccess.FetchHTML(sourceID, seriesURL, sourceaccess.RequestOptions{})
		if err != nil {
			return nil, fmt.Errorf("weebcentral chapters: %w", err)
		}
	}

	matches := chapterRowRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		if body != "" && listURL != seriesURL {
			fallbackBody, fallbackErr := sourceaccess.FetchHTML(sourceID, seriesURL, sourceaccess.RequestOptions{})
			if fallbackErr == nil {
				body = fallbackBody
				matches = chapterRowRe.FindAllStringSubmatch(body, -1)
			}
		}
		if len(matches) == 0 {
			return nil, fmt.Errorf("weebcentral: no chapters found")
		}
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
		label := cleanText(match[2])
		number := parseChapterNumber(label)
		if number <= 0 {
			number = parseChapterNumber(chapterURL)
		}
		if number <= 0 {
			continue
		}
		seen[chapterURL] = true
		title := chapterDisplayTitle(label, number)

		chapters = append(chapters, extensions.Chapter{
			ID:       chapterURL,
			Number:   number,
			Title:    title,
			Language: extensions.LangEnglish,
		})
	}

	sort.Slice(chapters, func(i, j int) bool { return chapters[i].Number < chapters[j].Number })
	if len(chapters) == 0 {
		return nil, fmt.Errorf("weebcentral: no valid chapters found")
	}
	return chapters, nil
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	chapterURL := normalizeChapterURL(chapterID)
	if chapterURL == "" {
		return nil, fmt.Errorf("weebcentral: invalid chapter id")
	}

	imagesURL := strings.TrimRight(chapterURL, "/") + "/images?is_prev=False&current_page=1&reading_style=long_strip"
	body, err := sourceaccess.FetchHTML(sourceID, imagesURL, sourceaccess.RequestOptions{Referer: chapterURL})
	if err != nil {
		return nil, fmt.Errorf("weebcentral pages: %w", err)
	}

	rawImages := imageRe.FindAllStringSubmatch(body, -1)
	if len(rawImages) == 0 {
		return nil, fmt.Errorf("weebcentral: no pages found")
	}

	pages := make([]extensions.PageSource, 0, len(rawImages))
	seen := map[string]bool{}
	for _, match := range rawImages {
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
		return nil, fmt.Errorf("weebcentral: no valid pages found")
	}
	return pages, nil
}

func normalizeSeriesID(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL+"/series/")
	raw = strings.TrimPrefix(raw, "/series/")
	raw = strings.Trim(raw, "/")
	parts := strings.Split(raw, "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[0] + "/" + parts[1]
}

func loadInventory() ([]string, error) {
	inventoryMu.Lock()
	if len(inventoryCache) > 0 && time.Now().Before(inventoryUntil) {
		out := append([]string(nil), inventoryCache...)
		inventoryMu.Unlock()
		return out, nil
	}
	inventoryMu.Unlock()

	body, err := sourceaccess.FetchHTML(sourceID, sitemapURL, sourceaccess.RequestOptions{})
	if err != nil {
		return nil, err
	}

	var sitemap sitemapURLSet
	if err := xml.Unmarshal([]byte(body), &sitemap); err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(sitemap.URLs))
	seen := map[string]bool{}
	for _, item := range sitemap.URLs {
		match := seriesLocRe.FindStringSubmatch(strings.TrimSpace(item.Loc))
		if len(match) < 3 {
			continue
		}
		id := normalizeSeriesID(match[1] + "/" + match[2])
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}

	inventoryMu.Lock()
	inventoryCache = append([]string(nil), ids...)
	inventoryUntil = time.Now().Add(inventoryTTL)
	inventoryMu.Unlock()
	return ids, nil
}

func rankInventory(seriesIDs []string, query string) []inventoryEntry {
	queryNorm := normalizeSearch(query)
	ranked := make([]inventoryEntry, 0, len(seriesIDs))
	for _, id := range seriesIDs {
		title := humanizeSlug(strings.SplitN(id, "/", 2)[1])
		score := scoreValue(queryNorm, title)
		if score == 0 {
			score = scoreValue(queryNorm, id)
		}
		if score == 0 {
			continue
		}
		ranked = append(ranked, inventoryEntry{
			ID:    id,
			Title: title,
			Score: score,
		})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].Score == ranked[j].Score {
			return ranked[i].Title < ranked[j].Title
		}
		return ranked[i].Score > ranked[j].Score
	})
	return ranked
}

func loadSeriesMeta(seriesID string) (seriesMeta, error) {
	detailMu.Lock()
	cached, ok := detailCache[seriesID]
	detailMu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.meta, nil
	}

	body, err := sourceaccess.FetchHTML(sourceID, fmt.Sprintf("%s/series/%s", baseURL, seriesID), sourceaccess.RequestOptions{})
	if err != nil {
		return seriesMeta{}, err
	}

	meta := seriesMeta{
		Title: strings.TrimSuffix(cleanText(firstMatch(ogTitleRe, body)), "| Weeb Central"),
		Cover: absoluteURL(firstMatch(ogImageRe, body)),
	}
	detailMu.Lock()
	detailCache[seriesID] = cachedDetail{
		meta:    meta,
		expires: time.Now().Add(detailCacheTTL),
	}
	detailMu.Unlock()
	return meta, nil
}

func normalizeChapterURL(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "/") {
		raw = "/" + raw
	}
	return baseURL + raw
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

func firstMatch(re *regexp.Regexp, raw string) string {
	match := re.FindStringSubmatch(raw)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func parseChapterNumber(raw string) float64 {
	match := numberRe.FindStringSubmatch(raw)
	if len(match) < 2 {
		allMatches := trailingNumberRe.FindAllStringSubmatch(raw, -1)
		if len(allMatches) == 0 {
			return 0
		}
		match = allMatches[len(allMatches)-1]
		if len(match) < 2 {
			return 0
		}
	}
	number, _ := strconv.ParseFloat(strings.TrimSpace(match[1]), 64)
	return number
}

func chapterDisplayTitle(raw string, number float64) string {
	raw = cleanText(raw)
	if strings.Contains(strings.ToLower(raw), "episode") {
		return fmt.Sprintf("Episode %s", formatNumber(number))
	}
	return fmt.Sprintf("Chapter %s", formatNumber(number))
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

func humanizeSlug(raw string) string {
	raw = strings.TrimSpace(strings.Trim(raw, "/"))
	if idx := strings.Index(raw, "?"); idx >= 0 {
		raw = raw[:idx]
	}
	replacer := strings.NewReplacer("-", " ", "_", " ", ".", " ")
	raw = replacer.Replace(raw)
	return strings.Title(strings.Join(strings.Fields(raw), " "))
}

func cleanText(raw string) string {
	raw = html.UnescapeString(raw)
	raw = strings.ReplaceAll(raw, "\\/", "/")
	raw = tagRe.ReplaceAllString(raw, " ")
	raw = spaceRe.ReplaceAllString(raw, " ")
	return strings.TrimSpace(raw)
}

func normalizeSearch(raw string) string {
	replacer := strings.NewReplacer("-", " ", "_", " ", ".", " ", ":", " ", "'", "", "\"", "")
	raw = replacer.Replace(strings.ToLower(cleanText(raw)))
	return strings.Join(strings.Fields(raw), " ")
}

func scoreValue(queryNorm, value string) int {
	valueNorm := normalizeSearch(value)
	if queryNorm == "" || valueNorm == "" {
		return 0
	}
	switch {
	case valueNorm == queryNorm:
		return 500
	case strings.HasPrefix(valueNorm, queryNorm):
		return 410
	case strings.Contains(valueNorm, queryNorm):
		return 320
	case strings.Contains(queryNorm, valueNorm):
		return 240
	default:
		return 0
	}
}

func formatNumber(value float64) string {
	if value == float64(int64(value)) {
		return strconv.FormatInt(int64(value), 10)
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}
