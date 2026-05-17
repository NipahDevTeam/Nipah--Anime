package main

import (
	"encoding/json"
	"fmt"
	"time"

	cachepkg "miruro/backend/cache"
	"miruro/backend/db"
	"miruro/backend/metadata"
)

const aniListSearchCacheKind = "anilist_search_cache"

type aniListAnimeSearchCachePayload struct {
	Kind       string      `json:"kind"`
	Payload    interface{} `json:"payload"`
	HasResults bool        `json:"has_results"`
}

type aniListMangaSearchCachePayload struct {
	Kind       string                          `json:"kind"`
	Payload    []metadata.AniListMangaMetadata `json:"payload"`
	HasResults bool                            `json:"has_results"`
}

func aniListAnimeSearchResultCount(payload interface{}) int {
	switch value := payload.(type) {
	case nil:
		return 0
	case []interface{}:
		return len(value)
	case map[string]interface{}:
		if media, ok := value["media"].([]interface{}); ok {
			return len(media)
		}
		if page, ok := value["Page"].(map[string]interface{}); ok {
			return aniListAnimeSearchResultCount(page)
		}
		if data, ok := value["data"].(map[string]interface{}); ok {
			return aniListAnimeSearchResultCount(data)
		}
	}
	return 0
}

func rememberAniListAnimeSearchWithPolicy(key string, loader func() (interface{}, error)) (interface{}, string, error) {
	const (
		freshTTL     = 20 * time.Minute
		staleTTL     = 3 * time.Hour
		shortMissTTL = 15 * time.Second
	)

	readStale := func() (interface{}, bool) {
		payload, hasResults, ok, _ := readAniListAnimeSearchCacheEntry(staleAppCacheKey(key))
		if !ok || !hasResults || aniListAnimeSearchResultCount(payload) == 0 {
			return nil, false
		}
		return payload, true
	}

	if cached, hasResults, ok, legacy := readAniListAnimeSearchCacheEntry(key); ok {
		if legacy && !hasResults {
			// Legacy raw empty payloads should not pin the cache.
		} else {
			if hasResults {
				return cached, "fresh_cache", nil
			}
			if stale, ok := readStale(); ok {
				return stale, "stale_cache", nil
			}
			return cached, "short_miss", nil
		}
	}

	payload, err := loader()
	if err == nil {
		hasResults := aniListAnimeSearchResultCount(payload) > 0
		writeAniListAnimeSearchCacheEntry(key, payload, hasResults, ternaryDuration(hasResults, freshTTL, shortMissTTL))
		if hasResults {
			writeAniListAnimeSearchCacheEntry(staleAppCacheKey(key), payload, true, staleTTL)
			return payload, "network", nil
		}
		if stale, ok := readStale(); ok {
			return stale, "stale_cache", nil
		}
		return payload, "short_miss", nil
	}

	if stale, ok := readStale(); ok {
		return stale, "stale_cache", nil
	}
	return nil, "", err
}

func rememberPersistentSnapshotWithStale[T any](database *db.Database, cacheKey string, freshTTL, staleTTL time.Duration, loader func() (T, error)) (T, string, error) {
	var zero T

	if cached, ok := readAppCachedJSON[T](cacheKey); ok {
		return cached, "fresh_cache", nil
	}

	persistentKey := "cache:" + cacheKey
	now := time.Now()
	if persisted, origin, ok := readPersistentJSONSnapshot[T](database, persistentKey, now); ok {
		writeAppCachedJSON(staleAppCacheKey(cacheKey), staleTTL, persisted)
		if origin == "persistent_fresh_cache" {
			writeAppCachedJSON(cacheKey, freshTTL, persisted)
			return persisted, origin, nil
		}

		go func() {
			refreshed, err := loader()
			if err != nil {
				return
			}
			writeAppCachedJSON(cacheKey, freshTTL, refreshed)
			writeAppCachedJSON(staleAppCacheKey(cacheKey), staleTTL, refreshed)
			writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, refreshed)
		}()

		return persisted, origin, nil
	}

	result, origin, err := rememberJSONWithStale[T](cacheKey, freshTTL, staleTTL, loader)
	if err != nil {
		return zero, origin, err
	}
	writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, result)
	return result, origin, nil
}

func rememberPersistentAniListAnimeSearch(database *db.Database, cacheKey string, loader func() (interface{}, error)) (interface{}, string, error) {
	const (
		freshTTL = 20 * time.Minute
		staleTTL = 3 * time.Hour
	)

	if cached, hasResults, ok, legacy := readAniListAnimeSearchCacheEntry(cacheKey); ok {
		if legacy && !hasResults {
			// Ignore legacy raw empty entries and let the policy recover.
		} else {
			if hasResults {
				return cached, "fresh_cache", nil
			}
			if stale, hasStale, ok, _ := readAniListAnimeSearchCacheEntry(staleAppCacheKey(cacheKey)); ok && hasStale && aniListAnimeSearchResultCount(stale) > 0 {
				return stale, "stale_cache", nil
			}
			return cached, "short_miss", nil
		}
	}

	persistentKey := "cache:" + cacheKey
	if persisted, origin, ok := readPersistentJSONSnapshot[interface{}](database, persistentKey, time.Now()); ok {
		if aniListAnimeSearchResultCount(persisted) > 0 {
			writeAniListAnimeSearchCacheEntry(staleAppCacheKey(cacheKey), persisted, true, staleTTL)
			if origin == "persistent_fresh_cache" {
				writeAniListAnimeSearchCacheEntry(cacheKey, persisted, true, freshTTL)
				return persisted, origin, nil
			}
			go func() {
				refreshed, refreshedOrigin, err := rememberAniListAnimeSearchWithPolicy(cacheKey, loader)
				if err != nil {
					return
				}
				if aniListAnimeSearchResultCount(refreshed) > 0 {
					writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, refreshed)
				} else if refreshedOrigin == "network" {
					writeAniListAnimeSearchCacheEntry(cacheKey, refreshed, false, 15*time.Second)
				}
			}()
			return persisted, origin, nil
		}
	}

	result, origin, err := rememberAniListAnimeSearchWithPolicy(cacheKey, loader)
	if err != nil {
		return nil, origin, err
	}
	if aniListAnimeSearchResultCount(result) > 0 {
		writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, result)
	}
	return result, origin, nil
}

func rememberAniListMangaSearchWithPolicy(key string, loader func() ([]metadata.AniListMangaMetadata, error)) ([]metadata.AniListMangaMetadata, string, error) {
	const (
		freshTTL     = 20 * time.Minute
		staleTTL     = 3 * time.Hour
		shortMissTTL = 15 * time.Second
	)

	readStale := func() ([]metadata.AniListMangaMetadata, bool) {
		payload, hasResults, ok, _ := readAniListMangaSearchCacheEntry(staleAppCacheKey(key))
		if !ok || !hasResults || len(payload) == 0 {
			return nil, false
		}
		return payload, true
	}

	if cached, hasResults, ok, legacy := readAniListMangaSearchCacheEntry(key); ok {
		if legacy && !hasResults {
			// Legacy raw empty payloads should not pin the cache.
		} else {
			if hasResults {
				return cached, "fresh_cache", nil
			}
			if stale, ok := readStale(); ok {
				return stale, "stale_cache", nil
			}
			return cached, "short_miss", nil
		}
	}

	payload, err := loader()
	if err == nil {
		hasResults := len(payload) > 0
		writeAniListMangaSearchCacheEntry(key, payload, hasResults, ternaryDuration(hasResults, freshTTL, shortMissTTL))
		if hasResults {
			writeAniListMangaSearchCacheEntry(staleAppCacheKey(key), payload, true, staleTTL)
			return payload, "network", nil
		}
		if stale, ok := readStale(); ok {
			return stale, "stale_cache", nil
		}
		return payload, "short_miss", nil
	}

	if stale, ok := readStale(); ok {
		return stale, "stale_cache", nil
	}
	return nil, "", err
}

func rememberPersistentAniListMangaSearch(database *db.Database, cacheKey string, loader func() ([]metadata.AniListMangaMetadata, error)) ([]metadata.AniListMangaMetadata, string, error) {
	const (
		freshTTL = 20 * time.Minute
		staleTTL = 3 * time.Hour
	)

	if cached, hasResults, ok, legacy := readAniListMangaSearchCacheEntry(cacheKey); ok {
		if legacy && !hasResults {
			// Ignore legacy raw empty entries and let the policy recover.
		} else {
			if hasResults {
				return cached, "fresh_cache", nil
			}
			if stale, hasStale, ok, _ := readAniListMangaSearchCacheEntry(staleAppCacheKey(cacheKey)); ok && hasStale && len(stale) > 0 {
				return stale, "stale_cache", nil
			}
			return cached, "short_miss", nil
		}
	}

	persistentKey := "cache:" + cacheKey
	if persisted, origin, ok := readPersistentJSONSnapshot[[]metadata.AniListMangaMetadata](database, persistentKey, time.Now()); ok {
		if len(persisted) > 0 {
			writeAniListMangaSearchCacheEntry(staleAppCacheKey(cacheKey), persisted, true, staleTTL)
			if origin == "persistent_fresh_cache" {
				writeAniListMangaSearchCacheEntry(cacheKey, persisted, true, freshTTL)
				return persisted, origin, nil
			}
			go func() {
				refreshed, refreshedOrigin, err := rememberAniListMangaSearchWithPolicy(cacheKey, loader)
				if err != nil {
					return
				}
				if len(refreshed) > 0 {
					writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, refreshed)
				} else if refreshedOrigin == "network" {
					writeAniListMangaSearchCacheEntry(cacheKey, refreshed, false, 15*time.Second)
				}
			}()
			return persisted, origin, nil
		}
	}

	result, origin, err := rememberAniListMangaSearchWithPolicy(cacheKey, loader)
	if err != nil {
		return nil, origin, err
	}
	if len(result) > 0 {
		writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, result)
	}
	return result, origin, nil
}

func readAniListAnimeSearchCacheEntry(key string) (interface{}, bool, bool, bool) {
	raw, ok := cachepkg.Global().GetBytes(key)
	if !ok {
		return nil, false, false, false
	}

	var wrapped aniListAnimeSearchCachePayload
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Kind == aniListSearchCacheKind {
		return wrapped.Payload, wrapped.HasResults, true, false
	}

	var legacy interface{}
	if err := json.Unmarshal(raw, &legacy); err == nil {
		return legacy, aniListAnimeSearchResultCount(legacy) > 0, true, true
	}

	return nil, false, false, false
}

func writeAniListAnimeSearchCacheEntry(key string, payload interface{}, hasResults bool, ttl time.Duration) {
	writeAppCachedJSON(key, ttl, aniListAnimeSearchCachePayload{
		Kind:       aniListSearchCacheKind,
		Payload:    payload,
		HasResults: hasResults,
	})
}

func readAniListMangaSearchCacheEntry(key string) ([]metadata.AniListMangaMetadata, bool, bool, bool) {
	raw, ok := cachepkg.Global().GetBytes(key)
	if !ok {
		return nil, false, false, false
	}

	var wrapped aniListMangaSearchCachePayload
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Kind == aniListSearchCacheKind {
		return wrapped.Payload, wrapped.HasResults, true, false
	}

	var legacy []metadata.AniListMangaMetadata
	if err := json.Unmarshal(raw, &legacy); err == nil {
		return legacy, len(legacy) > 0, true, true
	}

	return nil, false, false, false
}

func writeAniListMangaSearchCacheEntry(key string, payload []metadata.AniListMangaMetadata, hasResults bool, ttl time.Duration) {
	writeAppCachedJSON(key, ttl, aniListMangaSearchCachePayload{
		Kind:       aniListSearchCacheKind,
		Payload:    payload,
		HasResults: hasResults,
	})
}

func ternaryDuration(condition bool, whenTrue, whenFalse time.Duration) time.Duration {
	if condition {
		return whenTrue
	}
	return whenFalse
}

func rememberAniListAnimeEnrichmentSnapshot(database *db.Database, anilistID int, loader func() (*metadata.AnimeMetadata, error)) (*metadata.AnimeMetadata, string, error) {
	const (
		freshTTL = 2 * time.Hour
		staleTTL = 12 * time.Hour
	)

	fullCacheKey := fmt.Sprintf("anilist:anime:id:%d", anilistID)
	if cached, ok := readAppCachedJSON[*metadata.AnimeMetadata](fullCacheKey); ok && cached != nil {
		return cached, "fresh_cache", nil
	}
	if stale, ok := readAppCachedJSON[*metadata.AnimeMetadata](staleAppCacheKey(fullCacheKey)); ok && stale != nil {
		return stale, "stale_cache", nil
	}
	if persisted, origin, ok := readPersistentJSONSnapshot[*metadata.AnimeMetadata](database, "cache:"+fullCacheKey, time.Now()); ok && persisted != nil {
		writeAppCachedJSON(staleAppCacheKey(fullCacheKey), staleTTL, persisted)
		if origin == "persistent_fresh_cache" {
			writeAppCachedJSON(fullCacheKey, freshTTL, persisted)
		}
		return persisted, origin, nil
	}

	enrichmentKey := fmt.Sprintf("anilist:anime:enrichment:id:%d", anilistID)
	return rememberPersistentSnapshotWithStale[*metadata.AnimeMetadata](database, enrichmentKey, freshTTL, staleTTL, loader)
}

func rememberAniListMangaEnrichmentSnapshot(database *db.Database, anilistID int, loader func() (*metadata.AniListMangaMetadata, error)) (*metadata.AniListMangaMetadata, string, error) {
	const (
		freshTTL = 2 * time.Hour
		staleTTL = 12 * time.Hour
	)

	fullCacheKey := fmt.Sprintf("anilist:manga:id:%d", anilistID)
	if cached, ok := readAppCachedJSON[*metadata.AniListMangaMetadata](fullCacheKey); ok && cached != nil {
		return cached, "fresh_cache", nil
	}
	if stale, ok := readAppCachedJSON[*metadata.AniListMangaMetadata](staleAppCacheKey(fullCacheKey)); ok && stale != nil {
		return stale, "stale_cache", nil
	}
	if persisted, origin, ok := readPersistentJSONSnapshot[*metadata.AniListMangaMetadata](database, "cache:"+fullCacheKey, time.Now()); ok && persisted != nil {
		writeAppCachedJSON(staleAppCacheKey(fullCacheKey), staleTTL, persisted)
		if origin == "persistent_fresh_cache" {
			writeAppCachedJSON(fullCacheKey, freshTTL, persisted)
		}
		return persisted, origin, nil
	}

	enrichmentKey := fmt.Sprintf("anilist:manga:enrichment:id:%d", anilistID)
	return rememberPersistentSnapshotWithStale[*metadata.AniListMangaMetadata](database, enrichmentKey, freshTTL, staleTTL, loader)
}

func rememberAniListMangaDetailSnapshot(database *db.Database, anilistID int, loader func() (*metadata.AniListMangaMetadata, error)) (*metadata.AniListMangaMetadata, string, error) {
	const (
		freshTTL = 2 * time.Hour
		staleTTL = 12 * time.Hour
	)

	isComplete := func(payload *metadata.AniListMangaMetadata) bool {
		return payload != nil && payload.DetailHydrated
	}
	loadFresh := func() (*metadata.AniListMangaMetadata, error) {
		detail, err := loader()
		if detail != nil {
			detail.DetailHydrated = true
		}
		return detail, err
	}

	fullCacheKey := fmt.Sprintf("anilist:manga:id:v3:%d", anilistID)
	if cached, ok := readAppCachedJSON[*metadata.AniListMangaMetadata](fullCacheKey); ok && isComplete(cached) {
		return cached, "fresh_cache", nil
	}
	if stale, ok := readAppCachedJSON[*metadata.AniListMangaMetadata](staleAppCacheKey(fullCacheKey)); ok && isComplete(stale) {
		return stale, "stale_cache", nil
	}

	persistentKey := "cache:" + fullCacheKey
	if persisted, origin, ok := readPersistentJSONSnapshot[*metadata.AniListMangaMetadata](database, persistentKey, time.Now()); ok && isComplete(persisted) {
		writeAppCachedJSON(staleAppCacheKey(fullCacheKey), staleTTL, persisted)
		if origin == "persistent_fresh_cache" {
			writeAppCachedJSON(fullCacheKey, freshTTL, persisted)
			return persisted, origin, nil
		}

		go func() {
			refreshed, err := loadFresh()
			if err != nil || refreshed == nil {
				return
			}
			writeAppCachedJSON(fullCacheKey, freshTTL, refreshed)
			writeAppCachedJSON(staleAppCacheKey(fullCacheKey), staleTTL, refreshed)
			writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, refreshed)
		}()

		return persisted, origin, nil
	}

	result, err := loadFresh()
	if err != nil {
		return nil, "", err
	}
	if result != nil {
		writeAppCachedJSON(fullCacheKey, freshTTL, result)
		writeAppCachedJSON(staleAppCacheKey(fullCacheKey), staleTTL, result)
		writePersistentJSONSnapshot(database, persistentKey, freshTTL, staleTTL, result)
	}
	return result, "network", nil
}
