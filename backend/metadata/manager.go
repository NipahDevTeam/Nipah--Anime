package metadata

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	azuretls "github.com/Noooste/azuretls-client"
	cachepkg "miruro/backend/cache"
	"miruro/backend/httpclient"
)

var (
	httpSession             = httpclient.NewSession(15)
	stdMetadataClient       = httpclient.NewStdClient(15 * time.Second)
	animeTitleSeasonPattern = regexp.MustCompile(`(?i)\b(?:season|temporada)\s*0*(\d{1,2})\b|\b0*(\d{1,2})(?:st|nd|rd|th)\s+season\b|\bs0*(\d{1,2})\b|\b(?:part|cour)\s*0*(\d{1,2})\b`)
	animeParenPattern       = regexp.MustCompile(`\(([^()]*)\)`)
)

const (
	anilistEndpoint  = "https://graphql.anilist.co"
	mangadexEndpoint = "https://api.mangadex.org"
	defaultUserAgent = "NipahAnime/1.1.0 (+https://github.com/NipahDevTeam/Nipah--Anime)"
	aniListTurnDelay = 650 * time.Millisecond
)

// Manager handles all external metadata API calls.
type Manager struct {
	mu                 sync.Mutex
	active             map[string]*inFlightCall
	lastAniListRequest time.Time
}

type inFlightCall struct {
	done chan struct{}
	body []byte
	err  error
}

func NewManager() *Manager {
	return &Manager{
		active: make(map[string]*inFlightCall),
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed result structs
// ─────────────────────────────────────────────────────────────────────────────

// AnimeMetadata is the enriched result we store in the DB after matching.
type AnimeMetadata struct {
	AniListID         int
	MalID             int
	TitleRomaji       string
	TitleEnglish      string
	TitleNative       string
	TitleSpanish      string // from synonyms or community translation
	Synonyms          []string
	CoverLarge        string
	CoverMedium       string
	BannerImage       string
	Description       string // English fallback
	Year              int
	Episodes          int
	Status            string
	Score             float64
	Genres            []string
	StreamingEpisodes []StreamingEpisode
}

type StreamingEpisode struct {
	Title     string
	Thumbnail string
	URL       string
	Site      string
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

type animeSearchCandidate struct {
	ID     int
	IDMal  int
	Format string
	Title  struct {
		Romaji  string
		English string
		Native  string
	}
	Synonyms   []string
	CoverImage struct {
		Large  string
		Medium string
	}
	BannerImage  string
	Description  string
	AverageScore float64
	Episodes     int
	Status       string
	StartDate    struct {
		Year int
	}
	Genres []string
}

// ─────────────────────────────────────────────────────────────────────────────
// AniList — anime matching
// ─────────────────────────────────────────────────────────────────────────────

// MatchAnime searches AniList for the best match to a folder name.
// Returns nil if no confident match is found.
func (m *Manager) MatchAnime(folderName string) (*AnimeMetadata, error) {
	// Clean the folder name before searching
	query := cleanTitle(folderName)
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}
	requestedSeason := parseRequestedAnimeSeason(query)
	perPage := 5
	if requestedSeason > 0 {
		perPage = 10
	}

	var media []animeSearchCandidate
	for _, searchQuery := range buildAnimeSearchQueries(query) {
		candidates, err := m.searchAnimeCandidates(searchQuery, perPage)
		if err != nil {
			return nil, fmt.Errorf("anilist search failed: %w", err)
		}
		media = append(media, candidates...)
	}
	if len(media) == 0 {
		return nil, nil
	}

	// Take the top result — AniList's SEARCH_MATCH ordering is reliable
	bestIndex := -1
	bestScore := -1
	for i, candidate := range media {
		score := animeCandidateScore(query, candidate.Title.Romaji, candidate.Title.English, candidate.Title.Native, candidate.Synonyms)
		score += animeFormatScoreAdjustment(query, candidate.Format)
		score += animeRequestedSeasonAdjustment(query, candidate.Title.Romaji, candidate.Title.English, candidate.Title.Native, candidate.Synonyms)
		score += animeTitleExpansionPenalty(query, candidate.Title.Romaji, candidate.Title.English)
		score += animeSequelPenalty(query, candidate.Title.Romaji, candidate.Title.English)
		if score > bestScore {
			bestScore = score
			bestIndex = i
		}
	}
	requiredScore := 55
	if requestedSeason > 0 && bestIndex >= 0 && animeCandidateMatchesRequestedSeason(requestedSeason, media[bestIndex]) {
		requiredScore = 40
	}
	if bestIndex == -1 || bestScore < requiredScore {
		return nil, nil
	}

	top := media[bestIndex]

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

func (m *Manager) searchAnimeCandidates(search string, perPage int) ([]animeSearchCandidate, error) {
	gql := `
	query ($search: String, $perPage: Int) {
		Page(page: 1, perPage: $perPage) {
			media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
				id
				idMal
				format
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
		"query": gql,
		"variables": map[string]interface{}{
			"search":  search,
			"perPage": perPage,
		},
	}

	body, err := m.postJSON(anilistEndpoint, payload)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data struct {
			Page struct {
				Media []animeSearchCandidate `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("anilist parse failed: %w", err)
	}
	return resp.Data.Page.Media, nil
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
			streamingEpisodes { title thumbnail url site }
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
				Genres            []string `json:"genres"`
				StreamingEpisodes []struct {
					Title     string `json:"title"`
					Thumbnail string `json:"thumbnail"`
					URL       string `json:"url"`
					Site      string `json:"site"`
				} `json:"streamingEpisodes"`
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
		StreamingEpisodes: func() []StreamingEpisode {
			out := make([]StreamingEpisode, 0, len(med.StreamingEpisodes))
			for _, item := range med.StreamingEpisodes {
				out = append(out, StreamingEpisode{
					Title: item.Title, Thumbnail: item.Thumbnail, URL: item.URL, Site: item.Site,
				})
			}
			return out
		}(),
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

func animeCandidateScore(query string, titles ...interface{}) int {
	best := 0
	for _, raw := range titles {
		switch value := raw.(type) {
		case string:
			best = maxInt(best, scoreAnimeTitleVariant(query, value))
		case []string:
			for _, item := range value {
				best = maxInt(best, scoreAnimeTitleVariant(query, item))
			}
		}
	}
	return best
}

func animeFormatScoreAdjustment(query, format string) int {
	if !looksLikeBaseAnimeSeriesQuery(query) {
		return 0
	}

	switch strings.ToUpper(strings.TrimSpace(format)) {
	case "TV":
		return 8
	case "TV_SHORT":
		return 4
	case "MOVIE":
		return -18
	case "SPECIAL":
		return -16
	case "OVA", "ONA":
		return -10
	default:
		return 0
	}
}

func animeRequestedSeasonAdjustment(query string, titles ...interface{}) int {
	requestedSeason := parseRequestedAnimeSeason(query)
	if requestedSeason == 0 {
		return 0
	}

	best := -18
	seenAnySeasonMarker := false
	for _, raw := range titles {
		switch value := raw.(type) {
		case string:
			season, hasSeason := detectAnimeTitleSeason(value)
			if hasSeason {
				seenAnySeasonMarker = true
			}
			best = maxInt(best, scoreRequestedAnimeSeason(requestedSeason, season, hasSeason))
		case []string:
			for _, item := range value {
				season, hasSeason := detectAnimeTitleSeason(item)
				if hasSeason {
					seenAnySeasonMarker = true
				}
				best = maxInt(best, scoreRequestedAnimeSeason(requestedSeason, season, hasSeason))
			}
		}
	}

	if !seenAnySeasonMarker {
		return -12
	}
	return best
}

func animeTitleExpansionPenalty(query string, titles ...string) int {
	if !looksLikeBaseAnimeSeriesQuery(query) {
		return 0
	}

	penalty := 0
	for _, title := range titles {
		penalty = minInt(penalty, scoreAnimeExpansionPenalty(query, title))
	}
	return penalty
}

func looksLikeBaseAnimeSeriesQuery(query string) bool {
	queryNorm := normalizeAnimeMatchText(query)
	if queryNorm == "" {
		return false
	}

	markers := []string{
		" movie ", " film ", " ova ", " ona ", " special ", " season ", " temporada ",
		" part ", " cour ", " chapter ", " episode ", " episodio ", " final ",
		" beginning ", " shin ", " ii ", " iii ", " iv ", " 2nd ", " 3rd ", " 4th ",
	}
	padded := " " + queryNorm + " "
	for _, marker := range markers {
		if strings.Contains(padded, marker) {
			return false
		}
	}
	return true
}

func parseRequestedAnimeSeason(query string) int {
	season, _ := detectAnimeTitleSeason(query)
	return season
}

func buildAnimeSearchQueries(query string) []string {
	seen := map[string]struct{}{}
	var out []string
	push := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}

	push(query)
	requestedSeason := parseRequestedAnimeSeason(query)
	for _, base := range extractAnimeSearchBases(query) {
		push(base)
	}
	if requestedSeason == 0 {
		return out
	}

	for _, base := range extractAnimeSearchBases(stripAnimeSeasonMarkers(query)) {
		push(base)
		push(fmt.Sprintf("%s Season %d", base, requestedSeason))
		if ordinal := ordinalAnimeSeasonLabel(requestedSeason); ordinal != "" {
			push(fmt.Sprintf("%s %s Season", base, ordinal))
		}
	}
	return out
}

func extractAnimeSearchBases(value string) []string {
	seen := map[string]struct{}{}
	var out []string
	push := func(candidate string) {
		candidate = strings.Join(strings.Fields(strings.TrimSpace(candidate)), " ")
		if candidate == "" {
			return
		}
		key := strings.ToLower(candidate)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, candidate)
	}

	push(strings.TrimSpace(value))
	for _, match := range animeParenPattern.FindAllStringSubmatch(value, -1) {
		if len(match) > 1 {
			push(strings.TrimSpace(match[1]))
		}
	}
	push(animeParenPattern.ReplaceAllString(value, " "))
	return out
}

func stripAnimeSeasonMarkers(value string) string {
	replacer := strings.NewReplacer(
		"Season 1", "",
		"Season 2", "",
		"Season 3", "",
		"Season 4", "",
		"Season 5", "",
		"season 1", "",
		"season 2", "",
		"season 3", "",
		"season 4", "",
		"season 5", "",
		"Temporada 1", "",
		"Temporada 2", "",
		"Temporada 3", "",
		"Temporada 4", "",
		"temporada 1", "",
		"temporada 2", "",
		"temporada 3", "",
		"temporada 4", "",
		"1st Season", "",
		"2nd Season", "",
		"3rd Season", "",
		"4th Season", "",
		"5th Season", "",
		"1st season", "",
		"2nd season", "",
		"3rd season", "",
		"4th season", "",
		"5th season", "",
	)
	value = replacer.Replace(value)
	return strings.Join(strings.Fields(strings.Trim(value, " -_:")), " ")
}

func ordinalAnimeSeasonLabel(season int) string {
	switch season {
	case 1:
		return "1st"
	case 2:
		return "2nd"
	case 3:
		return "3rd"
	case 4:
		return "4th"
	case 5:
		return "5th"
	default:
		return ""
	}
}

func detectAnimeTitleSeason(value string) (int, bool) {
	value = normalizeAnimeMatchText(value)
	if strings.TrimSpace(value) == "" {
		return 0, false
	}

	matches := animeTitleSeasonPattern.FindStringSubmatch(value)
	if len(matches) > 0 {
		for _, match := range matches[1:] {
			if match == "" {
				continue
			}
			if season, err := strconv.Atoi(match); err == nil && season > 0 {
				return season, true
			}
		}
	}
	return 0, false
}

func scoreRequestedAnimeSeason(requested, candidate int, hasSeason bool) int {
	if !hasSeason {
		return -12
	}
	if candidate == requested {
		return 28
	}
	return -24
}

func animeCandidateMatchesRequestedSeason(requestedSeason int, candidate animeSearchCandidate) bool {
	for _, title := range []string{candidate.Title.Romaji, candidate.Title.English, candidate.Title.Native} {
		if season, ok := detectAnimeTitleSeason(title); ok && season == requestedSeason {
			return true
		}
	}
	for _, synonym := range candidate.Synonyms {
		if season, ok := detectAnimeTitleSeason(synonym); ok && season == requestedSeason {
			return true
		}
	}
	return false
}

func scoreAnimeExpansionPenalty(query, candidate string) int {
	queryNorm := normalizeAnimeMatchText(query)
	candidateNorm := normalizeAnimeMatchText(candidate)
	if queryNorm == "" || candidateNorm == "" || queryNorm == candidateNorm {
		return 0
	}

	queryTokens := animeMatchTokens(queryNorm)
	candidateTokens := animeMatchTokens(candidateNorm)
	if len(queryTokens) == 0 || len(candidateTokens) <= len(queryTokens) {
		return 0
	}

	for i, token := range queryTokens {
		if candidateTokens[i] != token {
			return 0
		}
	}

	extraTokens := len(candidateTokens) - len(queryTokens)
	if extraTokens >= 4 {
		return -16
	}
	if extraTokens >= 2 {
		return -10
	}
	return -6
}

func animeSequelPenalty(query string, titles ...string) int {
	if !looksLikeBaseAnimeSeriesQuery(query) {
		return 0
	}

	penalty := 0
	for _, title := range titles {
		penalty = minInt(penalty, scoreAnimeSequelTitlePenalty(title))
	}
	return penalty
}

func scoreAnimeSequelTitlePenalty(title string) int {
	titleNorm := " " + normalizeAnimeMatchText(title) + " "
	if strings.TrimSpace(titleNorm) == "" {
		return 0
	}

	severeMarkers := []string{
		" season 2 ", " season 3 ", " season 4 ", " season 5 ",
		" 2nd season ", " 3rd season ", " 4th season ", " second season ",
		" third season ", " final season ", " movie ", " film ",
	}
	for _, marker := range severeMarkers {
		if strings.Contains(titleNorm, marker) {
			return -22
		}
	}

	moderateMarkers := []string{
		" part 2 ", " part 3 ", " chapter 2 ", " chapter 3 ",
		" road to the top ", " beginning of a new era ", " new era ",
	}
	for _, marker := range moderateMarkers {
		if strings.Contains(titleNorm, marker) {
			return -14
		}
	}

	return 0
}

func scoreAnimeTitleVariant(query, candidate string) int {
	queryNorm := normalizeAnimeMatchText(query)
	candidateNorm := normalizeAnimeMatchText(candidate)
	if queryNorm == "" || candidateNorm == "" {
		return 0
	}
	if queryNorm == candidateNorm {
		return 100
	}

	queryCompact := compactAnimeMatchText(queryNorm)
	candidateCompact := compactAnimeMatchText(candidateNorm)
	if queryCompact == "" || candidateCompact == "" {
		return 0
	}
	if queryCompact == candidateCompact {
		return 96
	}

	score := 0
	if strings.Contains(queryCompact, candidateCompact) || strings.Contains(candidateCompact, queryCompact) {
		shorter := len(candidateCompact)
		if len(queryCompact) < shorter {
			shorter = len(queryCompact)
		}
		score = maxInt(score, 72+shorter)
	}

	queryTokens := animeMatchTokens(queryNorm)
	candidateTokens := animeMatchTokens(candidateNorm)
	if len(queryTokens) == 0 || len(candidateTokens) == 0 {
		return score
	}

	overlap := 0
	for _, token := range queryTokens {
		for _, candidateToken := range candidateTokens {
			if token == candidateToken {
				overlap++
				break
			}
		}
	}
	queryCoverage := float64(overlap) / float64(len(queryTokens))
	candidateCoverage := float64(overlap) / float64(len(candidateTokens))
	score = maxInt(score, int(queryCoverage*60.0+candidateCoverage*25.0))
	if overlap >= len(queryTokens) && len(queryTokens) > 0 {
		score += 10
	}
	return score
}

func normalizeAnimeMatchText(value string) string {
	value = cleanTitle(value)
	if value == "" {
		return ""
	}
	replacer := strings.NewReplacer(
		".", "",
		"!", " ",
		"?", " ",
		":", " ",
		";", " ",
		",", " ",
		"_", " ",
		"-", " ",
		"/", " ",
		"\\", " ",
		"(", " ",
		")", " ",
		"[", " ",
		"]", " ",
		"{", " ",
		"}", " ",
		"'", "",
		"\"", "",
	)
	value = replacer.Replace(strings.ToLower(strings.TrimSpace(value)))
	return strings.Join(strings.Fields(value), " ")
}

func compactAnimeMatchText(value string) string {
	return strings.ReplaceAll(value, " ", "")
}

func animeMatchTokens(value string) []string {
	return strings.Fields(value)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// extractSpanishTitle looks through AniList synonyms for a Spanish title.
// AniList doesn't tag by language, so we use heuristics: Spanish titles
// often contain Spanish articles (el, la, los, las, un, una) or are
// identical to common Spanish translations we can detect by character set.
func extractSpanishTitle(synonyms []string) string {
	spanishMarkers := []string{" a la ", " al ", " de la ", " de las ", " de los ", " bienvenido ", " bienvenida "}
	nonSpanishMarkers := []string{" dans ", " bienvenue ", " le ", " les ", " des ", " pour ", " au ", " aux "}
	for _, s := range synonyms {
		lower := strings.ToLower(s)
		rejected := false
		for _, marker := range nonSpanishMarkers {
			if strings.Contains(lower, marker) {
				rejected = true
				break
			}
		}
		if rejected {
			continue
		}
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
	key := requestCacheKey(method, endpoint, body)
	staleKey := staleRequestCacheKey(key)

	if cached, ok := cachepkg.Global().GetBytes(key); ok {
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
	maxAttempts := 3
	if endpoint == anilistEndpoint {
		maxAttempts = 4
	}
	for attempt := 0; attempt < maxAttempts; attempt++ {
		m.waitAniListTurn(endpoint)

		respBody, statusCode, err := performMetadataRequest(method, endpoint, body, contentType)
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt+1) * 600 * time.Millisecond)
			continue
		}

		if statusCode == 409 && endpoint == anilistEndpoint {
			lastErr = metadataHTTPError(endpoint, statusCode, respBody)
			time.Sleep(time.Duration(attempt+1) * 1500 * time.Millisecond)
			continue
		}
		if statusCode == 429 || statusCode >= 500 {
			lastErr = metadataHTTPError(endpoint, statusCode, respBody)
			time.Sleep(time.Duration(attempt+1) * 900 * time.Millisecond)
			continue
		}
		if statusCode < 200 || statusCode >= 300 {
			lastErr = metadataHTTPError(endpoint, statusCode, respBody)
			break
		}

		freshTTL := metadataRequestTTL(endpoint, body)
		cachepkg.Global().SetBytes(key, respBody, freshTTL)
		cachepkg.Global().SetBytes(staleKey, respBody, staleMetadataRequestTTL(endpoint, body, freshTTL))
		m.finishRequest(call, respBody, nil)
		return respBody, nil
	}

	if endpoint == anilistEndpoint {
		if stale, ok := cachepkg.Global().GetBytes(staleKey); ok {
			m.finishRequest(call, stale, nil)
			return stale, nil
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("metadata request failed")
	}
	m.finishRequest(call, nil, lastErr)
	return nil, lastErr
}

func performMetadataRequest(method, endpoint string, body []byte, contentType string) ([]byte, int, error) {
	if usesStandardMetadataClient(endpoint) {
		var bodyReader io.Reader
		if len(body) > 0 {
			bodyReader = bytes.NewReader(body)
		}
		req, err := http.NewRequest(method, endpoint, bodyReader)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", defaultUserAgent)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		resp, err := stdMetadataClient.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, resp.StatusCode, err
		}
		return respBody, resp.StatusCode, nil
	}

	req := &azuretls.Request{
		Url:    endpoint,
		Method: method,
		OrderedHeaders: azuretls.OrderedHeaders{
			{"Accept", "application/json"},
			{"User-Agent", defaultUserAgent},
		},
	}
	if len(body) > 0 {
		req.Body = body
	}
	if contentType != "" {
		req.OrderedHeaders = append(req.OrderedHeaders, []string{"Content-Type", contentType})
	}

	resp, err := httpSession.Do(req)
	if err != nil {
		return nil, 0, err
	}
	return resp.Body, resp.StatusCode, nil
}

func usesStandardMetadataClient(endpoint string) bool {
	return endpoint == anilistEndpoint || endpoint == mangadexEndpoint
}

func (m *Manager) getJSON(endpoint string) ([]byte, error) {
	return m.requestBytes("GET", endpoint, nil, "")
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

func (m *Manager) finishRequest(call *inFlightCall, body []byte, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err == nil {
		call.body = cloneBytes(body)
	} else {
		call.err = err
	}

	for key, active := range m.active {
		if active == call {
			delete(m.active, key)
			break
		}
	}
	close(call.done)
}

func (m *Manager) waitAniListTurn(endpoint string) {
	if endpoint != anilistEndpoint {
		return
	}

	m.mu.Lock()
	wait := time.Until(m.lastAniListRequest.Add(aniListTurnDelay))
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

func requestCacheKey(method, endpoint string, body []byte) string {
	sum := sha1.Sum(body)
	return method + "|" + endpoint + "|" + hex.EncodeToString(sum[:])
}

func staleRequestCacheKey(key string) string {
	return key + "|stale"
}

func metadataRequestTTL(endpoint string, body []byte) time.Duration {
	payload := string(body)

	if endpoint == anilistEndpoint {
		switch {
		case strings.Contains(payload, "Media(id: $id, type: ANIME)") || strings.Contains(payload, "Media(id: $id, type: MANGA)"):
			return time.Hour
		case strings.Contains(payload, "sort: SEARCH_MATCH"):
			return 10 * time.Minute
		case strings.Contains(payload, "sort: TRENDING_DESC") || strings.Contains(payload, "streamingEpisodes"):
			return 10 * time.Minute
		default:
			return 10 * time.Minute
		}
	}

	if strings.HasPrefix(endpoint, mangadexEndpoint) {
		return 30 * time.Minute
	}

	return 30 * time.Second
}

func staleMetadataRequestTTL(endpoint string, body []byte, freshTTL time.Duration) time.Duration {
	if endpoint == anilistEndpoint {
		switch {
		case strings.Contains(string(body), "Media(id: $id, type: MANGA)"), strings.Contains(string(body), "sort: SEARCH_MATCH"):
			return 6 * time.Hour
		default:
			return 2 * time.Hour
		}
	}
	if freshTTL > 0 {
		return freshTTL * 4
	}
	return 2 * time.Minute
}

func metadataHTTPError(endpoint string, status int, body []byte) error {
	message := extractMetadataErrorMessage(body)
	if endpoint == anilistEndpoint && status == 403 {
		lower := strings.ToLower(message)
		if strings.Contains(lower, "temporarily disabled") || strings.Contains(lower, "severe stability issues") {
			if message == "" {
				return fmt.Errorf("AniList API unavailable")
			}
			return fmt.Errorf("AniList API unavailable: %s", message)
		}
	}
	if message != "" {
		return fmt.Errorf("metadata request failed: %d (%s)", status, message)
	}
	return fmt.Errorf("metadata request failed: %d", status)
}

func extractMetadataErrorMessage(body []byte) string {
	if len(body) == 0 {
		return ""
	}

	var payload struct {
		Message string `json:"message"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		if msg := strings.TrimSpace(payload.Message); msg != "" {
			return msg
		}
		for _, item := range payload.Errors {
			if msg := strings.TrimSpace(item.Message); msg != "" {
				return msg
			}
		}
	}

	text := strings.TrimSpace(string(body))
	if len(text) > 220 {
		text = text[:220]
	}
	return text
}

func IsAniListUnavailableError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "anilist api unavailable") ||
		(strings.Contains(message, "temporarily disabled") && strings.Contains(message, "stability issues"))
}

func IsRetryableAniListError(err error) bool {
	if err == nil {
		return false
	}
	if IsAniListUnavailableError(err) {
		return false
	}
	message := err.Error()
	if strings.Contains(message, "metadata request failed: 409") {
		return true
	}
	if strings.Contains(message, "metadata request failed: 429") {
		return true
	}
	return strings.Contains(message, "timeout") || strings.Contains(message, "fetch")
}
