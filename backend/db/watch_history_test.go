package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func newWatchHistoryTestDB(t *testing.T) *Database {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "watch-history.db")
	conn, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)

	database := &Database{conn: conn}
	if err := database.configureConnection(); err != nil {
		t.Fatalf("configure sqlite: %v", err)
	}
	if err := database.migrate(); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}

	t.Cleanup(func() {
		database.Close()
	})
	return database
}

func TestWatchHistoryMigrationAddsResumeColumns(t *testing.T) {
	database := newWatchHistoryTestDB(t)

	if err := database.migrate(); err != nil {
		t.Fatalf("repeat migrate should stay idempotent: %v", err)
	}

	rows, err := database.conn.Query(`PRAGMA table_info(watch_history)`)
	if err != nil {
		t.Fatalf("pragma table_info: %v", err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var (
			cid        int
			name       string
			columnType string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultVal, &pk); err != nil {
			t.Fatalf("scan pragma row: %v", err)
		}
		columns[name] = true
	}

	for _, column := range []string{"anilist_id", "episode_thumbnail", "progress_s"} {
		if !columns[column] {
			t.Fatalf("expected watch_history column %q to exist", column)
		}
	}
}

func TestOnlineWatchProgressDrivesContinueWatchingAndCompletion(t *testing.T) {
	database := newWatchHistoryTestDB(t)

	entry := WatchHistoryEntry{
		AniListID:    21,
		SourceID:     "animeheaven-en",
		SourceName:   "AnimeHeaven",
		AnimeID:      "series-1",
		AnimeTitle:   "Example Show",
		CoverURL:     "https://cdn.test/show-cover.jpg",
		EpisodeID:    "ep-1",
		EpisodeNum:   1,
		EpisodeTitle: "Arrival",
		EpisodeThumb: "https://cdn.test/ep-1.jpg",
		Completed:    false,
	}
	if err := database.RecordOnlineWatch(entry); err != nil {
		t.Fatalf("record online watch: %v", err)
	}
	if err := database.UpdateOnlineWatchProgress("animeheaven-en", "ep-1", 312, 1440, false); err != nil {
		t.Fatalf("update watch progress: %v", err)
	}

	if err := database.RecordOnlineWatch(WatchHistoryEntry{
		SourceID:   "animeheaven-en",
		SourceName: "AnimeHeaven",
		AnimeID:    "series-2",
		AnimeTitle: "Unstarted Show",
		EpisodeID:  "ep-2",
		EpisodeNum: 1,
		Completed:  false,
	}); err != nil {
		t.Fatalf("record secondary entry: %v", err)
	}

	continueWatching, err := database.GetContinueWatchingOnline(10)
	if err != nil {
		t.Fatalf("get continue watching online: %v", err)
	}
	if len(continueWatching) != 1 {
		t.Fatalf("expected exactly one resumable entry, got %d", len(continueWatching))
	}
	if continueWatching[0].EpisodeID != "ep-1" {
		t.Fatalf("expected ep-1 to be resumable, got %q", continueWatching[0].EpisodeID)
	}
	if continueWatching[0].ProgressSec != 312 || continueWatching[0].DurationSec != 1440 {
		t.Fatalf("unexpected progress snapshot: %+v", continueWatching[0])
	}

	if watched := database.IsEpisodeWatched("animeheaven-en", "ep-1"); watched {
		t.Fatalf("episode should not count as watched until completion")
	}

	if err := database.UpdateOnlineWatchProgress("animeheaven-en", "ep-1", 1440, 1440, true); err != nil {
		t.Fatalf("complete watch progress: %v", err)
	}

	continueWatching, err = database.GetContinueWatchingOnline(10)
	if err != nil {
		t.Fatalf("get continue watching online after completion: %v", err)
	}
	if len(continueWatching) != 0 {
		t.Fatalf("expected no resumable entries after completion, got %d", len(continueWatching))
	}

	if watched := database.IsEpisodeWatched("animeheaven-en", "ep-1"); !watched {
		t.Fatalf("episode should count as watched after completion")
	}

	watchedIDs, err := database.GetWatchedEpisodeIDs("animeheaven-en", "series-1")
	if err != nil {
		t.Fatalf("get watched episode ids: %v", err)
	}
	if !watchedIDs["ep-1"] {
		t.Fatalf("expected ep-1 in watched set after completion")
	}

	if err := database.RecordOnlineWatch(WatchHistoryEntry{
		AniListID:    21,
		SourceID:     "animeheaven-en",
		SourceName:   "AnimeHeaven",
		AnimeID:      "series-1",
		AnimeTitle:   "Example Show",
		CoverURL:     "https://cdn.test/show-cover.jpg",
		EpisodeID:    "ep-1",
		EpisodeNum:   1,
		EpisodeTitle: "Arrival",
		EpisodeThumb: "https://cdn.test/ep-1.jpg",
		ProgressSec:  180,
		DurationSec:  1440,
		Completed:    false,
	}); err != nil {
		t.Fatalf("reopen completed episode: %v", err)
	}

	continueWatching, err = database.GetContinueWatchingOnline(10)
	if err != nil {
		t.Fatalf("get continue watching online after reopen: %v", err)
	}
	if len(continueWatching) != 1 || continueWatching[0].EpisodeID != "ep-1" {
		t.Fatalf("expected reopened ep-1 to become resumable again, got %+v", continueWatching)
	}
}
