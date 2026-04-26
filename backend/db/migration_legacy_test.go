package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func newLegacySchemaTestDB(t *testing.T) *Database {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "legacy-schema.db")
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

	legacySchema := []string{
		`CREATE TABLE anime_list (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			anilist_id INTEGER NOT NULL UNIQUE,
			title TEXT NOT NULL,
			cover_image TEXT,
			status TEXT NOT NULL
		)`,
		`CREATE TABLE manga_list (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			anilist_id INTEGER NOT NULL UNIQUE,
			title TEXT NOT NULL,
			cover_image TEXT,
			status TEXT NOT NULL
		)`,
	}
	for _, statement := range legacySchema {
		if _, err := database.conn.Exec(statement); err != nil {
			t.Fatalf("create legacy schema: %v", err)
		}
	}

	if err := database.migrate(); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}

	t.Cleanup(func() {
		database.Close()
	})
	return database
}

func TestLegacyListSchemaCompatibilityAddsMissingColumns(t *testing.T) {
	database := newLegacySchemaTestDB(t)

	requiredColumns := map[string][]string{
		"anime_list": {
			"mal_id",
			"title_english",
			"banner_image",
			"episodes_watched",
			"episodes_total",
			"score",
			"airing_status",
			"year",
			"added_at",
			"updated_at",
		},
		"manga_list": {
			"mal_id",
			"title_english",
			"banner_image",
			"chapters_read",
			"chapters_total",
			"volumes_read",
			"volumes_total",
			"score",
			"year",
			"added_at",
			"updated_at",
		},
	}

	for table, columns := range requiredColumns {
		for _, column := range columns {
			if !database.columnExists(table, column) {
				t.Fatalf("expected %s.%s to exist after migration", table, column)
			}
		}
	}
}
