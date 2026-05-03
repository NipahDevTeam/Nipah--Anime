package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	goruntime "runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/sourcegraph/conc/pool"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"miruro/backend/auth"
	cachepkg "miruro/backend/cache"
	"miruro/backend/db"
	"miruro/backend/download"
	"miruro/backend/extensions"
	"miruro/backend/extensions/animeav1"
	"miruro/backend/extensions/animeflv"
	"miruro/backend/extensions/animegg"
	"miruro/backend/extensions/animeheaven"
	"miruro/backend/extensions/animekai"
	"miruro/backend/extensions/animeninja"
	"miruro/backend/extensions/animepahe"
	"miruro/backend/extensions/jkanime"
	"miruro/backend/extensions/m440"
	"miruro/backend/extensions/mangadex"
	"miruro/backend/extensions/mangafire"
	"miruro/backend/extensions/mangaoni"
	"miruro/backend/extensions/mangapill"
	"miruro/backend/extensions/senshimanga"
	"miruro/backend/extensions/templetoons"
	"miruro/backend/extensions/weebcentral"
	"miruro/backend/library"
	"miruro/backend/logger"
	"miruro/backend/metadata"
	"miruro/backend/notify"
	"miruro/backend/player"
	"miruro/backend/server"
	"miruro/backend/torrent"
)

var log = logger.For("App")

const internalServerBaseURL = "http://127.0.0.1:43212"

// App is the root application struct. All methods on this struct are
// exposed to the frontend via Wails bindings.
type App struct {
	ctx                   context.Context
	db                    *db.Database
	library               *library.Manager
	metadata              *metadata.Manager
	player                *player.Manager
	server                *server.Server
	registry              *extensions.Registry
	downloader            *download.Manager
	torrentStream         *torrent.StreamManager
	debug                 bool
	downloadDir           string
	animeImportDir        string
	torrentDir            string
	downloaderOnce        sync.Once
	downloaderInitErr     error
	torrentStreamOnce     sync.Once
	torrentStreamInitErr  error
	dashboardVisualsOnce  sync.Once
	onlineVisualMu        sync.RWMutex
	onlineVisualCache     map[string]string
	onlinePlaybackMu      sync.Mutex
	onlinePlayback        onlinePlaybackContext
	onlineHistoryEventMu  sync.Mutex
	onlineHistoryEventAt  time.Time
	integratedDiagMu      sync.Mutex
	integratedDiagnostics []map[string]interface{}
}

func NewApp() *App { return &App{} }

type onlinePlaybackContext struct {
	Active       bool
	SourceID     string
	SourceName   string
	AnimeID      string
	AnimeTitle   string
	CoverURL     string
	EpisodeID    string
	EpisodeNum   float64
	EpisodeTitle string
	EpisodeThumb string
	AniListID    int
	MalID        int
	ProgressSec  int
	DurationSec  int
	PlayerMode   string
}

var (
	episodeNumberPattern = regexp.MustCompile(`(?i)(?:episode|episodio|ep)[^\d]{0,4}(\d{1,4})`)
	episodeDigitsPattern = regexp.MustCompile(`(?:^|[^\d])(\d{1,4})(?:$|[^\d])`)
)

func readAppCachedJSON[T any](key string) (T, bool) {
	var zero T
	raw, ok := cachepkg.Global().GetBytes(key)
	if !ok {
		return zero, false
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		return zero, false
	}
	return value, true
}

func writeAppCachedJSON(key string, ttl time.Duration, value interface{}) {
	raw, err := json.Marshal(value)
	if err != nil {
		return
	}
	cachepkg.Global().SetBytes(key, raw, ttl)
}

func staleAppCacheKey(key string) string {
	return key + "|stale"
}

type mangaChapterCachePayload struct {
	Chapters    []extensions.Chapter `json:"chapters"`
	HasChapters bool                 `json:"has_chapters"`
}

func rememberJSONWithStale[T any](key string, freshTTL, staleTTL time.Duration, loader func() (T, error)) (T, string, error) {
	var zero T
	if cached, ok := readAppCachedJSON[T](key); ok {
		return cached, "fresh_cache", nil
	}

	value, err := loader()
	if err == nil {
		writeAppCachedJSON(key, freshTTL, value)
		writeAppCachedJSON(staleAppCacheKey(key), staleTTL, value)
		return value, "network", nil
	}

	if stale, ok := readAppCachedJSON[T](staleAppCacheKey(key)); ok {
		return stale, "stale_cache", nil
	}
	return zero, "", err
}

func rememberMangaChaptersWithPolicy(key string, loader func() ([]extensions.Chapter, error)) ([]extensions.Chapter, string, error) {
	const (
		freshTTL     = 15 * time.Minute
		staleTTL     = 60 * time.Minute
		shortMissTTL = 15 * time.Second
	)

	readStale := func() ([]extensions.Chapter, bool) {
		stale, ok := readAppCachedJSON[mangaChapterCachePayload](staleAppCacheKey(key))
		if !ok || !stale.HasChapters || len(stale.Chapters) == 0 {
			return nil, false
		}
		return stale.Chapters, true
	}

	if cached, ok := readAppCachedJSON[mangaChapterCachePayload](key); ok {
		if cached.HasChapters {
			return cached.Chapters, "fresh_cache", nil
		}
		if staleChapters, ok := readStale(); ok {
			return staleChapters, "stale_cache", nil
		}
		return cached.Chapters, "short_miss", nil
	}

	chapters, err := loader()
	if err == nil {
		payload := mangaChapterCachePayload{
			Chapters:    chapters,
			HasChapters: len(chapters) > 0,
		}
		if payload.HasChapters {
			writeAppCachedJSON(key, freshTTL, payload)
			writeAppCachedJSON(staleAppCacheKey(key), staleTTL, payload)
			return chapters, "network", nil
		}
		// Empty chapter lists are treated as short-lived misses. If we already have
		// a verified stale payload, serve it so transient parser failures do not
		// blank the UI or trigger unnecessary source churn.
		writeAppCachedJSON(key, shortMissTTL, payload)
		if staleChapters, ok := readStale(); ok {
			return staleChapters, "stale_cache", nil
		}
		return chapters, "short_miss", nil
	}

	if staleChapters, ok := readStale(); ok {
		return staleChapters, "stale_cache", nil
	}
	return nil, "", err
}

func sourceManagesMangaChapterHydration(sourceID string) bool {
	return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Initialize structured logging (debug mode via env var)
	a.debug = os.Getenv("NIPAH_DEBUG") == "1"
	logger.Init(a.debug)
	started := time.Now()
	phaseStarted := started

	database, err := db.New()
	if err != nil {
		logger.Root.Error().Err(err).Msg("DB init failed")
		return
	}
	log.Info().Dur("phase", time.Since(phaseStarted)).Msg("startup phase: database ready")
	phaseStarted = time.Now()
	a.db = database
	a.library = library.NewManager(a.db)
	a.metadata = metadata.NewManager()
	a.onlineVisualCache = map[string]string{}
	log.Info().Dur("phase", time.Since(phaseStarted)).Msg("startup phase: library and metadata ready")
	phaseStarted = time.Now()

	if repairSummary, err := a.library.RepairAnimeLibraryState(); err != nil {
		log.Warn().Err(err).Msg("startup: local anime library repair skipped")
	} else if repairSummary["anime_checked"] > 0 {
		log.Info().
			Int("anime_checked", repairSummary["anime_checked"]).
			Int("root_paths_repaired", repairSummary["root_paths_repaired"]).
			Int("empty_anime_entries", repairSummary["empty_anime_entries"]).
			Int("normalize_failures", repairSummary["normalize_failures"]).
			Int("path_repair_failures", repairSummary["path_repair_failures"]).
			Msg("startup: local anime library compatibility repair complete")
	}

	// Respect saved MPV path from settings
	mpvPath := a.db.GetSetting("mpv_path", "")
	if mpvPath == "" {
		mpvPath = "mpv"
	}
	a.player = a.newPlayer(mpvPath)
	a.configureStoragePaths()
	log.Info().Dur("phase", time.Since(phaseStarted)).Msg("startup phase: player and storage ready")
	phaseStarted = time.Now()

	// Extension registry — all LA-focused sources
	a.registry = extensions.NewRegistry()
	a.registry.RegisterAnime(jkanime.New())
	a.registry.RegisterAnime(animeflv.New())
	a.registry.RegisterAnime(animeav1.New())
	a.registry.RegisterAnime(animeninja.New())
	a.registry.RegisterAnime(animekai.New())
	// animeninja.New() — deprecated, archived for later
	// animekai.New()  — deprecated, archived for later
	a.registry.RegisterAnime(animepahe.New())
	a.registry.RegisterAnime(animeheaven.New())
	a.registry.RegisterAnime(animegg.New())
	// TioAnime deprecated: video providers (Mega, Netu) unsupported by resolvers
	a.registry.RegisterManga(m440.New())
	a.registry.RegisterManga(senshimanga.New())
	a.registry.RegisterManga(mangaoni.New())
	a.registry.RegisterManga(templetoons.New())
	a.registry.RegisterManga(weebcentral.New())
	a.registry.RegisterManga(mangapill.New())
	if mangafire.EnabledForV1() {
		a.registry.RegisterManga(mangafire.NewEnglish())
		a.registry.RegisterManga(mangafire.NewSpanish())
	}
	log.Info().Dur("phase", time.Since(phaseStarted)).Msg("startup phase: registry ready")
	phaseStarted = time.Now()

	// Player callbacks
	a.player.OnProgress = func(episodeID int, positionSec float64, percent float64) {
		if episodeID > 0 {
			_ = a.db.SaveProgress(episodeID, positionSec, percent)
			if percent >= 85.0 {
				a.syncLocalEpisodeTracking(episodeID, false)
			}
			return
		}
		a.updateCurrentOnlinePlaybackProgress(positionSec, 0, false)
	}
	a.player.OnEnded = func(episodeID int) {
		if episodeID > 0 {
			a.handleLocalEpisodeEnded(episodeID)
			return
		}
		a.finalizeCurrentOnlinePlayback(0, 0, false)
	}

	// Download manager — saves to %APPDATA%/Nipah/downloads/
	a.server = server.New(a.db, a.library, a.metadata, nil, a.debug)
	go a.server.Start("127.0.0.1:43212")
	log.Info().Dur("phase", time.Since(phaseStarted)).Msg("startup phase: server scheduled")

	// Auto-scan library paths if setting is enabled
	if a.db.GetSetting("auto_scan_on_startup", "true") == "true" {
		go func() {
			time.Sleep(8 * time.Second)
			a.runAutoScan()
		}()
	}

	log.Info().Dur("startup", time.Since(started)).Msg("startup critical path ready")
	log.Info().Msg("Nipah! started")
}

func (a *App) shutdown(ctx context.Context) {
	if a.player != nil {
		snap := a.player.State.Snapshot()
		if active, ok := snap["active"].(bool); ok && active {
			if id, ok := snap["episode_id"].(int); ok && id > 0 {
				pos, _ := snap["position_sec"].(float64)
				pct, _ := snap["percent"].(float64)
				_ = a.db.SaveProgress(id, pos, pct)
				if pct >= 85.0 {
					a.syncLocalEpisodeTracking(id, false)
				}
			}
			_ = a.player.Quit()
		}
		_ = a.player.Close()
	}
	if a.torrentStream != nil {
		a.torrentStream.Close()
	}
	if a.db != nil {
		a.db.Close()
	}
}

func (a *App) domReady(ctx context.Context) {
	a.ctx = ctx
	log.Info().Msg("dom ready signaled")
	runtime.WindowSetDarkTheme(ctx)
	go func() {
		time.Sleep(120 * time.Millisecond)
		runtime.WindowCenter(ctx)
	}()
}

func (a *App) CompleteStartupLaunch() error {
	if a.ctx == nil {
		return fmt.Errorf("window context not ready")
	}
	runtime.WindowSetDarkTheme(a.ctx)
	runtime.WindowSetMinSize(a.ctx, 1100, 700)
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowSetSize(a.ctx, 1400, 900)
	runtime.WindowCenter(a.ctx)
	time.Sleep(160 * time.Millisecond)
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowMaximise(a.ctx)
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// App info
// ─────────────────────────────────────────────────────────────────────────────

func (a *App) GetAppVersion() string { return appVersion }

func (a *App) GetPlatform() string { return goruntime.GOOS }

func (a *App) OpenURL(url string) error {
	if url == "" {
		return nil
	}
	runtime.BrowserOpenURL(a.ctx, url)
	return nil
}

func (a *App) GetLibraryStats() map[string]interface{} {
	if a.library == nil {
		return map[string]interface{}{"anime": 0, "manga": 0, "episodes": 0, "chapters": 0}
	}
	return a.library.GetStats()
}

func (a *App) newPlayer(mpvPath string) *player.Manager {
	level := "off"
	if a.db != nil {
		level = a.db.GetSetting("anime4k_level", "off")
	}
	if mpvPath == "" {
		mpvPath = "mpv"
	}
	p := player.NewManager(mpvPath, level)
	p.OnProgress = func(episodeID int, positionSec float64, percent float64) {
		if episodeID > 0 {
			_ = a.db.SaveProgress(episodeID, positionSec, percent)
			if percent >= 85.0 {
				a.syncLocalEpisodeTracking(episodeID, false)
			}
			return
		}
		a.updateCurrentOnlinePlaybackProgress(positionSec, 0, false)
	}
	p.OnEnded = func(episodeID int) {
		if episodeID > 0 {
			a.handleLocalEpisodeEnded(episodeID)
			return
		}
		a.finalizeCurrentOnlinePlayback(0, 0, false)
	}
	return p
}

func (a *App) notifyDesktop(title, message string) {
	if err := notify.Desktop(title, message); err != nil {
		log.Debug().Err(err).Str("title", title).Msg("desktop notification failed")
	}
}

func (a *App) NotifyDesktop(title, message string) error {
	a.notifyDesktop(title, message)
	return nil
}

func (a *App) emitOnlineWatchHistoryChanged(force bool) {
	if a.ctx == nil {
		return
	}

	now := time.Now()
	a.onlineHistoryEventMu.Lock()
	if !force && !a.onlineHistoryEventAt.IsZero() && now.Sub(a.onlineHistoryEventAt) < 2*time.Second {
		a.onlineHistoryEventMu.Unlock()
		return
	}
	a.onlineHistoryEventAt = now
	a.onlineHistoryEventMu.Unlock()

	runtime.EventsEmit(a.ctx, "history:online-updated", map[string]interface{}{
		"at":    now.Unix(),
		"force": force,
	})
}

func (a *App) configureStoragePaths() {
	downloadDir := filepath.Join(filepath.Dir(a.db.GetSetting("_internal_db_path", "")), "downloads")
	if downloadDir == "" || downloadDir == "downloads" {
		if appData, err := os.UserConfigDir(); err == nil {
			downloadDir = filepath.Join(appData, "Nipah", "downloads")
		}
	}
	if customDir := a.db.GetSetting("download_path", ""); customDir != "" {
		downloadDir = customDir
	}
	a.downloadDir = downloadDir

	animeImportDir := filepath.Join(filepath.Dir(a.db.GetSetting("_internal_db_path", "")), "imports", "anime")
	if animeImportDir == "" || strings.Contains(animeImportDir, "imports") == false {
		if appData, err := os.UserConfigDir(); err == nil {
			animeImportDir = filepath.Join(appData, "Nipah", "imports", "anime")
		}
	}
	if customImportDir := strings.TrimSpace(a.db.GetSetting("anime_import_path", "")); customImportDir != "" {
		animeImportDir = customImportDir
	}
	a.animeImportDir = animeImportDir

	torrentDir := filepath.Join(filepath.Dir(a.db.GetSetting("_internal_db_path", "")), "torrent-streams")
	if torrentDir == "" || torrentDir == "torrent-streams" {
		if appData, err := os.UserConfigDir(); err == nil {
			torrentDir = filepath.Join(appData, "Nipah", "torrent-streams")
		}
	}
	a.torrentDir = torrentDir

	if a.downloadDir != "" {
		_ = os.MkdirAll(a.downloadDir, 0755)
	}
	if a.animeImportDir != "" {
		_ = os.MkdirAll(a.animeImportDir, 0755)
		a.registerLibraryPath(a.animeImportDir, "anime")
	}
}

func (a *App) registerLibraryPath(path, libraryType string) {
	if a.db == nil {
		return
	}
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return
	}
	_, _ = a.db.Conn().Exec(`
		INSERT OR IGNORE INTO library_paths (path, type) VALUES (?, ?)
	`, trimmedPath, libraryType)
}

func (a *App) ensureDownloader() error {
	a.downloaderOnce.Do(func() {
		if a.downloadDir == "" {
			a.configureStoragePaths()
		}
		a.downloader = download.NewManager(a.downloadDir)
		a.downloader.OnProgress = func(id int, downloaded, total int64, progress float64) {
			_ = a.db.UpdateDownloadProgress(id, downloaded, total, progress)
		}
		a.downloader.OnComplete = func(id int, filePath string, fileSize int64) {
			_ = a.db.CompleteDownload(id, filePath, fileSize)
			log.Info().Str("path", filePath).Msg("download completed")
			if a.library != nil && a.db != nil {
				go func(downloadID int, completedPath string) {
					entry, err := a.db.GetDownloadByID(downloadID)
					if err != nil || entry == nil {
						log.Warn().Err(err).Int("download_id", downloadID).Msg("download import skipped: completed entry missing")
						return
					}
					result, importErr := a.library.ImportDownloadedAnime(completedPath, entry.AnimeTitle, entry.CoverURL)
					if importErr != nil {
						log.Warn().Err(importErr).Int("download_id", downloadID).Str("path", completedPath).Msg("download import failed")
						return
					}
					log.Info().
						Int("download_id", downloadID).
						Str("path", completedPath).
						Interface("anime_found", result["anime_found"]).
						Interface("anime_enriched", result["anime_enriched"]).
						Msg("completed download imported into local library")
					if a.ctx != nil {
						runtime.EventsEmit(a.ctx, "library:anime-imported", map[string]interface{}{
							"download_id":    downloadID,
							"path":           completedPath,
							"anime_found":    result["anime_found"],
							"anime_enriched": result["anime_enriched"],
							"created":        result["created"],
						})
					}
				}(id, filePath)
			}
			go a.notifyDesktop("Nipah! Anime", fmt.Sprintf("Download completed: %s", filepath.Base(filePath)))
		}
		a.downloader.OnFailed = func(id int, errMsg string) {
			translated := translateDownloadErrorMessage(errMsg)
			_ = a.db.FailDownload(id, translated)
			log.Error().Int("id", id).Str("error", translated).Msg("download failed")
			go a.notifyDesktop("Nipah! Anime", fmt.Sprintf("Download failed: %s", translated))
		}
	})
	return a.downloaderInitErr
}

func translateDownloadErrorMessage(errMsg string) string {
	out := strings.TrimSpace(errMsg)
	out = strings.ReplaceAll(out, "Ã¡", "á")
	out = strings.ReplaceAll(out, "Ã©", "é")
	out = strings.ReplaceAll(out, "Ã­", "í")
	out = strings.ReplaceAll(out, "Ã³", "ó")
	out = strings.ReplaceAll(out, "Ãº", "ú")
	out = strings.ReplaceAll(out, "Ã¡", "á")
	out = strings.ReplaceAll(out, "Ã©", "é")
	out = strings.ReplaceAll(out, "Ã­", "í")
	out = strings.ReplaceAll(out, "Ã³", "ó")
	out = strings.ReplaceAll(out, "Ãº", "ú")
	replacements := []struct {
		from string
		to   string
	}{
		{"Descarga fallida:", "Download failed:"},
		{"URL inválida:", "Invalid download URL:"},
		{"URL invÃ¡lida:", "Invalid download URL:"},
		{"No se pudo crear archivo:", "Could not create file:"},
		{"Error al escribir:", "Write error:"},
		{"Error de lectura:", "Read error:"},
		{"No se pudo resolver enlace de JKAnime:", "Could not resolve the JKAnime download link:"},
		{"JKAnime no devolvió un destino de descarga válido", "JKAnime did not return a valid download destination"},
		{"JKAnime no devolviÃ³ un destino de descarga vÃ¡lido", "JKAnime did not return a valid download destination"},
		{"No se pudo resolver Mediafire:", "Could not resolve MediaFire:"},
		{"Mega no está soportado para descarga directa en esta versión", "Mega is not supported for direct downloads in this version"},
		{"Mega no estÃ¡ soportado para descarga directa en esta versiÃ³n", "Mega is not supported for direct downloads in this version"},
		{"No se pudo resolver el host de descarga:", "Could not resolve the download host:"},
		{"El host de descarga no devolvió un archivo válido", "The download host did not return a valid file"},
		{"El host de descarga no devolviÃ³ un archivo vÃ¡lido", "The download host did not return a valid file"},
	}
	for _, replacement := range replacements {
		out = strings.ReplaceAll(out, replacement.from, replacement.to)
	}
	if strings.TrimSpace(out) == "" {
		return "Unknown download error"
	}
	return out
}

func (a *App) ensureTorrentStream() error {
	a.torrentStreamOnce.Do(func() {
		if a.torrentDir == "" {
			a.configureStoragePaths()
		}
		streamMgr, err := torrent.NewStreamManager(a.torrentDir)
		if err != nil {
			a.torrentStreamInitErr = err
			log.Error().Err(err).Msg("torrent streaming init failed")
			return
		}
		a.torrentStream = streamMgr
		if a.server != nil {
			a.server.SetTorrentStream(streamMgr)
		}
	})
	return a.torrentStreamInitErr
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
	// If MPV path or Anime4K level changed, reload player.
	if _, ok := settings["mpv_path"]; ok {
		if a.player != nil {
			_ = a.player.Close()
		}
		a.player = a.newPlayer(settings["mpv_path"])
	} else if _, ok := settings["anime4k_level"]; ok {
		if a.player != nil {
			_ = a.player.Close()
		}
		a.player = a.newPlayer(a.db.GetSetting("mpv_path", ""))
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
	a.registerLibraryPath(path, "anime")
	return result, nil
}

func (a *App) GetAnimeImportDir() string {
	if strings.TrimSpace(a.animeImportDir) == "" {
		a.configureStoragePaths()
	}
	return a.animeImportDir
}

func (a *App) SetAnimeImportDir(path string) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}
	nextPath := strings.TrimSpace(path)
	if nextPath == "" {
		return fmt.Errorf("missing import folder")
	}
	if err := os.MkdirAll(nextPath, 0755); err != nil {
		return err
	}

	previousPath := strings.TrimSpace(a.animeImportDir)
	if err := a.db.SetSettings(map[string]string{"anime_import_path": nextPath}); err != nil {
		return err
	}
	a.animeImportDir = nextPath
	if previousPath != "" && !strings.EqualFold(previousPath, nextPath) {
		_, _ = a.db.Conn().Exec(`DELETE FROM library_paths WHERE path = ? AND type = 'anime'`, previousPath)
	}
	a.registerLibraryPath(nextPath, "anime")
	return nil
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

func (a *App) DeleteLocalAnime(id int) error {
	if a.library == nil {
		return fmt.Errorf("library not initialized")
	}
	return a.library.DeleteAnimeByID(id)
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
		log.Error().Err(err).Msg("auto-scan: could not load library paths")
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

	log.Info().Int("count", len(paths)).Msg("auto-scan: rescanning library paths")
	for _, p := range paths {
		result, err := a.library.Scan(p)
		if err != nil {
			log.Error().Err(err).Str("path", p).Msg("auto-scan: error scanning")
			continue
		}
		log.Info().Str("path", p).Interface("anime_found", result["anime_found"]).Interface("manga_found", result["manga_found"]).Msg("auto-scan: path scanned")
	}
	log.Info().Msg("auto-scan complete")
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

// GetTrending returns currently trending/airing anime from AniList for the Descubrir page.
func (a *App) GetTrending(lang string) (interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	cacheKey := fmt.Sprintf("anilist:trending:%s", strings.TrimSpace(lang))
	result, origin, err := rememberJSONWithStale[interface{}](cacheKey, 20*time.Minute, 4*time.Hour, func() (interface{}, error) {
		return a.metadata.GetTrending(lang)
	})
	log.Debug().Str("lang", lang).Str("cache", origin).Dur("took", time.Since(started)).Msg("GetTrending")
	return result, err
}

// DiscoverAnime returns filtered anime from AniList for Descubrir browsing.
func (a *App) DiscoverAnime(genre, season string, year int, sort, status, format string, page int) (interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	cacheKey := fmt.Sprintf("anilist:discover:anime:v3:%s|%s|%d|%s|%s|%s|%d", strings.TrimSpace(genre), strings.TrimSpace(season), year, strings.TrimSpace(sort), strings.TrimSpace(status), strings.TrimSpace(format), page)
	result, origin, err := rememberJSONWithStale[interface{}](cacheKey, 20*time.Minute, 4*time.Hour, func() (interface{}, error) {
		return a.metadata.DiscoverAnime(genre, season, year, sort, status, format, page)
	})
	log.Debug().Str("genre", genre).Str("season", season).Int("year", year).Str("sort", sort).Str("status", status).Str("format", format).Int("page", page).Str("cache", origin).Dur("took", time.Since(started)).Msg("DiscoverAnime")
	return result, err
}

func (a *App) SearchAniList(query string, lang string) (interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	cacheKey := fmt.Sprintf("anilist:search:anime:%s|%s", strings.ToLower(strings.TrimSpace(query)), strings.TrimSpace(lang))
	result, origin, err := rememberJSONWithStale[interface{}](cacheKey, 20*time.Minute, 3*time.Hour, func() (interface{}, error) {
		return a.metadata.SearchAniList(query, lang)
	})
	log.Debug().Str("query", query).Str("lang", lang).Str("cache", origin).Dur("took", time.Since(started)).Msg("SearchAniList")
	return result, err
}

func (a *App) GetAniListAnimeByID(id int) (interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	cacheKey := fmt.Sprintf("anilist:anime:id:%d", id)
	result, origin, err := rememberJSONWithStale[*metadata.AnimeMetadata](cacheKey, 2*time.Hour, 12*time.Hour, func() (*metadata.AnimeMetadata, error) {
		return a.metadata.GetAnimeByID(id)
	})
	log.Debug().Int("id", id).Str("cache", origin).Dur("took", time.Since(started)).Msg("GetAniListAnimeByID")
	return result, err
}

func (a *App) GetAniListMangaByID(id int) (interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	cacheKey := fmt.Sprintf("anilist:manga:id:%d", id)
	result, origin, err := rememberJSONWithStale[*metadata.AniListMangaMetadata](cacheKey, 2*time.Hour, 12*time.Hour, func() (*metadata.AniListMangaMetadata, error) {
		return a.metadata.GetAniListMangaByID(id)
	})
	log.Debug().Int("id", id).Str("cache", origin).Dur("took", time.Since(started)).Msg("GetAniListMangaByID")
	return result, err
}

func (a *App) GetAniListMangaCatalogHome(lang string) (map[string][]metadata.AniListMangaMetadata, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	cacheKey := fmt.Sprintf("anilist:manga:catalog-home:%s", strings.TrimSpace(lang))
	result, origin, err := rememberJSONWithStale[map[string][]metadata.AniListMangaMetadata](cacheKey, 20*time.Minute, 4*time.Hour, func() (map[string][]metadata.AniListMangaMetadata, error) {
		return a.metadata.GetAniListMangaCatalogHome()
	})
	log.Debug().Str("lang", strings.TrimSpace(lang)).Str("cache", origin).Dur("took", time.Since(started)).Msg("GetAniListMangaCatalogHome")
	return result, err
}

func (a *App) DiscoverManga(genre string, year int, sort, status, format string, page int) (interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	cacheKey := fmt.Sprintf("anilist:discover:manga:v2:%s|%d|%s|%s|%s|%d", strings.TrimSpace(genre), year, strings.TrimSpace(sort), strings.TrimSpace(status), strings.TrimSpace(format), page)
	result, origin, err := rememberJSONWithStale[interface{}](cacheKey, 20*time.Minute, 4*time.Hour, func() (interface{}, error) {
		return a.metadata.DiscoverManga(genre, year, sort, status, format, page)
	})
	log.Debug().Str("genre", genre).Int("year", year).Str("sort", sort).Str("status", status).Str("format", format).Int("page", page).Str("cache", origin).Dur("took", time.Since(started)).Msg("DiscoverManga")
	return result, err
}

func (a *App) SearchMangaDex(query string, lang string) (interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	result, err := a.metadata.SearchMangaDex(query, lang)
	log.Debug().Str("query", query).Str("lang", lang).Dur("took", time.Since(started)).Msg("SearchMangaDex")
	return result, err
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

func (a *App) cachedAnimeSearch(src extensions.AnimeSource, query string) ([]extensions.SearchResult, error) {
	cacheKey := fmt.Sprintf("anime:search:%s:%s", src.ID(), strings.ToLower(strings.TrimSpace(query)))
	return cachepkg.RememberJSON(cachepkg.Global(), cacheKey, 10*time.Minute, func() ([]extensions.SearchResult, error) {
		return src.Search(query, preferredAnimeSearchLanguage(src))
	})
}

func (a *App) cachedAnimeStreams(src extensions.AnimeSource, sourceID, episodeID string) ([]extensions.StreamSource, error) {
	cacheKey := fmt.Sprintf("anime:streams:v7:%s:%s", sourceID, episodeID)
	staleKey := cacheKey + ":stale"
	svc := cachepkg.Global()
	cacheTTL, staleTTL := animeStreamCacheDurations(sourceID)

	if svc != nil {
		if raw, ok := svc.GetBytes(cacheKey); ok {
			var cached []extensions.StreamSource
			if err := json.Unmarshal(raw, &cached); err == nil && len(cached) > 0 {
				log.Debug().Str("source", sourceID).Str("episode", episodeID).Msg("anime streams cache hit")
				return cached, nil
			}
		}
	}

	streams, err := src.GetStreamSources(episodeID)
	if err != nil {
		if svc != nil && staleTTL > 0 {
			if raw, ok := svc.GetBytes(staleKey); ok {
				var stale []extensions.StreamSource
				if unmarshalErr := json.Unmarshal(raw, &stale); unmarshalErr == nil && len(stale) > 0 {
					log.Debug().Str("source", sourceID).Str("episode", episodeID).Msg("anime streams stale cache hit")
					return stale, nil
				}
			}
		}
		return nil, err
	}
	playable := filterPlayableAnimeStreams(streams, sourceID, episodeID)
	if len(playable) == 0 {
		if svc != nil && staleTTL > 0 {
			if raw, ok := svc.GetBytes(staleKey); ok {
				var stale []extensions.StreamSource
				if unmarshalErr := json.Unmarshal(raw, &stale); unmarshalErr == nil && len(stale) > 0 {
					log.Debug().Str("source", sourceID).Str("episode", episodeID).Msg("anime streams stale cache fallback after empty result")
					return stale, nil
				}
			}
		}
		return nil, fmt.Errorf("no playable streams resolved")
	}

	if svc != nil {
		if raw, marshalErr := json.Marshal(playable); marshalErr == nil {
			svc.SetBytes(cacheKey, raw, cacheTTL)
			if staleTTL > 0 {
				svc.SetBytes(staleKey, raw, staleTTL)
			}
		}
	}
	return playable, nil
}

func animeStreamCacheDurations(sourceID string) (time.Duration, time.Duration) {
	switch strings.TrimSpace(strings.ToLower(sourceID)) {
	case "animegg-en":
		// AnimeGG issues short-lived tokenized /play/ URLs. Keeping them around
		// too long is worse than re-resolving quickly, so we use a short hot cache
		// and skip the long stale fallback entirely.
		return 90 * time.Second, 0
	default:
		return 20 * time.Minute, 2 * time.Hour
	}
}

func filterPlayableAnimeStreams(streams []extensions.StreamSource, sourceID, episodeID string) []extensions.StreamSource {
	if len(streams) == 0 {
		return nil
	}

	out := make([]extensions.StreamSource, 0, len(streams))
	seen := map[string]bool{}
	for _, stream := range streams {
		url := strings.TrimSpace(stream.URL)
		if !animeflv.LooksLikePlayableURL(url) {
			log.Debug().
				Str("source", sourceID).
				Str("episode", episodeID).
				Str("url", url).
				Msg("discarded non-playable anime stream")
			continue
		}
		audioKey := normalizeAnimeAudio(stream.Audio)
		cacheKey := url + "|" + audioKey
		if seen[cacheKey] {
			continue
		}
		seen[cacheKey] = true
		stream.URL = url
		stream.Referer = strings.TrimSpace(stream.Referer)
		out = append(out, stream)
	}
	return out
}

func normalizeAnimeAudio(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "sub", "subs", "subtitle", "subtitles", "vose", "raw", "original":
		return "sub"
	case "dub", "dublado", "doblaje", "lat", "cast":
		return "dub"
	default:
		return ""
	}
}

func explicitAnimeAudioPreference(episodeID string) string {
	value := strings.TrimSpace(episodeID)
	if value == "" || !strings.Contains(value, "::") {
		return ""
	}
	parts := strings.Split(value, "::")
	for _, part := range parts[1:] {
		token := strings.TrimSpace(strings.ToLower(part))
		if !strings.HasPrefix(token, "audio=") {
			continue
		}
		return normalizeAnimeAudio(strings.TrimSpace(strings.TrimPrefix(token, "audio=")))
	}
	return ""
}

func audioPreferenceRank(streamAudio, preferredAudio string) int {
	switch normalizeAnimeAudio(preferredAudio) {
	case "dub":
		switch normalizeAnimeAudio(streamAudio) {
		case "dub":
			return 3
		case "sub":
			return 2
		default:
			return 1
		}
	default:
		switch normalizeAnimeAudio(streamAudio) {
		case "sub":
			return 3
		case "dub":
			return 2
		default:
			return 1
		}
	}
}

func qualityPreferenceScore(quality, preferredQuality string) int {
	score := qualityRank(quality) * 10
	preferredQuality = strings.TrimSpace(strings.ToLower(preferredQuality))
	if preferredQuality != "" && strings.Contains(strings.ToLower(quality), preferredQuality) {
		score += 100
	}
	return score
}

func sortAnimeStreamsForPreference(streams []extensions.StreamSource, preferredAudio, preferredQuality string) []extensions.StreamSource {
	if len(streams) <= 1 {
		return streams
	}
	sorted := make([]extensions.StreamSource, len(streams))
	copy(sorted, streams)
	sort.SliceStable(sorted, func(i, j int) bool {
		left := sorted[i]
		right := sorted[j]

		leftAudio := audioPreferenceRank(left.Audio, preferredAudio)
		rightAudio := audioPreferenceRank(right.Audio, preferredAudio)
		if leftAudio != rightAudio {
			return leftAudio > rightAudio
		}

		leftQuality := qualityPreferenceScore(left.Quality, preferredQuality)
		rightQuality := qualityPreferenceScore(right.Quality, preferredQuality)
		if leftQuality != rightQuality {
			return leftQuality > rightQuality
		}

		return qualityRank(left.Quality) > qualityRank(right.Quality)
	})
	return sorted
}

func (a *App) preferredAnimeAudio() string {
	if a.db == nil {
		return "sub"
	}
	return normalizeAnimeAudio(a.db.GetSetting("preferred_audio", "sub"))
}

func (a *App) preferredAnimeAudioForEpisode(episodeID string) string {
	if explicit := explicitAnimeAudioPreference(episodeID); explicit != "" {
		return explicit
	}
	return a.preferredAnimeAudio()
}

func (a *App) preferredAnimeQuality(override string) string {
	if strings.TrimSpace(override) != "" {
		return strings.TrimSpace(strings.ToLower(override))
	}
	if a.db == nil {
		return "1080p"
	}
	return strings.TrimSpace(strings.ToLower(a.db.GetSetting("preferred_quality", "1080p")))
}

func pickBestAnimeStream(streams []extensions.StreamSource, preferredAudio, preferredQuality string) (extensions.StreamSource, bool) {
	if len(streams) == 0 {
		return extensions.StreamSource{}, false
	}
	sorted := sortAnimeStreamsForPreference(streams, preferredAudio, preferredQuality)
	return sorted[0], true
}

func playbackCandidateAnimeStreams(streams []extensions.StreamSource, preferredAudio, preferredQuality string, limit int) []extensions.StreamSource {
	sorted := sortAnimeStreamsForPreference(streams, preferredAudio, preferredQuality)
	if limit > 0 && len(sorted) > limit {
		return sorted[:limit]
	}
	return sorted
}

func animeSearchSourceTimeout(sourceID string, singleSource bool) time.Duration {
	switch strings.TrimSpace(strings.ToLower(sourceID)) {
	case "animepahe-en":
		if singleSource {
			return 40 * time.Second
		}
		return 20 * time.Second
	case "animekai-en":
		if singleSource {
			return 16 * time.Second
		}
		return 12 * time.Second
	default:
		return 12 * time.Second
	}
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

	singleSource := len(sources) == 1

	p := pool.NewWithResults[result]().WithMaxGoroutines(len(sources))
	for _, src := range sources {
		src := src
		p.Go(func() result {
			sourceTimeout := animeSearchSourceTimeout(src.ID(), singleSource)
			done := make(chan []extensions.SearchResult, 1)
			go func() {
				items, err := a.cachedAnimeSearch(src, query)
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
				log.Warn().Str("source", src.ID()).Dur("timeout", sourceTimeout).Msg("search timed out")
				return result{}
			}

			if items == nil {
				return result{}
			}
			mapped := make([]map[string]interface{}, 0, len(items))
			for _, r := range items {
				mapped = append(mapped, map[string]interface{}{
					"id": r.ID, "title": r.Title,
					"cover_url": r.CoverURL, "year": r.Year,
					"source_id": src.ID(), "source_name": src.Name(),
				})
			}
			return result{items: mapped}
		})
	}

	var all []map[string]interface{}
	for _, r := range p.Wait() {
		all = append(all, r.items...)
	}
	log.Debug().Str("source", sourceID).Str("query", query).Int("results", len(all)).Dur("took", time.Since(started)).Msg("SearchOnline")
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
	cacheKey := fmt.Sprintf("anime:episodes:%s:%s", sourceID, animeID)
	episodes, origin, err := rememberJSONWithStale[[]extensions.Episode](cacheKey, 30*time.Minute, 2*time.Hour, func() ([]extensions.Episode, error) {
		return src.GetEpisodes(animeID)
	})
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
			"thumbnail": ep.Thumbnail,
		})
	}
	log.Debug().Str("source", sourceID).Str("anime", animeID).Str("cache", origin).Int("count", len(out)).Dur("took", time.Since(started)).Msg("GetOnlineEpisodes")
	return out, nil
}

func (a *App) GetOnlineAudioVariants(sourceID string, animeID string, episodeID string) (map[string]bool, error) {
	result := map[string]bool{
		"sub": true,
		"dub": false,
	}

	if a.registry == nil {
		return result, fmt.Errorf("registry not initialized")
	}
	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return result, fmt.Errorf("source '%s' not found", sourceID)
	}
	audioSource, ok := src.(extensions.AnimeAudioVariantSource)
	if !ok {
		return result, nil
	}

	variants, err := audioSource.GetAudioVariants(animeID, episodeID)
	if err != nil {
		return result, err
	}
	if variants != nil {
		result["sub"] = variants["sub"] || result["sub"]
		result["dub"] = variants["dub"]
	}
	return result, nil
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
	streams, err := a.cachedAnimeStreams(src, sourceID, episodeID)
	if err != nil {
		return nil, fmt.Errorf("stream resolution failed: %w", err)
	}
	streams = sortAnimeStreamsForPreference(streams, a.preferredAnimeAudioForEpisode(episodeID), a.preferredAnimeQuality(""))
	out := make([]map[string]interface{}, 0, len(streams))
	for _, s := range streams {
		out = append(out, map[string]interface{}{
			"url": s.URL, "quality": s.Quality, "language": string(s.Language), "audio": s.Audio, "cookie": s.Cookie,
		})
	}
	return out, nil
}

// ProbeAnimeSourceFlow is a debug helper for diagnosing source issues without
// opening the player. It verifies episode discovery, stream extraction, and the
// final playable handoff payload in one call.
func (a *App) ProbeAnimeSourceFlow(sourceID string, animeID string, episodeID string) (map[string]interface{}, error) {
	result := map[string]interface{}{
		"source_id": sourceID,
		"anime_id":  animeID,
	}
	if a.registry == nil {
		return result, fmt.Errorf("registry not initialized")
	}

	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return result, fmt.Errorf("source '%s' not found", sourceID)
	}

	episodes, err := src.GetEpisodes(animeID)
	result["episodes_count"] = len(episodes)
	if err != nil {
		result["episodes_error"] = err.Error()
		return result, err
	}

	selectedEpisodeID := strings.TrimSpace(episodeID)
	if selectedEpisodeID == "" && len(episodes) > 0 {
		selectedEpisodeID = episodes[0].ID
	}
	result["selected_episode_id"] = selectedEpisodeID
	if selectedEpisodeID == "" {
		return result, fmt.Errorf("no episode id available to probe")
	}

	rawStreams, err := src.GetStreamSources(selectedEpisodeID)
	result["raw_streams_count"] = len(rawStreams)
	if err != nil {
		result["streams_error"] = err.Error()
		return result, err
	}

	playable := filterPlayableAnimeStreams(rawStreams, sourceID, selectedEpisodeID)
	result["playable_streams_count"] = len(playable)
	if best, ok := pickBestAnimeStream(playable, a.preferredAnimeAudioForEpisode(selectedEpisodeID), a.preferredAnimeQuality("")); ok {
		result["stream_url"] = best.URL
		result["referer"] = best.Referer
		result["stream_kind"] = inferStreamKind(best.URL)
		result["audio"] = best.Audio
		result["player_ready"] = true
	} else {
		result["player_ready"] = false
	}
	return result, nil
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

	streams, err2 := a.cachedAnimeStreams(src, sourceID, episodeID)
	if err2 != nil || len(streams) == 0 {
		if err2 != nil {
			log.Error().Err(err2).Str("source", sourceID).Str("episode", episodeID).Msg("get-stream error")
		}
		return fmt.Errorf("no playable streams available for this episode")
	}
	preferredAudio := a.preferredAnimeAudioForEpisode(episodeID)
	preferredQuality := a.preferredAnimeQuality(quality)
	best, ok := pickBestAnimeStream(streams, preferredAudio, preferredQuality)
	if !ok {
		return fmt.Errorf("no playable streams available for this episode")
	}
	candidates := playbackCandidateAnimeStreams(streams, preferredAudio, preferredQuality, 4)
	log.Debug().Str("source", sourceID).Str("episode", episodeID).Str("chosen", best.URL).Str("referer", best.Referer).Int("candidates", len(candidates)).Msg("stream episode")

	saved, _ := a.db.GetOnlineWatchProgress(sourceID, episodeID)
	startSec := 0.0
	if !saved.Completed && saved.ProgressSec > 0 {
		startSec = float64(saved.ProgressSec)
	}
	episodeThumb, _, resolvedCover := a.resolveOnlineEpisodeVisuals(sourceID, animeID, episodeID, coverURL, anilistID, episodeNum, episodeTitle)
	srcName := a.onlineSourceName(sourceID)
	playbackCtx := onlinePlaybackContext{
		Active:       true,
		SourceID:     sourceID,
		SourceName:   srcName,
		AnimeID:      animeID,
		AnimeTitle:   animeTitle,
		CoverURL:     resolvedCover,
		EpisodeID:    episodeID,
		EpisodeNum:   episodeNum,
		EpisodeTitle: firstNonEmptyString(episodeTitle, saved.EpisodeTitle),
		EpisodeThumb: firstNonEmptyString(episodeThumb, saved.EpisodeThumb),
		AniListID:    anilistID,
		MalID:        malID,
		ProgressSec:  int(math.Round(startSec)),
		DurationSec:  saved.DurationSec,
		PlayerMode:   "mpv",
	}
	a.setCurrentOnlinePlayback(playbackCtx)
	_ = a.db.RecordOnlineWatch(db.WatchHistoryEntry{
		AniListID:    anilistID,
		SourceID:     sourceID,
		SourceName:   srcName,
		AnimeID:      animeID,
		AnimeTitle:   animeTitle,
		CoverURL:     resolvedCover,
		EpisodeID:    episodeID,
		EpisodeNum:   episodeNum,
		EpisodeTitle: playbackCtx.EpisodeTitle,
		EpisodeThumb: playbackCtx.EpisodeThumb,
		ProgressSec:  playbackCtx.ProgressSec,
		DurationSec:  playbackCtx.DurationSec,
		Completed:    false,
	})
	a.emitOnlineWatchHistoryChanged(false)
	a.ensurePassiveAnimeTracked(anilistID, malID, animeTitle, "", resolvedCover, 0, 0, "")

	_, err = a.openOnlineEpisodeWithCandidates(sourceID, episodeID, episodeNum, animeTitle, playbackCtx.EpisodeTitle, startSec, candidates)
	if err != nil {
		_ = a.clearCurrentOnlinePlayback()
		log.Error().Err(err).Str("source", sourceID).Str("episode", episodeID).Msg("player error")
		go a.notifyDesktop("Nipah! Anime", fmt.Sprintf("Could not open %s - episode %v", animeTitle, episodeNum))
		return err
	}
	return nil
}

func isHLSStreamURL(raw string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(raw)), ".m3u8")
}

func inferStreamKind(raw string) string {
	if isHLSStreamURL(raw) {
		return "hls"
	}
	return "file"
}

func (a *App) openOnlineEpisodeWithCandidates(sourceID, episodeID string, episodeNum float64, animeTitle, episodeTitle string, startSec float64, candidates []extensions.StreamSource) (extensions.StreamSource, error) {
	var lastErr error
	for idx, candidate := range candidates {
		err := a.player.OpenEpisode(candidate.URL, -1, episodeNum, animeTitle, episodeTitle, startSec, candidate.Referer, candidate.Cookie)
		if err == nil {
			if idx > 0 {
				log.Info().
					Str("source", sourceID).
					Str("episode", episodeID).
					Int("candidate_index", idx+1).
					Str("stream_url", candidate.URL).
					Str("quality", candidate.Quality).
					Str("audio", candidate.Audio).
					Msg("online playback recovered using fallback stream candidate")
			}
			return candidate, nil
		}
		lastErr = err
		log.Warn().
			Err(err).
			Str("source", sourceID).
			Str("episode", episodeID).
			Int("candidate_index", idx+1).
			Str("stream_url", candidate.URL).
			Str("stream_host", hostFromURL(candidate.URL)).
			Str("referer_host", hostFromURL(candidate.Referer)).
			Str("quality", candidate.Quality).
			Str("audio", candidate.Audio).
			Bool("has_cookie", strings.TrimSpace(candidate.Cookie) != "").
			Msg("online playback candidate failed")
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no playable stream candidates were available")
	}
	return extensions.StreamSource{}, lastErr
}

func hostFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return parsed.Host
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (a *App) playbackMode(mode string) string {
	value := strings.ToLower(strings.TrimSpace(mode))
	if value == "" && a.db != nil {
		value = strings.ToLower(strings.TrimSpace(a.db.GetSetting("player", "mpv")))
	}
	switch value {
	case "integrated", "web", "embedded":
		return "integrated"
	default:
		return "mpv"
	}
}

func mediaProxyURL(rawURL, referer, cookie string) string {
	params := url.Values{}
	params.Set("url", rawURL)
	if strings.TrimSpace(referer) != "" {
		params.Set("referer", referer)
	}
	if strings.TrimSpace(cookie) != "" {
		params.Set("cookie", cookie)
	}
	return internalServerBaseURL + "/proxy/media?" + params.Encode()
}

func integratedPlaybackPayload(streamURL, referer, cookie, streamKind, title string) map[string]interface{} {
	proxyURL := mediaProxyURL(streamURL, referer, cookie)
	return map[string]interface{}{
		"launched":      false,
		"fallback_type": "integrated",
		"player_type":   "integrated",
		"fallback_url":  proxyURL,
		"proxy_url":     proxyURL,
		"stream_url":    streamURL,
		"stream_host":   hostFromURL(streamURL),
		"referer":       referer,
		"referer_host":  hostFromURL(referer),
		"has_cookie":    strings.TrimSpace(cookie) != "",
		"stream_kind":   firstNonEmptyString(streamKind, inferStreamKind(streamURL)),
		"title":         title,
	}
}

func (a *App) onlineSourceName(sourceID string) string {
	if a.registry == nil {
		return sourceID
	}
	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return sourceID
	}
	return src.Name()
}

func (a *App) setCurrentOnlinePlayback(ctx onlinePlaybackContext) {
	a.onlinePlaybackMu.Lock()
	defer a.onlinePlaybackMu.Unlock()
	a.onlinePlayback = ctx
}

func (a *App) currentOnlinePlayback() onlinePlaybackContext {
	a.onlinePlaybackMu.Lock()
	defer a.onlinePlaybackMu.Unlock()
	return a.onlinePlayback
}

func (a *App) updateOnlinePlaybackContext(fn func(*onlinePlaybackContext)) onlinePlaybackContext {
	a.onlinePlaybackMu.Lock()
	defer a.onlinePlaybackMu.Unlock()
	fn(&a.onlinePlayback)
	return a.onlinePlayback
}

func (a *App) clearCurrentOnlinePlayback() onlinePlaybackContext {
	a.onlinePlaybackMu.Lock()
	defer a.onlinePlaybackMu.Unlock()
	snapshot := a.onlinePlayback
	a.onlinePlayback = onlinePlaybackContext{}
	return snapshot
}

func (a *App) playerPlaybackSnapshot() player.PlaybackSnapshot {
	if a.player == nil {
		return player.PlaybackSnapshot{}
	}
	return a.player.State.Copy()
}

func extractEpisodeNumber(values ...string) int {
	for _, value := range values {
		text := strings.TrimSpace(value)
		if text == "" {
			continue
		}
		if match := episodeNumberPattern.FindStringSubmatch(text); len(match) > 1 {
			if n, err := strconv.Atoi(match[1]); err == nil && n > 0 {
				return n
			}
		}
		if match := episodeDigitsPattern.FindStringSubmatch(text); len(match) > 1 {
			if n, err := strconv.Atoi(match[1]); err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

func normalizeEpisodeText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case unicode.IsLetter(r), unicode.IsNumber(r):
			return r
		default:
			return ' '
		}
	}, value)
	return strings.Join(strings.Fields(cleaned), " ")
}

func matchAniListEpisodeThumbnail(meta *metadata.AnimeMetadata, episodeNum float64, episodeTitle string) string {
	if meta == nil || len(meta.StreamingEpisodes) == 0 {
		return ""
	}

	targetNum := int(math.Round(episodeNum))
	if targetNum <= 0 {
		targetNum = extractEpisodeNumber(episodeTitle)
	}

	if targetNum > 0 {
		for _, item := range meta.StreamingEpisodes {
			if strings.TrimSpace(item.Thumbnail) == "" {
				continue
			}
			if extractEpisodeNumber(item.Title, item.URL) == targetNum {
				return strings.TrimSpace(item.Thumbnail)
			}
		}
		if targetNum <= len(meta.StreamingEpisodes) {
			indexThumb := strings.TrimSpace(meta.StreamingEpisodes[targetNum-1].Thumbnail)
			if indexThumb != "" {
				return indexThumb
			}
		}
	}

	normalizedTarget := normalizeEpisodeText(episodeTitle)
	if normalizedTarget != "" {
		for _, item := range meta.StreamingEpisodes {
			if strings.TrimSpace(item.Thumbnail) == "" {
				continue
			}
			if normalizeEpisodeText(item.Title) == normalizedTarget {
				return strings.TrimSpace(item.Thumbnail)
			}
		}
	}

	return ""
}

func (a *App) loadAniListAnimeMetadata(anilistID int) (*metadata.AnimeMetadata, error) {
	if a.metadata == nil || anilistID <= 0 {
		return nil, nil
	}
	cacheKey := fmt.Sprintf("anilist:anime:id:%d", anilistID)
	result, _, err := rememberJSONWithStale[*metadata.AnimeMetadata](cacheKey, 2*time.Hour, 12*time.Hour, func() (*metadata.AnimeMetadata, error) {
		return a.metadata.GetAnimeByID(anilistID)
	})
	return result, err
}

func loadCachedAniListAnimeMetadata(anilistID int) (*metadata.AnimeMetadata, bool) {
	if anilistID <= 0 {
		return nil, false
	}
	cacheKey := fmt.Sprintf("anilist:anime:id:%d", anilistID)
	if cached, ok := readAppCachedJSON[*metadata.AnimeMetadata](cacheKey); ok && cached != nil {
		return cached, true
	}
	if stale, ok := readAppCachedJSON[*metadata.AnimeMetadata](staleAppCacheKey(cacheKey)); ok && stale != nil {
		return stale, true
	}
	return nil, false
}

func (a *App) loadAniListMangaMetadata(anilistID int) (*metadata.AniListMangaMetadata, error) {
	if a.metadata == nil || anilistID <= 0 {
		return nil, nil
	}
	cacheKey := fmt.Sprintf("anilist:manga:id:%d", anilistID)
	result, _, err := rememberJSONWithStale[*metadata.AniListMangaMetadata](cacheKey, 2*time.Hour, 12*time.Hour, func() (*metadata.AniListMangaMetadata, error) {
		return a.metadata.GetAniListMangaByID(anilistID)
	})
	return result, err
}

func loadCachedAniListMangaMetadata(anilistID int) (*metadata.AniListMangaMetadata, bool) {
	if anilistID <= 0 {
		return nil, false
	}
	cacheKey := fmt.Sprintf("anilist:manga:id:%d", anilistID)
	if cached, ok := readAppCachedJSON[*metadata.AniListMangaMetadata](cacheKey); ok && cached != nil {
		return cached, true
	}
	if stale, ok := readAppCachedJSON[*metadata.AniListMangaMetadata](staleAppCacheKey(cacheKey)); ok && stale != nil {
		return stale, true
	}
	return nil, false
}

func (a *App) cachedOnlineEpisodes(sourceID, animeID string) []extensions.Episode {
	cacheKey := fmt.Sprintf("anime:episodes:%s:%s", sourceID, animeID)
	if episodes, ok := readAppCachedJSON[[]extensions.Episode](cacheKey); ok {
		return episodes
	}
	if episodes, ok := readAppCachedJSON[[]extensions.Episode](staleAppCacheKey(cacheKey)); ok {
		return episodes
	}
	return nil
}

func (a *App) resolveCachedOnlineEpisode(sourceID, animeID, episodeID string) (extensions.Episode, bool) {
	episodes := a.cachedOnlineEpisodes(sourceID, animeID)
	for _, episode := range episodes {
		if strings.TrimSpace(episode.ID) == strings.TrimSpace(episodeID) {
			return episode, true
		}
	}
	return extensions.Episode{}, false
}

func (a *App) resolveOnlineEpisodeVisuals(sourceID, animeID, episodeID, coverURL string, anilistID int, episodeNum float64, episodeTitle string) (string, string, string) {
	cover := strings.TrimSpace(coverURL)
	banner := ""
	thumb := ""

	if episode, ok := a.resolveCachedOnlineEpisode(sourceID, animeID, episodeID); ok {
		thumb = strings.TrimSpace(episode.Thumbnail)
		if strings.TrimSpace(episodeTitle) == "" {
			episodeTitle = strings.TrimSpace(episode.Title)
		}
	}

	meta, err := a.loadAniListAnimeMetadata(anilistID)
	if err == nil && meta != nil {
		cover = firstNonEmptyString(cover, meta.CoverLarge, meta.CoverMedium)
		banner = firstNonEmptyString(meta.BannerImage, cover)
		if thumb == "" {
			thumb = matchAniListEpisodeThumbnail(meta, episodeNum, episodeTitle)
		}
	}

	thumb = firstNonEmptyString(thumb, banner, cover)
	return thumb, banner, cover
}

func shouldCompleteOnlinePlayback(progressSec, durationSec int, explicit bool) bool {
	if explicit {
		return true
	}
	if progressSec <= 0 || durationSec <= 0 {
		return false
	}
	if progressSec >= durationSec {
		return true
	}
	remaining := durationSec - progressSec
	if remaining <= 90 {
		return true
	}
	return float64(progressSec)/float64(durationSec) >= 0.92
}

func clampOnlineProgress(progressSec, durationSec int) int {
	if progressSec < 0 {
		progressSec = 0
	}
	if durationSec > 0 && progressSec > durationSec {
		return durationSec
	}
	return progressSec
}

func (a *App) persistOnlinePlaybackContext(ctx onlinePlaybackContext, completed bool) error {
	if a.db == nil || !ctx.Active {
		return nil
	}
	return a.db.RecordOnlineWatch(db.WatchHistoryEntry{
		AniListID:    ctx.AniListID,
		SourceID:     ctx.SourceID,
		SourceName:   ctx.SourceName,
		AnimeID:      ctx.AnimeID,
		AnimeTitle:   ctx.AnimeTitle,
		CoverURL:     ctx.CoverURL,
		EpisodeID:    ctx.EpisodeID,
		EpisodeNum:   ctx.EpisodeNum,
		EpisodeTitle: ctx.EpisodeTitle,
		EpisodeThumb: ctx.EpisodeThumb,
		ProgressSec:  ctx.ProgressSec,
		DurationSec:  ctx.DurationSec,
		Completed:    completed,
	})
}

func (a *App) updateCurrentOnlinePlaybackProgress(positionSec float64, durationSec float64, completed bool) error {
	ctx := a.currentOnlinePlayback()
	if !ctx.Active {
		return nil
	}

	playerSnap := a.playerPlaybackSnapshot()
	progress := int(math.Round(positionSec))
	if progress <= 0 && playerSnap.PositionSec > 0 {
		progress = int(math.Round(playerSnap.PositionSec))
	}
	if progress <= 0 {
		progress = ctx.ProgressSec
	}

	duration := int(math.Round(durationSec))
	if duration <= 0 && playerSnap.DurationSec > 0 {
		duration = int(math.Round(playerSnap.DurationSec))
	}
	if duration <= 0 {
		duration = ctx.DurationSec
	}

	progress = clampOnlineProgress(progress, duration)
	done := shouldCompleteOnlinePlayback(progress, duration, completed)

	ctx = a.updateOnlinePlaybackContext(func(state *onlinePlaybackContext) {
		if !state.Active {
			return
		}
		state.ProgressSec = progress
		if duration > 0 {
			state.DurationSec = duration
		}
	})

	if !ctx.Active {
		return nil
	}
	if err := a.persistOnlinePlaybackContext(ctx, done); err != nil {
		return err
	}
	a.emitOnlineWatchHistoryChanged(false)
	return nil
}

func (a *App) finalizeCurrentOnlinePlayback(positionSec float64, durationSec float64, completed bool) error {
	if err := a.updateCurrentOnlinePlaybackProgress(positionSec, durationSec, completed); err != nil {
		return err
	}

	ctx := a.clearCurrentOnlinePlayback()
	if !ctx.Active {
		return nil
	}

	ctx.ProgressSec = clampOnlineProgress(ctx.ProgressSec, ctx.DurationSec)
	done := shouldCompleteOnlinePlayback(ctx.ProgressSec, ctx.DurationSec, completed)
	if err := a.persistOnlinePlaybackContext(ctx, done); err != nil {
		return err
	}
	a.emitOnlineWatchHistoryChanged(true)
	if done {
		progress := int(math.Floor(ctx.EpisodeNum))
		if progress <= 0 {
			progress = extractEpisodeNumber(ctx.EpisodeTitle)
		}
		a.ensurePassiveAnimeTracked(ctx.AniListID, ctx.MalID, ctx.AnimeTitle, "", ctx.CoverURL, progress, 0, "")
	}
	return nil
}

func (a *App) UpdateOnlinePlaybackProgress(positionSec float64, durationSec float64) error {
	return a.updateCurrentOnlinePlaybackProgress(positionSec, durationSec, false)
}

func (a *App) FinalizeOnlinePlayback(positionSec float64, durationSec float64, completed bool) error {
	return a.finalizeCurrentOnlinePlayback(positionSec, durationSec, completed)
}

// OpenOnlineEpisode resolves and attempts playback in the requested player.
// Integrated mode returns an in-app payload; explicit MPV mode now returns an error on failure.
func (a *App) OpenOnlineEpisode(sourceID, episodeID, animeID, animeTitle, coverURL string, anilistID int, malID int, episodeNum float64, episodeTitle string, quality string, playerMode string) (map[string]interface{}, error) {
	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return nil, fmt.Errorf("source '%s' not found", sourceID)
	}
	streams, err := a.cachedAnimeStreams(src, sourceID, episodeID)
	if err != nil || len(streams) == 0 {
		if err != nil {
			log.Error().Err(err).Str("source", sourceID).Str("episode", episodeID).Msg("get-stream error")
			return nil, fmt.Errorf("%s playback could not be prepared: %w", a.onlineSourceName(sourceID), err)
		}
		return nil, fmt.Errorf("%s returned no playable streams for this episode", a.onlineSourceName(sourceID))
	}
	preferredAudio := a.preferredAnimeAudioForEpisode(episodeID)
	preferredQuality := a.preferredAnimeQuality(quality)
	best, ok := pickBestAnimeStream(streams, preferredAudio, preferredQuality)
	if !ok {
		return nil, fmt.Errorf("%s returned no preferred playable stream for this episode", a.onlineSourceName(sourceID))
	}
	streamKind := inferStreamKind(best.URL)
	candidates := playbackCandidateAnimeStreams(streams, preferredAudio, preferredQuality, 4)
	saved, _ := a.db.GetOnlineWatchProgress(sourceID, episodeID)
	startSec := 0.0
	if !saved.Completed && saved.ProgressSec > 0 {
		startSec = float64(saved.ProgressSec)
	}
	episodeThumb, _, resolvedCover := a.resolveOnlineEpisodeVisuals(sourceID, animeID, episodeID, coverURL, anilistID, episodeNum, episodeTitle)
	srcName := a.onlineSourceName(sourceID)
	playbackCtx := onlinePlaybackContext{
		Active:       true,
		SourceID:     sourceID,
		SourceName:   srcName,
		AnimeID:      animeID,
		AnimeTitle:   animeTitle,
		CoverURL:     resolvedCover,
		EpisodeID:    episodeID,
		EpisodeNum:   episodeNum,
		EpisodeTitle: firstNonEmptyString(episodeTitle, saved.EpisodeTitle),
		EpisodeThumb: firstNonEmptyString(episodeThumb, saved.EpisodeThumb),
		AniListID:    anilistID,
		MalID:        malID,
		ProgressSec:  int(math.Round(startSec)),
		DurationSec:  saved.DurationSec,
		PlayerMode:   a.playbackMode(playerMode),
	}
	a.setCurrentOnlinePlayback(playbackCtx)
	_ = a.db.RecordOnlineWatch(db.WatchHistoryEntry{
		AniListID:    anilistID,
		SourceID:     sourceID,
		SourceName:   srcName,
		AnimeID:      animeID,
		AnimeTitle:   animeTitle,
		CoverURL:     resolvedCover,
		EpisodeID:    episodeID,
		EpisodeNum:   episodeNum,
		EpisodeTitle: playbackCtx.EpisodeTitle,
		EpisodeThumb: playbackCtx.EpisodeThumb,
		ProgressSec:  playbackCtx.ProgressSec,
		DurationSec:  playbackCtx.DurationSec,
		Completed:    false,
	})
	a.emitOnlineWatchHistoryChanged(false)
	a.ensurePassiveAnimeTracked(anilistID, malID, animeTitle, "", resolvedCover, 0, 0, "")

	if playbackCtx.PlayerMode == "integrated" {
		payload := integratedPlaybackPayload(best.URL, best.Referer, best.Cookie, streamKind, playbackCtx.EpisodeTitle)
		payload["resume_sec"] = playbackCtx.ProgressSec
		payload["duration_sec"] = playbackCtx.DurationSec
		payload["episode_thumbnail"] = playbackCtx.EpisodeThumb
		return payload, nil
	}
	if a.player == nil {
		log.Error().
			Str("source", sourceID).
			Str("episode", episodeID).
			Str("stream_host", hostFromURL(best.URL)).
			Str("referer_host", hostFromURL(best.Referer)).
			Bool("has_cookie", strings.TrimSpace(best.Cookie) != "").
			Msg("mpv player unavailable for online episode")
		return nil, fmt.Errorf("%s playback requires MPV, but the external player is unavailable", srcName)
	}

	chosenStream, err := a.openOnlineEpisodeWithCandidates(sourceID, episodeID, episodeNum, animeTitle, playbackCtx.EpisodeTitle, startSec, candidates)
	if err != nil {
		log.Error().
			Err(err).
			Str("source", sourceID).
			Str("source_name", srcName).
			Str("episode", episodeID).
			Str("stream_url", best.URL).
			Str("stream_host", hostFromURL(best.URL)).
			Str("referer", best.Referer).
			Str("referer_host", hostFromURL(best.Referer)).
			Bool("has_cookie", strings.TrimSpace(best.Cookie) != "").
			Msg("mpv player error for online episode")
		return nil, fmt.Errorf("%s playback failed in MPV. Please try another server or source", srcName)
	}

	return map[string]interface{}{
		"launched":          true,
		"stream_url":        chosenStream.URL,
		"stream_host":       hostFromURL(chosenStream.URL),
		"referer":           chosenStream.Referer,
		"referer_host":      hostFromURL(chosenStream.Referer),
		"stream_kind":       inferStreamKind(chosenStream.URL),
		"resume_sec":        playbackCtx.ProgressSec,
		"duration_sec":      playbackCtx.DurationSec,
		"episode_thumbnail": playbackCtx.EpisodeThumb,
	}, nil
}

func (a *App) RecordIntegratedPlaybackDiagnostic(payload map[string]interface{}) error {
	entry := map[string]interface{}{
		"recorded_at": time.Now().UTC().Format(time.RFC3339),
	}
	for key, value := range payload {
		entry[key] = value
	}

	a.integratedDiagMu.Lock()
	a.integratedDiagnostics = append(a.integratedDiagnostics, entry)
	a.integratedDiagMu.Unlock()

	log.Info().
		Str("event", fmt.Sprintf("%v", entry["event"])).
		Str("source_label", fmt.Sprintf("%v", entry["source_label"])).
		Str("stream_kind", fmt.Sprintf("%v", entry["stream_kind"])).
		Str("stream_host", fmt.Sprintf("%v", entry["stream_host"])).
		Msg("integrated playback diagnostic")
	return nil
}

func (a *App) GetIntegratedPlaybackDiagnostics() []map[string]interface{} {
	a.integratedDiagMu.Lock()
	defer a.integratedDiagMu.Unlock()
	out := make([]map[string]interface{}, 0, len(a.integratedDiagnostics))
	for _, item := range a.integratedDiagnostics {
		copyItem := map[string]interface{}{}
		for key, value := range item {
			copyItem[key] = value
		}
		out = append(out, copyItem)
	}
	return out
}

func (a *App) ClearIntegratedPlaybackDiagnostics() {
	a.integratedDiagMu.Lock()
	defer a.integratedDiagMu.Unlock()
	a.integratedDiagnostics = nil
}

func (a *App) DiagnoseOnlinePlaybackSource(sourceID, animeID, episodeID string) (map[string]interface{}, error) {
	result := map[string]interface{}{
		"source_id":    sourceID,
		"anime_id":     animeID,
		"episode_id":   episodeID,
		"diagnosed_at": time.Now().UTC().Format(time.RFC3339),
	}
	if a.registry == nil {
		return result, fmt.Errorf("registry not initialized")
	}

	sourceProbe, sourceErr := a.ProbeAnimeSourceFlow(sourceID, animeID, episodeID)
	result["source_probe"] = sourceProbe
	if sourceErr != nil {
		result["classification"] = "mpv-only"
		result["classification_reason"] = sourceErr.Error()
		return result, nil
	}

	selectedEpisodeID, _ := sourceProbe["selected_episode_id"].(string)
	if strings.TrimSpace(selectedEpisodeID) == "" {
		result["classification"] = "mpv-only"
		result["classification_reason"] = "no episode id was available after source probing"
		return result, nil
	}

	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return result, err
	}
	rawStreams, err := src.GetStreamSources(selectedEpisodeID)
	if err != nil {
		result["classification"] = "mpv-only"
		result["classification_reason"] = err.Error()
		return result, nil
	}

	playable := filterPlayableAnimeStreams(rawStreams, sourceID, selectedEpisodeID)
	if len(playable) == 0 {
		result["classification"] = "mpv-only"
		result["classification_reason"] = "source resolved embeds but no browser-playable direct media survived filtering"
		result["playable_streams_count"] = 0
		return result, nil
	}

	best, ok := pickBestAnimeStream(playable, a.preferredAnimeAudioForEpisode(episodeID), a.preferredAnimeQuality(""))
	if !ok {
		result["classification"] = "mpv-only"
		result["classification_reason"] = "no preferred stream could be selected"
		return result, nil
	}

	proxyProbe, proxyErr := server.ProbeMediaProxy(best.URL, best.Referer, best.Cookie)
	if proxyProbe != nil {
		result["proxy_probe"] = proxyProbe
	}
	if proxyErr != nil {
		result["classification"] = "proxy-broken"
		result["classification_reason"] = proxyErr.Error()
		return result, nil
	}

	result["best_stream"] = map[string]interface{}{
		"url":         best.URL,
		"host":        hostFromURL(best.URL),
		"referer":     best.Referer,
		"refererHost": hostFromURL(best.Referer),
		"quality":     best.Quality,
		"audio":       best.Audio,
		"stream_kind": inferStreamKind(best.URL),
	}

	if proxyProbe != nil && proxyProbe.Classification == "proxy-broken" {
		result["classification"] = "proxy-broken"
		result["classification_reason"] = proxyProbe.ClassificationReason
		result["player_layer_suspect"] = false
		return result, nil
	}

	result["classification"] = "provider-compatible"
	result["classification_reason"] = "source extraction and proxy probing both look browser-compatible; if integrated playback still fails, the issue is likely inside the integrated player or webview layer"
	result["player_layer_suspect"] = true
	return result, nil
}

func (a *App) StreamTorrentMagnet(magnet, displayTitle, playerMode string) (map[string]interface{}, error) {
	if err := a.ensureTorrentStream(); err != nil {
		return nil, fmt.Errorf("torrent streaming not initialized: %w", err)
	}
	if a.torrentStream == nil {
		return nil, fmt.Errorf("torrent streaming not initialized")
	}
	session, err := a.torrentStream.PrepareSession(context.Background(), magnet, displayTitle)
	if err != nil {
		return nil, err
	}
	localURL := internalServerBaseURL + "/torrent/stream?id=" + url.QueryEscape(session.ID)
	if a.playbackMode(playerMode) == "integrated" {
		return integratedPlaybackPayload(localURL, "", "", "torrent", session.DisplayTitle), nil
	}
	if a.player == nil {
		return integratedPlaybackPayload(localURL, "", "", "torrent", session.DisplayTitle), nil
	}
	if err := a.player.OpenEpisode(localURL, -1, 0, session.DisplayTitle, session.FileName, 0); err != nil {
		return integratedPlaybackPayload(localURL, "", "", "torrent", session.DisplayTitle), nil
	}
	return map[string]interface{}{
		"launched":    true,
		"stream_url":  localURL,
		"session_id":  session.ID,
		"info_hash":   session.InfoHash,
		"file_name":   session.FileName,
		"title":       session.DisplayTitle,
		"contentType": session.ContentType,
		"stream_kind": "torrent",
	}, nil
}

// MarkOnlineWatched explicitly marks an online episode as completed and syncs progress.
func (a *App) MarkOnlineWatched(sourceID, episodeID, animeID, animeTitle, coverURL string, anilistID int, malID int, episodeNum float64) error {
	episodeThumb, _, resolvedCover := a.resolveOnlineEpisodeVisuals(sourceID, animeID, episodeID, coverURL, anilistID, episodeNum, "")
	srcName := a.onlineSourceName(sourceID)
	if err := a.db.RecordOnlineWatch(db.WatchHistoryEntry{
		AniListID:    anilistID,
		SourceID:     sourceID,
		SourceName:   srcName,
		AnimeID:      animeID,
		AnimeTitle:   animeTitle,
		CoverURL:     resolvedCover,
		EpisodeID:    episodeID,
		EpisodeNum:   episodeNum,
		EpisodeThumb: episodeThumb,
		Completed:    true,
	}); err != nil {
		return err
	}
	a.emitOnlineWatchHistoryChanged(true)

	progress := int(math.Floor(episodeNum))
	if progress <= 0 {
		progress = 1
	}
	a.ensurePassiveAnimeTracked(anilistID, malID, animeTitle, "", resolvedCover, progress, 0, "")
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
	a.enrichOnlineHistoryVisuals(entries, limit)
	out := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		out = append(out, map[string]interface{}{
			"id": e.ID, "source_id": e.SourceID, "source_name": e.SourceName,
			"anime_id": e.AnimeID, "anime_title": e.AnimeTitle, "cover_url": e.CoverURL,
			"episode_id": e.EpisodeID, "episode_num": e.EpisodeNum,
			"episode_title": e.EpisodeTitle, "watched_at": e.WatchedAt,
			"completed": e.Completed, "anilist_id": e.AniListID,
			"episode_thumbnail": e.EpisodeThumb,
			"progress_sec":      e.ProgressSec, "duration_sec": e.DurationSec,
			"banner_image": e.BannerImage,
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
	started := time.Now()
	if a.db == nil {
		return nil, fmt.Errorf("db not initialized")
	}
	dash, err := a.db.GetDashboard()
	if err != nil {
		return nil, err
	}
	groupedContinueReadingOnline := []db.WatchHistoryEntry{}
	groupedByFormat := map[string][]db.WatchHistoryEntry{
		"MANGA":  {},
		"MANHWA": {},
		"MANHUA": {},
	}
	if mangaContinue, err := a.db.GetContinueReadingOnline(10); err == nil {
		groupedContinueReadingOnline, groupedByFormat = a.groupOnlineMangaDashboardEntries(mangaContinue)
		dash.ContinueWatchingOnline = append(dash.ContinueWatchingOnline, groupedContinueReadingOnline...)
	}
	if recentManga, err := a.db.GetRecentlyReadManga(12); err == nil {
		for _, item := range recentManga {
			entry := db.WatchHistoryEntry{
				ID:           item.ID,
				AniListID:    item.AniListID,
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
			}
			dash.RecentlyWatched = append(dash.RecentlyWatched, entry)
		}
	}
	// Home should stay local-first. Only hydrate visuals from cache here so the
	// landing page never blocks on remote AniList lookups.
	a.enrichOnlineHistoryVisualsFromCache(dash.ContinueWatchingOnline, 6)
	a.enrichOnlineHistoryVisualsFromCache(dash.RecentlyWatched, 6)
	// Convert anime_list entries to maps
	watchingMaps := animeListToMaps(dash.WatchingList)
	planningMaps := animeListToMaps(dash.PlanningList)
	completedMaps := animeListToMaps(dash.CompletedList)
	onHoldMaps := animeListToMaps(dash.OnHoldList)

	result := map[string]interface{}{
		"continue_watching":              dash.ContinueWatching,
		"continue_watching_online":       dash.ContinueWatchingOnline,
		"continue_reading_online":        groupedContinueReadingOnline,
		"continue_reading_online_manga":  groupedByFormat["MANGA"],
		"continue_reading_online_manhwa": groupedByFormat["MANHWA"],
		"continue_reading_online_manhua": groupedByFormat["MANHUA"],
		"recently_watched":               dash.RecentlyWatched,
		"recent_anime":                   dash.RecentAnime,
		"completed_anime":                dash.CompletedAnime,
		"continue_reading":               dash.ContinueReading,
		"recent_manga":                   dash.RecentManga,
		"watching_list":                  watchingMaps,
		"planning_list":                  planningMaps,
		"completed_list":                 completedMaps,
		"on_hold_list":                   onHoldMaps,
		"stats":                          dash.Stats,
	}
	log.Debug().
		Int("continue_local", len(dash.ContinueWatching)).
		Int("continue_online", len(dash.ContinueWatchingOnline)).
		Int("recent_anime", len(dash.RecentAnime)).
		Int("recent_manga", len(dash.RecentManga)).
		Dur("took", time.Since(started)).
		Msg("GetDashboard")
	return result, nil
}

func (a *App) groupOnlineMangaDashboardEntries(items []db.OnlineMangaHistoryEntry) ([]db.WatchHistoryEntry, map[string][]db.WatchHistoryEntry) {
	grouped := map[string]db.WatchHistoryEntry{}
	for _, item := range items {
		entry := db.WatchHistoryEntry{
			ID:           item.ID,
			AniListID:    item.AniListID,
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
		}
		key := mangaDashboardIdentityKey(item)
		if existing, ok := grouped[key]; !ok || item.ReadAt.After(existing.WatchedAt) {
			grouped[key] = entry
		}
	}

	all := make([]db.WatchHistoryEntry, 0, len(grouped))
	for _, entry := range grouped {
		entry.MediaFormat = normalizeDashboardMangaFormat(entry.MediaFormat)
		all = append(all, entry)
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].WatchedAt.After(all[j].WatchedAt)
	})

	byFormat := map[string][]db.WatchHistoryEntry{
		"MANGA":  {},
		"MANHWA": {},
		"MANHUA": {},
	}
	for _, entry := range all {
		format := normalizeDashboardMangaFormat(entry.MediaFormat)
		byFormat[format] = append(byFormat[format], entry)
	}
	return all, byFormat
}

func mangaDashboardIdentityKey(item db.OnlineMangaHistoryEntry) string {
	if item.AniListID > 0 {
		return fmt.Sprintf("anilist:%d", item.AniListID)
	}
	return "title:" + normalizeDashboardMangaTitle(item.SourceMangaTitle)
}

func normalizeDashboardMangaTitle(title string) string {
	title = strings.ToLower(strings.TrimSpace(title))
	replacer := strings.NewReplacer("-", " ", "_", " ", ":", " ", ".", " ", ",", " ", "'", "", "\"", "")
	title = replacer.Replace(title)
	return strings.Join(strings.Fields(title), " ")
}

func normalizeDashboardMangaFormat(format string) string {
	switch strings.ToUpper(strings.TrimSpace(format)) {
	case "MANHWA":
		return "MANHWA"
	case "MANHUA":
		return "MANHUA"
	default:
		return "MANGA"
	}
}

func normalizeDashboardMangaOrigin(origin string) string {
	switch strings.ToUpper(strings.TrimSpace(origin)) {
	case "KR":
		return "MANHWA"
	case "CN", "TW", "HK":
		return "MANHUA"
	default:
		return "MANGA"
	}
}

func (a *App) resolveDashboardMangaFormat(anilistID int) string {
	if anilistID <= 0 || a.metadata == nil {
		return ""
	}
	meta, err := a.metadata.GetAniListMangaByID(anilistID)
	if err != nil || meta == nil {
		return ""
	}
	return normalizeDashboardMangaOrigin(meta.CountryOfOrigin)
}

func (a *App) resolveTrackedMangaFormat(item db.MangaListEntry, origins map[int]string) string {
	if item.AnilistID > 0 {
		if origin := origins[item.AnilistID]; strings.TrimSpace(origin) != "" {
			return normalizeDashboardMangaOrigin(origin)
		}
		if direct := a.resolveDashboardMangaFormat(item.AnilistID); direct != "" {
			return normalizeDashboardMangaFormat(direct)
		}
	}
	if a.metadata == nil {
		return "MANGA"
	}

	searchTitle := strings.TrimSpace(item.TitleEnglish)
	if searchTitle == "" {
		searchTitle = strings.TrimSpace(item.Title)
	}
	if searchTitle == "" {
		return "MANGA"
	}

	matches, err := a.metadata.SearchAniListMangaEntries(searchTitle)
	if err != nil || len(matches) == 0 {
		return "MANGA"
	}
	switch strings.ToUpper(strings.TrimSpace(matches[0].CountryOfOrigin)) {
	default:
		return normalizeDashboardMangaOrigin(matches[0].CountryOfOrigin)
	}
}

func (a *App) decorateTrackedMangaFormats(items []db.MangaListEntry) []db.MangaListEntry {
	if len(items) == 0 {
		return items
	}

	origins := map[int]string{}
	if a.metadata != nil {
		ids := make([]int, 0, len(items))
		seen := map[int]struct{}{}
		for _, item := range items {
			if item.AnilistID <= 0 {
				continue
			}
			if _, ok := seen[item.AnilistID]; ok {
				continue
			}
			seen[item.AnilistID] = struct{}{}
			ids = append(ids, item.AnilistID)
		}
		if len(ids) > 0 {
			if batchOrigins, batchErr := a.metadata.GetAniListMangaOriginsByIDs(ids); batchErr == nil && batchOrigins != nil {
				origins = batchOrigins
			}
		}
	}

	out := make([]db.MangaListEntry, 0, len(items))
	for _, item := range items {
		item.MediaFormat = a.resolveTrackedMangaFormat(item, origins)
		out = append(out, item)
	}
	return out
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
		if entries[i].AniListID > 0 {
			meta, err := a.loadAniListAnimeMetadata(entries[i].AniListID)
			if err == nil && meta != nil {
				entries[i].CoverURL = firstNonEmptyString(entries[i].CoverURL, meta.CoverLarge, meta.CoverMedium)
				entries[i].BannerImage = firstNonEmptyString(entries[i].BannerImage, meta.BannerImage, entries[i].CoverURL)
				if entries[i].EpisodeThumb == "" {
					entries[i].EpisodeThumb = firstNonEmptyString(
						matchAniListEpisodeThumbnail(meta, entries[i].EpisodeNum, entries[i].EpisodeTitle),
						entries[i].BannerImage,
						entries[i].CoverURL,
					)
				}
				continue
			}
		}

		cacheKey := onlineVisualCacheKey(entries[i].AnimeTitle)
		if cacheKey == "" {
			entries[i].EpisodeThumb = firstNonEmptyString(entries[i].EpisodeThumb, entries[i].BannerImage, entries[i].CoverURL)
			continue
		}
		if banner, ok := a.getOnlineVisualCache(cacheKey); ok {
			entries[i].BannerImage = firstNonEmptyString(entries[i].BannerImage, banner)
			entries[i].EpisodeThumb = firstNonEmptyString(entries[i].EpisodeThumb, entries[i].BannerImage, entries[i].CoverURL)
			continue
		}
		if _, exists := seen[cacheKey]; exists {
			entries[i].EpisodeThumb = firstNonEmptyString(entries[i].EpisodeThumb, entries[i].BannerImage, entries[i].CoverURL)
			continue
		}
		seen[cacheKey] = struct{}{}
		missingTitles = append(missingTitles, entries[i].AnimeTitle)
		entries[i].EpisodeThumb = firstNonEmptyString(entries[i].EpisodeThumb, entries[i].BannerImage, entries[i].CoverURL)
	}

	if len(missingTitles) > 0 {
		go a.primeOnlineHistoryVisuals(missingTitles)
	}
}

func (a *App) enrichOnlineHistoryVisualsFromCache(entries []db.WatchHistoryEntry, limit int) {
	if len(entries) == 0 || limit <= 0 {
		return
	}

	seen := map[string]struct{}{}
	missingTitles := make([]string, 0, limit)

	for i := range entries {
		if entries[i].AniListID > 0 {
			if meta, ok := loadCachedAniListAnimeMetadata(entries[i].AniListID); ok && meta != nil {
				entries[i].CoverURL = firstNonEmptyString(entries[i].CoverURL, meta.CoverLarge, meta.CoverMedium)
				entries[i].BannerImage = firstNonEmptyString(entries[i].BannerImage, meta.BannerImage, entries[i].CoverURL)
				if entries[i].EpisodeThumb == "" {
					entries[i].EpisodeThumb = firstNonEmptyString(
						matchAniListEpisodeThumbnail(meta, entries[i].EpisodeNum, entries[i].EpisodeTitle),
						entries[i].BannerImage,
						entries[i].CoverURL,
					)
				}
			}
		}

		cacheKey := onlineVisualCacheKey(entries[i].AnimeTitle)
		if cacheKey != "" {
			if banner, ok := a.getOnlineVisualCache(cacheKey); ok {
				entries[i].BannerImage = firstNonEmptyString(entries[i].BannerImage, banner, entries[i].CoverURL)
			} else if len(missingTitles) < limit {
				if _, exists := seen[cacheKey]; !exists {
					seen[cacheKey] = struct{}{}
					missingTitles = append(missingTitles, entries[i].AnimeTitle)
				}
			}
		}

		entries[i].EpisodeThumb = firstNonEmptyString(entries[i].EpisodeThumb, entries[i].BannerImage, entries[i].CoverURL)
	}

	if a.metadata != nil && len(missingTitles) > 0 {
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
	return a.SearchMangaGlobal(query, lang)
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
	results, searchStats, err := searchMangaSourceCached(src, sourceID, query, lang, 10*time.Minute, 45*time.Second)
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
	if maxResolvedSearchResultsForSource(sourceID, len(out)) == 0 {
		log.Debug().
			Str("source_id", sourceID).
			Str("operation", "search").
			Str("original_query", query).
			Str("lang", lang).
			Str("cache_origin", searchStats.CacheOrigin).
			Int("search_candidate_count", searchStats.CandidateCount).
			Int("backend_search_calls", searchStats.SearchCalls).
			Str("matched_query", searchStats.MatchedQuery).
			Int("result_count", len(out)).
			Dur("took", time.Since(started)).
			Msg("SearchMangaSource raw")
		return out, nil
	}
	resolved := a.resolveMangaSearchResults(sourceID, out)
	log.Debug().
		Str("source_id", sourceID).
		Str("operation", "search").
		Str("original_query", query).
		Str("lang", lang).
		Str("cache_origin", searchStats.CacheOrigin).
		Int("search_candidate_count", searchStats.CandidateCount).
		Int("backend_search_calls", searchStats.SearchCalls).
		Str("matched_query", searchStats.MatchedQuery).
		Int("result_count", len(resolved)).
		Dur("took", time.Since(started)).
		Msg("SearchMangaSource")
	return resolved, nil
}

func (a *App) GetMangaChaptersOnline(mangaID string, lang string) ([]map[string]interface{}, error) {
	sourceID := "m440-es"
	if strings.TrimSpace(lang) == "en" {
		sourceID = "weebcentral-en"
	}
	return a.GetMangaChaptersSource(sourceID, mangaID, lang)
}

func (a *App) GetMangaChaptersSource(sourceID, mangaID, lang string) ([]map[string]interface{}, error) {
	started := time.Now()
	normalizedLang := lang
	if normalizedLang == "" {
		normalizedLang = "es"
	}
	log.Debug().Str("source", sourceID).Str("manga", mangaID).Str("lang", normalizedLang).Msg("GetChapters")
	if a.registry == nil {
		return nil, fmt.Errorf("registry not initialized")
	}
	src, err := a.registry.GetManga(sourceID)
	if err != nil {
		log.Error().Err(err).Msg("manga source not found")
		return nil, err
	}
	partial, hydrating := mangaChapterLoadState(sourceID, mangaID)
	var (
		chapters []extensions.Chapter
		origin   string
	)
	cacheKey := mangaSourceChapterCacheKey(sourceID, mangaID, normalizedLang)
	loaded, cacheOrigin, loadErr := rememberMangaChaptersWithPolicy(cacheKey, func() ([]extensions.Chapter, error) {
		return src.GetChapters(mangaID, extensions.Language(normalizedLang))
	})
	if loadErr != nil {
		log.Error().Err(loadErr).Str("source", sourceID).Str("manga", mangaID).Str("lang", normalizedLang).Msg("GetChapters error")
		return nil, fmt.Errorf("failed to load chapters: %w", loadErr)
	}
	chapters = loaded
	origin = cacheOrigin
	partial, hydrating = mangaChapterLoadState(sourceID, mangaID)
	out := make([]map[string]interface{}, 0, len(chapters))
	for _, ch := range chapters {
		out = append(out, map[string]interface{}{
			"id": ch.ID, "number": ch.Number, "volume_num": ch.VolumeNum,
			"title": ch.Title, "page_count": ch.PageCount, "uploaded_at": ch.UploadedAt,
			"locked": ch.Locked, "price": ch.Price,
		})
	}
	log.Debug().
		Str("source_id", sourceID).
		Str("operation", "chapters").
		Str("manga", mangaID).
		Str("lang", normalizedLang).
		Str("cache_origin", origin).
		Bool("partial", partial).
		Bool("hydrating", hydrating).
		Int("result_count", len(out)).
		Dur("took", time.Since(started)).
		Msg("GetMangaChaptersSource")
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
	cacheKey := fmt.Sprintf("manga:pages:%s:%s:%t", sourceID, chapterID, dataSaver)
	pages, origin, err := rememberJSONWithStale[[]extensions.PageSource](cacheKey, 30*time.Minute, 2*time.Hour, func() ([]extensions.PageSource, error) {
		return src.GetPages(chapterID)
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load pages: %w", err)
	}
	out := make([]map[string]interface{}, 0, len(pages))
	for _, p := range pages {
		out = append(out, map[string]interface{}{"url": p.URL, "index": p.Index})
	}
	log.Debug().
		Str("source_id", sourceID).
		Str("operation", "pages").
		Str("chapter", chapterID).
		Bool("data_saver", dataSaver).
		Str("cache_origin", origin).
		Int("result_count", len(out)).
		Msg("GetChapterPagesSource")
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

func onlineDownloadHostLabel(rawURL, referer string) string {
	candidates := []string{rawURL, referer}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		parsed, err := url.Parse(candidate)
		if err != nil || parsed.Host == "" {
			continue
		}
		host := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
		if host != "" {
			return host
		}
	}
	return "stream"
}

// GetDownloadLinks returns available download links for a supported episode source.
func (a *App) GetDownloadLinks(sourceID, episodeID string) ([]map[string]interface{}, error) {
	switch sourceID {
	case "jkanime-es":
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

	case "animepahe-en", "animegg-en":
		src, err := a.registry.GetAnime(sourceID)
		if err != nil {
			return nil, err
		}
		streams, err := src.GetStreamSources(episodeID)
		if err != nil {
			return nil, err
		}
		sorted := sortAnimeStreamsForPreference(streams, a.preferredAnimeAudioForEpisode(episodeID), a.preferredAnimeQuality(""))
		out := make([]map[string]interface{}, 0, len(sorted))
		seen := map[string]bool{}
		for _, stream := range sorted {
			if strings.TrimSpace(stream.URL) == "" {
				continue
			}
			key := stream.URL + "|" + stream.Referer + "|" + stream.Cookie
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, map[string]interface{}{
				"url":     stream.URL,
				"host":    onlineDownloadHostLabel(stream.URL, stream.Referer),
				"quality": strings.TrimSpace(stream.Quality),
				"audio":   strings.TrimSpace(stream.Audio),
				"referer": strings.TrimSpace(stream.Referer),
				"cookie":  strings.TrimSpace(stream.Cookie),
			})
		}
		if len(out) == 0 {
			return nil, fmt.Errorf("no download links are available for this source")
		}
		return out, nil
	default:
		return nil, fmt.Errorf("downloads are not available for this source")
	}
}

// StartDownload begins downloading an episode file.
func (a *App) StartDownload(sourceURL, animeTitle string, episodeNum float64, episodeTitle, coverURL, referer, cookie string) (int, error) {
	if a.db == nil {
		return 0, fmt.Errorf("not initialized")
	}
	if err := a.ensureDownloader(); err != nil {
		return 0, err
	}
	id, err := a.db.InsertDownload(animeTitle, episodeNum, episodeTitle, coverURL, sourceURL)
	if err != nil {
		return 0, fmt.Errorf("could not create download: %w", err)
	}
	fileName := fmt.Sprintf("%s - Ep %g.mp4", animeTitle, episodeNum)
	if err := a.downloader.Start(id, sourceURL, fileName, animeTitle, episodeNum, referer, cookie); err != nil {
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
	if a.downloadDir != "" {
		return a.downloadDir
	}
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
	return a.player.TogglePause()
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
	log.Info().Msg("starting AniList login flow")

	// Step 1: Start callback server
	cs, err := auth.StartCallbackServer()
	if err != nil {
		return nil, err
	}
	log.Debug().Str("redirect_uri", cs.RedirectURI).Msg("AniList redirect URI")

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

	log.Info().Str("username", user.Name).Int("user_id", user.ID).Msg("AniList login successful")
	return map[string]interface{}{
		"username": user.Name,
		"user_id":  user.ID,
		"avatar":   user.Avatar,
	}, nil
}

// LoginMAL starts the MAL OAuth flow with PKCE.
func (a *App) LoginMAL() (map[string]interface{}, error) {
	return nil, fmt.Errorf("MyAnimeList esta deprecado por ahora")
	log.Info().Msg("starting MAL login flow")

	// Step 1: Start callback server
	cs, err := auth.StartCallbackServer()
	if err != nil {
		return nil, err
	}
	log.Debug().Str("redirect_uri", cs.RedirectURI).Msg("MAL redirect URI")

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

	log.Info().Str("username", user.Name).Int("user_id", user.ID).Msg("MAL login successful")
	return map[string]interface{}{
		"username": user.Name,
		"user_id":  user.ID,
		"avatar":   user.Picture,
	}, nil
}

// Logout removes the stored token for a provider.
func (a *App) Logout(provider string) error {
	log.Info().Str("provider", provider).Msg("logging out")
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
		log.Error().Err(err).Msg("AniList anime list fetch failed")
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
				log.Error().Err(err).Str("title", e.Title).Msg("AniList anime upsert failed")
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
		log.Error().Err(err).Msg("AniList manga list fetch failed")
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
				log.Error().Err(err).Str("title", e.Title).Msg("AniList manga upsert failed")
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

	log.Info().Int("anime", animeCount).Int("manga", mangaCount).Msg("AniList sync complete")
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
		log.Error().Err(err).Msg("MAL anime list fetch failed")
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
		log.Error().Err(err).Msg("MAL manga list fetch failed")
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

	log.Info().Int("anime", animeCount).Int("manga", mangaCount).Msg("MAL sync complete")
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

	log.Info().Msg("refreshing MAL access token")
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

// GetMangaListByFormat groups tracked manga entries into Manga / Manhwa / Manhua
// without affecting the core manga-list loading path used elsewhere in the app.
func (a *App) GetMangaListByFormat() (map[string][]db.MangaListEntry, error) {
	items, err := a.db.GetMangaListAll()
	if err != nil {
		return nil, err
	}

	items = a.decorateTrackedMangaFormats(items)

	grouped := map[string][]db.MangaListEntry{
		"manga":  {},
		"manhwa": {},
		"manhua": {},
	}

	for _, item := range items {
		format := normalizeDashboardMangaFormat(item.MediaFormat)
		switch format {
		case "MANHWA":
			grouped["manhwa"] = append(grouped["manhwa"], item)
		case "MANHUA":
			grouped["manhua"] = append(grouped["manhua"], item)
		default:
			grouped["manga"] = append(grouped["manga"], item)
		}
	}

	return grouped, nil
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
