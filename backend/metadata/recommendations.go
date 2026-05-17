package metadata

import "strings"

type AniListRecommendationTitle struct {
	Romaji  string `json:"romaji,omitempty"`
	English string `json:"english,omitempty"`
	Native  string `json:"native,omitempty"`
}

type AniListRecommendationCoverImage struct {
	ExtraLarge string `json:"extraLarge,omitempty"`
	Large      string `json:"large,omitempty"`
	Medium     string `json:"medium,omitempty"`
}

type AniListRecommendation struct {
	ID          int                             `json:"id"`
	AniListID   int                             `json:"anilist_id"`
	MalID       int                             `json:"mal_id,omitempty"`
	Rating      int                             `json:"rating,omitempty"`
	MediaType   string                          `json:"media_type,omitempty"`
	Format      string                          `json:"format,omitempty"`
	Status      string                          `json:"status,omitempty"`
	Title       AniListRecommendationTitle      `json:"title"`
	CoverImage  AniListRecommendationCoverImage `json:"coverImage"`
	BannerImage string                          `json:"bannerImage,omitempty"`
	Genres      []string                        `json:"genres,omitempty"`
	SiteURL     string                          `json:"siteUrl,omitempty"`
}

type aniListRecommendationTitleNode struct {
	Romaji  string `json:"romaji"`
	English string `json:"english"`
	Native  string `json:"native"`
}

type aniListRecommendationCoverImageNode struct {
	ExtraLarge string `json:"extraLarge"`
	Large      string `json:"large"`
	Medium     string `json:"medium"`
}

type aniListRecommendationNode struct {
	ID                  int                        `json:"id"`
	Rating              int                        `json:"rating"`
	UserRating          string                     `json:"userRating"`
	MediaRecommendation aniListRecommendationMedia `json:"mediaRecommendation"`
}

type aniListRecommendationMedia struct {
	ID          int                                 `json:"id"`
	IDMal       int                                 `json:"idMal"`
	Type        string                              `json:"type"`
	Format      string                              `json:"format"`
	Status      string                              `json:"status"`
	Title       aniListRecommendationTitleNode      `json:"title"`
	CoverImage  aniListRecommendationCoverImageNode `json:"coverImage"`
	BannerImage string                              `json:"bannerImage"`
	Genres      []string                            `json:"genres"`
	SiteURL     string                              `json:"siteUrl"`
}

type aniListRecommendationEdge struct {
	Node   aniListRecommendationNode `json:"node"`
}

func mapAniListRecommendations(edges []aniListRecommendationEdge) []AniListRecommendation {
	if len(edges) == 0 {
		return nil
	}

	out := make([]AniListRecommendation, 0, len(edges))
	seen := make(map[int]struct{}, len(edges))
	for _, edge := range edges {
		media := edge.Node.MediaRecommendation
		title := AniListRecommendationTitle{
			Romaji:  strings.TrimSpace(media.Title.Romaji),
			English: strings.TrimSpace(media.Title.English),
			Native:  strings.TrimSpace(media.Title.Native),
		}
		if title.English == "" && title.Romaji == "" && title.Native == "" {
			continue
		}
		if media.ID > 0 {
			if _, exists := seen[media.ID]; exists {
				continue
			}
			seen[media.ID] = struct{}{}
		}
		out = append(out, AniListRecommendation{
			ID:        media.ID,
			AniListID: media.ID,
			MalID:     media.IDMal,
			Rating:    edge.Node.Rating,
			MediaType: strings.TrimSpace(media.Type),
			Format:    strings.TrimSpace(media.Format),
			Status:    strings.TrimSpace(media.Status),
			Title:     title,
			CoverImage: AniListRecommendationCoverImage{
				ExtraLarge: strings.TrimSpace(media.CoverImage.ExtraLarge),
				Large:      strings.TrimSpace(media.CoverImage.Large),
				Medium:     strings.TrimSpace(media.CoverImage.Medium),
			},
			BannerImage: strings.TrimSpace(media.BannerImage),
			Genres:      media.Genres,
			SiteURL:     strings.TrimSpace(media.SiteURL),
		})
	}
	return out
}

func aniListRecommendationSelection() string {
	return `
			recommendations(perPage: 8, sort: [RATING_DESC, ID_DESC]) {
				edges {
					node {
						id
						rating
						userRating
						mediaRecommendation {
							id
							idMal
							type
							format
							status
							title { romaji english native }
							coverImage { extraLarge large medium }
							bannerImage
							genres
							siteUrl
						}
					}
				}
			}`
}

func aniListAnimeDetailQuery() string {
	return `
	query ($id: Int) {
		Media(id: $id, type: ANIME) {
			id
			idMal
			format
			season
			seasonYear
			countryOfOrigin
			source
			title { romaji english native }
			synonyms
			coverImage { large medium }
			bannerImage
			description(asHtml: false)
			averageScore
			episodes
			status
			startDate { year month day }
			endDate { year month day }
			nextAiringEpisode { episode airingAt }
			genres
			streamingEpisodes { title thumbnail url site }
			studios(isMain: true) {
				nodes { name }
			}
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
` + aniListRecommendationSelection() + `
		}
	}`
}

func aniListAnimeEnrichmentQuery() string {
	return `
	query ($id: Int) {
		Media(id: $id, type: ANIME) {
			id
			idMal
			format
			season
			seasonYear
			countryOfOrigin
			source
			title { romaji english native }
			synonyms
			coverImage { large medium }
			bannerImage
			description(asHtml: false)
			averageScore
			episodes
			status
			startDate { year month day }
			endDate { year month day }
			nextAiringEpisode { episode airingAt }
			genres
			streamingEpisodes { title thumbnail url site }
		}
	}`
}

func aniListMangaDetailQuery() string {
	return `
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
` + aniListRecommendationSelection() + `
		}
	}`
}

func aniListMangaEnrichmentQuery() string {
	return `
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
		}
	}`
}
