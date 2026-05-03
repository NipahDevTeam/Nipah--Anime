package main

import (
	"testing"

	"miruro/backend/db"
	"miruro/backend/extensions"
)

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestBuildExpandedMangaTitleVariantsNormalizesDecoratedTitles(t *testing.T) {
	variants := buildExpandedMangaTitleVariants("【OSHI NO KO】")
	if !containsString(variants, "OSHI NO KO") {
		t.Fatalf("expected normalized decorated title variant, got %v", variants)
	}
}

func TestBuildExpandedMangaTitleVariantsKeepsSeasonSafeBases(t *testing.T) {
	variants := buildExpandedMangaTitleVariants("JUJUTSU KAISEN Season 3: The Culling Game Part 1")
	if !containsString(variants, "JUJUTSU KAISEN Season 3") {
		t.Fatalf("expected season base variant, got %v", variants)
	}
	if !containsString(variants, "JUJUTSU KAISEN") {
		t.Fatalf("expected series base variant, got %v", variants)
	}
}

func TestBuildExpandedMangaTitleVariantsAddsCompactSpacingVariant(t *testing.T) {
	variants := buildExpandedMangaTitleVariants("Jirai nan desu ka? Chihara-san")
	if !containsString(variants, "Jirai nandesu ka Chihara-san") {
		t.Fatalf("expected compact spacing variant, got %v", variants)
	}
}

func TestScoreMangaTitleAgainstNeedlesMatchesCompactSpacing(t *testing.T) {
	score := scoreMangaTitleAgainstNeedles("Jirai nandesu ka? Chihara-san", []string{"Jirai nan desu ka Chihara san"})
	if score < 98 {
		t.Fatalf("expected compact spacing match score, got %d", score)
	}
}

func TestPrioritizeMangaIdentityQueriesPrefersTrustedNeedlesWithinBudget(t *testing.T) {
	base := []string{
		"The Knight Who Only Lives Today",
		"the knight who only lives today",
		"the knight who only lives today",
		"the knight who only lives today volume 1",
	}
	extra := []string{
		"The Knight Only Lives Today",
		"Eternally Regressing Knight",
	}

	queries := prioritizeMangaIdentityQueries(base, extra, 4)
	if len(queries) != 4 {
		t.Fatalf("expected 4 prioritized queries, got %d (%v)", len(queries), queries)
	}
	if queries[0] != "The Knight Only Lives Today" {
		t.Fatalf("expected canonical AniList title first, got %v", queries)
	}
	if queries[1] != "Eternally Regressing Knight" {
		t.Fatalf("expected trusted synonym second, got %v", queries)
	}
	if !containsString(queries, "The Knight Who Only Lives Today") {
		t.Fatalf("expected source wording to remain available, got %v", queries)
	}
}

func TestShouldPreferMangaSourceMatchPrefersBaseTitleOnEqualConfidence(t *testing.T) {
	needles := []string{"A Returner's Magic Should Be Special"}
	if !shouldPreferMangaSourceMatch(0.92, "A Returner's Magic Should Be Special", needles, 0.92, "A Returner's Magic Should Be Special Part 1") {
		t.Fatalf("expected base title to beat decorated variant on equal confidence")
	}
}

func TestCanStopMangaSourceResolveEarlyRequiresStrongExactishMatch(t *testing.T) {
	needles := []string{"A Returner's Magic Should Be Special"}
	if !canStopMangaSourceResolveEarly(0.93, "A Returner's Magic Should Be Special", needles) {
		t.Fatalf("expected strong exact title match to stop early")
	}
	if canStopMangaSourceResolveEarly(0.85, "A Returner's Magic Should Be Special", needles) {
		t.Fatalf("did not expect low confidence match to stop early")
	}
	if canStopMangaSourceResolveEarly(0.93, "A Returner's Magic Should Be Special Part 1", needles) {
		t.Fatalf("did not expect decorated variant to stop early")
	}
}

func TestPrioritizeMangaSourceVerificationCandidatesPrefersExactBaseTitle(t *testing.T) {
	results := []extensions.SearchResult{
		{ID: "gakuen", Title: "One Piece Gakuen"},
		{ID: "base", Title: "One Piece"},
		{ID: "episode-a", Title: "One Piece Episode A"},
	}

	prioritized := prioritizeMangaSourceVerificationCandidates(results, []string{"One Piece"})
	if len(prioritized) != 1 {
		t.Fatalf("expected exact title to collapse candidate set to 1, got %d", len(prioritized))
	}
	if prioritized[0].ID != "base" {
		t.Fatalf("expected exact base title first, got %#v", prioritized)
	}
}

func TestCanTrustMangaSourceTitleDirectlyOnlyForExactUndecoratedMatch(t *testing.T) {
	needles := []string{"One Piece"}
	if !canTrustMangaSourceTitleDirectly("One Piece", needles) {
		t.Fatalf("expected exact base title to be trusted directly")
	}
	if canTrustMangaSourceTitleDirectly("One Piece Gakuen", needles) {
		t.Fatalf("did not expect decorated spin-off title to be trusted directly")
	}
}

func TestSelectBestCachedMangaSourceMapForSourcePrefersCurrentGeneration(t *testing.T) {
	entries := []db.OnlineMangaSourceMap{
		{
			SourceID:           "m440-es",
			SourceMangaID:      "/manga/one-piece",
			SourceTitle:        "One Piece",
			AniListID:          30013,
			MatchedTitle:       "One Piece",
			Confidence:         0.91,
			ResolverGeneration: "2026-03-28-perf-audit-1",
		},
		{
			SourceID:           "m440-es",
			SourceMangaID:      "/manga/one-piece-remaster",
			SourceTitle:        "One Piece",
			AniListID:          30013,
			MatchedTitle:       "One Piece",
			Confidence:         0.95,
			ResolverGeneration: currentMangaResolverGeneration(),
		},
	}

	match, origin := selectBestCachedMangaSourceMapForSource(entries, "m440-es")
	if match == nil {
		t.Fatalf("expected cached match")
	}
	if origin != "current" {
		t.Fatalf("expected current-generation match, got %q", origin)
	}
	if match.SourceMangaID != "/manga/one-piece-remaster" {
		t.Fatalf("expected current-generation source id, got %#v", match)
	}
}

func TestSelectBestCachedMangaSourceMapForSourceFallsBackToLegacyPlausibleMatch(t *testing.T) {
	entries := []db.OnlineMangaSourceMap{
		{
			SourceID:           "m440-es",
			SourceMangaID:      "/manga/forest-mission",
			SourceTitle:        "Forest Mission",
			AniListID:          30013,
			MatchedTitle:       "One Piece",
			Confidence:         1.0,
			ResolverGeneration: currentMangaResolverGeneration(),
		},
		{
			SourceID:           "m440-es",
			SourceMangaID:      "/manga/one-piece",
			SourceTitle:        "One Piece",
			AniListID:          30013,
			MatchedTitle:       "One Piece",
			Confidence:         0.92,
			ResolverGeneration: "2026-03-28-perf-audit-1",
		},
	}

	match, origin := selectBestCachedMangaSourceMapForSource(entries, "m440-es")
	if match == nil {
		t.Fatalf("expected fallback cached match")
	}
	if origin != "legacy" {
		t.Fatalf("expected legacy fallback, got %q", origin)
	}
	if match.SourceMangaID != "/manga/one-piece" {
		t.Fatalf("expected plausible legacy source id, got %#v", match)
	}
}

func TestSelectBestCachedMangaSourceMapsBySourceSkipsImplausibleCurrentGeneration(t *testing.T) {
	entries := []db.OnlineMangaSourceMap{
		{
			SourceID:           "m440-es",
			SourceMangaID:      "/manga/flan-napolitano",
			SourceTitle:        "Flan Napolitano",
			AniListID:          30013,
			MatchedTitle:       "One Piece",
			Confidence:         1.0,
			ResolverGeneration: currentMangaResolverGeneration(),
		},
		{
			SourceID:           "m440-es",
			SourceMangaID:      "/manga/one-piece",
			SourceTitle:        "One Piece",
			AniListID:          30013,
			MatchedTitle:       "One Piece",
			Confidence:         0.9,
			ResolverGeneration: "2026-03-28-perf-audit-1",
		},
		{
			SourceID:           "weebcentral-en",
			SourceMangaID:      "/series/reincarnated-murim-lord",
			SourceTitle:        "Reincarnated Murim Lord",
			AniListID:          176790,
			MatchedTitle:       "Reincarnated Murim Lord",
			Confidence:         0.99,
			ResolverGeneration: currentMangaResolverGeneration(),
		},
	}

	matches := selectBestCachedMangaSourceMapsBySource(entries)
	if len(matches) != 2 {
		t.Fatalf("expected two per-source matches, got %#v", matches)
	}
	if got := matches["m440-es"].SourceMangaID; got != "/manga/one-piece" {
		t.Fatalf("expected plausible legacy manga source, got %q", got)
	}
	if got := matches["weebcentral-en"].SourceMangaID; got != "/series/reincarnated-murim-lord" {
		t.Fatalf("expected current weebcentral mapping, got %q", got)
	}
}
