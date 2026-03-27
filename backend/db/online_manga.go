package db

import (
	"database/sql"
	"strings"
	"time"
)

type OnlineMangaSourceMap struct {
	SourceID      string    `json:"source_id"`
	SourceMangaID string    `json:"source_manga_id"`
	SourceTitle   string    `json:"source_title"`
	AniListID     int       `json:"anilist_id"`
	MatchedTitle  string    `json:"matched_title"`
	Confidence    float64   `json:"confidence"`
	LastSeenAt    time.Time `json:"last_seen_at"`
}

type OnlineMangaHistoryEntry struct {
	ID               int       `json:"id"`
	AniListID        int       `json:"anilist_id"`
	SourceID         string    `json:"source_id"`
	SourceName       string    `json:"source_name"`
	SourceMangaID    string    `json:"source_manga_id"`
	SourceMangaTitle string    `json:"source_manga_title"`
	CoverURL         string    `json:"cover_url"`
	BannerImage      string    `json:"banner_image"`
	ChapterID        string    `json:"chapter_id"`
	ChapterNum       float64   `json:"chapter_num"`
	ChapterTitle     string    `json:"chapter_title"`
	ReadAt           time.Time `json:"read_at"`
	Completed        bool      `json:"completed"`
}

func (d *Database) GetOnlineMangaSourceMap(sourceID, sourceMangaID string) (*OnlineMangaSourceMap, error) {
	var entry OnlineMangaSourceMap
	var lastSeenAt string
	err := d.conn.QueryRow(`
		SELECT source_id, source_manga_id, COALESCE(source_title, ''), COALESCE(anilist_id, 0),
		       COALESCE(matched_title, ''), COALESCE(confidence, 0), last_seen_at
		FROM online_manga_source_map
		WHERE source_id = ? AND source_manga_id = ?
	`, sourceID, sourceMangaID).Scan(
		&entry.SourceID, &entry.SourceMangaID, &entry.SourceTitle, &entry.AniListID,
		&entry.MatchedTitle, &entry.Confidence, &lastSeenAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	entry.LastSeenAt, _ = time.Parse("2006-01-02 15:04:05", lastSeenAt)
	return &entry, nil
}

func (d *Database) UpsertOnlineMangaSourceMap(entry OnlineMangaSourceMap) error {
	_, err := d.conn.Exec(`
		INSERT INTO online_manga_source_map
			(source_id, source_manga_id, source_title, anilist_id, matched_title, confidence, last_seen_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(source_id, source_manga_id) DO UPDATE SET
			source_title  = excluded.source_title,
			anilist_id    = excluded.anilist_id,
			matched_title = excluded.matched_title,
			confidence    = excluded.confidence,
			last_seen_at  = CURRENT_TIMESTAMP
	`, entry.SourceID, entry.SourceMangaID, entry.SourceTitle, entry.AniListID, entry.MatchedTitle, entry.Confidence)
	return err
}

func (d *Database) GetOnlineMangaSourceMapsByAniListID(anilistID int) ([]OnlineMangaSourceMap, error) {
	rows, err := d.conn.Query(`
		SELECT source_id, source_manga_id, COALESCE(source_title, ''), COALESCE(anilist_id, 0),
		       COALESCE(matched_title, ''), COALESCE(confidence, 0), last_seen_at
		FROM online_manga_source_map
		WHERE anilist_id = ?
		ORDER BY confidence DESC, last_seen_at DESC, id DESC
	`, anilistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []OnlineMangaSourceMap
	for rows.Next() {
		var item OnlineMangaSourceMap
		var lastSeenAt string
		if err := rows.Scan(
			&item.SourceID, &item.SourceMangaID, &item.SourceTitle, &item.AniListID,
			&item.MatchedTitle, &item.Confidence, &lastSeenAt,
		); err != nil {
			continue
		}
		item.LastSeenAt, _ = time.Parse("2006-01-02 15:04:05", lastSeenAt)
		out = append(out, item)
	}
	return out, nil
}

func (d *Database) GetPreferredOnlineMangaSourceMap(sourceID string, anilistID int) (*OnlineMangaSourceMap, error) {
	var entry OnlineMangaSourceMap
	var lastSeenAt string
	err := d.conn.QueryRow(`
		SELECT source_id, source_manga_id, COALESCE(source_title, ''), COALESCE(anilist_id, 0),
		       COALESCE(matched_title, ''), COALESCE(confidence, 0), last_seen_at
		FROM online_manga_source_map
		WHERE source_id = ? AND anilist_id = ?
		ORDER BY confidence DESC, last_seen_at DESC, id DESC
		LIMIT 1
	`, sourceID, anilistID).Scan(
		&entry.SourceID, &entry.SourceMangaID, &entry.SourceTitle, &entry.AniListID,
		&entry.MatchedTitle, &entry.Confidence, &lastSeenAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	entry.LastSeenAt, _ = time.Parse("2006-01-02 15:04:05", lastSeenAt)
	return &entry, nil
}

func (d *Database) RecordOnlineMangaRead(entry OnlineMangaHistoryEntry) error {
	_, err := d.conn.Exec(`
		INSERT INTO online_manga_history
			(anilist_id, source_id, source_name, source_manga_id, source_manga_title, cover_url,
			 banner_image, chapter_id, chapter_num, chapter_title, completed, read_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(source_id, chapter_id) DO UPDATE SET
			anilist_id         = excluded.anilist_id,
			source_name        = excluded.source_name,
			source_manga_id    = excluded.source_manga_id,
			source_manga_title = excluded.source_manga_title,
			cover_url          = excluded.cover_url,
			banner_image       = excluded.banner_image,
			chapter_num        = excluded.chapter_num,
			chapter_title      = excluded.chapter_title,
			read_at            = CURRENT_TIMESTAMP,
			completed          = CASE
				WHEN online_manga_history.completed = TRUE AND excluded.completed = FALSE THEN TRUE
				ELSE excluded.completed
			END
	`, entry.AniListID, entry.SourceID, entry.SourceName, entry.SourceMangaID, entry.SourceMangaTitle,
		entry.CoverURL, entry.BannerImage, entry.ChapterID, entry.ChapterNum, entry.ChapterTitle, entry.Completed)
	return err
}

func (d *Database) PromoteOnlineMangaHistoryIdentity(sourceID, sourceMangaID string, anilistID int, title, coverURL, bannerURL string) error {
	if anilistID <= 0 || strings.TrimSpace(sourceID) == "" || strings.TrimSpace(sourceMangaID) == "" {
		return nil
	}
	_, err := d.conn.Exec(`
		UPDATE online_manga_history
		SET anilist_id = ?,
		    source_manga_title = CASE
		    	WHEN COALESCE(source_manga_title, '') = '' THEN ?
		    	ELSE source_manga_title
		    END,
		    cover_url = CASE
		    	WHEN COALESCE(cover_url, '') = '' THEN ?
		    	ELSE cover_url
		    END,
		    banner_image = CASE
		    	WHEN COALESCE(banner_image, '') = '' THEN ?
		    	ELSE banner_image
		    END
		WHERE source_id = ? AND source_manga_id = ?
	`, anilistID, strings.TrimSpace(title), strings.TrimSpace(coverURL), strings.TrimSpace(bannerURL), sourceID, sourceMangaID)
	return err
}

func (d *Database) MarkOnlineMangaChapterCompleted(sourceID, chapterID string, completed bool) error {
	_, err := d.conn.Exec(`
		UPDATE online_manga_history
		SET completed = ?, read_at = CURRENT_TIMESTAMP
		WHERE source_id = ? AND chapter_id = ?
	`, completed, sourceID, chapterID)
	return err
}

func (d *Database) GetOnlineMangaHistoryEntry(sourceID, chapterID string) (*OnlineMangaHistoryEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, COALESCE(anilist_id, 0), source_id, source_name, source_manga_id, source_manga_title,
		       COALESCE(cover_url, ''), COALESCE(banner_image, ''), chapter_id, COALESCE(chapter_num, 0),
		       COALESCE(chapter_title, ''), read_at, completed
		FROM online_manga_history
		WHERE source_id = ? AND chapter_id = ?
		LIMIT 1
	`, sourceID, chapterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanOnlineMangaHistoryRows(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

func (d *Database) GetRecentlyReadManga(limit int) ([]OnlineMangaHistoryEntry, error) {
	rows, err := d.conn.Query(`
		SELECT h.id,
		       COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0),
		       h.source_id,
		       h.source_name,
		       h.source_manga_id,
		       CASE
		       	WHEN COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0) > 0
		       		THEN COALESCE(NULLIF(ml.title_english, ''), NULLIF(ml.title, ''), h.source_manga_title)
		       	ELSE h.source_manga_title
		       END,
		       CASE
		       	WHEN COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0) > 0
		       		THEN COALESCE(NULLIF(ml.cover_image, ''), NULLIF(h.cover_url, ''), '')
		       	ELSE COALESCE(h.cover_url, '')
		       END,
		       CASE
		       	WHEN COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0) > 0
		       		THEN COALESCE(NULLIF(ml.banner_image, ''), NULLIF(h.banner_image, ''), '')
		       	ELSE COALESCE(h.banner_image, '')
		       END,
		       h.chapter_id, COALESCE(h.chapter_num, 0),
		       COALESCE(h.chapter_title, ''), h.read_at, h.completed
		FROM online_manga_history h
		LEFT JOIN online_manga_source_map sm
		  ON sm.source_id = h.source_id AND sm.source_manga_id = h.source_manga_id
		LEFT JOIN manga_list ml
		  ON ml.anilist_id = COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0)
		WHERE h.id = (
			SELECT x.id
			FROM online_manga_history x
			WHERE x.source_manga_id = h.source_manga_id
			  AND x.source_id = h.source_id
			ORDER BY x.read_at DESC, x.id DESC
			LIMIT 1
		)
		ORDER BY h.read_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOnlineMangaHistoryRows(rows)
}

func (d *Database) GetContinueReadingOnline(limit int) ([]OnlineMangaHistoryEntry, error) {
	rows, err := d.conn.Query(`
		SELECT h.id,
		       COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0),
		       h.source_id,
		       h.source_name,
		       h.source_manga_id,
		       CASE
		       	WHEN COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0) > 0
		       		THEN COALESCE(NULLIF(ml.title_english, ''), NULLIF(ml.title, ''), h.source_manga_title)
		       	ELSE h.source_manga_title
		       END,
		       CASE
		       	WHEN COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0) > 0
		       		THEN COALESCE(NULLIF(ml.cover_image, ''), NULLIF(h.cover_url, ''), '')
		       	ELSE COALESCE(h.cover_url, '')
		       END,
		       CASE
		       	WHEN COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0) > 0
		       		THEN COALESCE(NULLIF(ml.banner_image, ''), NULLIF(h.banner_image, ''), '')
		       	ELSE COALESCE(h.banner_image, '')
		       END,
		       h.chapter_id, COALESCE(h.chapter_num, 0),
		       COALESCE(h.chapter_title, ''), h.read_at, h.completed
		FROM online_manga_history h
		LEFT JOIN online_manga_source_map sm
		  ON sm.source_id = h.source_id AND sm.source_manga_id = h.source_manga_id
		LEFT JOIN manga_list ml
		  ON ml.anilist_id = COALESCE(NULLIF(h.anilist_id, 0), sm.anilist_id, 0)
		WHERE h.completed = FALSE
		  AND h.id = (
			SELECT x.id
			FROM online_manga_history x
			WHERE x.source_manga_id = h.source_manga_id
			  AND x.source_id = h.source_id
			  AND x.completed = FALSE
			ORDER BY x.read_at DESC, x.id DESC
			LIMIT 1
		  )
		ORDER BY h.read_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOnlineMangaHistoryRows(rows)
}

func (d *Database) BumpMangaListProgress(anilistID int, chaptersRead int) error {
	if anilistID <= 0 || chaptersRead <= 0 {
		return nil
	}
	_, err := d.conn.Exec(`
		UPDATE manga_list
		SET chapters_read = CASE
				WHEN chapters_read < ? THEN ?
				ELSE chapters_read
			END,
			updated_at = CURRENT_TIMESTAMP
		WHERE anilist_id = ?
	`, chaptersRead, chaptersRead, anilistID)
	return err
}

func (d *Database) GetMangaListEntryByAniListID(anilistID int) (*MangaListEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anilist_id, mal_id, title, COALESCE(title_english, ''),
		       COALESCE(cover_image, ''), COALESCE(banner_image, ''), status,
		       chapters_read, chapters_total, volumes_read, volumes_total,
		       score, year, added_at, updated_at
		FROM manga_list
		WHERE anilist_id = ?
		LIMIT 1
	`, anilistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanMangaListRows(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

func scanOnlineMangaHistoryRows(rows interface {
	Next() bool
	Scan(...interface{}) error
}) ([]OnlineMangaHistoryEntry, error) {
	var out []OnlineMangaHistoryEntry
	for rows.Next() {
		var item OnlineMangaHistoryEntry
		var readAt string
		if err := rows.Scan(
			&item.ID, &item.AniListID, &item.SourceID, &item.SourceName, &item.SourceMangaID, &item.SourceMangaTitle,
			&item.CoverURL, &item.BannerImage, &item.ChapterID, &item.ChapterNum, &item.ChapterTitle,
			&readAt, &item.Completed,
		); err != nil {
			continue
		}
		item.ReadAt, _ = time.Parse("2006-01-02 15:04:05", readAt)
		out = append(out, item)
	}
	return out, nil
}
