package db

import "time"

// MangaListEntry represents a manga in the user's personal list.
type MangaListEntry struct {
	ID            int       `json:"id"`
	AnilistID     int       `json:"anilist_id"`
	MalID         int       `json:"mal_id"`
	Title         string    `json:"title"`
	TitleEnglish  string    `json:"title_english"`
	CoverImage    string    `json:"cover_image"`
	BannerImage   string    `json:"banner_image"`
	Status        string    `json:"status"` // WATCHING (reading), PLANNING, COMPLETED, ON_HOLD, DROPPED
	ChaptersRead  int       `json:"chapters_read"`
	ChaptersTotal int       `json:"chapters_total"`
	VolumesRead   int       `json:"volumes_read"`
	VolumesTotal  int       `json:"volumes_total"`
	Score         float64   `json:"score"`
	Year          int       `json:"year"`
	AddedAt       time.Time `json:"added_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// UpsertMangaListEntry inserts or updates a manga in the user's list.
func (d *Database) UpsertMangaListEntry(e MangaListEntry) error {
	_, err := d.conn.Exec(`
		INSERT INTO manga_list
			(anilist_id, mal_id, title, title_english, cover_image, banner_image,
			 status, chapters_read, chapters_total, volumes_read, volumes_total, score, year)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(anilist_id) DO UPDATE SET
			mal_id         = excluded.mal_id,
			title          = excluded.title,
			title_english  = excluded.title_english,
			cover_image    = excluded.cover_image,
			banner_image   = excluded.banner_image,
			status         = excluded.status,
			chapters_read  = excluded.chapters_read,
			chapters_total = excluded.chapters_total,
			volumes_read   = excluded.volumes_read,
			volumes_total  = excluded.volumes_total,
			score          = excluded.score,
			year           = excluded.year,
			updated_at     = CURRENT_TIMESTAMP
	`, e.AnilistID, e.MalID, e.Title, e.TitleEnglish, e.CoverImage, e.BannerImage,
		e.Status, e.ChaptersRead, e.ChaptersTotal, e.VolumesRead, e.VolumesTotal, e.Score, e.Year)
	return err
}

// GetMangaListByStatus returns all manga entries with the given status.
func (d *Database) GetMangaListByStatus(status string) ([]MangaListEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anilist_id, mal_id, title, COALESCE(title_english, ''),
		       COALESCE(cover_image, ''), COALESCE(banner_image, ''), status,
		       chapters_read, chapters_total, volumes_read, volumes_total,
		       score, year, added_at, updated_at
		FROM manga_list
		WHERE status = ?
		ORDER BY updated_at DESC
	`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMangaListRows(rows)
}

// GetMangaListAll returns all manga entries.
func (d *Database) GetMangaListAll() ([]MangaListEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anilist_id, mal_id, title, COALESCE(title_english, ''),
		       COALESCE(cover_image, ''), COALESCE(banner_image, ''), status,
		       chapters_read, chapters_total, volumes_read, volumes_total,
		       score, year, added_at, updated_at
		FROM manga_list
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMangaListRows(rows)
}

// GetMangaListCounts returns the count of entries per status.
func (d *Database) GetMangaListCounts() (map[string]int, error) {
	rows, err := d.conn.Query(`SELECT status, COUNT(*) FROM manga_list GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err == nil {
			counts[status] = count
		}
	}
	return counts, nil
}

// UpdateMangaListStatus changes the status of a manga entry.
func (d *Database) UpdateMangaListStatus(anilistID int, status string) error {
	_, err := d.conn.Exec(`
		UPDATE manga_list SET status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE anilist_id = ?
	`, status, anilistID)
	return err
}

// UpdateMangaListProgress updates the read chapter count.
func (d *Database) UpdateMangaListProgress(anilistID int, chaptersRead int) error {
	_, err := d.conn.Exec(`
		UPDATE manga_list SET chapters_read = ?, updated_at = CURRENT_TIMESTAMP
		WHERE anilist_id = ?
	`, chaptersRead, anilistID)
	return err
}

// UpdateMangaListScore updates the user's score for a manga.
func (d *Database) UpdateMangaListScore(anilistID int, score float64) error {
	_, err := d.conn.Exec(`
		UPDATE manga_list SET score = ?, updated_at = CURRENT_TIMESTAMP
		WHERE anilist_id = ?
	`, score, anilistID)
	return err
}

// RemoveMangaListEntry deletes an entry from the list.
func (d *Database) RemoveMangaListEntry(anilistID int) error {
	_, err := d.conn.Exec(`DELETE FROM manga_list WHERE anilist_id = ?`, anilistID)
	return err
}

// ClearMangaList removes all manga list entries.
func (d *Database) ClearMangaList() error {
	_, err := d.conn.Exec(`DELETE FROM manga_list`)
	return err
}

func scanMangaListRows(rows interface {
	Next() bool
	Scan(...interface{}) error
}) ([]MangaListEntry, error) {
	var out []MangaListEntry
	for rows.Next() {
		var e MangaListEntry
		var addedAt, updatedAt string
		if err := rows.Scan(
			&e.ID, &e.AnilistID, &e.MalID, &e.Title, &e.TitleEnglish,
			&e.CoverImage, &e.BannerImage, &e.Status,
			&e.ChaptersRead, &e.ChaptersTotal, &e.VolumesRead, &e.VolumesTotal,
			&e.Score, &e.Year, &addedAt, &updatedAt,
		); err != nil {
			continue
		}
		e.AddedAt, _ = time.Parse("2006-01-02 15:04:05", addedAt)
		e.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
		out = append(out, e)
	}
	return out, nil
}
