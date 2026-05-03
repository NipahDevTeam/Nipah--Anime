package main

import (
	"testing"

	"miruro/backend/extensions"
)

type stubAnimeSource struct {
	id string
}

func (s *stubAnimeSource) ID() string { return s.id }

func (s *stubAnimeSource) Name() string { return "Stub Anime" }

func (s *stubAnimeSource) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

func (s *stubAnimeSource) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	return nil, nil
}

func (s *stubAnimeSource) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	return nil, nil
}

func (s *stubAnimeSource) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	return nil, nil
}

type stubAnimeAudioVariantSource struct {
	stubAnimeSource
	variants map[string]bool
}

func (s *stubAnimeAudioVariantSource) GetAudioVariants(animeID string, episodeID string) (map[string]bool, error) {
	return s.variants, nil
}

func TestGetOnlineAudioVariantsUsesGenericSourceCapability(t *testing.T) {
	app := &App{
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimeAudioVariantSource{
		stubAnimeSource: stubAnimeSource{id: "stub-audio-en"},
		variants: map[string]bool{
			"sub": true,
			"dub": true,
		},
	})

	variants, err := app.GetOnlineAudioVariants("stub-audio-en", "anime-1", "episode-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !variants["sub"] {
		t.Fatalf("expected sub variant to be true, got %#v", variants)
	}
	if !variants["dub"] {
		t.Fatalf("expected dub variant to be true, got %#v", variants)
	}
}

func TestGetOnlineAudioVariantsFallsBackForSourcesWithoutCapability(t *testing.T) {
	app := &App{
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimeSource{id: "stub-basic-en"})

	variants, err := app.GetOnlineAudioVariants("stub-basic-en", "anime-1", "episode-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !variants["sub"] {
		t.Fatalf("expected sub fallback to remain true, got %#v", variants)
	}
	if variants["dub"] {
		t.Fatalf("expected dub fallback to remain false, got %#v", variants)
	}
}
