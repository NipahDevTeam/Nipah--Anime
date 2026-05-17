package metadata

import "testing"

func TestShiftAniListSeason(t *testing.T) {
	tests := []struct {
		name         string
		season       string
		year         int
		offset       int
		wantSeason   string
		wantYear     int
	}{
		{name: "next spring to summer", season: "SPRING", year: 2026, offset: 1, wantSeason: "SUMMER", wantYear: 2026},
		{name: "next fall wraps year", season: "FALL", year: 2026, offset: 1, wantSeason: "WINTER", wantYear: 2027},
		{name: "previous winter wraps year", season: "WINTER", year: 2026, offset: -1, wantSeason: "FALL", wantYear: 2025},
		{name: "previous summer", season: "SUMMER", year: 2026, offset: -1, wantSeason: "SPRING", wantYear: 2026},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotSeason, gotYear := shiftAniListSeason(tc.season, tc.year, tc.offset)
			if gotSeason != tc.wantSeason || gotYear != tc.wantYear {
				t.Fatalf("shiftAniListSeason(%q, %d, %d) = (%q, %d), want (%q, %d)", tc.season, tc.year, tc.offset, gotSeason, gotYear, tc.wantSeason, tc.wantYear)
			}
		})
	}
}
