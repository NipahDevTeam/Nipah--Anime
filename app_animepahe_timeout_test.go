package main

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"miruro/backend/extensions"
)

type delayedAnimeSource struct {
	id string

	searchDelay   time.Duration
	searchResults []extensions.SearchResult
	searchMu      sync.Mutex
	searchCalls   int

	episodeDelay time.Duration
	episodes     []extensions.Episode
	episodeMu    sync.Mutex
	episodeCalls int
}

func (s *delayedAnimeSource) ID() string { return s.id }

func (s *delayedAnimeSource) Name() string { return "Delayed Anime Source" }

func (s *delayedAnimeSource) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

func (s *delayedAnimeSource) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	s.searchMu.Lock()
	s.searchCalls++
	s.searchMu.Unlock()
	time.Sleep(s.searchDelay)
	return append([]extensions.SearchResult(nil), s.searchResults...), nil
}

func (s *delayedAnimeSource) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	s.episodeMu.Lock()
	s.episodeCalls++
	s.episodeMu.Unlock()
	time.Sleep(s.episodeDelay)
	return append([]extensions.Episode(nil), s.episodes...), nil
}

func (s *delayedAnimeSource) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	return nil, nil
}

func (s *delayedAnimeSource) SearchCalls() int {
	s.searchMu.Lock()
	defer s.searchMu.Unlock()
	return s.searchCalls
}

func (s *delayedAnimeSource) EpisodeCalls() int {
	s.episodeMu.Lock()
	defer s.episodeMu.Unlock()
	return s.episodeCalls
}

type sharedStateAnimeSource struct {
	id string

	searchStarted  chan struct{}
	searchRelease  chan struct{}
	searchFinished chan struct{}

	mu       sync.Mutex
	degraded bool
}

func (s *sharedStateAnimeSource) ID() string { return s.id }

func (s *sharedStateAnimeSource) Name() string { return "Shared State Anime Source" }

func (s *sharedStateAnimeSource) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangEnglish}
}

func (s *sharedStateAnimeSource) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	select {
	case s.searchStarted <- struct{}{}:
	default:
	}

	<-s.searchRelease

	s.mu.Lock()
	s.degraded = true
	s.mu.Unlock()

	select {
	case s.searchFinished <- struct{}{}:
	default:
	}

	return []extensions.SearchResult{{ID: "late-hit", Title: query}}, nil
}

func (s *sharedStateAnimeSource) SearchWithContext(ctx context.Context, query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	select {
	case s.searchStarted <- struct{}{}:
	default:
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.searchRelease:
	}

	s.mu.Lock()
	s.degraded = true
	s.mu.Unlock()

	select {
	case s.searchFinished <- struct{}{}:
	default:
	}

	return []extensions.SearchResult{{ID: "late-hit", Title: query}}, nil
}

func (s *sharedStateAnimeSource) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	return []extensions.Episode{{ID: animeID + "-1", Number: 1}}, nil
}

func (s *sharedStateAnimeSource) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	return nil, nil
}

func (s *sharedStateAnimeSource) IsDegraded() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.degraded
}

func TestCachedAnimeSearchWithTimeoutDoesNotWarmCacheAfterTimeout(t *testing.T) {
	app := &App{}
	source := &delayedAnimeSource{
		id:          "animepahe-en",
		searchDelay: 40 * time.Millisecond,
		searchResults: []extensions.SearchResult{
			{ID: "angel-s2", Title: "The Angel Next Door Spoils Me Rotten 2"},
		},
	}

	query := fmt.Sprintf("%s-query", t.Name())
	_, err := app.cachedAnimeSearchWithTimeout(source, query, 10*time.Millisecond)
	if err == nil {
		t.Fatal("expected search timeout")
	}

	time.Sleep(60 * time.Millisecond)

	results, err := app.cachedAnimeSearchWithTimeout(source, query, 100*time.Millisecond)
	if err != nil {
		t.Fatalf("expected second search attempt to succeed, got %v", err)
	}
	if len(results) != 1 || results[0].ID != "angel-s2" {
		t.Fatalf("expected fresh search results after retry, got %#v", results)
	}
	if source.SearchCalls() != 2 {
		t.Fatalf("expected timed-out search not to warm cache, got %d source calls", source.SearchCalls())
	}
}

func TestCachedAnimeEpisodesWithTimeoutDoesNotWarmCacheAfterTimeout(t *testing.T) {
	app := &App{}
	source := &delayedAnimeSource{
		id:           "animepahe-en",
		episodeDelay: 40 * time.Millisecond,
		episodes: []extensions.Episode{
			{ID: "angel-s2-ep-1", Number: 1},
			{ID: "angel-s2-ep-2", Number: 2},
		},
	}

	animeID := fmt.Sprintf("%s-anime", t.Name())
	_, _, err := app.cachedAnimeEpisodesWithTimeout(source, source.ID(), animeID, 10*time.Millisecond)
	if err == nil {
		t.Fatal("expected episode timeout")
	}

	time.Sleep(60 * time.Millisecond)

	episodes, origin, err := app.cachedAnimeEpisodesWithTimeout(source, source.ID(), animeID, 100*time.Millisecond)
	if err != nil {
		t.Fatalf("expected second episode attempt to succeed, got %v", err)
	}
	if origin != "network" {
		t.Fatalf("expected second attempt to resolve from network, got %q", origin)
	}
	if len(episodes) != 2 || episodes[0].ID != "angel-s2-ep-1" {
		t.Fatalf("expected fresh episodes after retry, got %#v", episodes)
	}
	if source.EpisodeCalls() != 2 {
		t.Fatalf("expected timed-out episode fetch not to warm cache, got %d source calls", source.EpisodeCalls())
	}
}

func TestCachedAnimeSearchWithTimeoutDoesNotLetTimedOutWorkContinueMutatingSourceState(t *testing.T) {
	app := &App{}
	source := &sharedStateAnimeSource{
		id:             "animepahe-en",
		searchStarted:  make(chan struct{}, 1),
		searchRelease:  make(chan struct{}),
		searchFinished: make(chan struct{}, 1),
	}

	_, err := app.cachedAnimeSearchWithTimeout(source, "Re:Zero", 10*time.Millisecond)
	if err == nil {
		t.Fatal("expected search timeout")
	}

	<-source.searchStarted
	close(source.searchRelease)
	select {
	case <-source.searchFinished:
	case <-time.After(50 * time.Millisecond):
	}

	if source.IsDegraded() {
		t.Fatal("timed-out AnimePahe work should not be allowed to complete and mutate shared source state")
	}
}
