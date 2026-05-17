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

func TestAnimeHeavenEpisodeRegexMatchesCurrentLiveMarkup(t *testing.T) {
	body := `<a class='c' onmouseover='gateh("9afa9f35e6d3e9a8ace536a14ac2a266")' onclick='gatea("9afa9f35e6d3e9a8ace536a14ac2a266")'  id="9afa9f35e6d3e9a8ace536a14ac2a266" href='gate.php'><div class='trackep0 watch bc2'><div class='trackep watchb bc'><div class='watch1 bc c'>Episode</div><div class='watch2 bc '>220</div><div class='watch1 bc c'>1062 d ago</div></div></div></a>`

	match := epLinkRe.FindStringSubmatch(body)
	if len(match) < 3 {
		t.Fatalf("expected current AnimeHeaven episode markup to match regex, got no match")
	}
	if match[1] != "9afa9f35e6d3e9a8ace536a14ac2a266" {
		t.Fatalf("expected gate key to be captured, got %q", match[1])
	}
	if match[2] != "220" {
		t.Fatalf("expected episode number to be captured, got %q", match[2])
	}
}
