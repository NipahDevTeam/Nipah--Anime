package metadata

import (
	"strings"
	"testing"
)

func TestBuildAnimeCatalogFetchRequestsIncludesFormatAndStatus(t *testing.T) {
	requests := buildAnimeCatalogFetchRequests("Comedy", "SPRING", 2025, "SCORE_DESC", "RELEASING", "TV", 1)

	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}

	req := requests[0]
	if req.Page != 1 {
		t.Fatalf("expected page 1, got %d", req.Page)
	}
	if req.Genre != "Comedy" {
		t.Fatalf("expected Comedy genre, got %q", req.Genre)
	}
	if req.Season != "SPRING" {
		t.Fatalf("expected SPRING season, got %q", req.Season)
	}
	if req.Year != 2025 {
		t.Fatalf("expected year 2025, got %d", req.Year)
	}
	if req.Sort != "SCORE_DESC" {
		t.Fatalf("expected SCORE_DESC sort, got %q", req.Sort)
	}
	if req.Status != "RELEASING" {
		t.Fatalf("expected RELEASING status, got %q", req.Status)
	}
	if req.Format != "TV" {
		t.Fatalf("expected TV format, got %q", req.Format)
	}
}

func TestBuildAnimeCatalogFetchRequestsUsesCurrentPagePerGenreForUnion(t *testing.T) {
	requests := buildAnimeCatalogFetchRequests("Comedy, Ecchi", "", 0, "TRENDING_DESC", "", "", 2)

	expected := []catalogFetchRequest{
		{Page: 2, Genre: "Comedy", Sort: "TRENDING_DESC"},
		{Page: 2, Genre: "Ecchi", Sort: "TRENDING_DESC"},
	}

	if len(requests) != len(expected) {
		t.Fatalf("expected %d requests, got %d", len(expected), len(requests))
	}

	for i := range expected {
		if requests[i] != expected[i] {
			t.Fatalf("request %d mismatch: got %+v want %+v", i, requests[i], expected[i])
		}
	}
}

func TestPaginateAnimeCatalogUnionUsesCurrentPageSliceOnly(t *testing.T) {
	items := make([]aniListAnimeCatalogNode, 0, aniListCatalogPerPage+6)
	for index := 0; index < aniListCatalogPerPage+6; index++ {
		items = append(items, aniListAnimeCatalogNode{ID: index + 1})
	}

	payload := paginateAnimeCatalogUnion(items, 2, true)
	if payload.Data.Page.PageInfo.CurrentPage != 2 {
		t.Fatalf("expected current page 2, got %d", payload.Data.Page.PageInfo.CurrentPage)
	}
	if !payload.Data.Page.PageInfo.HasNextPage {
		t.Fatalf("expected hasNextPage to remain true")
	}
	if len(payload.Data.Page.Media) != aniListCatalogPerPage {
		t.Fatalf("expected %d current-page union items, got %d", aniListCatalogPerPage, len(payload.Data.Page.Media))
	}
	if payload.Data.Page.Media[0].ID != 1 {
		t.Fatalf("expected current-page union to start from current batch, got first id %d", payload.Data.Page.Media[0].ID)
	}
}

func TestPaginateMangaCatalogUnionUsesCurrentPageSliceOnly(t *testing.T) {
	items := make([]aniListMangaNode, 0, aniListCatalogPerPage+4)
	for index := 0; index < aniListCatalogPerPage+4; index++ {
		items = append(items, aniListMangaNode{ID: index + 1})
	}

	payload := paginateMangaCatalogUnion(items, 3, true)
	page, ok := payload["data"].(map[string]interface{})["Page"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected page payload map, got %#v", payload)
	}
	pageInfo, ok := page["pageInfo"].(aniListPageInfo)
	if !ok {
		t.Fatalf("expected typed pageInfo, got %#v", page["pageInfo"])
	}
	if pageInfo.CurrentPage != 3 {
		t.Fatalf("expected current page 3, got %d", pageInfo.CurrentPage)
	}
	if !pageInfo.HasNextPage {
		t.Fatalf("expected hasNextPage to remain true")
	}
	media, ok := page["media"].([]aniListMangaNode)
	if !ok {
		t.Fatalf("expected manga media slice, got %#v", page["media"])
	}
	if len(media) != aniListCatalogPerPage {
		t.Fatalf("expected %d current-page union items, got %d", aniListCatalogPerPage, len(media))
	}
	if media[0].ID != 1 {
		t.Fatalf("expected current-page union to start from current batch, got first id %d", media[0].ID)
	}
}

func TestBuildMangaCatalogFetchRequestsIncludesFormatAndStatus(t *testing.T) {
	requests := buildMangaCatalogFetchRequests("Drama", 2024, "POPULARITY_DESC", "FINISHED", "NOVEL", 1)

	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}

	req := requests[0]
	if req.Genre != "Drama" {
		t.Fatalf("expected Drama genre, got %q", req.Genre)
	}
	if req.Year != 2024 {
		t.Fatalf("expected year 2024, got %d", req.Year)
	}
	if req.Sort != "POPULARITY_DESC" {
		t.Fatalf("expected POPULARITY_DESC sort, got %q", req.Sort)
	}
	if req.Status != "FINISHED" {
		t.Fatalf("expected FINISHED status, got %q", req.Status)
	}
	if req.Format != "NOVEL" {
		t.Fatalf("expected NOVEL format, got %q", req.Format)
	}
}

func TestBuildMangaCatalogPayloadUsesYearRangeFilter(t *testing.T) {
	payload := buildMangaCatalogPayload(catalogFetchRequest{
		Page: 1,
		Year: 2025,
		Sort: "TRENDING_DESC",
	})

	query, ok := payload["query"].(string)
	if !ok {
		t.Fatalf("expected query string payload, got %T", payload["query"])
	}
	if strings.Contains(query, "startDate_like") {
		t.Fatalf("expected manga catalog payload to stop using startDate_like, got query %q", query)
	}
	if !strings.Contains(query, "startDate_greater") || !strings.Contains(query, "startDate_lesser") {
		t.Fatalf("expected manga catalog payload to use year range filters, got query %q", query)
	}

	vars, ok := payload["variables"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected variables map payload, got %T", payload["variables"])
	}
	if vars["startDateGreater"] != 20250000 {
		t.Fatalf("expected startDateGreater 20250000, got %#v", vars["startDateGreater"])
	}
	if vars["startDateLesser"] != 20260000 {
		t.Fatalf("expected startDateLesser 20260000, got %#v", vars["startDateLesser"])
	}
}
