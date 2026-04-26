package library

import (
	"path/filepath"
	"testing"
)

func TestParseEpisodeNumberHandlesSeasonAndVersionNoise(t *testing.T) {
	tests := []struct {
		filename string
		want     float64
	}{
		{"[SubsPlease] Re_Zero_S03E07_1080p.mkv", 7},
		{"Re Zero kara Hajimeru Isekai Seikatsu 3rd Season - 12 [1080p][v2].mkv", 12},
		{"Re_Zero_-_Episode_03.mkv", 3},
		{"Ichigo Mashimaro EP01.mkv", 1},
		{"Ichigo Mashimaro 01.mkv", 1},
	}

	for _, tc := range tests {
		got := parseEpisodeNumber(tc.filename)
		if got != tc.want {
			t.Fatalf("%q: got %v, want %v", tc.filename, got, tc.want)
		}
	}
}

func TestResolveAnimeRootPathTreatsSpecialSubfoldersAsSingleAnime(t *testing.T) {
	scanRoot := filepath.Join("library", "Ichigo Mashimaro")
	filePath := filepath.Join(scanRoot, "OVA", "EP01.mkv")

	got := resolveAnimeRootPath(filePath, scanRoot, true)
	if got != scanRoot {
		t.Fatalf("got %q, want %q", got, scanRoot)
	}
}

func TestEpisodeFolderNameReturnsNestedFolder(t *testing.T) {
	animeRoot := filepath.Join("library", "Ichigo Mashimaro")
	filePath := filepath.Join(animeRoot, "Encore", "EP01.mkv")

	got := episodeFolderName(animeRoot, filePath)
	if got != "Encore" {
		t.Fatalf("got %q, want %q", got, "Encore")
	}
}

func TestDeriveAnimeRootPathPromotesStaleChildPathToSharedSeriesRoot(t *testing.T) {
	localPath := filepath.Join("library", "Ichigo Mashimaro", "Encore")
	episodePaths := []string{
		filepath.Join("library", "Ichigo Mashimaro", "Ichigo Mashimaro 01.mkv"),
		filepath.Join("library", "Ichigo Mashimaro", "Encore", "Ichigo Mashimaro Encore 01.mkv"),
		filepath.Join("library", "Ichigo Mashimaro", "OVA", "Ichigo Mashimaro OVA 01.mkv"),
	}

	got := deriveAnimeRootPath(localPath, episodePaths)
	want := filepath.Join("library", "Ichigo Mashimaro")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestCommonPathPrefixKeepsSeriesRoot(t *testing.T) {
	a := filepath.Join("library", "Ichigo Mashimaro", "Encore")
	b := filepath.Join("library", "Ichigo Mashimaro", "OVA")

	got := commonPathPrefix(a, b)
	want := filepath.Join("library", "Ichigo Mashimaro")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestChooseAnimeRootPathPromotesSiblingSpecialFoldersToParent(t *testing.T) {
	currentPath := filepath.Join("library", "Ichigo Mashimaro", "Encore")
	candidatePath := filepath.Join("library", "Ichigo Mashimaro")

	got := chooseAnimeRootPath(currentPath, candidatePath, "Ichigo Mashimaro")
	if got != candidatePath {
		t.Fatalf("got %q, want %q", got, candidatePath)
	}
}

func TestChooseAnimeRootPathPromotesSiblingFoldersToSharedAnimeParent(t *testing.T) {
	currentPath := filepath.Join("library", "Ichigo Mashimaro", "Encore")
	candidatePath := filepath.Join("library", "Ichigo Mashimaro", "OVA")
	want := filepath.Join("library", "Ichigo Mashimaro")

	got := chooseAnimeRootPath(currentPath, candidatePath, "Ichigo Mashimaro")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestCleanAnimeTitleCandidateKeepsSeasonMarker(t *testing.T) {
	got := cleanAnimeTitleCandidate("Re:Zero kara Hajimeru Isekai Seikatsu Season 3")
	want := "Re:Zero kara Hajimeru Isekai Seikatsu Season 3"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestFilterAnimeIdentityHintsPrefersSeasonScopedHints(t *testing.T) {
	hints := []string{
		"Re:Zero Season 3",
		"Re:Zero",
		"Starting Life in Another World Season 3",
	}

	filtered := filterAnimeIdentityHints(hints)
	if len(filtered) != 2 {
		t.Fatalf("got %d filtered hints, want 2", len(filtered))
	}
	for _, hint := range filtered {
		if detectAnimeSeasonNumber(hint) != 3 {
			t.Fatalf("expected only season 3 hints, got %q", hint)
		}
	}
}
