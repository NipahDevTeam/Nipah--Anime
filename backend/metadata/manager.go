package metadata

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	anilistEndpoint  = "https://graphql.anilist.co"
	mangadexEndpoint = "https://api.mangadex.org"
	defaultUserAgent = "NipahAnime/1.1.0 (+https://github.com/NipahDevTeam/Nipah--Anime)"
)

// Manager handles all external metadata API calls.
type Manager struct {
	client             *http.Client
	mu                 sync.Mutex
	cache              map[string]cacheEntry
	active             map[string]*inFlightCall
	lastAniListRequest time.Time
}

type cacheEntry struct {
	body      []byte
	expiresAt time.Time
}

type inFlightCall struct {
	done chan struct{}
	body []byte
	err  error
}

func NewManager() *Manager {
	return &Manager{
		client: &http.Client{Timeout: 15 * time.Second},
		cache:  make(map[string]cacheEntry),
		active: make(map[string]*inFlightCall),
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed result structs
// ─────────────────────────────────────────────────────────────────────────────

// AnimeMetadata is the enriched result we store in the DB after matching.
type AnimeMetadata struct {
	AniListID    int
	MalID        int
	TitleRomaji  string
	TitleEnglish string
	TitleNative  string
	TitleSpanish string // from synonyms or community translation
	Synonyms     []string
	CoverLarge   string
	CoverMedium  string
	BannerImage  string
	Description  string // English fallback
	Year         int
	Episodes     int
	Status       string
	Score        float64
	Genres       []string
}

// MangaMetadata is the enriched result for manga from MangaDex.
type MangaMetadata struct {
	MangaDexID    string
	TitleRomaji   string
	TitleEnglish  string
	TitleSpanish  string
	CoverURL      string
	Description   string
	DescriptionES string
	Year          int
	Status        string
	Chapters      int
}

// ─────────────────────────────────────────────────────────────────────────────
// AniList — anime matching
// ─────────────────────────────────────────────────────────────────────────────

// MatchAnime searches AniList for the best match to a folder name.
// Returns nil if no confident match is found.
func (m *Manager) MatchAnime(folderName string) (*AnimeMetadata, error) {
	// Clean the folder name before searching
	query := cleanTitle(folderName)

	gql := `
	query ($search: String) {
		Page(page: 1, perPage: 5) {
			media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
				id
				idMal
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				averageScore
				episodes
				status
				startDate { year }
				genres
			}
		}
	}`

	payload := map[string]interface{}{
		"query":     gql,
		"variables": map[string]interface{}{"search": query},
	}

	body, err := m.postJSON(anilistEndpoint, payload)
	if err != nil {
		return nil, fmt.Errorf("anilist search failed: %w", err)
	}

	var resp struct {
		Data struct {
			Page struct {
				Media []struct {
					ID    int `json:"id"`
					IDMal int `json:"idMal"`
					Title struct {
						Romaji  string `json:"romaji"`
						English string `json:"english"`
						Native  string `json:"native"`
					} `json:"title"`
					Synonyms   []string `json:"synonyms"`
					CoverImage struct {
						Large  string `json:"large"`
						Medium string `json:"medium"`
					} `json:"coverImage"`
					BannerImage  string  `json:"bannerImage"`
					Description  string  `json:"description"`
					AverageScore float64 `json:"averageScore"`
					Episodes     int     `json:"episodes"`
					Status       string  `json:"status"`
					StartDate    struct {
						Year int `json:"year"`
					} `json:"startDate"`
					Genres []string `json:"genres"`
				} `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("anilist parse failed: %w", err)
	}

	media := resp.Data.Page.Media
	if len(media) == 0 {
		return nil, nil // no match
	}

	// Take the top result — AniList's SEARCH_MATCH ordering is reliable
	top := media[0]

	// Look for a Spanish title in synonyms
	spanishTitle := extractSpanishTitle(top.Synonyms)

	return &AnimeMetadata{
		AniListID:    top.ID,
		MalID:        top.IDMal,
		TitleRomaji:  top.Title.Romaji,
		TitleEnglish: top.Title.English,
		TitleNative:  top.Title.Native,
		TitleSpanish: spanishTitle,
		Synonyms:     top.Synonyms,
		CoverLarge:   top.CoverImage.Large,
		CoverMedium:  top.CoverImage.Medium,
		BannerImage:  top.BannerImage,
		Description:  top.Description,
		Year:         top.StartDate.Year,
		Episodes:     top.Episodes,
		Status:       top.Status,
		Score:        top.AverageScore,
		Genres:       top.Genres,
	}, nil
}

// GetAnimeByID fetches full anime details by AniList ID.
func (m *Manager) GetAnimeByID(id int) (*AnimeMetadata, error) {
	gql := `
	query ($id: Int) {
		Media(id: $id, type: ANIME) {
			id
			idMal
			title { romaji english native }
			synonyms
			coverImage { large medium }
			bannerImage
			description(asHtml: false)
			averageScore
			episodes
			status
			startDate { year }
			genres
		}
	}`

	payload := map[string]interface{}{
		"query":     gql,
		"variables": map[string]interface{}{"id": id},
	}

	body, err := m.postJSON(anilistEndpoint, payload)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data struct {
			Media struct {
				ID    int `json:"id"`
				IDMal int `json:"idMal"`
				Title struct {
					Romaji  string `json:"romaji"`
					English string `json:"english"`
					Native  string `json:"native"`
				} `json:"title"`
				Synonyms   []string `json:"synonyms"`
				CoverImage struct {
					Large  string `json:"large"`
					Medium string `json:"medium"`
				} `json:"coverImage"`
				BannerImage  string  `json:"bannerImage"`
				Description  string  `json:"description"`
				AverageScore float64 `json:"averageScore"`
				Episodes     int     `json:"episodes"`
				Status       string  `json:"status"`
				StartDate    struct {
					Year int `json:"year"`
				} `json:"startDate"`
				Genres []string `json:"genres"`
			} `json:"Media"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}

	med := resp.Data.Media
	return &AnimeMetadata{
		AniListID:    med.ID,
		MalID:        med.IDMal,
		TitleRomaji:  med.Title.Romaji,
		TitleEnglish: med.Title.English,
		TitleNative:  med.Title.Native,
		TitleSpanish: extractSpanishTitle(med.Synonyms),
		Synonyms:     med.Synonyms,
		CoverLarge:   med.CoverImage.Large,
		CoverMedium:  med.CoverImage.Medium,
		BannerImage:  med.BannerImage,
		Description:  med.Description,
		Year:         med.StartDate.Year,
		Episodes:     med.Episodes,
		Status:       med.Status,
		Score:        med.AverageScore,
		Genres:       med.Genres,
	}, nil
}

// GetTrending fetches currently trending/airing anime from AniList for the Descubrir page.
func (m *Manager) GetTrending(lang string) (interface{}, error) {
	gql := `
	query {
		Page(page: 1, perPage: 20) {
			media(type: ANIME, sort: TRENDING_DESC, status: RELEASING) {
				id
				title { romaji english native }
				synonyms
				coverImage { large extraLarge }
				bannerImage
				description(asHtml: false)
				averageScore
				episodes
				season
				seasonYear
				startDate { year month }
				genres
				streamingEpisodes { title thumbnail url site }
			}
		}
	}`

	payload := map[string]interface{}{
		"query": gql,
	}

	body, err := m.postJSON(anilistEndpoint, payload)
	if err != nil {
		return nil, err
	}
	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// DiscoverAnime fetches anime from AniList with genre/season/sort/status filters.
// This powers the Descubrir page's category browsing.
func (m *Manager) DiscoverAnime(genre, season string, year int, sort, status string, page int) (interface{}, error) {
	if page < 1 {
		page = 1
	}

	// Build dynamic GraphQL variables
	vars := map[string]interface{}{
		"page":    page,
		"perPage": 24,
		"type":    "ANIME",
	}

	// Build filter arguments dynamically
	varDecls := []string{"$page: Int", "$perPage: Int", "$type: MediaType"}
	filterArgs := []string{"page: $page, perPage: $perPage", "type: $type"}

	if genre != "" {
		// Support comma-separated genres → genre_in: [String]
		genres := strings.Split(genre, ",")
		for i := range genres {
			genres[i] = strings.TrimSpace(genres[i])
		}
		varDecls = append(varDecls, "$genre_in: [String]")
		filterArgs = append(filterArgs, "genre_in: $genre_in")
		vars["genre_in"] = genres
	}
	if season != "" {
		varDecls = append(varDecls, "$season: MediaSeason")
		filterArgs = append(filterArgs, "season: $season")
		vars["season"] = season
	}
	if year > 0 {
		varDecls = append(varDecls, "$seasonYear: Int")
		filterArgs = append(filterArgs, "seasonYear: $seasonYear")
		vars["seasonYear"] = year
	}
	if status != "" {
		varDecls = append(varDecls, "$status: MediaStatus")
		filterArgs = append(filterArgs, "status: $status")
		vars["status"] = status
	}

	// Sort — default to TRENDING_DESC
	sortVal := "TRENDING_DESC"
	switch sort {
	case "POPULARITY_DESC", "SCORE_DESC", "FAVOURITES_DESC", "START_DATE_DESC", "TRENDING_DESC":
		sortVal = sort
	}
	filterArgs = append(filterArgs, "sort: "+sortVal)

	gql := fmt.Sprintf(`
	query (%s) {
		Page(page: $page, perPage: $perPage) {
			pageInfo { total currentPage lastPage hasNextPage }
			media(%s) {
				id
				title { romaji english native }
				synonyms
				coverImage { large extraLarge }
				bannerImage
				description(asHtml: false)
				averageScore
				episodes
				season
				seasonYear
				startDate { year month }
				genres
				status
				streamingEpisodes { title thumbnail url site }
			}
		}
	}`, strings.Join(varDecls, ", "),
		strings.Join(filterArgs[1:], ", "), // skip page/perPage (used in Page args above)
	)

	payload := map[string]interface{}{
		"query":     gql,
		"variables": vars,
	}

	body, err := m.postJSON(anilistEndpoint, payload)
	if err != nil {
		return nil, err
	}
	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// SearchAniList is the raw search used by the frontend search bar.
func (m *Manager) SearchAniList(query string, lang string) (interface{}, error) {
	gql := `
	query ($search: String) {
		Page(page: 1, perPage: 20) {
			media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
				id
				idMal
				title { romaji english native }
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				averageScore
				episodes
				status
				startDate { year }
				genres
				synonyms
				streamingEpisodes { title thumbnail url site }
			}
		}
	}`

	payload := map[string]interface{}{
		"query":     gql,
		"variables": map[string]interface{}{"search": query},
	}

	body, err := m.postJSON(anilistEndpoint, payload)
	if err != nil {
		return nil, err
	}

	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// MangaDex — manga matching
// ─────────────────────────────────────────────────────────────────────────────

// MatchManga searches MangaDex for the best match to a folder name.
func (m *Manager) MatchManga(folderName string) (*MangaMetadata, error) {
	query := cleanTitle(folderName)

	endpoint := fmt.Sprintf(
		"%s/manga?title=%s&availableTranslatedLanguage[]=es&limit=5&includes[]=cover_art&order[relevance]=desc",
		mangadexEndpoint,
		url.QueryEscape(query),
	)

	body, err := m.getJSON(endpoint)
	if err != nil {
		return nil, fmt.Errorf("mangadex search failed: %w", err)
	}

	var resp struct {
		Data []struct {
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
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("mangadex parse failed: %w", err)
	}

	if len(resp.Data) == 0 {
		return nil, nil
	}

	top := resp.Data[0]
	attr := top.Attributes

	// Extract cover URL
	coverURL := ""
	for _, rel := range top.Relationships {
		if rel.Type == "cover_art" && rel.Attributes != nil {
			coverURL = fmt.Sprintf("https://uploads.mangadex.org/covers/%s/%s.512.jpg",
				top.ID, rel.Attributes.FileName)
			break
		}
	}

	// Prefer Spanish title, fall back to English, then first available
	titleES := attr.Title["es"]
	titleEN := attr.Title["en"]
	titleRomaji := attr.Title["ja-ro"]
	if titleRomaji == "" {
		titleRomaji = attr.Title["ja"]
	}

	// Check alt titles for Spanish
	if titleES == "" {
		for _, alt := range attr.AltTitles {
			if v, ok := alt["es"]; ok && v != "" {
				titleES = v
				break
			}
		}
	}

	return &MangaMetadata{
		MangaDexID:    top.ID,
		TitleRomaji:   titleRomaji,
		TitleEnglish:  titleEN,
		TitleSpanish:  titleES,
		CoverURL:      coverURL,
		Description:   attr.Description["en"],
		DescriptionES: attr.Description["es"],
		Year:          attr.Year,
		Status:        attr.Status,
	}, nil
}

// SearchMangaDex is the raw search used by the frontend search bar.
func (m *Manager) SearchMangaDex(query string, lang string) (interface{}, error) {
	if lang == "" {
		lang = "es"
	}
	endpoint := fmt.Sprintf(
		"%s/manga?title=%s&availableTranslatedLanguage[]=%s&limit=20&includes[]=cover_art&order[relevance]=desc",
		mangadexEndpoint,
		url.QueryEscape(query),
		lang,
	)
	body, err := m.getJSON(endpoint)
	if err != nil {
		return nil, err
	}
	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// GetMangaDexChapters fetches chapters for a manga in the preferred language.
func (m *Manager) GetMangaDexChapters(mangaID string, lang string) (interface{}, error) {
	if lang == "" {
		lang = "es"
	}
	endpoint := fmt.Sprintf(
		"%s/manga/%s/feed?translatedLanguage[]=%s&order[chapter]=asc&limit=500",
		mangadexEndpoint, mangaID, lang,
	)
	body, err := m.getJSON(endpoint)
	if err != nil {
		return nil, err
	}
	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// cleanTitle strips common noise from folder names before searching.
// e.g. "[SubsPlease] Shingeki no Kyojin (01-25) [1080p]" → "Shingeki no Kyojin"
func cleanTitle(name string) string {
	// Remove bracketed content: [SubsPlease], (1080p), etc.
	result := strings.TrimSpace(name)
	for {
		start := strings.IndexByte(result, '[')
		if start == -1 {
			break
		}
		end := strings.IndexByte(result[start:], ']')
		if end == -1 {
			break
		}
		result = strings.TrimSpace(result[:start] + result[start+end+1:])
	}
	for {
		start := strings.IndexByte(result, '(')
		if start == -1 {
			break
		}
		end := strings.IndexByte(result[start:], ')')
		if end == -1 {
			break
		}
		// Only remove if it looks like metadata, not a title part
		inner := result[start+1 : start+end]
		if len(inner) < 20 {
			result = strings.TrimSpace(result[:start] + result[start+end+1:])
		} else {
			break
		}
	}
	// Remove trailing season/episode markers
	result = strings.TrimRight(result, " -_.")
	return result
}

// extractSpanishTitle looks through AniList synonyms for a Spanish title.
// AniList doesn't tag by language, so we use heuristics: Spanish titles
// often contain Spanish articles (el, la, los, las, un, una) or are
// identical to common Spanish translations we can detect by character set.
func extractSpanishTitle(synonyms []string) string {
	spanishMarkers := []string{" el ", " la ", " los ", " las ", " del ", " de ", " un ", " una "}
	for _, s := range synonyms {
		lower := strings.ToLower(s)
		for _, marker := range spanishMarkers {
			if strings.Contains(lower, marker) {
				return s
			}
		}
	}
	return ""
}

func (m *Manager) postJSON(endpoint string, payload interface{}) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	return m.requestBytes("POST", endpoint, data, "application/json")
}

func (m *Manager) requestBytes(method, endpoint string, body []byte, contentType string) ([]byte, error) {
	key := method + "|" + endpoint + "|" + string(body)

	if cached, ok := m.getCached(key); ok {
		return cached, nil
	}

	call, leader := m.beginRequest(key)
	if !leader {
		<-call.done
		if call.err != nil {
			return nil, call.err
		}
		return cloneBytes(call.body), nil
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		m.waitAniListTurn(endpoint)

		reader := bytes.NewReader(body)
		req, err := http.NewRequest(method, endpoint, reader)
		if err != nil {
			lastErr = err
			continue
		}

		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", defaultUserAgent)

		resp, err := m.client.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt+1) * 600 * time.Millisecond)
			continue
		}

		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			time.Sleep(time.Duration(attempt+1) * 600 * time.Millisecond)
			continue
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("metadata request failed: %s", resp.Status)
			time.Sleep(time.Duration(attempt+1) * 900 * time.Millisecond)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("metadata request failed: %s", resp.Status)
			break
		}

		m.finishRequest(key, call, body, nil)
		return body, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("metadata request failed")
	}
	m.finishRequest(key, call, nil, lastErr)
	return nil, lastErr
}

func (m *Manager) getJSON(endpoint string) ([]byte, error) {
	return m.requestBytes("GET", endpoint, nil, "")
}

func (m *Manager) getCached(key string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, ok := m.cache[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(m.cache, key)
		return nil, false
	}
	return cloneBytes(entry.body), true
}

func (m *Manager) beginRequest(key string) (*inFlightCall, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if call, ok := m.active[key]; ok {
		return call, false
	}

	call := &inFlightCall{done: make(chan struct{})}
	m.active[key] = call
	return call, true
}

func (m *Manager) finishRequest(key string, call *inFlightCall, body []byte, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err == nil {
		call.body = cloneBytes(body)
		m.cache[key] = cacheEntry{
			body:      cloneBytes(body),
			expiresAt: time.Now().Add(30 * time.Second),
		}
	} else {
		call.err = err
	}

	delete(m.active, key)
	close(call.done)
}

func (m *Manager) waitAniListTurn(endpoint string) {
	if endpoint != anilistEndpoint {
		return
	}

	m.mu.Lock()
	wait := time.Until(m.lastAniListRequest.Add(350 * time.Millisecond))
	m.mu.Unlock()

	if wait > 0 {
		time.Sleep(wait)
	}

	m.mu.Lock()
	m.lastAniListRequest = time.Now()
	m.mu.Unlock()
}

func cloneBytes(data []byte) []byte {
	if data == nil {
		return nil
	}
	return append([]byte(nil), data...)
}
