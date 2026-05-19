package metadata

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func assertiveAniListRateLimitError() error {
	return metadataTestError("metadata request failed: 429 (Too Many Requests.)")
}

type metadataTestError string

func (e metadataTestError) Error() string { return string(e) }

func TestJikanAnimeSearchMapsIntoAniListLikeReadShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/anime" {
			t.Fatalf("expected /anime path, got %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("q"); got != "frieren" {
			t.Fatalf("expected q=frieren, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": [
				{
					"mal_id": 52991,
					"title": "Sousou no Frieren",
					"title_english": "Frieren: Beyond Journey's End",
					"title_japanese": "葬送のフリーレン",
					"synonyms": ["Frieren at the Funeral"],
					"episodes": 28,
					"status": "Finished Airing",
					"year": 2023,
					"score": 9.31,
					"images": {
						"jpg": {
							"large_image_url": "https://cdn.example/frieren-large.jpg",
							"image_url": "https://cdn.example/frieren.jpg"
						}
					}
				}
			]
		}`))
	}))
	defer server.Close()

	previousEndpoint := jikanEndpoint
	jikanEndpoint = server.URL
	defer func() { jikanEndpoint = previousEndpoint }()

	manager := NewManager()
	payload, err := manager.SearchAnimeViaJikan("frieren")
	if err != nil {
		t.Fatalf("expected Jikan payload, got error: %v", err)
	}

	root, ok := payload.(map[string]interface{})
	if !ok {
		t.Fatalf("expected payload map, got %T", payload)
	}
	data, ok := root["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data map, got %#v", root["data"])
	}
	page, ok := data["Page"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected Page map, got %#v", data["Page"])
	}
	media, ok := page["media"].([]interface{})
	if !ok {
		t.Fatalf("expected typed media slice, got %#v", page["media"])
	}
	if len(media) != 1 {
		t.Fatalf("expected 1 media item, got %d", len(media))
	}

	item, ok := media[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected media map, got %#v", media[0])
	}
	title, ok := item["title"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected title object, got %#v", item["title"])
	}
	coverImage, ok := item["coverImage"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected coverImage object, got %#v", item["coverImage"])
	}

	if got := item["canonical_title"]; got != "Frieren: Beyond Journey's End" {
		t.Fatalf("expected canonical English title, got %#v", got)
	}
	if got := title["romaji"]; got != "Sousou no Frieren" {
		t.Fatalf("expected romaji title, got %#v", got)
	}
	if got := title["english"]; got != "Frieren: Beyond Journey's End" {
		t.Fatalf("expected english title, got %#v", got)
	}
	if got := title["native"]; got != "葬送のフリーレン" {
		t.Fatalf("expected native title, got %#v", got)
	}
	if got := coverImage["large"]; got != "https://cdn.example/frieren-large.jpg" {
		t.Fatalf("expected large cover image, got %#v", got)
	}
	if got := item["averageScore"]; got != 93 {
		t.Fatalf("expected AniList-style score out of 100, got %#v", got)
	}
	if got := item["status"]; got != "FINISHED" {
		t.Fatalf("expected AniList-style status, got %#v", got)
	}
}

func TestJikanAnimeSearchKeepsMalIDWithoutInventingAniListID(t *testing.T) {
	item := mapJikanAnimeSearchResultToReadModel(jikanAnimeSearchItem{
		MalID:        16498,
		Title:        "Shingeki no Kyojin",
		TitleEnglish: "Attack on Titan",
		Status:       "Finished Airing",
		Images: jikanImageVariants{
			JPG: jikanImageSet{
				ImageURL: "https://cdn.example/aot.jpg",
			},
		},
	})

	if got := item["id"]; got != 0 {
		t.Fatalf("expected no AniList id to be invented, got %#v", got)
	}
	if got := item["anilist_id"]; got != 0 {
		t.Fatalf("expected anilist_id to stay empty, got %#v", got)
	}
	if got := item["idMal"]; got != 16498 {
		t.Fatalf("expected idMal to preserve MAL identity, got %#v", got)
	}
	if got := item["mal_id"]; got != 16498 {
		t.Fatalf("expected mal_id to preserve MAL identity, got %#v", got)
	}
}

func TestSearchAniListUsesJikanFallbackWhenAniListIsDegraded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": [
				{
					"mal_id": 52991,
					"title": "Sousou no Frieren",
					"title_english": "Frieren: Beyond Journey's End",
					"status": "Finished Airing",
					"images": {
						"jpg": {
							"large_image_url": "https://cdn.example/frieren-large.jpg"
						}
					}
				}
			]
		}`))
	}))
	defer server.Close()

	previousEndpoint := jikanEndpoint
	jikanEndpoint = server.URL
	defer func() { jikanEndpoint = previousEndpoint }()

	manager := NewManager()
	manager.noteAniListInstability(assertiveAniListRateLimitError())
	manager.noteAniListInstability(assertiveAniListRateLimitError())

	payload, err := manager.SearchAniList("frieren", "en")
	if err != nil {
		t.Fatalf("expected Jikan fallback search payload, got error: %v", err)
	}

	root := payload.(map[string]interface{})
	data := root["data"].(map[string]interface{})
	page := data["Page"].(map[string]interface{})
	media := page["media"].([]interface{})
	if len(media) != 1 {
		t.Fatalf("expected fallback search result, got %d items", len(media))
	}

	item := media[0].(map[string]interface{})
	if got := item["mal_id"]; got != 52991 {
		t.Fatalf("expected Jikan MAL id, got %#v", got)
	}
	if got := item["id"]; got != 0 {
		t.Fatalf("expected no AniList id during fallback, got %#v", got)
	}
}

func TestJikanAnimeDetailMapsCharactersRecommendationsAndImages(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/anime/52991/full":
			_, _ = w.Write([]byte(`{
				"data": {
					"mal_id": 52991,
					"title": "Sousou no Frieren",
					"title_english": "Frieren: Beyond Journey's End",
					"title_japanese": "葬送のフリーレン",
					"synopsis": "An elf mage keeps walking.",
					"score": 9.31,
					"episodes": 28,
					"status": "Finished Airing",
					"year": 2023,
					"season": "fall",
					"source": "Manga",
					"images": {
						"jpg": {
							"large_image_url": "https://cdn.example/frieren-large.jpg",
							"image_url": "https://cdn.example/frieren-medium.jpg"
						}
					},
					"genres": [
						{ "name": "Adventure" },
						{ "name": "Drama" }
					],
					"studios": [
						{ "name": "Madhouse" }
					],
					"aired": {
						"from": "2023-09-29T00:00:00+00:00",
						"to": "2024-03-22T00:00:00+00:00"
					}
				}
			}`))
		case "/anime/52991/characters":
			_, _ = w.Write([]byte(`{
				"data": [
					{
						"role": "Main",
						"character": {
							"mal_id": 126353,
							"name": "Frieren",
							"name_kanji": "フリーレン",
							"images": {
								"jpg": {
									"image_url": "https://cdn.example/frieren-character.jpg"
								}
							}
						}
					}
				]
			}`))
		case "/anime/52991/recommendations":
			_, _ = w.Write([]byte(`{
				"data": [
					{
						"entry": {
							"mal_id": 5114,
							"title": "Fullmetal Alchemist: Brotherhood",
							"url": "https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood",
							"images": {
								"jpg": {
									"large_image_url": "https://cdn.example/fmab-large.jpg",
									"image_url": "https://cdn.example/fmab-medium.jpg"
								}
							}
						}
					}
				]
			}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	previousEndpoint := jikanEndpoint
	jikanEndpoint = server.URL
	defer func() { jikanEndpoint = previousEndpoint }()

	manager := NewManager()
	detail, err := manager.GetAnimeDetailViaJikan(52991)
	if err != nil {
		t.Fatalf("expected Jikan detail payload, got error: %v", err)
	}

	if detail.MalID != 52991 {
		t.Fatalf("expected MAL id 52991, got %d", detail.MalID)
	}
	if detail.AniListID != 0 {
		t.Fatalf("expected no invented AniList id, got %d", detail.AniListID)
	}
	if detail.TitleEnglish != "Frieren: Beyond Journey's End" {
		t.Fatalf("expected english title, got %q", detail.TitleEnglish)
	}
	if detail.CoverLarge != "https://cdn.example/frieren-large.jpg" {
		t.Fatalf("expected large cover, got %q", detail.CoverLarge)
	}
	if detail.CoverMedium != "https://cdn.example/frieren-medium.jpg" {
		t.Fatalf("expected medium cover, got %q", detail.CoverMedium)
	}
	if detail.Status != "FINISHED" {
		t.Fatalf("expected AniList-style status, got %q", detail.Status)
	}
	if detail.AverageScore != 93 {
		t.Fatalf("expected rounded AniList-style average score, got %v", detail.AverageScore)
	}
	if len(detail.Characters) != 1 || detail.Characters[0].Name != "Frieren" {
		t.Fatalf("expected mapped character list, got %#v", detail.Characters)
	}
	if len(detail.Recommendations) != 1 || detail.Recommendations[0].MalID != 5114 {
		t.Fatalf("expected mapped recommendations, got %#v", detail.Recommendations)
	}
	if detail.Recommendations[0].AniListID != 0 {
		t.Fatalf("expected recommendation AniList id to remain empty, got %d", detail.Recommendations[0].AniListID)
	}
	if len(detail.Genres) != 2 || detail.Genres[0] != "Adventure" {
		t.Fatalf("expected mapped genres, got %#v", detail.Genres)
	}
	if len(detail.Studios) != 1 || detail.Studios[0].Name != "Madhouse" {
		t.Fatalf("expected mapped studios, got %#v", detail.Studios)
	}
}

func TestGetAnimeRecommendationsViaJikanLimitsToFiveStableItems(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/anime/900/recommendations" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{
			"data": [
				{ "entry": { "mal_id": 1, "title": "A", "url": "https://myanimelist.net/anime/1/A", "images": { "jpg": { "image_url": "https://cdn.example/1.jpg" } } } },
				{ "entry": { "mal_id": 2, "title": "B", "url": "https://myanimelist.net/anime/2/B", "images": { "jpg": { "image_url": "https://cdn.example/2.jpg" } } } },
				{ "entry": { "mal_id": 3, "title": "C", "url": "https://myanimelist.net/anime/3/C", "images": { "jpg": { "image_url": "https://cdn.example/3.jpg" } } } },
				{ "entry": { "mal_id": 4, "title": "D", "url": "https://myanimelist.net/anime/4/D", "images": { "jpg": { "image_url": "https://cdn.example/4.jpg" } } } },
				{ "entry": { "mal_id": 5, "title": "E", "url": "https://myanimelist.net/anime/5/E", "images": { "jpg": { "image_url": "https://cdn.example/5.jpg" } } } },
				{ "entry": { "mal_id": 6, "title": "F", "url": "https://myanimelist.net/anime/6/F", "images": { "jpg": { "image_url": "https://cdn.example/6.jpg" } } } }
			]
		}`))
	}))
	defer server.Close()

	previousEndpoint := jikanEndpoint
	jikanEndpoint = server.URL
	defer func() { jikanEndpoint = previousEndpoint }()

	manager := NewManager()
	recommendations, err := manager.GetAnimeRecommendationsViaJikan(900)
	if err != nil {
		t.Fatalf("expected Jikan recommendations, got error: %v", err)
	}
	if len(recommendations) != preferredRecommendationLimit {
		t.Fatalf("expected %d recommendations, got %d", preferredRecommendationLimit, len(recommendations))
	}
	if recommendations[0].MalID != 1 || recommendations[4].MalID != 5 {
		t.Fatalf("expected stable first five recommendations, got %#v", recommendations)
	}
}

func TestGetMangaRecommendationsViaJikanMapsIntoReadShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/manga/12/recommendations" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{
			"data": [
				{
					"entry": {
						"mal_id": 21,
						"title": "Blue Box",
						"url": "https://myanimelist.net/manga/21/Blue_Box",
						"images": {
							"jpg": {
								"large_image_url": "https://cdn.example/blue-box-large.jpg",
								"image_url": "https://cdn.example/blue-box-medium.jpg"
							}
						}
					}
				}
			]
		}`))
	}))
	defer server.Close()

	previousEndpoint := jikanEndpoint
	jikanEndpoint = server.URL
	defer func() { jikanEndpoint = previousEndpoint }()

	manager := NewManager()
	recommendations, err := manager.GetMangaRecommendationsViaJikan(12)
	if err != nil {
		t.Fatalf("expected Jikan manga recommendations, got error: %v", err)
	}
	if len(recommendations) != 1 {
		t.Fatalf("expected one recommendation, got %#v", recommendations)
	}
	got := recommendations[0]
	if got.MalID != 21 || got.AniListID != 0 {
		t.Fatalf("expected MAL-owned recommendation without invented AniList id, got %#v", got)
	}
	if got.MediaType != "MANGA" {
		t.Fatalf("expected manga media type, got %#v", got)
	}
	if got.Title.English != "Blue Box" {
		t.Fatalf("expected manga recommendation title, got %#v", got)
	}
	if got.CoverImage.Large != "https://cdn.example/blue-box-large.jpg" {
		t.Fatalf("expected mapped cover image, got %#v", got.CoverImage)
	}
}

func TestGetAnimeCharactersViaJikanLimitsToFiveAndPrioritizesMainRoles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/anime/777/characters" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{
			"data": [
				{
					"role": "Supporting",
					"character": {
						"mal_id": 1,
						"name": "Side A",
						"images": { "jpg": { "image_url": "https://cdn.example/side-a.jpg" } }
					}
				},
				{
					"role": "Main",
					"character": {
						"mal_id": 2,
						"name": "Lead A",
						"images": { "jpg": { "image_url": "https://cdn.example/lead-a.jpg" } }
					}
				},
				{
					"role": "Supporting",
					"character": {
						"mal_id": 3,
						"name": "Side B",
						"images": { "jpg": { "image_url": "https://cdn.example/side-b.jpg" } }
					}
				},
				{
					"role": "Main",
					"character": {
						"mal_id": 4,
						"name": "Lead B",
						"images": { "jpg": { "image_url": "https://cdn.example/lead-b.jpg" } }
					}
				},
				{
					"role": "Supporting",
					"character": {
						"mal_id": 5,
						"name": "Side C",
						"images": { "jpg": { "image_url": "https://cdn.example/side-c.jpg" } }
					}
				},
				{
					"role": "Main",
					"character": {
						"mal_id": 6,
						"name": "Lead C",
						"images": { "jpg": { "image_url": "https://cdn.example/lead-c.jpg" } }
					}
				}
			]
		}`))
	}))
	defer server.Close()

	previousEndpoint := jikanEndpoint
	jikanEndpoint = server.URL
	defer func() { jikanEndpoint = previousEndpoint }()

	manager := NewManager()
	characters, err := manager.GetAnimeCharactersViaJikan(777)
	if err != nil {
		t.Fatalf("expected limited Jikan character payload, got error: %v", err)
	}

	if len(characters) != 5 {
		t.Fatalf("expected 5 characters max, got %d", len(characters))
	}
	if characters[0].Name != "Lead A" || characters[1].Name != "Lead B" || characters[2].Name != "Lead C" {
		t.Fatalf("expected main characters first, got %#v", characters)
	}
	if characters[3].Name != "Side A" || characters[4].Name != "Side B" {
		t.Fatalf("expected supporting characters to fill remaining slots, got %#v", characters)
	}
}

func TestGetAniListAnimeCatalogHomeUsesJikanSeasonalFallbackWhenDegraded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/top/anime":
			_, _ = w.Write([]byte(`{
				"data": [
					{
						"mal_id": 52991,
						"title": "Sousou no Frieren",
						"title_english": "Frieren: Beyond Journey's End",
						"title_japanese": "葬送のフリーレン",
						"status": "Currently Airing",
						"year": 2026,
						"episodes": 28,
						"images": { "jpg": { "large_image_url": "https://cdn.example/frieren-home.jpg" } }
					}
				]
			}`))
		case "/seasons/2026/spring":
			_, _ = w.Write([]byte(`{
				"data": [
					{
						"mal_id": 1001,
						"title": "Spring Hit",
						"title_english": "Spring Hit",
						"status": "Currently Airing",
						"year": 2026,
						"episodes": 12,
						"images": { "jpg": { "large_image_url": "https://cdn.example/spring-hit.jpg" } }
					}
				]
			}`))
		case "/seasons/2026/winter":
			_, _ = w.Write([]byte(`{
				"data": [
					{
						"mal_id": 2001,
						"title": "Winter Echo",
						"title_english": "Winter Echo",
						"status": "Finished Airing",
						"year": 2025,
						"episodes": 12,
						"images": { "jpg": { "large_image_url": "https://cdn.example/winter-echo.jpg" } }
					}
				]
			}`))
		case "/seasons/upcoming":
			_, _ = w.Write([]byte(`{
				"data": [
					{
						"mal_id": 3001,
						"title": "Next Season",
						"title_english": "Next Season",
						"status": "Not yet aired",
						"year": 2026,
						"episodes": 12,
						"images": { "jpg": { "large_image_url": "https://cdn.example/next-season.jpg" } }
					}
				]
			}`))
		case "/anime":
			_, _ = w.Write([]byte(`{
				"data": [
					{
						"mal_id": 4001,
						"title": "Genre Shelf",
						"title_english": "Genre Shelf",
						"status": "Finished Airing",
						"year": 2024,
						"episodes": 24,
						"images": { "jpg": { "large_image_url": "https://cdn.example/genre-shelf.jpg" } }
					}
				]
			}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	previousEndpoint := jikanEndpoint
	jikanEndpoint = server.URL
	defer func() { jikanEndpoint = previousEndpoint }()

	manager := NewManager()
	manager.noteAniListInstability(assertiveAniListRateLimitError())
	manager.noteAniListInstability(assertiveAniListRateLimitError())

	payload, err := manager.GetAniListAnimeCatalogHome("SPRING", 2026)
	if err != nil {
		t.Fatalf("expected Jikan home fallback payload, got error: %v", err)
	}

	if len(payload["featured"]) != 1 || payload["featured"][0]["mal_id"] != 52991 {
		t.Fatalf("expected featured Jikan fallback shelf, got %#v", payload["featured"])
	}
	if payload["featured"][0]["id"] != 0 {
		t.Fatalf("expected no invented AniList id in featured shelf, got %#v", payload["featured"][0]["id"])
	}
	if len(payload["newlyTrending"]) != 1 || payload["newlyTrending"][0]["mal_id"] != 1001 {
		t.Fatalf("expected seasonal shelf payload, got %#v", payload["newlyTrending"])
	}
	if len(payload["upcoming"]) != 1 || payload["upcoming"][0]["status"] != "NOT_YET_RELEASED" {
		t.Fatalf("expected upcoming shelf payload, got %#v", payload["upcoming"])
	}
	if len(payload["action"]) != 1 || payload["action"][0]["mal_id"] != 4001 {
		t.Fatalf("expected genre shelf payload, got %#v", payload["action"])
	}
}

func TestAnimeDetailKeepsAniListSynopsisEvenWhenJikanIsLonger(t *testing.T) {
	base := &AnimeMetadata{
		AniListID:   101,
		MalID:       201,
		Description: "A brief synopsis.",
	}
	enrichment := &AnimeMetadata{
		MalID:       201,
		Description: "A much richer Jikan synopsis that adds concrete story context, character stakes, and enough detail to clearly beat the sparse AniList copy.",
	}

	merged := applyJikanAnimeEnrichment(base, enrichment)
	if merged.Description != base.Description {
		t.Fatalf("expected AniList synopsis to remain the source of truth, got %q", merged.Description)
	}
}

func TestAnimeDetailKeepsAniListSynopsisWhenAlreadyStrong(t *testing.T) {
	base := &AnimeMetadata{
		AniListID:   101,
		MalID:       201,
		Description: "A strong AniList synopsis that already explains the setup, the major conflict, and the emotional angle without feeling truncated or placeholder-like.",
	}
	enrichment := &AnimeMetadata{
		MalID:       201,
		Description: "A shorter Jikan blurb.",
	}

	merged := applyJikanAnimeEnrichment(base, enrichment)
	if merged.Description != base.Description {
		t.Fatalf("expected strong AniList synopsis to remain, got %q", merged.Description)
	}
}

func TestMangaDetailKeepsAniListSynopsisEvenWhenJikanIsLonger(t *testing.T) {
	base := &AniListMangaMetadata{
		AniListID:   301,
		MalID:       401,
		Description: "A compact AniList manga synopsis.",
	}
	enrichment := &AniListMangaMetadata{
		MalID:       401,
		Description: "A much longer Jikan manga synopsis that would previously have replaced the AniList summary, but should now stay read-only for non-synopsis metadata only.",
	}

	merged := applyJikanMangaEnrichment(base, enrichment)
	if merged.Description != base.Description {
		t.Fatalf("expected AniList manga synopsis to remain the source of truth, got %q", merged.Description)
	}
}

func TestAnimeDetailCanUseJikanCharactersAsReadOnlyEnrichment(t *testing.T) {
	base := &AnimeMetadata{
		AniListID:       101,
		MalID:           201,
		Description:     "AniList synopsis stays fine here.",
		Characters:      []AnimeCharacter{{ID: 1, Name: "Old Cast", Role: "MAIN"}},
		Recommendations: []AniListRecommendation{{ID: 77, AniListID: 77, Title: AniListRecommendationTitle{English: "AniList Pick"}}},
	}
	enrichment := &AnimeMetadata{
		MalID:       201,
		Description: "Jikan copy that should not replace the stronger AniList synopsis in this case.",
		Characters: []AnimeCharacter{
			{ID: 10, Name: "Frieren", Role: "MAIN", Image: "https://cdn.example/frieren.jpg"},
			{ID: 11, Name: "Fern", Role: "SUPPORTING", Image: "https://cdn.example/fern.jpg"},
		},
		Recommendations: []AniListRecommendation{{ID: 88, AniListID: 0, MalID: 88, Title: AniListRecommendationTitle{English: "Jikan Pick"}}},
	}

	merged := applyJikanAnimeEnrichment(base, enrichment)
	if len(merged.Characters) != 2 || merged.Characters[0].Name != "Frieren" {
		t.Fatalf("expected Jikan cast enrichment to replace the cast strip, got %#v", merged.Characters)
	}
	if len(merged.Recommendations) != 1 || merged.Recommendations[0].AniListID != 77 {
		t.Fatalf("expected AniList recommendations to remain untouched, got %#v", merged.Recommendations)
	}
}
