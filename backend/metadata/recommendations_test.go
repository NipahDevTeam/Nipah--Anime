package metadata

import (
	"strings"
	"testing"
)

func TestAniListAnimeDetailQueryIncludesRecommendationsAgain(t *testing.T) {
	query := aniListAnimeDetailQuery()

	for _, expected := range []string{
		"characters(perPage: 5, sort: [ROLE, RELEVANCE])",
		"streamingEpisodes",
		"studios(isMain: true)",
		"recommendations(perPage: 8, sort: [RATING_DESC, ID_DESC])",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected anime detail query to contain %q, got %q", expected, query)
		}
	}
}

func TestAniListMangaDetailQueryIncludesRecommendationsAgain(t *testing.T) {
	query := aniListMangaDetailQuery()

	for _, expected := range []string{
		"characters(perPage: 5, sort: [ROLE, RELEVANCE])",
		"description(asHtml: false)",
		"genres",
		"recommendations(perPage: 8, sort: [RATING_DESC, ID_DESC])",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected manga detail query to contain %q, got %q", expected, query)
		}
	}
}

func TestAniListAnimeEnrichmentQuerySkipsHeavyRecommendationPayloads(t *testing.T) {
	query := aniListAnimeEnrichmentQuery()

	for _, unexpected := range []string{
		"recommendations(",
		"characters(",
		"studios(",
	} {
		if strings.Contains(query, unexpected) {
			t.Fatalf("expected anime enrichment query to skip %q, got %q", unexpected, query)
		}
	}
	if !strings.Contains(query, "streamingEpisodes") {
		t.Fatalf("expected anime enrichment query to keep streamingEpisodes, got %q", query)
	}
}

func TestAniListMangaEnrichmentQuerySkipsHeavyRecommendationPayloads(t *testing.T) {
	query := aniListMangaEnrichmentQuery()

	for _, unexpected := range []string{
		"recommendations(",
		"characters(",
	} {
		if strings.Contains(query, unexpected) {
			t.Fatalf("expected manga enrichment query to skip %q, got %q", unexpected, query)
		}
	}
	if !strings.Contains(query, "description(asHtml: false)") {
		t.Fatalf("expected manga enrichment query to keep summary fields, got %q", query)
	}
}

func TestMapAniListRecommendationsBuildsTypedPayloads(t *testing.T) {
	recommendations := mapAniListRecommendations([]aniListRecommendationEdge{
		{
			Node: aniListRecommendationNode{
				ID:     301,
				Rating: 97,
				MediaRecommendation: aniListRecommendationMedia{
					ID:     101,
					IDMal:  201,
					Type:   "ANIME",
					Format: "TV",
					Status: "FINISHED",
					Title: aniListRecommendationTitleNode{
						Romaji:  "Dungeon Meshi",
						English: "Delicious in Dungeon",
						Native:  "Dungeon Native",
					},
					CoverImage: aniListRecommendationCoverImageNode{
						ExtraLarge: "https://cdn.example/dungeon-xl.jpg",
						Large:      "https://cdn.example/dungeon-lg.jpg",
						Medium:     "https://cdn.example/dungeon-md.jpg",
					},
					BannerImage: "https://cdn.example/dungeon-banner.jpg",
					Genres:      []string{"Adventure", "Fantasy"},
					SiteURL:     "https://anilist.co/anime/101",
				},
			},
		},
	})

	if len(recommendations) != 1 {
		t.Fatalf("expected 1 recommendation, got %d", len(recommendations))
	}

	got := recommendations[0]
	if got.ID != 101 || got.AniListID != 101 {
		t.Fatalf("expected media recommendation id 101 to be preserved, got %+v", got)
	}
	if got.MalID != 201 {
		t.Fatalf("expected MAL id 201, got %+v", got)
	}
	if got.Rating != 97 {
		t.Fatalf("expected rating 97, got %+v", got)
	}
	if got.MediaType != "ANIME" || got.Format != "TV" || got.Status != "FINISHED" {
		t.Fatalf("expected type/format/status to be preserved, got %+v", got)
	}
	if got.Title.English != "Delicious in Dungeon" || got.Title.Romaji != "Dungeon Meshi" || got.Title.Native != "Dungeon Native" {
		t.Fatalf("expected nested title fields to be preserved, got %+v", got.Title)
	}
	if got.CoverImage.ExtraLarge != "https://cdn.example/dungeon-xl.jpg" || got.CoverImage.Large != "https://cdn.example/dungeon-lg.jpg" {
		t.Fatalf("expected cover image fields to be preserved, got %+v", got.CoverImage)
	}
	if got.SiteURL != "https://anilist.co/anime/101" {
		t.Fatalf("expected siteUrl to be preserved, got %+v", got)
	}
	if len(got.Genres) != 2 || got.Genres[0] != "Adventure" {
		t.Fatalf("expected genres to be preserved, got %+v", got.Genres)
	}
}

func TestMapAniListRecommendationsSkipsUntitledAndDuplicateNodes(t *testing.T) {
	recommendations := mapAniListRecommendations([]aniListRecommendationEdge{
		{
			Node: aniListRecommendationNode{
				ID:     1,
				Rating: 50,
				MediaRecommendation: aniListRecommendationMedia{
					ID:    1,
					Title: aniListRecommendationTitleNode{},
				},
			},
		},
		{
			Node: aniListRecommendationNode{
				ID:     2,
				Rating: 80,
				MediaRecommendation: aniListRecommendationMedia{
					ID:    2,
					Title: aniListRecommendationTitleNode{English: "Blue Box"},
				},
			},
		},
		{
			Node: aniListRecommendationNode{
				ID:     3,
				Rating: 81,
				MediaRecommendation: aniListRecommendationMedia{
					ID:    2,
					Title: aniListRecommendationTitleNode{English: "Blue Box"},
				},
			},
		},
	})

	if len(recommendations) != 1 {
		t.Fatalf("expected only one deduped titled recommendation, got %+v", recommendations)
	}
	if recommendations[0].ID != 2 || recommendations[0].Title.English != "Blue Box" {
		t.Fatalf("expected Blue Box recommendation to remain, got %+v", recommendations[0])
	}
}

func TestAnimeDetailRecommendationsPreferAniListEdges(t *testing.T) {
	edges := []aniListRecommendationEdge{
		{
			Node: aniListRecommendationNode{
				ID:     1,
				Rating: 94,
				MediaRecommendation: aniListRecommendationMedia{
					ID:    111,
					IDMal: 211,
					Title: aniListRecommendationTitleNode{English: "AniList Pick"},
				},
			},
		},
	}
	jikanFallback := []AniListRecommendation{
		{ID: 999, AniListID: 0, MalID: 999, Title: AniListRecommendationTitle{English: "Jikan Pick"}},
	}

	recommendations := preferAniListDetailRecommendations(edges, jikanFallback)
	if len(recommendations) != 1 {
		t.Fatalf("expected AniList recommendations to win, got %+v", recommendations)
	}
	if recommendations[0].AniListID != 111 || recommendations[0].Title.English != "AniList Pick" {
		t.Fatalf("expected AniList recommendation payload to win, got %+v", recommendations[0])
	}
}

func TestMangaDetailRecommendationsPreferAniListEdges(t *testing.T) {
	edges := []aniListRecommendationEdge{
		{
			Node: aniListRecommendationNode{
				ID:     2,
				Rating: 91,
				MediaRecommendation: aniListRecommendationMedia{
					ID:    212,
					IDMal: 312,
					Title: aniListRecommendationTitleNode{English: "AniList Manga Pick"},
				},
			},
		},
	}
	jikanFallback := []AniListRecommendation{
		{ID: 888, AniListID: 0, MalID: 888, Title: AniListRecommendationTitle{English: "Jikan Manga Pick"}},
	}

	recommendations := preferAniListDetailRecommendations(edges, jikanFallback)
	if len(recommendations) != 1 {
		t.Fatalf("expected AniList recommendations to win, got %+v", recommendations)
	}
	if recommendations[0].AniListID != 212 || recommendations[0].Title.English != "AniList Manga Pick" {
		t.Fatalf("expected AniList manga recommendation payload to win, got %+v", recommendations[0])
	}
}
