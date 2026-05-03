package weebcentral

import (
	"strings"
	"testing"

	"miruro/backend/extensions"
	"miruro/backend/extensions/sourceaccess"
)

func TestScoreValueMatchesCompactSpacingVariants(t *testing.T) {
	query := normalizeSearch("Jirai nan desu ka Chihara san")
	score := scoreValue(query, "Jirai nandesu ka Chihara-san")
	if score < 390 {
		t.Fatalf("expected compact spacing variant to rank strongly, got %d", score)
	}
}

func TestRankInventoryPrefersCompactAliasMatch(t *testing.T) {
	results := rankInventory([]string{
		"01/other-series",
		"02/jirai-nandesu-ka-chihara-san",
	}, "Jirai nan desu ka Chihara san")
	if len(results) == 0 {
		t.Fatalf("expected ranked results")
	}
	if results[0].ID != "02/jirai-nandesu-ka-chihara-san" {
		t.Fatalf("expected compact alias match first, got %#v", results)
	}
}

func TestMergeWeebCentralChaptersDedupesAndSorts(t *testing.T) {
	primary := []extensions.Chapter{
		{ID: "c3", Number: 3},
		{ID: "c1", Number: 1},
	}
	secondary := []extensions.Chapter{
		{ID: "c2", Number: 2},
		{ID: "c3", Number: 3},
	}

	merged := mergeWeebCentralChapters(primary, secondary)
	if len(merged) != 3 {
		t.Fatalf("expected 3 merged chapters, got %d (%#v)", len(merged), merged)
	}
	if merged[0].Number != 1 || merged[1].Number != 2 || merged[2].Number != 3 {
		t.Fatalf("expected merged chapters sorted 1,2,3 got %#v", merged)
	}
}

func TestGetChaptersPromotesPartialCacheViaRefetch(t *testing.T) {
	const seriesID = "01/partial-cache-series"
	storeSeriesChaptersWithState(seriesID, []extensions.Chapter{{ID: "c77", Number: 77}}, chapterCacheTTL, true, false)
	t.Cleanup(func() {
		chapterMu.Lock()
		delete(chapterCache, seriesID)
		chapterMu.Unlock()
	})
	originalFetchHTML := fetchHTMLFn
	fetchCalls := 0
	fetchHTMLFn = func(source, url string, options sourceaccess.RequestOptions) (string, error) {
		fetchCalls++
		switch {
		case strings.Contains(url, "/full-chapter-list"):
			return `
				<a href="https://weebcentral.com/chapters/partial-cache-series-chapter-1"><span>Chapter 1</span></a>
				<a href="https://weebcentral.com/chapters/partial-cache-series-chapter-2"><span>Chapter 2</span></a>
			`, nil
		default:
			return `<a href="https://weebcentral.com/chapters/partial-cache-series-chapter-2"><span>Chapter 2</span></a>`, nil
		}
	}
	t.Cleanup(func() { fetchHTMLFn = originalFetchHTML })

	chapters, err := New().GetChapters(seriesID, extensions.LangEnglish)
	if err != nil {
		t.Fatalf("expected partial cache to be promotable, got error %v", err)
	}
	if fetchCalls == 0 {
		t.Fatalf("expected stale partial cache to trigger a refetch")
	}
	if len(chapters) != 2 || chapters[0].Number != 1 || chapters[1].Number != 2 {
		t.Fatalf("expected promoted full chapter list, got %#v", chapters)
	}
}

func TestGetChaptersRejectsTeaserOnlyWhenShowAllIsPresent(t *testing.T) {
	const seriesID = "01/teaser-only-series"
	t.Cleanup(func() {
		chapterMu.Lock()
		delete(chapterCache, seriesID)
		chapterMu.Unlock()
	})
	originalFetchHTML := fetchHTMLFn
	fetchHTMLFn = func(source, url string, options sourceaccess.RequestOptions) (string, error) {
		switch {
		case strings.Contains(url, "/full-chapter-list"):
			return `
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-200"><span>Chapter 200</span></a>
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-3"><span>Chapter 3</span></a>
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-2"><span>Chapter 2</span></a>
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-1"><span>Chapter 1</span></a>
			`, nil
		default:
			return `
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-200"><span>Chapter 200</span></a>
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-3"><span>Chapter 3</span></a>
				Show All Chapters
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-2"><span>Chapter 2</span></a>
				<a href="https://weebcentral.com/chapters/teaser-only-series-chapter-1"><span>Chapter 1</span></a>
			`, nil
		}
	}
	t.Cleanup(func() { fetchHTMLFn = originalFetchHTML })

	if _, err := New().GetChapters(seriesID, extensions.LangEnglish); err == nil {
		t.Fatalf("expected teaser-only full-list payload to be rejected")
	}
}

func TestBestContiguousTeaserSlicePrefersSingleRun(t *testing.T) {
	teaser := []extensions.Chapter{
		{ID: "c1", Number: 1},
		{ID: "c2", Number: 2},
		{ID: "c3", Number: 3},
		{ID: "c1173", Number: 1173},
		{ID: "c1174", Number: 1174},
		{ID: "c1175", Number: 1175},
		{ID: "c1176", Number: 1176},
	}

	trimmed := bestContiguousTeaserSlice(teaser)
	if len(trimmed) != 4 {
		t.Fatalf("expected longest contiguous run, got %#v", trimmed)
	}
	if trimmed[0].Number != 1173 || trimmed[len(trimmed)-1].Number != 1176 {
		t.Fatalf("expected latest contiguous run, got %#v", trimmed)
	}
}
