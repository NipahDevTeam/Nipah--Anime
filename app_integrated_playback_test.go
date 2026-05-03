package main

import (
	"net/url"
	"strings"
	"testing"

	"miruro/backend/db"
	"miruro/backend/extensions"
)

type stubAnimePlaybackSource struct {
	stubAnimeSource
	streams []extensions.StreamSource
}

func (s *stubAnimePlaybackSource) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	return s.streams, nil
}

func newIntegratedPlaybackTestDB(t *testing.T) *db.Database {
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

func TestOpenOnlineEpisodeIntegratedPayloadPreservesCookieBackedStreams(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db:       database,
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimePlaybackSource{
		stubAnimeSource: stubAnimeSource{id: "stub-playback-en"},
		streams: []extensions.StreamSource{
			{
				URL:      "https://media.example/episode-1.m3u8",
				Quality:  "1080p",
				Language: extensions.LangEnglish,
				Audio:    "sub",
				Referer:  "https://provider.example/watch",
				Cookie:   "session=abc123",
			},
		},
	})

	payload, err := app.OpenOnlineEpisode(
		"stub-playback-en",
		"episode-1",
		"anime-1",
		"Example Show",
		"",
		0,
		0,
		1,
		"Episode 1",
		"",
		"integrated",
	)
	if err != nil {
		t.Fatalf("open online episode: %v", err)
	}

	proxyURL, _ := payload["proxy_url"].(string)
	if strings.TrimSpace(proxyURL) == "" {
		t.Fatalf("expected proxy_url in payload, got %#v", payload)
	}

	parsed, err := url.Parse(proxyURL)
	if err != nil {
		t.Fatalf("parse proxy_url: %v", err)
	}
	if got := parsed.Query().Get("cookie"); got != "session=abc123" {
		t.Fatalf("expected cookie query param to be preserved, got %q in %q", got, proxyURL)
	}
	if got, _ := payload["has_cookie"].(bool); !got {
		t.Fatalf("expected has_cookie=true, got %#v", payload["has_cookie"])
	}
}
