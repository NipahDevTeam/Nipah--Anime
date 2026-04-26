package metadata

import (
	"strings"
	"testing"
)

func TestAnimeRequestedSeasonAdjustment(t *testing.T) {
	query := "Re:Zero Season 3"

	matching := animeRequestedSeasonAdjustment(query, "Re:ZERO -Starting Life in Another World- Season 3")
	base := animeRequestedSeasonAdjustment(query, "Re:ZERO -Starting Life in Another World-")
	wrong := animeRequestedSeasonAdjustment(query, "Re:ZERO -Starting Life in Another World- Season 2")

	if matching <= base {
		t.Fatalf("expected matching season score %d to beat base score %d", matching, base)
	}
	if matching <= wrong {
		t.Fatalf("expected matching season score %d to beat wrong season score %d", matching, wrong)
	}
}

func TestBuildAnimeSearchQueriesHandlesSeasonZeroPaddedFolderNames(t *testing.T) {
	query := "ReZero kara Hajimeru Isekai Seikatsu (ReZero - Starting Life in Another World) (Season 03)"
	queries := buildAnimeSearchQueries(query)

	joined := strings.Join(queries, " || ")
	for _, expected := range []string{
		"Season 3",
		"3rd Season",
		"ReZero - Starting Life in Another World",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected %q in generated queries, got %q", expected, joined)
		}
	}
}
