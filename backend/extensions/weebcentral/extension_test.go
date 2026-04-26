package weebcentral

import (
	"testing"
	"time"

	"miruro/backend/extensions"
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

func TestGetChapterCacheStateReturnsPartialHydratingFlags(t *testing.T) {
	const seriesID = "01/cache-state-series"
	storeSeriesChaptersWithState(seriesID, []extensions.Chapter{{ID: "c1", Number: 1}}, chapterCacheTTL, true, true)
	t.Cleanup(func() {
		chapterMu.Lock()
		delete(chapterCache, seriesID)
		chapterMu.Unlock()
	})

	partial, hydrating := GetChapterCacheState(seriesID)
	if !partial || !hydrating {
		t.Fatalf("expected partial hydrating cache state, got partial=%v hydrating=%v", partial, hydrating)
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

func TestAwaitHydratedSeriesChaptersWaitsForFullList(t *testing.T) {
	ready := make(chan []extensions.Chapter, 1)
	go func() {
		time.Sleep(20 * time.Millisecond)
		ready <- []extensions.Chapter{{ID: "c2", Number: 2}}
		close(ready)
	}()

	chapters, ok, waited := awaitHydratedSeriesChapters(ready, 5*time.Millisecond)
	if !ok {
		t.Fatalf("expected hydrated chapter list")
	}
	if !waited {
		t.Fatalf("expected wait path when hydration exceeds fast window")
	}
	if len(chapters) != 1 || chapters[0].Number != 2 {
		t.Fatalf("expected hydrated full list after waiting, got %#v", chapters)
	}
}
