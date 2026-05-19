package metadata

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"
)

var jikanEndpoint = "https://api.jikan.moe/v4"

// JikanAnimeEntry represents a single anime entry from a MAL user's list.
type JikanAnimeEntry struct {
	MalID           int     `json:"mal_id"`
	Title           string  `json:"title"`
	TitleEnglish    string  `json:"title_english"`
	ImageURL        string  `json:"image_url"`
	BannerImage     string  `json:"banner_image"`
	Status          string  `json:"status"`
	EpisodesWatched int     `json:"episodes_watched"`
	EpisodesTotal   int     `json:"episodes_total"`
	Score           float64 `json:"score"`
	AiringStatus    string  `json:"airing_status"`
	Year            int     `json:"year"`
	AnilistID       int     `json:"anilist_id"`
}

// jikanUserListResponse is the raw JSON shape from Jikan /users/{username}/animelist
type jikanUserListResponse struct {
	Data       []jikanAnimeData `json:"data"`
	Pagination struct {
		LastVisiblePage int  `json:"last_visible_page"`
		HasNextPage     bool `json:"has_next_page"`
	} `json:"pagination"`
}

type jikanAnimeData struct {
	Entry struct {
		MalID  int    `json:"mal_id"`
		Title  string `json:"title"`
		Images struct {
			JPG struct {
				LargeImageURL string `json:"large_image_url"`
				ImageURL      string `json:"image_url"`
			} `json:"jpg"`
		} `json:"images"`
		Episodes int    `json:"episodes"`
		Year     int    `json:"year"`
		Status   string `json:"status"`
	} `json:"entry"`
	Score           int    `json:"score"`
	EpisodesWatched int    `json:"episodes_watched"`
	Status          string `json:"status"`
}

type jikanImageSet struct {
	LargeImageURL string `json:"large_image_url"`
	ImageURL      string `json:"image_url"`
}

type jikanImageVariants struct {
	JPG  jikanImageSet `json:"jpg"`
	WEBP jikanImageSet `json:"webp"`
}

type jikanAnimeSearchResponse struct {
	Data []jikanAnimeSearchItem `json:"data"`
}

type jikanAnimeSearchItem struct {
	MalID         int                `json:"mal_id"`
	Title         string             `json:"title"`
	TitleEnglish  string             `json:"title_english"`
	TitleJapanese string             `json:"title_japanese"`
	Synopsis      string             `json:"synopsis"`
	Synonyms      []string           `json:"synonyms"`
	Episodes      int                `json:"episodes"`
	Status        string             `json:"status"`
	Year          int                `json:"year"`
	Score         float64            `json:"score"`
	Genres        []jikanNamedEntity `json:"genres"`
	Images        jikanImageVariants `json:"images"`
}

type jikanNamedEntity struct {
	Name string `json:"name"`
}

type jikanAiredWindow struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type jikanAnimeFullResponse struct {
	Data jikanAnimeFullItem `json:"data"`
}

type jikanAnimeFullItem struct {
	MalID         int                `json:"mal_id"`
	Title         string             `json:"title"`
	TitleEnglish  string             `json:"title_english"`
	TitleJapanese string             `json:"title_japanese"`
	Synopsis      string             `json:"synopsis"`
	Score         float64            `json:"score"`
	Episodes      int                `json:"episodes"`
	Status        string             `json:"status"`
	Year          int                `json:"year"`
	Season        string             `json:"season"`
	Source        string             `json:"source"`
	Images        jikanImageVariants `json:"images"`
	Genres        []jikanNamedEntity `json:"genres"`
	Studios       []jikanNamedEntity `json:"studios"`
	Aired         jikanAiredWindow   `json:"aired"`
}

type jikanAnimeCharactersResponse struct {
	Data []jikanAnimeCharacterItem `json:"data"`
}

type jikanAnimeCharacterItem struct {
	Role      string                 `json:"role"`
	Character jikanAnimeCharacterRef `json:"character"`
}

type jikanAnimeCharacterRef struct {
	MalID     int                `json:"mal_id"`
	Name      string             `json:"name"`
	NameKanji string             `json:"name_kanji"`
	Images    jikanImageVariants `json:"images"`
}

type jikanAnimeRecommendationsResponse struct {
	Data []jikanAnimeRecommendationItem `json:"data"`
}

type jikanAnimeRecommendationItem struct {
	Entry jikanAnimeRecommendationEntry `json:"entry"`
}

type jikanAnimeRecommendationEntry struct {
	MalID  int                `json:"mal_id"`
	Title  string             `json:"title"`
	URL    string             `json:"url"`
	Images jikanImageVariants `json:"images"`
}

type jikanMangaRecommendationsResponse struct {
	Data []jikanMangaRecommendationItem `json:"data"`
}

type jikanMangaRecommendationItem struct {
	Entry jikanMangaRecommendationEntry `json:"entry"`
}

type jikanMangaRecommendationEntry struct {
	MalID  int                `json:"mal_id"`
	Title  string             `json:"title"`
	URL    string             `json:"url"`
	Images jikanImageVariants `json:"images"`
}

type jikanMangaFullResponse struct {
	Data jikanMangaFullItem `json:"data"`
}

type jikanMangaFullItem struct {
	MalID         int                `json:"mal_id"`
	Title         string             `json:"title"`
	TitleEnglish  string             `json:"title_english"`
	TitleJapanese string             `json:"title_japanese"`
	Synopsis      string             `json:"synopsis"`
	Score         float64            `json:"score"`
	Status        string             `json:"status"`
	Year          int                `json:"year"`
	Chapters      int                `json:"chapters"`
	Volumes       int                `json:"volumes"`
	Source        string             `json:"source"`
	Images        jikanImageVariants `json:"images"`
	Genres        []jikanNamedEntity `json:"genres"`
	Authors       []jikanNamedEntity `json:"authors"`
	Published     jikanAiredWindow   `json:"published"`
}

type jikanMangaCharactersResponse struct {
	Data []jikanMangaCharacterItem `json:"data"`
}

type jikanMangaCharacterItem struct {
	Role      string                 `json:"role"`
	Character jikanAnimeCharacterRef `json:"character"`
}

var malStatusToInternal = map[string]string{
	"Watching":      "WATCHING",
	"Completed":     "COMPLETED",
	"On-Hold":       "ON_HOLD",
	"Dropped":       "DROPPED",
	"Plan to Watch": "PLANNING",
}

var jikanAnimeStatusToAniList = map[string]string{
	"Currently Airing": "RELEASING",
	"Finished Airing":  "FINISHED",
	"Not yet aired":    "NOT_YET_RELEASED",
	"To Be Announced":  "NOT_YET_RELEASED",
	"On Hiatus":        "HIATUS",
}

var jikanMangaStatusToAniList = map[string]string{
	"Publishing":        "RELEASING",
	"Finished":          "FINISHED",
	"On Hiatus":         "HIATUS",
	"Discontinued":      "CANCELLED",
	"Not yet published": "NOT_YET_RELEASED",
}

var jikanGenreIDs = map[string]int{
	"Action":        1,
	"Adventure":     2,
	"Comedy":        4,
	"Drama":         8,
	"Fantasy":       10,
	"Mystery":       7,
	"Romance":       22,
	"Sci-Fi":        24,
	"Sports":        30,
	"Slice of Life": 36,
	"Supernatural":  37,
}

// FetchMALUserAnimeList fetches the full anime list for a MAL user via Jikan API.
func (m *Manager) FetchMALUserAnimeList(username string) ([]JikanAnimeEntry, error) {
	var allEntries []JikanAnimeEntry
	page := 1

	for {
		url := fmt.Sprintf("%s/users/%s/animelist?page=%d", jikanEndpoint, username, page)
		entries, hasNext, err := m.fetchJikanPage(url)
		if err != nil {
			return allEntries, fmt.Errorf("page %d: %w", page, err)
		}
		allEntries = append(allEntries, entries...)

		if !hasNext {
			break
		}
		page++
		// Jikan rate limit: ~3 requests per second
		time.Sleep(400 * time.Millisecond)
	}

	return allEntries, nil
}

func (m *Manager) SearchAnimeViaJikan(query string) (interface{}, error) {
	trimmedQuery := strings.TrimSpace(query)
	if trimmedQuery == "" {
		return map[string]interface{}{
			"data": map[string]interface{}{
				"Page": map[string]interface{}{
					"media": []interface{}{},
				},
			},
		}, nil
	}

	requestURL := fmt.Sprintf("%s/anime?q=%s&limit=30", jikanEndpoint, url.QueryEscape(trimmedQuery))
	body, err := m.getJSON(requestURL)
	if err != nil {
		return nil, err
	}

	var parsed jikanAnimeSearchResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("parse Jikan anime search: %w", err)
	}

	media := make([]interface{}, 0, len(parsed.Data))
	for _, raw := range parsed.Data {
		media = append(media, mapJikanAnimeSearchResultToReadModel(raw))
	}

	return map[string]interface{}{
		"data": map[string]interface{}{
			"Page": map[string]interface{}{
				"media": media,
			},
		},
	}, nil
}

func mapJikanAnimeSearchResultToReadModel(raw jikanAnimeSearchItem) map[string]interface{} {
	largeCover := strings.TrimSpace(raw.Images.JPG.LargeImageURL)
	if largeCover == "" {
		largeCover = strings.TrimSpace(raw.Images.WEBP.LargeImageURL)
	}
	mediumCover := strings.TrimSpace(raw.Images.JPG.ImageURL)
	if mediumCover == "" {
		mediumCover = strings.TrimSpace(raw.Images.WEBP.ImageURL)
	}
	if largeCover == "" {
		largeCover = mediumCover
	}
	if mediumCover == "" {
		mediumCover = largeCover
	}

	status := jikanAnimeStatusToAniList[strings.TrimSpace(raw.Status)]
	if status == "" {
		status = "FINISHED"
	}

	canonicalTitle := strings.TrimSpace(raw.TitleEnglish)
	if canonicalTitle == "" {
		canonicalTitle = strings.TrimSpace(raw.Title)
	}

	genres := make([]string, 0, len(raw.Genres))
	for _, item := range raw.Genres {
		name := strings.TrimSpace(item.Name)
		if name != "" {
			genres = append(genres, name)
		}
	}

	return map[string]interface{}{
		"id":              0,
		"anilist_id":      0,
		"idMal":           raw.MalID,
		"mal_id":          raw.MalID,
		"title":           map[string]interface{}{"romaji": raw.Title, "english": raw.TitleEnglish, "native": raw.TitleJapanese},
		"title_romaji":    raw.Title,
		"title_english":   raw.TitleEnglish,
		"title_native":    raw.TitleJapanese,
		"canonical_title": canonicalTitle,
		"coverImage": map[string]interface{}{
			"extraLarge": largeCover,
			"large":      largeCover,
			"medium":     mediumCover,
		},
		"cover_large":  largeCover,
		"cover_medium": mediumCover,
		"bannerImage":  largeCover,
		"description":  strings.TrimSpace(raw.Synopsis),
		"averageScore": int(math.Round(raw.Score * 10)),
		"episodes":     raw.Episodes,
		"status":       status,
		"seasonYear":   raw.Year,
		"genres":       genres,
		"synonyms":     append([]string(nil), raw.Synonyms...),
	}
}

func (m *Manager) GetAnimeDetailViaJikan(malID int) (*AnimeMetadata, error) {
	if malID <= 0 {
		return nil, fmt.Errorf("invalid MAL id")
	}

	body, err := m.getJSON(fmt.Sprintf("%s/anime/%d/full", jikanEndpoint, malID))
	if err != nil {
		return nil, err
	}

	var fullResponse jikanAnimeFullResponse
	if err := json.Unmarshal(body, &fullResponse); err != nil {
		return nil, fmt.Errorf("parse Jikan anime detail: %w", err)
	}

	characters, err := m.GetAnimeCharactersViaJikan(malID)
	if err != nil {
		return nil, err
	}

	recommendations, err := m.GetAnimeRecommendationsViaJikan(malID)
	if err != nil {
		return nil, err
	}

	full := fullResponse.Data
	largeCover := strings.TrimSpace(full.Images.JPG.LargeImageURL)
	if largeCover == "" {
		largeCover = strings.TrimSpace(full.Images.WEBP.LargeImageURL)
	}
	mediumCover := strings.TrimSpace(full.Images.JPG.ImageURL)
	if mediumCover == "" {
		mediumCover = strings.TrimSpace(full.Images.WEBP.ImageURL)
	}
	if largeCover == "" {
		largeCover = mediumCover
	}
	if mediumCover == "" {
		mediumCover = largeCover
	}

	status := jikanAnimeStatusToAniList[strings.TrimSpace(full.Status)]
	if status == "" {
		status = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(full.Status), " ", "_"))
	}

	genres := make([]string, 0, len(full.Genres))
	for _, item := range full.Genres {
		name := strings.TrimSpace(item.Name)
		if name != "" {
			genres = append(genres, name)
		}
	}

	studios := make([]AniListStudio, 0, len(full.Studios))
	for _, item := range full.Studios {
		name := strings.TrimSpace(item.Name)
		if name != "" {
			studios = append(studios, AniListStudio{Name: name})
		}
	}

	startDate := parseJikanDate(full.Aired.From)
	endDate := parseJikanDate(full.Aired.To)
	year := full.Year
	if year <= 0 {
		year = startDate.Year
	}

	source := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(full.Source), " ", "_"))
	season := strings.ToUpper(strings.TrimSpace(full.Season))
	score := float64(int(math.Round(full.Score * 10)))

	return &AnimeMetadata{
		AniListID:       0,
		MalID:           full.MalID,
		TitleRomaji:     strings.TrimSpace(full.Title),
		TitleEnglish:    strings.TrimSpace(full.TitleEnglish),
		TitleNative:     strings.TrimSpace(full.TitleJapanese),
		CoverLarge:      largeCover,
		CoverMedium:     mediumCover,
		Description:     strings.TrimSpace(full.Synopsis),
		Year:            year,
		Episodes:        full.Episodes,
		Status:          status,
		Score:           score,
		AverageScore:    score,
		Source:          source,
		Season:          season,
		SeasonYear:      year,
		StartDate:       startDate,
		EndDate:         endDate,
		Studios:         studios,
		Genres:          genres,
		Characters:      characters,
		Recommendations: recommendations,
	}, nil
}

func (m *Manager) GetAnimeCharactersViaJikan(malID int) ([]AnimeCharacter, error) {
	body, err := m.getJSON(fmt.Sprintf("%s/anime/%d/characters", jikanEndpoint, malID))
	if err != nil {
		return nil, err
	}

	var response jikanAnimeCharactersResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse Jikan anime characters: %w", err)
	}

	out := make([]AnimeCharacter, 0, len(response.Data))
	for _, item := range response.Data {
		name := strings.TrimSpace(item.Character.Name)
		if name == "" {
			continue
		}
		image := strings.TrimSpace(item.Character.Images.JPG.ImageURL)
		if image == "" {
			image = strings.TrimSpace(item.Character.Images.WEBP.ImageURL)
		}
		role := strings.ToUpper(strings.TrimSpace(item.Role))
		if role == "" {
			role = "SUPPORTING"
		}
		out = append(out, AnimeCharacter{
			ID:         item.Character.MalID,
			Name:       name,
			NameNative: strings.TrimSpace(item.Character.NameKanji),
			Role:       role,
			Image:      image,
		})
	}
	return limitAnimeCharacters(out, preferredCharacterLimit), nil
}

func (m *Manager) GetAnimeRecommendationsViaJikan(malID int) ([]AniListRecommendation, error) {
	body, err := m.getJSON(fmt.Sprintf("%s/anime/%d/recommendations", jikanEndpoint, malID))
	if err != nil {
		return nil, err
	}

	var response jikanAnimeRecommendationsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse Jikan anime recommendations: %w", err)
	}

	out := make([]AniListRecommendation, 0, len(response.Data))
	seen := make(map[int]struct{}, len(response.Data))
	for _, item := range response.Data {
		entry := item.Entry
		title := strings.TrimSpace(entry.Title)
		if entry.MalID <= 0 || title == "" {
			continue
		}
		if _, exists := seen[entry.MalID]; exists {
			continue
		}
		seen[entry.MalID] = struct{}{}

		largeCover := strings.TrimSpace(entry.Images.JPG.LargeImageURL)
		if largeCover == "" {
			largeCover = strings.TrimSpace(entry.Images.WEBP.LargeImageURL)
		}
		mediumCover := strings.TrimSpace(entry.Images.JPG.ImageURL)
		if mediumCover == "" {
			mediumCover = strings.TrimSpace(entry.Images.WEBP.ImageURL)
		}
		if largeCover == "" {
			largeCover = mediumCover
		}
		if mediumCover == "" {
			mediumCover = largeCover
		}

		out = append(out, AniListRecommendation{
			ID:        entry.MalID,
			AniListID: 0,
			MalID:     entry.MalID,
			MediaType: "ANIME",
			Title: AniListRecommendationTitle{
				English: title,
				Romaji:  title,
			},
			CoverImage: AniListRecommendationCoverImage{
				ExtraLarge: largeCover,
				Large:      largeCover,
				Medium:     mediumCover,
			},
			SiteURL: strings.TrimSpace(entry.URL),
		})
	}
	return limitRecommendations(out, preferredRecommendationLimit), nil
}

func (m *Manager) GetMangaRecommendationsViaJikan(malID int) ([]AniListRecommendation, error) {
	body, err := m.getJSON(fmt.Sprintf("%s/manga/%d/recommendations", jikanEndpoint, malID))
	if err != nil {
		return nil, err
	}

	var response jikanMangaRecommendationsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse Jikan manga recommendations: %w", err)
	}

	out := make([]AniListRecommendation, 0, len(response.Data))
	seen := make(map[int]struct{}, len(response.Data))
	for _, item := range response.Data {
		entry := item.Entry
		title := strings.TrimSpace(entry.Title)
		if entry.MalID <= 0 || title == "" {
			continue
		}
		if _, exists := seen[entry.MalID]; exists {
			continue
		}
		seen[entry.MalID] = struct{}{}

		largeCover := strings.TrimSpace(entry.Images.JPG.LargeImageURL)
		if largeCover == "" {
			largeCover = strings.TrimSpace(entry.Images.WEBP.LargeImageURL)
		}
		mediumCover := strings.TrimSpace(entry.Images.JPG.ImageURL)
		if mediumCover == "" {
			mediumCover = strings.TrimSpace(entry.Images.WEBP.ImageURL)
		}
		if largeCover == "" {
			largeCover = mediumCover
		}
		if mediumCover == "" {
			mediumCover = largeCover
		}

		out = append(out, AniListRecommendation{
			ID:        entry.MalID,
			AniListID: 0,
			MalID:     entry.MalID,
			MediaType: "MANGA",
			Title: AniListRecommendationTitle{
				English: title,
				Romaji:  title,
			},
			CoverImage: AniListRecommendationCoverImage{
				ExtraLarge: largeCover,
				Large:      largeCover,
				Medium:     mediumCover,
			},
			SiteURL: strings.TrimSpace(entry.URL),
		})
	}
	return limitRecommendations(out, preferredRecommendationLimit), nil
}

func applyJikanAnimeEnrichment(base, enrichment *AnimeMetadata) *AnimeMetadata {
	if base == nil {
		return enrichment
	}
	if enrichment == nil {
		return base
	}

	merged := *base
	if len(enrichment.Characters) > 0 {
		merged.Characters = limitAnimeCharacters(enrichment.Characters, preferredCharacterLimit)
	}
	if len(merged.Studios) == 0 && len(enrichment.Studios) > 0 {
		merged.Studios = append([]AniListStudio(nil), enrichment.Studios...)
	}
	if len(merged.Genres) == 0 && len(enrichment.Genres) > 0 {
		merged.Genres = append([]string(nil), enrichment.Genres...)
	}
	if strings.TrimSpace(merged.CoverLarge) == "" {
		merged.CoverLarge = strings.TrimSpace(enrichment.CoverLarge)
	}
	if strings.TrimSpace(merged.CoverMedium) == "" {
		merged.CoverMedium = strings.TrimSpace(enrichment.CoverMedium)
	}
	if strings.TrimSpace(merged.BannerImage) == "" {
		merged.BannerImage = strings.TrimSpace(enrichment.BannerImage)
	}
	if strings.TrimSpace(merged.Source) == "" {
		merged.Source = strings.TrimSpace(enrichment.Source)
	}
	if strings.TrimSpace(merged.Season) == "" {
		merged.Season = strings.TrimSpace(enrichment.Season)
	}
	if merged.SeasonYear <= 0 {
		merged.SeasonYear = enrichment.SeasonYear
	}
	if merged.Year <= 0 {
		merged.Year = enrichment.Year
	}
	if merged.Episodes <= 0 {
		merged.Episodes = enrichment.Episodes
	}
	return &merged
}

func applyJikanMangaEnrichment(base, enrichment *AniListMangaMetadata) *AniListMangaMetadata {
	if base == nil {
		return enrichment
	}
	if enrichment == nil {
		return base
	}

	merged := *base
	if len(enrichment.Characters) > 0 {
		merged.Characters = limitAniListMangaCharacters(enrichment.Characters, preferredCharacterLimit)
	}
	if len(merged.Genres) == 0 && len(enrichment.Genres) > 0 {
		merged.Genres = append([]string(nil), enrichment.Genres...)
	}
	if strings.TrimSpace(merged.CoverLarge) == "" {
		merged.CoverLarge = strings.TrimSpace(enrichment.CoverLarge)
	}
	if strings.TrimSpace(merged.CoverMedium) == "" {
		merged.CoverMedium = strings.TrimSpace(enrichment.CoverMedium)
	}
	if strings.TrimSpace(merged.BannerImage) == "" {
		merged.BannerImage = strings.TrimSpace(enrichment.BannerImage)
	}
	if strings.TrimSpace(merged.Source) == "" {
		merged.Source = strings.TrimSpace(enrichment.Source)
	}
	if merged.Year <= 0 {
		merged.Year = enrichment.Year
	}
	if merged.PublicationYear <= 0 {
		merged.PublicationYear = enrichment.PublicationYear
	}
	if merged.SeasonYear <= 0 {
		merged.SeasonYear = enrichment.SeasonYear
	}
	if merged.Chapters <= 0 {
		merged.Chapters = enrichment.Chapters
	}
	if merged.Volumes <= 0 {
		merged.Volumes = enrichment.Volumes
	}
	return &merged
}

func (m *Manager) GetMangaDetailViaJikan(malID int) (*AniListMangaMetadata, error) {
	if malID <= 0 {
		return nil, fmt.Errorf("invalid MAL id")
	}

	body, err := m.getJSON(fmt.Sprintf("%s/manga/%d/full", jikanEndpoint, malID))
	if err != nil {
		return nil, err
	}

	var fullResponse jikanMangaFullResponse
	if err := json.Unmarshal(body, &fullResponse); err != nil {
		return nil, fmt.Errorf("parse Jikan manga detail: %w", err)
	}

	characters, err := m.GetMangaCharactersViaJikan(malID)
	if err != nil {
		return nil, err
	}

	full := fullResponse.Data
	largeCover := strings.TrimSpace(full.Images.JPG.LargeImageURL)
	if largeCover == "" {
		largeCover = strings.TrimSpace(full.Images.WEBP.LargeImageURL)
	}
	mediumCover := strings.TrimSpace(full.Images.JPG.ImageURL)
	if mediumCover == "" {
		mediumCover = strings.TrimSpace(full.Images.WEBP.ImageURL)
	}
	if largeCover == "" {
		largeCover = mediumCover
	}
	if mediumCover == "" {
		mediumCover = largeCover
	}

	status := jikanMangaStatusToAniList[strings.TrimSpace(full.Status)]
	if status == "" {
		status = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(full.Status), " ", "_"))
	}

	genres := make([]string, 0, len(full.Genres))
	for _, item := range full.Genres {
		name := strings.TrimSpace(item.Name)
		if name != "" {
			genres = append(genres, name)
		}
	}

	year := full.Year
	startDate := parseJikanDate(full.Published.From)
	endDate := parseJikanDate(full.Published.To)
	if year <= 0 {
		year = startDate.Year
	}

	source := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(full.Source), " ", "_"))
	return &AniListMangaMetadata{
		AniListID:       0,
		MalID:           full.MalID,
		Source:          source,
		TitleRomaji:     strings.TrimSpace(full.Title),
		TitleEnglish:    strings.TrimSpace(full.TitleEnglish),
		TitleNative:     strings.TrimSpace(full.TitleJapanese),
		CoverLarge:      largeCover,
		CoverMedium:     mediumCover,
		BannerImage:     largeCover,
		Description:     strings.TrimSpace(full.Synopsis),
		Year:            year,
		PublicationYear: year,
		SeasonYear:      year,
		StartDate:       startDate,
		EndDate:         endDate,
		Status:          status,
		AverageScore:    float64(int(math.Round(full.Score * 10))),
		Chapters:        full.Chapters,
		Volumes:         full.Volumes,
		Genres:          genres,
		Characters:      characters,
	}, nil
}

func (m *Manager) GetMangaCharactersViaJikan(malID int) ([]AniListMangaCharacter, error) {
	body, err := m.getJSON(fmt.Sprintf("%s/manga/%d/characters", jikanEndpoint, malID))
	if err != nil {
		return nil, err
	}

	var response jikanMangaCharactersResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse Jikan manga characters: %w", err)
	}

	out := make([]AniListMangaCharacter, 0, len(response.Data))
	for _, item := range response.Data {
		name := strings.TrimSpace(item.Character.Name)
		if name == "" {
			continue
		}
		image := strings.TrimSpace(item.Character.Images.JPG.ImageURL)
		if image == "" {
			image = strings.TrimSpace(item.Character.Images.WEBP.ImageURL)
		}
		role := strings.ToUpper(strings.TrimSpace(item.Role))
		if role == "" {
			role = "SUPPORTING"
		}
		out = append(out, AniListMangaCharacter{
			ID:         item.Character.MalID,
			Name:       name,
			NameNative: strings.TrimSpace(item.Character.NameKanji),
			Role:       role,
			Image:      image,
		})
	}
	return limitAniListMangaCharacters(out, preferredCharacterLimit), nil
}

func parseJikanDate(value string) AniListDate {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return AniListDate{}
	}

	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return AniListDate{}
	}

	return AniListDate{
		Year:  parsed.Year(),
		Month: int(parsed.Month()),
		Day:   parsed.Day(),
	}
}

func (m *Manager) GetAnimeCatalogHomeViaJikan(season string, year int) (map[string][]map[string]interface{}, error) {
	currentSeason, currentYear := normalizeJikanHomeSeason(season, year)
	nextSeason, nextYear := shiftAniListSeason(currentSeason, currentYear, 1)
	prevSeason, prevYear := shiftAniListSeason(currentSeason, currentYear, -1)

	featured, err := m.fetchJikanHomeShelf(fmt.Sprintf("%s/top/anime?filter=airing&limit=12", jikanEndpoint))
	if err != nil {
		return nil, err
	}
	newlyTrending, err := m.fetchJikanHomeShelf(fmt.Sprintf("%s/seasons/%d/%s?limit=24", jikanEndpoint, currentYear, strings.ToLower(currentSeason)))
	if err != nil {
		return nil, err
	}
	upcoming, err := m.fetchJikanHomeShelf(fmt.Sprintf("%s/seasons/upcoming?limit=24", jikanEndpoint))
	if err != nil {
		return nil, err
	}
	topRated, err := m.fetchJikanHomeShelf(fmt.Sprintf("%s/top/anime?limit=24", jikanEndpoint))
	if err != nil {
		return nil, err
	}
	lastSeason, err := m.fetchJikanHomeShelf(fmt.Sprintf("%s/seasons/%d/%s?limit=24", jikanEndpoint, prevYear, strings.ToLower(prevSeason)))
	if err != nil {
		return nil, err
	}

	shelves := map[string][]map[string]interface{}{
		"featured":        featured,
		"newlyTrending":   newlyTrending,
		"seasonalPopular": newlyTrending,
		"upcoming":        upcoming,
		"topRated":        topRated,
		"lastSeason":      lastSeason,
	}

	for key, genre := range map[string]string{
		"action":       "Action",
		"adventure":    "Adventure",
		"comedy":       "Comedy",
		"fantasy":      "Fantasy",
		"mystery":      "Mystery",
		"romance":      "Romance",
		"sports":       "Sports",
		"scifi":        "Sci-Fi",
		"drama":        "Drama",
		"slice":        "Slice of Life",
		"supernatural": "Supernatural",
	} {
		shelf, shelfErr := m.fetchJikanGenreShelf(genre)
		if shelfErr != nil {
			return nil, shelfErr
		}
		shelves[key] = shelf
	}

	_ = nextSeason
	_ = nextYear
	return shelves, nil
}

func (m *Manager) fetchJikanGenreShelf(genre string) ([]map[string]interface{}, error) {
	genreID := jikanGenreIDs[genre]
	if genreID <= 0 {
		return []map[string]interface{}{}, nil
	}
	return m.fetchJikanHomeShelf(fmt.Sprintf("%s/anime?genres=%d&order_by=popularity&sort=desc&limit=24", jikanEndpoint, genreID))
}

func (m *Manager) fetchJikanHomeShelf(endpoint string) ([]map[string]interface{}, error) {
	body, err := m.getJSON(endpoint)
	if err != nil {
		return nil, err
	}

	var response jikanAnimeSearchResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse Jikan home shelf: %w", err)
	}

	out := make([]map[string]interface{}, 0, len(response.Data))
	for _, item := range response.Data {
		out = append(out, mapJikanAnimeSearchResultToReadModel(item))
	}
	return out, nil
}

func normalizeJikanHomeSeason(season string, year int) (string, int) {
	trimmedSeason := strings.ToUpper(strings.TrimSpace(season))
	if year > 0 && trimmedSeason != "" {
		return trimmedSeason, year
	}

	now := time.Now()
	resolvedSeason := trimmedSeason
	if resolvedSeason == "" {
		switch month := now.Month(); {
		case month >= 1 && month <= 3:
			resolvedSeason = "WINTER"
		case month >= 4 && month <= 6:
			resolvedSeason = "SPRING"
		case month >= 7 && month <= 9:
			resolvedSeason = "SUMMER"
		default:
			resolvedSeason = "FALL"
		}
	}
	if year <= 0 {
		year = now.Year()
	}
	return resolvedSeason, year
}

func (m *Manager) fetchJikanPage(reqURL string) ([]JikanAnimeEntry, bool, error) {
	resp, err := httpSession.Get(reqURL)
	if err != nil {
		return nil, false, fmt.Errorf("request failed: %w", err)
	}

	if resp.StatusCode == 404 {
		return nil, false, fmt.Errorf("usuario no encontrado")
	}
	if resp.StatusCode == 429 {
		time.Sleep(2 * time.Second)
		return m.fetchJikanPage(reqURL)
	}
	if resp.StatusCode != 200 {
		return nil, false, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body := resp.Body

	var result jikanUserListResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, false, fmt.Errorf("parse JSON: %w", err)
	}

	entries := make([]JikanAnimeEntry, 0, len(result.Data))
	for _, d := range result.Data {
		status := malStatusToInternal[d.Status]
		if status == "" {
			status = "PLANNING"
		}

		imageURL := d.Entry.Images.JPG.LargeImageURL
		if imageURL == "" {
			imageURL = d.Entry.Images.JPG.ImageURL
		}

		entries = append(entries, JikanAnimeEntry{
			MalID:           d.Entry.MalID,
			Title:           d.Entry.Title,
			ImageURL:        imageURL,
			Status:          status,
			EpisodesWatched: d.EpisodesWatched,
			EpisodesTotal:   d.Entry.Episodes,
			Score:           float64(d.Score),
			AiringStatus:    d.Entry.Status,
			Year:            d.Entry.Year,
		})
	}

	return entries, result.Pagination.HasNextPage, nil
}

// ResolveMALToAniList finds the AniList ID for a given MAL ID using AniList GraphQL.
func (m *Manager) ResolveMALToAniList(malID int) (int, string, error) {
	gql := `
	query ($malId: Int) {
		Media(idMal: $malId, type: ANIME) {
			id
			title { english }
		}
	}`

	vars := map[string]interface{}{"malId": malID}
	raw, err := m.postJSON(anilistEndpoint, map[string]interface{}{
		"query": gql, "variables": vars,
	})
	if err != nil {
		return 0, "", err
	}

	var parsed struct {
		Data struct {
			Media struct {
				ID    int `json:"id"`
				Title struct {
					English string `json:"english"`
				} `json:"title"`
			} `json:"Media"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return 0, "", err
	}
	if parsed.Data.Media.ID == 0 {
		return 0, "", fmt.Errorf("no AniList match for MAL ID %d", malID)
	}

	return parsed.Data.Media.ID, parsed.Data.Media.Title.English, nil
}
