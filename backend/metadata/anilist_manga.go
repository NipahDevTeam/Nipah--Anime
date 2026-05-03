package metadata

import (
	"encoding/json"
	"fmt"
	"strings"
)

// AniListMangaMetadata is the canonical AniList manga payload used by online manga flows.
type AniListMangaMetadata struct {
	AniListID       int                     `json:"anilist_id"`
	MalID           int                     `json:"mal_id"`
	Format          string                  `json:"format"`
	CountryOfOrigin string                  `json:"country_of_origin"`
	Source          string                  `json:"source"`
	TitleRomaji     string                  `json:"title_romaji"`
	TitleEnglish    string                  `json:"title_english"`
	TitleNative     string                  `json:"title_native"`
	CoverLarge      string                  `json:"cover_large"`
	CoverMedium     string                  `json:"cover_medium"`
	BannerImage     string                  `json:"banner_image"`
	Description     string                  `json:"description"`
	Year            int                     `json:"year"`
	PublicationYear int                     `json:"publication_year"`
	SeasonYear      int                     `json:"season_year"`
	StartDate       AniListDate             `json:"start_date"`
	EndDate         AniListDate             `json:"end_date"`
	Status          string                  `json:"status"`
	AverageScore    float64                 `json:"average_score"`
	Chapters        int                     `json:"chapters"`
	Volumes         int                     `json:"volumes"`
	Genres          []string                `json:"genres"`
	Synonyms        []string                `json:"synonyms"`
	Characters      []AniListMangaCharacter `json:"characters,omitempty"`
}

type AniListMangaCharacter struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	NameNative string `json:"name_native"`
	Role       string `json:"role"`
	Image      string `json:"image"`
}

type aniListMangaNode struct {
	ID              int    `json:"id"`
	IDMal           int    `json:"idMal"`
	Format          string `json:"format"`
	CountryOfOrigin string `json:"countryOfOrigin"`
	Source          string `json:"source"`
	Title           struct {
		Romaji  string `json:"romaji"`
		English string `json:"english"`
		Native  string `json:"native"`
	} `json:"title"`
	Synonyms   []string `json:"synonyms"`
	CoverImage struct {
		Large  string `json:"large"`
		Medium string `json:"medium"`
	} `json:"coverImage"`
	BannerImage  string      `json:"bannerImage"`
	Description  string      `json:"description"`
	Status       string      `json:"status"`
	AverageScore float64     `json:"averageScore"`
	Popularity   int         `json:"popularity"`
	Trending     int         `json:"trending"`
	Favourites   int         `json:"favourites"`
	Chapters     int         `json:"chapters"`
	Volumes      int         `json:"volumes"`
	Genres       []string    `json:"genres"`
	StartDate    AniListDate `json:"startDate"`
	EndDate      AniListDate `json:"endDate"`
}

func mapAniListMangaMetadataSlice(items []aniListMangaNode) []AniListMangaMetadata {
	out := make([]AniListMangaMetadata, 0, len(items))
	for _, media := range items {
		out = append(out, AniListMangaMetadata{
			AniListID:       media.ID,
			MalID:           media.IDMal,
			Format:          media.Format,
			CountryOfOrigin: media.CountryOfOrigin,
			Source:          media.Source,
			TitleRomaji:     media.Title.Romaji,
			TitleEnglish:    media.Title.English,
			TitleNative:     media.Title.Native,
			CoverLarge:      media.CoverImage.Large,
			CoverMedium:     media.CoverImage.Medium,
			BannerImage:     media.BannerImage,
			Description:     media.Description,
			Status:          media.Status,
			AverageScore:    media.AverageScore,
			Chapters:        media.Chapters,
			Volumes:         media.Volumes,
			Genres:          media.Genres,
			Year:            media.StartDate.Year,
			PublicationYear: media.StartDate.Year,
			SeasonYear:      media.StartDate.Year,
			StartDate:       media.StartDate,
			EndDate:         media.EndDate,
			Synonyms:        media.Synonyms,
		})
	}
	return out
}

func (m *Manager) SearchAniListMangaEntries(query string) ([]AniListMangaMetadata, error) {
	gql := `
	query ($search: String) {
		Page(page: 1, perPage: 8) {
			media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
				id
				idMal
				format
				countryOfOrigin
				source
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				status
				averageScore
				chapters
				volumes
				genres
				startDate { year month day }
				endDate { year month day }
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

	var resp struct {
		Data struct {
			Page struct {
				Media []struct {
					ID              int    `json:"id"`
					IDMal           int    `json:"idMal"`
					Format          string `json:"format"`
					CountryOfOrigin string `json:"countryOfOrigin"`
					Source          string `json:"source"`
					Title           struct {
						Romaji  string `json:"romaji"`
						English string `json:"english"`
						Native  string `json:"native"`
					} `json:"title"`
					Synonyms   []string `json:"synonyms"`
					CoverImage struct {
						Large  string `json:"large"`
						Medium string `json:"medium"`
					} `json:"coverImage"`
					BannerImage  string      `json:"bannerImage"`
					Description  string      `json:"description"`
					Status       string      `json:"status"`
					AverageScore float64     `json:"averageScore"`
					Chapters     int         `json:"chapters"`
					Volumes      int         `json:"volumes"`
					Genres       []string    `json:"genres"`
					StartDate    AniListDate `json:"startDate"`
					EndDate      AniListDate `json:"endDate"`
				} `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}

	out := make([]AniListMangaMetadata, 0, len(resp.Data.Page.Media))
	for _, media := range resp.Data.Page.Media {
		out = append(out, AniListMangaMetadata{
			AniListID:       media.ID,
			MalID:           media.IDMal,
			Format:          media.Format,
			CountryOfOrigin: media.CountryOfOrigin,
			Source:          media.Source,
			TitleRomaji:     media.Title.Romaji,
			TitleEnglish:    media.Title.English,
			TitleNative:     media.Title.Native,
			CoverLarge:      media.CoverImage.Large,
			CoverMedium:     media.CoverImage.Medium,
			BannerImage:     media.BannerImage,
			Description:     media.Description,
			Year:            media.StartDate.Year,
			PublicationYear: media.StartDate.Year,
			SeasonYear:      media.StartDate.Year,
			StartDate:       media.StartDate,
			EndDate:         media.EndDate,
			Status:          media.Status,
			AverageScore:    media.AverageScore,
			Chapters:        media.Chapters,
			Volumes:         media.Volumes,
			Genres:          media.Genres,
			Synonyms:        media.Synonyms,
		})
	}
	return out, nil
}

func (m *Manager) GetAniListMangaByID(id int) (*AniListMangaMetadata, error) {
	gql := `
	query ($id: Int) {
		Media(id: $id, type: MANGA) {
			id
			idMal
			format
			countryOfOrigin
			source
			title { romaji english native }
			synonyms
			coverImage { large medium }
			bannerImage
			description(asHtml: false)
			status
			averageScore
			chapters
			volumes
			genres
			startDate { year month day }
			endDate { year month day }
			characters(perPage: 12, sort: [ROLE, RELEVANCE]) {
				edges {
					role
					node {
						id
						name { full native }
						image { large }
					}
				}
			}
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
			Media *struct {
				ID              int    `json:"id"`
				IDMal           int    `json:"idMal"`
				Format          string `json:"format"`
				CountryOfOrigin string `json:"countryOfOrigin"`
				Source          string `json:"source"`
				Title           struct {
					Romaji  string `json:"romaji"`
					English string `json:"english"`
					Native  string `json:"native"`
				} `json:"title"`
				Synonyms   []string `json:"synonyms"`
				CoverImage struct {
					Large  string `json:"large"`
					Medium string `json:"medium"`
				} `json:"coverImage"`
				BannerImage  string      `json:"bannerImage"`
				Description  string      `json:"description"`
				Status       string      `json:"status"`
				AverageScore float64     `json:"averageScore"`
				Chapters     int         `json:"chapters"`
				Volumes      int         `json:"volumes"`
				Genres       []string    `json:"genres"`
				StartDate    AniListDate `json:"startDate"`
				EndDate      AniListDate `json:"endDate"`
				Characters   struct {
					Edges []struct {
						Role string `json:"role"`
						Node struct {
							ID   int `json:"id"`
							Name struct {
								Full   string `json:"full"`
								Native string `json:"native"`
							} `json:"name"`
							Image struct {
								Large string `json:"large"`
							} `json:"image"`
						} `json:"node"`
					} `json:"edges"`
				} `json:"characters"`
			} `json:"Media"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	if resp.Data.Media == nil {
		return nil, fmt.Errorf("manga %d not found", id)
	}

	media := resp.Data.Media
	characters := make([]AniListMangaCharacter, 0, len(media.Characters.Edges))
	for _, edge := range media.Characters.Edges {
		name := strings.TrimSpace(edge.Node.Name.Full)
		if name == "" {
			continue
		}
		characters = append(characters, AniListMangaCharacter{
			ID:         edge.Node.ID,
			Name:       name,
			NameNative: strings.TrimSpace(edge.Node.Name.Native),
			Role:       strings.TrimSpace(edge.Role),
			Image:      strings.TrimSpace(edge.Node.Image.Large),
		})
	}
	return &AniListMangaMetadata{
		AniListID:       media.ID,
		MalID:           media.IDMal,
		Format:          media.Format,
		CountryOfOrigin: media.CountryOfOrigin,
		Source:          media.Source,
		TitleRomaji:     media.Title.Romaji,
		TitleEnglish:    media.Title.English,
		TitleNative:     media.Title.Native,
		CoverLarge:      media.CoverImage.Large,
		CoverMedium:     media.CoverImage.Medium,
		BannerImage:     media.BannerImage,
		Description:     media.Description,
		Year:            media.StartDate.Year,
		PublicationYear: media.StartDate.Year,
		SeasonYear:      media.StartDate.Year,
		StartDate:       media.StartDate,
		EndDate:         media.EndDate,
		Status:          media.Status,
		AverageScore:    media.AverageScore,
		Chapters:        media.Chapters,
		Volumes:         media.Volumes,
		Genres:          media.Genres,
		Synonyms:        media.Synonyms,
		Characters:      characters,
	}, nil
}

func (m *Manager) GetAniListMangaOriginsByIDs(ids []int) (map[int]string, error) {
	if len(ids) == 0 {
		return map[int]string{}, nil
	}

	gql := `
	query ($ids: [Int]) {
		Page(page: 1, perPage: 50) {
			media(id_in: $ids, type: MANGA) {
				id
				countryOfOrigin
			}
		}
	}`

	payload := map[string]interface{}{
		"query":     gql,
		"variables": map[string]interface{}{"ids": ids},
	}

	body, err := m.postJSON(anilistEndpoint, payload)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data struct {
			Page struct {
				Media []struct {
					ID              int    `json:"id"`
					CountryOfOrigin string `json:"countryOfOrigin"`
				} `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}

	out := make(map[int]string, len(resp.Data.Page.Media))
	for _, media := range resp.Data.Page.Media {
		out[media.ID] = media.CountryOfOrigin
	}
	return out, nil
}

func (m *Manager) GetAniListMangaCatalogHome() (map[string][]AniListMangaMetadata, error) {
	gql := `
	query {
		featured: Page(page: 1, perPage: 6) {
			media(type: MANGA, sort: TRENDING_DESC, isAdult: false) {
				id
				idMal
				format
				countryOfOrigin
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				status
				chapters
				volumes
				genres
				startDate { year }
			}
		}
		trending: Page(page: 1, perPage: 12) {
			media(type: MANGA, sort: TRENDING_DESC, isAdult: false) {
				id
				idMal
				format
				countryOfOrigin
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				status
				chapters
				volumes
				genres
				startDate { year }
			}
		}
		popular: Page(page: 1, perPage: 12) {
			media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) {
				id
				idMal
				format
				countryOfOrigin
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				status
				chapters
				volumes
				genres
				startDate { year }
			}
		}
		recent: Page(page: 1, perPage: 12) {
			media(type: MANGA, sort: START_DATE_DESC, isAdult: false) {
				id
				idMal
				format
				countryOfOrigin
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				status
				chapters
				volumes
				genres
				startDate { year }
			}
		}
	}`

	body, err := m.postJSON(anilistEndpoint, map[string]interface{}{"query": gql})
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data struct {
			Featured struct {
				Media []aniListMangaNode `json:"media"`
			} `json:"featured"`
			Trending struct {
				Media []aniListMangaNode `json:"media"`
			} `json:"trending"`
			Popular struct {
				Media []aniListMangaNode `json:"media"`
			} `json:"popular"`
			Recent struct {
				Media []aniListMangaNode `json:"media"`
			} `json:"recent"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}

	return map[string][]AniListMangaMetadata{
		"featured": mapAniListMangaMetadataSlice(resp.Data.Featured.Media),
		"trending": mapAniListMangaMetadataSlice(resp.Data.Trending.Media),
		"popular":  mapAniListMangaMetadataSlice(resp.Data.Popular.Media),
		"recent":   mapAniListMangaMetadataSlice(resp.Data.Recent.Media),
	}, nil
}

func (m *Manager) DiscoverMangaEntries(genre string, year int, sort string, page int) ([]AniListMangaMetadata, bool, error) {
	if page < 1 {
		page = 1
	}

	vars := map[string]interface{}{
		"page":    page,
		"perPage": 48,
		"type":    "MANGA",
	}

	varDecls := []string{"$page: Int", "$perPage: Int", "$type: MediaType"}
	filterArgs := []string{"type: $type", "isAdult: false"}

	if genre != "" {
		genres := strings.Split(genre, ",")
		for i := range genres {
			genres[i] = strings.TrimSpace(genres[i])
		}
		varDecls = append(varDecls, "$genre_in: [String]")
		filterArgs = append(filterArgs, "genre_in: $genre_in")
		vars["genre_in"] = genres
	}
	if year > 0 {
		varDecls = append(varDecls, "$startDate_greater: FuzzyDateInt", "$startDate_lesser: FuzzyDateInt")
		filterArgs = append(filterArgs, "startDate_greater: $startDate_greater", "startDate_lesser: $startDate_lesser")
		vars["startDate_greater"] = year * 10000
		vars["startDate_lesser"] = (year + 1) * 10000
	}

	sortVal := "TRENDING_DESC"
	switch sort {
	case "POPULARITY_DESC", "SCORE_DESC", "FAVOURITES_DESC", "START_DATE_DESC", "TRENDING_DESC":
		sortVal = sort
	}
	filterArgs = append(filterArgs, "sort: "+sortVal)

	gql := fmt.Sprintf(`
	query (%s) {
		Page(page: $page, perPage: $perPage) {
			pageInfo { hasNextPage }
			media(%s) {
				id
				idMal
				format
				countryOfOrigin
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				status
				chapters
				volumes
				genres
				startDate { year }
			}
		}
	}`, strings.Join(varDecls, ", "), strings.Join(filterArgs, ", "))

	body, err := m.postJSON(anilistEndpoint, map[string]interface{}{
		"query":     gql,
		"variables": vars,
	})
	if err != nil {
		return nil, false, err
	}

	var resp struct {
		Data struct {
			Page struct {
				PageInfo struct {
					HasNextPage bool `json:"hasNextPage"`
				} `json:"pageInfo"`
				Media []aniListMangaNode `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, false, err
	}

	return mapAniListMangaMetadataSlice(resp.Data.Page.Media), resp.Data.Page.PageInfo.HasNextPage, nil
}

func (m *Manager) DiscoverManga(genre string, year int, sort, status, format string, page int) (interface{}, error) {
	safePage := normalizeCatalogPage(page)
	requests := buildMangaCatalogFetchRequests(genre, year, sort, status, format, safePage)
	if len(requests) == 1 {
		return m.fetchMangaCatalogEnvelope(requests[0])
	}

	items := make([]aniListMangaNode, 0, len(requests)*aniListCatalogPerPage)
	seen := make(map[int]struct{}, len(requests)*aniListCatalogPerPage)
	hasMore := false

	for _, request := range requests {
		payload, err := m.fetchMangaCatalogEnvelope(request)
		if err != nil {
			return nil, err
		}
		if request.Page == safePage && payload.Data.Page.PageInfo.HasNextPage {
			hasMore = true
		}
		for _, media := range payload.Data.Page.Media {
			if media.ID <= 0 {
				continue
			}
			if _, ok := seen[media.ID]; ok {
				continue
			}
			seen[media.ID] = struct{}{}
			items = append(items, media)
		}
	}

	sortMangaCatalogItems(items, sort)
	return paginateMangaCatalogUnion(items, safePage, hasMore), nil
}

func (m *Manager) fetchMangaCatalogEnvelope(request catalogFetchRequest) (*aniListMangaCatalogEnvelope, error) {
	body, err := m.postJSON(anilistEndpoint, buildMangaCatalogPayload(request))
	if err != nil {
		return nil, err
	}

	var result aniListMangaCatalogEnvelope
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func buildMangaCatalogPayload(request catalogFetchRequest) map[string]interface{} {
	variables := map[string]interface{}{
		"page":    normalizeCatalogPage(request.Page),
		"perPage": aniListCatalogPerPage,
		"sort":    []string{normalizeAniListCatalogSort(request.Sort)},
	}
	if value := strings.TrimSpace(request.Genre); value != "" {
		variables["genre"] = value
	}
	if request.Year > 0 {
		variables["startDateGreater"] = request.Year * 10000
		variables["startDateLesser"] = (request.Year + 1) * 10000
	}
	if value := strings.TrimSpace(request.Status); value != "" {
		variables["status"] = value
	}
	if value := strings.TrimSpace(request.Format); value != "" {
		variables["format"] = value
	}

	return map[string]interface{}{
		"query": `
	query ($page: Int, $perPage: Int, $genre: String, $startDateGreater: FuzzyDateInt, $startDateLesser: FuzzyDateInt, $status: MediaStatus, $format: MediaFormat, $sort: [MediaSort]) {
		Page(page: $page, perPage: $perPage) {
			pageInfo { total currentPage lastPage hasNextPage }
			media(type: MANGA, isAdult: false, genre: $genre, startDate_greater: $startDateGreater, startDate_lesser: $startDateLesser, status: $status, format: $format, sort: $sort) {
				id
				idMal
				format
				countryOfOrigin
				source
				title { romaji english native }
				synonyms
				coverImage { large medium extraLarge }
				bannerImage
				description(asHtml: false)
				status
				chapters
				volumes
				averageScore
				popularity
				trending
				favourites
				genres
				startDate { year month day }
				endDate { year month day }
			}
		}
	}`,
		"variables": variables,
	}
}
