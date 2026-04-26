package main

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"miruro/backend/auth"
	"miruro/backend/db"
)

type ListSyncResult struct {
	LocalSaved      bool     `json:"local_saved"`
	RemoteAttempted int      `json:"remote_attempted"`
	RemoteSucceeded int      `json:"remote_succeeded"`
	RemoteFailed    int      `json:"remote_failed"`
	QueuedRetry     bool     `json:"queued_retry"`
	Messages        []string `json:"messages"`
}

type listSyncPayload struct {
	MediaType       string  `json:"media_type"`
	AniListID       int     `json:"anilist_id"`
	MalID           int     `json:"mal_id"`
	Title           string  `json:"title"`
	TitleEnglish    string  `json:"title_english"`
	CoverImage      string  `json:"cover_image"`
	BannerImage     string  `json:"banner_image"`
	Status          string  `json:"status"`
	EpisodesWatched int     `json:"episodes_watched"`
	EpisodesTotal   int     `json:"episodes_total"`
	ChaptersRead    int     `json:"chapters_read"`
	ChaptersTotal   int     `json:"chapters_total"`
	VolumesRead     int     `json:"volumes_read"`
	VolumesTotal    int     `json:"volumes_total"`
	Score           float64 `json:"score"`
	AiringStatus    string  `json:"airing_status"`
	Year            int     `json:"year"`
}

func (a *App) syncLocalProgressFromAnimeListEntry(entry db.AnimeListEntry) {
	if a == nil || a.db == nil {
		return
	}
	_ = a.db.MarkAnimeEpisodesWatchedUpToAniList(entry.AnilistID, entry.EpisodesWatched)
}

func (a *App) syncLocalProgressFromMangaListEntry(entry db.MangaListEntry) {
	if a == nil || a.db == nil {
		return
	}
	_ = a.db.MarkMangaChaptersReadUpToAniList(entry.AnilistID, entry.ChaptersRead)
}

func newListSyncResult() *ListSyncResult {
	return &ListSyncResult{Messages: []string{}}
}

func (r *ListSyncResult) addMessage(format string, args ...interface{}) {
	r.Messages = append(r.Messages, fmt.Sprintf(format, args...))
}

func (a *App) syncAnimePayloadAfterLocalSave(payload listSyncPayload) (*ListSyncResult, error) {
	result := newListSyncResult()
	result.LocalSaved = true
	a.enqueueAndAttemptRemoteSync(payload, "upsert", result)
	return result, nil
}

func (a *App) syncMangaPayloadAfterLocalSave(payload listSyncPayload) (*ListSyncResult, error) {
	result := newListSyncResult()
	result.LocalSaved = true
	a.enqueueAndAttemptRemoteSync(payload, "upsert", result)
	return result, nil
}

func (a *App) syncDeleteAfterLocalSave(payload listSyncPayload, syncRemote bool) (*ListSyncResult, error) {
	result := newListSyncResult()
	result.LocalSaved = true
	if syncRemote {
		a.enqueueAndAttemptRemoteSync(payload, "delete", result)
	}
	return result, nil
}

func (a *App) enqueueAndAttemptRemoteSync(payload listSyncPayload, action string, result *ListSyncResult) {
	if a.db == nil || result == nil {
		return
	}

	for _, provider := range []string{"anilist"} {
		if !a.isProviderConnected(provider) {
			continue
		}
		if provider == "anilist" && payload.AniListID <= 0 {
			result.addMessage("AniList omitido: falta AniList ID.")
			continue
		}

		job, err := a.enqueueRemoteSyncJob(provider, action, payload)
		if err != nil {
			result.RemoteFailed++
			result.QueuedRetry = true
			result.addMessage("%s: no se pudo encolar el cambio (%v).", providerLabel(provider), err)
			continue
		}

		result.RemoteAttempted++
		if err := a.executeRemoteSyncJob(job); err != nil {
			result.RemoteFailed++
			result.QueuedRetry = true
			result.addMessage("%s: %v", providerLabel(provider), err)
			_ = a.db.MarkRemoteListSyncJobFailed(job.ID, err.Error())
			continue
		}

		result.RemoteSucceeded++
		_ = a.db.DeleteRemoteListSyncJob(job.ID)
	}
}

func (a *App) enqueueRemoteSyncJob(provider, action string, payload listSyncPayload) (*db.RemoteListSyncJob, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return a.db.UpsertRemoteListSyncJob(db.RemoteListSyncJob{
		Provider:    provider,
		MediaType:   payload.MediaType,
		Action:      action,
		MediaKey:    mediaKey(payload.AniListID, payload.MalID),
		AniListID:   payload.AniListID,
		MalID:       payload.MalID,
		PayloadJSON: string(body),
	})
}

func (a *App) executeRemoteSyncJob(job *db.RemoteListSyncJob) error {
	if job == nil {
		return nil
	}
	_ = a.db.MarkRemoteListSyncJobAttempted(job.ID)

	var payload listSyncPayload
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return fmt.Errorf("payload invalido: %w", err)
	}

	switch job.Provider {
	case "anilist":
		token, userID, err := a.getAniListSyncToken()
		if err != nil {
			return err
		}
		if job.Action == "delete" {
			return auth.AniListDeleteListEntry(token, userID, payload.AniListID)
		}
		return auth.AniListUpsertListEntry(token, auth.AniListUpsertInput{
			MediaID:         payload.AniListID,
			Status:          aniListStatusFromInternal(payload.Status),
			Progress:        payloadProgress(payload),
			ProgressVolumes: payloadVolumes(payload),
			Score:           payload.Score,
		})
	default:
		return fmt.Errorf("proveedor no soportado: %s", job.Provider)
	}
}

func (a *App) GetRemoteListSyncStatus() (map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	counts, err := a.db.GetRemoteListSyncStatusCounts()
	if err != nil {
		return nil, err
	}
	errors, err := a.db.GetRemoteListSyncErrors(5)
	if err != nil {
		return nil, err
	}

	failed := 0
	pending := 0
	filteredCounts := map[string]map[string]int{}
	for provider, providerCounts := range counts {
		if provider != "anilist" {
			continue
		}
		filteredCounts[provider] = providerCounts
		failed += providerCounts["failed"]
		pending += providerCounts["pending"]
	}
	items := make([]map[string]interface{}, 0, len(errors))
	for _, item := range errors {
		if item.Provider != "anilist" {
			continue
		}
		items = append(items, map[string]interface{}{
			"id":          item.ID,
			"provider":    item.Provider,
			"media_type":  item.MediaType,
			"action":      item.Action,
			"retry_count": item.RetryCount,
			"last_error":  item.LastError,
			"updated_at":  item.UpdatedAt,
		})
	}
	return map[string]interface{}{
		"pending_count": pending,
		"failed_count":  failed,
		"by_provider":   filteredCounts,
		"errors":        items,
	}, nil
}

func (a *App) RetryRemoteListSync(provider string) (*ListSyncResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	result := newListSyncResult()
	targetProvider := strings.TrimSpace(provider)
	if targetProvider == "mal" {
		result.addMessage("MyAnimeList esta deprecado.")
		return result, nil
	}
	if targetProvider == "" {
		targetProvider = "anilist"
	}
	jobs, err := a.db.ListRemoteListSyncJobs(targetProvider, 100)
	if err != nil {
		return nil, err
	}
	for i := range jobs {
		job := jobs[i]
		result.RemoteAttempted++
		if err := a.executeRemoteSyncJob(&job); err != nil {
			result.RemoteFailed++
			result.QueuedRetry = true
			result.addMessage("%s: %v", providerLabel(job.Provider), err)
			_ = a.db.MarkRemoteListSyncJobFailed(job.ID, err.Error())
			continue
		}
		result.RemoteSucceeded++
		_ = a.db.DeleteRemoteListSyncJob(job.ID)
	}
	return result, nil
}

func (a *App) ensurePassiveAnimeTracked(anilistID, malID int, title, titleEnglish, coverImage string, progress int, year int, airingStatus string) {
	if a.db == nil || anilistID <= 0 {
		return
	}

	entry, _ := a.db.GetAnimeListEntryByAniListID(anilistID)
	if entry == nil {
		next := db.AnimeListEntry{
			AnilistID:       anilistID,
			MalID:           malID,
			Title:           firstNonEmpty(title, titleEnglish, "Anime"),
			TitleEnglish:    titleEnglish,
			CoverImage:      coverImage,
			Status:          "WATCHING",
			EpisodesWatched: maxInt(progress, 0),
			EpisodesTotal:   0,
			Score:           0,
			AiringStatus:    airingStatus,
			Year:            year,
		}
		if a.metadata != nil {
			if meta, err := a.metadata.GetAnimeByID(anilistID); err == nil && meta != nil {
				next.MalID = chooseResolvedInt(next.MalID, meta.MalID)
				next.Title = firstNonEmpty(meta.TitleRomaji, meta.TitleEnglish, next.Title)
				next.TitleEnglish = firstNonEmpty(meta.TitleEnglish, next.TitleEnglish)
				next.CoverImage = firstNonEmpty(meta.CoverLarge, meta.CoverMedium, next.CoverImage)
				next.BannerImage = firstNonEmpty(meta.BannerImage, next.BannerImage)
				next.EpisodesTotal = maxInt(next.EpisodesTotal, meta.Episodes)
				next.AiringStatus = firstNonEmpty(meta.Status, next.AiringStatus)
				next.Year = chooseResolvedInt(next.Year, meta.Year)
			}
		}
		if next.EpisodesTotal > 0 && next.EpisodesWatched >= next.EpisodesTotal {
			next.Status = "COMPLETED"
		}
		if err := a.db.UpsertAnimeListEntry(next); err == nil {
			_, _ = a.syncAnimePayloadAfterLocalSave(payloadFromAnimeEntry(next))
		}
		return
	}

	next := *entry
	next.MalID = chooseResolvedInt(next.MalID, malID)
	next.Title = firstNonEmpty(next.Title, title, titleEnglish)
	next.TitleEnglish = firstNonEmpty(next.TitleEnglish, titleEnglish)
	next.CoverImage = firstNonEmpty(next.CoverImage, coverImage)
	next.EpisodesWatched = maxInt(next.EpisodesWatched, progress)
	if next.Status == "" || next.Status == "PLANNING" {
		next.Status = "WATCHING"
	}
	if next.EpisodesTotal > 0 && next.EpisodesWatched >= next.EpisodesTotal {
		next.Status = "COMPLETED"
	}
	if err := a.db.UpsertAnimeListEntry(next); err == nil {
		_, _ = a.syncAnimePayloadAfterLocalSave(payloadFromAnimeEntry(next))
	}
}

func (a *App) ensurePassiveMangaTracked(anilistID, malID int, title, titleEnglish, coverImage, bannerImage string, chaptersRead int, year int) {
	if a.db == nil || anilistID <= 0 {
		return
	}

	entry, _ := a.db.GetMangaListEntryByAniListID(anilistID)
	if entry == nil {
		next := db.MangaListEntry{
			AnilistID:     anilistID,
			MalID:         malID,
			Title:         firstNonEmpty(title, titleEnglish, "Manga"),
			TitleEnglish:  titleEnglish,
			CoverImage:    coverImage,
			BannerImage:   bannerImage,
			Status:        "WATCHING",
			ChaptersRead:  maxInt(chaptersRead, 0),
			ChaptersTotal: 0,
			VolumesRead:   0,
			VolumesTotal:  0,
			Score:         0,
			Year:          year,
		}
		if a.metadata != nil {
			if meta, err := a.metadata.GetAniListMangaByID(anilistID); err == nil && meta != nil {
				next.MalID = chooseResolvedInt(next.MalID, meta.MalID)
				next.Title = firstNonEmpty(meta.TitleRomaji, meta.TitleEnglish, meta.TitleNative, next.Title)
				next.TitleEnglish = firstNonEmpty(meta.TitleEnglish, next.TitleEnglish)
				next.CoverImage = firstNonEmpty(meta.CoverLarge, meta.CoverMedium, next.CoverImage)
				next.BannerImage = firstNonEmpty(meta.BannerImage, next.BannerImage)
				next.ChaptersTotal = maxInt(next.ChaptersTotal, meta.Chapters)
				next.VolumesTotal = maxInt(next.VolumesTotal, meta.Volumes)
				next.Year = chooseResolvedInt(next.Year, meta.Year)
			}
		}
		if next.ChaptersTotal > 0 && next.ChaptersRead >= next.ChaptersTotal {
			next.Status = "COMPLETED"
		}
		if err := a.db.UpsertMangaListEntry(next); err == nil {
			_, _ = a.syncMangaPayloadAfterLocalSave(payloadFromMangaEntry(next))
		}
		return
	}

	next := *entry
	next.MalID = chooseResolvedInt(next.MalID, malID)
	next.Title = firstNonEmpty(next.Title, title, titleEnglish)
	next.TitleEnglish = firstNonEmpty(next.TitleEnglish, titleEnglish)
	next.CoverImage = firstNonEmpty(next.CoverImage, coverImage)
	next.BannerImage = firstNonEmpty(next.BannerImage, bannerImage)
	next.ChaptersRead = maxInt(next.ChaptersRead, chaptersRead)
	if next.Status == "" || next.Status == "PLANNING" {
		next.Status = "WATCHING"
	}
	if next.ChaptersTotal > 0 && next.ChaptersRead >= next.ChaptersTotal {
		next.Status = "COMPLETED"
	}
	if err := a.db.UpsertMangaListEntry(next); err == nil {
		_, _ = a.syncMangaPayloadAfterLocalSave(payloadFromMangaEntry(next))
	}
}

func (a *App) syncLocalEpisodeTracking(episodeID int, markWatched bool) {
	if a.db == nil || episodeID <= 0 {
		return
	}
	if markWatched {
		_ = a.db.MarkWatched(episodeID)
	}
	info, err := a.db.GetLibraryAnimeIdentityByEpisodeID(episodeID)
	if err != nil || info == nil || info.AniListID <= 0 {
		return
	}
	progress := int(math.Floor(info.EpisodeNum))
	if progress <= 0 {
		progress = 1
	}
	entry, _ := a.db.GetAnimeListEntryByAniListID(info.AniListID)
	if entry != nil && entry.EpisodesWatched >= progress {
		expectedStatus := "WATCHING"
		if entry.EpisodesTotal > 0 && progress >= entry.EpisodesTotal {
			expectedStatus = "COMPLETED"
		}
		if strings.EqualFold(strings.TrimSpace(entry.Status), expectedStatus) {
			return
		}
	}
	a.ensurePassiveAnimeTracked(info.AniListID, 0, info.Title, info.TitleEnglish, info.CoverImage, progress, info.Year, info.AiringStatus)
}

func (a *App) handleLocalEpisodeEnded(episodeID int) {
	a.syncLocalEpisodeTracking(episodeID, true)
}

func (a *App) getAniListSyncToken() (string, int, error) {
	stored, err := a.db.GetOAuthToken("anilist")
	if err != nil || stored == nil {
		return "", 0, fmt.Errorf("AniList no conectado")
	}
	if stored.ExpiresAt.IsZero() || time.Now().After(stored.ExpiresAt) {
		return "", 0, fmt.Errorf("AniList requiere iniciar sesion de nuevo")
	}
	return stored.AccessToken, stored.UserID, nil
}

func (a *App) isProviderConnected(provider string) bool {
	if provider != "anilist" {
		return false
	}
	token, err := a.db.GetOAuthToken(provider)
	return err == nil && token != nil
}

func payloadFromAnimeEntry(entry db.AnimeListEntry) listSyncPayload {
	return listSyncPayload{
		MediaType:       "anime",
		AniListID:       entry.AnilistID,
		MalID:           entry.MalID,
		Title:           entry.Title,
		TitleEnglish:    entry.TitleEnglish,
		CoverImage:      entry.CoverImage,
		BannerImage:     entry.BannerImage,
		Status:          entry.Status,
		EpisodesWatched: entry.EpisodesWatched,
		EpisodesTotal:   entry.EpisodesTotal,
		Score:           entry.Score,
		AiringStatus:    entry.AiringStatus,
		Year:            entry.Year,
	}
}

func payloadFromMangaEntry(entry db.MangaListEntry) listSyncPayload {
	return listSyncPayload{
		MediaType:     "manga",
		AniListID:     entry.AnilistID,
		MalID:         entry.MalID,
		Title:         entry.Title,
		TitleEnglish:  entry.TitleEnglish,
		CoverImage:    entry.CoverImage,
		BannerImage:   entry.BannerImage,
		Status:        entry.Status,
		ChaptersRead:  entry.ChaptersRead,
		ChaptersTotal: entry.ChaptersTotal,
		VolumesRead:   entry.VolumesRead,
		VolumesTotal:  entry.VolumesTotal,
		Score:         entry.Score,
		Year:          entry.Year,
	}
}

func mediaKey(anilistID, malID int) string {
	return fmt.Sprintf("anilist:%d|mal:%d", anilistID, malID)
}

func providerLabel(provider string) string {
	switch provider {
	case "anilist":
		return "AniList"
	case "mal":
		return "MyAnimeList"
	default:
		return provider
	}
}

func payloadProgress(payload listSyncPayload) int {
	if payload.MediaType == "manga" {
		return payload.ChaptersRead
	}
	return payload.EpisodesWatched
}

func payloadVolumes(payload listSyncPayload) int {
	if payload.MediaType == "manga" {
		return payload.VolumesRead
	}
	return 0
}

func aniListStatusFromInternal(status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "WATCHING":
		return "CURRENT"
	case "COMPLETED":
		return "COMPLETED"
	case "ON_HOLD":
		return "PAUSED"
	case "DROPPED":
		return "DROPPED"
	default:
		return "PLANNING"
	}
}

func malStatusFromInternal(mediaType, status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "WATCHING":
		if mediaType == "manga" {
			return "reading"
		}
		return "watching"
	case "COMPLETED":
		return "completed"
	case "ON_HOLD":
		return "on_hold"
	case "DROPPED":
		return "dropped"
	default:
		if mediaType == "manga" {
			return "plan_to_read"
		}
		return "plan_to_watch"
	}
}
