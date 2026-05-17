package main

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"miruro/backend/metadata"
)

func buildAniListAnimeSearchPayload(ids ...int) interface{} {
	media := make([]interface{}, 0, len(ids))
	for _, id := range ids {
		media = append(media, map[string]interface{}{"id": id})
	}
	return map[string]interface{}{
		"data": map[string]interface{}{
			"Page": map[string]interface{}{
				"media": media,
			},
		},
	}
}

func TestRememberAniListAnimeSearchWithPolicyCachesEmptyAsShortMiss(t *testing.T) {
	key := fmt.Sprintf("test:anilist:search:short-miss:%d", time.Now().UnixNano())

	result, origin, err := rememberAniListAnimeSearchWithPolicy(key, func() (interface{}, error) {
		return buildAniListAnimeSearchPayload(), nil
	})
	if err != nil {
		t.Fatalf("unexpected error on empty success: %v", err)
	}
	if origin != "short_miss" {
		t.Fatalf("expected short_miss origin, got %q", origin)
	}
	if got := aniListAnimeSearchResultCount(result); got != 0 {
		t.Fatalf("expected empty result payload, got %d hits", got)
	}
	time.Sleep(25 * time.Millisecond)

	result, origin, err = rememberAniListAnimeSearchWithPolicy(key, func() (interface{}, error) {
		return nil, errors.New("should not reload while short miss is fresh")
	})
	if err != nil {
		t.Fatalf("expected short-miss cache hit, got error: %v", err)
	}
	if origin != "short_miss" {
		t.Fatalf("expected short_miss cache hit, got %q", origin)
	}
	if got := aniListAnimeSearchResultCount(result); got != 0 {
		t.Fatalf("expected empty cached result payload, got %d hits", got)
	}
}

func TestRememberAniListAnimeSearchWithPolicyIgnoresLegacyFreshEmptyEntries(t *testing.T) {
	key := fmt.Sprintf("test:anilist:search:legacy-empty:%d", time.Now().UnixNano())
	writeAppCachedJSON(key, time.Minute, buildAniListAnimeSearchPayload())
	time.Sleep(25 * time.Millisecond)

	calls := 0
	result, origin, err := rememberAniListAnimeSearchWithPolicy(key, func() (interface{}, error) {
		calls++
		return buildAniListAnimeSearchPayload(52991), nil
	})
	if err != nil {
		t.Fatalf("unexpected recovery error: %v", err)
	}
	if origin != "network" {
		t.Fatalf("expected network recovery origin, got %q", origin)
	}
	if calls != 1 {
		t.Fatalf("expected loader to be called once, got %d calls", calls)
	}
	if got := aniListAnimeSearchResultCount(result); got != 1 {
		t.Fatalf("expected recovered non-empty payload, got %d hits", got)
	}
}

func TestRememberAniListAnimeSearchWithPolicyServesStaleSuccessWhenFreshLoadIsEmpty(t *testing.T) {
	key := fmt.Sprintf("test:anilist:search:stale-hit:%d", time.Now().UnixNano())
	stalePayload := buildAniListAnimeSearchPayload(1, 2)
	writeAppCachedJSON(staleAppCacheKey(key), time.Minute, stalePayload)
	time.Sleep(25 * time.Millisecond)

	result, origin, err := rememberAniListAnimeSearchWithPolicy(key, func() (interface{}, error) {
		return buildAniListAnimeSearchPayload(), nil
	})
	if err != nil {
		t.Fatalf("unexpected empty success error: %v", err)
	}
	if origin != "stale_cache" {
		t.Fatalf("expected stale_cache origin, got %q", origin)
	}
	if got := aniListAnimeSearchResultCount(result); got != 2 {
		t.Fatalf("expected stale non-empty payload, got %d hits", got)
	}
	time.Sleep(25 * time.Millisecond)

	result, origin, err = rememberAniListAnimeSearchWithPolicy(key, func() (interface{}, error) {
		return nil, errors.New("should not reload while short miss is fresh")
	})
	if err != nil {
		t.Fatalf("expected stale cache to cover short miss, got error: %v", err)
	}
	if origin != "stale_cache" {
		t.Fatalf("expected stale_cache on short miss replay, got %q", origin)
	}
	if got := aniListAnimeSearchResultCount(result); got != 2 {
		t.Fatalf("expected stale non-empty payload on replay, got %d hits", got)
	}
}

func TestRememberAniListMangaSearchWithPolicyCachesEmptyAsShortMiss(t *testing.T) {
	key := fmt.Sprintf("test:anilist:manga-search:short-miss:%d", time.Now().UnixNano())

	result, origin, err := rememberAniListMangaSearchWithPolicy(key, func() ([]metadata.AniListMangaMetadata, error) {
		return []metadata.AniListMangaMetadata{}, nil
	})
	if err != nil {
		t.Fatalf("unexpected error on empty success: %v", err)
	}
	if origin != "short_miss" {
		t.Fatalf("expected short_miss origin, got %q", origin)
	}
	if len(result) != 0 {
		t.Fatalf("expected empty result payload, got %d hits", len(result))
	}
	time.Sleep(25 * time.Millisecond)

	result, origin, err = rememberAniListMangaSearchWithPolicy(key, func() ([]metadata.AniListMangaMetadata, error) {
		return nil, errors.New("should not reload while short miss is fresh")
	})
	if err != nil {
		t.Fatalf("expected short-miss cache hit, got error: %v", err)
	}
	if origin != "short_miss" {
		t.Fatalf("expected short_miss cache hit, got %q", origin)
	}
	if len(result) != 0 {
		t.Fatalf("expected empty cached result payload, got %d hits", len(result))
	}
}

func TestRememberPersistentAniListMangaSearchUsesSnapshotBeforeRefresh(t *testing.T) {
	database := newRuntimeCacheTestDB(t)
	key := fmt.Sprintf("test:anilist:manga-search:persistent:%d", time.Now().UnixNano())
	payload := []metadata.AniListMangaMetadata{
		{AniListID: 18, TitleEnglish: "Blue Box"},
	}
	writePersistentJSONSnapshot(database, "cache:"+key, 20*time.Minute, 3*time.Hour, payload)

	calls := 0
	result, origin, err := rememberPersistentAniListMangaSearch(database, key, func() ([]metadata.AniListMangaMetadata, error) {
		calls++
		return nil, errors.New("should not hit network while persistent snapshot is fresh")
	})
	if err != nil {
		t.Fatalf("unexpected persistent snapshot error: %v", err)
	}
	if origin != "persistent_fresh_cache" {
		t.Fatalf("expected persistent_fresh_cache origin, got %q", origin)
	}
	if calls != 0 {
		t.Fatalf("expected no loader calls, got %d", calls)
	}
	if len(result) != 1 || result[0].AniListID != 18 {
		t.Fatalf("expected persisted payload, got %#v", result)
	}
}
