package animepahe

import (
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"miruro/backend/extensions"
)

func TestLiveSequentialAnimePaheDebug(t *testing.T) {
	if strings.TrimSpace(os.Getenv("NIPAH_LIVE_ANIMEPAHE")) != "1" {
		t.Skip("set NIPAH_LIVE_ANIMEPAHE=1 to run live sequential AnimePahe diagnostics")
	}

	cases := []struct {
		label        string
		query        string
		expectTokens []string
	}{
		{
			label:        "Black Clover",
			query:        "Black Clover",
			expectTokens: []string{"black", "clover"},
		},
		{
			label:        "Angel S2",
			query:        "The Angel Next Door Spoils Me Rotten 2",
			expectTokens: []string{"angel", "season", "2"},
		},
		{
			label:        "Gachiakuta",
			query:        "Gachiakuta",
			expectTokens: []string{"gachiakuta"},
		},
		{
			label:        "Frieren S1",
			query:        "Frieren: Beyond Journey's End",
			expectTokens: []string{"frieren"},
		},
		{
			label:        "Frieren S2",
			query:        "Frieren: Beyond Journey's End Season 2",
			expectTokens: []string{"frieren", "season", "2"},
		},
		{
			label:        "ReZero S4",
			query:        "Re:ZERO -Starting Life in Another World- Season 4",
			expectTokens: []string{"rezero", "season", "4"},
		},
		{
			label:        "ReZero S1",
			query:        "Re:ZERO -Starting Life in Another World-",
			expectTokens: []string{"rezero"},
		},
		{
			label:        "Witch Hat Atelier",
			query:        "Witch Hat Atelier",
			expectTokens: []string{"witch", "hat", "atelier"},
		},
	}

	originalFetch := fetchAnimePaheAPIWithBrowserFallback
	originalCookies := getAnimePaheValidCookies
	defer func() {
		fetchAnimePaheAPIWithBrowserFallback = originalFetch
		getAnimePaheValidCookies = originalCookies
	}()

	fetchAnimePaheAPIWithBrowserFallback = func(rawURL string) (string, error) {
		started := time.Now()
		body, err := originalFetch(rawURL)
		duration := time.Since(started)
		snippet := strings.TrimSpace(body)
		if len(snippet) > 120 {
			snippet = snippet[:120]
		}
		t.Logf("api url=%s duration=%s err=%v body=%q", rawURL, duration.Round(time.Millisecond), err, snippet)
		return body, err
	}

	getAnimePaheValidCookies = func(targetBase string) ([]*http.Cookie, error) {
		started := time.Now()
		cookies, err := originalCookies(targetBase)
		t.Logf("cookies base=%s duration=%s count=%d err=%v", targetBase, time.Since(started).Round(time.Millisecond), len(cookies), err)
		return cookies, err
	}

	ext := New()
	t.Logf("initial active base=%s candidates=%v", animePaheActiveBase, animePaheBaseCandidates())
	for index, tc := range cases {
		t.Logf("---- case %d %s ----", index+1, tc.label)
		searchStarted := time.Now()
		results, err := ext.Search(tc.query, extensions.LangEnglish)
		searchDuration := time.Since(searchStarted)
		if err != nil {
			t.Logf("search label=%s duration=%s err=%v", tc.label, searchDuration.Round(time.Millisecond), err)
			continue
		}
		t.Logf("search label=%s duration=%s results=%d activeBase=%s", tc.label, searchDuration.Round(time.Millisecond), len(results), animePaheActiveBase)
		for i, result := range results {
			if i >= 5 {
				break
			}
			t.Logf("search[%d] id=%s title=%q year=%d", i, result.ID, result.Title, result.Year)
		}

		best := pickDebugResult(results, tc.expectTokens)
		if best == nil {
			t.Logf("episodes label=%s skipped=no matching result", tc.label)
			continue
		}

		episodesStarted := time.Now()
		episodes, episodeErr := ext.GetEpisodes(best.ID)
		episodesDuration := time.Since(episodesStarted)
		if episodeErr != nil {
			t.Logf("episodes label=%s id=%s duration=%s err=%v", tc.label, best.ID, episodesDuration.Round(time.Millisecond), episodeErr)
			continue
		}
		t.Logf("episodes label=%s id=%s duration=%s count=%d activeBase=%s", tc.label, best.ID, episodesDuration.Round(time.Millisecond), len(episodes), animePaheActiveBase)
	}
}

func pickDebugResult(results []extensions.SearchResult, expectTokens []string) *extensions.SearchResult {
	if len(results) == 0 {
		return nil
	}
	if len(expectTokens) == 0 {
		return &results[0]
	}

	bestIndex := -1
	bestScore := -1
	for i := range results {
		score := debugTitleTokenScore(results[i].Title, expectTokens)
		if score > bestScore {
			bestIndex = i
			bestScore = score
		}
	}
	if bestIndex < 0 {
		return &results[0]
	}
	return &results[bestIndex]
}

func debugTitleTokenScore(title string, expectTokens []string) int {
	value := normalizeDebugTitle(title)
	score := 0
	for _, token := range expectTokens {
		if strings.Contains(value, normalizeDebugTitle(token)) {
			score++
		}
	}
	return score
}

func normalizeDebugTitle(value string) string {
	replacer := strings.NewReplacer(
		":", " ",
		";", " ",
		"-", " ",
		"_", " ",
		".", " ",
		"'", "",
		"(", " ",
		")", " ",
	)
	return strings.Join(strings.Fields(strings.ToLower(replacer.Replace(value))), " ")
}
