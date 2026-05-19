package metadata

import (
	"fmt"
	"net/http"
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

func TestReserveAniListTurnSerializesConcurrentReservations(t *testing.T) {
	manager := NewManager()
	now := time.Date(2026, time.May, 4, 12, 0, 0, 0, time.UTC)

	first := manager.reserveAniListTurn(now)
	second := manager.reserveAniListTurn(now)
	third := manager.reserveAniListTurn(now.Add(100 * time.Millisecond))

	if !first.Equal(now) {
		t.Fatalf("expected first AniList reservation at %s, got %s", now, first)
	}
	if want := now.Add(aniListTurnDelay); !second.Equal(want) {
		t.Fatalf("expected second AniList reservation at %s, got %s", want, second)
	}
	if want := now.Add(2 * aniListTurnDelay); !third.Equal(want) {
		t.Fatalf("expected third AniList reservation at %s, got %s", want, third)
	}
}

func TestAniListDegradationActivatesAfterRetryableBurst(t *testing.T) {
	manager := NewManager()

	manager.noteAniListInstability(fmt.Errorf("metadata request failed: 429 (Too Many Requests.)"))
	if manager.shouldUseJikanFallback(time.Now()) {
		t.Fatalf("expected first retryable AniList instability to stay below fallback threshold")
	}

	manager.noteAniListInstability(fmt.Errorf("metadata request failed: 429 (Too Many Requests.)"))
	if !manager.shouldUseJikanFallback(time.Now()) {
		t.Fatalf("expected repeated retryable AniList instability to activate Jikan fallback")
	}
}

func TestAniListDegradationSkipsNonAniListErrors(t *testing.T) {
	manager := NewManager()

	manager.noteAniListInstability(fmt.Errorf("plain network blip"))
	manager.noteAniListInstability(fmt.Errorf("plain network blip"))
	if manager.shouldUseJikanFallback(time.Now()) {
		t.Fatalf("expected non-AniList instability errors to avoid activating Jikan fallback")
	}
}

func TestAniListDegradationRecoversAfterCooldownAndSuccess(t *testing.T) {
	manager := NewManager()

	manager.noteAniListInstability(fmt.Errorf("metadata request failed: 429 (Too Many Requests.)"))
	manager.noteAniListInstability(fmt.Errorf("metadata request failed: 429 (Too Many Requests.)"))
	if !manager.shouldUseJikanFallback(time.Now()) {
		t.Fatalf("expected fallback to activate before recovery")
	}

	manager.mu.Lock()
	manager.aniListDegradedUntil = time.Now().Add(-time.Minute)
	manager.mu.Unlock()

	manager.noteAniListRecovery(time.Now())
	if manager.shouldUseJikanFallback(time.Now()) {
		t.Fatalf("expected successful AniList recovery after cooldown to disable fallback")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
