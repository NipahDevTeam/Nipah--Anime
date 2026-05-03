package metadata

import (
	"fmt"
	"strings"
	"testing"
	"time"
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

func TestAniListRateLimitBackoffIncreasesByAttempt(t *testing.T) {
	first := aniListRateLimitBackoff(0)
	second := aniListRateLimitBackoff(1)
	third := aniListRateLimitBackoff(2)

	if first < 5*time.Second {
		t.Fatalf("expected first AniList rate limit backoff to be at least 5s, got %s", first)
	}
	if second <= first {
		t.Fatalf("expected second AniList rate limit backoff %s to exceed first %s", second, first)
	}
	if third <= second {
		t.Fatalf("expected third AniList rate limit backoff %s to exceed second %s", third, second)
	}
}

func TestIsRetryableAniListErrorTreats429AsRetryable(t *testing.T) {
	if !IsRetryableAniListError(fmt.Errorf("metadata request failed:429 (Too Many Requests.)")) {
		t.Fatalf("expected AniList 429 errors to be retryable")
	}
}
