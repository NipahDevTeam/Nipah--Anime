package metadata

import (
	"encoding/json"
	"fmt"
	"strings"
)

// AniListMangaMetadata is the canonical AniList manga payload used by online manga flows.
type AniListMangaMetadata struct {
	AniListID       int      `json:"anilist_id"`
	MalID           int      `json:"mal_id"`
	Format          string   `json:"format"`
	CountryOfOrigin string   `json:"country_of_origin"`
	TitleRomaji     string   `json:"title_romaji"`
	TitleEnglish    string   `json:"title_english"`
	TitleNative     string   `json:"title_native"`
	CoverLarge      string   `json:"cover_large"`
	CoverMedium     string   `json:"cover_medium"`
	BannerImage     string   `json:"banner_image"`
	Description     string   `json:"description"`
	Year            int      `json:"year"`
	Status          string   `json:"status"`
	Chapters        int      `json:"chapters"`
	Volumes         int      `json:"volumes"`
	Genres          []string `json:"genres"`
	Synonyms        []string `json:"synonyms"`
}

type aniListMangaNode struct {
	ID              int    `json:"id"`
	IDMal           int    `json:"idMal"`
	Format          string `json:"format"`
	CountryOfOrigin string `json:"countryOfOrigin"`
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
	BannerImage string `json:"bannerImage"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Chapters    int    `json:"chapters"`
	Volumes     int    `json:"volumes"`
	Genres      []string `json:"genres"`
	StartDate   struct {
		Year int `json:"year"`
	} `json:"startDate"`
}

func mapAniListMangaMetadataSlice(items []aniListMangaNode) []AniListMangaMetadata {
	out := make([]AniListMangaMetadata, 0, len(items))
	for _, media := range items {
		out = append(out, AniListMangaMetadata{
			AniListID:       media.ID,
			MalID:           media.IDMal,
			Format:          media.Format,
			CountryOfOrigin: media.CountryOfOrigin,
			TitleRomaji:     media.Title.Romaji,
			TitleEnglish:    media.Title.English,
			TitleNative:     media.Title.Native,
			CoverLarge:      media.CoverImage.Large,
			CoverMedium:     media.CoverImage.Medium,
			BannerImage:     media.BannerImage,
			Description:     media.Description,
			Status:          media.Status,
			Chapters:        media.Chapters,
			Volumes:         media.Volumes,
			Genres:          media.Genres,
			Year:            media.StartDate.Year,
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
					BannerImage string `json:"bannerImage"`
					Description string `json:"description"`
					Status      string `json:"status"`
					Chapters    int    `json:"chapters"`
					Volumes     int    `json:"volumes"`
					Genres      []string `json:"genres"`
					StartDate   struct {
						Year int `json:"year"`
					} `json:"startDate"`
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
			TitleRomaji:     media.Title.Romaji,
			TitleEnglish:    media.Title.English,
			TitleNative:     media.Title.Native,
			CoverLarge:      media.CoverImage.Large,
			CoverMedium:     media.CoverImage.Medium,
			BannerImage:     media.BannerImage,
			Description:     media.Description,
			Year:            media.StartDate.Year,
			Status:          media.Status,
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
				BannerImage string `json:"bannerImage"`
				Description string `json:"description"`
				Status      string `json:"status"`
				Chapters    int    `json:"chapters"`
				Volumes     int    `json:"volumes"`
				Genres      []string `json:"genres"`
				StartDate   struct {
					Year int `json:"year"`
				} `json:"startDate"`
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
	return &AniListMangaMetadata{
		AniListID:       media.ID,
		MalID:           media.IDMal,
		Format:          media.Format,
		CountryOfOrigin: media.CountryOfOrigin,
		TitleRomaji:     media.Title.Romaji,
		TitleEnglish:    media.Title.English,
		TitleNative:     media.Title.Native,
		CoverLarge:      media.CoverImage.Large,
		CoverMedium:     media.CoverImage.Medium,
		BannerImage:     media.BannerImage,
		Description:     media.Description,
		Year:            media.StartDate.Year,
		Status:          media.Status,
		Chapters:        media.Chapters,
		Volumes:         media.Volumes,
		Genres:          media.Genres,
		Synonyms:        media.Synonyms,
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
		"perPage": 24,
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
		varDecls = append(varDecls, "$startDate_like: FuzzyDateInt")
		filterArgs = append(filterArgs, "startDate_like: $startDate_like")
		vars["startDate_like"] = year * 10000
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

func (m *Manager) DiscoverManga(genre string, year int, sort string, page int) (interface{}, error) {
	if page < 1 {
		page = 1
	}

	vars := map[string]interface{}{
		"page":    page,
		"perPage": 24,
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
		varDecls = append(varDecls, "$startDate_like: FuzzyDateInt")
		filterArgs = append(filterArgs, "startDate_like: $startDate_like")
		vars["startDate_like"] = year * 10000
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
			pageInfo { total currentPage lastPage hasNextPage }
			media(%s) {
				id
				idMal
				format
				countryOfOrigin
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
				genres
				startDate { year month }
			}
		}
	}`, strings.Join(varDecls, ", "), strings.Join(filterArgs, ", "))

	body, err := m.postJSON(anilistEndpoint, map[string]interface{}{
		"query":     gql,
		"variables": vars,
	})
	if err != nil {
		return nil, err
	}
	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}
