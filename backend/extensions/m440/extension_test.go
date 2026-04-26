package m440

import (
	"testing"

	"miruro/backend/extensions"
)

func TestParseSearchJSONDedupesAndBuildsIDs(t *testing.T) {
	body := `[{"value":"Naruto","data":"naruto"},{"value":"Naruto","data":"naruto"},{"value":"Bleach","data":"bleach"}]`
	results := parseSearchJSON(body)

	if len(results) != 2 {
		t.Fatalf("expected 2 unique results, got %d (%#v)", len(results), results)
	}
	if results[0].ID != "/manga/naruto" || results[1].ID != "/manga/bleach" {
		t.Fatalf("unexpected search IDs: %#v", results)
	}
}

func TestExtractHTMLChaptersFiltersSlugAndSortsAscending(t *testing.T) {
	body := `
		<a href="/manga/one-piece/2-abc">Two</a>
		<a href="/manga/other-series/99-z">Skip</a>
		<a href="one-piece/1-def">One</a>
		<a href="/manga/one-piece/10-ghi">Ten</a>
	`

	chapters := extractHTMLChapters(body, "one-piece")
	if len(chapters) != 3 {
		t.Fatalf("expected 3 chapters, got %d (%#v)", len(chapters), chapters)
	}
	if chapters[0].Number != 1 || chapters[1].Number != 2 || chapters[2].Number != 10 {
		t.Fatalf("expected ascending chapters 1,2,10 got %#v", chapters)
	}
}

func TestParseChapterPayloadsSortsAscending(t *testing.T) {
	raw := `[
		{"slug":"10-final","name":"Final","number":"10","created_at":"2026-01-03"},
		{"slug":"2-second","name":"Second","number":"2","created_at":"2026-01-02"},
		{"slug":"1-first","name":"First","number":"1","created_at":"2026-01-01"}
	]`

	chapters := parseChapterPayloads(raw, "one-piece")
	if len(chapters) != 3 {
		t.Fatalf("expected 3 chapters, got %d", len(chapters))
	}
	if chapters[0].Number != 1 || chapters[1].Number != 2 || chapters[2].Number != 10 {
		t.Fatalf("expected ascending chapter order, got %#v", chapters)
	}
}

func TestAssessHTMLChapterCompletenessRejectsTeaserMarkers(t *testing.T) {
	chapters := []extensions.Chapter{
		{Number: 1},
		{Number: 120},
	}
	body := `<section><h2>Capitulos recientes</h2></section>`

	result := assessHTMLChapterCompleteness(body, chapters)
	if !result.requiresBrowser || result.mode != "html_truncated" {
		t.Fatalf("expected teaser list to require browser fallback, got %#v", result)
	}
}

func TestAssessHTMLChapterCompletenessAcceptsDenseSmallSet(t *testing.T) {
	chapters := []extensions.Chapter{
		{Number: 1},
		{Number: 2},
		{Number: 3},
	}
	body := `<div class="chapter-list"><a href="/manga/one-piece/1-a">1</a></div>`

	result := assessHTMLChapterCompleteness(body, chapters)
	if result.requiresBrowser || result.mode != "html_complete" {
		t.Fatalf("expected dense chapter set to stay on HTML path, got %#v", result)
	}
}

func TestParseRenderedChapterListReadsRenderedAnchors(t *testing.T) {
	body := `
		<li><h5>#69 ?<a class="ukqXlpyvcretClpmjHgdplcL" href="https://m440.in/manga/returners-magic/69-hz3n8"><em>Capitulo 69</em></a></h5></li>
		<li><h5>#1 ?<a class="ukqXlpyvcretClpmjHgdplcL" href="https://m440.in/manga/returners-magic/1-ginnj"><em>Capitulo 1</em></a></h5></li>
	`

	chapters := parseRenderedChapterList(body, "returners-magic")
	if len(chapters) != 2 {
		t.Fatalf("expected 2 rendered chapters, got %d (%#v)", len(chapters), chapters)
	}
	if chapters[0].Number != 1 || chapters[1].Number != 69 {
		t.Fatalf("expected ascending rendered chapters, got %#v", chapters)
	}
	if chapters[1].Title != "Capitulo 69" {
		t.Fatalf("expected rendered title, got %#v", chapters[1])
	}
}

func TestParseChapterNumberHandlesSpanishChapterSlugs(t *testing.T) {
	cases := map[string]float64{
		"69-hz3n8":           69,
		"capitulo-69-hz3n8":  69,
		"chapter_12.5-final": 12.5,
		"episodio-7":         7,
	}

	for raw, want := range cases {
		if got := parseChapterNumber(raw); got != want {
			t.Fatalf("expected %q to parse as %g, got %g", raw, want, got)
		}
	}
}

func TestExtractHTMLChaptersParsesChapterLabelsInSlug(t *testing.T) {
	body := `
		<a href="/manga/one-piece/capitulo-2-abc">Capitulo 2</a>
		<a href="/manga/one-piece/chapter-10-def">Capitulo 10</a>
	`

	chapters := extractHTMLChapters(body, "one-piece")
	if len(chapters) != 2 {
		t.Fatalf("expected 2 chapters, got %d (%#v)", len(chapters), chapters)
	}
	if chapters[0].Number != 2 || chapters[1].Number != 10 {
		t.Fatalf("expected chapter numbers 2 and 10, got %#v", chapters)
	}
}

func TestGetChapterCacheStateReturnsPartialHydratingFlags(t *testing.T) {
	const slug = "cache-state-series"
	storeChapterCacheWithState(slug, []extensions.Chapter{{ID: "/manga/cache-state-series/1-a", Number: 1}}, chapterCacheTTL, true, true)
	t.Cleanup(func() {
		chapterCacheMu.Lock()
		delete(chapterCache, slug)
		chapterCacheMu.Unlock()
	})

	partial, hydrating := GetChapterCacheState("/manga/" + slug)
	if !partial || !hydrating {
		t.Fatalf("expected partial hydrating cache state, got partial=%v hydrating=%v", partial, hydrating)
	}
}

func TestGetChaptersPrefersBrowserFullCacheOverPartialCache(t *testing.T) {
	const slug = "browser-cache-series"
	storeChapterCacheWithState(slug, []extensions.Chapter{{ID: "/manga/browser-cache-series/99-a", Number: 99}}, chapterCacheTTL, true, true)
	storeBrowserChapterCache(slug, []extensions.Chapter{
		{ID: "/manga/browser-cache-series/1-a", Number: 1},
		{ID: "/manga/browser-cache-series/2-b", Number: 2},
	}, browserChapterCacheTTL)
	t.Cleanup(func() {
		chapterCacheMu.Lock()
		delete(chapterCache, slug)
		chapterCacheMu.Unlock()
		browserCacheMu.Lock()
		delete(browserChapterCache, slug)
		browserCacheMu.Unlock()
	})

	chapters, err := New().GetChapters("/manga/"+slug, extensions.LangSpanish)
	if err != nil {
		t.Fatalf("expected browser cache to satisfy request, got error %v", err)
	}
	if len(chapters) != 2 {
		t.Fatalf("expected full chapter list from browser cache, got %#v", chapters)
	}
	if chapters[0].Number != 1 || chapters[1].Number != 2 {
		t.Fatalf("expected ascending full browser-backed list, got %#v", chapters)
	}
}
