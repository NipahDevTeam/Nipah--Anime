package main

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"miruro/backend/auth"
	"miruro/backend/db"
	"miruro/backend/download"
	"miruro/backend/extensions"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/extensions/animepahe"
	"miruro/backend/extensions/jkanime"
	"miruro/backend/extensions/mangadex"
	"miruro/backend/extensions/mangafire"
	"miruro/backend/extensions/mangaoni"
	"miruro/backend/extensions/mangapill"
	"miruro/backend/extensions/senshimanga"
	"miruro/backend/extensions/templetoons"
	"miruro/backend/extensions/weebcentral"
	"miruro/backend/library"
	"miruro/backend/metadata"
	"miruro/backend/player"
	"miruro/backend/server"
	"miruro/backend/torrent"
)

// App is the root application struct. All methods on this struct are
// exposed to the frontend via Wails bindings.
type App struct {
	ctx                  context.Context
	db                   *db.Database
	library              *library.Manager
	metadata             *metadata.Manager
	player               *player.Manager
	server               *server.Server
	registry             *extensions.Registry
	downloader           *download.Manager
	dashboardVisualsOnce sync.Once
	onlineVisualMu       sync.RWMutex
	onlineVisualCache    map[string]string
}

func NewApp() *App { return &App{} }

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	database, err := db.New()
	if err != nil {
		fmt.Println("DB init failed:", err)
		return
	}
	a.db = database
	a.library = library.NewManager(a.db)
	a.metadata = metadata.NewManager()
	a.onlineVisualCache = map[string]string{}

	// Respect saved MPV path from settings
	mpvPath := a.db.GetSetting("mpv_path", "")
	if mpvPath == "" {
		mpvPath = "mpv"
	}
	a.player = player.NewManager(mpvPath)

	// Extension registry — all LA-focused sources
	a.registry = extensions.NewRegistry()
	a.registry.RegisterAnime(jkanime.New())
	a.registry.RegisterAnime(animepahe.New())
	// TioAnime deprecated: video providers (Mega, Netu) unsupported by resolvers
	a.registry.RegisterManga(senshimanga.New())
	a.registry.RegisterManga(mangaoni.New())
	a.registry.RegisterManga(templetoons.New())
	a.registry.RegisterManga(weebcentral.New())
	a.registry.RegisterManga(mangapill.New())
	if mangafire.EnabledForV1() {
		a.registry.RegisterManga(mangafire.New())
		mangafire.WarmCacheAsync()
	}

	// Player callbacks
	a.player.OnProgress = func(episodeID int, positionSec float64, percent float64) {
		if episodeID > 0 {
			_ = a.db.SaveProgress(episodeID, positionSec, percent)
		}
	}
	a.player.OnEnded = func(episodeID int) {
		if episodeID > 0 {
			a.handleLocalEpisodeEnded(episodeID)
		}
	}

	// Download manager — saves to %APPDATA%/Nipah/downloads/
	dlDir := filepath.Join(filepath.Dir(a.db.GetSetting("_internal_db_path", "")), "downloads")
	if dlDir == "" || dlDir == "downloads" {
		if appData, err := os.UserConfigDir(); err == nil {
			dlDir = filepath.Join(appData, "Nipah", "downloads")
		}
	}
	// Override with user setting if configured
	if customDir := a.db.GetSetting("download_path", ""); customDir != "" {
		dlDir = customDir
	}
	a.downloader = download.NewManager(dlDir)
	a.downloader.OnProgress = func(id int, downloaded, total int64, progress float64) {
		_ = a.db.UpdateDownloadProgress(id, downloaded, total, progress)
	}
	a.downloader.OnComplete = func(id int, filePath string, fileSize int64) {
		_ = a.db.CompleteDownload(id, filePath, fileSize)
		fmt.Printf("[Download] ✓ Completed: %s\n", filePath)
	}
	a.downloader.OnFailed = func(id int, errMsg string) {
		_ = a.db.FailDownload(id, errMsg)
		fmt.Printf("[Download] ✗ Failed #%d: %s\n", id, errMsg)
	}

	a.server = server.New(a.db, a.library, a.metadata)
	go a.server.Start(":43212")

	// Auto-scan library paths if setting is enabled
	if a.db.GetSetting("auto_scan_on_startup", "true") == "true" {
		go a.runAutoScan()
	}

	fmt.Println("Nipah! started.")
}

func (a *App) shutdown(ctx context.Context) {
	if a.player != nil {
		snap := a.player.State.Snapshot()
		if active, ok := snap["active"].(bool); ok && active {
			if id, ok := snap["episode_id"].(int); ok && id > 0 {
				pos, _ := snap["position_sec"].(float64)
				pct, _ := snap["percent"].(float64)
				_ = a.db.SaveProgress(id, pos, pct)
			}
			_ = a.player.Quit()
		}
	}
	if a.db != nil {
		a.db.Close()
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// App info
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) GetAppVersion() string { return appVersion }

func (a *App) GetLibraryStats() map[string]interface{} {
	if a.library == nil {
		return map[string]interface{}{"anime": 0, "manga": 0, "episodes": 0, "chapters": 0}
	}
	return a.library.GetStats()
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

// GetSettings returns all user settings as a key/value map.
func (a *App) GetSettings() (map[string]string, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	return a.db.GetAllSettings()
}

// SaveSettings writes multiple settings at once. Returns error string or empty.
func (a *App) SaveSettings(settings map[string]string) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	if err := a.db.SetSettings(settings); err != nil {
		return err
	}
	// If MPV path changed, reload player
	if path, ok := settings["mpv_path"]; ok {
		if path == "" {
			path = "mpv"
		}
		a.player = player.NewManager(path)
		a.player.OnProgress = func(episodeID int, positionSec float64, percent float64) {
			if episodeID > 0 {
				_ = a.db.SaveProgress(episodeID, positionSec, percent)
			}
		}
		a.player.OnEnded = func(episodeID int) {
			if episodeID > 0 {
				a.handleLocalEpisodeEnded(episodeID)
			}
		}
	}
	return nil
}

// IsMPVAvailable checks whether MPV is findable at the configured path.
func (a *App) IsMPVAvailable() bool {
	if a.player == nil {
		return false
	}
	return a.player.IsAvailable()
}

// ─────────────────────────────────────────────────────────────────────────────
// Library
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) PickFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Seleccionar carpeta de biblioteca",
	})
}

func (a *App) ScanLibrary(path string) (map[string]interface{}, error) {
	if a.library == nil {
		return nil, fmt.Errorf("library not initialized")
	}
	return a.library.Scan(path)
}

func (a *App) ScanWithPicker() (map[string]interface{}, error) {
	path, err := a.PickFolder()
	if err != nil || path == "" {
		return map[string]interface{}{"cancelled": true}, nil
	}
	result, err := a.library.Scan(path)
	if err != nil {
		return nil, err
	}
	// Persist path so auto-scan can rescan it on next launch
	_, _ = a.db.Conn().Exec(`
		INSERT OR IGNORE INTO library_paths (path, type) VALUES (?, 'anime')
	`, path)
	return result, nil
}

func (a *App) GetAnimeList() ([]map[string]interface{}, error) {
	if a.library == nil {
		return nil, fmt.Errorf("library not initialized")
	}
	return a.library.GetAnimeList()
}

func (a *App) GetAnimeDetail(id int) (map[string]interface{}, error) {
	if a.library == nil {
		return nil, fmt.Errorf("library not initialized")
	}
	return a.library.GetAnimeByID(id)
}

func (a *App) GetMangaList() ([]map[string]interface{}, error) {
	if a.library == nil {
		return nil, fmt.Errorf("library not initialized")
	}
	return a.library.GetMangaList()
}

// GetMangaDetail returns full manga info including chapter list.
func (a *App) GetMangaDetail(id int) (map[string]interface{}, error) {
	if a.library == nil {
		return nil, fmt.Errorf("library not initialized")
	}
	return a.library.GetMangaByID(id)
}

// GetLibraryPaths returns all saved library paths.
func (a *App) GetLibraryPaths() ([]map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	rows, err := a.db.Conn().Query(`SELECT id, path, type FROM library_paths ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var id int
		var path, typ string
		if err := rows.Scan(&id, &path, &typ); err != nil {
			continue
		}
		out = append(out, map[string]interface{}{
			"id": id, "path": path, "type": typ,
		})
	}
	return out, nil
}

// RemoveLibraryPath deletes a library path by ID.
// Does not delete the actual files — only removes the DB entry.
func (a *App) RemoveLibraryPath(id int) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	_, err := a.db.Conn().Exec(`DELETE FROM library_paths WHERE id = ?`, id)
	return err
}

// runAutoScan rescans all previously known library paths on startup.
// Runs in a goroutine — non-blocking. Only fires if auto_scan_on_startup = true.
func (a *App) runAutoScan() {
	rows, err := a.db.Conn().Query(`SELECT path FROM library_paths`)
	if err != nil {
		fmt.Println("Auto-scan: could not load library paths:", err)
		return
	}
	defer rows.Close()

	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err == nil {
			paths = append(paths, p)
		}
	}

	if len(paths) == 0 {
		return // nothing to scan
	}

	fmt.Printf("Auto-scan: rescanning %d library path(s)…\n", len(paths))
	for _, p := range paths {
		result, err := a.library.Scan(p)
		if err != nil {
			fmt.Printf("Auto-scan: error scanning %s: %v\n", p, err)
			continue
		}
		fmt.Printf("Auto-scan: %s — anime: %v, manga: %v\n",
			p, result["anime_found"], result["manga_found"])
	}
	fmt.Println("Auto-scan complete.")
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

// GetTrending returns currently trending/airing anime from AniList for the Descubrir page.
func (a *App) GetTrending(lang string) (interface{}, error) {
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	return a.metadata.GetTrending(lang)
}

// DiscoverAnime returns filtered anime from AniList for Descubrir browsing.
func (a *App) DiscoverAnime(genre, season string, year int, sort, status string, page int) (interface{}, error) {
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	return a.metadata.DiscoverAnime(genre, season, year, sort, status, page)
}

func (a *App) SearchAniList(query string, lang string) (interface{}, error) {
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	return a.metadata.SearchAniList(query, lang)
}

func (a *App) GetAniListAnimeByID(id int) (interface{}, error) {
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	return a.metadata.GetAnimeByID(id)
}

func (a *App) GetAniListMangaByID(id int) (interface{}, error) {
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	return a.metadata.GetAniListMangaByID(id)
}

func (a *App) SearchMangaDex(query string, lang string) (interface{}, error) {
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	return a.metadata.SearchMangaDex(query, lang)
}

// ─────────────────────────────────────────────────────────────────────────────
// Extensions / Streaming
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) ListExtensions() []map[string]interface{} {
	if a.registry == nil {
		return nil
	}
	metas := a.registry.ListAllMeta()
	out := make([]map[string]interface{}, 0, len(metas))
	for _, m := range metas {
		langs := make([]string, len(m.Languages))
		for i, l := range m.Languages {
			langs[i] = string(l)
		}
		out = append(out, map[string]interface{}{
			"id": m.ID, "name": m.Name, "type": m.Type, "languages": langs,
		})
	}
	return out
}

func preferredAnimeSearchLanguage(src extensions.AnimeSource) extensions.Language {
	langs := src.Languages()
	if len(langs) == 0 {
		return extensions.LangSpanish
	}
	for _, lang := range langs {
		if lang == extensions.LangSpanish {
			return extensions.LangSpanish
		}
	}
	return langs[0]
}

// SearchOnline queries anime sources in parallel, or a specific source when sourceID is provided.
func (a *App) SearchOnline(query string, sourceID string) ([]map[string]interface{}, error) {
	started := time.Now()
	if a.registry == nil {
		return nil, fmt.Errorf("registry not initialized")
	}

	var sources []extensions.AnimeSource
	if strings.TrimSpace(sourceID) != "" {
		src, err := a.registry.GetAnime(sourceID)
		if err != nil {
			return nil, err
		}
		sources = []extensions.AnimeSource{src}
	} else {
		sources = a.registry.ListAnime()
	}
	type result struct{ items []map[string]interface{} }
	ch := make(chan result, len(sources))

	// Per-source timeout so one slow source (e.g. DDoS-Guard) can't block the entire search
	const sourceTimeout = 12 * time.Second

	var wg sync.WaitGroup
	for _, src := range sources {
		src := src
		wg.Add(1)
		go func() {
			defer wg.Done()
			done := make(chan []extensions.SearchResult, 1)
			go func() {
				items, err := src.Search(query, preferredAnimeSearchLanguage(src))
				if err != nil {
					done <- nil
					return
				}
				done <- items
			}()

			var items []extensions.SearchResult
			select {
			case items = <-done:
			case <-time.After(sourceTimeout):
				fmt.Printf("[SearchOnline] %s timed out after %v\n", src.ID(), sourceTimeout)
				ch <- result{}
				return
			}

			if items == nil {
				ch <- result{}
				return
			}
			mapped := make([]map[string]interface{}, 0, len(items))
			for _, r := range items {
				mapped = append(mapped, map[string]interface{}{
					"id": r.ID, "title": r.Title,
					"cover_url": r.CoverURL, "year": r.Year,
					"source_id": src.ID(), "source_name": src.Name(),
				})
			}
			ch <- result{items: mapped}
		}()
	}
	wg.Wait()
	close(ch)

	var all []map[string]interface{}
	for r := range ch {
		all = append(all, r.items...)
	}
	fmt.Printf("[Perf] SearchOnline source=%s query=%q results=%d took=%v\n", sourceID, query, len(all), time.Since(started))
	return all, nil
}

func (a *App) GetOnlineEpisodes(sourceID string, animeID string) ([]map[string]interface{}, error) {
	started := time.Now()
	if a.registry == nil {
		return nil, fmt.Errorf("registry not initialized")
	}
	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return nil, fmt.Errorf("source '%s' not found", sourceID)
	}
	episodes, err := src.GetEpisodes(animeID)
	if err != nil {
		return nil, fmt.Errorf("failed to load episodes: %w", err)
	}

	watchedIDs, err := a.db.GetWatchedEpisodeIDs(sourceID, animeID)
	if err != nil {
		watchedIDs = map[string]bool{}
	}

	// Mark which episodes have already been watched
	out := make([]map[string]interface{}, 0, len(episodes))
	for _, ep := range episodes {
		watched := watchedIDs[ep.ID]
		out = append(out, map[string]interface{}{
			"id": ep.ID, "number": ep.Number,
			"title": ep.Title, "watched": watched,
		})
	}
	fmt.Printf("[Perf] GetOnlineEpisodes source=%s anime=%s count=%d took=%v\n", sourceID, animeID, len(out), time.Since(started))
	return out, nil
}

// FetchAnimeSynopsisES looks up a Spanish synopsis for a LOCAL library anime
// using its romaji title as a JKAnime slug. Caches the result in the DB.
func (a *App) FetchAnimeSynopsisES(dbID int, titleRomaji string) string {
	if a.registry == nil || titleRomaji == "" {
		return ""
	}
	src, err := a.registry.GetAnime("jkanime-es")
	if err != nil {
		return ""
	}
	jk, ok := src.(*jkanime.Extension)
	if !ok {
		return ""
	}
	syn, err := jk.GetSynopsisFromTitle(titleRomaji)
	if err != nil || syn == "" {
		return ""
	}
	if dbID > 0 && a.library != nil {
		a.library.UpdateAnimeSynopsisES(dbID, syn)
	}
	return syn
}

func (a *App) GetAnimeSynopsis(sourceID string, animeID string) (string, error) {
	if sourceID != "jkanime-es" {
		return "", nil
	}
	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return "", nil
	}
	jk, ok := src.(*jkanime.Extension)
	if !ok {
		return "", nil
	}
	synopsis, err := jk.GetSynopsis(animeID)
	if err != nil {
		return "", nil
	}
	return synopsis, nil
}

func (a *App) GetStreamSources(sourceID string, episodeID string) ([]map[string]interface{}, error) {
	if a.registry == nil {
		return nil, fmt.Errorf("registry not initialized")
	}
	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return nil, fmt.Errorf("source '%s' not found", sourceID)
	}
	streams, err := src.GetStreamSources(episodeID)
	if err != nil {
		return nil, fmt.Errorf("stream resolution failed: %w", err)
	}
	out := make([]map[string]interface{}, 0, len(streams))
	for _, s := range streams {
		out = append(out, map[string]interface{}{
			"url": s.URL, "quality": s.Quality, "language": string(s.Language),
		})
	}
	return out, nil
}

// StreamEpisode resolves streams and opens the best one in MPV.
// Also records the watch event in history.
func (a *App) StreamEpisode(sourceID, episodeID, animeID, animeTitle, coverURL string, anilistID int, malID int, episodeNum float64, episodeTitle string, quality string) error {
	if a.player == nil {
		return fmt.Errorf("player not initialized")
	}

	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return fmt.Errorf("source '%s' not found", sourceID)
	}

	// Strategy 1: GetEmbedURLs → Resolve (embed page URL → direct stream URL)
	type embedProvider interface {
		GetEmbedURLs(episodeID string) ([]string, error)
	}

	var chosenURL string
	if ep, ok := src.(embedProvider); ok {
		if urls, embedErr := ep.GetEmbedURLs(episodeID); embedErr == nil && len(urls) > 0 {
			for _, u := range urls {
				if r, resolveErr := animeflv.Resolve(u); resolveErr == nil {
					chosenURL = r.URL
					break
				}
			}
		}
	}

	// Strategy 2: GetStreamSources already returns resolved direct URLs — use without re-resolving
	var streamReferer string
	if chosenURL == "" {
		streams, err2 := src.GetStreamSources(episodeID)
		if err2 != nil || len(streams) == 0 {
			return fmt.Errorf("no streams available for this episode")
		}
		// Pick highest quality stream (prefer 1080p > 720p > 480p > first available)
		best := streams[0]
		bestRank := qualityRank(best.Quality)
		for _, s := range streams[1:] {
			if r := qualityRank(s.Quality); r > bestRank {
				best = s
				bestRank = r
			}
		}
		chosenURL = best.URL
		streamReferer = best.Referer
	}

	// Record watch history
	srcName := sourceID
	if srcObj, e := a.registry.GetAnime(sourceID); e == nil {
		srcName = srcObj.Name()
	}
	_ = a.db.RecordOnlineWatch(db.WatchHistoryEntry{
		SourceID:     sourceID,
		SourceName:   srcName,
		AnimeID:      animeID,
		AnimeTitle:   animeTitle,
		CoverURL:     coverURL,
		EpisodeID:    episodeID,
		EpisodeNum:   episodeNum,
		EpisodeTitle: episodeTitle,
		Completed:    false,
	})
	// Opening a stream should only ensure the title is tracked as active.
	// Progress bumps happen from explicit completion flows, not from launch.
	a.ensurePassiveAnimeTracked(anilistID, malID, animeTitle, "", coverURL, 0, 0, "")

	if err := a.player.OpenEpisode(chosenURL, -1, episodeNum, animeTitle, episodeTitle, 0, streamReferer); err != nil {
		return err
	}

	// Online episodes have no reliable ended callback yet, so mark the local
	// history entry as seen once playback opens successfully without syncing
	// remote progress prematurely.
	_ = a.db.MarkHistoryEntryCompleted(sourceID, episodeID, true)
	return nil
}

// MarkOnlineWatched explicitly marks an online episode as completed and syncs progress.
func (a *App) MarkOnlineWatched(sourceID, episodeID, animeID, animeTitle, coverURL string, anilistID int, malID int, episodeNum float64) error {
	srcName := sourceID
	if src, err := a.registry.GetAnime(sourceID); err == nil {
		srcName = src.Name()
	}
	if err := a.db.RecordOnlineWatch(db.WatchHistoryEntry{
		SourceID:   sourceID,
		SourceName: srcName,
		AnimeID:    animeID,
		AnimeTitle: animeTitle,
		CoverURL:   coverURL,
		EpisodeID:  episodeID,
		EpisodeNum: episodeNum,
		Completed:  true,
	}); err != nil {
		return err
	}

	progress := int(math.Floor(episodeNum))
	if progress <= 0 {
		progress = 1
	}
	a.ensurePassiveAnimeTracked(anilistID, malID, animeTitle, "", coverURL, progress, 0, "")
	return nil
}

// RecordMangaRead records an online manga chapter read event in watch history.
func (a *App) RecordMangaRead(sourceID, mangaID, mangaTitle, coverURL, chapterID string, chapterNum float64, chapterTitle string) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	return a.recordOnlineMangaReadResolved(sourceID, mangaID, mangaTitle, coverURL, chapterID, chapterNum, chapterTitle)
}

func (a *App) MarkMangaChapterCompleted(sourceID, chapterID string) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	if err := a.db.MarkOnlineMangaChapterCompleted(sourceID, chapterID, true); err != nil {
		return err
	}
	entry, err := a.db.GetOnlineMangaHistoryEntry(sourceID, chapterID)
	if err == nil && entry != nil && entry.AniListID > 0 {
		chaptersRead := int(math.Floor(entry.ChapterNum))
		if chaptersRead > 0 {
			_ = a.db.BumpMangaListProgress(entry.AniListID, chaptersRead)
			a.ensurePassiveMangaTracked(entry.AniListID, 0, entry.SourceMangaTitle, "", entry.CoverURL, entry.BannerImage, chaptersRead, 0)
		}
	}
	return nil
}

// ClearWatchHistory hides all watch history entries from "Historial reciente".
func (a *App) ClearWatchHistory() error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	return a.db.ClearWatchHistory()
}
func (a *App) RemoveAnimeFromHistory(sourceID, animeID string) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	return a.db.RemoveAnimeFromHistory(sourceID, animeID)
}

// GetWatchHistory returns recent online watch history.
func (a *App) GetWatchHistory(limit int) ([]map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entries, err := a.db.GetRecentlyWatched(limit)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		out = append(out, map[string]interface{}{
			"id": e.ID, "source_id": e.SourceID, "source_name": e.SourceName,
			"anime_id": e.AnimeID, "anime_title": e.AnimeTitle, "cover_url": e.CoverURL,
			"episode_id": e.EpisodeID, "episode_num": e.EpisodeNum,
			"episode_title": e.EpisodeTitle, "watched_at": e.WatchedAt,
			"completed": e.Completed,
		})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Torrent search & download
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) SearchTorrents(query string, source string, anilistID int) ([]map[string]interface{}, error) {
	var results []torrent.TorrentResult
	var err error

	switch source {
	case "nyaa":
		results, err = torrent.SearchNyaa(query)
	default: // "animetosho" or empty
		results, err = torrent.SearchAnimeTosho(query, anilistID)
	}
	if err != nil {
		return nil, err
	}

	out := make([]map[string]interface{}, 0, len(results))
	for _, r := range results {
		out = append(out, map[string]interface{}{
			"title":     r.Title,
			"magnet":    r.Magnet,
			"size":      r.Size,
			"seeders":   r.Seeders,
			"leechers":  r.Leechers,
			"is_batch":  r.IsBatch,
			"quality":   r.Quality,
			"group":     r.Group,
			"source":    r.Source,
			"info_hash": r.InfoHash,
		})
	}
	return out, nil
}

func (a *App) OpenMagnet(magnet string) error {
	clientPath := ""
	downloadPath := ""
	if a.db != nil {
		clientPath = a.db.GetSetting("torrent_client_path", "")
		downloadPath = a.db.GetSetting("torrent_download_path", "")
	}
	if downloadPath == "" {
		downloadPath, _ = torrent.DefaultDownloadPath()
	}
	return torrent.OpenMagnet(magnet, clientPath, downloadPath)
}

func (a *App) GetDefaultDownloadPath() (string, error) {
	saved := ""
	if a.db != nil {
		saved = a.db.GetSetting("torrent_download_path", "")
	}
	if saved != "" {
		return saved, nil
	}
	return torrent.DefaultDownloadPath()
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) GetDashboard() (map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not initialized")
	}
	// Keep dashboard rendering fast: warm missing visuals in the background
	// instead of blocking the home page on external metadata requests.
	go func() {
		_ = a.backfillAniListVisuals(4)
	}()
	a.dashboardVisualsOnce.Do(func() {
		go func() {
			_ = a.backfillAniListVisuals(24)
		}()
	})
	dash, err := a.db.GetDashboard()
	if err != nil {
		return nil, err
	}
	if mangaContinue, err := a.db.GetContinueReadingOnline(10); err == nil {
		for _, item := range mangaContinue {
			dash.ContinueWatchingOnline = append(dash.ContinueWatchingOnline, db.WatchHistoryEntry{
				ID:           item.ID,
				SourceID:     item.SourceID,
				SourceName:   item.SourceName,
				AnimeID:      item.SourceMangaID,
				AnimeTitle:   item.SourceMangaTitle,
				CoverURL:     item.CoverURL,
				BannerImage:  item.BannerImage,
				EpisodeID:    item.ChapterID,
				EpisodeNum:   item.ChapterNum,
				EpisodeTitle: item.ChapterTitle,
				WatchedAt:    item.ReadAt,
				Completed:    item.Completed,
			})
		}
	}
	if recentManga, err := a.db.GetRecentlyReadManga(12); err == nil {
		for _, item := range recentManga {
			dash.RecentlyWatched = append(dash.RecentlyWatched, db.WatchHistoryEntry{
				ID:           item.ID,
				SourceID:     item.SourceID,
				SourceName:   item.SourceName,
				AnimeID:      item.SourceMangaID,
				AnimeTitle:   item.SourceMangaTitle,
				CoverURL:     item.CoverURL,
				BannerImage:  item.BannerImage,
				EpisodeID:    item.ChapterID,
				EpisodeNum:   item.ChapterNum,
				EpisodeTitle: item.ChapterTitle,
				WatchedAt:    item.ReadAt,
				Completed:    item.Completed,
			})
		}
	}
	a.enrichOnlineHistoryVisuals(dash.ContinueWatchingOnline, 6)
	a.enrichOnlineHistoryVisuals(dash.RecentlyWatched, 6)
	// Convert anime_list entries to maps
	watchingMaps := animeListToMaps(dash.WatchingList)
	planningMaps := animeListToMaps(dash.PlanningList)
	completedMaps := animeListToMaps(dash.CompletedList)
	onHoldMaps := animeListToMaps(dash.OnHoldList)

	return map[string]interface{}{
		"continue_watching":        dash.ContinueWatching,
		"continue_watching_online": dash.ContinueWatchingOnline,
		"recently_watched":         dash.RecentlyWatched,
		"recent_anime":             dash.RecentAnime,
		"completed_anime":          dash.CompletedAnime,
		"continue_reading":         dash.ContinueReading,
		"recent_manga":             dash.RecentManga,
		"watching_list":            watchingMaps,
		"planning_list":            planningMaps,
		"completed_list":           completedMaps,
		"on_hold_list":             onHoldMaps,
		"stats":                    dash.Stats,
	}, nil
}

func (a *App) enrichOnlineHistoryVisuals(entries []db.WatchHistoryEntry, limit int) {
	if a.metadata == nil || len(entries) == 0 || limit <= 0 {
		return
	}

	seen := map[string]struct{}{}
	missingTitles := make([]string, 0, limit)

	for i := range entries {
		if len(missingTitles) >= limit {
			break
		}
		if entries[i].SourceID != "jkanime-es" {
			continue
		}

		cacheKey := onlineVisualCacheKey(entries[i].AnimeTitle)
		if cacheKey == "" {
			continue
		}
		if banner, ok := a.getOnlineVisualCache(cacheKey); ok {
			entries[i].BannerImage = banner
			continue
		}
		if _, exists := seen[cacheKey]; exists {
			continue
		}
		seen[cacheKey] = struct{}{}
		missingTitles = append(missingTitles, entries[i].AnimeTitle)
	}

	if len(missingTitles) > 0 {
		go a.primeOnlineHistoryVisuals(missingTitles)
	}
}

func (a *App) primeOnlineHistoryVisuals(titles []string) {
	if a.metadata == nil || len(titles) == 0 {
		return
	}

	for _, title := range titles {
		cacheKey := onlineVisualCacheKey(title)
		if cacheKey == "" {
			continue
		}
		if _, ok := a.getOnlineVisualCache(cacheKey); ok {
			continue
		}

		meta, err := a.metadata.MatchAnime(title)
		if err != nil || meta == nil || meta.BannerImage == "" {
			continue
		}

		a.setOnlineVisualCache(cacheKey, meta.BannerImage)
	}
}

func onlineVisualCacheKey(title string) string {
	return strings.ToLower(strings.TrimSpace(title))
}

func (a *App) getOnlineVisualCache(key string) (string, bool) {
	a.onlineVisualMu.RLock()
	defer a.onlineVisualMu.RUnlock()
	value, ok := a.onlineVisualCache[key]
	return value, ok
}

func (a *App) setOnlineVisualCache(key, banner string) {
	if key == "" || banner == "" {
		return
	}
	a.onlineVisualMu.Lock()
	defer a.onlineVisualMu.Unlock()
	a.onlineVisualCache[key] = banner
}

func (a *App) backfillAniListVisuals(limit int) error {
	if a.db == nil || a.metadata == nil || limit <= 0 {
		return nil
	}
	if err := a.backfillAnimeTableVisuals(limit); err != nil {
		return err
	}
	if err := a.backfillAnimeListVisuals(limit); err != nil {
		return err
	}
	return nil
}

func (a *App) backfillAnimeTableVisuals(limit int) error {
	rows, err := a.db.Conn().Query(`
		SELECT id, anilist_id
		FROM anime
		WHERE anilist_id > 0 AND (banner_image IS NULL OR banner_image = '')
		ORDER BY updated_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return err
	}
	defer rows.Close()

	type candidate struct {
		id        int
		anilistID int
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.anilistID); err == nil {
			candidates = append(candidates, c)
		}
	}

	for _, c := range candidates {
		meta, err := a.metadata.GetAnimeByID(c.anilistID)
		if err != nil || meta == nil || meta.BannerImage == "" {
			continue
		}
		_, _ = a.db.Conn().Exec(`
			UPDATE anime
			SET banner_image = ?,
			    cover_image = CASE WHEN COALESCE(cover_image, '') = '' THEN ? ELSE cover_image END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, meta.BannerImage, meta.CoverLarge, c.id)
		time.Sleep(80 * time.Millisecond)
	}
	return nil
}

func (a *App) backfillAnimeListVisuals(limit int) error {
	rows, err := a.db.Conn().Query(`
		SELECT anilist_id
		FROM anime_list
		WHERE anilist_id > 0 AND (banner_image IS NULL OR banner_image = '')
		ORDER BY updated_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return err
	}
	defer rows.Close()

	var candidates []int
	for rows.Next() {
		var anilistID int
		if err := rows.Scan(&anilistID); err == nil {
			candidates = append(candidates, anilistID)
		}
	}

	for _, anilistID := range candidates {
		meta, err := a.metadata.GetAnimeByID(anilistID)
		if err != nil || meta == nil || meta.BannerImage == "" {
			continue
		}
		_, _ = a.db.Conn().Exec(`
			UPDATE anime_list
			SET banner_image = ?,
			    cover_image = CASE WHEN COALESCE(cover_image, '') = '' THEN ? ELSE cover_image END,
			    title_english = CASE WHEN COALESCE(title_english, '') = '' THEN ? ELSE title_english END,
			    year = CASE WHEN COALESCE(year, 0) = 0 THEN ? ELSE year END,
			    airing_status = CASE WHEN COALESCE(airing_status, '') = '' THEN ? ELSE airing_status END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE anilist_id = ?
		`, meta.BannerImage, meta.CoverLarge, meta.TitleEnglish, meta.Year, meta.Status, anilistID)
		time.Sleep(80 * time.Millisecond)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// MangaDex online reader
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) SearchMangaOnline(query string, lang string) ([]map[string]interface{}, error) {
	return a.SearchMangaSource("senshimanga-es", query, lang)
}

func (a *App) SearchMangaSource(sourceID, query, lang string) ([]map[string]interface{}, error) {
	started := time.Now()
	if a.registry == nil {
		return nil, fmt.Errorf("registry not initialized")
	}
	src, err := a.registry.GetManga(sourceID)
	if err != nil {
		return nil, err
	}
	if lang == "" {
		lang = "es"
	}
	results, err := src.Search(query, extensions.Language(lang))
	if err != nil {
		return nil, fmt.Errorf("manga search failed: %w", err)
	}
	out := make([]map[string]interface{}, 0, len(results))
	for _, r := range results {
		out = append(out, map[string]interface{}{
			"id": r.ID, "title": r.Title,
			"cover_url": r.CoverURL, "year": r.Year,
			"description": r.Description, "source_id": sourceID,
		})
	}
	resolved := a.resolveMangaSearchResults(sourceID, out)
	fmt.Printf("[Perf] SearchMangaSource source=%s query=%q lang=%s results=%d took=%v\n", sourceID, query, lang, len(resolved), time.Since(started))
	return resolved, nil
}

func (a *App) GetMangaChaptersOnline(mangaID string, lang string) ([]map[string]interface{}, error) {
	return a.GetMangaChaptersSource("senshimanga-es", mangaID, lang)
}

func (a *App) GetMangaChaptersSource(sourceID, mangaID, lang string) ([]map[string]interface{}, error) {
	started := time.Now()
	fmt.Printf("[Manga] GetChapters source=%s manga=%s lang=%s\n", sourceID, mangaID, lang)
	if a.registry == nil {
		return nil, fmt.Errorf("registry not initialized")
	}
	src, err := a.registry.GetManga(sourceID)
	if err != nil {
		fmt.Printf("[Manga] Source not found: %v\n", err)
		return nil, err
	}
	if lang == "" {
		lang = "es"
	}
	chapters, err := src.GetChapters(mangaID, extensions.Language(lang))
	if err != nil {
		fmt.Printf("[Manga] GetChapters error: %v\n", err)
		return nil, fmt.Errorf("failed to load chapters: %w", err)
	}
	fmt.Printf("[Manga] Got %d chapters\n", len(chapters))
	out := make([]map[string]interface{}, 0, len(chapters))
	for _, ch := range chapters {
		out = append(out, map[string]interface{}{
			"id": ch.ID, "number": ch.Number, "volume_num": ch.VolumeNum,
			"title": ch.Title, "page_count": ch.PageCount, "uploaded_at": ch.UploadedAt,
			"locked": ch.Locked, "price": ch.Price,
		})
	}
	fmt.Printf("[Perf] GetMangaChaptersSource source=%s manga=%s count=%d took=%v\n", sourceID, mangaID, len(out), time.Since(started))
	return out, nil
}

func (a *App) GetChapterPages(chapterID string, dataSaver bool) ([]map[string]interface{}, error) {
	return a.GetChapterPagesSource("senshimanga-es", chapterID, dataSaver)
}

func (a *App) GetChapterPagesSource(sourceID, chapterID string, dataSaver bool) ([]map[string]interface{}, error) {
	if sourceID == "mangadex-es" {
		pages, err := mangadex.GetPagesWithQuality(chapterID, dataSaver)
		if err != nil {
			return nil, fmt.Errorf("failed to load pages: %w", err)
		}
		out := make([]map[string]interface{}, 0, len(pages))
		for _, p := range pages {
			out = append(out, map[string]interface{}{"url": p.URL, "index": p.Index})
		}
		return out, nil
	}
	// Other sources — use GetPages from the registry
	src, err := a.registry.GetManga(sourceID)
	if err != nil {
		return nil, err
	}
	pages, err := src.GetPages(chapterID)
	if err != nil {
		return nil, fmt.Errorf("failed to load pages: %w", err)
	}
	out := make([]map[string]interface{}, 0, len(pages))
	for _, p := range pages {
		out = append(out, map[string]interface{}{"url": p.URL, "index": p.Index})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Anime List (MAL-like tracking)
// ─────────────────────────────────────────────────────────────────────────────

// GetAnimeListByStatus returns all anime list entries with the given status.
func (a *App) GetAnimeListByStatus(status string) ([]map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entries, err := a.db.GetAnimeListByStatus(status)
	if err != nil {
		return nil, err
	}
	return animeListToMaps(entries), nil
}

// GetAnimeListAll returns all anime list entries.
func (a *App) GetAnimeListAll() ([]map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entries, err := a.db.GetAnimeListAll()
	if err != nil {
		return nil, err
	}
	return animeListToMaps(entries), nil
}

// GetAnimeListCounts returns counts per status.
func (a *App) GetAnimeListCounts() (map[string]int, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	return a.db.GetAnimeListCounts()
}

// AddToAnimeList adds or updates an anime in the user's list.
func (a *App) AddToAnimeList(anilistID int, malID int, title, titleEnglish, coverImage, status string, episodesWatched, episodesTotal int, score float64, airingStatus string, year int) (*ListSyncResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entry := db.AnimeListEntry{
		AnilistID:       anilistID,
		MalID:           malID,
		Title:           title,
		TitleEnglish:    titleEnglish,
		CoverImage:      coverImage,
		BannerImage:     "",
		Status:          status,
		EpisodesWatched: episodesWatched,
		EpisodesTotal:   episodesTotal,
		Score:           score,
		AiringStatus:    airingStatus,
		Year:            year,
	}
	if err := a.db.UpsertAnimeListEntry(entry); err != nil {
		return nil, err
	}
	a.syncLocalProgressFromAnimeListEntry(entry)
	return a.syncAnimePayloadAfterLocalSave(payloadFromAnimeEntry(entry))
}

// UpdateAnimeListStatus changes the status of an anime list entry.
func (a *App) UpdateAnimeListStatus(anilistID int, status string) (*ListSyncResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	if err := a.db.UpdateAnimeListStatus(anilistID, status); err != nil {
		return nil, err
	}
	entry, _ := a.db.GetAnimeListEntryByAniListID(anilistID)
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Anime actualizado localmente."}}, nil
	}
	return a.syncAnimePayloadAfterLocalSave(payloadFromAnimeEntry(*entry))
}

// UpdateAnimeListProgress updates episodes watched for an anime.
func (a *App) UpdateAnimeListProgress(anilistID int, episodesWatched int) (*ListSyncResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	if err := a.db.UpdateAnimeListProgress(anilistID, episodesWatched); err != nil {
		return nil, err
	}
	entry, _ := a.db.GetAnimeListEntryByAniListID(anilistID)
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Progreso guardado localmente."}}, nil
	}
	if entry.EpisodesTotal > 0 && entry.EpisodesWatched >= entry.EpisodesTotal {
		entry.Status = "COMPLETED"
		_ = a.db.UpsertAnimeListEntry(*entry)
	}
	a.syncLocalProgressFromAnimeListEntry(*entry)
	return a.syncAnimePayloadAfterLocalSave(payloadFromAnimeEntry(*entry))
}

// UpdateAnimeListScore updates the user's score for an anime.
func (a *App) UpdateAnimeListScore(anilistID int, score float64) (*ListSyncResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	if err := a.db.UpdateAnimeListScore(anilistID, score); err != nil {
		return nil, err
	}
	entry, _ := a.db.GetAnimeListEntryByAniListID(anilistID)
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Nota guardada localmente."}}, nil
	}
	return a.syncAnimePayloadAfterLocalSave(payloadFromAnimeEntry(*entry))
}

// ClearAnimeList removes all entries from the user's anime list.
func (a *App) ClearAnimeList() error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	return a.db.ClearAnimeList()
}

// RemoveFromAnimeList removes an anime from the user's list.
func (a *App) RemoveFromAnimeList(anilistID int, syncRemote bool) (*ListSyncResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entry, _ := a.db.GetAnimeListEntryByAniListID(anilistID)
	if err := a.db.RemoveAnimeListEntry(anilistID); err != nil {
		return nil, err
	}
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Anime eliminado localmente."}}, nil
	}
	return a.syncDeleteAfterLocalSave(payloadFromAnimeEntry(*entry), syncRemote)
}

// ImportFromMAL fetches a MAL user's anime list via Jikan and imports it.
// Requires the MAL profile to be public. Enriches with AniList covers.
func (a *App) ImportFromMAL(username string) (map[string]interface{}, error) {
	return nil, fmt.Errorf("MyAnimeList esta deprecado por ahora")
	if a.db == nil || a.metadata == nil {
		return nil, fmt.Errorf("not initialized")
	}

	entries, err := a.metadata.FetchMALUserAnimeList(username)
	if err != nil {
		return nil, fmt.Errorf("error al importar: %w", err)
	}

	if len(entries) == 0 {
		return nil, fmt.Errorf("no se encontraron anime en la lista de '%s'. Verifica que el perfil sea público", username)
	}

	// Enrich with AniList covers (AniList CDN images work natively)
	entries = a.metadata.EnrichEntriesWithAniList(entries)

	imported := 0
	for _, e := range entries {
		listID := e.AnilistID
		if listID == 0 {
			listID = e.MalID
		}
		err := a.db.UpsertAnimeListEntry(db.AnimeListEntry{
			AnilistID:       listID,
			MalID:           e.MalID,
			Title:           e.Title,
			TitleEnglish:    e.TitleEnglish,
			CoverImage:      e.ImageURL,
			BannerImage:     e.BannerImage,
			Status:          e.Status,
			EpisodesWatched: e.EpisodesWatched,
			EpisodesTotal:   e.EpisodesTotal,
			Score:           e.Score,
			AiringStatus:    e.AiringStatus,
			Year:            e.Year,
		})
		if err == nil {
			imported++
		}
	}

	return map[string]interface{}{
		"imported": imported,
		"total":    len(entries),
		"username": username,
	}, nil
}

// ImportFromMALFile opens a file picker for a MAL XML export and imports it.
// Enrichment is synchronous — covers are ready when the function returns.
func (a *App) ImportFromMALFile() (map[string]interface{}, error) {
	return nil, fmt.Errorf("MyAnimeList esta deprecado por ahora")
	if a.db == nil || a.metadata == nil {
		return nil, fmt.Errorf("not initialized")
	}

	// Open file picker for XML files
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Seleccionar archivo XML de MyAnimeList",
		Filters: []runtime.FileFilter{
			{DisplayName: "MAL Export (*.xml)", Pattern: "*.xml"},
			{DisplayName: "Todos los archivos (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return map[string]interface{}{"cancelled": true}, nil
	}

	// Parse the XML file
	entries, err := metadata.ParseMALExportFile(path)
	if err != nil {
		return nil, fmt.Errorf("error al leer archivo: %w", err)
	}

	// Enrich with AniList covers (batch queries, ~50 per call)
	// This is synchronous so covers are available immediately
	entries = a.metadata.EnrichEntriesWithAniList(entries)

	imported := 0
	for _, e := range entries {
		listID := e.AnilistID
		if listID == 0 {
			listID = e.MalID
		}
		err := a.db.UpsertAnimeListEntry(db.AnimeListEntry{
			AnilistID:       listID,
			MalID:           e.MalID,
			Title:           e.Title,
			TitleEnglish:    e.TitleEnglish,
			CoverImage:      e.ImageURL,
			BannerImage:     e.BannerImage,
			Status:          e.Status,
			EpisodesWatched: e.EpisodesWatched,
			EpisodesTotal:   e.EpisodesTotal,
			Score:           e.Score,
			AiringStatus:    e.AiringStatus,
			Year:            e.Year,
		})
		if err == nil {
			imported++
		}
	}

	return map[string]interface{}{
		"imported": imported,
		"total":    len(entries),
	}, nil
}

func animeListToMaps(entries []db.AnimeListEntry) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		out = append(out, map[string]interface{}{
			"id": e.ID, "anilist_id": e.AnilistID, "mal_id": e.MalID,
			"title": e.Title, "title_english": e.TitleEnglish,
			"cover_image": e.CoverImage, "banner_image": e.BannerImage, "status": e.Status,
			"episodes_watched": e.EpisodesWatched, "episodes_total": e.EpisodesTotal,
			"score": e.Score, "airing_status": e.AiringStatus, "year": e.Year,
			"added_at": e.AddedAt, "updated_at": e.UpdatedAt,
		})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Downloads (offline viewing)
// ─────────────────────────────────────────────────────────────────────────────

// GetDownloadLinks returns available download links for an episode from JKAnime.
func (a *App) GetDownloadLinks(sourceID, episodeID string) ([]map[string]interface{}, error) {
	if sourceID != "jkanime-es" {
		return nil, fmt.Errorf("descargas solo disponibles para JKAnime")
	}
	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return nil, err
	}
	jk, ok := src.(*jkanime.Extension)
	if !ok {
		return nil, fmt.Errorf("source is not JKAnime")
	}
	links, err := jk.GetDownloadLinks(episodeID)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]interface{}, 0, len(links))
	for _, l := range links {
		out = append(out, map[string]interface{}{
			"url": l.URL, "host": l.Host, "quality": l.Quality,
		})
	}
	return out, nil
}

// StartDownload begins downloading an episode file.
func (a *App) StartDownload(sourceURL, animeTitle string, episodeNum float64, episodeTitle, coverURL string) (int, error) {
	if a.db == nil || a.downloader == nil {
		return 0, fmt.Errorf("not initialized")
	}
	id, err := a.db.InsertDownload(animeTitle, episodeNum, episodeTitle, coverURL, sourceURL)
	if err != nil {
		return 0, fmt.Errorf("no se pudo crear descarga: %w", err)
	}
	fileName := fmt.Sprintf("%s - Ep %g.mp4", animeTitle, episodeNum)
	if err := a.downloader.Start(id, sourceURL, fileName, animeTitle, episodeNum); err != nil {
		_ = a.db.FailDownload(id, err.Error())
		return 0, err
	}
	return id, nil
}

// GetDownloads returns all download records.
func (a *App) GetDownloads() ([]map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entries, err := a.db.GetDownloads()
	if err != nil {
		return nil, err
	}
	return downloadEntriesToMaps(entries), nil
}

// GetActiveDownloads returns downloads currently in progress.
func (a *App) GetActiveDownloads() ([]map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entries, err := a.db.GetActiveDownloads()
	if err != nil {
		return nil, err
	}
	return downloadEntriesToMaps(entries), nil
}

// CancelDownload cancels an active download.
func (a *App) CancelDownload(id int) error {
	if a.downloader != nil {
		a.downloader.Cancel(id)
	}
	if a.db != nil {
		return a.db.CancelDownload(id)
	}
	return nil
}

// RemoveDownload removes a download record (and optionally the file).
func (a *App) RemoveDownload(id int, deleteFile bool) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	if deleteFile {
		entries, _ := a.db.GetDownloads()
		for _, e := range entries {
			if e.ID == id && e.FilePath != "" {
				_ = os.Remove(e.FilePath)
				break
			}
		}
	}
	return a.db.RemoveDownload(id)
}

// PlayDownloadedEpisode plays a downloaded episode file in MPV.
func (a *App) PlayDownloadedEpisode(id int) error {
	if a.player == nil || a.db == nil {
		return fmt.Errorf("not initialized")
	}
	entries, err := a.db.GetDownloads()
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.ID == id {
			if e.Status != "completed" || e.FilePath == "" {
				return fmt.Errorf("descarga no completada")
			}
			if _, err := os.Stat(e.FilePath); os.IsNotExist(err) {
				return fmt.Errorf("archivo no encontrado: %s", e.FilePath)
			}
			return a.player.OpenEpisode(e.FilePath, -1, e.EpisodeNum, e.AnimeTitle, e.EpisodeTitle, 0)
		}
	}
	return fmt.Errorf("descarga #%d no encontrada", id)
}

// GetDownloadDir returns the current download directory.
func (a *App) GetDownloadDir() string {
	if a.downloader == nil {
		return ""
	}
	return a.downloader.GetDownloadDir()
}

// qualityRank returns a numeric rank for stream quality selection (higher = better).
func qualityRank(q string) int {
	switch {
	case strings.Contains(q, "1080"):
		return 4
	case strings.Contains(q, "720"):
		return 3
	case strings.Contains(q, "480"):
		return 2
	case strings.Contains(q, "360"):
		return 1
	default:
		return 0
	}
}

func downloadEntriesToMaps(entries []db.DownloadEntry) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		out = append(out, map[string]interface{}{
			"id": e.ID, "anime_title": e.AnimeTitle,
			"episode_num": e.EpisodeNum, "episode_title": e.EpisodeTitle,
			"cover_url": e.CoverURL, "source_url": e.SourceURL,
			"file_path": e.FilePath, "file_name": e.FileName,
			"file_size": e.FileSize, "downloaded": e.Downloaded,
			"status": e.Status, "progress": e.Progress,
			"error_msg": e.ErrorMsg, "created_at": e.CreatedAt,
			"completed_at": e.CompletedAt,
		})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Local player
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) PlayEpisode(episodeID int) error {
	if a.player == nil {
		return fmt.Errorf("player not initialized")
	}
	row := a.db.Conn().QueryRow(`
		SELECT e.file_path, e.episode_num,
		       COALESCE(e.title_es, e.title, ''),
		       e.progress_s,
		       COALESCE(a.title_spanish, a.title_english, a.title_romaji, '')
		FROM episodes e
		JOIN anime a ON a.id = e.anime_id
		WHERE e.id = ?
	`, episodeID)
	var filePath, epTitle, animeTitle string
	var epNum float64
	var progressS int
	if err := row.Scan(&filePath, &epNum, &epTitle, &progressS, &animeTitle); err != nil {
		return fmt.Errorf("episode %d not found", episodeID)
	}
	return a.player.OpenEpisode(filePath, episodeID, epNum, animeTitle, epTitle, float64(progressS))
}

func (a *App) GetPlaybackState() map[string]interface{} {
	if a.player == nil {
		return map[string]interface{}{"active": false}
	}
	return a.player.State.Snapshot()
}

func (a *App) PauseResume() error {
	if a.player == nil {
		return fmt.Errorf("player not initialized")
	}
	return a.player.Pause()
}

func (a *App) SeekTo(seconds float64) error {
	if a.player == nil {
		return fmt.Errorf("player not initialized")
	}
	return a.player.Seek(seconds)
}

func (a *App) StopPlayback() error {
	if a.player == nil {
		return fmt.Errorf("player not initialized")
	}
	return a.player.Quit()
}

func (a *App) GetEpisodeProgress(episodeID int) (map[string]interface{}, error) {
	p, err := a.db.GetProgress(episodeID)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"episode_id": p.EpisodeID, "progress_sec": p.ProgressSec, "watched": p.Watched,
	}, nil
}

func (a *App) MarkWatched(episodeID int) error {
	a.handleLocalEpisodeEnded(episodeID)
	return nil
}
func (a *App) MarkUnwatched(episodeID int) error { return a.db.MarkUnwatched(episodeID) }

// ─────────────────────────────────────────────────────────────────────────────
// OAuth — AniList & MAL Sign-in
// ─────────────────────────────────────────────────────────────────────────────

// GetAuthStatus returns the login state for both AniList and MAL.
func (a *App) GetAuthStatus() map[string]interface{} {
	result := map[string]interface{}{
		"anilist": map[string]interface{}{"logged_in": false},
		"mal":     map[string]interface{}{"logged_in": false},
	}

	for _, provider := range []string{"anilist"} {
		token, err := a.db.GetOAuthToken(provider)
		if err != nil || token == nil {
			continue
		}
		result[provider] = map[string]interface{}{
			"logged_in": true,
			"username":  token.Username,
			"user_id":   token.UserID,
			"avatar":    token.AvatarURL,
			"expired":   time.Now().After(token.ExpiresAt),
		}
	}
	return result
}

// LoginAniList starts the AniList OAuth flow.
// Starts callback server, opens browser, waits for code, exchanges for token.
func (a *App) LoginAniList() (map[string]interface{}, error) {
	fmt.Println("[OAuth] Starting AniList login flow...")

	// Step 1: Start callback server
	cs, err := auth.StartCallbackServer()
	if err != nil {
		return nil, err
	}
	fmt.Printf("[OAuth] AniList redirect URI: %s\n", cs.RedirectURI)

	// Step 2: Build auth URL using the server's redirect URI and open browser
	authURL := auth.AniListLoginURL(cs.RedirectURI)
	runtime.BrowserOpenURL(a.ctx, authURL)

	// Step 3: Wait for the user to approve and the callback to arrive
	code, err := cs.WaitForCode(3 * time.Minute)
	if err != nil {
		return nil, err
	}

	// Step 4: Exchange code for token
	token, err := auth.AniListExchangeCode(code, cs.RedirectURI)
	if err != nil {
		return nil, err
	}

	// Step 5: Fetch user profile
	user, err := auth.AniListGetViewer(token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch AniList profile: %w", err)
	}

	// Step 6: Store token
	expiresAt := time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	err = a.db.SaveOAuthToken(db.OAuthToken{
		Provider:    "anilist",
		AccessToken: token.AccessToken,
		Username:    user.Name,
		UserID:      user.ID,
		AvatarURL:   user.Avatar,
		ExpiresAt:   expiresAt,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to save token: %w", err)
	}

	fmt.Printf("[OAuth] AniList login successful: %s (ID: %d)\n", user.Name, user.ID)
	return map[string]interface{}{
		"username": user.Name,
		"user_id":  user.ID,
		"avatar":   user.Avatar,
	}, nil
}

// LoginMAL starts the MAL OAuth flow with PKCE.
func (a *App) LoginMAL() (map[string]interface{}, error) {
	return nil, fmt.Errorf("MyAnimeList esta deprecado por ahora")
	fmt.Println("[OAuth] Starting MAL login flow...")

	// Step 1: Start callback server
	cs, err := auth.StartCallbackServer()
	if err != nil {
		return nil, err
	}
	fmt.Printf("[OAuth] MAL redirect URI: %s\n", cs.RedirectURI)

	// Step 2: Build auth URL with PKCE and open browser
	authURL, codeVerifier := auth.MALLoginURL(cs.RedirectURI)
	runtime.BrowserOpenURL(a.ctx, authURL)

	// Step 3: Wait for callback
	code, err := cs.WaitForCode(3 * time.Minute)
	if err != nil {
		return nil, err
	}

	// Step 4: Exchange code for token using PKCE verifier
	token, err := auth.MALExchangeCode(code, codeVerifier, cs.RedirectURI)
	if err != nil {
		return nil, err
	}

	// Step 5: Fetch user profile
	user, err := auth.MALGetUser(token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch MAL profile: %w", err)
	}

	// Step 6: Store token with refresh token
	expiresAt := time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	err = a.db.SaveOAuthToken(db.OAuthToken{
		Provider:     "mal",
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		Username:     user.Name,
		UserID:       user.ID,
		AvatarURL:    user.Picture,
		ExpiresAt:    expiresAt,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to save token: %w", err)
	}

	fmt.Printf("[OAuth] MAL login successful: %s (ID: %d)\n", user.Name, user.ID)
	return map[string]interface{}{
		"username": user.Name,
		"user_id":  user.ID,
		"avatar":   user.Picture,
	}, nil
}

// Logout removes the stored token for a provider.
func (a *App) Logout(provider string) error {
	fmt.Printf("[OAuth] Logging out from %s\n", provider)
	return a.db.DeleteOAuthToken(provider)
}

// SyncAniListLists fetches and stores the user's anime + manga lists from AniList.
func (a *App) SyncAniListLists() (map[string]interface{}, error) {
	token, err := a.db.GetOAuthToken("anilist")
	if err != nil || token == nil {
		return nil, fmt.Errorf("not logged in to AniList")
	}

	// Check if token expired
	if token.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("AniList token has no valid expiry information - please log in again")
	}
	if time.Now().After(token.ExpiresAt) {
		return nil, fmt.Errorf("AniList token expired - please log in again")
	}

	var animeCount, mangaCount int
	var syncErrs []string

	// Fetch anime list
	animeEntries, err := auth.AniListFetchLists(token.AccessToken, token.UserID, "ANIME")
	if err != nil {
		fmt.Printf("[OAuth] AniList anime list fetch failed: %v\n", err)
		syncErrs = append(syncErrs, fmt.Sprintf("anime: %v", err))
	} else {
		for _, e := range animeEntries {
			status := anilistStatusToInternal(e.Status)
			if err := a.db.UpsertAnimeListEntry(db.AnimeListEntry{
				AnilistID:       e.MediaID,
				MalID:           e.MalID,
				Title:           e.Title,
				TitleEnglish:    e.TitleEnglish,
				CoverImage:      e.CoverImage,
				BannerImage:     e.BannerImage,
				Status:          status,
				EpisodesWatched: e.Progress,
				EpisodesTotal:   e.TotalEpisodes,
				Score:           e.Score,
				AiringStatus:    e.AiringStatus,
				Year:            e.Year,
			}); err != nil {
				fmt.Printf("[OAuth] AniList anime upsert failed for %q: %v\n", e.Title, err)
				syncErrs = append(syncErrs, fmt.Sprintf("anime upsert %q: %v", e.Title, err))
				continue
			}
			a.syncLocalProgressFromAnimeListEntry(db.AnimeListEntry{
				AnilistID:       e.MediaID,
				MalID:           e.MalID,
				Title:           e.Title,
				TitleEnglish:    e.TitleEnglish,
				CoverImage:      e.CoverImage,
				BannerImage:     e.BannerImage,
				Status:          status,
				EpisodesWatched: e.Progress,
				EpisodesTotal:   e.TotalEpisodes,
				Score:           e.Score,
				AiringStatus:    e.AiringStatus,
				Year:            e.Year,
			})
			animeCount++
		}
	}

	// Fetch manga list
	mangaEntries, err := auth.AniListFetchLists(token.AccessToken, token.UserID, "MANGA")
	if err != nil {
		fmt.Printf("[OAuth] AniList manga list fetch failed: %v\n", err)
		syncErrs = append(syncErrs, fmt.Sprintf("manga: %v", err))
	} else {
		for _, e := range mangaEntries {
			status := anilistStatusToInternal(e.Status)
			if err := a.db.UpsertMangaListEntry(db.MangaListEntry{
				AnilistID:     e.MediaID,
				MalID:         e.MalID,
				Title:         e.Title,
				TitleEnglish:  e.TitleEnglish,
				CoverImage:    e.CoverImage,
				BannerImage:   e.BannerImage,
				Status:        status,
				ChaptersRead:  e.Progress,
				ChaptersTotal: e.TotalChapters,
				VolumesRead:   e.ProgressVolumes,
				VolumesTotal:  e.TotalVolumes,
				Score:         e.Score,
				Year:          e.Year,
			}); err != nil {
				fmt.Printf("[OAuth] AniList manga upsert failed for %q: %v\n", e.Title, err)
				syncErrs = append(syncErrs, fmt.Sprintf("manga upsert %q: %v", e.Title, err))
				continue
			}
			a.syncLocalProgressFromMangaListEntry(db.MangaListEntry{
				AnilistID:     e.MediaID,
				MalID:         e.MalID,
				Title:         e.Title,
				TitleEnglish:  e.TitleEnglish,
				CoverImage:    e.CoverImage,
				BannerImage:   e.BannerImage,
				Status:        status,
				ChaptersRead:  e.Progress,
				ChaptersTotal: e.TotalChapters,
				VolumesRead:   e.ProgressVolumes,
				VolumesTotal:  e.TotalVolumes,
				Score:         e.Score,
				Year:          e.Year,
			})
			mangaCount++
		}
	}

	if len(syncErrs) > 0 && animeCount == 0 && mangaCount == 0 {
		return nil, fmt.Errorf("AniList sync failed: %s", strings.Join(syncErrs, " | "))
	}

	fmt.Printf("[OAuth] AniList sync complete: %d anime, %d manga\n", animeCount, mangaCount)
	return map[string]interface{}{
		"anime_count": animeCount,
		"manga_count": mangaCount,
	}, nil
}

// SyncMALLists fetches and stores the user's anime + manga lists from MAL.
func (a *App) SyncMALLists() (map[string]interface{}, error) {
	return nil, fmt.Errorf("MyAnimeList esta deprecado por ahora")
	token, err := a.getMALToken()
	if err != nil {
		return nil, err
	}

	var animeCount, mangaCount int

	// Fetch anime list
	animeEntries, err := auth.MALFetchAnimeList(token)
	if err != nil {
		fmt.Printf("[OAuth] MAL anime list fetch failed: %v\n", err)
	} else {
		for _, e := range animeEntries {
			status := auth.MALStatusToInternal(e.Status)
			_ = a.db.UpsertAnimeListEntry(db.AnimeListEntry{
				MalID:           e.ID,
				Title:           e.Title,
				CoverImage:      e.Picture,
				Status:          status,
				EpisodesWatched: e.EpisodesWatched,
				EpisodesTotal:   e.EpisodesTotal,
				Score:           float64(e.Score),
				Year:            e.StartYear,
			})
			animeCount++
		}
	}

	// Fetch manga list
	mangaEntries, err := auth.MALFetchMangaList(token)
	if err != nil {
		fmt.Printf("[OAuth] MAL manga list fetch failed: %v\n", err)
	} else {
		for _, e := range mangaEntries {
			status := auth.MALStatusToInternal(e.Status)
			_ = a.db.UpsertMangaListEntry(db.MangaListEntry{
				MalID:         e.ID,
				Title:         e.Title,
				CoverImage:    e.Picture,
				Status:        status,
				ChaptersRead:  e.ChaptersRead,
				ChaptersTotal: e.ChaptersTotal,
				VolumesRead:   e.VolumesRead,
				VolumesTotal:  e.VolumesTotal,
				Score:         float64(e.Score),
				Year:          e.StartYear,
			})
			mangaCount++
		}
	}

	fmt.Printf("[OAuth] MAL sync complete: %d anime, %d manga\n", animeCount, mangaCount)
	return map[string]interface{}{
		"anime_count": animeCount,
		"manga_count": mangaCount,
	}, nil
}

// getMALToken returns a valid MAL access token, refreshing if expired.
func (a *App) getMALToken() (string, error) {
	return "", fmt.Errorf("MyAnimeList esta deprecado por ahora")
	stored, err := a.db.GetOAuthToken("mal")
	if err != nil || stored == nil {
		return "", fmt.Errorf("not logged in to MAL")
	}

	// If token is still valid, use it
	if time.Now().Before(stored.ExpiresAt) {
		return stored.AccessToken, nil
	}

	// Token expired — try refreshing
	if stored.RefreshToken == "" {
		return "", fmt.Errorf("MAL token expired and no refresh token available — please log in again")
	}

	fmt.Println("[OAuth] Refreshing MAL access token...")
	newToken, err := auth.MALRefreshToken(stored.RefreshToken)
	if err != nil {
		return "", fmt.Errorf("MAL token refresh failed — please log in again: %w", err)
	}

	expiresAt := time.Now().Add(time.Duration(newToken.ExpiresIn) * time.Second)
	_ = a.db.UpdateOAuthAccessToken("mal", newToken.AccessToken, newToken.RefreshToken, expiresAt)

	return newToken.AccessToken, nil
}

func anilistStatusToInternal(status string) string {
	switch status {
	case "CURRENT", "REPEATING":
		return "WATCHING"
	case "COMPLETED":
		return "COMPLETED"
	case "PAUSED":
		return "ON_HOLD"
	case "DROPPED":
		return "DROPPED"
	case "PLANNING":
		return "PLANNING"
	default:
		return "PLANNING"
	}
}

// AddToMangaList adds or updates a manga in the user's list.
func (a *App) AddToMangaList(anilistID int, malID int, title, titleEnglish, coverImage, bannerImage, status string, chaptersRead, chaptersTotal, volumesRead, volumesTotal int, score float64, year int) (*ListSyncResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	entry := db.MangaListEntry{
		AnilistID:     anilistID,
		MalID:         malID,
		Title:         title,
		TitleEnglish:  titleEnglish,
		CoverImage:    coverImage,
		BannerImage:   bannerImage,
		Status:        status,
		ChaptersRead:  chaptersRead,
		ChaptersTotal: chaptersTotal,
		VolumesRead:   volumesRead,
		VolumesTotal:  volumesTotal,
		Score:         score,
		Year:          year,
	}
	if err := a.db.UpsertMangaListEntry(entry); err != nil {
		return nil, err
	}
	a.syncLocalProgressFromMangaListEntry(entry)
	return a.syncMangaPayloadAfterLocalSave(payloadFromMangaEntry(entry))
}

// GetMangaListByStatus returns manga list entries filtered by status.
func (a *App) GetMangaListByStatus(status string) ([]db.MangaListEntry, error) {
	return a.db.GetMangaListByStatus(status)
}

// GetMangaListAll returns all manga list entries.
func (a *App) GetMangaListAll() ([]db.MangaListEntry, error) {
	return a.db.GetMangaListAll()
}

// GetMangaListCounts returns manga list entry counts by status.
func (a *App) GetMangaListCounts() (map[string]int, error) {
	return a.db.GetMangaListCounts()
}

// UpdateMangaListStatus changes the status of a manga list entry.
func (a *App) UpdateMangaListStatus(anilistID int, status string) (*ListSyncResult, error) {
	if err := a.db.UpdateMangaListStatus(anilistID, status); err != nil {
		return nil, err
	}
	entry, _ := a.db.GetMangaListEntryByAniListID(anilistID)
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Manga actualizado localmente."}}, nil
	}
	return a.syncMangaPayloadAfterLocalSave(payloadFromMangaEntry(*entry))
}

// UpdateMangaListProgress updates the read chapter count for a manga.
func (a *App) UpdateMangaListProgress(anilistID int, chaptersRead int) (*ListSyncResult, error) {
	if err := a.db.UpdateMangaListProgress(anilistID, chaptersRead); err != nil {
		return nil, err
	}
	entry, _ := a.db.GetMangaListEntryByAniListID(anilistID)
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Progreso guardado localmente."}}, nil
	}
	if entry.ChaptersTotal > 0 && entry.ChaptersRead >= entry.ChaptersTotal {
		entry.Status = "COMPLETED"
		_ = a.db.UpsertMangaListEntry(*entry)
	}
	a.syncLocalProgressFromMangaListEntry(*entry)
	return a.syncMangaPayloadAfterLocalSave(payloadFromMangaEntry(*entry))
}

// UpdateMangaListScore updates the score of a manga list entry.
func (a *App) UpdateMangaListScore(anilistID int, score float64) (*ListSyncResult, error) {
	if err := a.db.UpdateMangaListScore(anilistID, score); err != nil {
		return nil, err
	}
	entry, _ := a.db.GetMangaListEntryByAniListID(anilistID)
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Nota guardada localmente."}}, nil
	}
	return a.syncMangaPayloadAfterLocalSave(payloadFromMangaEntry(*entry))
}

// RemoveFromMangaList removes a manga entry from the user's list.
func (a *App) RemoveFromMangaList(anilistID int, syncRemote bool) (*ListSyncResult, error) {
	entry, _ := a.db.GetMangaListEntryByAniListID(anilistID)
	if err := a.db.RemoveMangaListEntry(anilistID); err != nil {
		return nil, err
	}
	if entry == nil {
		return &ListSyncResult{LocalSaved: true, Messages: []string{"Manga eliminado localmente."}}, nil
	}
	return a.syncDeleteAfterLocalSave(payloadFromMangaEntry(*entry), syncRemote)
}

// ClearMangaList removes all manga entries from the user's list.
func (a *App) ClearMangaList() error {
	return a.db.ClearMangaList()
}
