package main

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"miruro/backend/extensions"
)

func TestRememberMangaChaptersWithPolicyCachesEmptyAsShortMiss(t *testing.T) {
	key := fmt.Sprintf("test:manga:chapters:short-miss:%d", time.Now().UnixNano())

	chapters, origin, err := rememberMangaChaptersWithPolicy(key, func() ([]extensions.Chapter, error) {
		return []extensions.Chapter{}, nil
	})
	if err != nil {
		t.Fatalf("unexpected error on empty success: %v", err)
	}
	if origin != "short_miss" {
		t.Fatalf("expected short_miss origin, got %q", origin)
	}
	if len(chapters) != 0 {
		t.Fatalf("expected empty chapter list, got %d chapters", len(chapters))
	}
	time.Sleep(25 * time.Millisecond)

	chapters, origin, err = rememberMangaChaptersWithPolicy(key, func() ([]extensions.Chapter, error) {
		return nil, errors.New("should not reload while short miss is fresh")
	})
	if err != nil {
		t.Fatalf("expected fresh short miss cache hit, got error: %v", err)
	}
	if origin != "short_miss" {
		t.Fatalf("expected short_miss cache hit, got %q", origin)
	}
	if len(chapters) != 0 {
		t.Fatalf("expected empty cached chapter list, got %d chapters", len(chapters))
	}
}

func TestRememberMangaChaptersWithPolicyServesStaleOnlyForNonEmptyResults(t *testing.T) {
	key := fmt.Sprintf("test:manga:chapters:stale-hit:%d", time.Now().UnixNano())
	payload := mangaChapterCachePayload{
		Chapters:    []extensions.Chapter{{ID: "chapter-1", Number: 1, Title: "Chapter 1"}},
		HasChapters: true,
	}
	writeAppCachedJSON(staleAppCacheKey(key), time.Minute, payload)
	time.Sleep(25 * time.Millisecond)

	chapters, origin, err := rememberMangaChaptersWithPolicy(key, func() ([]extensions.Chapter, error) {
		return nil, errors.New("network down")
	})
	if err != nil {
		t.Fatalf("expected stale non-empty fallback, got error: %v", err)
	}
	if origin != "stale_cache" {
		t.Fatalf("expected stale_cache origin, got %q", origin)
	}
	if len(chapters) != 1 || chapters[0].ID != "chapter-1" {
		t.Fatalf("expected stale non-empty chapters, got %#v", chapters)
	}

	emptyKey := fmt.Sprintf("test:manga:chapters:stale-empty:%d", time.Now().UnixNano())
	writeAppCachedJSON(staleAppCacheKey(emptyKey), time.Minute, mangaChapterCachePayload{
		Chapters:    []extensions.Chapter{},
		HasChapters: false,
	})
	time.Sleep(25 * time.Millisecond)

	chapters, origin, err = rememberMangaChaptersWithPolicy(emptyKey, func() ([]extensions.Chapter, error) {
		return nil, errors.New("network down")
	})
	if err == nil {
		t.Fatalf("expected error when only empty stale payload exists, got chapters=%#v origin=%q", chapters, origin)
	}
}

func TestRememberMangaChaptersWithPolicyKeepsStaleSuccessWhenFreshLoadIsEmpty(t *testing.T) {
	key := fmt.Sprintf("test:manga:chapters:preserve-stale:%d", time.Now().UnixNano())
	stalePayload := mangaChapterCachePayload{
		Chapters:    []extensions.Chapter{{ID: "chapter-7", Number: 7, Title: "Chapter 7"}},
		HasChapters: true,
	}
	writeAppCachedJSON(staleAppCacheKey(key), time.Minute, stalePayload)
	time.Sleep(25 * time.Millisecond)

	chapters, origin, err := rememberMangaChaptersWithPolicy(key, func() ([]extensions.Chapter, error) {
		return []extensions.Chapter{}, nil
	})
	if err != nil {
		t.Fatalf("unexpected empty success error: %v", err)
	}
	if origin != "stale_cache" {
		t.Fatalf("expected stale_cache origin, got %q", origin)
	}
	if len(chapters) != 1 || chapters[0].ID != "chapter-7" {
		t.Fatalf("expected stale chapter payload to be served, got %#v", chapters)
	}

	time.Sleep(25 * time.Millisecond)
	cached, ok := readAppCachedJSON[mangaChapterCachePayload](key)
	if !ok {
		t.Fatalf("expected short-miss payload to be cached")
	}
	if cached.HasChapters || len(cached.Chapters) != 0 {
		t.Fatalf("expected fresh cache to store only the short miss, got %#v", cached)
	}

	stale, ok := readAppCachedJSON[mangaChapterCachePayload](staleAppCacheKey(key))
	if !ok {
		t.Fatalf("expected stale success payload to remain cached")
	}
	if !stale.HasChapters || len(stale.Chapters) != 1 || stale.Chapters[0].ID != "chapter-7" {
		t.Fatalf("expected preserved stale chapter payload, got %#v", stale)
	}

	chapters, origin, err = rememberMangaChaptersWithPolicy(key, func() ([]extensions.Chapter, error) {
		return nil, errors.New("should not reload while short miss is fresh")
	})
	if err != nil {
		t.Fatalf("expected stale cache to cover fresh short miss, got error: %v", err)
	}
	if origin != "stale_cache" {
		t.Fatalf("expected stale_cache on fresh short miss, got %q", origin)
	}
	if len(chapters) != 1 || chapters[0].ID != "chapter-7" {
		t.Fatalf("expected stale chapter payload on fresh short miss, got %#v", chapters)
	}
}
