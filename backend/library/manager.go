package library

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
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
	".mov": true, ".m4v": true, ".ogv": true, ".ts": true,
}

var mangaExtensions = map[string]bool{
	".cbz": true, ".cbr": true, ".cb7": true, ".pdf": true, ".zip": true,
}

var animeBracketPattern = regexp.MustCompile(`\[[^\]]*\]|\{[^}]*\}`)
var animeTitleEpisodeTokenPattern = regexp.MustCompile(`(?i)(?:^|[\s._-])(?:episode|episodio|ep|e|ova|ona|special|batch|complete)\s*\d{0,4}.*$`)
var animeNumericSuffixPattern = regexp.MustCompile(`(?i)[\s._-]+\d{1,4}(?:v\d+)?(?:\s*[-_]\s*\d{1,4})?$`)
var animeSourceNoisePattern = regexp.MustCompile(`(?i)\b(?:1080p|720p|480p|2160p|x264|x265|hevc|av1|bluray|blu-ray|bd|web[-\s]?dl|webrip|aac|dual audio|multi sub|eng sub|subbed|dubbed)\b`)
var animeSeasonMarkerPattern = regexp.MustCompile(`(?i)\b(?:season|temporada)\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b|\bs(\d{1,2})\b|\b(?:part|cour)\s*(\d{1,2})\b`)
var animeEpisodePatternSxxExx = regexp.MustCompile(`(?i)\bs\d{1,2}\s*e(\d{1,4}(?:\.\d+)?)\b`)
var animeEpisodePatternVerbose = regexp.MustCompile(`(?i)\b(?:episode|episodio|ep|e)\s*(\d{1,4}(?:\.\d+)?)\b`)
var animeEpisodePatternDash = regexp.MustCompile(`(?:^|[\s._-])(\d{1,4}(?:\.\d+)?)(?:v\d+)?(?:$|[\s._-])`)
var animeVersionTokenPattern = regexp.MustCompile(`(?i)\bv\d+\b`)
var animeSeasonCleanupPattern = regexp.MustCompile(`(?i)\b(?:season|temporada)\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+season\b|\bs\d{1,2}\b|\b(?:part|cour)\s*\d{1,2}\b`)

// ─────────────────────────────────────────────────────────────────────────────
// Scan + enrich
// ─────────────────────────────────────────────────────────────────────────────

// Scan walks rootPath, indexes all media files, then fires metadata matching
// for any new entries that don't yet have an AniList/MangaDex ID.
func (m *Manager) Scan(rootPath string) (map[string]interface{}, error) {
	animeFound, mangaFound, filesScanned := 0, 0, 0
	animeEpisodeCount := 0
	scannedAnime := map[int64][]string{}
	seenAnime := map[int64]struct{}{}
	var errs []string
	rootIsSingleAnime := shouldTreatScanRootAsAnimeRoot(rootPath)

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
			animeRoot := resolveAnimeRootPath(path, rootPath, rootIsSingleAnime)
			animeID, _, indexErr := m.indexAnimeFileWithHint(path, "", animeRoot)
			if indexErr != nil {
				errs = append(errs, fmt.Sprintf("anime: %v", indexErr))
			} else {
				animeEpisodeCount++
				if _, ok := seenAnime[animeID]; !ok {
					seenAnime[animeID] = struct{}{}
					animeFound++
				}
				scannedAnime[animeID] = append(scannedAnime[animeID], buildAnimeTitleHints(path, "")...)
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

	enrichedAnime := 0
	for animeID, hints := range scannedAnime {
		if normalizeErr := m.normalizeAnimeEpisodeNumbers(animeID); normalizeErr != nil {
			errs = append(errs, fmt.Sprintf("anime normalize: %v", normalizeErr))
		}
		count, enrichErr := m.enrichAnimeByHints(animeID, hints)
		if enrichErr != nil {
			errs = append(errs, fmt.Sprintf("anime enrichment: %v", enrichErr))
			continue
		}
		enrichedAnime += count
	}
	fallbackAnime, enrichErrAnime := m.enrichUnmatchedAnime()
	enrichedAnime += fallbackAnime
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
		"anime_episodes": animeEpisodeCount,
		"manga_found":    mangaFound,
		"files_scanned":  filesScanned,
		"anime_enriched": enrichedAnime,
		"manga_enriched": enrichedManga,
		"errors":         errs,
	}, nil
}

// ImportDownloadedAnime indexes a completed downloaded video into the anime library
// and enriches it with AniList metadata when possible.
func (m *Manager) ImportDownloadedAnime(filePath, animeTitle, coverURL string) (map[string]interface{}, error) {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return nil, fmt.Errorf("missing file path")
	}

	info, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return m.Scan(filePath)
	}

	if !animeExtensions[strings.ToLower(filepath.Ext(filePath))] {
		return map[string]interface{}{
			"anime_found":    0,
			"manga_found":    0,
			"files_scanned":  1,
			"anime_enriched": 0,
			"manga_enriched": 0,
			"errors":         []string{fmt.Sprintf("unsupported anime file: %s", filepath.Base(filePath))},
		}, nil
	}

	hints := buildAnimeTitleHints(filePath, animeTitle)
	animeID, created, err := m.indexAnimeFileWithHint(filePath, animeTitle, filepath.Dir(filePath))
	if err != nil {
		return nil, err
	}

	if applyErr := m.applyDownloadedAnimeDefaults(animeID, animeTitle, coverURL); applyErr != nil {
		return nil, applyErr
	}

	enriched := 0
	if normalizeErr := m.normalizeAnimeEpisodeNumbers(animeID); normalizeErr != nil {
		return nil, normalizeErr
	}
	errors := []string{}
	if count, enrichErr := m.enrichAnimeByHints(animeID, hints); enrichErr == nil {
		enriched = count
	} else {
		errors = append(errors, enrichErr.Error())
	}

	return map[string]interface{}{
		"anime_found":    1,
		"manga_found":    0,
		"files_scanned":  1,
		"anime_enriched": enriched,
		"manga_enriched": 0,
		"created":        created,
		"errors":         errors,
	}, nil
}

// indexAnimeFile registers a video file. Parent directory = anime entry.
func (m *Manager) indexAnimeFile(path string) error {
	_, _, err := m.indexAnimeFileWithHint(path, "", filepath.Dir(path))
	return err
}

func (m *Manager) indexAnimeFileWithHint(path, titleHint, animeRoot string) (int64, bool, error) {
	if strings.TrimSpace(animeRoot) == "" {
		animeRoot = filepath.Dir(path)
	}
	hints := buildAnimeTitleHints(path, titleHint)
	presumedTitle := preferredAnimeTitle(animeRoot, titleHint, hints)

	animeID, created, err := m.resolveOrCreateAnimeEntry(animeRoot, presumedTitle, hints)
	if err != nil {
		return 0, false, err
	}

	episodeNum := parseEpisodeNumber(filepath.Base(path))
	_, err = m.db.Conn().Exec(`
		INSERT INTO episodes (anime_id, file_path, episode_num) VALUES (?, ?, ?)
		ON CONFLICT(file_path) DO UPDATE SET
			anime_id = excluded.anime_id,
			episode_num = excluded.episode_num
	`, animeID, path, episodeNum)
	return animeID, created, err
}

func (m *Manager) applyDownloadedAnimeDefaults(animeID int64, animeTitle, coverURL string) error {
	title := strings.TrimSpace(animeTitle)
	cover := strings.TrimSpace(coverURL)

	_, err := m.db.Conn().Exec(`
		UPDATE anime SET
			title_romaji = CASE
				WHEN ? <> '' THEN ?
				ELSE title_romaji
			END,
			title_english = CASE
				WHEN ? <> '' THEN ?
				ELSE title_english
			END,
			cover_image = CASE
				WHEN ? <> '' THEN ?
				ELSE cover_image
			END,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, title, title, title, title, cover, cover, animeID)
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

func (m *Manager) resolveOrCreateAnimeEntry(localPath, titleHint string, hints []string) (int64, bool, error) {
	var animeID int64
	err := m.db.Conn().QueryRow(`SELECT id FROM anime WHERE local_path = ?`, localPath).Scan(&animeID)
	switch {
	case err == nil:
		return animeID, false, nil
	case err != sql.ErrNoRows:
		return 0, false, err
	}

	filteredHints := filterAnimeIdentityHints(hints)
	for _, hint := range filteredHints {
		if existingID := m.findExistingAnimeID(hint); existingID > 0 {
			_ = m.promoteAnimeRootPath(existingID, localPath, titleHint)
			return existingID, false, nil
		}
	}

	_, err = m.db.Conn().Exec(`
		INSERT OR IGNORE INTO anime (local_path, title_romaji) VALUES (?, ?)
	`, localPath, titleHint)
	if err != nil {
		return 0, false, err
	}
	if err := m.db.Conn().QueryRow(`SELECT id FROM anime WHERE local_path = ?`, localPath).Scan(&animeID); err != nil {
		return 0, false, err
	}
	return animeID, true, nil
}

func (m *Manager) findExistingAnimeID(titleHint string) int64 {
	titleHint = strings.TrimSpace(titleHint)
	if titleHint == "" {
		return 0
	}
	requestedSeason := detectAnimeSeasonNumber(titleHint)

	meta, err := m.meta.MatchAnime(titleHint)
	if err == nil && meta != nil {
		if meta.AniListID > 0 {
			var animeID int64
			if scanErr := m.db.Conn().QueryRow(`SELECT id FROM anime WHERE anilist_id = ? LIMIT 1`, meta.AniListID).Scan(&animeID); scanErr == nil {
				return animeID
			}
		}
		if requestedSeason > 0 {
			return 0
		}
		for _, candidate := range []string{meta.TitleRomaji, meta.TitleEnglish, meta.TitleSpanish, titleHint} {
			if animeID := m.findExistingAnimeIDByTitle(candidate); animeID > 0 {
				return animeID
			}
		}
	}

	if requestedSeason > 0 {
		return 0
	}
	return m.findExistingAnimeIDByTitle(titleHint)
}

func (m *Manager) findExistingAnimeIDByTitle(title string) int64 {
	title = strings.TrimSpace(title)
	if title == "" {
		return 0
	}

	var animeID int64
	err := m.db.Conn().QueryRow(`
		SELECT id
		FROM anime
		WHERE lower(COALESCE(title_spanish, '')) = lower(?)
		   OR lower(COALESCE(title_english, '')) = lower(?)
		   OR lower(COALESCE(title_romaji, '')) = lower(?)
		LIMIT 1
	`, title, title, title).Scan(&animeID)
	if err != nil {
		return 0
	}
	return animeID
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
		count, enrichErr := m.enrichAnimeByHints(int64(e.id), []string{e.title})
		if enrichErr == nil {
			enriched += count
		}
	}
	return enriched, nil
}

func (m *Manager) enrichAnimeByHints(id int64, hints []string) (int, error) {
	meta, err := m.matchAnimeFromHints(hints)
	if err != nil || meta == nil {
		return 0, err
	}

	_, err = m.db.Conn().Exec(`
		UPDATE anime SET
			anilist_id    = ?,
			title_romaji  = ?,
			title_english = ?,
			title_spanish = ?,
			cover_image   = ?,
			cover_blurhash = ?,
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
		nullStr(computeCoverBlurhash(meta.CoverLarge)),
		nullStr(meta.BannerImage),
		nullStr(meta.Description),
		meta.Year,
		nullStr(meta.Status),
		meta.Episodes,
		id,
	)
	if err != nil {
		return 0, err
	}
	return 1, nil
}

func (m *Manager) matchAnimeFromHints(hints []string) (*metadata.AnimeMetadata, error) {
	seen := map[string]struct{}{}
	for _, hint := range hints {
		normalized := strings.ToLower(strings.TrimSpace(hint))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		meta, err := m.meta.MatchAnime(hint)
		if err != nil {
			return nil, err
		}
		if meta != nil {
			return meta, nil
		}
	}
	return nil, nil
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
				cover_blurhash = ?,
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
			nullStr(computeCoverBlurhash(meta.CoverURL)),
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

func (m *Manager) RepairAnimeLibraryState() (map[string]int, error) {
	rows, err := m.db.Conn().Query(`
		SELECT id, local_path
		FROM anime
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summary := map[string]int{
		"anime_checked":        0,
		"root_paths_repaired":  0,
		"empty_anime_entries":  0,
		"normalize_failures":   0,
		"path_repair_failures": 0,
	}

	type animeEntry struct {
		id        int64
		localPath string
	}
	var entries []animeEntry
	for rows.Next() {
		var entry animeEntry
		if err := rows.Scan(&entry.id, &entry.localPath); err != nil {
			continue
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, entry := range entries {
		summary["anime_checked"]++

		episodeRows, err := m.db.Conn().Query(`
			SELECT file_path
			FROM episodes
			WHERE anime_id = ?
			ORDER BY file_path COLLATE NOCASE ASC
		`, entry.id)
		if err != nil {
			summary["normalize_failures"]++
			continue
		}

		var episodePaths []string
		for episodeRows.Next() {
			var filePath string
			if err := episodeRows.Scan(&filePath); err == nil && strings.TrimSpace(filePath) != "" {
				episodePaths = append(episodePaths, filePath)
			}
		}
		episodeRows.Close()

		if len(episodePaths) == 0 {
			summary["empty_anime_entries"]++
			continue
		}

		repairedRoot := deriveAnimeRootPath(entry.localPath, episodePaths)
		if repairedRoot != "" && strings.TrimSpace(repairedRoot) != strings.TrimSpace(entry.localPath) {
			if err := m.promoteAnimeRootPath(entry.id, repairedRoot, ""); err != nil {
				summary["path_repair_failures"]++
			} else {
				summary["root_paths_repaired"]++
			}
		}

		if err := m.normalizeAnimeEpisodeNumbers(entry.id); err != nil {
			summary["normalize_failures"]++
		}
	}

	return summary, nil
}

func (m *Manager) normalizeAnimeEpisodeNumbers(animeID int64) error {
	rows, err := m.db.Conn().Query(`
		SELECT id, file_path, episode_num
		FROM episodes
		WHERE anime_id = ?
		ORDER BY file_path COLLATE NOCASE
	`, animeID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type episodeRow struct {
		id       int64
		filePath string
		episode  float64
	}
	var items []episodeRow
	distinct := map[float64]struct{}{}
	for rows.Next() {
		var item episodeRow
		if err := rows.Scan(&item.id, &item.filePath, &item.episode); err != nil {
			return err
		}
		items = append(items, item)
		if item.episode > 0 {
			distinct[item.episode] = struct{}{}
		}
	}
	if len(items) <= 1 {
		return nil
	}

	shouldRenumber := len(distinct) <= 1
	if !shouldRenumber {
		return nil
	}

	for index, item := range items {
		expected := float64(index + 1)
		if item.episode == expected {
			continue
		}
		if _, err := m.db.Conn().Exec(`UPDATE episodes SET episode_num = ? WHERE id = ?`, expected, item.id); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) GetAnimeList() ([]map[string]interface{}, error) {
	rows, err := m.db.Conn().Query(`
		SELECT id, local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, cover_blurhash, banner_image, synopsis, synopsis_es, year, status, episodes_total, anilist_id
		FROM anime
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
		var coverImage, coverBlurhash, bannerImage, synopsis, synopsisEs, status *string
		var year, episodesTotal *int
		var anilistID sql.NullInt64

		if err := rows.Scan(&id, &localPath, &displayTitle,
			&titleRomaji, &titleEnglish, &titleSpanish,
			&coverImage, &coverBlurhash, &bannerImage, &synopsis, &synopsisEs, &year, &status, &episodesTotal, &anilistID); err != nil {
			continue
		}
		coverBlurhash = m.ensureAnimeBlurhash(id, coverImage, coverBlurhash)
		results = append(results, map[string]interface{}{
			"id": id, "local_path": localPath,
			"display_title": displayTitle,
			"title_romaji":  titleRomaji, "title_english": titleEnglish, "title_spanish": titleSpanish,
			"cover_image": coverImage, "cover_blurhash": coverBlurhash, "banner_image": bannerImage, "synopsis": synopsis, "synopsis_es": synopsisEs,
			"year": year, "status": status, "episodes_total": episodesTotal,
			"anilist_id": nullableInt(anilistID),
		})
	}
	return results, nil
}

func (m *Manager) GetAnimeByID(id int) (map[string]interface{}, error) {
	var localPath, displayTitle string
	var titleRomaji, titleEnglish, titleSpanish *string
	var coverImage, coverBlurhash, bannerImage, synopsis, synopsisEs, status *string
	var year, episodesTotal sql.NullInt64
	var anilistID sql.NullInt64

	err := m.db.Conn().QueryRow(`
		SELECT local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, cover_blurhash, banner_image, synopsis, synopsis_es, year, status, episodes_total, anilist_id
		FROM anime WHERE id = ?
	`, id).Scan(&localPath, &displayTitle,
		&titleRomaji, &titleEnglish, &titleSpanish,
		&coverImage, &coverBlurhash, &bannerImage, &synopsis, &synopsisEs, &year, &status, &episodesTotal, &anilistID)
	if err != nil {
		return nil, fmt.Errorf("anime not found: %w", err)
	}
	coverBlurhash = m.ensureAnimeBlurhash(id, coverImage, coverBlurhash)

	// Get episodes
	epRows, err := m.db.Conn().Query(`
		SELECT id, file_path, episode_num,
		       COALESCE(title_es, title, '') as ep_title,
		       COALESCE(progress_s, 0), COALESCE(watched, FALSE), COALESCE(duration_s, 0)
		FROM episodes WHERE anime_id = ? ORDER BY episode_num ASC, file_path COLLATE NOCASE ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer epRows.Close()

	type episodeDetail struct {
		id        int
		filePath  string
		episode   float64
		title     string
		progressS int
		watched   bool
		durationS int
	}
	var episodeItems []episodeDetail
	var episodePaths []string

	for epRows.Next() {
		var item episodeDetail
		if err := epRows.Scan(&item.id, &item.filePath, &item.episode, &item.title, &item.progressS, &item.watched, &item.durationS); err != nil {
			continue
		}
		episodeItems = append(episodeItems, item)
		episodePaths = append(episodePaths, item.filePath)
	}

	effectiveRoot := deriveAnimeRootPath(localPath, episodePaths)
	var episodes []map[string]interface{}
	for _, item := range episodeItems {
		folderName := episodeFolderName(effectiveRoot, item.filePath)
		episodes = append(episodes, map[string]interface{}{
			"id": item.id, "file_path": item.filePath,
			"episode_num": item.episode, "title": item.title,
			"folder_name": folderName,
			"progress_s":  item.progressS, "watched": item.watched, "duration_s": item.durationS,
		})
	}

	return map[string]interface{}{
		"id": id, "local_path": effectiveRoot,
		"display_title": displayTitle,
		"title_romaji":  titleRomaji, "title_english": titleEnglish, "title_spanish": titleSpanish,
		"cover_image": coverImage, "cover_blurhash": coverBlurhash, "banner_image": bannerImage, "synopsis": synopsis, "synopsis_es": synopsisEs,
		"year": nullableInt(year), "status": status, "episodes_total": nullableInt(episodesTotal),
		"anilist_id": nullableInt(anilistID), "episodes": episodes,
	}, nil
}

// UpdateAnimeSynopsisES caches a Spanish synopsis scraped from an external source.
func (m *Manager) UpdateAnimeSynopsisES(id int, synopsis string) {
	_, _ = m.db.Conn().Exec(`UPDATE anime SET synopsis_es = ? WHERE id = ?`, synopsis, id)
}

func (m *Manager) GetMangaList() ([]map[string]interface{}, error) {
	rows, err := m.db.Conn().Query(`
		SELECT id, local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, cover_blurhash, synopsis_es, year, status, chapters_total, mangadex_id
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
		var coverImage, coverBlurhash, synopsisEs, status, mangadexID *string
		var year, chaptersTotal *int

		if err := rows.Scan(&id, &localPath, &displayTitle,
			&titleRomaji, &titleEnglish, &titleSpanish,
			&coverImage, &coverBlurhash, &synopsisEs, &year, &status, &chaptersTotal, &mangadexID); err != nil {
			continue
		}
		coverBlurhash = m.ensureMangaBlurhash(id, coverImage, coverBlurhash)
		results = append(results, map[string]interface{}{
			"id": id, "local_path": localPath, "display_title": displayTitle,
			"title_romaji": titleRomaji, "title_english": titleEnglish, "title_spanish": titleSpanish,
			"cover_image": coverImage, "cover_blurhash": coverBlurhash, "synopsis_es": synopsisEs,
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
	var coverImage, coverBlurhash, synopsisEs, status, mangadexID *string
	var year, chaptersTotal int

	err := m.db.Conn().QueryRow(`
		SELECT local_path,
		       COALESCE(title_spanish, title_english, title_romaji, '') as display_title,
		       title_romaji, title_english, title_spanish,
		       cover_image, cover_blurhash, synopsis_es, year, status, chapters_total, mangadex_id
		FROM manga WHERE id = ?
	`, id).Scan(&localPath, &displayTitle,
		&titleRomaji, &titleEnglish, &titleSpanish,
		&coverImage, &coverBlurhash, &synopsisEs, &year, &status, &chaptersTotal, &mangadexID)
	if err != nil {
		return nil, fmt.Errorf("manga not found: %w", err)
	}
	coverBlurhash = m.ensureMangaBlurhash(id, coverImage, coverBlurhash)

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
		"cover_image": coverImage, "cover_blurhash": coverBlurhash, "synopsis_es": synopsisEs,
		"year": year, "status": status, "chapters_total": chaptersTotal,
		"mangadex_id": mangadexID, "chapters": chapters,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Filename parsing
// ─────────────────────────────────────────────────────────────────────────────

func parseEpisodeNumber(filename string) float64 {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	cleaned := animeBracketPattern.ReplaceAllString(base, " ")
	cleaned = animeSourceNoisePattern.ReplaceAllString(cleaned, " ")
	cleaned = animeVersionTokenPattern.ReplaceAllString(cleaned, " ")
	cleaned = animeSeasonCleanupPattern.ReplaceAllString(cleaned, " ")
	cleaned = strings.Join(strings.Fields(strings.NewReplacer("_", " ", ".", " ").Replace(cleaned)), " ")

	if num, ok := firstEpisodeNumberFromPattern(cleaned, animeEpisodePatternSxxExx); ok {
		return num
	}
	if num, ok := firstEpisodeNumberFromPattern(cleaned, animeEpisodePatternVerbose); ok {
		return num
	}

	matches := animeEpisodePatternDash.FindAllStringSubmatch(cleaned, -1)
	for i := len(matches) - 1; i >= 0; i-- {
		if len(matches[i]) < 2 {
			continue
		}
		if num, err := strconv.ParseFloat(matches[i][1], 64); err == nil {
			return num
		}
	}

	var num float64
	if _, err := fmt.Sscanf(extractNumber(cleaned), "%f", &num); err != nil {
		num = 0
	}
	return num
}

func parseChapterNumber(filename string) float64 {
	var num float64
	if _, err := fmt.Sscanf(extractNumber(filename), "%f", &num); err != nil {
		num = 0
	}
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstHint(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func preferredAnimeTitle(animeRoot, titleHint string, hints []string) string {
	return firstNonEmpty(
		cleanAnimeTitleCandidate(titleHint),
		cleanAnimeTitleCandidate(filepath.Base(animeRoot)),
		firstStrongAnimeHint(hints),
		firstHint(hints),
		filepath.Base(animeRoot),
	)
}

func firstStrongAnimeHint(hints []string) string {
	for _, hint := range hints {
		cleaned := cleanAnimeTitleCandidate(hint)
		if cleaned != "" && !isWeakAnimeFolderHint(cleaned) {
			return cleaned
		}
	}
	return ""
}

func shouldTreatScanRootAsAnimeRoot(rootPath string) bool {
	entries, err := os.ReadDir(rootPath)
	if err != nil {
		return false
	}

	directVideoFound := false
	var childDirs []string
	for _, entry := range entries {
		if entry.IsDir() {
			childDirs = append(childDirs, entry.Name())
			continue
		}
		if animeExtensions[strings.ToLower(filepath.Ext(entry.Name()))] {
			directVideoFound = true
		}
	}
	if directVideoFound || len(childDirs) == 0 {
		return true
	}
	if len(childDirs) == 1 && !isWeakAnimeFolderHint(filepath.Base(rootPath)) {
		return true
	}
	for _, dir := range childDirs {
		if !isAnimeSubfolderName(dir) {
			return false
		}
	}
	return len(childDirs) > 0
}

func resolveAnimeRootPath(filePath, scanRoot string, rootIsSingleAnime bool) string {
	if strings.TrimSpace(scanRoot) == "" || rootIsSingleAnime {
		return scanRoot
	}

	relPath, err := filepath.Rel(scanRoot, filePath)
	if err != nil {
		return filepath.Dir(filePath)
	}
	parts := strings.Split(relPath, string(filepath.Separator))
	if len(parts) == 0 || parts[0] == "." || parts[0] == "" {
		return filepath.Dir(filePath)
	}
	return filepath.Join(scanRoot, parts[0])
}

func isAnimeSubfolderName(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "ova", "ovas", "oad", "special", "specials", "extra", "extras", "encore", "bonus", "omake":
		return true
	}
	return false
}

func episodeFolderName(animeRoot, filePath string) string {
	relPath, err := filepath.Rel(animeRoot, filePath)
	if err != nil {
		return ""
	}
	dir := filepath.Dir(relPath)
	if dir == "." || dir == "" {
		return ""
	}
	parts := strings.Split(filepath.ToSlash(dir), "/")
	if len(parts) == 0 || parts[0] == "." || parts[0] == ".." {
		return ""
	}
	return parts[0]
}

func deriveAnimeRootPath(localPath string, episodePaths []string) string {
	localPath = strings.TrimSpace(localPath)
	if len(episodePaths) == 0 {
		return localPath
	}

	commonDir := filepath.Dir(strings.TrimSpace(episodePaths[0]))
	for _, filePath := range episodePaths[1:] {
		commonDir = commonPathPrefix(commonDir, filepath.Dir(strings.TrimSpace(filePath)))
		if commonDir == "" {
			break
		}
	}
	if commonDir == "" {
		return localPath
	}

	if localPath == "" {
		return commonDir
	}
	if pathWithin(localPath, commonDir) {
		return commonDir
	}
	if pathWithin(commonDir, localPath) {
		return localPath
	}
	return commonDir
}

func commonPathPrefix(a, b string) string {
	a = filepath.Clean(strings.TrimSpace(a))
	b = filepath.Clean(strings.TrimSpace(b))
	if a == "" || b == "" {
		return ""
	}

	aParts := strings.Split(filepath.ToSlash(a), "/")
	bParts := strings.Split(filepath.ToSlash(b), "/")
	limit := len(aParts)
	if len(bParts) < limit {
		limit = len(bParts)
	}

	var shared []string
	for i := 0; i < limit; i++ {
		if !strings.EqualFold(aParts[i], bParts[i]) {
			break
		}
		shared = append(shared, aParts[i])
	}
	if len(shared) == 0 {
		return ""
	}
	return filepath.FromSlash(strings.Join(shared, "/"))
}

func (m *Manager) promoteAnimeRootPath(animeID int64, candidatePath, titleHint string) error {
	var currentPath string
	if err := m.db.Conn().QueryRow(`SELECT local_path FROM anime WHERE id = ?`, animeID).Scan(&currentPath); err != nil {
		return err
	}

	nextPath := chooseAnimeRootPath(currentPath, candidatePath, titleHint)
	if nextPath == "" || nextPath == currentPath {
		return nil
	}

	_, err := m.db.Conn().Exec(`UPDATE anime SET local_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, nextPath, animeID)
	return err
}

func chooseAnimeRootPath(currentPath, candidatePath, titleHint string) string {
	currentPath = strings.TrimSpace(currentPath)
	candidatePath = strings.TrimSpace(candidatePath)
	if currentPath == "" {
		return candidatePath
	}
	if candidatePath == "" || equalFoldPath(currentPath, candidatePath) {
		return currentPath
	}

	if pathWithin(currentPath, candidatePath) {
		return candidatePath
	}
	if pathWithin(candidatePath, currentPath) {
		return currentPath
	}

	currentParent := filepath.Dir(currentPath)
	candidateParent := filepath.Dir(candidatePath)
	if !equalFoldPath(currentParent, candidateParent) {
		return currentPath
	}

	currentBase := cleanAnimeTitleCandidate(filepath.Base(currentPath))
	candidateBase := cleanAnimeTitleCandidate(filepath.Base(candidatePath))
	parentBase := cleanAnimeTitleCandidate(filepath.Base(currentParent))
	titleBase := cleanAnimeTitleCandidate(titleHint)

	if isAnimeSubfolderName(currentBase) || isAnimeSubfolderName(candidateBase) ||
		isWeakAnimeFolderHint(currentBase) || isWeakAnimeFolderHint(candidateBase) ||
		(parentBase != "" && titleBase != "" && strings.EqualFold(parentBase, titleBase)) {
		return currentParent
	}

	return currentPath
}

func pathWithin(pathValue, possibleParent string) bool {
	relPath, err := filepath.Rel(possibleParent, pathValue)
	if err != nil {
		return false
	}
	relPath = filepath.Clean(relPath)
	return relPath == "." || (!strings.HasPrefix(relPath, "..") && relPath != "")
}

func equalFoldPath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func filterAnimeIdentityHints(hints []string) []string {
	requestedSeason := 0
	for _, hint := range hints {
		if season := detectAnimeSeasonNumber(hint); season > 0 {
			requestedSeason = season
			break
		}
	}
	if requestedSeason == 0 {
		return hints
	}

	var filtered []string
	for _, hint := range hints {
		if season := detectAnimeSeasonNumber(hint); season == requestedSeason {
			filtered = append(filtered, hint)
		}
	}
	if len(filtered) == 0 {
		return hints
	}
	return filtered
}

func detectAnimeSeasonNumber(value string) int {
	matches := animeSeasonMarkerPattern.FindStringSubmatch(strings.ToLower(strings.TrimSpace(value)))
	if len(matches) == 0 {
		return 0
	}
	for _, match := range matches[1:] {
		if match == "" {
			continue
		}
		if season, err := strconv.Atoi(match); err == nil && season > 0 {
			return season
		}
	}
	return 0
}

func firstEpisodeNumberFromPattern(value string, pattern *regexp.Regexp) (float64, bool) {
	match := pattern.FindStringSubmatch(value)
	if len(match) < 2 {
		return 0, false
	}
	num, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0, false
	}
	return num, true
}

func (m *Manager) DeleteAnimeByID(id int) error {
	result, err := m.db.Conn().Exec(`DELETE FROM anime WHERE id = ?`, id)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func nullableInt(value sql.NullInt64) interface{} {
	if !value.Valid {
		return nil
	}
	return int(value.Int64)
}

func buildAnimeTitleHints(path, titleHint string) []string {
	seen := map[string]struct{}{}
	var out []string

	push := func(value string) {
		for _, candidate := range expandAnimeTitleVariants(value) {
			key := strings.ToLower(strings.TrimSpace(candidate))
			if key == "" {
				continue
			}
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, candidate)
		}
	}

	dir := filepath.Dir(path)
	parent := filepath.Base(dir)
	grandparent := filepath.Base(filepath.Dir(dir))

	folderHints := []string{titleHint, parent, grandparent}
	strongFolderHint := false
	for _, value := range folderHints {
		cleaned := cleanAnimeTitleCandidate(value)
		if cleaned != "" && !isWeakAnimeFolderHint(cleaned) {
			strongFolderHint = true
		}
		push(value)
	}

	if !strongFolderHint {
		push(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	}
	return out
}

func expandAnimeTitleVariants(value string) []string {
	cleaned := cleanAnimeTitleCandidate(value)
	if cleaned == "" {
		return nil
	}

	seen := map[string]struct{}{}
	var out []string
	push := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		key := strings.ToLower(candidate)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, candidate)
	}

	push(cleaned)
	for _, separator := range []string{" - ", " / ", ":"} {
		parts := strings.Split(cleaned, separator)
		if len(parts) >= 2 {
			push(parts[0])
		}
	}
	return out
}

func cleanAnimeTitleCandidate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	value = animeBracketPattern.ReplaceAllString(value, " ")
	value = strings.TrimSpace(strings.TrimSuffix(value, filepath.Ext(value)))

	for {
		start := strings.IndexByte(value, '(')
		if start == -1 {
			break
		}
		end := strings.IndexByte(value[start:], ')')
		if end == -1 {
			break
		}
		inner := value[start+1 : start+end]
		if len(inner) < 20 {
			value = strings.TrimSpace(value[:start] + " " + value[start+end+1:])
			continue
		}
		break
	}

	replacer := strings.NewReplacer("_", " ", ".", " ", ",", " ", ";", " ", "  ", " ")
	value = replacer.Replace(value)
	value = animeSourceNoisePattern.ReplaceAllString(value, " ")
	value = animeTitleEpisodeTokenPattern.ReplaceAllString(value, "")
	if detectAnimeSeasonNumber(value) == 0 {
		value = animeNumericSuffixPattern.ReplaceAllString(value, "")
	}
	value = strings.Join(strings.Fields(value), " ")
	return strings.Trim(value, " -_:")
}

func isWeakAnimeFolderHint(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return true
	}
	if len(value) <= 3 {
		return true
	}
	switch value {
	case "anime", "animes", "downloads", "download", "videos", "video", "batch", "temp", "tmp", "new folder":
		return true
	}
	if strings.HasPrefix(value, "season ") || strings.HasPrefix(value, "temporada ") {
		return true
	}
	if strings.HasPrefix(value, "part ") || strings.HasPrefix(value, "cour ") {
		return true
	}
	return false
}

func (m *Manager) ensureAnimeBlurhash(id int, coverImage, existing *string) *string {
	return m.ensureBlurhash("anime", id, coverImage, existing)
}

func (m *Manager) ensureMangaBlurhash(id int, coverImage, existing *string) *string {
	return m.ensureBlurhash("manga", id, coverImage, existing)
}

func (m *Manager) ensureBlurhash(table string, id int, coverImage, existing *string) *string {
	if existing != nil && strings.TrimSpace(*existing) != "" {
		return existing
	}
	if coverImage == nil || strings.TrimSpace(*coverImage) == "" {
		return existing
	}

	hash := computeCoverBlurhash(*coverImage)
	if hash == "" {
		return existing
	}

	_, _ = m.db.Conn().Exec(fmt.Sprintf("UPDATE %s SET cover_blurhash = ? WHERE id = ?", table), hash, id)
	return &hash
}
