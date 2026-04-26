package main

import (
	"fmt"
	"testing"
	"time"

	"miruro/backend/db"
	"miruro/backend/extensions"
)

type benchmarkAnimeSource struct {
	id      string
	results []extensions.SearchResult
}

func (s benchmarkAnimeSource) ID() string { return s.id }

func (s benchmarkAnimeSource) Name() string { return "Benchmark Source" }

func (s benchmarkAnimeSource) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

func (s benchmarkAnimeSource) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	return s.results, nil
}

func (s benchmarkAnimeSource) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	return nil, nil
}

func (s benchmarkAnimeSource) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	return nil, nil
}

func BenchmarkCachedAnimeSearch(b *testing.B) {
	app := &App{}
	src := benchmarkAnimeSource{
		id: "bench-anime-en",
		results: []extensions.SearchResult{
			{ID: "1", Title: "Frieren", CoverURL: "https://example.com/frieren.jpg", Year: 2023},
			{ID: "2", Title: "Dungeon Meshi", CoverURL: "https://example.com/dungeon-meshi.jpg", Year: 2024},
		},
	}

	b.Run("uncached", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_, err := app.cachedAnimeSearch(src, fmt.Sprintf("frieren-%d", i))
			if err != nil {
				b.Fatal(err)
			}
		}
	})

	b.Run("cached", func(b *testing.B) {
		if _, err := app.cachedAnimeSearch(src, "frieren"); err != nil {
			b.Fatal(err)
		}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := app.cachedAnimeSearch(src, "frieren")
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}

func BenchmarkGroupOnlineMangaDashboardEntries(b *testing.B) {
	app := &App{}
	items := make([]db.OnlineMangaHistoryEntry, 0, 240)
	base := time.Date(2026, time.March, 26, 12, 0, 0, 0, time.UTC)

	for i := 0; i < 240; i++ {
		items = append(items, db.OnlineMangaHistoryEntry{
			ID:               i + 1,
			AniListID:        (i % 40) + 1,
			SourceID:         "weebcentral-en",
			SourceName:       "WeebCentral",
			SourceMangaID:    fmt.Sprintf("manga-%d", i%40),
			SourceMangaTitle: fmt.Sprintf("Series %d", i%40),
			CoverURL:         "https://example.com/cover.jpg",
			ChapterID:        fmt.Sprintf("chapter-%d", i),
			ChapterNum:       float64((i % 120) + 1),
			ChapterTitle:     fmt.Sprintf("Chapter %d", i+1),
			ReadAt:           base.Add(-time.Duration(i) * time.Minute),
			Completed:        i%3 == 0,
		})
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		all, byFormat := app.groupOnlineMangaDashboardEntries(items)
		if len(all) == 0 || len(byFormat) == 0 {
			b.Fatal("expected grouped dashboard entries")
		}
	}
}
