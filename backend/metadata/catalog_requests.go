package metadata

import (
	"sort"
	"strings"
)

const aniListCatalogPerPage = 48

type catalogFetchRequest struct {
	Page   int
	Genre  string
	Season string
	Year   int
	Sort   string
	Status string
	Format string
}

type aniListPageInfo struct {
	Total       int  `json:"total"`
	CurrentPage int  `json:"currentPage"`
	LastPage    int  `json:"lastPage"`
	HasNextPage bool `json:"hasNextPage"`
	PerPage     int  `json:"perPage,omitempty"`
}

type aniListAnimeCatalogNode struct {
	ID     int    `json:"id"`
	IDMal  int    `json:"idMal"`
	Format string `json:"format"`
	Title  struct {
		Romaji  string `json:"romaji"`
		English string `json:"english"`
		Native  string `json:"native"`
	} `json:"title"`
	Synonyms   []string `json:"synonyms"`
	CoverImage struct {
		Large      string `json:"large"`
		ExtraLarge string `json:"extraLarge"`
	} `json:"coverImage"`
	BannerImage       string      `json:"bannerImage"`
	Description       string      `json:"description"`
	AverageScore      float64     `json:"averageScore"`
	Popularity        int         `json:"popularity"`
	Trending          int         `json:"trending"`
	Favourites        int         `json:"favourites"`
	Episodes          int         `json:"episodes"`
	Season            string      `json:"season"`
	SeasonYear        int         `json:"seasonYear"`
	StartDate         AniListDate `json:"startDate"`
	Genres            []string    `json:"genres"`
	Status            string      `json:"status"`
	NextAiringEpisode *struct {
		Episode  int `json:"episode"`
		AiringAt int `json:"airingAt"`
	} `json:"nextAiringEpisode"`
}

type aniListAnimeCatalogEnvelope struct {
	Data struct {
		Page struct {
			PageInfo aniListPageInfo           `json:"pageInfo"`
			Media    []aniListAnimeCatalogNode `json:"media"`
		} `json:"Page"`
	} `json:"data"`
}

type aniListMangaCatalogEnvelope struct {
	Data struct {
		Page struct {
			PageInfo aniListPageInfo    `json:"pageInfo"`
			Media    []aniListMangaNode `json:"media"`
		} `json:"Page"`
	} `json:"data"`
}

func splitCatalogGenres(raw string) []string {
	parts := strings.Split(raw, ",")
	seen := make(map[string]struct{}, len(parts))
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		genre := strings.TrimSpace(part)
		if genre == "" {
			continue
		}
		key := strings.ToLower(genre)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, genre)
	}
	return out
}

func normalizeCatalogPage(page int) int {
	if page < 1 {
		return 1
	}
	return page
}

func normalizeAniListCatalogSort(sortKey string) string {
	switch strings.TrimSpace(sortKey) {
	case "POPULARITY_DESC", "SCORE_DESC", "FAVOURITES_DESC", "START_DATE_DESC", "TRENDING_DESC":
		return strings.TrimSpace(sortKey)
	default:
		return "TRENDING_DESC"
	}
}

func buildAnimeCatalogFetchRequests(genre, season string, year int, sort, status, format string, page int) []catalogFetchRequest {
	return buildCatalogFetchRequests(genre, season, year, sort, status, format, page)
}

func buildMangaCatalogFetchRequests(genre string, year int, sort, status, format string, page int) []catalogFetchRequest {
	return buildCatalogFetchRequests(genre, "", year, sort, status, format, page)
}

func buildCatalogFetchRequests(genre, season string, year int, sort, status, format string, page int) []catalogFetchRequest {
	safePage := normalizeCatalogPage(page)
	requestBase := catalogFetchRequest{
		Page:   safePage,
		Season: strings.TrimSpace(season),
		Year:   year,
		Sort:   normalizeAniListCatalogSort(sort),
		Status: strings.TrimSpace(status),
		Format: strings.TrimSpace(format),
	}

	genres := splitCatalogGenres(genre)
	if len(genres) <= 1 {
		if len(genres) == 1 {
			requestBase.Genre = genres[0]
		}
		return []catalogFetchRequest{requestBase}
	}

	requests := make([]catalogFetchRequest, 0, len(genres)*safePage)
	for _, currentGenre := range genres {
		for currentPage := 1; currentPage <= safePage; currentPage++ {
			req := requestBase
			req.Page = currentPage
			req.Genre = currentGenre
			requests = append(requests, req)
		}
	}
	return requests
}

func sortAnimeCatalogItems(items []aniListAnimeCatalogNode, sortKey string) {
	sortKey = normalizeAniListCatalogSort(sortKey)
	sort.SliceStable(items, func(i, j int) bool {
		left := items[i]
		right := items[j]

		switch sortKey {
		case "START_DATE_DESC":
			if lessDateDesc(left.StartDate, right.StartDate) {
				return true
			}
			if lessDateDesc(right.StartDate, left.StartDate) {
				return false
			}
			return lessAnimeByPopularityScore(left, right)
		case "SCORE_DESC":
			if left.AverageScore != right.AverageScore {
				return left.AverageScore > right.AverageScore
			}
			if left.Popularity != right.Popularity {
				return left.Popularity > right.Popularity
			}
			if left.Trending != right.Trending {
				return left.Trending > right.Trending
			}
			return left.ID < right.ID
		case "POPULARITY_DESC":
			return lessAnimeByPopularityScore(left, right)
		case "FAVOURITES_DESC":
			if left.Favourites != right.Favourites {
				return left.Favourites > right.Favourites
			}
			return lessAnimeByPopularityScore(left, right)
		default:
			if left.Trending != right.Trending {
				return left.Trending > right.Trending
			}
			return lessAnimeByPopularityScore(left, right)
		}
	})
}

func sortMangaCatalogItems(items []aniListMangaNode, sortKey string) {
	sortKey = normalizeAniListCatalogSort(sortKey)
	sort.SliceStable(items, func(i, j int) bool {
		left := items[i]
		right := items[j]

		switch sortKey {
		case "START_DATE_DESC":
			if lessDateDesc(left.StartDate, right.StartDate) {
				return true
			}
			if lessDateDesc(right.StartDate, left.StartDate) {
				return false
			}
			return lessMangaByPopularityScore(left, right)
		case "SCORE_DESC":
			if left.AverageScore != right.AverageScore {
				return left.AverageScore > right.AverageScore
			}
			if left.Popularity != right.Popularity {
				return left.Popularity > right.Popularity
			}
			if left.Trending != right.Trending {
				return left.Trending > right.Trending
			}
			return left.ID < right.ID
		case "POPULARITY_DESC":
			return lessMangaByPopularityScore(left, right)
		case "FAVOURITES_DESC":
			if left.Favourites != right.Favourites {
				return left.Favourites > right.Favourites
			}
			return lessMangaByPopularityScore(left, right)
		default:
			if left.Trending != right.Trending {
				return left.Trending > right.Trending
			}
			return lessMangaByPopularityScore(left, right)
		}
	})
}

func paginateAnimeCatalogUnion(items []aniListAnimeCatalogNode, page int, hasMore bool) *aniListAnimeCatalogEnvelope {
	safePage := normalizeCatalogPage(page)
	start := (safePage - 1) * aniListCatalogPerPage
	end := start + aniListCatalogPerPage
	if start > len(items) {
		start = len(items)
	}
	if end > len(items) {
		end = len(items)
	}

	lastPage := catalogLastPage(len(items))
	if hasMore && lastPage <= safePage {
		lastPage = safePage + 1
	}

	var payload aniListAnimeCatalogEnvelope
	payload.Data.Page.Media = append(payload.Data.Page.Media, items[start:end]...)
	payload.Data.Page.PageInfo = aniListPageInfo{
		Total:       len(items),
		CurrentPage: safePage,
		LastPage:    lastPage,
		HasNextPage: hasMore || end < len(items),
		PerPage:     aniListCatalogPerPage,
	}
	return &payload
}

func paginateMangaCatalogUnion(items []aniListMangaNode, page int, hasMore bool) map[string]interface{} {
	safePage := normalizeCatalogPage(page)
	start := (safePage - 1) * aniListCatalogPerPage
	end := start + aniListCatalogPerPage
	if start > len(items) {
		start = len(items)
	}
	if end > len(items) {
		end = len(items)
	}

	lastPage := catalogLastPage(len(items))
	if hasMore && lastPage <= safePage {
		lastPage = safePage + 1
	}

	return map[string]interface{}{
		"data": map[string]interface{}{
			"Page": map[string]interface{}{
				"pageInfo": aniListPageInfo{
					Total:       len(items),
					CurrentPage: safePage,
					LastPage:    lastPage,
					HasNextPage: hasMore || end < len(items),
					PerPage:     aniListCatalogPerPage,
				},
				"media": items[start:end],
			},
		},
	}
}

func catalogLastPage(total int) int {
	if total <= 0 {
		return 1
	}
	lastPage := total / aniListCatalogPerPage
	if total%aniListCatalogPerPage != 0 {
		lastPage++
	}
	if lastPage < 1 {
		return 1
	}
	return lastPage
}

func lessDateDesc(left, right AniListDate) bool {
	if left.Year != right.Year {
		return left.Year > right.Year
	}
	if left.Month != right.Month {
		return left.Month > right.Month
	}
	return left.Day > right.Day
}

func lessAnimeByPopularityScore(left, right aniListAnimeCatalogNode) bool {
	if left.Popularity != right.Popularity {
		return left.Popularity > right.Popularity
	}
	if left.AverageScore != right.AverageScore {
		return left.AverageScore > right.AverageScore
	}
	return left.ID < right.ID
}

func lessMangaByPopularityScore(left, right aniListMangaNode) bool {
	if left.Popularity != right.Popularity {
		return left.Popularity > right.Popularity
	}
	if left.AverageScore != right.AverageScore {
		return left.AverageScore > right.AverageScore
	}
	return left.ID < right.ID
}
