package db

import "time"

// AnimeListEntry represents an anime in the user's personal list.
// Works independently of MAL — any user can manually add anime to their lists.
type AnimeListEntry struct {
	ID              int       `json:"id"`
	AnilistID       int       `json:"anilist_id"`
	MalID           int       `json:"mal_id"`
	Title           string    `json:"title"`
	TitleEnglish    string    `json:"title_english"`
	CoverImage      string    `json:"cover_image"`
	BannerImage     string    `json:"banner_image"`
	Status          string    `json:"status"` // WATCHING, PLANNING, COMPLETED, ON_HOLD, DROPPED
	EpisodesWatched int       `json:"episodes_watched"`
	EpisodesTotal   int       `json:"episodes_total"`
	Score           float64   `json:"score"`
	AiringStatus    string    `json:"airing_status"` // FINISHED, RELEASING, etc.
	Year            int       `json:"year"`
	AddedAt         time.Time `json:"added_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// UpsertAnimeListEntry inserts or updates an anime in the user's list.
func (d *Database) UpsertAnimeListEntry(e AnimeListEntry) error {
	_, err := d.conn.Exec(`
		INSERT INTO anime_list
			(anilist_id, mal_id, title, title_english, cover_image, banner_image,
			 status, episodes_watched, episodes_total, score, airing_status, year)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(anilist_id) DO UPDATE SET
			mal_id           = excluded.mal_id,
			title            = excluded.title,
			title_english    = excluded.title_english,
			cover_image      = excluded.cover_image,
			banner_image     = excluded.banner_image,
			status           = excluded.status,
			episodes_watched = excluded.episodes_watched,
			episodes_total   = excluded.episodes_total,
			score            = excluded.score,
			airing_status    = excluded.airing_status,
			year             = excluded.year,
			updated_at       = CURRENT_TIMESTAMP
	`, e.AnilistID, e.MalID, e.Title, e.TitleEnglish, e.CoverImage, e.BannerImage,
		e.Status, e.EpisodesWatched, e.EpisodesTotal, e.Score, e.AiringStatus, e.Year)
	return err
}

// GetAnimeListByStatus returns all entries with the given status.
func (d *Database) GetAnimeListByStatus(status string) ([]AnimeListEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anilist_id, mal_id, title, COALESCE(title_english, ''),
		       COALESCE(cover_image, ''), COALESCE(banner_image, ''), status, episodes_watched, episodes_total,
		       score, COALESCE(airing_status, ''), year, added_at, updated_at
		FROM anime_list
		WHERE status = ?
		ORDER BY updated_at DESC
	`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAnimeListRows(rows)
}

// GetAnimeListAll returns all entries across all statuses.
func (d *Database) GetAnimeListAll() ([]AnimeListEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anilist_id, mal_id, title, COALESCE(title_english, ''),
		       COALESCE(cover_image, ''), COALESCE(banner_image, ''), status, episodes_watched, episodes_total,
		       score, COALESCE(airing_status, ''), year, added_at, updated_at
		FROM anime_list
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAnimeListRows(rows)
}

// GetAnimeListCounts returns the count of entries per status.
func (d *Database) GetAnimeListCounts() (map[string]int, error) {
	rows, err := d.conn.Query(`
		SELECT status, COUNT(*) FROM anime_list GROUP BY status
	`)
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

// UpdateAnimeListStatus changes the status of an entry.
func (d *Database) UpdateAnimeListStatus(anilistID int, status string) error {
	_, err := d.conn.Exec(`
		UPDATE anime_list SET status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE anilist_id = ?
	`, status, anilistID)
	return err
}

// UpdateAnimeListProgress updates the watched episode count.
func (d *Database) UpdateAnimeListProgress(anilistID int, episodesWatched int) error {
	_, err := d.conn.Exec(`
		UPDATE anime_list SET episodes_watched = ?, updated_at = CURRENT_TIMESTAMP
		WHERE anilist_id = ?
	`, episodesWatched, anilistID)
	return err
}

// UpdateAnimeListScore updates the user's score for an anime.
func (d *Database) UpdateAnimeListScore(anilistID int, score float64) error {
	_, err := d.conn.Exec(`
		UPDATE anime_list SET score = ?, updated_at = CURRENT_TIMESTAMP
		WHERE anilist_id = ?
	`, score, anilistID)
	return err
}

// RemoveAnimeListEntry deletes an entry from the list.
func (d *Database) RemoveAnimeListEntry(anilistID int) error {
	_, err := d.conn.Exec(`DELETE FROM anime_list WHERE anilist_id = ?`, anilistID)
	return err
}

// ClearAnimeList removes all entries (used before a fresh MAL import).
func (d *Database) ClearAnimeList() error {
	_, err := d.conn.Exec(`DELETE FROM anime_list`)
	return err
}

func scanAnimeListRows(rows interface {
	Next() bool
	Scan(...interface{}) error
}) ([]AnimeListEntry, error) {
	var out []AnimeListEntry
	for rows.Next() {
		var e AnimeListEntry
		var addedAt, updatedAt string
		if err := rows.Scan(
			&e.ID, &e.AnilistID, &e.MalID, &e.Title, &e.TitleEnglish,
			&e.CoverImage, &e.BannerImage, &e.Status, &e.EpisodesWatched, &e.EpisodesTotal,
			&e.Score, &e.AiringStatus, &e.Year, &addedAt, &updatedAt,
		); err != nil {
			continue
		}
		e.AddedAt, _ = time.Parse("2006-01-02 15:04:05", addedAt)
		e.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
		out = append(out, e)
	}
	return out, nil
}
