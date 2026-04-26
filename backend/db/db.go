package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"miruro/backend/logger"

	_ "modernc.org/sqlite"
)

var log = logger.For("DB")

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
	_, statErr := os.Stat(dbPath)
	freshDB := os.IsNotExist(statErr)

	// Ensure the directory exists
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("could not create data directory: %w", err)
	}

	conn, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("could not open database: %w", err)
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)

	db := &Database{conn: conn}

	if err := db.configureConnection(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("database tuning failed: %w", err)
	}

	if err := db.migrate(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("migration failed: %w", err)
	}
	if freshDB {
		if err := db.applyFreshInstallDefaults(); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("fresh install defaults failed: %w", err)
		}
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
		cover_blurhash TEXT,
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
		cover_blurhash TEXT,
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
		anilist_id  INTEGER DEFAULT 0,
		episode_id  TEXT NOT NULL,
		episode_num REAL,
		episode_title TEXT,
		episode_thumbnail TEXT,
		progress_s  INTEGER DEFAULT 0,
		watched_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
		duration_s  INTEGER DEFAULT 0,
		completed   BOOLEAN DEFAULT FALSE,
		hidden      BOOLEAN DEFAULT FALSE,
		UNIQUE(source_id, episode_id)
	);
	CREATE INDEX IF NOT EXISTS idx_watch_history_source_anime_recent
		ON watch_history(source_id, anime_id, watched_at DESC, id DESC);
	CREATE INDEX IF NOT EXISTS idx_watch_history_visible_recent
		ON watch_history(hidden, source_id, anime_id, watched_at DESC, id DESC);
	CREATE INDEX IF NOT EXISTS idx_watch_history_continue_recent
		ON watch_history(completed, source_id, anime_id, watched_at DESC, id DESC);

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
		resolver_generation TEXT NOT NULL DEFAULT '',
		last_seen_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(source_id, source_manga_id)
	);
	CREATE INDEX IF NOT EXISTS idx_online_manga_source_map_anilist_generation
		ON online_manga_source_map(anilist_id, resolver_generation, confidence DESC, last_seen_at DESC);
	CREATE INDEX IF NOT EXISTS idx_online_manga_source_map_source_anilist_generation
		ON online_manga_source_map(source_id, anilist_id, resolver_generation, confidence DESC, last_seen_at DESC);

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
	CREATE INDEX IF NOT EXISTS idx_online_manga_history_source_recent
		ON online_manga_history(source_id, source_manga_id, read_at DESC, id DESC);
	CREATE INDEX IF NOT EXISTS idx_online_manga_history_continue_recent
		ON online_manga_history(completed, source_id, source_manga_id, read_at DESC, id DESC);

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
		('download_path', ''),
		('anime_import_path', ''),
		('preferred_quality', '1080p'),
		('preferred_audio', 'sub'),
		('anime4k_level', 'off'),
		('torrent_client_path', ''),
		('torrent_download_path', '');
	`

	_, err := d.conn.Exec(schema)
	if err != nil {
		return err
	}
	_, _ = d.conn.Exec(`ALTER TABLE anime ADD COLUMN banner_image TEXT`)
	_, _ = d.conn.Exec(`ALTER TABLE anime ADD COLUMN cover_blurhash TEXT`)
	_, _ = d.conn.Exec(`ALTER TABLE manga ADD COLUMN cover_blurhash TEXT`)
	_, _ = d.conn.Exec(`ALTER TABLE anime_list ADD COLUMN banner_image TEXT`)
	// Add hidden column to existing DBs — ignore error if already exists
	_, _ = d.conn.Exec(`ALTER TABLE watch_history ADD COLUMN hidden BOOLEAN DEFAULT FALSE`)
	_, _ = d.conn.Exec(`ALTER TABLE watch_history ADD COLUMN anilist_id INTEGER DEFAULT 0`)
	_, _ = d.conn.Exec(`ALTER TABLE watch_history ADD COLUMN episode_thumbnail TEXT`)
	_, _ = d.conn.Exec(`ALTER TABLE watch_history ADD COLUMN progress_s INTEGER DEFAULT 0`)
	_, _ = d.conn.Exec(`ALTER TABLE remote_list_sync_queue ADD COLUMN last_attempt_at DATETIME`)
	_, _ = d.conn.Exec(`ALTER TABLE online_manga_source_map ADD COLUMN resolver_generation TEXT NOT NULL DEFAULT ''`)
	if err := d.ensureLegacySchemaCompatibility(); err != nil {
		return err
	}
	return nil
}

func (d *Database) applyFreshInstallDefaults() error {
	defaultLang := preferredUILanguage()
	return d.SetSettings(map[string]string{
		"language":           defaultLang,
		"preferred_sub_lang": defaultLang,
	})
}

func (d *Database) configureConnection() error {
	pragmas := []string{
		`PRAGMA journal_mode=WAL`,
		`PRAGMA synchronous=NORMAL`,
		`PRAGMA foreign_keys=ON`,
		`PRAGMA cache_size=-32000`,
		`PRAGMA temp_store=MEMORY`,
		`PRAGMA mmap_size=134217728`,
		`PRAGMA busy_timeout=5000`,
	}

	for _, pragma := range pragmas {
		if _, err := d.conn.Exec(pragma); err != nil {
			return fmt.Errorf("%s: %w", pragma, err)
		}
	}
	return nil
}

func (d *Database) ensureLegacySchemaCompatibility() error {
	requiredColumns := []struct {
		table      string
		column     string
		definition string
	}{
		{"anime_list", "mal_id", "INTEGER DEFAULT 0"},
		{"anime_list", "title_english", "TEXT DEFAULT ''"},
		{"anime_list", "banner_image", "TEXT DEFAULT ''"},
		{"anime_list", "episodes_watched", "INTEGER DEFAULT 0"},
		{"anime_list", "episodes_total", "INTEGER DEFAULT 0"},
		{"anime_list", "score", "REAL DEFAULT 0"},
		{"anime_list", "airing_status", "TEXT DEFAULT ''"},
		{"anime_list", "year", "INTEGER DEFAULT 0"},
		{"anime_list", "added_at", "TEXT DEFAULT ''"},
		{"anime_list", "updated_at", "TEXT DEFAULT ''"},
		{"manga_list", "mal_id", "INTEGER DEFAULT 0"},
		{"manga_list", "title_english", "TEXT DEFAULT ''"},
		{"manga_list", "banner_image", "TEXT DEFAULT ''"},
		{"manga_list", "chapters_read", "INTEGER DEFAULT 0"},
		{"manga_list", "chapters_total", "INTEGER DEFAULT 0"},
		{"manga_list", "volumes_read", "INTEGER DEFAULT 0"},
		{"manga_list", "volumes_total", "INTEGER DEFAULT 0"},
		{"manga_list", "score", "REAL DEFAULT 0"},
		{"manga_list", "year", "INTEGER DEFAULT 0"},
		{"manga_list", "added_at", "TEXT DEFAULT ''"},
		{"manga_list", "updated_at", "TEXT DEFAULT ''"},
	}

	for _, column := range requiredColumns {
		if err := d.ensureColumnExists(column.table, column.column, column.definition); err != nil {
			return err
		}
	}
	return nil
}

func (d *Database) ensureColumnExists(table, column, definition string) error {
	if d.columnExists(table, column) {
		return nil
	}
	if _, err := d.conn.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)); err != nil {
		return fmt.Errorf("ensure column %s.%s: %w", table, column, err)
	}
	return nil
}

func (d *Database) columnExists(table, column string) bool {
	rows, err := d.conn.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultValue, &pk); err != nil {
			continue
		}
		if name == column {
			return true
		}
	}
	return false
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
	if err := migrateLegacyDBIfNeeded(dbPath); err != nil {
		log.Warn().Err(err).Str("path", dbPath).Msg("legacy database migration skipped")
	}
	log.Info().Str("path", dbPath).Msg("database path")
	return dbPath, nil
}

func migrateLegacyDBIfNeeded(targetPath string) error {
	if targetPath == "" {
		return nil
	}
	if _, err := os.Stat(targetPath); err == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return err
	}

	for _, candidate := range legacyDBCandidates(targetPath) {
		if candidate == "" || candidate == targetPath {
			continue
		}
		if _, err := os.Stat(candidate); err != nil {
			continue
		}
		if err := copyFile(candidate, targetPath); err != nil {
			return err
		}
		for _, suffix := range []string{"-wal", "-shm"} {
			srcSidecar := candidate + suffix
			if _, err := os.Stat(srcSidecar); err == nil {
				_ = copyFile(srcSidecar, targetPath+suffix)
			}
		}
		log.Info().Str("from", candidate).Str("to", targetPath).Msg("migrated legacy database path")
		return nil
	}
	return nil
}

func legacyDBCandidates(targetPath string) []string {
	candidates := []string{}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "nipah.db"),
			filepath.Join(exeDir, "Nipah", "nipah.db"),
			filepath.Join(exeDir, "Nipah! Anime", "nipah.db"),
		)
	}
	if configDir, err := os.UserConfigDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(configDir, "Nipah! Anime", "nipah.db"),
			filepath.Join(configDir, "nipah-anime", "nipah.db"),
		)
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		out = append(out, candidate)
	}
	return out
}

func copyFile(srcPath, dstPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := dst.ReadFrom(src); err != nil {
		return err
	}
	return nil
}
