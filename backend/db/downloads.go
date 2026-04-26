package db

// DownloadEntry represents a download record in the database.
type DownloadEntry struct {
	ID           int     `json:"id"`
	AnimeTitle   string  `json:"anime_title"`
	EpisodeNum   float64 `json:"episode_num"`
	EpisodeTitle string  `json:"episode_title"`
	CoverURL     string  `json:"cover_url"`
	SourceURL    string  `json:"source_url"`
	FilePath     string  `json:"file_path"`
	FileName     string  `json:"file_name"`
	FileSize     int64   `json:"file_size"`
	Downloaded   int64   `json:"downloaded"`
	Status       string  `json:"status"`
	Progress     float64 `json:"progress"`
	ErrorMsg     string  `json:"error_msg"`
	CreatedAt    string  `json:"created_at"`
	CompletedAt  string  `json:"completed_at"`
}

// InsertDownload creates a new download record and returns its ID.
func (d *Database) InsertDownload(animeTitle string, episodeNum float64, episodeTitle, coverURL, sourceURL string) (int, error) {
	result, err := d.conn.Exec(`
		INSERT INTO downloads (anime_title, episode_num, episode_title, cover_url, source_url, status)
		VALUES (?, ?, ?, ?, ?, 'pending')
	`, animeTitle, episodeNum, episodeTitle, coverURL, sourceURL)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	return int(id), err
}

// UpdateDownloadProgress updates the progress of a download.
func (d *Database) UpdateDownloadProgress(id int, downloaded, fileSize int64, progress float64) error {
	_, err := d.conn.Exec(`
		UPDATE downloads SET downloaded = ?, file_size = ?, progress = ?, status = 'downloading'
		WHERE id = ?
	`, downloaded, fileSize, progress, id)
	return err
}

// CompleteDownload marks a download as completed.
func (d *Database) CompleteDownload(id int, filePath string, fileSize int64) error {
	_, err := d.conn.Exec(`
		UPDATE downloads SET status = 'completed', file_path = ?, file_size = ?,
		       downloaded = ?, progress = 100, completed_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, filePath, fileSize, fileSize, id)
	return err
}

// FailDownload marks a download as failed with an error message.
func (d *Database) FailDownload(id int, errMsg string) error {
	_, err := d.conn.Exec(`
		UPDATE downloads SET status = 'failed', error_msg = ?
		WHERE id = ?
	`, errMsg, id)
	return err
}

// CancelDownload marks a download as cancelled.
func (d *Database) CancelDownload(id int) error {
	_, err := d.conn.Exec(`
		UPDATE downloads SET status = 'cancelled'
		WHERE id = ?
	`, id)
	return err
}

// GetDownloads returns all downloads ordered by most recent first.
func (d *Database) GetDownloads() ([]DownloadEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anime_title, episode_num, COALESCE(episode_title, ''),
		       COALESCE(cover_url, ''), source_url, COALESCE(file_path, ''),
		       COALESCE(file_name, ''), file_size, downloaded, status, progress,
		       COALESCE(error_msg, ''), created_at, COALESCE(completed_at, '')
		FROM downloads
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDownloadRows(rows)
}

// GetDownloadByID returns a single download record by id.
func (d *Database) GetDownloadByID(id int) (*DownloadEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anime_title, episode_num, COALESCE(episode_title, ''),
		       COALESCE(cover_url, ''), source_url, COALESCE(file_path, ''),
		       COALESCE(file_name, ''), file_size, downloaded, status, progress,
		       COALESCE(error_msg, ''), created_at, COALESCE(completed_at, '')
		FROM downloads
		WHERE id = ?
		LIMIT 1
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := scanDownloadRows(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

// GetActiveDownloads returns downloads that are pending or in progress.
func (d *Database) GetActiveDownloads() ([]DownloadEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anime_title, episode_num, COALESCE(episode_title, ''),
		       COALESCE(cover_url, ''), source_url, COALESCE(file_path, ''),
		       COALESCE(file_name, ''), file_size, downloaded, status, progress,
		       COALESCE(error_msg, ''), created_at, COALESCE(completed_at, '')
		FROM downloads
		WHERE status IN ('pending', 'downloading')
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDownloadRows(rows)
}

// GetCompletedDownloads returns only completed downloads.
func (d *Database) GetCompletedDownloads() ([]DownloadEntry, error) {
	rows, err := d.conn.Query(`
		SELECT id, anime_title, episode_num, COALESCE(episode_title, ''),
		       COALESCE(cover_url, ''), source_url, COALESCE(file_path, ''),
		       COALESCE(file_name, ''), file_size, downloaded, status, progress,
		       COALESCE(error_msg, ''), created_at, COALESCE(completed_at, '')
		FROM downloads
		WHERE status = 'completed'
		ORDER BY completed_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDownloadRows(rows)
}

// RemoveDownload deletes a download record.
func (d *Database) RemoveDownload(id int) error {
	_, err := d.conn.Exec(`DELETE FROM downloads WHERE id = ?`, id)
	return err
}

// ClearCompletedDownloads removes all completed downloads.
func (d *Database) ClearCompletedDownloads() error {
	_, err := d.conn.Exec(`DELETE FROM downloads WHERE status IN ('completed', 'failed', 'cancelled')`)
	return err
}

func scanDownloadRows(rows interface {
	Next() bool
	Scan(...interface{}) error
}) ([]DownloadEntry, error) {
	var out []DownloadEntry
	for rows.Next() {
		var e DownloadEntry
		if err := rows.Scan(
			&e.ID, &e.AnimeTitle, &e.EpisodeNum, &e.EpisodeTitle,
			&e.CoverURL, &e.SourceURL, &e.FilePath,
			&e.FileName, &e.FileSize, &e.Downloaded, &e.Status, &e.Progress,
			&e.ErrorMsg, &e.CreatedAt, &e.CompletedAt,
		); err != nil {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}
