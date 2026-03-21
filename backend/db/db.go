package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Database wraps the SQLite connection.
type Database struct {
	conn *sql.DB
}

// New initializes the SQLite database, creating it if it doesn't exist.
// The database is stored in the user's app data directory.
func New() (*Database, error) {
	dbPath, err := getDBPath()
	if err != nil {
		return nil, fmt.Errorf("could not resolve DB path: %w", err)
	}

	// Ensure the directory exists
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("could not create data directory: %w", err)
	}

	conn, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("could not open database: %w", err)
	}

	db := &Database{conn: conn}

	if err := db.migrate(); err != nil {
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	return db, nil
}

// Close closes the database connection.
func (d *Database) Close() {
	if d.conn != nil {
		_ = d.conn.Close()
	}
}

// Conn returns the raw SQL connection (for repositories).
func (d *Database) Conn() *sql.DB {
	return d.conn
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Migration
// ─────────────────────────────────────────────────────────────────────────────

func (d *Database) migrate() error {
	schema := `
	-- Library paths configured by the user
	CREATE TABLE IF NOT EXISTS library_paths (
		id        INTEGER PRIMARY KEY AUTOINCREMENT,
		path      TEXT NOT NULL UNIQUE,
		type      TEXT NOT NULL CHECK(type IN ('anime', 'manga')),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Anime entries in the local library
	CREATE TABLE IF NOT EXISTS anime (
		id             INTEGER PRIMARY KEY AUTOINCREMENT,
		local_path     TEXT NOT NULL UNIQUE,
		title_romaji   TEXT,
		title_english  TEXT,
		title_spanish  TEXT,
		anilist_id     INTEGER,
		anidb_id       INTEGER,
		cover_image    TEXT,
		banner_image   TEXT,
		synopsis       TEXT,
		synopsis_es    TEXT,
		year           INTEGER,
		status         TEXT,
		episodes_total INTEGER,
		created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Individual episode files
	CREATE TABLE IF NOT EXISTS episodes (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		anime_id    INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
		file_path   TEXT NOT NULL UNIQUE,
		episode_num REAL,
		title       TEXT,
		title_es    TEXT,
		thumbnail   TEXT,
		duration_s  INTEGER,
		watched     BOOLEAN DEFAULT FALSE,
		progress_s  INTEGER DEFAULT 0,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Manga entries in the local library
	CREATE TABLE IF NOT EXISTS manga (
		id             INTEGER PRIMARY KEY AUTOINCREMENT,
		local_path     TEXT NOT NULL UNIQUE,
		title_romaji   TEXT,
		title_english  TEXT,
		title_spanish  TEXT,
		mangadex_id    TEXT,
		anilist_id     INTEGER,
		cover_image    TEXT,
		synopsis       TEXT,
		synopsis_es    TEXT,
		year           INTEGER,
		status         TEXT,
		chapters_total INTEGER,
		created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Individual chapter files (CBZ, CBR, PDF, folder)
	CREATE TABLE IF NOT EXISTS chapters (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		manga_id     INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
		file_path    TEXT NOT NULL UNIQUE,
		chapter_num  REAL,
		volume_num   REAL,
		title        TEXT,
		title_es     TEXT,
		read         BOOLEAN DEFAULT FALSE,
		progress_page INTEGER DEFAULT 0,
		created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Extension registry
	CREATE TABLE IF NOT EXISTS extensions (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		version     TEXT NOT NULL,
		author      TEXT,
		type        TEXT NOT NULL CHECK(type IN ('anime', 'manga', 'both')),
		enabled     BOOLEAN DEFAULT TRUE,
		source_url  TEXT,
		installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- User preferences / settings
	CREATE TABLE IF NOT EXISTS settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	-- Online watch history — tracks episodes watched via streaming sources.
	CREATE TABLE IF NOT EXISTS watch_history (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		source_id   TEXT NOT NULL,
		source_name TEXT NOT NULL,
		anime_id    TEXT NOT NULL,
		anime_title TEXT NOT NULL,
		cover_url   TEXT,
		episode_id  TEXT NOT NULL,
		episode_num REAL,
		episode_title TEXT,
		watched_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
		duration_s  INTEGER DEFAULT 0,
		completed   BOOLEAN DEFAULT FALSE,
		hidden      BOOLEAN DEFAULT FALSE,
		UNIQUE(source_id, episode_id)
	);

	-- User anime list (MAL-like tracking: Watching, Planning, etc.)
	CREATE TABLE IF NOT EXISTS anime_list (
		id               INTEGER PRIMARY KEY AUTOINCREMENT,
		anilist_id       INTEGER NOT NULL UNIQUE,
		mal_id           INTEGER DEFAULT 0,
		title            TEXT NOT NULL,
		title_english    TEXT,
		cover_image      TEXT,
		banner_image     TEXT,
		status           TEXT NOT NULL CHECK(status IN ('WATCHING','PLANNING','COMPLETED','ON_HOLD','DROPPED')),
		episodes_watched INTEGER DEFAULT 0,
		episodes_total   INTEGER DEFAULT 0,
		score            REAL DEFAULT 0,
		airing_status    TEXT,
		year             INTEGER DEFAULT 0,
		added_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Episode downloads (offline viewing)
	CREATE TABLE IF NOT EXISTS downloads (
		id             INTEGER PRIMARY KEY AUTOINCREMENT,
		anime_title    TEXT NOT NULL,
		episode_num    REAL NOT NULL,
		episode_title  TEXT,
		cover_url      TEXT,
		source_url     TEXT NOT NULL,
		file_path      TEXT,
		file_name      TEXT,
		file_size      INTEGER DEFAULT 0,
		downloaded     INTEGER DEFAULT 0,
		status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','downloading','completed','failed','cancelled')),
		progress       REAL DEFAULT 0,
		error_msg      TEXT,
		created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
		completed_at   DATETIME
	);

	-- OAuth tokens for AniList / MAL sign-in
	CREATE TABLE IF NOT EXISTS oauth_tokens (
		provider      TEXT PRIMARY KEY,
		access_token  TEXT NOT NULL,
		refresh_token TEXT DEFAULT '',
		username      TEXT DEFAULT '',
		user_id       INTEGER DEFAULT 0,
		avatar_url    TEXT DEFAULT '',
		expires_at    DATETIME NOT NULL,
		updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- User manga list (MAL-like tracking for manga)
	CREATE TABLE IF NOT EXISTS manga_list (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		anilist_id      INTEGER NOT NULL UNIQUE,
		mal_id          INTEGER DEFAULT 0,
		title           TEXT NOT NULL,
		title_english   TEXT,
		cover_image     TEXT,
		banner_image    TEXT,
		status          TEXT NOT NULL CHECK(status IN ('WATCHING','PLANNING','COMPLETED','ON_HOLD','DROPPED')),
		chapters_read   INTEGER DEFAULT 0,
		chapters_total  INTEGER DEFAULT 0,
		volumes_read    INTEGER DEFAULT 0,
		volumes_total   INTEGER DEFAULT 0,
		score           REAL DEFAULT 0,
		year            INTEGER DEFAULT 0,
		added_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Source-to-AniList identity map for online manga
	CREATE TABLE IF NOT EXISTS online_manga_source_map (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		source_id       TEXT NOT NULL,
		source_manga_id TEXT NOT NULL,
		source_title    TEXT NOT NULL DEFAULT '',
		anilist_id      INTEGER DEFAULT 0,
		matched_title   TEXT DEFAULT '',
		confidence      REAL DEFAULT 0,
		last_seen_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(source_id, source_manga_id)
	);

	-- Online manga reading history with canonical AniList identity when available
	CREATE TABLE IF NOT EXISTS online_manga_history (
		id                 INTEGER PRIMARY KEY AUTOINCREMENT,
		anilist_id         INTEGER DEFAULT 0,
		source_id          TEXT NOT NULL,
		source_name        TEXT NOT NULL,
		source_manga_id    TEXT NOT NULL,
		source_manga_title TEXT NOT NULL,
		cover_url          TEXT DEFAULT '',
		banner_image       TEXT DEFAULT '',
		chapter_id         TEXT NOT NULL,
		chapter_num        REAL DEFAULT 0,
		chapter_title      TEXT DEFAULT '',
		read_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
		completed          BOOLEAN DEFAULT FALSE,
		UNIQUE(source_id, chapter_id)
	);

	CREATE TABLE IF NOT EXISTS remote_list_sync_queue (
		id               INTEGER PRIMARY KEY AUTOINCREMENT,
		provider         TEXT NOT NULL CHECK(provider IN ('anilist', 'mal')),
		media_type       TEXT NOT NULL CHECK(media_type IN ('anime', 'manga')),
		action           TEXT NOT NULL CHECK(action IN ('upsert', 'delete')),
		media_key        TEXT NOT NULL,
		anilist_id       INTEGER DEFAULT 0,
		mal_id           INTEGER DEFAULT 0,
		payload_json     TEXT NOT NULL DEFAULT '{}',
		status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'failed')),
		retry_count      INTEGER NOT NULL DEFAULT 0,
		last_error       TEXT DEFAULT '',
		queued_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_attempt_at  DATETIME,
		UNIQUE(provider, media_type, action, media_key)
	);

	-- Seed default settings
	INSERT OR IGNORE INTO settings (key, value) VALUES
		('language', 'es'),
		('preferred_sub_lang', 'es'),
		('player', 'mpv'),
		('mpv_path', ''),
		('theme', 'dark'),
		('manga_reading_direction', 'ltr'),
		('data_saver', 'false'),
		('auto_scan_on_startup', 'true'),
		('preferred_quality', '1080p'),
		('preferred_audio', 'sub'),
		('torrent_client_path', ''),
		('torrent_download_path', '');
	`

	_, err := d.conn.Exec(schema)
	if err != nil {
		return err
	}
	_, _ = d.conn.Exec(`ALTER TABLE anime ADD COLUMN banner_image TEXT`)
	_, _ = d.conn.Exec(`ALTER TABLE anime_list ADD COLUMN banner_image TEXT`)
	// Add hidden column to existing DBs — ignore error if already exists
	_, _ = d.conn.Exec(`ALTER TABLE watch_history ADD COLUMN hidden BOOLEAN DEFAULT FALSE`)
	_, _ = d.conn.Exec(`ALTER TABLE remote_list_sync_queue ADD COLUMN last_attempt_at DATETIME`)
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func getDBPath() (string, error) {
	// Try AppData\Roaming first (standard Windows location)
	dataDir, err := os.UserConfigDir()
	if err != nil {
		// Fallback: use the directory where the executable lives
		exe, exeErr := os.Executable()
		if exeErr != nil {
			return "", fmt.Errorf("cannot determine data dir: %w", err)
		}
		dataDir = filepath.Dir(exe)
	}
	dbPath := filepath.Join(dataDir, "Nipah", "nipah.db")
	fmt.Printf("[DB] Database path: %s\n", dbPath)
	return dbPath, nil
}
