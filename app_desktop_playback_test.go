package main

import (
	"fmt"
	"testing"
	"time"

	"miruro/backend/extensions"
)

func TestDesktopPlaybackRequestKeepsAnimePaheStreamsDirectForDesktopMPV(t *testing.T) {
	playURL, referer, cookie := desktopPlaybackRequest("animepahe-en", extensions.StreamSource{
		URL:      "https://vault-16.owocdn.top/stream/example/uwu.m3u8",
		Referer:  "https://kwik.cx/e/example",
		Cookie:   "session=abc123",
		Quality:  "1080p",
		Audio:    "sub",
		Language: extensions.LangEnglish,
	})

	if playURL != "https://vault-16.owocdn.top/stream/example/uwu.m3u8" {
		t.Fatalf("expected animepahe desktop playback to stay direct, got %q", playURL)
	}
	if referer != "https://kwik.cx/e/example" {
		t.Fatalf("expected animepahe desktop playback to keep referer intact, got %q", referer)
	}
	if cookie != "session=abc123" {
		t.Fatalf("expected animepahe desktop playback to keep cookie intact, got %q", cookie)
	}
}

func TestDesktopPlaybackRequestLeavesOtherSourcesDirect(t *testing.T) {
	source := extensions.StreamSource{
		URL:      "https://cdn.example/video.mp4",
		Referer:  "https://provider.example/watch",
		Cookie:   "session=abc123",
		Quality:  "1080p",
		Audio:    "sub",
		Language: extensions.LangEnglish,
	}

	playURL, referer, cookie := desktopPlaybackRequest("animeheaven-en", source)
	if playURL != source.URL {
		t.Fatalf("expected non-animepahe desktop playback to stay direct, got %q", playURL)
	}
	if referer != source.Referer {
		t.Fatalf("expected non-animepahe referer to stay intact, got %q", referer)
	}
	if cookie != source.Cookie {
		t.Fatalf("expected non-animepahe cookie to stay intact, got %q", cookie)
	}
}

func TestOpenOnlineEpisodeWithCandidateOpenerStopsEquivalentAnimePaheRetriesAfterEarlyFailure(t *testing.T) {
	candidates := []extensions.StreamSource{
		{
			URL:      "https://vault-16.owocdn.top/stream/example-1080/uwu.m3u8",
			Referer:  "https://animepahe.pw/play/show/episode-1",
			Quality:  "1080p",
			Audio:    "sub",
			Language: extensions.LangEnglish,
		},
		{
			URL:      "https://vault-16.owocdn.top/stream/example-720/uwu.m3u8",
			Referer:  "https://animepahe.pw/play/show/episode-1",
			Quality:  "720p",
			Audio:    "sub",
			Language: extensions.LangEnglish,
		},
	}

	var attempts int
	_, err := openOnlineEpisodeWithCandidateOpener("animepahe-en", "ep-1", 1, "Anime", "Episode 1", 0, candidates, func(playURL, playReferer, playCookie string) error {
		attempts++
		return fmt.Errorf("mpv closed right after launch")
	})
	if err == nil {
		t.Fatal("expected early mpv failure to be returned")
	}
	if attempts != 1 {
		t.Fatalf("expected equivalent animepahe retries to stop after one launch attempt, got %d", attempts)
	}
}

func TestOpenOnlineEpisodeWithCandidateOpenerKeepsFallbackForDistinctCandidates(t *testing.T) {
	candidates := []extensions.StreamSource{
		{
			URL:      "https://vault-16.owocdn.top/stream/example-1080/uwu.m3u8",
			Referer:  "https://animepahe.pw/play/show/episode-1",
			Quality:  "1080p",
			Audio:    "sub",
			Language: extensions.LangEnglish,
		},
		{
			URL:      "https://other-cdn.example/stream/example-720/uwu.m3u8",
			Referer:  "https://animepahe.pw/play/show/episode-1",
			Quality:  "720p",
			Audio:    "sub",
			Language: extensions.LangEnglish,
		},
	}

	var attempts int
	chosen, err := openOnlineEpisodeWithCandidateOpener("animepahe-en", "ep-1", 1, "Anime", "Episode 1", 0, candidates, func(playURL, playReferer, playCookie string) error {
		attempts++
		if attempts == 1 {
			return fmt.Errorf("mpv closed right after launch")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected distinct fallback candidate to still be tried, got error: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected distinct candidate fallback to try twice, got %d attempts", attempts)
	}
	if chosen.URL != candidates[1].URL {
		t.Fatalf("expected second candidate to be chosen, got %q", chosen.URL)
	}
}

func TestAnimeStreamCacheDurationsDisablesLongStaleFallbackForAnimePahe(t *testing.T) {
	cacheTTL, staleTTL := animeStreamCacheDurations("animepahe-en")
	if cacheTTL != 90*time.Second {
		t.Fatalf("expected animepahe hot cache to be 90s, got %v", cacheTTL)
	}
	if staleTTL != 0 {
		t.Fatalf("expected animepahe stale stream fallback to be disabled, got %v", staleTTL)
	}
}

func TestOpenOnlineEpisodeWithCandidateOpenerStopsAnimePaheRetryAcrossAudioVariantsOnSameFamily(t *testing.T) {
	candidates := []extensions.StreamSource{
		{
			URL:      "https://vault-16.owocdn.top/stream/sub/uwu.m3u8",
			Referer:  "https://animepahe.pw/play/show/episode-1",
			Quality:  "1080p",
			Audio:    "sub",
			Language: extensions.LangEnglish,
		},
		{
			URL:      "https://vault-16.owocdn.top/stream/dub/uwu.m3u8",
			Referer:  "https://animepahe.pw/play/show/episode-1",
			Quality:  "1080p",
			Audio:    "dub",
			Language: extensions.LangEnglish,
		},
	}

	var attempts int
	_, err := openOnlineEpisodeWithCandidateOpener("animepahe-en", "ep-1", 1, "Anime", "Episode 1", 0, candidates, func(playURL, playReferer, playCookie string) error {
		attempts++
		return fmt.Errorf("mpv exited before playback became ready")
	})
	if err == nil {
		t.Fatal("expected early mpv failure")
	}
	if attempts != 1 {
		t.Fatalf("expected same-family sub/dub animepahe retry to be suppressed, got %d attempts", attempts)
	}
}
