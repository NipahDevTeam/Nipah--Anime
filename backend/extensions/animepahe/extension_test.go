package animepahe

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"miruro/backend/extensions"
)

func TestExtractKwikURLsDetectsExplicitAudioLabels(t *testing.T) {
	body := `
	<div class="dropdown-menu">
		<a class="dropdown-item" data-src="https://kwik.cx/e/sub720">JPN &middot; 720p</a>
		<a class="dropdown-item" data-src="https://kwik.cx/e/dub1080">ENG &middot; 1080p</a>
	</div>
	`

	entries := extractAnimePaheKwikEntries(body)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	byURL := map[string]kwikEntry{}
	for _, entry := range entries {
		byURL[entry.url] = entry
	}

	if got := byURL["https://kwik.cx/e/sub720"].audio; got != "sub" {
		t.Fatalf("expected sub audio label, got %q", got)
	}
	if got := byURL["https://kwik.cx/e/sub720"].quality; got != "720p" {
		t.Fatalf("expected 720p quality, got %q", got)
	}
	if got := byURL["https://kwik.cx/e/dub1080"].audio; got != "dub" {
		t.Fatalf("expected dub audio label, got %q", got)
	}
	if got := byURL["https://kwik.cx/e/dub1080"].quality; got != "1080p" {
		t.Fatalf("expected 1080p quality, got %q", got)
	}
}

func TestExtractKwikURLsDetectsNestedAudioLabels(t *testing.T) {
	body := `
	<ul class="quality-list">
		<li>
			<button type="button" data-src="https://kwik.cx/e/sub480">
				<span class="audio-pill">Japanese</span>
				<span class="quality-pill">480p</span>
			</button>
		</li>
		<li>
			<button type="button" data-src="https://kwik.cx/e/dub720">
				<span class="audio-pill">ENG</span>
				<span class="quality-pill">720p</span>
			</button>
		</li>
	</ul>
	`

	entries := extractAnimePaheKwikEntries(body)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	byURL := map[string]kwikEntry{}
	for _, entry := range entries {
		byURL[entry.url] = entry
	}

	if got := byURL["https://kwik.cx/e/sub480"].audio; got != "sub" {
		t.Fatalf("expected nested sub audio label, got %q", got)
	}
	if got := byURL["https://kwik.cx/e/sub480"].quality; got != "480p" {
		t.Fatalf("expected nested 480p quality, got %q", got)
	}
	if got := byURL["https://kwik.cx/e/dub720"].audio; got != "dub" {
		t.Fatalf("expected nested dub audio label, got %q", got)
	}
	if got := byURL["https://kwik.cx/e/dub720"].quality; got != "720p" {
		t.Fatalf("expected nested 720p quality, got %q", got)
	}
}

func TestNormalizeAnimePaheKwikEntriesTreatsUnknownEntriesAsSubWhenDubExists(t *testing.T) {
	entries := normalizeAnimePaheKwikEntries([]kwikEntry{
		{url: "https://kwik.cx/e/sub360", quality: "360p"},
		{url: "https://kwik.cx/e/sub720", quality: "720p"},
		{url: "https://kwik.cx/e/dub1080", quality: "1080p", audio: "dub"},
	})

	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0].audio != "sub" {
		t.Fatalf("expected first unlabeled entry to normalize as sub, got %q", entries[0].audio)
	}
	if entries[1].audio != "sub" {
		t.Fatalf("expected second unlabeled entry to normalize as sub, got %q", entries[1].audio)
	}
	if entries[2].audio != "dub" {
		t.Fatalf("expected explicit dub label to remain dub, got %q", entries[2].audio)
	}

	variants := animePaheAudioVariants(entries)
	if !variants["sub"] || !variants["dub"] {
		t.Fatalf("expected both sub and dub variants, got %#v", variants)
	}
}

func TestGetEpisodesFetchesRemainingPagesConcurrentlyAfterFirstPage(t *testing.T) {
	originalFetchAPIWithBrowserFallback := fetchAnimePaheAPIWithBrowserFallback
	defer func() {
		fetchAnimePaheAPIWithBrowserFallback = originalFetchAPIWithBrowserFallback
	}()

	pageTwoRequested := make(chan struct{}, 1)
	pageThreeRequested := make(chan struct{}, 1)
	releaseBlockedPages := make(chan struct{})

	fetchAnimePaheAPIWithBrowserFallback = func(rawURL string) (string, error) {
		switch {
		case strings.Contains(rawURL, "page=1"):
			return `{"current_page":1,"last_page":3,"data":[{"episode":1,"session":"ep1"},{"episode":2,"session":"ep2"}]}`, nil
		case strings.Contains(rawURL, "page=2"):
			pageTwoRequested <- struct{}{}
			<-releaseBlockedPages
			return `{"current_page":2,"last_page":3,"data":[{"episode":3,"session":"ep3"},{"episode":4,"session":"ep4"}]}`, nil
		case strings.Contains(rawURL, "page=3"):
			pageThreeRequested <- struct{}{}
			<-releaseBlockedPages
			return `{"current_page":3,"last_page":3,"data":[{"episode":5,"session":"ep5"}]}`, nil
		default:
			return "", fmt.Errorf("unexpected url %s", rawURL)
		}
	}

	done := make(chan []extensions.Episode, 1)
	errCh := make(chan error, 1)
	go func() {
		episodes, err := New().GetEpisodes("anime-session")
		if err != nil {
			errCh <- err
			return
		}
		done <- episodes
	}()

	select {
	case <-pageTwoRequested:
	case err := <-errCh:
		t.Fatalf("get episodes failed before second page request: %v", err)
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for second page request")
	}

	select {
	case <-pageThreeRequested:
	case err := <-errCh:
		t.Fatalf("get episodes failed before third page request: %v", err)
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("expected third page request to be issued without waiting for page two to finish")
	}

	close(releaseBlockedPages)

	select {
	case episodes := <-done:
		if len(episodes) != 5 {
			t.Fatalf("expected 5 episodes after concurrent fetch, got %d", len(episodes))
		}
		if episodes[0].Number != 1 || episodes[len(episodes)-1].Number != 5 {
			t.Fatalf("expected ascending episode list, got %#v", episodes)
		}
	case err := <-errCh:
		t.Fatalf("get episodes returned error: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for episodes result")
	}
}
