package db

// dashboard.go — queries that power the home page dashboard.
// All data comes from local SQLite — zero network calls.

// ─────────────────────────────────────────────────────────────────────────────
// Anime dashboard rows
// ─────────────────────────────────────────────────────────────────────────────

// ContinueWatchingItem represents an in-progress episode.
type ContinueWatchingItem struct {
	AnimeID      int     `json:"anime_id"`
	AnimeTitle   string  `json:"anime_title"`
	CoverImage   string  `json:"cover_image"`
	BannerImage  string  `json:"banner_image"`
	EpisodeID    int     `json:"episode_id"`
	EpisodeNum   float64 `json:"episode_num"`
	EpisodeTitle string  `json:"episode_title"`
	ProgressSec  int     `json:"progress_sec"`
	DurationSec  int     `json:"duration_sec"`
	Percent      float64 `json:"percent"`
}

// GetContinueWatching returns episodes that have been started but not finished.
func (d *Database) GetContinueWatching(limit int) ([]ContinueWatchingItem, error) {
	rows, err := d.conn.Query(`
		SELECT
			a.id, COALESCE(a.title_spanish, a.title_english, a.title_romaji, '') as title,
			COALESCE(a.cover_image, '') as cover,
			COALESCE(a.banner_image, '') as banner,
			e.id, COALESCE(e.episode_num, 0),
			COALESCE(e.title_es, e.title, '') as ep_title,
			e.progress_s, COALESCE(e.duration_s, 0)
		FROM episodes e
		JOIN anime a ON a.id = e.anime_id
		WHERE e.progress_s > 0 AND e.watched = FALSE
		ORDER BY e.rowid DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ContinueWatchingItem
	for rows.Next() {
		var item ContinueWatchingItem
		if err := rows.Scan(
			&item.AnimeID, &item.AnimeTitle, &item.CoverImage, &item.BannerImage,
			&item.EpisodeID, &item.EpisodeNum, &item.EpisodeTitle,
			&item.ProgressSec, &item.DurationSec,
		); err != nil {
			continue
		}
		if item.DurationSec > 0 {
			item.Percent = float64(item.ProgressSec) / float64(item.DurationSec) * 100
		}
		out = append(out, item)
	}
	return out, nil
}

// RecentAnimeItem is a recently added anime entry.
type RecentAnimeItem struct {
	ID            int    `json:"id"`
	Title         string `json:"title"`
	CoverImage    string `json:"cover_image"`
	BannerImage   string `json:"banner_image"`
	Year          int    `json:"year"`
	EpisodesTotal int    `json:"episodes_total"`
	WatchedCount  int    `json:"watched_count"`
}

// GetRecentAnime returns the most recently added anime entries.
func (d *Database) GetRecentAnime(limit int) ([]RecentAnimeItem, error) {
	rows, err := d.conn.Query(`
		SELECT
			a.id,
			COALESCE(a.title_spanish, a.title_english, a.title_romaji, '') as title,
			COALESCE(a.cover_image, '') as cover,
			COALESCE(a.banner_image, '') as banner,
			COALESCE(a.year, 0),
			COALESCE(a.episodes_total, 0),
			(SELECT COUNT(*) FROM episodes e WHERE e.anime_id = a.id AND e.watched = TRUE) as watched
		FROM anime a
		ORDER BY a.created_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RecentAnimeItem
	for rows.Next() {
		var item RecentAnimeItem
		if err := rows.Scan(
			&item.ID, &item.Title, &item.CoverImage, &item.BannerImage,
			&item.Year, &item.EpisodesTotal, &item.WatchedCount,
		); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

// CompletedAnimeItem is a fully watched anime series.
type CompletedAnimeItem struct {
	ID            int    `json:"id"`
	Title         string `json:"title"`
	CoverImage    string `json:"cover_image"`
	BannerImage   string `json:"banner_image"`
	EpisodesTotal int    `json:"episodes_total"`
}

// GetCompletedAnime returns anime where all episodes are watched.
func (d *Database) GetCompletedAnime(limit int) ([]CompletedAnimeItem, error) {
	rows, err := d.conn.Query(`
		SELECT a.id,
			COALESCE(a.title_spanish, a.title_english, a.title_romaji, '') as title,
			COALESCE(a.cover_image, '') as cover,
			COALESCE(a.banner_image, '') as banner,
			COALESCE(a.episodes_total, 0)
		FROM anime a
		WHERE a.episodes_total > 0
		AND (SELECT COUNT(*) FROM episodes e WHERE e.anime_id = a.id AND e.watched = FALSE) = 0
		AND (SELECT COUNT(*) FROM episodes e WHERE e.anime_id = a.id) > 0
		ORDER BY a.updated_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CompletedAnimeItem
	for rows.Next() {
		var item CompletedAnimeItem
		if err := rows.Scan(&item.ID, &item.Title, &item.CoverImage, &item.BannerImage, &item.EpisodesTotal); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Manga dashboard rows
// ─────────────────────────────────────────────────────────────────────────────

// ContinueReadingItem represents an in-progress manga chapter.
type ContinueReadingItem struct {
	MangaID      int     `json:"manga_id"`
	MangaTitle   string  `json:"manga_title"`
	CoverImage   string  `json:"cover_image"`
	ChapterID    int     `json:"chapter_id"`
	ChapterNum   float64 `json:"chapter_num"`
	ChapterTitle string  `json:"chapter_title"`
	ProgressPage int     `json:"progress_page"`
}

// GetContinueReading returns manga chapters that have been started but not finished.
func (d *Database) GetContinueReading(limit int) ([]ContinueReadingItem, error) {
	rows, err := d.conn.Query(`
		SELECT
			m.id, COALESCE(m.title_spanish, m.title_english, m.title_romaji, '') as title,
			COALESCE(m.cover_image, '') as cover,
			c.id, COALESCE(c.chapter_num, 0),
			COALESCE(c.title_es, c.title, '') as ch_title,
			c.progress_page
		FROM chapters c
		JOIN manga m ON m.id = c.manga_id
		WHERE c.progress_page > 0 AND c.read = FALSE
		ORDER BY c.rowid DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ContinueReadingItem
	for rows.Next() {
		var item ContinueReadingItem
		if err := rows.Scan(
			&item.MangaID, &item.MangaTitle, &item.CoverImage,
			&item.ChapterID, &item.ChapterNum, &item.ChapterTitle,
			&item.ProgressPage,
		); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

// RecentMangaItem is a recently added manga entry.
type RecentMangaItem struct {
	ID            int    `json:"id"`
	Title         string `json:"title"`
	CoverImage    string `json:"cover_image"`
	Year          int    `json:"year"`
	ChaptersTotal int    `json:"chapters_total"`
	ReadCount     int    `json:"read_count"`
}

// GetRecentManga returns the most recently added manga entries.
func (d *Database) GetRecentManga(limit int) ([]RecentMangaItem, error) {
	rows, err := d.conn.Query(`
		SELECT
			m.id,
			COALESCE(m.title_spanish, m.title_english, m.title_romaji, '') as title,
			COALESCE(m.cover_image, '') as cover,
			COALESCE(m.year, 0),
			COALESCE(m.chapters_total, 0),
			(SELECT COUNT(*) FROM chapters c WHERE c.manga_id = m.id AND c.read = TRUE) as read_count
		FROM manga m
		ORDER BY m.created_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RecentMangaItem
	for rows.Next() {
		var item RecentMangaItem
		if err := rows.Scan(
			&item.ID, &item.Title, &item.CoverImage,
			&item.Year, &item.ChaptersTotal, &item.ReadCount,
		); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Full dashboard bundle — single call for the home page
// ─────────────────────────────────────────────────────────────────────────────

// DashboardData is everything the home page needs in one struct.
type DashboardData struct {
	ContinueWatching       []ContinueWatchingItem `json:"continue_watching"`
	ContinueWatchingOnline []WatchHistoryEntry    `json:"continue_watching_online"`
	RecentlyWatched        []WatchHistoryEntry    `json:"recently_watched"`
	RecentAnime            []RecentAnimeItem      `json:"recent_anime"`
	CompletedAnime         []CompletedAnimeItem   `json:"completed_anime"`
	ContinueReading        []ContinueReadingItem  `json:"continue_reading"`
	RecentManga            []RecentMangaItem      `json:"recent_manga"`
	WatchingList           []AnimeListEntry       `json:"watching_list"`
	PlanningList           []AnimeListEntry       `json:"planning_list"`
	CompletedList          []AnimeListEntry       `json:"completed_list"`
	OnHoldList             []AnimeListEntry       `json:"on_hold_list"`
	Stats                  map[string]int         `json:"stats"`
}

// GetDashboard returns all home page data in a single DB round-trip bundle.
func (d *Database) GetDashboard() (*DashboardData, error) {
	dash := &DashboardData{}
	var err error

	dash.ContinueWatching, err = d.GetContinueWatching(10)
	if err != nil {
		return nil, err
	}
	dash.ContinueWatchingOnline, err = d.GetContinueWatchingOnline(10)
	if err != nil {
		return nil, err
	}
	dash.RecentlyWatched, err = d.GetRecentlyWatched(12)
	if err != nil {
		return nil, err
	}
	dash.RecentAnime, err = d.GetRecentAnime(12)
	if err != nil {
		return nil, err
	}
	dash.CompletedAnime, err = d.GetCompletedAnime(12)
	if err != nil {
		return nil, err
	}
	dash.ContinueReading, err = d.GetContinueReading(10)
	if err != nil {
		return nil, err
	}
	dash.RecentManga, err = d.GetRecentManga(12)
	if err != nil {
		return nil, err
	}
	dash.WatchingList, err = d.GetAnimeListByStatus("WATCHING")
	if err != nil {
		dash.WatchingList = nil // non-fatal
	}
	dash.PlanningList, err = d.GetAnimeListByStatus("PLANNING")
	if err != nil {
		dash.PlanningList = nil
	}
	dash.CompletedList, err = d.GetAnimeListByStatus("COMPLETED")
	if err != nil {
		dash.CompletedList = nil
	}
	dash.OnHoldList, err = d.GetAnimeListByStatus("ON_HOLD")
	if err != nil {
		dash.OnHoldList = nil
	}

	// Stats — use temp vars because Go can't take address of map values
	stats := map[string]int{}
	var nAnime, nManga, nWatched, nRead, nEpisodes, nChapters, nOnline int
	_ = d.conn.QueryRow(`SELECT COUNT(*) FROM anime`).Scan(&nAnime)
	_ = d.conn.QueryRow(`SELECT COUNT(*) FROM manga`).Scan(&nManga)
	_ = d.conn.QueryRow(`SELECT COUNT(*) FROM episodes WHERE watched = TRUE`).Scan(&nWatched)
	_ = d.conn.QueryRow(`SELECT COUNT(*) FROM chapters WHERE read = TRUE`).Scan(&nRead)
	_ = d.conn.QueryRow(`SELECT COUNT(*) FROM episodes`).Scan(&nEpisodes)
	_ = d.conn.QueryRow(`SELECT COUNT(*) FROM chapters`).Scan(&nChapters)
	_ = d.conn.QueryRow(`SELECT COUNT(DISTINCT anime_id) FROM watch_history`).Scan(&nOnline)
	stats["anime"] = nAnime
	stats["manga"] = nManga
	stats["watched"] = nWatched
	stats["read"] = nRead
	stats["episodes"] = nEpisodes
	stats["chapters"] = nChapters
	stats["online_anime"] = nOnline
	dash.Stats = stats

	return dash, nil
}
