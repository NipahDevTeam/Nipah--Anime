// Package m440 implements MangaSource for M440 (m440.in).
// M440 is a Spanish manga reader with server-side rendered pages.
//
// URL patterns:
//
//	Search   : GET /search?q={query}      -> HTML with .media cards / XHR JSON
//	Chapters : GET /manga/{slug}          -> HTML with chapter links and sometimes jschaptertemp
//	Pages    : GET /manga/{slug}/{ch}/1   -> HTML with JS pages[] array
//	Images   : https://s1.m440.in/uploads/manga/{slug}/chapters/{ch}/{filename}
package m440

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	neturl "net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"golang.org/x/sync/singleflight"

	"miruro/backend/extensions"
	"miruro/backend/extensions/sourceaccess"
	"miruro/backend/logger"
)

const (
	sourceID                = "m440-es"
	baseURL                 = "https://m440.in"
	cdnURL                  = "https://s1.m440.in"
	searchCacheTTL          = 12 * time.Minute
	searchMissTTL           = 15 * time.Second
	chapterCacheTTL         = 30 * time.Minute
	chapterMissTTL          = 15 * time.Second
	pageCacheTTL            = 45 * time.Minute
	browserChapterCacheTTL  = 60 * time.Minute
	browserRequiredCacheTTL = 90 * time.Minute
	partialChapterCacheTTL  = 45 * time.Second
	sharedBrowserTTL        = 20 * time.Minute
	fastBrowserWait         = 4 * time.Second
)

var log = logger.For("m440")

var (
	htmlLinkRe       = regexp.MustCompile(`href="(?:https://m440\.in)?/manga/([a-zA-Z0-9_-]+)"`)
	htmlTitleRe      = regexp.MustCompile(`<strong>([^<]+)</strong>`)
	htmlImgRe        = regexp.MustCompile(`src="(/uploads/manga/[^"]+/cover/[^"]+)"`)
	chLabelNumRe     = regexp.MustCompile(`(?i)(?:cap[ií]tulo|cap|chapter|ch|episodio|episode|ep)[\s._-]*#?[\s._-]*(\d+(?:\.\d+)?)`)
	leadingNumRe     = regexp.MustCompile(`^(\d+(?:\.\d+)?)`)
	anyNumRe         = regexp.MustCompile(`(\d+(?:\.\d+)?)`)
	jsChapterTempRe  = regexp.MustCompile(`(?:const|var|let)\s+jschaptertemp\s*=\s*(\[[\s\S]+?\]);`)
	chapterHrefRe    = regexp.MustCompile(`href="(?:(?:https://m440\.in)?/manga/)?([a-zA-Z0-9_-]+)/([a-zA-Z0-9_.-]+)"`)
	pagesArrayRe     = regexp.MustCompile(`var\s+pages\s*=\s*(\[[\s\S]+?\]);`)
	renderedAnchorRe = regexp.MustCompile(`(?is)<a[^>]+href="(?:(?:https://m440\.in)?/manga/)?([a-zA-Z0-9_-]+)/([a-zA-Z0-9_.-]+)"[^>]*>(.*?)</a>`)
	renderedTagRe    = regexp.MustCompile(`(?s)<[^>]+>`)
	recentSliceRe    = regexp.MustCompile(`(?is)(cap[ií]tulos?\s+recientes|u[ú]ltimos?\s+cap[ií]tulos|latest\s+chapters|recent\s+chapters|primer\s+cap[ií]tulo|first\s+chapter)`)
	showMoreRe       = regexp.MustCompile(`(?is)(ver\s+m[aá]s\s+cap[ií]tulos|mostrar\s+m[aá]s|cargar\s+m[aá]s|show\s+all\s+chapters|full\s+chapter\s+list|chapter-list-pagination|data-page=|page-item|page-link)`)
)

var (
	searchCacheMu sync.Mutex
	searchCache   = map[string]cachedSearch{}
	searchGroup   singleflight.Group

	chapterCacheMu sync.Mutex
	chapterCache   = map[string]cachedChapterResult{}
	chapterGroup   singleflight.Group

	browserCacheMu      sync.Mutex
	browserChapterCache = map[string]cachedChapters{}
	browserRequired     = map[string]time.Time{}
	browserWarmGroup    singleflight.Group

	pageCacheMu sync.Mutex
	pageCache   = map[string]cachedPages{}
	pageGroup   singleflight.Group

	browserMu         sync.Mutex
	sharedBrowser     *rod.Browser
	sharedBrowserStop *time.Timer
	sharedBrowserTill time.Time
)

type Extension struct{}

type chapterPayload struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Number    string `json:"number"`
	Volume    string `json:"volume"`
	CreatedAt string `json:"created_at"`
}

type pagePayload struct {
	PageImage string `json:"page_image"`
	PageSlug  string `json:"page_slug"`
	External  string `json:"external"`
}

type cachedSearch struct {
	Results []extensions.SearchResult
	Expires time.Time
}

type cachedChapterResult struct {
	Chapters  []extensions.Chapter
	Expires   time.Time
	Miss      bool
	Partial   bool
	Hydrating bool
}

type cachedChapters struct {
	Chapters []extensions.Chapter
	Expires  time.Time
}

type cachedPages struct {
	Pages   []extensions.PageSource
	Expires time.Time
}

func init() {
	sourceaccess.RegisterProfile(sourceaccess.SourceAccessProfile{
		SourceID:             sourceID,
		BaseURL:              baseURL,
		WarmupURL:            baseURL + "/search?q=one+piece",
		DefaultReferer:       baseURL + "/",
		CookieDomains:        []string{"m440.in", "s1.m440.in"},
		ChallengeStatusCodes: []int{403},
		ChallengeBodyMarkers: []string{
			"just a moment",
			"enable javascript and cookies to continue",
			"cf-mitigated",
		},
	})
}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return sourceID }
func (e *Extension) Name() string { return "M440 (Español)" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

type htmlCompleteness struct {
	mode            string
	requiresBrowser bool
}

type browserChapterMetrics struct {
	SnapshotCount     int
	TotalPages        int
	PayloadMode       string
	PayloadPage       int
	PayloadReadyAfter time.Duration
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}

	cacheKey := strings.ToLower(query)
	if cached, origin, ok := readSearchCache(cacheKey); ok {
		log.Debug().Str("query", query).Str("cache", origin).Int("results", len(cached)).Msg("m440 search cache")
		return cached, nil
	}

	result, err, _ := searchGroup.Do(cacheKey, func() (interface{}, error) {
		if cached, _, ok := readSearchCache(cacheKey); ok {
			return cached, nil
		}

		started := time.Now()
		url := fmt.Sprintf("%s/search?q=%s", baseURL, urlEncode(query))

		jsonBody, ajaxErr := fetchAJAX(url)
		if ajaxErr == nil && strings.HasPrefix(strings.TrimSpace(jsonBody), "[") {
			results := parseSearchJSON(jsonBody)
			if len(results) > 0 {
				storeSearchCache(cacheKey, results, searchCacheTTL)
				log.Debug().
					Str("source_id", sourceID).
					Str("operation", "search").
					Str("query", query).
					Str("mode", "json").
					Str("cache_origin", "network").
					Bool("browser_used", false).
					Int("result_count", len(results)).
					Dur("took", time.Since(started)).
					Msg("m440 search")
				return results, nil
			}
		}

		htmlBody, htmlErr := fetchPage(url, baseURL)
		if htmlErr != nil {
			return nil, fmt.Errorf("m440 search: %w", htmlErr)
		}

		results := parseSearchHTML(htmlBody)
		ttl := searchCacheTTL
		cacheOrigin := "network"
		if len(results) == 0 {
			ttl = searchMissTTL
			cacheOrigin = "short_miss"
		}
		storeSearchCache(cacheKey, results, ttl)
		log.Debug().
			Str("source_id", sourceID).
			Str("operation", "search").
			Str("query", query).
			Str("mode", "html").
			Str("cache_origin", cacheOrigin).
			Bool("browser_used", false).
			Int("result_count", len(results)).
			Dur("took", time.Since(started)).
			Msg("m440 search")
		return results, nil
	})
	if err != nil {
		return nil, err
	}
	return cloneSearchResults(result.([]extensions.SearchResult)), nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	slug := normalizeSlug(mangaID)
	if slug == "" {
		return nil, fmt.Errorf("m440: invalid manga id")
	}

	if cached, origin, miss, partial, hydrating, ok := readChapterCache(slug); ok {
		if miss {
			return nil, fmt.Errorf("m440: no chapters found for %s", mangaID)
		}
		if !partial {
			log.Debug().
				Str("source_id", sourceID).
				Str("operation", "chapters").
				Str("slug", slug).
				Str("cache_origin", origin).
				Str("completeness_mode", "cache_hit").
				Bool("browser_used", false).
				Bool("partial", false).
				Bool("hydrating", hydrating).
				Int("result_count", len(cached)).
				Msg("m440 chapters")
			return cached, nil
		}
		cacheMode := "cache_hit"
		if partial {
			cacheMode = "cache_partial"
		}
		log.Debug().
			Str("source_id", sourceID).
			Str("operation", "chapters").
			Str("slug", slug).
			Str("cache_origin", origin).
			Str("completeness_mode", cacheMode).
			Bool("browser_used", false).
			Bool("partial", partial).
			Bool("hydrating", hydrating).
			Int("result_count", len(cached)).
			Msg("m440 chapters")
		if browserCached, ok := readBrowserChapterCache(slug); ok && len(browserCached) > 0 {
			storeChapterCache(slug, browserCached, chapterCacheTTL)
			return browserCached, nil
		}
	}

	result, err, _ := chapterGroup.Do(slug, func() (interface{}, error) {
		if cached, _, miss, partial, _, ok := readChapterCache(slug); ok {
			if miss {
				return nil, fmt.Errorf("m440: no chapters found for %s", mangaID)
			}
			if !partial {
				return cached, nil
			}
		}

		started := time.Now()
		pageURL := fmt.Sprintf("%s/manga/%s", baseURL, slug)
		if browserCached, ok := readBrowserChapterCache(slug); ok {
			storeChapterCache(slug, browserCached, chapterCacheTTL)
			log.Debug().
				Str("source_id", sourceID).
				Str("operation", "chapters").
				Str("slug", slug).
				Str("completeness_mode", "browser_cache").
				Str("cache_origin", "cache_hit").
				Bool("browser_used", true).
				Int("result_count", len(browserCached)).
				Dur("took", time.Since(started)).
				Msg("m440 chapters")
			return browserCached, nil
		}

		browserForced := requiresBrowserFallback(slug)
		if browserForced {
			chapters, browserTook, browserMetrics, err := loadBrowserChapters(pageURL, slug, started, true)
			if err != nil {
				return nil, err
			}
			log.Debug().
				Str("source_id", sourceID).
				Str("operation", "chapters").
				Str("slug", slug).
				Str("completeness_mode", "browser_required").
				Str("cache_origin", "network").
				Bool("browser_used", true).
				Bool("partial", false).
				Bool("hydrating", false).
				Int("result_count", len(chapters)).
				Int("browser_snapshot_count", browserMetrics.SnapshotCount).
				Int("browser_total_pages", browserMetrics.TotalPages).
				Str("browser_payload_mode", browserMetrics.PayloadMode).
				Int("browser_payload_page", browserMetrics.PayloadPage).
				Dur("browser_payload_ready_after", browserMetrics.PayloadReadyAfter).
				Dur("browser_took", browserTook).
				Dur("took", time.Since(started)).
				Msg("m440 chapters")
			return chapters, nil
		}

		body, fetchErr := fetchPage(pageURL, baseURL)
		if fetchErr != nil {
			return nil, fmt.Errorf("m440 chapters: %w", fetchErr)
		}

		jsParseStarted := time.Now()
		if chapters := parseJSChapters(body, slug); len(chapters) > 0 {
			clearBrowserRequirement(slug)
			storeChapterCache(slug, chapters, chapterCacheTTL)
			log.Debug().
				Str("source_id", sourceID).
				Str("operation", "chapters").
				Str("slug", slug).
				Str("completeness_mode", "inline_js").
				Str("cache_origin", "network").
				Bool("browser_used", false).
				Int("result_count", len(chapters)).
				Dur("js_parse_took", time.Since(jsParseStarted)).
				Dur("took", time.Since(started)).
				Msg("m440 chapters")
			return chapters, nil
		}

		htmlParseStarted := time.Now()
		htmlChapters := mergeChapterLists(parseRenderedChapterList(body, slug), extractHTMLChapters(body, slug))
		completeness := assessHTMLChapterCompleteness(body, htmlChapters)
		if len(htmlChapters) > 0 && !completeness.requiresBrowser {
			clearBrowserRequirement(slug)
			storeChapterCache(slug, htmlChapters, chapterCacheTTL)
			log.Debug().
				Str("source_id", sourceID).
				Str("operation", "chapters").
				Str("slug", slug).
				Str("completeness_mode", completeness.mode).
				Str("cache_origin", "network").
				Bool("browser_used", false).
				Bool("partial", false).
				Bool("hydrating", false).
				Int("result_count", len(htmlChapters)).
				Dur("html_parse_took", time.Since(htmlParseStarted)).
				Dur("took", time.Since(started)).
				Msg("m440 chapters")
			return htmlChapters, nil
		}
		if len(htmlChapters) > 0 && completeness.requiresBrowser {
			storeBrowserRequirement(slug, browserRequiredCacheTTL)
			if ready := startBrowserHydration(pageURL, slug); ready != nil {
				if hydrated, ok, waited := awaitHydratedChapterList(ready, fastBrowserWait); ok {
					mode := "fast_browser"
					if waited {
						mode = "browser_required_waited"
					}
					log.Debug().
						Str("source_id", sourceID).
						Str("operation", "chapters").
						Str("slug", slug).
						Str("completeness_mode", mode).
						Str("cache_origin", "network").
						Bool("browser_used", true).
						Bool("partial", false).
						Bool("hydrating", false).
						Int("result_count", len(hydrated)).
						Dur("html_parse_took", time.Since(htmlParseStarted)).
						Dur("took", time.Since(started)).
						Msg("m440 chapters")
					return hydrated, nil
				}
			}
			if browserCached, ok := readBrowserChapterCache(slug); ok && len(browserCached) > 0 {
				storeChapterCache(slug, browserCached, chapterCacheTTL)
				log.Debug().
					Str("source_id", sourceID).
					Str("operation", "chapters").
					Str("slug", slug).
					Str("completeness_mode", "browser_cache_after_wait").
					Str("cache_origin", "cache_hit").
					Bool("browser_used", true).
					Bool("partial", false).
					Bool("hydrating", false).
					Int("result_count", len(browserCached)).
					Dur("html_parse_took", time.Since(htmlParseStarted)).
					Dur("took", time.Since(started)).
					Msg("m440 chapters")
				return browserCached, nil
			}
			return nil, fmt.Errorf("m440: full chapter list unavailable for %s", slug)
		}

		if browserCached, ok := readBrowserChapterCache(slug); ok {
			storeChapterCache(slug, browserCached, chapterCacheTTL)
			log.Debug().
				Str("source_id", sourceID).
				Str("operation", "chapters").
				Str("slug", slug).
				Str("completeness_mode", "browser_required").
				Str("cache_origin", "cache_hit").
				Bool("browser_used", true).
				Bool("partial", false).
				Bool("hydrating", false).
				Int("result_count", len(browserCached)).
				Dur("took", time.Since(started)).
				Msg("m440 chapters")
			return browserCached, nil
		}

		chapters, browserTook, browserMetrics, err := loadBrowserChapters(pageURL, slug, started, true)
		if err != nil {
			return nil, err
		}
		log.Debug().
			Str("source_id", sourceID).
			Str("operation", "chapters").
			Str("slug", slug).
			Str("completeness_mode", "browser_required").
			Str("cache_origin", "network").
			Bool("browser_used", true).
			Bool("partial", false).
			Bool("hydrating", false).
			Int("result_count", len(chapters)).
			Int("browser_snapshot_count", browserMetrics.SnapshotCount).
			Int("browser_total_pages", browserMetrics.TotalPages).
			Str("browser_payload_mode", browserMetrics.PayloadMode).
			Int("browser_payload_page", browserMetrics.PayloadPage).
			Dur("browser_payload_ready_after", browserMetrics.PayloadReadyAfter).
			Dur("browser_took", browserTook).
			Dur("took", time.Since(started)).
			Msg("m440 chapters")
		return chapters, nil
	})
	if err != nil {
		return nil, err
	}
	return cloneChapters(result.([]extensions.Chapter)), nil
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	parts := strings.Split(strings.TrimPrefix(chapterID, "/manga/"), "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("m440: invalid chapterID: %s", chapterID)
	}
	slug := parts[0]
	chapterSlug := parts[1]
	cacheKey := slug + "/" + chapterSlug

	if cached, origin, ok := readPageCache(cacheKey); ok {
		log.Debug().
			Str("source_id", sourceID).
			Str("operation", "pages").
			Str("chapter", cacheKey).
			Str("cache_origin", origin).
			Bool("browser_used", false).
			Int("result_count", len(cached)).
			Msg("m440 pages")
		return cached, nil
	}

	result, err, _ := pageGroup.Do(cacheKey, func() (interface{}, error) {
		if cached, _, ok := readPageCache(cacheKey); ok {
			return cached, nil
		}

		started := time.Now()
		url := fmt.Sprintf("%s/manga/%s/%s/1", baseURL, slug, chapterSlug)
		body, fetchErr := fetchPage(url, baseURL)
		if fetchErr != nil {
			return nil, fmt.Errorf("m440 pages: %w", fetchErr)
		}

		var pagePayloads []pagePayload
		if match := pagesArrayRe.FindStringSubmatch(body); len(match) >= 2 {
			_ = json.Unmarshal([]byte(match[1]), &pagePayloads)
		}
		if len(pagePayloads) == 0 {
			return nil, fmt.Errorf("m440: no pages found for %s", chapterID)
		}

		pages := make([]extensions.PageSource, 0, len(pagePayloads))
		for index, payload := range pagePayloads {
			imgURL := decodeM440PageURL(payload.PageImage, slug, chapterSlug)
			if imgURL == "" {
				continue
			}
			pages = append(pages, extensions.PageSource{
				URL:   imgURL,
				Index: index,
			})
		}
		if len(pages) == 0 {
			return nil, fmt.Errorf("m440: no decoded page URLs found for %s", chapterID)
		}

		storePageCache(cacheKey, pages, pageCacheTTL)
		log.Debug().
			Str("source_id", sourceID).
			Str("operation", "pages").
			Str("chapter", cacheKey).
			Str("cache_origin", "network").
			Bool("browser_used", false).
			Int("result_count", len(pages)).
			Dur("took", time.Since(started)).
			Msg("m440 pages")
		return pages, nil
	})
	if err != nil {
		return nil, err
	}
	return clonePages(result.([]extensions.PageSource)), nil
}

func parseSearchJSON(body string) []extensions.SearchResult {
	var items []struct {
		Value string `json:"value"`
		Data  string `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &items); err != nil {
		return nil
	}

	results := make([]extensions.SearchResult, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if item.Data == "" || seen[item.Data] {
			continue
		}
		seen[item.Data] = true
		results = append(results, extensions.SearchResult{
			ID:        "/manga/" + item.Data,
			Title:     strings.TrimSpace(item.Value),
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

	results := make([]extensions.SearchResult, 0, len(slugMatches))
	seen := map[string]bool{}
	for index, match := range slugMatches {
		if len(match) < 2 || seen[match[1]] {
			continue
		}
		slug := match[1]
		seen[slug] = true

		title := ""
		if index < len(titleMatches) && len(titleMatches[index]) >= 2 {
			title = strings.TrimSpace(titleMatches[index][1])
		}
		if title == "" {
			title = slugToTitle(slug)
		}

		cover := fmt.Sprintf("%s/uploads/manga/%s/cover/cover_250x350.jpg", baseURL, slug)
		if index < len(imgMatches) && len(imgMatches[index]) >= 2 {
			cover = baseURL + imgMatches[index][1]
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

func parseJSChapters(body, slug string) []extensions.Chapter {
	match := jsChapterTempRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil
	}
	return parseChapterPayloads(match[1], slug)
}

func parseRenderedChapterList(body, slug string) []extensions.Chapter {
	matches := renderedAnchorRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil
	}

	chapters := make([]extensions.Chapter, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) < 4 {
			continue
		}
		matchSlug := strings.TrimSpace(match[1])
		chapterSlug := strings.TrimSpace(match[2])
		if matchSlug != slug || chapterSlug == "" || seen[chapterSlug] {
			continue
		}

		number := parseChapterNumber(chapterSlug)
		if number <= 0 {
			number = parseChapterNumber(renderedChapterText(match[3]))
		}
		if number <= 0 {
			continue
		}

		seen[chapterSlug] = true
		title := renderedChapterText(match[3])
		if title == "" {
			title = fmt.Sprintf("CapÃ­tulo %g", number)
		}
		chapters = append(chapters, extensions.Chapter{
			ID:       fmt.Sprintf("/manga/%s/%s", slug, chapterSlug),
			Number:   number,
			Title:    title,
			Language: extensions.LangSpanish,
		})
	}

	sortChaptersAscending(chapters)
	return chapters
}

func parseChapterPayloads(rawJSON, slug string) []extensions.Chapter {
	var raw []chapterPayload
	if err := json.Unmarshal([]byte(rawJSON), &raw); err != nil {
		return nil
	}

	chapters := make([]extensions.Chapter, 0, len(raw))
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

func extractHTMLChapters(body, slug string) []extensions.Chapter {
	matches := chapterHrefRe.FindAllStringSubmatch(body, 2000)
	if len(matches) == 0 {
		return nil
	}

	chapters := make([]extensions.Chapter, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		matchSlug := strings.TrimSpace(match[1])
		chapterSlug := strings.TrimSpace(match[2])
		if matchSlug != slug || chapterSlug == "" || seen[chapterSlug] {
			continue
		}

		number := parseChapterNumber(chapterSlug)
		if number <= 0 {
			continue
		}
		seen[chapterSlug] = true
		chapters = append(chapters, extensions.Chapter{
			ID:       fmt.Sprintf("/manga/%s/%s", slug, chapterSlug),
			Number:   number,
			Title:    fmt.Sprintf("Capítulo %g", number),
			Language: extensions.LangSpanish,
		})
	}

	sortChaptersAscending(chapters)
	return chapters
}

func assessHTMLChapterCompleteness(body string, chapters []extensions.Chapter) htmlCompleteness {
	if len(chapters) == 0 {
		return htmlCompleteness{mode: "html_empty"}
	}
	if htmlHasTeaserMarkers(body) {
		return htmlCompleteness{mode: "html_truncated", requiresBrowser: true}
	}
	if htmlLooksBoundaryOnly(chapters) {
		return htmlCompleteness{mode: "html_truncated", requiresBrowser: true}
	}
	return htmlCompleteness{mode: "html_complete"}
}

func htmlHasTeaserMarkers(body string) bool {
	return recentSliceRe.MatchString(body) || showMoreRe.MatchString(body)
}

func htmlLooksBoundaryOnly(chapters []extensions.Chapter) bool {
	if len(chapters) < 2 {
		return false
	}
	first := chapters[0].Number
	last := chapters[len(chapters)-1].Number
	if first <= 0 || last <= 0 || last <= first {
		return false
	}
	if first > 1.1 {
		return false
	}
	span := last - first
	return span > float64(len(chapters)*6)
}

func browserChapters(pageURL, slug string) ([]extensions.Chapter, browserChapterMetrics) {
	browser, err := ensureSharedBrowser()
	if err != nil {
		return nil, browserChapterMetrics{}
	}

	chapters, metrics, browserErr := browserChaptersWithBrowser(browser, pageURL, slug)
	if browserErr == nil && len(chapters) > 0 {
		return chapters, metrics
	}

	resetSharedBrowser()
	browser, err = ensureSharedBrowser()
	if err != nil {
		return nil, metrics
	}
	chapters, metrics, browserErr = browserChaptersWithBrowser(browser, pageURL, slug)
	if browserErr != nil {
		return nil, metrics
	}
	return chapters, metrics
}

func browserChaptersWithBrowser(browser *rod.Browser, pageURL, slug string) ([]extensions.Chapter, browserChapterMetrics, error) {
	started := time.Now()
	page, err := sourceaccess.OpenOptimizedPage(browser, pageURL)
	if err != nil {
		return nil, browserChapterMetrics{}, err
	}
	defer page.Close()

	time.Sleep(250 * time.Millisecond)

	firstSnapshot, err := browserChapterSnapshot(page, slug, 1)
	if err != nil {
		return nil, browserChapterMetrics{}, err
	}

	totalPages := firstSnapshot.TotalPages
	if totalPages <= 0 {
		totalPages = 1
	}
	metrics := browserChapterMetrics{SnapshotCount: 1, TotalPages: totalPages}
	if chapters := parseChapterPayloads(firstSnapshot.RawChapters, slug); len(chapters) > 0 {
		metrics.PayloadMode = "raw"
		metrics.PayloadPage = 1
		metrics.PayloadReadyAfter = time.Since(started)
		return chapters, metrics, nil
	}

	merged := mergeChapterLists(parseRenderedChapterList(firstSnapshot.HTML, slug), extractHTMLChapters(firstSnapshot.HTML, slug))
	for pageNum := 2; pageNum <= totalPages; pageNum++ {
		snapshot, snapshotErr := browserChapterSnapshot(page, slug, pageNum)
		if snapshotErr != nil {
			return nil, metrics, snapshotErr
		}
		metrics.SnapshotCount++
		if snapshot.TotalPages > totalPages {
			totalPages = snapshot.TotalPages
			metrics.TotalPages = totalPages
		}
		if chapters := parseChapterPayloads(snapshot.RawChapters, slug); len(chapters) > 0 {
			metrics.PayloadMode = "raw"
			metrics.PayloadPage = pageNum
			metrics.PayloadReadyAfter = time.Since(started)
			return chapters, metrics, nil
		}
		merged = mergeChapterLists(merged, parseRenderedChapterList(snapshot.HTML, slug))
		merged = mergeChapterLists(merged, extractHTMLChapters(snapshot.HTML, slug))
	}

	if len(merged) == 0 {
		return nil, metrics, fmt.Errorf("m440 browser fallback: no rendered chapters found")
	}
	metrics.PayloadMode = "rendered_html"
	metrics.PayloadPage = metrics.SnapshotCount
	metrics.PayloadReadyAfter = time.Since(started)
	return merged, metrics, nil
}

type browserChapterSnapshotPayload struct {
	HTML        string `json:"html"`
	RawChapters string `json:"raw_chapters"`
	TotalPages  int    `json:"total_pages"`
}

func browserChapterSnapshot(page *rod.Page, slug string, pageNumber int) (browserChapterSnapshotPayload, error) {
	script := fmt.Sprintf(`() => new Promise(async (resolve) => {
		const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
		const slug = %q;
		const getRawChapters = () => {
			try {
				if (typeof jschaptertemp !== 'undefined' && Array.isArray(jschaptertemp)) {
					return JSON.stringify(jschaptertemp);
				}
			} catch (error) {}
			const aliasPattern = /const\s+([A-Za-z0-9_]+)\s*=\s*jschaptertemp\s*;/g;
			for (const script of Array.from(document.scripts)) {
				const source = script.textContent || '';
				aliasPattern.lastIndex = 0;
				let match;
				while ((match = aliasPattern.exec(source)) !== null) {
					const aliasName = match[1];
					try {
						const value = eval(aliasName);
						if (Array.isArray(value)) {
							return JSON.stringify(value);
						}
					} catch (error) {}
				}
			}
			return '';
		};
		const getAnchorHTML = () => {
			const anchors = Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
				const href = anchor.getAttribute('href') || anchor.href || '';
				return href.includes('/manga/' + slug + '/');
			});
			return anchors.map((anchor) => anchor.outerHTML).join('');
		};
		const getTotalPages = () => {
			try {
				if (typeof ALPlCT === 'object' && ALPlCT && Number(ALPlCT.total_pages) > 0) {
					return Number(ALPlCT.total_pages);
				}
			} catch (error) {}
			const pagers = Array.from(document.querySelectorAll('pag[id^="pagen"], [id^="pagen"]'));
			for (const pager of pagers) {
				const text = (pager.textContent || '').trim();
				const match = text.match(/\/\s*(\d+)/);
				if (match) {
					return parseInt(match[1], 10) || 1;
				}
			}
			return 1;
		};

		for (let attempt = 0; attempt < 20; attempt++) {
			if (typeof initChapters === 'function' || getRawChapters()) {
				break;
			}
			await sleep(100);
		}

		if (typeof initChapters === 'function') {
			try {
				initChapters(%d);
			} catch (error) {}
		}

		let html = '';
		let rawChapters = getRawChapters();
		let totalPages = 1;
		for (let attempt = 0; attempt < 20; attempt++) {
			html = getAnchorHTML();
			rawChapters = getRawChapters();
			totalPages = getTotalPages();
			if (rawChapters || html.includes('/manga/')) {
				break;
			}
			await sleep(100);
		}

		resolve(JSON.stringify({ html, raw_chapters: rawChapters, total_pages: totalPages }));
	})`, slug, pageNumber)

	result, err := page.Eval(script)
	if err != nil {
		return browserChapterSnapshotPayload{}, err
	}

	raw := strings.TrimSpace(result.Value.Str())
	if raw == "" || raw == "null" || raw == "undefined" {
		return browserChapterSnapshotPayload{}, fmt.Errorf("m440 browser fallback: empty chapter snapshot")
	}

	var payload browserChapterSnapshotPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return browserChapterSnapshotPayload{}, err
	}
	if payload.TotalPages <= 0 {
		payload.TotalPages = 1
	}
	return payload, nil
}

func mergeChapterLists(primary, secondary []extensions.Chapter) []extensions.Chapter {
	if len(primary) == 0 {
		return cloneChapters(secondary)
	}
	if len(secondary) == 0 {
		return cloneChapters(primary)
	}

	seen := map[string]bool{}
	merged := make([]extensions.Chapter, 0, len(primary)+len(secondary))
	for _, chapter := range append(primary, secondary...) {
		if chapter.ID == "" || seen[chapter.ID] {
			continue
		}
		seen[chapter.ID] = true
		merged = append(merged, chapter)
	}
	sortChaptersAscending(merged)
	return merged
}

func renderedChapterText(raw string) string {
	raw = html.UnescapeString(raw)
	raw = renderedTagRe.ReplaceAllString(raw, " ")
	raw = strings.Join(strings.Fields(raw), " ")
	return strings.TrimSpace(raw)
}

func ensureSharedBrowser() (*rod.Browser, error) {
	browserMu.Lock()
	defer browserMu.Unlock()

	if sharedBrowser != nil && time.Now().Before(sharedBrowserTill) {
		sharedBrowserTill = time.Now().Add(sharedBrowserTTL)
		scheduleSharedBrowserCloseLocked()
		log.Debug().Str("source_id", sourceID).Msg("m440 shared browser reused")
		return sharedBrowser, nil
	}

	closeSharedBrowserLocked()
	started := time.Now()

	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("browser not found")
	}

	controlURL, err := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check").
		Launch()
	if err != nil {
		return nil, err
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil, err
	}

	sharedBrowser = browser
	sharedBrowserTill = time.Now().Add(sharedBrowserTTL)
	scheduleSharedBrowserCloseLocked()
	log.Debug().Str("source_id", sourceID).Dur("took", time.Since(started)).Msg("m440 shared browser launched")
	return sharedBrowser, nil
}

func scheduleSharedBrowserCloseLocked() {
	if sharedBrowserStop != nil {
		sharedBrowserStop.Stop()
	}
	delay := time.Until(sharedBrowserTill)
	if delay <= 0 {
		delay = sharedBrowserTTL
	}
	sharedBrowserStop = time.AfterFunc(delay, func() {
		browserMu.Lock()
		defer browserMu.Unlock()
		if sharedBrowser != nil && time.Now().After(sharedBrowserTill) {
			closeSharedBrowserLocked()
		}
	})
}

func resetSharedBrowser() {
	browserMu.Lock()
	defer browserMu.Unlock()
	closeSharedBrowserLocked()
}

func closeSharedBrowserLocked() {
	if sharedBrowserStop != nil {
		sharedBrowserStop.Stop()
		sharedBrowserStop = nil
	}
	if sharedBrowser != nil {
		_ = sharedBrowser.Close()
		sharedBrowser = nil
	}
	sharedBrowserTill = time.Time{}
}

func parseChapterNumber(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if match := chLabelNumRe.FindStringSubmatch(raw); len(match) >= 2 {
		var number float64
		if _, err := fmt.Sscanf(match[1], "%f", &number); err == nil {
			return number
		}
	}
	if match := leadingNumRe.FindStringSubmatch(raw); len(match) >= 2 {
		var number float64
		if _, err := fmt.Sscanf(match[1], "%f", &number); err == nil {
			return number
		}
	}
	for _, match := range anyNumRe.FindAllStringSubmatch(raw, -1) {
		if len(match) < 2 {
			continue
		}
		var number float64
		if _, err := fmt.Sscanf(match[1], "%f", &number); err == nil {
			return number
		}
	}
	return 0
}

func sortChaptersAscending(chapters []extensions.Chapter) {
	sort.Slice(chapters, func(i, j int) bool {
		if chapters[i].Number == chapters[j].Number {
			return chapters[i].UploadedAt < chapters[j].UploadedAt
		}
		return chapters[i].Number < chapters[j].Number
	})
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

func fetchPage(url, referer string) (string, error) {
	return sourceaccess.FetchHTML(sourceID, url, sourceaccess.RequestOptions{
		Referer: referer,
		Headers: map[string]string{
			"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language":           "es-ES,es;q=0.9",
			"Upgrade-Insecure-Requests": "1",
		},
	})
}

func fetchAJAX(url string) (string, error) {
	return sourceaccess.FetchHTML(sourceID, url, sourceaccess.RequestOptions{
		Referer: baseURL,
		Headers: map[string]string{
			"Accept":           "application/json, text/javascript, */*; q=0.01",
			"X-Requested-With": "XMLHttpRequest",
			"Accept-Language":  "es-ES,es;q=0.9",
		},
	})
}

func urlEncode(value string) string {
	return strings.ReplaceAll(neturl.QueryEscape(value), "%20", "+")
}

func normalizeSlug(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL)
	raw = strings.TrimPrefix(raw, "/manga/")
	return strings.Trim(raw, "/")
}

func slugToTitle(slug string) string {
	parts := strings.Split(slug, "-")
	for index, part := range parts {
		if len(part) > 0 {
			parts[index] = strings.ToUpper(part[:1]) + part[1:]
		}
	}
	return strings.Join(parts, " ")
}

func readSearchCache(key string) ([]extensions.SearchResult, string, bool) {
	searchCacheMu.Lock()
	defer searchCacheMu.Unlock()

	entry, ok := searchCache[key]
	if !ok {
		return nil, "", false
	}
	if time.Now().After(entry.Expires) {
		delete(searchCache, key)
		return nil, "", false
	}
	if len(entry.Results) == 0 {
		return []extensions.SearchResult{}, "short_miss", true
	}
	return cloneSearchResults(entry.Results), "cache_hit", true
}

func storeSearchCache(key string, results []extensions.SearchResult, ttl time.Duration) {
	searchCacheMu.Lock()
	defer searchCacheMu.Unlock()
	searchCache[key] = cachedSearch{
		Results: cloneSearchResults(results),
		Expires: time.Now().Add(ttl),
	}
}

func readChapterCache(slug string) ([]extensions.Chapter, string, bool, bool, bool, bool) {
	chapterCacheMu.Lock()
	defer chapterCacheMu.Unlock()

	entry, ok := chapterCache[slug]
	if !ok {
		return nil, "", false, false, false, false
	}
	if time.Now().After(entry.Expires) {
		delete(chapterCache, slug)
		return nil, "", false, false, false, false
	}
	if entry.Miss {
		return nil, "short_miss", true, false, false, true
	}
	origin := "cache_hit"
	if entry.Partial {
		origin = "partial"
	}
	return cloneChapters(entry.Chapters), origin, false, entry.Partial, entry.Hydrating, true
}

func storeChapterCache(slug string, chapters []extensions.Chapter, ttl time.Duration) {
	storeChapterCacheWithState(slug, chapters, ttl, false, false)
}

func storeChapterCacheWithState(slug string, chapters []extensions.Chapter, ttl time.Duration, partial bool, hydrating bool) {
	chapterCacheMu.Lock()
	defer chapterCacheMu.Unlock()
	chapterCache[slug] = cachedChapterResult{
		Chapters:  cloneChapters(chapters),
		Expires:   time.Now().Add(ttl),
		Partial:   partial,
		Hydrating: hydrating,
	}
}

func storeChapterMiss(slug string, ttl time.Duration) {
	chapterCacheMu.Lock()
	defer chapterCacheMu.Unlock()
	chapterCache[slug] = cachedChapterResult{
		Miss:    true,
		Expires: time.Now().Add(ttl),
	}
}

func GetChapterCacheState(mangaID string) (bool, bool) {
	slug := normalizeSlug(mangaID)
	if slug == "" {
		return false, false
	}
	_, _, miss, partial, hydrating, ok := readChapterCache(slug)
	if !ok || miss {
		return false, false
	}
	return partial, hydrating
}

func loadBrowserChapters(pageURL, slug string, started time.Time, cacheMiss bool) ([]extensions.Chapter, time.Duration, browserChapterMetrics, error) {
	browserStarted := time.Now()
	chapters, metrics := browserChapters(pageURL, slug)
	browserTook := time.Since(browserStarted)
	if len(chapters) > 0 {
		storeBrowserRequirement(slug, browserRequiredCacheTTL)
		storeBrowserChapterCache(slug, chapters, browserChapterCacheTTL)
		storeChapterCache(slug, chapters, chapterCacheTTL)
		return chapters, browserTook, metrics, nil
	}

	if cacheMiss {
		storeChapterMiss(slug, chapterMissTTL)
	}
	log.Debug().
		Str("source_id", sourceID).
		Str("operation", "chapters").
		Str("slug", slug).
		Str("completeness_mode", "short_miss").
		Str("cache_origin", "short_miss").
		Bool("browser_used", true).
		Int("result_count", 0).
		Int("browser_snapshot_count", metrics.SnapshotCount).
		Int("browser_total_pages", metrics.TotalPages).
		Str("browser_payload_mode", metrics.PayloadMode).
		Int("browser_payload_page", metrics.PayloadPage).
		Dur("browser_payload_ready_after", metrics.PayloadReadyAfter).
		Dur("browser_took", browserTook).
		Dur("took", time.Since(started)).
		Msg("m440 chapters")
	return nil, browserTook, metrics, fmt.Errorf("m440: no chapters found for %s", slug)
}

func warmBrowserChaptersAsync(pageURL, slug string) {
	startBrowserHydration(pageURL, slug)
}

func startBrowserHydration(pageURL, slug string) <-chan []extensions.Chapter {
	ready := make(chan []extensions.Chapter, 1)
	go func() {
		defer close(ready)
		value, _, _ := browserWarmGroup.Do("warm:"+slug, func() (interface{}, error) {
			if browserCached, ok := readBrowserChapterCache(slug); ok && len(browserCached) > 0 {
				return browserCached, nil
			}

			started := time.Now()
			chapters, browserTook, metrics, err := loadBrowserChapters(pageURL, slug, started, false)
			if err != nil || len(chapters) == 0 {
				updateChapterHydrating(slug, false)
				log.Debug().
					Err(err).
					Str("source_id", sourceID).
					Str("operation", "chapters").
					Str("slug", slug).
					Str("completeness_mode", "browser_warm_empty").
					Bool("browser_used", true).
					Int("browser_snapshot_count", metrics.SnapshotCount).
					Int("browser_total_pages", metrics.TotalPages).
					Str("browser_payload_mode", metrics.PayloadMode).
					Int("browser_payload_page", metrics.PayloadPage).
					Dur("browser_payload_ready_after", metrics.PayloadReadyAfter).
					Dur("browser_took", browserTook).
					Msg("m440 chapters")
				return []extensions.Chapter{}, nil
			}

			log.Debug().
				Str("source_id", sourceID).
				Str("operation", "chapters").
				Str("slug", slug).
				Str("completeness_mode", "browser_warm").
				Bool("browser_used", true).
				Bool("partial", false).
				Bool("hydrating", false).
				Int("result_count", len(chapters)).
				Int("browser_snapshot_count", metrics.SnapshotCount).
				Int("browser_total_pages", metrics.TotalPages).
				Str("browser_payload_mode", metrics.PayloadMode).
				Int("browser_payload_page", metrics.PayloadPage).
				Dur("browser_payload_ready_after", metrics.PayloadReadyAfter).
				Dur("browser_took", browserTook).
				Msg("m440 chapters")
			return chapters, nil
		})
		if hydrated, ok := value.([]extensions.Chapter); ok && len(hydrated) > 0 {
			ready <- hydrated
		}
	}()
	return ready
}

func awaitHydratedChapterList(ready <-chan []extensions.Chapter, fastWait time.Duration) ([]extensions.Chapter, bool, bool) {
	if ready == nil {
		return nil, false, false
	}
	select {
	case hydrated, ok := <-ready:
		return hydrated, ok && len(hydrated) > 0, false
	case <-time.After(fastWait):
	}
	hydrated, ok := <-ready
	return hydrated, ok && len(hydrated) > 0, true
}

func readBrowserChapterCache(slug string) ([]extensions.Chapter, bool) {
	browserCacheMu.Lock()
	defer browserCacheMu.Unlock()

	entry, ok := browserChapterCache[slug]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.Expires) {
		delete(browserChapterCache, slug)
		return nil, false
	}
	return cloneChapters(entry.Chapters), true
}

func updateChapterHydrating(slug string, hydrating bool) {
	chapterCacheMu.Lock()
	defer chapterCacheMu.Unlock()

	entry, ok := chapterCache[slug]
	if !ok || entry.Miss || time.Now().After(entry.Expires) {
		return
	}
	entry.Hydrating = hydrating
	chapterCache[slug] = entry
}

func storeBrowserChapterCache(slug string, chapters []extensions.Chapter, ttl time.Duration) {
	browserCacheMu.Lock()
	defer browserCacheMu.Unlock()
	browserChapterCache[slug] = cachedChapters{
		Chapters: cloneChapters(chapters),
		Expires:  time.Now().Add(ttl),
	}
}

func requiresBrowserFallback(slug string) bool {
	browserCacheMu.Lock()
	defer browserCacheMu.Unlock()

	expiresAt, ok := browserRequired[slug]
	if !ok {
		return false
	}
	if time.Now().After(expiresAt) {
		delete(browserRequired, slug)
		return false
	}
	return true
}

func storeBrowserRequirement(slug string, ttl time.Duration) {
	browserCacheMu.Lock()
	defer browserCacheMu.Unlock()
	browserRequired[slug] = time.Now().Add(ttl)
}

func clearBrowserRequirement(slug string) {
	browserCacheMu.Lock()
	defer browserCacheMu.Unlock()
	delete(browserRequired, slug)
}

func readPageCache(key string) ([]extensions.PageSource, string, bool) {
	pageCacheMu.Lock()
	defer pageCacheMu.Unlock()

	entry, ok := pageCache[key]
	if !ok {
		return nil, "", false
	}
	if time.Now().After(entry.Expires) {
		delete(pageCache, key)
		return nil, "", false
	}
	return clonePages(entry.Pages), "cache_hit", true
}

func storePageCache(key string, pages []extensions.PageSource, ttl time.Duration) {
	pageCacheMu.Lock()
	defer pageCacheMu.Unlock()
	pageCache[key] = cachedPages{
		Pages:   clonePages(pages),
		Expires: time.Now().Add(ttl),
	}
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
