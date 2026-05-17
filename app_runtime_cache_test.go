package main

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"miruro/backend/db"
	"miruro/backend/metadata"
)

func newRuntimeCacheTestDB(t *testing.T) *db.Database {
	t.Helper()

	t.Setenv("APPDATA", t.TempDir())

	database, err := db.New()
	if err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		database.Close()
	})
	return database
}

func writeRuntimeCacheSnapshotForTest[T any](t *testing.T, database *db.Database, key string, savedAt time.Time, freshTTL, staleTTL time.Duration, value T) {
	t.Helper()

	payload, err := json.Marshal(persistedJSONSnapshot[T]{
		SavedAtUnix:    savedAt.Unix(),
		FreshUntilUnix: savedAt.Add(freshTTL).Unix(),
		StaleUntilUnix: savedAt.Add(staleTTL).Unix(),
		Value:          value,
	})
	if err != nil {
		t.Fatalf("marshal snapshot payload: %v", err)
	}
	if err := database.SetSetting(key, string(payload)); err != nil {
		t.Fatalf("write snapshot payload: %v", err)
	}
}

func TestGetAniListMangaCatalogHomeUsesPersistentSnapshotBeforeRefresh(t *testing.T) {
	t.Run("fresh snapshot", func(t *testing.T) {
		database := newRuntimeCacheTestDB(t)
		app := &App{
			db:       database,
			metadata: metadata.NewManager(),
		}

		payload := map[string][]metadata.AniListMangaMetadata{
			"featured": {
				{
					AniListID:   101,
					TitleRomaji: "Dandadan",
				},
			},
		}

		cacheKey := "anilist:manga:catalog-home:en"
		writePersistentJSONSnapshot(database, "cache:"+cacheKey, 20*time.Minute, 4*time.Hour, payload)

		result, err := app.GetAniListMangaCatalogHome("en")
		if err != nil {
			t.Fatalf("expected fresh persistent snapshot to be served, got error: %v", err)
		}

		if !reflect.DeepEqual(result, payload) {
			t.Fatalf("expected fresh persisted payload, got %#v", result)
		}
	})

	t.Run("stale snapshot returns immediately before refresh", func(t *testing.T) {
		database := newRuntimeCacheTestDB(t)
		app := &App{
			db:       database,
			metadata: metadata.NewManager(),
		}

		payload := map[string][]metadata.AniListMangaMetadata{
			"featured": {
				{
					AniListID:   202,
					TitleRomaji: "Blue Box",
				},
			},
		}

		cacheKey := "anilist:manga:catalog-home:es"
		writeRuntimeCacheSnapshotForTest(t, database, "cache:"+cacheKey, time.Now().Add(-30*time.Minute), 20*time.Minute, 4*time.Hour, payload)

		result, err := app.GetAniListMangaCatalogHome("es")
		if err != nil {
			t.Fatalf("expected stale persistent snapshot to be served before refresh, got error: %v", err)
		}

		if !reflect.DeepEqual(result, payload) {
			t.Fatalf("expected stale persisted payload before refresh, got %#v", result)
		}
	})
}

func TestDiscoverAnimeDefaultPageUsesPersistentSnapshot(t *testing.T) {
	database := newRuntimeCacheTestDB(t)
	app := &App{
		db:       database,
		metadata: metadata.NewManager(),
	}

	payload := map[string]interface{}{
		"data": map[string]interface{}{
			"Page": map[string]interface{}{
				"pageInfo": map[string]interface{}{
					"currentPage": float64(1),
					"hasNextPage": true,
				},
				"media": []interface{}{
					map[string]interface{}{
						"id":              float64(77),
						"title_romaji":    "Frieren",
						"title_english":   "Frieren: Beyond Journey's End",
						"canonical_title": "Frieren: Beyond Journey's End",
					},
				},
			},
		},
	}

	cacheKey := "anilist:discover:anime:v3:||0|TRENDING_DESC|||1"
	writePersistentJSONSnapshot(database, "cache:"+cacheKey, 20*time.Minute, 4*time.Hour, payload)

	result, err := app.DiscoverAnime("", "", 0, "TRENDING_DESC", "", "", 1)
	if err != nil {
		t.Fatalf("expected persistent snapshot to be served, got error: %v", err)
	}

	if !reflect.DeepEqual(result, payload) {
		t.Fatalf("expected persisted payload, got %#v", result)
	}
}

func TestDiscoverMangaDefaultPageUsesPersistentSnapshot(t *testing.T) {
	database := newRuntimeCacheTestDB(t)
	app := &App{
		db:       database,
		metadata: metadata.NewManager(),
	}

	payload := map[string]interface{}{
		"data": map[string]interface{}{
			"Page": map[string]interface{}{
				"pageInfo": map[string]interface{}{
					"currentPage": float64(1),
					"hasNextPage": true,
				},
				"media": []interface{}{
					map[string]interface{}{
						"id":              float64(88),
						"title_romaji":    "Blue Box",
						"title_english":   "Blue Box",
						"canonical_title": "Blue Box",
					},
				},
			},
		},
	}

	cacheKey := "anilist:discover:manga:v2:|0|TRENDING_DESC|||1"
	writePersistentJSONSnapshot(database, "cache:"+cacheKey, 20*time.Minute, 4*time.Hour, payload)

	result, err := app.DiscoverManga("", 0, "TRENDING_DESC", "", "", 1)
	if err != nil {
		t.Fatalf("expected persistent snapshot to be served, got error: %v", err)
	}

	if !reflect.DeepEqual(result, payload) {
		t.Fatalf("expected persisted payload, got %#v", result)
	}
}

func TestGetAniListAnimeByIDUsesPersistentSnapshotBeforeRefresh(t *testing.T) {
	t.Run("fresh snapshot", func(t *testing.T) {
		database := newRuntimeCacheTestDB(t)
		app := &App{
			db:       database,
			metadata: metadata.NewManager(),
		}

		payload := &metadata.AnimeMetadata{
			AniListID:    501,
			TitleRomaji:  "Frieren",
			TitleEnglish: "Frieren: Beyond Journey's End",
			CoverLarge:   "https://cdn.example/frieren-cover.jpg",
			Description:  "An elf mage keeps walking.",
		}

		cacheKey := "anilist:anime:id:v2:501"
		writePersistentJSONSnapshot(database, "cache:"+cacheKey, 2*time.Hour, 12*time.Hour, payload)

		result, err := app.GetAniListAnimeByID(501)
		if err != nil {
			t.Fatalf("expected fresh persistent anime snapshot to be served, got error: %v", err)
		}

		typed, ok := result.(*metadata.AnimeMetadata)
		if !ok {
			t.Fatalf("expected anime metadata pointer, got %T", result)
		}
		if !reflect.DeepEqual(typed, payload) {
			t.Fatalf("expected persisted anime payload, got %#v", typed)
		}
	})

	t.Run("stale snapshot returns immediately before refresh", func(t *testing.T) {
		database := newRuntimeCacheTestDB(t)
		app := &App{
			db:       database,
			metadata: metadata.NewManager(),
		}

		payload := &metadata.AnimeMetadata{
			AniListID:   777,
			TitleRomaji: "Dungeon Meshi",
			CoverLarge:  "https://cdn.example/dungeon-cover.jpg",
		}

		cacheKey := "anilist:anime:id:v2:777"
		writeRuntimeCacheSnapshotForTest(t, database, "cache:"+cacheKey, time.Now().Add(-3*time.Hour), 2*time.Hour, 12*time.Hour, payload)

		result, err := app.GetAniListAnimeByID(777)
		if err != nil {
			t.Fatalf("expected stale persistent anime snapshot to be served before refresh, got error: %v", err)
		}

		typed, ok := result.(*metadata.AnimeMetadata)
		if !ok {
			t.Fatalf("expected anime metadata pointer, got %T", result)
		}
		if !reflect.DeepEqual(typed, payload) {
			t.Fatalf("expected stale persisted anime payload before refresh, got %#v", typed)
		}
	})
}

func TestGetAniListMangaByIDUsesPersistentSnapshotBeforeRefresh(t *testing.T) {
	database := newRuntimeCacheTestDB(t)
	app := &App{
		db:       database,
		metadata: metadata.NewManager(),
	}

	payload := &metadata.AniListMangaMetadata{
		AniListID:    910,
		TitleRomaji:  "Blue Box",
		TitleEnglish: "Blue Box",
		CoverLarge:   "https://cdn.example/blue-box-cover.jpg",
		Description:  "Sports and romance collide.",
	}

	cacheKey := "anilist:manga:id:v3:910"
	writePersistentJSONSnapshot(database, "cache:"+cacheKey, 2*time.Hour, 12*time.Hour, payload)

	result, err := app.GetAniListMangaByID(910)
	if err != nil {
		t.Fatalf("expected fresh persistent manga snapshot to be served, got error: %v", err)
	}

	typed, ok := result.(*metadata.AniListMangaMetadata)
	if !ok {
		t.Fatalf("expected manga metadata pointer, got %T", result)
	}
	if !reflect.DeepEqual(typed, payload) {
		t.Fatalf("expected persisted manga payload, got %#v", typed)
	}
}

func TestRememberAniListMangaDetailSnapshotIgnoresIncompletePersistentEntries(t *testing.T) {
	database := newRuntimeCacheTestDB(t)
	cacheKey := "anilist:manga:id:v3:118"
	writePersistentJSONSnapshot(database, "cache:"+cacheKey, 2*time.Hour, 12*time.Hour, &metadata.AniListMangaMetadata{
		AniListID:    118,
		TitleEnglish: "Incomplete Snapshot",
	})

	calls := 0
	result, origin, err := rememberAniListMangaDetailSnapshot(database, 118, func() (*metadata.AniListMangaMetadata, error) {
		calls++
		return &metadata.AniListMangaMetadata{
			AniListID:       118,
			TitleEnglish:    "Blue Box",
			Recommendations: []metadata.AniListRecommendation{{AniListID: 119}},
			DetailHydrated:  true,
		}, nil
	})
	if err != nil {
		t.Fatalf("expected incomplete persisted detail snapshot to be bypassed, got error: %v", err)
	}
	if origin != "network" {
		t.Fatalf("expected network origin after bypassing incomplete detail snapshot, got %q", origin)
	}
	if calls != 1 {
		t.Fatalf("expected loader to be called once, got %d calls", calls)
	}
	if result == nil || !result.DetailHydrated || len(result.Recommendations) != 1 {
		t.Fatalf("expected hydrated detail payload, got %#v", result)
	}
}

func TestLoadAniListAnimeMetadataUsesEnrichmentSnapshotBeforeRefresh(t *testing.T) {
	database := newRuntimeCacheTestDB(t)
	app := &App{
		db:       database,
		metadata: metadata.NewManager(),
	}

	payload := &metadata.AnimeMetadata{
		AniListID:    333,
		TitleRomaji:  "Orb: On the Movements of the Earth",
		TitleEnglish: "Orb: On the Movements of the Earth",
		CoverLarge:   "https://cdn.example/orb-cover.jpg",
		Description:  "Astronomy and danger.",
	}

	cacheKey := "anilist:anime:enrichment:id:333"
	writePersistentJSONSnapshot(database, "cache:"+cacheKey, 2*time.Hour, 12*time.Hour, payload)

	result, err := app.loadAniListAnimeMetadata(333)
	if err != nil {
		t.Fatalf("expected persisted anime enrichment payload, got error: %v", err)
	}
	if !reflect.DeepEqual(result, payload) {
		t.Fatalf("expected persisted anime enrichment payload, got %#v", result)
	}
}

func TestLoadAniListMangaMetadataUsesEnrichmentSnapshotBeforeRefresh(t *testing.T) {
	database := newRuntimeCacheTestDB(t)
	app := &App{
		db:       database,
		metadata: metadata.NewManager(),
	}

	payload := &metadata.AniListMangaMetadata{
		AniListID:    444,
		TitleRomaji:  "Blue Box",
		TitleEnglish: "Blue Box",
		CoverLarge:   "https://cdn.example/blue-box-cover.jpg",
		Description:  "Sports and romance collide.",
	}

	cacheKey := "anilist:manga:enrichment:id:444"
	writePersistentJSONSnapshot(database, "cache:"+cacheKey, 2*time.Hour, 12*time.Hour, payload)

	result, err := app.loadAniListMangaMetadata(444)
	if err != nil {
		t.Fatalf("expected persisted manga enrichment payload, got error: %v", err)
	}
	if !reflect.DeepEqual(result, payload) {
		t.Fatalf("expected persisted manga enrichment payload, got %#v", result)
	}
}
