package templetoons

import (
	"encoding/json"
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
	baseURL   = "https://templetoons.com"
	comicsURL = baseURL + "/comics"
)

var (
	searchItemRe       = regexp.MustCompile(`"title":"([^"]+)","series_slug":"([^"]+)","thumbnail":"([^"]+)"(?:,"badge":"([^"]*)")?`)
	chapterNameRe      = regexp.MustCompile(`"chapter_name":"([^"]+)"`)
	chapterSlugRe      = regexp.MustCompile(`"chapter_slug":"([^"]+)"`)
	chapterCreatedAtRe = regexp.MustCompile(`"created_at":"([^"]+)"`)
	chapterPriceRe     = regexp.MustCompile(`"price":(\d+)`)
	coverMetaRe        = regexp.MustCompile(`<meta property="og:image" content="([^"]+)"`)
	descriptionMetaRe  = regexp.MustCompile(`<meta name="twitter:description" content="([^"]+)"`)
	imagesRe           = regexp.MustCompile(`"images":(\[[^\]]+\])`)
	numberRe           = regexp.MustCompile(`(\d+(?:\.\d+)?)`)
)

type Extension struct{}

type searchCandidate struct {
	title       string
	slug        string
	coverURL    string
	description string
}

type cachedSearchIndex struct {
	items   []searchCandidate
	expires time.Time
}

var (
	searchIndexMu sync.Mutex
	searchIndex   cachedSearchIndex

	chapterCacheMu sync.Mutex
	chapterCache   = map[string]cachedChapters{}

	pageCacheMu sync.Mutex
	pageCache   = map[string]cachedPages{}
)

type cachedChapters struct {
	chapters []extensions.Chapter
	expires  time.Time
}

type cachedPages struct {
	pages   []extensions.PageSource
	expires time.Time
}

func init() {
	sourceaccess.RegisterProfile(sourceaccess.SourceAccessProfile{
		SourceID:             "templetoons-en",
		BaseURL:              baseURL,
		WarmupURL:            comicsURL,
		DefaultReferer:       baseURL + "/",
		CookieDomains:        []string{"templetoons.com", "media.templetoons.com"},
		ChallengeStatusCodes: []int{403},
		ChallengeBodyMarkers: []string{
			"just a moment",
			"enable javascript and cookies to continue",
		},
		ChallengeHeaderMarkers: map[string]string{
			"Cf-Mitigated": "challenge",
		},
	})
}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return "templetoons-en" }
func (e *Extension) Name() string { return "TempleToons" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}

	candidates, err := loadSearchCandidates(e.ID())
	if err != nil {
		return nil, fmt.Errorf("templetoons search: %w", err)
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("templetoons: no searchable series found")
	}

	results := rankSearchCandidates(candidates, query)
	out := make([]extensions.SearchResult, 0, len(results))
	for _, item := range results {
		out = append(out, extensions.SearchResult{
			ID:          item.slug,
			Title:       item.title,
			CoverURL:    item.coverURL,
			Description: item.description,
			Languages:   []extensions.Language{extensions.LangEnglish},
		})
	}
	return out, nil
}

func loadSearchCandidates(sourceID string) ([]searchCandidate, error) {
	searchIndexMu.Lock()
	cached := searchIndex
	searchIndexMu.Unlock()

	if len(cached.items) > 0 && time.Now().Before(cached.expires) {
		return append([]searchCandidate(nil), cached.items...), nil
	}

	body, err := sourceaccess.FetchHTML(sourceID, comicsURL, sourceaccess.RequestOptions{})
	if err != nil {
		return nil, err
	}
	candidates := parseSearchCandidates(normalizePayload(body))

	searchIndexMu.Lock()
	searchIndex = cachedSearchIndex{
		items:   append([]searchCandidate(nil), candidates...),
		expires: time.Now().Add(15 * time.Minute),
	}
	searchIndexMu.Unlock()

	return candidates, nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	slug := normalizeSlug(mangaID)
	if slug == "" {
		return nil, fmt.Errorf("templetoons: invalid manga id")
	}
	if cached, ok := readChapterCache(slug); ok {
		return cached, nil
	}

	body, err := sourceaccess.FetchHTML(e.ID(), baseURL+"/comic/"+slug, sourceaccess.RequestOptions{})
	if err != nil {
		return nil, fmt.Errorf("templetoons chapters: %w", err)
	}
	body = normalizePayload(body)

	names := collectMatches(chapterNameRe, body)
	slugs := collectMatches(chapterSlugRe, body)
	createdAts := collectMatches(chapterCreatedAtRe, body)
	prices := collectMatches(chapterPriceRe, body)

	count := minInt(len(names), len(slugs), len(createdAts), len(prices))
	if count == 0 {
		return nil, fmt.Errorf("templetoons: no chapters found")
	}

	chapters := make([]extensions.Chapter, 0, count)
	seen := map[string]bool{}
	for index := 0; index < count; index++ {
		chapterName := cleanText(names[index])
		chapterSlug := strings.TrimSpace(slugs[index])
		if chapterSlug == "" || seen[chapterSlug] {
			continue
		}
		seen[chapterSlug] = true

		price, _ := strconv.Atoi(prices[index])
		chapters = append(chapters, extensions.Chapter{
			ID:         slug + "/" + chapterSlug,
			Number:     parseChapterNumber(chapterName + " " + chapterSlug),
			Title:      chapterName,
			Language:   extensions.LangEnglish,
			UploadedAt: strings.TrimSpace(createdAts[index]),
			Locked:     price > 0,
			Price:      price,
		})
	}

	sort.Slice(chapters, func(i, j int) bool { return chapters[i].Number < chapters[j].Number })
	storeChapterCache(slug, chapters)
	return chapters, nil
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	slug, chapterSlug, err := splitChapterID(chapterID)
	if err != nil {
		return nil, err
	}
	cacheKey := slug + "/" + chapterSlug
	if cached, ok := readPageCache(cacheKey); ok {
		return cached, nil
	}

	chapterURL := fmt.Sprintf("%s/comic/%s/%s", baseURL, slug, chapterSlug)
	body, err := sourceaccess.FetchHTML(e.ID(), chapterURL, sourceaccess.RequestOptions{})
	if err != nil {
		return nil, fmt.Errorf("templetoons pages: %w", err)
	}
	body = normalizePayload(body)

	match := imagesRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil, fmt.Errorf("templetoons: chapter images not found")
	}

	var images []string
	if err := json.Unmarshal([]byte(match[1]), &images); err != nil {
		return nil, fmt.Errorf("templetoons: page parse failed: %w", err)
	}
	if len(images) == 0 {
		return nil, fmt.Errorf("templetoons: no page images found")
	}

	pages := make([]extensions.PageSource, 0, len(images))
	for index, raw := range images {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		pages = append(pages, extensions.PageSource{
			URL:   sourceaccess.BuildImageProxyURL(e.ID(), raw, chapterURL),
			Index: index,
		})
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("templetoons: no valid page images found")
	}
	storePageCache(cacheKey, pages)
	return pages, nil
}

func parseSearchCandidates(body string) []searchCandidate {
	matches := searchItemRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := map[string]bool{}
	out := make([]searchCandidate, 0, len(matches))
	for _, match := range matches {
		slug := normalizeSlug(match[2])
		if slug == "" || seen[slug] {
			continue
		}
		seen[slug] = true
		title := cleanText(match[1])
		coverURL := strings.TrimSpace(match[3])
		description := cleanText(match[4])
		out = append(out, searchCandidate{
			title:       title,
			slug:        slug,
			coverURL:    coverURL,
			description: description,
		})
	}
	return out
}

func rankSearchCandidates(items []searchCandidate, query string) []searchCandidate {
	queryNorm := normalizeSearch(query)
	if queryNorm == "" {
		return items
	}

	type scored struct {
		item  searchCandidate
		score int
	}

	var ranked []scored
	for _, item := range items {
		titleNorm := normalizeSearch(item.title)
		slugNorm := normalizeSearch(item.slug)

		score := 0
		switch {
		case titleNorm == queryNorm:
			score = 500
		case slugNorm == queryNorm:
			score = 480
		case strings.HasPrefix(titleNorm, queryNorm):
			score = 420
		case strings.HasPrefix(slugNorm, queryNorm):
			score = 390
		case strings.Contains(titleNorm, queryNorm):
			score = 320
		case strings.Contains(slugNorm, queryNorm):
			score = 280
		default:
			continue
		}

		score -= absInt(len(titleNorm) - len(queryNorm))
		ranked = append(ranked, scored{item: item, score: score})
	}

	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score == ranked[j].score {
			return ranked[i].item.title < ranked[j].item.title
		}
		return ranked[i].score > ranked[j].score
	})

	out := make([]searchCandidate, 0, len(ranked))
	for _, item := range ranked {
		out = append(out, item.item)
	}
	return out
}

func normalizeSlug(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL+"/comic/")
	raw = strings.TrimPrefix(raw, "/comic/")
	raw = strings.Trim(raw, "/")
	if idx := strings.Index(raw, "/"); idx >= 0 {
		raw = raw[:idx]
	}
	return raw
}

func splitChapterID(chapterID string) (string, string, error) {
	chapterID = strings.TrimSpace(strings.Trim(chapterID, "/"))
	if chapterID == "" {
		return "", "", fmt.Errorf("templetoons: invalid chapter id")
	}
	parts := strings.Split(chapterID, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("templetoons: malformed chapter id")
	}
	return parts[0], parts[1], nil
}

func parseChapterNumber(raw string) float64 {
	match := numberRe.FindStringSubmatch(raw)
	if len(match) < 2 {
		return 0
	}
	value, _ := strconv.ParseFloat(match[1], 64)
	return value
}

func collectMatches(re *regexp.Regexp, body string) []string {
	matches := re.FindAllStringSubmatch(body, -1)
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		out = append(out, match[1])
	}
	return out
}

func cleanText(raw string) string {
	raw = html.UnescapeString(raw)
	raw = strings.ReplaceAll(raw, "\\u0026", "&")
	raw = strings.ReplaceAll(raw, "\\/", "/")
	raw = strings.TrimSpace(raw)
	return strings.Join(strings.Fields(raw), " ")
}

func normalizeSearch(raw string) string {
	replacer := strings.NewReplacer(
		"-", " ",
		"_", " ",
		".", " ",
		":", " ",
		"'", "",
		"’", "",
		"\"", "",
	)
	raw = replacer.Replace(strings.ToLower(cleanText(raw)))
	return strings.Join(strings.Fields(raw), " ")
}

func normalizePayload(raw string) string {
	replacer := strings.NewReplacer(
		`\"`, `"`,
		`\/`, `/`,
		`\u0026`, "&",
	)
	return replacer.Replace(raw)
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func minInt(values ...int) int {
	if len(values) == 0 {
		return 0
	}
	minimum := values[0]
	for _, value := range values[1:] {
		if value < minimum {
			minimum = value
		}
	}
	return minimum
}

func readChapterCache(slug string) ([]extensions.Chapter, bool) {
	chapterCacheMu.Lock()
	defer chapterCacheMu.Unlock()

	entry, ok := chapterCache[slug]
	if !ok || time.Now().After(entry.expires) {
		delete(chapterCache, slug)
		return nil, false
	}
	return cloneChapters(entry.chapters), true
}

func storeChapterCache(slug string, chapters []extensions.Chapter) {
	if len(chapters) == 0 {
		return
	}
	chapterCacheMu.Lock()
	chapterCache[slug] = cachedChapters{
		chapters: cloneChapters(chapters),
		expires:  time.Now().Add(20 * time.Minute),
	}
	chapterCacheMu.Unlock()
}

func readPageCache(key string) ([]extensions.PageSource, bool) {
	pageCacheMu.Lock()
	defer pageCacheMu.Unlock()

	entry, ok := pageCache[key]
	if !ok || time.Now().After(entry.expires) {
		delete(pageCache, key)
		return nil, false
	}
	return clonePages(entry.pages), true
}

func storePageCache(key string, pages []extensions.PageSource) {
	if len(pages) == 0 {
		return
	}
	pageCacheMu.Lock()
	pageCache[key] = cachedPages{
		pages:   clonePages(pages),
		expires: time.Now().Add(30 * time.Minute),
	}
	pageCacheMu.Unlock()
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

func _unusedTempleRegexes() {
	_ = coverMetaRe
	_ = descriptionMetaRe
}
