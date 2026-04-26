package db

import "time"

// WatchHistoryEntry represents a single online episode watch event.
type WatchHistoryEntry struct {
	ID           int       `json:"id"`
	AniListID    int       `json:"anilist_id"`
	SourceID     string    `json:"source_id"`
	SourceName   string    `json:"source_name"`
	AnimeID      string    `json:"anime_id"`
	AnimeTitle   string    `json:"anime_title"`
	CoverURL     string    `json:"cover_url"`
	BannerImage  string    `json:"banner_image"`
	EpisodeID    string    `json:"episode_id"`
	EpisodeNum   float64   `json:"episode_num"`
	EpisodeTitle string    `json:"episode_title"`
	EpisodeThumb string    `json:"episode_thumbnail"`
	WatchedAt    time.Time `json:"watched_at"`
	ProgressSec  int       `json:"progress_sec"`
	DurationSec  int       `json:"duration_sec"`
	Completed    bool      `json:"completed"`
	MediaFormat  string    `json:"media_format"`
}

// RecordOnlineWatch inserts or updates an online watch history entry.
// Called when a user starts or finishes an online episode.
func (d *Database) RecordOnlineWatch(e WatchHistoryEntry) error {
	_, err := d.conn.Exec(`
		INSERT INTO watch_history
			(source_id, source_name, anime_id, anime_title, cover_url, anilist_id,
			 episode_id, episode_num, episode_title, episode_thumbnail, progress_s, duration_s, completed, hidden, watched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP)
		ON CONFLICT(source_id, episode_id) DO UPDATE SET
			source_name   = CASE WHEN COALESCE(excluded.source_name, '') <> '' THEN excluded.source_name ELSE watch_history.source_name END,
			anime_title   = CASE WHEN COALESCE(excluded.anime_title, '') <> '' THEN excluded.anime_title ELSE watch_history.anime_title END,
			cover_url     = CASE WHEN COALESCE(excluded.cover_url, '') <> '' THEN excluded.cover_url ELSE watch_history.cover_url END,
			anilist_id    = CASE WHEN excluded.anilist_id > 0 THEN excluded.anilist_id ELSE watch_history.anilist_id END,
			episode_num   = CASE WHEN excluded.episode_num > 0 THEN excluded.episode_num ELSE watch_history.episode_num END,
			episode_title = CASE WHEN COALESCE(excluded.episode_title, '') <> '' THEN excluded.episode_title ELSE watch_history.episode_title END,
			episode_thumbnail = CASE WHEN COALESCE(excluded.episode_thumbnail, '') <> '' THEN excluded.episode_thumbnail ELSE watch_history.episode_thumbnail END,
			progress_s    = excluded.progress_s,
			watched_at   = CURRENT_TIMESTAMP,
			duration_s   = CASE WHEN excluded.duration_s > 0 THEN excluded.duration_s ELSE watch_history.duration_s END,
			completed    = excluded.completed,
			hidden       = FALSE
	`,
		e.SourceID, e.SourceName, e.AnimeID, e.AnimeTitle, e.CoverURL, e.AniListID,
		e.EpisodeID, e.EpisodeNum, e.EpisodeTitle, e.EpisodeThumb, e.ProgressSec, e.DurationSec, e.Completed,
	)
	return err
}

// MarkHistoryEntryCompleted updates the completion flag for an online entry.
func (d *Database) MarkHistoryEntryCompleted(sourceID, episodeID string, completed bool) error {
	_, err := d.conn.Exec(`
		UPDATE watch_history
		SET completed = ?, watched_at = CURRENT_TIMESTAMP
		WHERE source_id = ? AND episode_id = ?
	`, completed, sourceID, episodeID)
	return err
}

// UpdateOnlineWatchProgress updates the latest progress for an online episode.
func (d *Database) UpdateOnlineWatchProgress(sourceID, episodeID string, progressSec, durationSec int, completed bool) error {
	_, err := d.conn.Exec(`
		UPDATE watch_history
		SET progress_s = ?,
		    duration_s = CASE WHEN ? > 0 THEN ? ELSE duration_s END,
		    completed = ?,
		    watched_at = CURRENT_TIMESTAMP,
		    hidden = FALSE
		WHERE source_id = ? AND episode_id = ?
	`, progressSec, durationSec, durationSec, completed, sourceID, episodeID)
	return err
}

// GetOnlineWatchProgress returns the saved progress for an online episode.
func (d *Database) GetOnlineWatchProgress(sourceID, episodeID string) (WatchHistoryEntry, error) {
	var entry WatchHistoryEntry
	var watchedAt string
	err := d.conn.QueryRow(`
		SELECT id, COALESCE(anilist_id, 0), source_id, source_name, anime_id, anime_title,
		       COALESCE(cover_url, ''), COALESCE(episode_num, 0), COALESCE(episode_title, ''),
		       COALESCE(episode_thumbnail, ''), COALESCE(progress_s, 0), COALESCE(duration_s, 0),
		       completed, watched_at
		FROM watch_history
		WHERE source_id = ? AND episode_id = ?
	`, sourceID, episodeID).Scan(
		&entry.ID, &entry.AniListID, &entry.SourceID, &entry.SourceName, &entry.AnimeID, &entry.AnimeTitle,
		&entry.CoverURL, &entry.EpisodeNum, &entry.EpisodeTitle,
		&entry.EpisodeThumb, &entry.ProgressSec, &entry.DurationSec,
		&entry.Completed, &watchedAt,
	)
	if err != nil {
		return WatchHistoryEntry{SourceID: sourceID, EpisodeID: episodeID}, nil
	}
	entry.EpisodeID = episodeID
	entry.WatchedAt, _ = time.Parse("2006-01-02 15:04:05", watchedAt)
	return entry, nil
}

// GetRecentlyWatched returns the most recently watched online anime,
// one entry per series, excluding entries hidden by the user.
func (d *Database) GetRecentlyWatched(limit int) ([]WatchHistoryEntry, error) {
	rows, err := d.conn.Query(`
		SELECT w.id, COALESCE(w.anilist_id, 0), w.source_id, w.source_name, w.anime_id, w.anime_title,
		       COALESCE(w.cover_url, ''), w.episode_id, COALESCE(w.episode_num, 0),
		       COALESCE(w.episode_title, ''), COALESCE(w.episode_thumbnail, ''), w.watched_at,
		       COALESCE(w.progress_s, 0), COALESCE(w.duration_s, 0), w.completed
		FROM watch_history w
		WHERE w.hidden = FALSE
		  AND w.id = (
			SELECT x.id
			FROM watch_history x
			WHERE x.anime_id = w.anime_id
			  AND x.source_id = w.source_id
			  AND x.hidden = FALSE
			ORDER BY x.watched_at DESC, x.id DESC
			LIMIT 1
		  )
		ORDER BY w.watched_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []WatchHistoryEntry
	for rows.Next() {
		var e WatchHistoryEntry
		var watchedAt string
		if err := rows.Scan(
			&e.ID, &e.AniListID, &e.SourceID, &e.SourceName, &e.AnimeID, &e.AnimeTitle,
			&e.CoverURL, &e.EpisodeID, &e.EpisodeNum, &e.EpisodeTitle,
			&e.EpisodeThumb, &watchedAt, &e.ProgressSec, &e.DurationSec, &e.Completed,
		); err != nil {
			continue
		}
		e.WatchedAt, _ = time.Parse("2006-01-02 15:04:05", watchedAt)
		out = append(out, e)
	}
	return out, nil
}

// GetContinueWatchingOnline returns in-progress online anime (started, not completed).
// Groups by anime so only the latest episode per series appears.
func (d *Database) GetContinueWatchingOnline(limit int) ([]WatchHistoryEntry, error) {
	rows, err := d.conn.Query(`
		SELECT w.id, COALESCE(w.anilist_id, 0), w.source_id, w.source_name, w.anime_id, w.anime_title,
		       COALESCE(w.cover_url, ''), w.episode_id, COALESCE(w.episode_num, 0),
		       COALESCE(w.episode_title, ''), COALESCE(w.episode_thumbnail, ''), w.watched_at,
		       COALESCE(w.progress_s, 0), COALESCE(w.duration_s, 0), w.completed
		FROM watch_history w
		WHERE w.completed = FALSE
		  AND COALESCE(w.progress_s, 0) > 0
		  AND w.id = (
			SELECT x.id
			FROM watch_history x
			WHERE x.anime_id = w.anime_id
			  AND x.source_id = w.source_id
			  AND x.completed = FALSE
			  AND COALESCE(x.progress_s, 0) > 0
			ORDER BY x.watched_at DESC, x.id DESC
			LIMIT 1
		  )
		ORDER BY w.watched_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []WatchHistoryEntry
	for rows.Next() {
		var e WatchHistoryEntry
		var watchedAt string
		if err := rows.Scan(
			&e.ID, &e.AniListID, &e.SourceID, &e.SourceName, &e.AnimeID, &e.AnimeTitle,
			&e.CoverURL, &e.EpisodeID, &e.EpisodeNum, &e.EpisodeTitle,
			&e.EpisodeThumb, &watchedAt, &e.ProgressSec, &e.DurationSec, &e.Completed,
		); err != nil {
			continue
		}
		e.WatchedAt, _ = time.Parse("2006-01-02 15:04:05", watchedAt)
		out = append(out, e)
	}
	return out, nil
}

// GetAnimeWatchHistory returns all watched episodes for a specific online anime.
func (d *Database) GetAnimeWatchHistory(sourceID, animeID string) ([]WatchHistoryEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, COALESCE(anilist_id, 0), source_id, source_name, anime_id, anime_title,
		       COALESCE(cover_url, ''), episode_id, COALESCE(episode_num, 0),
		       COALESCE(episode_title, ''), COALESCE(episode_thumbnail, ''), watched_at,
		       COALESCE(progress_s, 0), COALESCE(duration_s, 0), completed
		FROM watch_history
		WHERE source_id = ? AND anime_id = ?
		ORDER BY episode_num ASC
	`, sourceID, animeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []WatchHistoryEntry
	for rows.Next() {
		var e WatchHistoryEntry
		var watchedAt string
		if err := rows.Scan(
			&e.ID, &e.AniListID, &e.SourceID, &e.SourceName, &e.AnimeID, &e.AnimeTitle,
			&e.CoverURL, &e.EpisodeID, &e.EpisodeNum, &e.EpisodeTitle,
			&e.EpisodeThumb, &watchedAt, &e.ProgressSec, &e.DurationSec, &e.Completed,
		); err != nil {
			continue
		}
		e.WatchedAt, _ = time.Parse("2006-01-02 15:04:05", watchedAt)
		out = append(out, e)
	}
	return out, nil
}

// IsEpisodeWatched checks whether a specific online episode has been watched.
func (d *Database) IsEpisodeWatched(sourceID, episodeID string) bool {
	var count int
	_ = d.conn.QueryRow(`
		SELECT COUNT(*) FROM watch_history
		WHERE source_id = ? AND episode_id = ? AND completed = TRUE
	`, sourceID, episodeID).Scan(&count)
	return count > 0
}

// GetWatchedEpisodeIDs returns all watched episode IDs for a specific online anime.
func (d *Database) GetWatchedEpisodeIDs(sourceID, animeID string) (map[string]bool, error) {
	rows, err := d.conn.Query(`
		SELECT episode_id
		FROM watch_history
		WHERE source_id = ? AND anime_id = ? AND completed = TRUE
	`, sourceID, animeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]bool{}
	for rows.Next() {
		var episodeID string
		if err := rows.Scan(&episodeID); err != nil {
			continue
		}
		if episodeID != "" {
			out[episodeID] = true
		}
	}
	return out, nil
}

// ClearWatchHistory hides all watch history entries from "Historial reciente".
// Entries remain in the DB so "Continuar viendo" is unaffected.
// If a new episode is watched, that anime becomes visible again automatically.
func (d *Database) ClearWatchHistory() error {
	_, err := d.conn.Exec(`UPDATE watch_history SET hidden = TRUE`)
	return err
}

// RemoveAnimeFromHistory removes all watch history entries for a specific anime.
// Used by the "Editar" mode in "Continuar viendo" to manually remove an anime.
func (d *Database) RemoveAnimeFromHistory(sourceID, animeID string) error {
	_, err := d.conn.Exec(`
		DELETE FROM watch_history WHERE source_id = ? AND anime_id = ?
	`, sourceID, animeID)
	return err
}
