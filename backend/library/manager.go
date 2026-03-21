package library

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"miruro/backend/db"
	"miruro/backend/metadata"
)

type Manager struct {
	db   *db.Database
	meta *metadata.Manager
}

func NewManager(database *db.Database) *Manager {
	return &Manager{
		db:   database,
		meta: metadata.NewManager(),
	}
}

var animeExtensions = map[string]bool{
	".mkv": true, ".mp4": true, ".avi": true, ".webm": true,
	".mov": true, ".m4v": true, ".ogv": true,
}

var mangaExtensions = map[string]bool{
	".cbz": true, ".cbr": true, ".cb7": true, ".pdf": true, ".zip": true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan + enrich
// ─────────────────────────────────────────────────────────────────────────────

// Scan walks rootPath, indexes all media files, then fires metadata matching
// for any new entries that don't yet have an AniList/MangaDex ID.
func (m *Manager) Scan(rootPath string) (map[string]interface{}, error) {
	animeFound, mangaFound, filesScanned := 0, 0, 0
	var errs []string

	err := filepath.WalkDir(rootPath, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			errs = append(errs, walkErr.Error())
			return nil
		}
		if entry.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		filesScanned++

		switch {
		case animeExtensions[ext]:
			if err := m.indexAnimeFile(path); err != nil {
				errs = append(errs, fmt.Sprintf("anime: %v", err))
			} else {
				animeFound++
			}
		case mangaExtensions[ext]:
			if err := m.indexMangaFile(path); err != nil {
				errs = append(errs, fmt.Sprintf("manga: %v", err))
			} else {
				mangaFound++
			}
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}

	// Enrich all unmatched anime with AniList metadata
	enrichedAnime, enrichErrAnime := m.enrichUnmatchedAnime()
	// Enrich all unmatched manga with MangaDex metadata
	enrichedManga, enrichErrManga := m.enrichUnmatchedManga()

	if enrichErrAnime != nil {
		errs = append(errs, fmt.Sprintf("anime enrichment: %v", enrichErrAnime))
	}
	if enrichErrManga != nil {
		errs = append(errs, fmt.Sprintf("manga enrichment: %v", enrichErrManga))
	}

	return map[string]interface{}{
		"anime_found":    animeFound,
		"manga_found":    mangaFound,
		"files_scanned":  filesScanned,
		"anime_enriched": enrichedAnime,
		"manga_enriched": enrichedManga,
		"errors":         errs,
	}, nil
}

// indexAnimeFile registers a video file. Parent directory = anime entry.
func (m *Manager) indexAnimeFile(path string) error {
	dir := filepath.Dir(path)
	presumedTitle := filepath.Base(dir)

	_, err := m.db.Conn().Exec(`
		INSERT OR IGNORE INTO anime (local_path, title_romaji) VALUES (?, ?)
	`, dir, presumedTitle)
	if err != nil {
		return err
	}

	var animeID int64
	if err := m.db.Conn().QueryRow(`SELECT id FROM anime WHERE local_path = ?`, dir).Scan(&animeID); err != nil {
		return err
	}

	episodeNum := parseEpisodeNumber(filepath.Base(path))
	_, err = m.db.Conn().Exec(`
		INSERT OR IGNORE INTO episodes (anime_id, file_path, episode_num) VALUES (?, ?, ?)
	`, animeID, path, episodeNum)
	return err
}

// indexMangaFile registers a manga archive/PDF. Parent directory = manga entry.
func (m *Manager) indexMangaFile(path string) error {
	dir := filepath.Dir(path)
	presumedTitle := filepath.Base(dir)

	_, err := m.db.Conn().Exec(`
		INSERT OR IGNORE INTO manga (local_path, title_romaji) VALUES (?, ?)
	`, dir, presumedTitle)
	if err != nil {
		return err
	}

	var mangaID int64
	if err := m.db.Conn().QueryRow(`SELECT id FROM manga WHERE local_path = ?`, dir).Scan(&mangaID); err != nil {
		return err
	}

	chapterNum := parseChapterNumber(filepath.Base(path))
	_, err = m.db.Conn().Exec(`
		INSERT OR IGNORE INTO chapters (manga_id, file_path, chapter_num) VALUES (?, ?, ?)
	`, mangaID, path, chapterNum)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata enrichment
// ─────────────────────────────────────────────────────────────────────────────

// enrichUnmatchedAnime finds all anime without an anilist_id and matches them.
func (m *Manager) enrichUnmatchedAnime() (int, error) {
	rows, err := m.db.Conn().Query(`
		SELECT id, title_romaji FROM anime WHERE anilist_id IS NULL OR anilist_id = 0
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type entry struct {
		id    int
		title string
	}
	var unmatched []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.title); err == nil {
			unmatched = append(unmatched, e)
		}
	}
	rows.Close()

	enriched := 0
	for _, e := range unmatched {
		meta, err := m.meta.MatchAnime(e.title)
		if err != nil || meta == nil {
			continue
		}

		_, err = m.db.Conn().Exec(`
			UPDATE anime SET
				anilist_id    = ?,
				title_romaji  = ?,
				title_english = ?,
				title_spanish = ?,
				cover_image   = ?,
				banner_image  = ?,
				synopsis      = ?,
				year          = ?,
				status        = ?,
				episodes_total = ?,
				updated_at    = CURRENT_TIMESTAMP
			WHERE id = ?
		`,
			meta.AniListID,
			nullStr(meta.TitleRomaji),
			nullStr(meta.TitleEnglish),
			nullStr(meta.TitleSpanish),
			nullStr(meta.CoverLarge),
			nullStr(meta.BannerImage),
			nullStr(meta.Description),
			meta.Year,
			nullStr(meta.Status),
			meta.Episodes,
			e.id,
		)
		if err == nil {
			enriched++
		}
	}
	return enriched, nil
}

// enrichUnmatchedManga finds all manga without a mangadex_id and matches them.
func (m *Manager) enrichUnmatchedManga() (int, error) {
	rows, err := m.db.Conn().Query(`
		SELECT id, title_romaji FROM manga WHERE mangadex_id IS NULL OR mangadex_id = ''
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type entry struct {
		id    int
		title string
	}
	var unmatched []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.title); err == nil {
			unmatched = append(unmatched, e)
		}
	}
	rows.Close()

	enriched := 0
	for _, e := range unmatched {
		meta, err := m.meta.MatchManga(e.title)
		if err != nil || meta == nil {
			continue
		}

		_, err = m.db.Conn().Exec(`
			UPDATE manga SET
				mangadex_id   = ?,
				title_romaji  = ?,
				title_english = ?,
				title_spanish = ?,
				cover_image   = ?,
				synopsis      = ?,
				synopsis_es   = ?,
				year          = ?,
				status        = ?,
				updated_at    = CURRENT_TIMESTAMP
			WHERE id = ?
		`,
			meta.MangaDexID,
			nullStr(meta.TitleRomaji),
			nullStr(meta.TitleEnglish),
			nullStr(meta.TitleSpanish),
			nullStr(meta.CoverURL),
			nullStr(meta.Description),
			nullStr(meta.DescriptionES),
			meta.Year,
			nullStr(meta.Status),
			e.id,
		)
		if err == nil {
			enriched++
		}
	}
	return enriched, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

func (m *Manager) GetStats() map[string]interface{} {
	var anime, manga, episodes, chapters int
	_ = m.db.Conn().QueryRow(`SELECT COUNT(*) FROM anime`).Scan(&anime)
	_ = m.db.Conn().QueryRow(`SELECT COUNT(*) FROM manga`).Scan(&manga)
	_ = m.db.Conn().QueryRow(`SELECT COUNT(*) FROM episodes`).Scan(&episodes)
	_ = m.db.Conn().QueryRow(`SELECT COUNT(*) FROM chapters`).Scan(&chapters)
	return map[string]interface{}{
		"anime": anime, "manga": manga,
		"episodes": episodes, "chapters": chapters,
	}
}

func (m *Manager) GetAnimeList() ([]map[string]interface{}, error) {
	rows, err := m.db.Conn().Query(`
		SELECT id, local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, banner_image, synopsis, synopsis_es, year, status, episodes_total, anilist_id
		FROM anime
		ORDER BY display_title COLLATE NOCASE
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var id, anilistID int
		var localPath, displayTitle string
		var titleRomaji, titleEnglish, titleSpanish *string
		var coverImage, bannerImage, synopsis, synopsisEs, status *string
		var year, episodesTotal *int

		if err := rows.Scan(&id, &localPath, &displayTitle,
			&titleRomaji, &titleEnglish, &titleSpanish,
			&coverImage, &bannerImage, &synopsis, &synopsisEs, &year, &status, &episodesTotal, &anilistID); err != nil {
			continue
		}
		results = append(results, map[string]interface{}{
			"id": id, "local_path": localPath,
			"display_title": displayTitle,
			"title_romaji":  titleRomaji, "title_english": titleEnglish, "title_spanish": titleSpanish,
			"cover_image": coverImage, "banner_image": bannerImage, "synopsis": synopsis, "synopsis_es": synopsisEs,
			"year": year, "status": status, "episodes_total": episodesTotal,
			"anilist_id": anilistID,
		})
	}
	return results, nil
}

func (m *Manager) GetAnimeByID(id int) (map[string]interface{}, error) {
	var localPath, displayTitle string
	var titleRomaji, titleEnglish, titleSpanish *string
	var coverImage, bannerImage, synopsis, synopsisEs, status *string
	var year, episodesTotal, anilistID int

	err := m.db.Conn().QueryRow(`
		SELECT local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, banner_image, synopsis, synopsis_es, year, status, episodes_total, anilist_id
		FROM anime WHERE id = ?
	`, id).Scan(&localPath, &displayTitle,
		&titleRomaji, &titleEnglish, &titleSpanish,
		&coverImage, &bannerImage, &synopsis, &synopsisEs, &year, &status, &episodesTotal, &anilistID)
	if err != nil {
		return nil, fmt.Errorf("anime not found: %w", err)
	}

	// Get episodes
	epRows, err := m.db.Conn().Query(`
		SELECT id, file_path, episode_num,
		       COALESCE(title_es, title, '') as ep_title,
		       progress_s, watched, duration_s
		FROM episodes WHERE anime_id = ? ORDER BY episode_num ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer epRows.Close()

	var episodes []map[string]interface{}
	for epRows.Next() {
		var epID int
		var filePath, epTitle string
		var epNum float64
		var progressS, durationS int
		var watched bool
		if err := epRows.Scan(&epID, &filePath, &epNum, &epTitle, &progressS, &watched, &durationS); err != nil {
			continue
		}
		episodes = append(episodes, map[string]interface{}{
			"id": epID, "file_path": filePath,
			"episode_num": epNum, "title": epTitle,
			"progress_s": progressS, "watched": watched, "duration_s": durationS,
		})
	}

	return map[string]interface{}{
		"id": id, "local_path": localPath,
		"display_title": displayTitle,
		"title_romaji":  titleRomaji, "title_english": titleEnglish, "title_spanish": titleSpanish,
		"cover_image": coverImage, "banner_image": bannerImage, "synopsis": synopsis, "synopsis_es": synopsisEs,
		"year": year, "status": status, "episodes_total": episodesTotal,
		"anilist_id": anilistID, "episodes": episodes,
	}, nil
}

// UpdateAnimeSynopsisES caches a Spanish synopsis scraped from an external source.
func (m *Manager) UpdateAnimeSynopsisES(id int, synopsis string) {
	m.db.Conn().Exec(`UPDATE anime SET synopsis_es = ? WHERE id = ?`, synopsis, id)
}

func (m *Manager) GetMangaList() ([]map[string]interface{}, error) {
	rows, err := m.db.Conn().Query(`
		SELECT id, local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, synopsis_es, year, status, chapters_total, mangadex_id
		FROM manga
		ORDER BY display_title COLLATE NOCASE
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var id int
		var localPath, displayTitle string
		var titleRomaji, titleEnglish, titleSpanish *string
		var coverImage, synopsisEs, status, mangadexID *string
		var year, chaptersTotal *int

		if err := rows.Scan(&id, &localPath, &displayTitle,
			&titleRomaji, &titleEnglish, &titleSpanish,
			&coverImage, &synopsisEs, &year, &status, &chaptersTotal, &mangadexID); err != nil {
			continue
		}
		results = append(results, map[string]interface{}{
			"id": id, "local_path": localPath, "display_title": displayTitle,
			"title_romaji": titleRomaji, "title_english": titleEnglish, "title_spanish": titleSpanish,
			"cover_image": coverImage, "synopsis_es": synopsisEs,
			"year": year, "status": status, "chapters_total": chaptersTotal,
			"mangadex_id": mangadexID,
		})
	}
	return results, nil
}

// GetMangaByID returns full manga info including chapter list.
func (m *Manager) GetMangaByID(id int) (map[string]interface{}, error) {
	var localPath, displayTitle string
	var titleRomaji, titleEnglish, titleSpanish *string
	var coverImage, synopsisEs, status, mangadexID *string
	var year, chaptersTotal int

	err := m.db.Conn().QueryRow(`
		SELECT local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, synopsis_es, year, status, chapters_total, mangadex_id
		FROM manga WHERE id = ?
	`, id).Scan(&localPath, &displayTitle,
		&titleRomaji, &titleEnglish, &titleSpanish,
		&coverImage, &synopsisEs, &year, &status, &chaptersTotal, &mangadexID)
	if err != nil {
		return nil, fmt.Errorf("manga not found: %w", err)
	}

	// Get chapters
	chRows, err := m.db.Conn().Query(`
		SELECT id, file_path, chapter_num, volume_num,
		       COALESCE(title_es, title, '') as ch_title,
		       read, progress_page
		FROM chapters WHERE manga_id = ? ORDER BY chapter_num ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer chRows.Close()

	var chapters []map[string]interface{}
	for chRows.Next() {
		var chID int
		var filePath, chTitle string
		var chNum, volNum float64
		var read bool
		var progressPage int
		if err := chRows.Scan(&chID, &filePath, &chNum, &volNum, &chTitle, &read, &progressPage); err != nil {
			continue
		}
		chapters = append(chapters, map[string]interface{}{
			"id": chID, "file_path": filePath,
			"chapter_num": chNum, "volume_num": volNum,
			"title": chTitle, "read": read, "progress_page": progressPage,
		})
	}

	return map[string]interface{}{
		"id": id, "local_path": localPath, "display_title": displayTitle,
		"title_romaji": titleRomaji, "title_english": titleEnglish, "title_spanish": titleSpanish,
		"cover_image": coverImage, "synopsis_es": synopsisEs,
		"year": year, "status": status, "chapters_total": chaptersTotal,
		"mangadex_id": mangadexID, "chapters": chapters,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Filename parsing
// ─────────────────────────────────────────────────────────────────────────────

func parseEpisodeNumber(filename string) float64 {
	var num float64
	fmt.Sscanf(extractNumber(filename), "%f", &num)
	return num
}

func parseChapterNumber(filename string) float64 {
	var num float64
	fmt.Sscanf(extractNumber(filename), "%f", &num)
	return num
}

func extractNumber(filename string) string {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	for i := len(base) - 1; i >= 0; i-- {
		if base[i] >= '0' && base[i] <= '9' {
			j := i
			for j > 0 && (base[j-1] >= '0' && base[j-1] <= '9' || base[j-1] == '.') {
				j--
			}
			return base[j : i+1]
		}
	}
	return "0"
}

func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
