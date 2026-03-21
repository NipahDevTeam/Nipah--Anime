package db

import (
	"database/sql"
	"time"
)

type RemoteListSyncJob struct {
	ID            int       `json:"id"`
	Provider      string    `json:"provider"`
	MediaType     string    `json:"media_type"`
	Action        string    `json:"action"`
	MediaKey      string    `json:"media_key"`
	AniListID     int       `json:"anilist_id"`
	MalID         int       `json:"mal_id"`
	PayloadJSON   string    `json:"payload_json"`
	Status        string    `json:"status"`
	RetryCount    int       `json:"retry_count"`
	LastError     string    `json:"last_error"`
	QueuedAt      time.Time `json:"queued_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	LastAttemptAt time.Time `json:"last_attempt_at"`
}

func (d *Database) UpsertRemoteListSyncJob(job RemoteListSyncJob) (*RemoteListSyncJob, error) {
	row := d.conn.QueryRow(`
		INSERT INTO remote_list_sync_queue
			(provider, media_type, action, media_key, anilist_id, mal_id, payload_json, status, retry_count, last_error, queued_at, updated_at, last_attempt_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
		ON CONFLICT(provider, media_type, action, media_key) DO UPDATE SET
			anilist_id      = excluded.anilist_id,
			mal_id          = excluded.mal_id,
			payload_json    = excluded.payload_json,
			status          = 'pending',
			retry_count     = 0,
			last_error      = '',
			updated_at      = CURRENT_TIMESTAMP,
			last_attempt_at = NULL
		RETURNING id, provider, media_type, action, media_key, COALESCE(anilist_id, 0), COALESCE(mal_id, 0),
		          payload_json, status, retry_count, COALESCE(last_error, ''), queued_at, updated_at,
		          COALESCE(last_attempt_at, '')
	`, job.Provider, job.MediaType, job.Action, job.MediaKey, job.AniListID, job.MalID, job.PayloadJSON)
	return scanRemoteListSyncJob(row)
}

func (d *Database) ListRemoteListSyncJobs(provider string, limit int) ([]RemoteListSyncJob, error) {
	query := `
		SELECT id, provider, media_type, action, media_key, COALESCE(anilist_id, 0), COALESCE(mal_id, 0),
		       payload_json, status, retry_count, COALESCE(last_error, ''), queued_at, updated_at,
		       COALESCE(last_attempt_at, '')
		FROM remote_list_sync_queue
		WHERE status IN ('pending', 'failed')
	`
	args := []interface{}{}
	if provider != "" {
		query += ` AND provider = ?`
		args = append(args, provider)
	}
	query += ` ORDER BY updated_at ASC, id ASC`
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}

	rows, err := d.conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRemoteListSyncJobs(rows)
}

func (d *Database) DeleteRemoteListSyncJob(id int) error {
	_, err := d.conn.Exec(`DELETE FROM remote_list_sync_queue WHERE id = ?`, id)
	return err
}

func (d *Database) MarkRemoteListSyncJobFailed(id int, message string) error {
	_, err := d.conn.Exec(`
		UPDATE remote_list_sync_queue
		SET status = 'failed',
		    retry_count = retry_count + 1,
		    last_error = ?,
		    updated_at = CURRENT_TIMESTAMP,
		    last_attempt_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, message, id)
	return err
}

func (d *Database) MarkRemoteListSyncJobAttempted(id int) error {
	_, err := d.conn.Exec(`
		UPDATE remote_list_sync_queue
		SET updated_at = CURRENT_TIMESTAMP,
		    last_attempt_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, id)
	return err
}

func (d *Database) GetRemoteListSyncStatusCounts() (map[string]map[string]int, error) {
	rows, err := d.conn.Query(`
		SELECT provider, status, COUNT(*)
		FROM remote_list_sync_queue
		GROUP BY provider, status
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]map[string]int{}
	for rows.Next() {
		var provider, status string
		var count int
		if err := rows.Scan(&provider, &status, &count); err != nil {
			continue
		}
		if _, ok := out[provider]; !ok {
			out[provider] = map[string]int{}
		}
		out[provider][status] = count
	}
	return out, nil
}

func (d *Database) GetRemoteListSyncErrors(limit int) ([]RemoteListSyncJob, error) {
	rows, err := d.conn.Query(`
		SELECT id, provider, media_type, action, media_key, COALESCE(anilist_id, 0), COALESCE(mal_id, 0),
		       payload_json, status, retry_count, COALESCE(last_error, ''), queued_at, updated_at,
		       COALESCE(last_attempt_at, '')
		FROM remote_list_sync_queue
		WHERE status = 'failed'
		ORDER BY updated_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRemoteListSyncJobs(rows)
}

func scanRemoteListSyncJob(row interface {
	Scan(...interface{}) error
}) (*RemoteListSyncJob, error) {
	var job RemoteListSyncJob
	var queuedAt, updatedAt, lastAttemptAt string
	if err := row.Scan(
		&job.ID, &job.Provider, &job.MediaType, &job.Action, &job.MediaKey, &job.AniListID, &job.MalID,
		&job.PayloadJSON, &job.Status, &job.RetryCount, &job.LastError, &queuedAt, &updatedAt, &lastAttemptAt,
	); err != nil {
		return nil, err
	}
	job.QueuedAt = parseRemoteSyncTime(queuedAt)
	job.UpdatedAt = parseRemoteSyncTime(updatedAt)
	job.LastAttemptAt = parseRemoteSyncTime(lastAttemptAt)
	return &job, nil
}

func scanRemoteListSyncJobs(rows interface {
	Next() bool
	Scan(...interface{}) error
}) ([]RemoteListSyncJob, error) {
	var jobs []RemoteListSyncJob
	for rows.Next() {
		var job RemoteListSyncJob
		var queuedAt, updatedAt, lastAttemptAt string
		if err := rows.Scan(
			&job.ID, &job.Provider, &job.MediaType, &job.Action, &job.MediaKey, &job.AniListID, &job.MalID,
			&job.PayloadJSON, &job.Status, &job.RetryCount, &job.LastError, &queuedAt, &updatedAt, &lastAttemptAt,
		); err != nil {
			continue
		}
		job.QueuedAt = parseRemoteSyncTime(queuedAt)
		job.UpdatedAt = parseRemoteSyncTime(updatedAt)
		job.LastAttemptAt = parseRemoteSyncTime(lastAttemptAt)
		jobs = append(jobs, job)
	}
	return jobs, nil
}

func parseRemoteSyncTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	layouts := []string{
		"2006-01-02 15:04:05",
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func (d *Database) GetAnimeListEntryByAniListID(anilistID int) (*AnimeListEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anilist_id, mal_id, title, COALESCE(title_english, ''),
		       COALESCE(cover_image, ''), COALESCE(banner_image, ''), status, episodes_watched, episodes_total,
		       score, COALESCE(airing_status, ''), year, added_at, updated_at
		FROM anime_list
		WHERE anilist_id = ?
		LIMIT 1
	`, anilistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanAnimeListRows(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

type LibraryAnimeIdentity struct {
	AnimeDBID     int
	EpisodeDBID   int
	AniListID     int
	Title         string
	TitleEnglish  string
	CoverImage    string
	BannerImage   string
	EpisodesTotal int
	Year          int
	AiringStatus  string
	EpisodeNum    float64
}

func (d *Database) GetLibraryAnimeIdentityByEpisodeID(episodeID int) (*LibraryAnimeIdentity, error) {
	var item LibraryAnimeIdentity
	err := d.conn.QueryRow(`
		SELECT a.id, e.id, COALESCE(a.anilist_id, 0),
		       COALESCE(a.title_romaji, ''), COALESCE(a.title_english, ''),
		       COALESCE(a.cover_image, ''), COALESCE(a.banner_image, ''),
		       COALESCE(a.episodes_total, 0), COALESCE(a.year, 0), COALESCE(a.status, ''),
		       COALESCE(e.episode_num, 0)
		FROM episodes e
		INNER JOIN anime a ON a.id = e.anime_id
		WHERE e.id = ?
		LIMIT 1
	`, episodeID).Scan(
		&item.AnimeDBID, &item.EpisodeDBID, &item.AniListID, &item.Title, &item.TitleEnglish,
		&item.CoverImage, &item.BannerImage, &item.EpisodesTotal, &item.Year, &item.AiringStatus, &item.EpisodeNum,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}
