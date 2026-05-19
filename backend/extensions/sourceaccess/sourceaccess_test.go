package sourceaccess

import (
	"net/http"
	"path/filepath"
	"testing"
	"time"
)

func TestMergeCookieHeaderPreservesExistingCookie(t *testing.T) {
	merged := mergeCookieHeader("key=episode-7", []*http.Cookie{
		{Name: "cf_clearance", Value: "abc123"},
		{Name: "session", Value: "xyz789"},
	})

	expected := "key=episode-7; cf_clearance=abc123; session=xyz789"
	if merged != expected {
		t.Fatalf("expected merged cookie header %q, got %q", expected, merged)
	}
}

func TestPersistedSessionRoundTripAndRestore(t *testing.T) {
	tempPath := filepath.Join(t.TempDir(), "sourceaccess-sessions.json")
	originalPathFn := sourceAccessSessionCachePath
	sourceAccessSessionCachePath = func() string { return tempPath }
	defer func() {
		sourceAccessSessionCachePath = originalPathFn
	}()

	profile := SourceAccessProfile{
		SourceID:      "test-sourceaccess-roundtrip",
		BaseURL:       "https://example.test",
		CookieDomains: []string{"example.test"},
		SessionTTL:    time.Hour,
	}
	RegisterProfile(profile)

	sessionMu.Lock()
	delete(sessions, profile.SourceID)
	sessionMu.Unlock()

	expiresAt := time.Now().Add(45 * time.Minute)
	cookies := []*http.Cookie{
		{Name: "clearance", Value: "allowed", Domain: ".example.test", Path: "/"},
		{Name: "other", Value: "skip-me", Domain: ".other.test", Path: "/"},
	}

	if err := persistSession(profile, cookies, expiresAt); err != nil {
		t.Fatalf("persistSession returned error: %v", err)
	}

	loadedCookies, loadedExpiresAt, ok := loadPersistedSession(profile)
	if !ok {
		t.Fatal("expected persisted session to load")
	}
	if len(loadedCookies) != 1 {
		t.Fatalf("expected one filtered cookie, got %d", len(loadedCookies))
	}
	if loadedCookies[0].Name != "clearance" || loadedCookies[0].Value != "allowed" {
		t.Fatalf("unexpected restored cookie: %+v", loadedCookies[0])
	}
	if !loadedExpiresAt.Equal(expiresAt) {
		t.Fatalf("expected expiresAt %v, got %v", expiresAt, loadedExpiresAt)
	}

	restored := validSession(profile.SourceID)
	if len(restored) != 1 || restored[0].Name != "clearance" {
		t.Fatalf("expected validSession to restore persisted cookies, got %+v", restored)
	}
}

func TestExpiredPersistedSessionIsPruned(t *testing.T) {
	tempPath := filepath.Join(t.TempDir(), "sourceaccess-sessions.json")
	originalPathFn := sourceAccessSessionCachePath
	sourceAccessSessionCachePath = func() string { return tempPath }
	defer func() {
		sourceAccessSessionCachePath = originalPathFn
	}()

	profile := SourceAccessProfile{
		SourceID:      "test-sourceaccess-expired",
		BaseURL:       "https://expired.test",
		CookieDomains: []string{"expired.test"},
		SessionTTL:    time.Hour,
	}
	RegisterProfile(profile)

	if err := persistSession(profile, []*http.Cookie{
		{Name: "expired", Value: "1", Domain: ".expired.test", Path: "/"},
	}, time.Now().Add(-5*time.Minute)); err != nil {
		t.Fatalf("persistSession returned error: %v", err)
	}

	if _, _, ok := loadPersistedSession(profile); ok {
		t.Fatal("expected expired persisted session not to load")
	}

	store, err := readPersistedSessionFile(tempPath)
	if err != nil {
		t.Fatalf("readPersistedSessionFile returned error: %v", err)
	}
	if len(store.Entries) != 0 {
		t.Fatalf("expected expired session to be pruned, found %d entries", len(store.Entries))
	}
}
