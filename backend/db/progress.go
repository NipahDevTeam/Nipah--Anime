package db

// Progress handles reading and writing episode playback progress.

// EpisodeProgress holds saved progress for a single episode.
type EpisodeProgress struct {
	EpisodeID   int
	ProgressSec int
	Watched     bool
}

// SaveProgress updates the playback position for an episode.
// Automatically marks the episode as watched when percent >= 85.
func (d *Database) SaveProgress(episodeID int, positionSec float64, percent float64) error {
	watched := percent >= 85.0
	_, err := d.conn.Exec(`
		UPDATE episodes
		SET progress_s = ?, watched = ?
		WHERE id = ?
	`, int(positionSec), watched, episodeID)
	return err
}

// GetProgress returns the saved progress for an episode.
// Returns zero values if no progress has been saved yet.
func (d *Database) GetProgress(episodeID int) (EpisodeProgress, error) {
	var p EpisodeProgress
	p.EpisodeID = episodeID

	err := d.conn.QueryRow(`
		SELECT progress_s, watched FROM episodes WHERE id = ?
	`, episodeID).Scan(&p.ProgressSec, &p.Watched)

	if err != nil {
		// No row = no progress yet, return zeroes
		return EpisodeProgress{EpisodeID: episodeID}, nil
	}
	return p, nil
}

// MarkWatched explicitly marks an episode as watched and resets progress.
func (d *Database) MarkWatched(episodeID int) error {
	_, err := d.conn.Exec(`
		UPDATE episodes SET watched = TRUE, progress_s = 0 WHERE id = ?
	`, episodeID)
	return err
}

// MarkUnwatched resets an episode's watched state and progress.
func (d *Database) MarkUnwatched(episodeID int) error {
	_, err := d.conn.Exec(`
		UPDATE episodes SET watched = FALSE, progress_s = 0 WHERE id = ?
	`, episodeID)
	return err
}

// MarkAnimeEpisodesWatchedUpToAniList marks all local episodes up to the given
// episode number as watched for a library anime matched to an AniList ID.
func (d *Database) MarkAnimeEpisodesWatchedUpToAniList(anilistID int, episodesWatched int) error {
	if anilistID <= 0 || episodesWatched <= 0 {
		return nil
	}
	_, err := d.conn.Exec(`
		UPDATE episodes
		SET watched = TRUE, progress_s = 0
		WHERE anime_id IN (
			SELECT id FROM anime WHERE anilist_id = ?
		)
		AND COALESCE(episode_num, 0) > 0
		AND COALESCE(episode_num, 0) <= ?
	`, anilistID, episodesWatched)
	return err
}

// MarkMangaChaptersReadUpToAniList marks all local chapters up to the given
// chapter number as read for a library manga matched to an AniList ID.
func (d *Database) MarkMangaChaptersReadUpToAniList(anilistID int, chaptersRead int) error {
	if anilistID <= 0 || chaptersRead <= 0 {
		return nil
	}
	_, err := d.conn.Exec(`
		UPDATE chapters
		SET read = TRUE
		WHERE manga_id IN (
			SELECT id FROM manga WHERE anilist_id = ?
		)
		AND COALESCE(chapter_num, 0) > 0
		AND COALESCE(chapter_num, 0) <= ?
	`, anilistID, chaptersRead)
	return err
}

// GetNextEpisode returns the next unwatched episode for a given anime.
// Returns -1 if all episodes are watched or there is no next episode.
func (d *Database) GetNextEpisode(animeID int, currentEpisodeNum float64) (int, float64, string, error) {
	var id int
	var num float64
	var title string

	err := d.conn.QueryRow(`
		SELECT id, episode_num, COALESCE(title_es, title, '') 
		FROM episodes
		WHERE anime_id = ? AND episode_num > ? AND watched = FALSE
		ORDER BY episode_num ASC
		LIMIT 1
	`, animeID, currentEpisodeNum).Scan(&id, &num, &title)

	if err != nil {
		return -1, 0, "", nil // no next episode
	}
	return id, num, title, nil
}
