package animeheaven

import (
	"slices"
	"testing"
)

func TestAnimeHeavenSearchQueriesAddsSequelAwareFallbacks(t *testing.T) {
	queries := animeHeavenSearchQueries("Attack on Titan: The Final Season Part 2")

	for _, expected := range []string{
		"Attack on Titan: The Final Season Part 2",
		"Attack on Titan The Final Season Part 2",
		"Attack on Titan The Final Season",
	} {
		if !slices.Contains(queries, expected) {
			t.Fatalf("expected query variant %q in %#v", expected, queries)
		}
	}
}

func TestAnimeHeavenSearchQueriesDedupesEquivalentVariants(t *testing.T) {
	queries := animeHeavenSearchQueries("Solo Leveling Part 2")
	seen := map[string]bool{}

	for _, query := range queries {
		if seen[query] {
			t.Fatalf("expected deduped query variants, got duplicate %q in %#v", query, queries)
		}
		seen[query] = true
	}
}
