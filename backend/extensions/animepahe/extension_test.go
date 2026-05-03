package animepahe

import "testing"

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
