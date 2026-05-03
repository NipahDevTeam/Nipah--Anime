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

func TestBuildAnimeCatalogFetchRequestsExpandsMultiGenreUnionAcrossPages(t *testing.T) {
	requests := buildAnimeCatalogFetchRequests("Comedy, Ecchi", "", 0, "TRENDING_DESC", "", "", 2)

	expected := []catalogFetchRequest{
		{Page: 1, Genre: "Comedy", Sort: "TRENDING_DESC"},
		{Page: 2, Genre: "Comedy", Sort: "TRENDING_DESC"},
		{Page: 1, Genre: "Ecchi", Sort: "TRENDING_DESC"},
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
