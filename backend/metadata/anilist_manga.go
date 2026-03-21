package metadata

import (
	"encoding/json"
	"fmt"
)

// AniListMangaMetadata is the canonical AniList manga payload used by online manga flows.
type AniListMangaMetadata struct {
	AniListID    int      `json:"anilist_id"`
	MalID        int      `json:"mal_id"`
	TitleRomaji  string   `json:"title_romaji"`
	TitleEnglish string   `json:"title_english"`
	TitleNative  string   `json:"title_native"`
	CoverLarge   string   `json:"cover_large"`
	CoverMedium  string   `json:"cover_medium"`
	BannerImage  string   `json:"banner_image"`
	Description  string   `json:"description"`
	Year         int      `json:"year"`
	Status       string   `json:"status"`
	Chapters     int      `json:"chapters"`
	Volumes      int      `json:"volumes"`
	Synonyms     []string `json:"synonyms"`
}

func (m *Manager) SearchAniListMangaEntries(query string) ([]AniListMangaMetadata, error) {
	gql := `
	query ($search: String) {
		Page(page: 1, perPage: 8) {
			media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
				id
				idMal
				title { romaji english native }
				synonyms
				coverImage { large medium }
				bannerImage
				description(asHtml: false)
				status
				chapters
				volumes
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
					BannerImage string `json:"bannerImage"`
					Description string `json:"description"`
					Status      string `json:"status"`
					Chapters    int    `json:"chapters"`
					Volumes     int    `json:"volumes"`
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
			AniListID:    media.ID,
			MalID:        media.IDMal,
			TitleRomaji:  media.Title.Romaji,
			TitleEnglish: media.Title.English,
			TitleNative:  media.Title.Native,
			CoverLarge:   media.CoverImage.Large,
			CoverMedium:  media.CoverImage.Medium,
			BannerImage:  media.BannerImage,
			Description:  media.Description,
			Year:         media.StartDate.Year,
			Status:       media.Status,
			Chapters:     media.Chapters,
			Volumes:      media.Volumes,
			Synonyms:     media.Synonyms,
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
			title { romaji english native }
			synonyms
			coverImage { large medium }
			bannerImage
			description(asHtml: false)
			status
			chapters
			volumes
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
				BannerImage string `json:"bannerImage"`
				Description string `json:"description"`
				Status      string `json:"status"`
				Chapters    int    `json:"chapters"`
				Volumes     int    `json:"volumes"`
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
		AniListID:    media.ID,
		MalID:        media.IDMal,
		TitleRomaji:  media.Title.Romaji,
		TitleEnglish: media.Title.English,
		TitleNative:  media.Title.Native,
		CoverLarge:   media.CoverImage.Large,
		CoverMedium:  media.CoverImage.Medium,
		BannerImage:  media.BannerImage,
		Description:  media.Description,
		Year:         media.StartDate.Year,
		Status:       media.Status,
		Chapters:     media.Chapters,
		Volumes:      media.Volumes,
		Synonyms:     media.Synonyms,
	}, nil
}
