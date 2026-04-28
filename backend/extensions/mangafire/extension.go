package mangafire

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"

	"github.com/sourcegraph/conc/pool"

	"miruro/backend/extensions"
	"miruro/backend/extensions/sourceaccess"
)

const (
	sourceIDEnglish     = "mangafire-en"
	sourceIDSpanish     = "mangafire-es"
	inventorySourceID   = sourceIDEnglish
	baseURL             = "https://mangafire.to"
	sitemapIndexURL     = baseURL + "/sitemap.xml"
	searchCacheTTL      = 6 * time.Hour
	inventoryDiskTTL    = 24 * time.Hour
	detailCacheTTL      = 6 * time.Hour
	pageCacheTTL        = 6 * time.Hour
	readerTimeout       = 18 * time.Second
	readerBrowserUA     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
	maxSearchCandidates = 12
	maxDetailCandidates = 4
)

var (
	titleRe            = regexp.MustCompile(`(?s)<h1[^>]*itemprop="name"[^>]*>(.*?)</h1>`)
	altTitlesRe        = regexp.MustCompile(`(?s)<h6>(.*?)</h6>`)
	coverRe            = regexp.MustCompile(`(?s)<div class="poster">.*?<img src="([^"]+)"`)
	descriptionRe      = regexp.MustCompile(`(?s)<div class="description">(.*?)</div>`)
	chapterBlockRe     = regexp.MustCompile(`(?s)<div class="tab-content" data-name="chapter">(.*?)<div class="tab-content" data-name="volume"`)
	chapterItemRe      = regexp.MustCompile(`(?s)<li class="item"[^>]*data-number="([^"]+)"[^>]*>\s*<a href="([^"]+)"[^>]*title="([^"]*)"[^>]*>\s*<span>(.*?)</span>\s*<span>(.*?)</span>`)
	chapterLangCountRe = regexp.MustCompile(`(?is)<a class="dropdown-item[^"]*" href="#" data-code="([^"]+)"[^>]*data-title="[^"]*">\s*<i class="flag [^"]+"></i>\s*[^<]+?\((\d+)\s+Chapters\)\s*</a>`)
	tagRe              = regexp.MustCompile(`<[^>]+>`)
	spaceRe            = regexp.MustCompile(`\s+`)
	chapterTitleRe     = regexp.MustCompile(`(?i)^chapter\s+\d+(?:\.\d+)?\s*:?\s*`)
)

type sourceProfile struct {
	sourceID      string
	displayName   string
	language      extensions.Language
	chapterCodes  []string
	languageLabel string
}

type Extension struct {
	profile sourceProfile
}

type sitemapIndex struct {
	Sitemaps []sitemapLoc `xml:"sitemap"`
	URLs     []sitemapLoc `xml:"url"`
}

type sitemapLoc struct {
	Loc string `xml:"loc"`
}

type searchCandidate struct {
	slug       string
	score      int
	searchName string
}

type detailMetadata struct {
	slug        string
	title       string
	altTitles   []string
	coverURL    string
	description string
}

type cachedInventory struct {
	slugs   []string
	expires time.Time
}

type persistedInventory struct {
	Slugs     []string  `json:"slugs"`
	ExpiresAt time.Time `json:"expires_at"`
}

type cachedSearch struct {
	results []extensions.SearchResult
	expires time.Time
}

type cachedDetail struct {
	meta    detailMetadata
	expires time.Time
}

type cachedPages struct {
	pages   []extensions.PageSource
	expires time.Time
}

var (
	englishProfile = sourceProfile{
		sourceID:      sourceIDEnglish,
		displayName:   "MangaFire (EN)",
		language:      extensions.LangEnglish,
		chapterCodes:  []string{"en"},
		languageLabel: "English",
	}
	spanishProfile = sourceProfile{
		sourceID:      sourceIDSpanish,
		displayName:   "MangaFire (ES)",
		language:      extensions.LangSpanish,
		chapterCodes:  []string{"es", "es-la"},
		languageLabel: "Spanish",
	}

	inventoryMu      sync.Mutex
	inventoryState   cachedInventory
	inventoryLoading bool
	inventoryWaitCh  chan struct{}

	searchMu    sync.Mutex
	searchState = map[string]cachedSearch{}

	detailMu    sync.Mutex
	detailState = map[string]cachedDetail{}

	pageMu      sync.Mutex
	pageState   = map[string]cachedPages{}
	pageLoading = map[string]chan struct{}{}
)

func init() {
	registerSourceAccessProfile(englishProfile.sourceID)
	registerSourceAccessProfile(spanishProfile.sourceID)
}

func registerSourceAccessProfile(sourceID string) {
	sourceaccess.RegisterProfile(sourceaccess.SourceAccessProfile{
		SourceID:             sourceID,
		BaseURL:              baseURL,
		WarmupURL:            baseURL + "/home",
		DefaultReferer:       baseURL + "/home",
		CookieDomains:        []string{"mangafire.to", "s.mfcdn.nl", "static.mfcdn.nl"},
		ChallengeStatusCodes: []int{403, 429},
	})
}

func New() *Extension { return NewEnglish() }

func NewEnglish() *Extension { return &Extension{profile: englishProfile} }

func NewSpanish() *Extension { return &Extension{profile: spanishProfile} }

func EnabledForV1() bool { return true }

func WarmCacheAsync() {
	go func() {
		_, _ = loadInventory()
	}()
}

func (e *Extension) ID() string   { return e.profileData().sourceID }
func (e *Extension) Name() string { return e.profileData().displayName }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{e.profileData().language}
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}
	queryKey := buildSearchCacheKey(e.ID(), normalizeSearch(query))
	if cached := cachedSearchResults(queryKey); cached != nil {
		return cached, nil
	}

	slugs, err := loadInventory()
	if err != nil {
		return nil, fmt.Errorf("mangafire search inventory: %w", err)
	}
	if len(slugs) == 0 {
		return nil, fmt.Errorf("mangafire: no sitemap inventory available")
	}

	candidates := rankInventory(slugs, query)
	if len(candidates) == 0 {
		return []extensions.SearchResult{}, nil
	}
	if len(candidates) > maxSearchCandidates {
		candidates = candidates[:maxSearchCandidates]
	}

	queryNorm := normalizeSearch(query)
	type scoredResult struct {
		result extensions.SearchResult
		score  int
	}

	scored := make([]scoredResult, 0, len(candidates))
	fallbackCandidates := candidates
	if len(fallbackCandidates) > maxDetailCandidates {
		fallbackCandidates = fallbackCandidates[maxDetailCandidates:]
	} else {
		fallbackCandidates = nil
	}
	detailCandidates := candidates
	if len(detailCandidates) > maxDetailCandidates {
		detailCandidates = detailCandidates[:maxDetailCandidates]
	}
	// MangaFire rate-limits aggressively; keep detail fan-out small so
	// search itself doesn't poison the next chapter/detail request.
	p := pool.NewWithResults[scoredResult]().WithMaxGoroutines(2)
	for _, candidate := range detailCandidates {
		candidate := candidate
		p.Go(func() scoredResult {
			meta, err := loadDetail(e.ID(), candidate.slug)
			if err != nil {
				return scoredResult{
					result: extensions.SearchResult{
						ID:        candidate.slug,
						Title:     candidate.searchName,
						Languages: e.Languages(),
					},
					score: candidate.score,
				}
			}

			score := scoreDetail(queryNorm, meta)
			if score == 0 {
				score = candidate.score
			}
			return scoredResult{
				result: extensions.SearchResult{
					ID:          meta.slug,
					Title:       meta.title,
					CoverURL:    meta.coverURL,
					Description: meta.description,
					Languages:   e.Languages(),
				},
				score: score,
			}
		})
	}
	scored = append(scored, p.Wait()...)
	for _, candidate := range fallbackCandidates {
		scored = append(scored, scoredResult{
			result: extensions.SearchResult{
				ID:        candidate.slug,
				Title:     candidate.searchName,
				Languages: e.Languages(),
			},
			score: candidate.score - 8,
		})
	}

	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].result.Title < scored[j].result.Title
		}
		return scored[i].score > scored[j].score
	})

	results := make([]extensions.SearchResult, 0, len(scored))
	seen := map[string]bool{}
	for _, item := range scored {
		if item.result.ID == "" || seen[item.result.ID] {
			continue
		}
		seen[item.result.ID] = true
		results = append(results, item.result)
	}
	storeSearchResults(queryKey, results)
	return results, nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	slug := normalizeSlug(mangaID)
	if slug == "" {
		return nil, fmt.Errorf("mangafire: invalid manga id")
	}

	body, err := sourceaccess.FetchHTML(e.ID(), detailURL(slug), sourceaccess.RequestOptions{})
	if err != nil {
		return nil, fmt.Errorf("mangafire chapters: %w", err)
	}

	block := body
	if match := chapterBlockRe.FindStringSubmatch(body); len(match) >= 2 {
		block = match[1]
	}

	matches := chapterItemRe.FindAllStringSubmatch(block, -1)
	if len(matches) == 0 {
		return nil, fmt.Errorf("mangafire: no chapters found")
	}

	chapters := make([]extensions.Chapter, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) < 6 {
			continue
		}

		number := parseNumber(match[1])
		href := absoluteURL(match[2])
		if href == "" || !chapterMatchesLanguage(href, slug, e.profileData().chapterCodes) || seen[href] {
			continue
		}
		seen[href] = true

		title := cleanChapterTitle(match[4])
		if title == "" {
			title = cleanText(match[3])
		}
		if title == "" {
			title = fmt.Sprintf("Chapter %s", strings.TrimSpace(match[1]))
		}

		chapters = append(chapters, extensions.Chapter{
			ID:         href,
			Number:     number,
			Title:      title,
			Language:   e.profileData().language,
			UploadedAt: cleanText(match[5]),
		})
	}

	if len(chapters) == 0 {
		syntheticChapters := synthesizeLanguageChapters(matches, slug, e.profileData(), parseChapterLanguageCounts(body))
		if len(syntheticChapters) > 0 {
			return syntheticChapters, nil
		}

		browserChapters, browserErr := loadChaptersFromBrowser(e.ID(), slug, e.profileData())
		if browserErr == nil && len(browserChapters) > 0 {
			return browserChapters, nil
		}
		if browserErr != nil {
			return nil, fmt.Errorf("mangafire: no %s chapters found (browser fallback: %w)", strings.ToLower(e.profileData().languageLabel), browserErr)
		}
		return nil, fmt.Errorf("mangafire: no %s chapters found", strings.ToLower(e.profileData().languageLabel))
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
	if chapterURL == "" {
		return nil, fmt.Errorf("mangafire: invalid chapter id")
	}

	if pages := cachedChapterPages(chapterURL); len(pages) > 0 {
		return pages, nil
	}

	if pages, ok, err := waitForChapterPages(chapterURL); ok {
		return pages, err
	}

	pages, err := loadPagesFromBrowser(e.ID(), chapterURL)
	if err != nil {
		finishChapterPages(chapterURL, nil)
		return nil, fmt.Errorf("mangafire pages: %w", err)
	}
	storeChapterPages(chapterURL, pages)
	finishChapterPages(chapterURL, pages)
	return clonePages(pages), nil
}

func cachedSearchResults(queryKey string) []extensions.SearchResult {
	searchMu.Lock()
	defer searchMu.Unlock()

	cached, ok := searchState[queryKey]
	if !ok || time.Now().After(cached.expires) {
		return nil
	}
	return append([]extensions.SearchResult(nil), cached.results...)
}

func storeSearchResults(queryKey string, results []extensions.SearchResult) {
	searchMu.Lock()
	searchState[queryKey] = cachedSearch{
		results: append([]extensions.SearchResult(nil), results...),
		expires: time.Now().Add(searchCacheTTL),
	}
	searchMu.Unlock()
}

func loadInventory() ([]string, error) {
	inventoryMu.Lock()
	cached := inventoryState
	if len(cached.slugs) > 0 && time.Now().Before(cached.expires) {
		inventoryMu.Unlock()
		return append([]string(nil), cached.slugs...), nil
	}
	if len(cached.slugs) == 0 {
		if persisted, ok := loadPersistedInventory(); ok {
			inventoryState = persisted
			inventoryMu.Unlock()
			go refreshInventoryAsync()
			return append([]string(nil), persisted.slugs...), nil
		}
	}
	if inventoryLoading && inventoryWaitCh != nil {
		waitCh := inventoryWaitCh
		inventoryMu.Unlock()
		<-waitCh
		inventoryMu.Lock()
		cached = inventoryState
		inventoryMu.Unlock()
		if len(cached.slugs) > 0 && time.Now().Before(cached.expires) {
			return append([]string(nil), cached.slugs...), nil
		}
		return nil, fmt.Errorf("mangafire inventory refresh failed")
	}
	inventoryMu.Unlock()
	return refreshInventoryNow()
}

func refreshInventoryAsync() {
	inventoryMu.Lock()
	if inventoryLoading {
		inventoryMu.Unlock()
		return
	}
	inventoryMu.Unlock()
	_, _ = refreshInventoryNow()
}

func refreshInventoryNow() ([]string, error) {
	inventoryMu.Lock()
	if inventoryLoading && inventoryWaitCh != nil {
		waitCh := inventoryWaitCh
		inventoryMu.Unlock()
		<-waitCh
		if cached := cachedInventoryCopy(); len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("mangafire inventory refresh failed")
	}
	inventoryLoading = true
	inventoryWaitCh = make(chan struct{})
	waitCh := inventoryWaitCh
	inventoryMu.Unlock()
	defer func() {
		inventoryMu.Lock()
		inventoryLoading = false
		close(waitCh)
		inventoryWaitCh = nil
		inventoryMu.Unlock()
	}()

	listURLs, err := fetchSitemapListURLs()
	if err != nil {
		return nil, err
	}

	slugs := make([]string, 0, len(listURLs)*200)
	seen := map[string]bool{}
	seenMu := sync.Mutex{}
	slugsMu := sync.Mutex{}

	p2 := pool.New().WithMaxGoroutines(8)
	for _, rawURL := range listURLs {
		rawURL := rawURL
		p2.Go(func() {
			body, err := sourceaccess.FetchHTML(inventorySourceID, rawURL, sourceaccess.RequestOptions{})
			if err != nil {
				return
			}

			var sitemap sitemapIndex
			if err := xml.Unmarshal([]byte(body), &sitemap); err != nil {
				return
			}

			local := make([]string, 0, len(sitemap.URLs))
			for _, entry := range sitemap.URLs {
				slug := normalizeSlug(entry.Loc)
				if slug == "" {
					continue
				}

				seenMu.Lock()
				if seen[slug] {
					seenMu.Unlock()
					continue
				}
				seen[slug] = true
				seenMu.Unlock()

				local = append(local, slug)
			}

			if len(local) == 0 {
				return
			}

			slugsMu.Lock()
			slugs = append(slugs, local...)
			slugsMu.Unlock()
		})
	}
	p2.Wait()

	if len(slugs) == 0 {
		return nil, fmt.Errorf("no manga slugs discovered from sitemap list")
	}

	sort.Strings(slugs)

	inventoryMu.Lock()
	inventoryState = cachedInventory{
		slugs:   append([]string(nil), slugs...),
		expires: time.Now().Add(searchCacheTTL),
	}
	inventoryMu.Unlock()
	storePersistedInventory(slugs, time.Now().Add(inventoryDiskTTL))
	return slugs, nil
}

func cachedInventoryCopy() []string {
	inventoryMu.Lock()
	defer inventoryMu.Unlock()
	if len(inventoryState.slugs) == 0 {
		return nil
	}
	return append([]string(nil), inventoryState.slugs...)
}

func inventoryCacheFile() string {
	cacheDir, err := os.UserCacheDir()
	if err != nil || strings.TrimSpace(cacheDir) == "" {
		return ""
	}
	return filepath.Join(cacheDir, "Nipah", "mangafire_inventory.json")
}

func loadPersistedInventory() (cachedInventory, bool) {
	path := inventoryCacheFile()
	if path == "" {
		return cachedInventory{}, false
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return cachedInventory{}, false
	}
	var persisted persistedInventory
	if err := json.Unmarshal(body, &persisted); err != nil {
		return cachedInventory{}, false
	}
	if len(persisted.Slugs) == 0 || time.Now().After(persisted.ExpiresAt) {
		return cachedInventory{}, false
	}
	return cachedInventory{
		slugs:   append([]string(nil), persisted.Slugs...),
		expires: persisted.ExpiresAt,
	}, true
}

func storePersistedInventory(slugs []string, expiresAt time.Time) {
	path := inventoryCacheFile()
	if path == "" || len(slugs) == 0 {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	body, err := json.Marshal(persistedInventory{
		Slugs:     append([]string(nil), slugs...),
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return
	}
	_ = os.WriteFile(path, body, 0o644)
}

func fetchSitemapListURLs() ([]string, error) {
	body, err := sourceaccess.FetchHTML(inventorySourceID, sitemapIndexURL, sourceaccess.RequestOptions{})
	if err != nil {
		return nil, err
	}

	var index sitemapIndex
	if err := xml.Unmarshal([]byte(body), &index); err != nil {
		return nil, fmt.Errorf("sitemap index parse failed: %w", err)
	}

	seen := map[string]bool{}
	var urls []string
	for _, entry := range index.Sitemaps {
		loc := strings.TrimSpace(entry.Loc)
		if !strings.Contains(loc, "/sitemap-list-") || seen[loc] {
			continue
		}
		seen[loc] = true
		urls = append(urls, loc)
	}

	if len(urls) == 0 {
		return nil, fmt.Errorf("no list sitemaps found")
	}
	sort.Strings(urls)
	return urls, nil
}

func rankInventory(slugs []string, query string) []searchCandidate {
	queryNorm := normalizeSearch(query)
	if queryNorm == "" {
		return nil
	}

	ranked := make([]searchCandidate, 0, len(slugs))
	for _, slug := range slugs {
		searchName := humanizeSlug(slug)
		score := bestScore(
			scoreValue(queryNorm, searchName),
			scoreValue(queryNorm, slugBase(slug)),
			scoreValue(queryNorm, slug),
		)
		if score == 0 {
			continue
		}
		ranked = append(ranked, searchCandidate{
			slug:       slug,
			score:      score,
			searchName: searchName,
		})
	}

	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score == ranked[j].score {
			return ranked[i].searchName < ranked[j].searchName
		}
		return ranked[i].score > ranked[j].score
	})
	return ranked
}

func loadDetail(sourceID, slug string) (detailMetadata, error) {
	detailMu.Lock()
	cached, ok := detailState[slug]
	detailMu.Unlock()

	if ok && time.Now().Before(cached.expires) {
		return cached.meta, nil
	}

	body, err := sourceaccess.FetchHTML(sourceID, detailURL(slug), sourceaccess.RequestOptions{})
	if err != nil {
		return detailMetadata{}, err
	}

	meta := detailMetadata{
		slug:        slug,
		title:       firstMatch(titleRe, body),
		coverURL:    strings.TrimSpace(firstMatch(coverRe, body)),
		description: cleanText(firstMatch(descriptionRe, body)),
	}
	for _, item := range strings.Split(cleanText(firstMatch(altTitlesRe, body)), ";") {
		if title := strings.TrimSpace(item); title != "" {
			meta.altTitles = append(meta.altTitles, title)
		}
	}
	if meta.title == "" {
		meta.title = humanizeSlug(slug)
	}

	detailMu.Lock()
	detailState[slug] = cachedDetail{
		meta:    meta,
		expires: time.Now().Add(detailCacheTTL),
	}
	detailMu.Unlock()

	return meta, nil
}

func scoreDetail(queryNorm string, meta detailMetadata) int {
	score := bestScore(
		scoreValue(queryNorm, meta.title),
		scoreValue(queryNorm, meta.slug),
		scoreValue(queryNorm, slugBase(meta.slug)),
	)
	for _, alt := range meta.altTitles {
		score = bestScore(score, scoreValue(queryNorm, alt)-5)
	}
	return score
}

func loadPagesFromBrowser(sourceID, chapterURL string) ([]extensions.PageSource, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("no Chrome/Edge browser found")
	}

	l := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check").
		Set("user-agent", readerBrowserUA)

	controlURL, err := l.Launch()
	if err != nil {
		return nil, fmt.Errorf("browser launch failed: %w", err)
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("browser connect failed: %w", err)
	}
	defer browser.Close()

	page, err := browser.Page(proto.TargetCreateTarget{URL: chapterURL})
	if err != nil {
		return nil, fmt.Errorf("page open failed: %w", err)
	}
	defer page.Close()

	_ = page.WaitStable(1500 * time.Millisecond)

	elements, err := waitForPageSlots(page)
	if err != nil {
		info, _ := page.Info()
		if info != nil && strings.TrimSpace(info.Title) != "" {
			return nil, fmt.Errorf("%w (%s)", err, info.Title)
		}
		return nil, err
	}

	imageURLs := resolveOrderedImageURLs(page, elements, chapterURL)
	if len(imageURLs) == 0 {
		return nil, fmt.Errorf("reader pages not found after browser load")
	}

	pages := make([]extensions.PageSource, 0, len(imageURLs))
	for index, raw := range imageURLs {
		pages = append(pages, extensions.PageSource{
			URL:   sourceaccess.BuildImageProxyURL(sourceID, raw, chapterURL),
			Index: index,
		})
	}
	return pages, nil
}

func loadChaptersFromBrowser(sourceID, slug string, profile sourceProfile) ([]extensions.Chapter, error) {
	browserPath, found := launcher.LookPath()
	if !found {
		return nil, fmt.Errorf("no Chrome/Edge browser found")
	}

	l := launcher.New().
		Bin(browserPath).
		Leakless(false).
		Headless(true).
		Set("disable-gpu").
		Set("no-first-run").
		Set("no-default-browser-check").
		Set("user-agent", readerBrowserUA)

	controlURL, err := l.Launch()
	if err != nil {
		return nil, fmt.Errorf("browser launch failed: %w", err)
	}

	browser := rod.New().ControlURL(controlURL)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("browser connect failed: %w", err)
	}
	defer browser.Close()

	page, err := sourceaccess.OpenOptimizedPage(browser, detailURL(slug))
	if err != nil {
		return nil, fmt.Errorf("page open failed: %w", err)
	}
	defer page.Close()

	_ = page.WaitStable(1500 * time.Millisecond)

	for _, code := range profile.chapterCodes {
		if err := switchChapterLanguage(page, code); err != nil {
			continue
		}
		chapters := waitForBrowserChapters(page, slug, profile)
		if len(chapters) > 0 {
			return chapters, nil
		}
	}

	return nil, fmt.Errorf("language switch did not expose %s chapters", strings.ToLower(profile.languageLabel))
}

func switchChapterLanguage(page *rod.Page, code string) error {
	targetCode := strings.ToUpper(strings.TrimSpace(code))
	if targetCode == "" {
		return fmt.Errorf("missing language code")
	}

	button, err := page.Element(`div.tab-content[data-name="chapter"] .list-menu .dropdown button[data-toggle="dropdown"]`)
	if err == nil && button != nil {
		_ = button.ScrollIntoView()
		_ = button.Click(proto.InputMouseButtonLeft, 1)
		time.Sleep(200 * time.Millisecond)
	}

	selector := fmt.Sprintf(`div.tab-content[data-name="chapter"] .dropdown-menu a[data-code="%s"]`, targetCode)
	if _, err := page.Eval(`(selector) => {
		const target = document.querySelector(selector);
		if (!target) return false;
		target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
		return true;
	}`, selector); err != nil {
		return err
	}

	deadline := time.Now().Add(6 * time.Second)
	activeSelector := selector + `.active`
	for time.Now().Before(deadline) {
		if _, err := page.Element(activeSelector); err == nil {
			time.Sleep(400 * time.Millisecond)
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("language %s did not become active", targetCode)
}

func waitForBrowserChapters(page *rod.Page, slug string, profile sourceProfile) []extensions.Chapter {
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		chapters, _ := extractBrowserChapters(page, slug, profile)
		if len(chapters) > 0 {
			return chapters
		}
		time.Sleep(300 * time.Millisecond)
	}
	return nil
}

func extractBrowserChapters(page *rod.Page, slug string, profile sourceProfile) ([]extensions.Chapter, error) {
	items, err := page.Elements(`div.tab-content[data-name="chapter"] .list-body li.item`)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}

	chapters := make([]extensions.Chapter, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		number := parseNumber(firstNonEmptyAttr(item, "data-number"))
		link, err := item.Element("a")
		if err != nil || link == nil {
			continue
		}

		href := absoluteURL(firstNonEmptyAttr(link, "href"))
		if href == "" || !chapterMatchesLanguage(href, slug, profile.chapterCodes) || seen[href] {
			continue
		}
		seen[href] = true

		title := ""
		spans, _ := link.Elements("span")
		if len(spans) > 0 {
			if text, err := spans[0].Text(); err == nil {
				title = cleanChapterTitle(text)
			}
		}
		if title == "" {
			if text, err := link.Text(); err == nil {
				title = cleanChapterTitle(text)
			}
		}
		if title == "" {
			if rawTitle := firstNonEmptyAttr(link, "title"); rawTitle != "" {
				title = cleanChapterTitle(rawTitle)
			}
		}
		if title == "" {
			title = fmt.Sprintf("Chapter %s", strings.TrimSpace(firstNonEmptyAttr(item, "data-number")))
		}

		uploadedAt := ""
		if len(spans) > 1 {
			if text, err := spans[1].Text(); err == nil {
				uploadedAt = cleanText(text)
			}
		}

		chapters = append(chapters, extensions.Chapter{
			ID:         href,
			Number:     number,
			Title:      title,
			Language:   profile.language,
			UploadedAt: uploadedAt,
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

func waitForPageSlots(page *rod.Page) (rod.Elements, error) {
	deadline := time.Now().Add(readerTimeout)
	for time.Now().Before(deadline) {
		elements, err := page.Elements("#page-wrapper img")
		if err == nil && len(elements) > 0 {
			return elements, nil
		}
		_, _ = page.Eval(`() => window.scrollTo(0, document.body.scrollHeight)`)
		time.Sleep(500 * time.Millisecond)
	}
	return nil, fmt.Errorf("reader page slots not found after browser load")
}

func resolveOrderedImageURLs(page *rod.Page, elements rod.Elements, chapterURL string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(elements))
	for _, element := range elements {
		_ = element.ScrollIntoView()
		raw := waitForImageURL(page, element)
		raw = absoluteURLWithBase(raw, chapterURL)
		if raw == "" || seen[raw] {
			continue
		}
		seen[raw] = true
		out = append(out, raw)
	}
	return out
}

func waitForImageURL(page *rod.Page, element *rod.Element) string {
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if raw := firstNonEmptyAttr(element, "src", "data-src", "data-original"); raw != "" {
			return raw
		}
		_, _ = page.Eval(`() => window.scrollBy(0, window.innerHeight * 0.35)`)
		time.Sleep(250 * time.Millisecond)
	}
	return firstNonEmptyAttr(element, "src", "data-src", "data-original")
}

func cachedChapterPages(chapterURL string) []extensions.PageSource {
	pageMu.Lock()
	defer pageMu.Unlock()

	cached, ok := pageState[chapterURL]
	if !ok || time.Now().After(cached.expires) {
		return nil
	}
	return clonePages(cached.pages)
}

func waitForChapterPages(chapterURL string) ([]extensions.PageSource, bool, error) {
	pageMu.Lock()
	if waitCh, ok := pageLoading[chapterURL]; ok {
		pageMu.Unlock()
		<-waitCh
		if pages := cachedChapterPages(chapterURL); len(pages) > 0 {
			return pages, true, nil
		}
		return nil, true, fmt.Errorf("reader pages not available after concurrent load")
	}
	pageLoading[chapterURL] = make(chan struct{})
	pageMu.Unlock()
	return nil, false, nil
}

func storeChapterPages(chapterURL string, pages []extensions.PageSource) {
	pageMu.Lock()
	pageState[chapterURL] = cachedPages{
		pages:   clonePages(pages),
		expires: time.Now().Add(pageCacheTTL),
	}
	pageMu.Unlock()
}

func finishChapterPages(chapterURL string, pages []extensions.PageSource) {
	pageMu.Lock()
	waitCh := pageLoading[chapterURL]
	delete(pageLoading, chapterURL)
	pageMu.Unlock()
	if waitCh != nil {
		close(waitCh)
	}
}

func clonePages(pages []extensions.PageSource) []extensions.PageSource {
	return append([]extensions.PageSource(nil), pages...)
}

func (e *Extension) profileData() sourceProfile {
	if e == nil || strings.TrimSpace(e.profile.sourceID) == "" {
		return englishProfile
	}
	return e.profile
}

func buildSearchCacheKey(sourceID, queryKey string) string {
	return strings.TrimSpace(sourceID) + "::" + strings.TrimSpace(queryKey)
}

func detailURL(slug string) string {
	return baseURL + "/manga/" + slug
}

func normalizeSlug(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL+"/manga/")
	raw = strings.TrimPrefix(raw, "/manga/")
	raw = strings.Trim(raw, "/")
	if idx := strings.Index(raw, "/"); idx >= 0 {
		raw = raw[:idx]
	}
	return raw
}

func normalizeChapterURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	raw = strings.TrimPrefix(raw, baseURL)
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

func absoluteURLWithBase(raw, base string) string {
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
	if idx := strings.LastIndex(base, "/"); idx >= 0 {
		return base[:idx+1] + strings.TrimPrefix(raw, "./")
	}
	return absoluteURL(raw)
}

func chapterMatchesLanguage(href, slug string, codes []string) bool {
	href = strings.ToLower(strings.TrimSpace(href))
	normalizedSlug := strings.ToLower(normalizeSlug(slug))
	if href == "" || normalizedSlug == "" {
		return false
	}

	marker := "/read/" + normalizedSlug + "/"
	idx := strings.Index(href, marker)
	if idx < 0 {
		return false
	}

	remainder := href[idx+len(marker):]
	for _, code := range codes {
		code = strings.ToLower(strings.TrimSpace(code))
		if code != "" && strings.HasPrefix(remainder, code+"/") {
			return true
		}
	}
	return false
}

func parseChapterLanguageCounts(body string) map[string]int {
	out := map[string]int{}
	for _, match := range chapterLangCountRe.FindAllStringSubmatch(body, -1) {
		if len(match) < 3 {
			continue
		}
		code := strings.ToLower(strings.TrimSpace(match[1]))
		count, err := strconv.Atoi(strings.TrimSpace(match[2]))
		if code == "" || err != nil || count <= 0 {
			continue
		}
		out[code] = count
	}
	return out
}

func synthesizeLanguageChapters(matches [][]string, slug string, profile sourceProfile, counts map[string]int) []extensions.Chapter {
	targetCode := ""
	targetCount := 0
	for _, code := range profile.chapterCodes {
		normalized := strings.ToLower(strings.TrimSpace(code))
		if counts[normalized] > targetCount {
			targetCode = normalized
			targetCount = counts[normalized]
		}
	}
	if targetCode == "" || targetCount <= 0 {
		return nil
	}

	chapters := make([]extensions.Chapter, 0, minInt(targetCount, len(matches)))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(chapters) >= targetCount || len(match) < 6 {
			break
		}

		href := absoluteURL(match[2])
		if href == "" || !chapterMatchesLanguage(href, slug, []string{"en"}) {
			continue
		}
		syntheticHref := replaceChapterLanguage(href, slug, "en", targetCode)
		if syntheticHref == "" || seen[syntheticHref] {
			continue
		}
		seen[syntheticHref] = true

		title := cleanChapterTitle(match[4])
		if title == "" {
			title = cleanText(match[3])
		}
		if title == "" {
			title = fmt.Sprintf("Chapter %s", strings.TrimSpace(match[1]))
		}

		chapters = append(chapters, extensions.Chapter{
			ID:         syntheticHref,
			Number:     parseNumber(match[1]),
			Title:      title,
			Language:   profile.language,
			UploadedAt: cleanText(match[5]),
		})
	}

	sort.Slice(chapters, func(i, j int) bool {
		if chapters[i].Number == chapters[j].Number {
			return chapters[i].UploadedAt < chapters[j].UploadedAt
		}
		return chapters[i].Number < chapters[j].Number
	})
	return chapters
}

func replaceChapterLanguage(href, slug, fromCode, toCode string) string {
	href = strings.TrimSpace(href)
	slug = strings.ToLower(normalizeSlug(slug))
	fromCode = strings.ToLower(strings.TrimSpace(fromCode))
	toCode = strings.ToLower(strings.TrimSpace(toCode))
	if href == "" || slug == "" || fromCode == "" || toCode == "" {
		return ""
	}

	marker := "/read/" + slug + "/" + fromCode + "/"
	idx := strings.Index(strings.ToLower(href), marker)
	if idx < 0 {
		return ""
	}
	return href[:idx] + "/read/" + slug + "/" + toCode + "/" + href[idx+len(marker):]
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func slugBase(slug string) string {
	slug = normalizeSlug(slug)
	if idx := strings.LastIndex(slug, "."); idx > 0 {
		slug = slug[:idx]
	}
	return trimTrailingDuplicateLetter(slug)
}

func humanizeSlug(slug string) string {
	base := slugBase(slug)
	replacer := strings.NewReplacer("-", " ", "_", " ", ".", " ")
	base = replacer.Replace(base)
	return strings.Title(strings.Join(strings.Fields(base), " "))
}

func trimTrailingDuplicateLetter(raw string) string {
	runes := []rune(raw)
	if len(runes) < 2 {
		return raw
	}
	last := runes[len(runes)-1]
	prev := runes[len(runes)-2]
	if unicode.IsLetter(last) && unicode.IsLetter(prev) && unicode.ToLower(last) == unicode.ToLower(prev) {
		return string(runes[:len(runes)-1])
	}
	return raw
}

func parseNumber(raw string) float64 {
	value, _ := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return value
}

func cleanChapterTitle(raw string) string {
	title := cleanText(raw)
	trimmed := strings.TrimSpace(chapterTitleRe.ReplaceAllString(title, ""))
	if trimmed != "" {
		return trimmed
	}
	return title
}

func cleanText(raw string) string {
	raw = html.UnescapeString(raw)
	raw = strings.ReplaceAll(raw, "\\/", "/")
	raw = strings.ReplaceAll(raw, "\\u0026", "&")
	raw = tagRe.ReplaceAllString(raw, " ")
	raw = spaceRe.ReplaceAllString(raw, " ")
	return strings.TrimSpace(raw)
}

func normalizeSearch(raw string) string {
	replacer := strings.NewReplacer(
		"-", " ",
		"_", " ",
		".", " ",
		":", " ",
		"'", "",
		"\"", "",
		"!", "",
		"?", "",
	)
	raw = replacer.Replace(strings.ToLower(cleanText(raw)))
	return strings.Join(strings.Fields(raw), " ")
}

func scoreValue(queryNorm, value string) int {
	valueNorm := normalizeSearch(value)
	if queryNorm == "" || valueNorm == "" {
		return 0
	}

	score := 0
	switch {
	case valueNorm == queryNorm:
		score = 520
	case strings.HasPrefix(valueNorm, queryNorm):
		score = 430
	case strings.Contains(valueNorm, queryNorm):
		score = 330
	case strings.Contains(queryNorm, valueNorm):
		score = 250
	default:
		return 0
	}

	return score - absInt(len(valueNorm)-len(queryNorm))
}

func bestScore(values ...int) int {
	best := 0
	for _, value := range values {
		if value > best {
			best = value
		}
	}
	return best
}

func firstMatch(re *regexp.Regexp, body string) string {
	match := re.FindStringSubmatch(body)
	if len(match) < 2 {
		return ""
	}
	return cleanText(match[1])
}

func firstNonEmptyAttr(element *rod.Element, names ...string) string {
	for _, name := range names {
		value, err := element.Attribute(name)
		if err == nil && value != nil && strings.TrimSpace(*value) != "" {
			return strings.TrimSpace(*value)
		}
	}
	return ""
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
