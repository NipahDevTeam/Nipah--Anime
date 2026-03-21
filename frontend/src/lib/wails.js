// wails.js — bridge between React and the Go backend.
// In dev mode (no Wails runtime), returns safe mock data.
const isDev = !window.go

// Route external images through the local proxy server to avoid CORS blocks
// in the Wails webview. AniList and MangaDex images load fine directly;
// AnimeFLV and scraper sources need the proxy.
export function proxyImage(url, options = {}) {
  if (!url) return ''
  if (url.startsWith('http://localhost')) return url
  // AniList CDN and MangaDex uploads load fine without proxy
  if (url.includes('anilist.co') || url.includes('mangadex.org') ||
      url.includes('mangadex.network')) {
    return url
  }
  const params = new URLSearchParams({ url })
  if (options.sourceID) params.set('source', options.sourceID)
  if (options.referer) params.set('referer', options.referer)
  // Everything else goes through our local proxy
  return `http://localhost:43212/proxy/image?${params.toString()}`
}

export const wails = {
  // ── App ──────────────────────────────────────────────────────────────────
  async getAppVersion() {
    if (isDev) return '1.0.0-dev'
    return window.go.main.App.GetAppVersion()
  },
  async checkForAppUpdate() {
    if (isDev) {
      return {
        current_version: '1.0.0-dev',
        latest_version: '1.0.0-dev',
        release_name: '',
        changelog: '',
        html_url: '',
        published_at: '',
        download_url: '',
        asset_name: '',
        available: false,
        install_ready: false,
      }
    }
    return window.go.main.App.CheckForAppUpdate()
  },
  async installLatestAppUpdate(downloadURL, assetName = '') {
    if (isDev) return null
    return window.go.main.App.InstallLatestAppUpdate(downloadURL, assetName)
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  async searchTorrents(query, source = 'animetosho', anilistID = 0) {
    if (isDev) return []
    return window.go.main.App.SearchTorrents(query, source, anilistID)
  },
  async openMagnet(magnet) {
    if (isDev) return null
    return window.go.main.App.OpenMagnet(magnet)
  },
  async getDefaultDownloadPath() {
    if (isDev) return 'C:/Users/User/Videos/Nipah!/Anime'
    return window.go.main.App.GetDefaultDownloadPath()
  },
  async getSettings() {
    if (isDev) return {
      language: 'es', preferred_sub_lang: 'es', player: 'mpv',
      mpv_path: '', theme: 'dark', manga_reading_direction: 'ltr',
      data_saver: 'false', preferred_quality: '1080p', preferred_audio: 'sub',
    }
    return window.go.main.App.GetSettings()
  },
  async saveSettings(settings) {
    if (isDev) { console.log('[dev] saveSettings:', settings); return null }
    return window.go.main.App.SaveSettings(settings)
  },
  async isMPVAvailable() {
    if (isDev) return true
    return window.go.main.App.IsMPVAvailable()
  },

  // ── Library ──────────────────────────────────────────────────────────────
  async getLibraryStats() {
    if (isDev) return { anime: 0, manga: 0, episodes: 0, chapters: 0 }
    return window.go.main.App.GetLibraryStats()
  },
  async scanWithPicker() {
    if (isDev) return { cancelled: false, anime_found: 0, manga_found: 0, files_scanned: 0 }
    return window.go.main.App.ScanWithPicker()
  },
  async scanLibrary(path) {
    if (isDev) return {}
    return window.go.main.App.ScanLibrary(path)
  },
  async getAnimeList() {
    if (isDev) return []
    return window.go.main.App.GetAnimeList()
  },
  async getAnimeDetail(id) {
    if (isDev) return null
    return window.go.main.App.GetAnimeDetail(id)
  },
  async getMangaList() {
    if (isDev) return []
    return window.go.main.App.GetMangaList()
  },
  async getMangaDetail(id) {
    if (isDev) return null
    return window.go.main.App.GetMangaDetail(id)
  },
  async getLibraryPaths() {
    if (isDev) return []
    return window.go.main.App.GetLibraryPaths()
  },
  async removeLibraryPath(id) {
    if (isDev) { console.log('[dev] removeLibraryPath:', id); return null }
    return window.go.main.App.RemoveLibraryPath(id)
  },

  // ── Metadata ─────────────────────────────────────────────────────────────
  async getTrending(lang = 'es') {
    if (isDev) return { data: { Page: { media: [] } } }
    return window.go.main.App.GetTrending(lang)
  },
  async searchAniList(query, lang = 'es') {
    if (isDev) return { data: { Page: { media: [] } } }
    return window.go.main.App.SearchAniList(query, lang)
  },
  async getAniListAnimeByID(id) {
    if (isDev) return null
    return window.go.main.App.GetAniListAnimeByID(id)
  },
  async getAniListMangaByID(id) {
    if (isDev) return null
    return window.go.main.App.GetAniListMangaByID(id)
  },
  async discoverAnime(genre = '', season = '', year = 0, sort = 'TRENDING_DESC', status = '', page = 1) {
    if (isDev) return { data: { Page: { media: [], pageInfo: { hasNextPage: false } } } }
    return window.go.main.App.DiscoverAnime(genre, season, year, sort, status, page)
  },
  async searchMangaDex(query, lang = 'es') {
    if (isDev) return { data: [] }
    return window.go.main.App.SearchMangaDex(query, lang)
  },

  // ── Extensions / Streaming ───────────────────────────────────────────────
  async listExtensions() {
    if (isDev) return [{ id: 'animeflv-es', name: 'AnimeFLV', type: 'anime', languages: ['es'] }]
    return window.go.main.App.ListExtensions()
  },
  async searchOnline(query, sourceID = '') {
    if (isDev) return []
    return window.go.main.App.SearchOnline(query, sourceID)
  },
  async getOnlineEpisodes(sourceID, animeID) {
    if (isDev) return []
    return window.go.main.App.GetOnlineEpisodes(sourceID, animeID)
  },
  async getAnimeSynopsis(sourceID, animeID) {
    if (isDev) return 'Sinopsis de ejemplo para modo desarrollo.'
    return window.go.main.App.GetAnimeSynopsis(sourceID, animeID)
  },
  async fetchAnimeSynopsisES(dbID, titleRomaji) {
    if (isDev) return ''
    return window.go.main.App.FetchAnimeSynopsisES(dbID, titleRomaji)
  },
  async getStreamSources(sourceID, episodeID) {
    if (isDev) return []
    return window.go.main.App.GetStreamSources(sourceID, episodeID)
  },
  // Full context needed so watch history is recorded properly
  async streamEpisode(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum, episodeTitle, quality = '') {
    if (isDev) {
      console.log('[dev] streamEpisode:', sourceID, episodeID, animeTitle, episodeNum)
      return null
    }
    return window.go.main.App.StreamEpisode(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum, episodeTitle, quality)
  },
  async markOnlineWatched(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum) {
    if (isDev) return null
    return window.go.main.App.MarkOnlineWatched(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum)
  },
  async getWatchHistory(limit = 50) {
    if (isDev) return []
    return window.go.main.App.GetWatchHistory(limit)
  },
  async clearWatchHistory() {
    if (isDev) return null
    return window.go.main.App.ClearWatchHistory()
  },
  async removeAnimeFromHistory(sourceID, animeID) {
    if (isDev) return null
    return window.go.main.App.RemoveAnimeFromHistory(sourceID, animeID)
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  async getDashboard() {
    if (isDev) return {
      continue_watching: [], continue_watching_online: [], recently_watched: [],
      recent_anime: [], completed_anime: [], continue_reading: [], recent_manga: [],
      watching_list: [],
      stats: { anime: 0, manga: 0, watched: 0, read: 0, episodes: 0, chapters: 0, online_anime: 0 }
    }
    return window.go.main.App.GetDashboard()
  },

  // ── MangaDex ─────────────────────────────────────────────────────────────
  async searchMangaOnline(query, lang = 'es') {
    if (isDev) return []
    return window.go.main.App.SearchMangaOnline(query, lang)
  },
  async searchMangaSource(sourceID, query, lang = 'es') {
    if (isDev) return []
    return window.go.main.App.SearchMangaSource(sourceID, query, lang)
  },
  async getMangaChaptersOnline(mangaID, lang = 'es') {
    if (isDev) return []
    return window.go.main.App.GetMangaChaptersOnline(mangaID, lang)
  },
  async getMangaChaptersSource(sourceID, mangaID, lang = 'es') {
    if (isDev) return []
    return window.go.main.App.GetMangaChaptersSource(sourceID, mangaID, lang)
  },
  async getChapterPages(chapterID, dataSaver = false) {
    if (isDev) return []
    return window.go.main.App.GetChapterPages(chapterID, dataSaver)
  },
  async getChapterPagesSource(sourceID, chapterID, dataSaver = false) {
    if (isDev) return []
    return window.go.main.App.GetChapterPagesSource(sourceID, chapterID, dataSaver)
  },
  async recordMangaRead(sourceID, mangaID, mangaTitle, coverURL, chapterID, chapterNum, chapterTitle) {
    if (isDev) return null
    return window.go.main.App.RecordMangaRead(sourceID, mangaID, mangaTitle, coverURL, chapterID, chapterNum, chapterTitle)
  },
  async markMangaChapterCompleted(sourceID, chapterID) {
    if (isDev) return null
    return window.go.main.App.MarkMangaChapterCompleted(sourceID, chapterID)
  },

  // ── Anime List (MAL-like tracking) ──────────────────────────────────────
  async getAnimeListByStatus(status) {
    if (isDev) return []
    return window.go.main.App.GetAnimeListByStatus(status)
  },
  async getAnimeListAll() {
    if (isDev) return []
    return window.go.main.App.GetAnimeListAll()
  },
  async getAnimeListCounts() {
    if (isDev) return {}
    return window.go.main.App.GetAnimeListCounts()
  },
  async addToAnimeList(anilistID, malID, title, titleEnglish, coverImage, status, episodesWatched, episodesTotal, score, airingStatus, year) {
    if (isDev) { console.log('[dev] addToAnimeList:', title, status); return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] } }
    return window.go.main.App.AddToAnimeList(anilistID, malID, title, titleEnglish, coverImage, status, episodesWatched, episodesTotal, score, airingStatus, year)
  },
  async updateAnimeListStatus(anilistID, status) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateAnimeListStatus(anilistID, status)
  },
  async updateAnimeListProgress(anilistID, episodesWatched) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateAnimeListProgress(anilistID, episodesWatched)
  },
  async updateAnimeListScore(anilistID, score) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateAnimeListScore(anilistID, score)
  },
  async removeFromAnimeList(anilistID, syncRemote = false) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.RemoveFromAnimeList(anilistID, syncRemote)
  },
  async importFromMAL(username) {
    if (isDev) return { imported: 0, total: 0, username }
    return window.go.main.App.ImportFromMAL(username)
  },
  async importFromMALFile() {
    if (isDev) return { imported: 0, total: 0 }
    return window.go.main.App.ImportFromMALFile()
  },
  async clearAnimeList() {
    if (isDev) return null
    return window.go.main.App.ClearAnimeList()
  },

  // ── OAuth / Account Linking ──────────────────────────────────────────────
  async getAuthStatus() {
    if (isDev) return {
      anilist: { logged_in: false },
      mal: { logged_in: false },
    }
    return window.go.main.App.GetAuthStatus()
  },
  async loginAniList() {
    if (isDev) return { username: 'dev-user', user_id: 1, avatar: '' }
    return window.go.main.App.LoginAniList()
  },
  async loginMAL() {
    if (isDev) return { username: 'dev-user', user_id: 1, avatar: '' }
    return window.go.main.App.LoginMAL()
  },
  async logout(provider) {
    if (isDev) return null
    return window.go.main.App.Logout(provider)
  },
  async syncAniListLists() {
    if (isDev) return { anime_count: 0, manga_count: 0 }
    return window.go.main.App.SyncAniListLists()
  },
  async syncMALLists() {
    if (isDev) return { anime_count: 0, manga_count: 0 }
    return window.go.main.App.SyncMALLists()
  },
  async getRemoteListSyncStatus() {
    if (isDev) return { pending_count: 0, failed_count: 0, by_provider: {}, errors: [] }
    return window.go.main.App.GetRemoteListSyncStatus()
  },
  async retryRemoteListSync(provider = '') {
    if (isDev) return { local_saved: false, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.RetryRemoteListSync(provider)
  },

  // ── Manga List (MAL-like tracking for manga) ─────────────────────────────
  async getMangaListByStatus(status) {
    if (isDev) return []
    return window.go.main.App.GetMangaListByStatus(status)
  },
  async getMangaListAll() {
    if (isDev) return []
    return window.go.main.App.GetMangaListAll()
  },
  async getMangaListCounts() {
    if (isDev) return {}
    return window.go.main.App.GetMangaListCounts()
  },
  async addToMangaList(anilistID, malID, title, titleEnglish, coverImage, bannerImage, status, chaptersRead, chaptersTotal, volumesRead, volumesTotal, score, year) {
    if (isDev) { console.log('[dev] addToMangaList:', title, status); return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] } }
    return window.go.main.App.AddToMangaList(anilistID, malID, title, titleEnglish, coverImage, bannerImage, status, chaptersRead, chaptersTotal, volumesRead, volumesTotal, score, year)
  },
  async updateMangaListStatus(anilistID, status) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateMangaListStatus(anilistID, status)
  },
  async updateMangaListProgress(anilistID, chaptersRead) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateMangaListProgress(anilistID, chaptersRead)
  },
  async updateMangaListScore(anilistID, score) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateMangaListScore(anilistID, score)
  },
  async removeFromMangaList(anilistID, syncRemote = false) {
    if (isDev) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.RemoveFromMangaList(anilistID, syncRemote)
  },
  async clearMangaList() {
    if (isDev) return null
    return window.go.main.App.ClearMangaList()
  },

  // ── Local player ─────────────────────────────────────────────────────────
  async playEpisode(episodeID) {
    if (isDev) return null
    return window.go.main.App.PlayEpisode(episodeID)
  },
  async getPlaybackState() {
    if (isDev) return { active: false }
    return window.go.main.App.GetPlaybackState()
  },
  async pauseResume() {
    if (isDev) return null
    return window.go.main.App.PauseResume()
  },
  async seekTo(seconds) {
    if (isDev) return null
    return window.go.main.App.SeekTo(seconds)
  },
  async stopPlayback() {
    if (isDev) return null
    return window.go.main.App.StopPlayback()
  },
  async getEpisodeProgress(episodeID) {
    if (isDev) return { episode_id: episodeID, progress_sec: 0, watched: false }
    return window.go.main.App.GetEpisodeProgress(episodeID)
  },
  async markWatched(episodeID) {
    if (isDev) return null
    return window.go.main.App.MarkWatched(episodeID)
  },
  async markUnwatched(episodeID) {
    if (isDev) return null
    return window.go.main.App.MarkUnwatched(episodeID)
  },

  // ── Downloads ───────────────────────────────────────────────────────────
  async getDownloadLinks(sourceID, episodeID) {
    if (isDev) return [{ url: '#', host: 'Mediafire', quality: '720p' }]
    return window.go.main.App.GetDownloadLinks(sourceID, episodeID)
  },
  async startDownload(sourceURL, animeTitle, episodeNum, episodeTitle, coverURL) {
    if (isDev) { console.log('[dev] startDownload:', animeTitle, episodeNum); return 1 }
    return window.go.main.App.StartDownload(sourceURL, animeTitle, episodeNum, episodeTitle, coverURL)
  },
  async getDownloads() {
    if (isDev) return []
    return window.go.main.App.GetDownloads()
  },
  async getActiveDownloads() {
    if (isDev) return []
    return window.go.main.App.GetActiveDownloads()
  },
  async cancelDownload(id) {
    if (isDev) return null
    return window.go.main.App.CancelDownload(id)
  },
  async removeDownload(id, deleteFile = false) {
    if (isDev) return null
    return window.go.main.App.RemoveDownload(id, deleteFile)
  },
  async playDownloadedEpisode(id) {
    if (isDev) return null
    return window.go.main.App.PlayDownloadedEpisode(id)
  },
  async getDownloadDir() {
    if (isDev) return 'C:/Downloads/Nipah'
    return window.go.main.App.GetDownloadDir()
  },
}
