// wails.js Ã¢â‚¬â€ bridge between React and the Go backend.
// In dev mode (no Wails runtime), returns safe mock data.
const isWailsRuntimeUnavailable = () => !(typeof window !== 'undefined' && window?.go?.main?.App)
const INTERNAL_SERVER_BASE_URL = 'http://127.0.0.1:43212'

function getSystemLanguage() {
  if (typeof navigator === 'undefined') return 'en'
  return `${navigator.language || ''}`.toLowerCase().startsWith('es') ? 'es' : 'en'
}

// Route external images through the local proxy server to avoid CORS blocks
// in the Wails webview. AniList and MangaDex images load fine directly;
// AnimeFLV and scraper sources need the proxy.
export function proxyImage(url, options = {}) {
  if (!url) return ''
  if (url.startsWith('http://localhost') || url.startsWith(INTERNAL_SERVER_BASE_URL)) return url
  // AniList CDN and MangaDex uploads load fine without proxy
  if (url.includes('anilist.co') || url.includes('mangadex.org') ||
      url.includes('mangadex.network') ||
      url.includes('static.anikai.to') ||
      url.includes('i.animepahe.pw') ||
      url.includes('vidcache.net')) {
    return url
  }
  const params = new URLSearchParams({ url })
  if (options.sourceID) params.set('source', options.sourceID)
  if (options.referer) params.set('referer', options.referer)
  // Everything else goes through our local proxy
  return `${INTERNAL_SERVER_BASE_URL}/proxy/image?${params.toString()}`
}

export function proxyMedia(url, options = {}) {
  if (!url) return ''
  if (url.startsWith('http://localhost') || url.startsWith(INTERNAL_SERVER_BASE_URL)) return url
  const params = new URLSearchParams({ url })
  if (options.referer) params.set('referer', options.referer)
  return `${INTERNAL_SERVER_BASE_URL}/proxy/media?${params.toString()}`
}

export const wails = {
  // Ã¢â€â‚¬Ã¢â€â‚¬ App Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getAppVersion() {
    if (isWailsRuntimeUnavailable()) return '1.0.0-dev'
    return window.go.main.App.GetAppVersion()
  },
  async checkForAppUpdate() {
    if (isWailsRuntimeUnavailable()) {
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
  async installLatestAppUpdate(downloadURL, assetName = '', latestVersion = '') {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.InstallLatestAppUpdate(downloadURL, assetName, latestVersion)
  },
  async getPlatform() {
    if (isWailsRuntimeUnavailable()) return 'windows'
    return window.go.main.App.GetPlatform()
  },
  async openURL(url) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.OpenURL(url)
  },
  async notifyDesktop(title, message) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.NotifyDesktop(title, message)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Settings Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async searchTorrents(query, source = 'nyaa', anilistID = 0) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.SearchTorrents(query, source, anilistID)
  },
  async openMagnet(magnet) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.OpenMagnet(magnet)
  },
  async streamTorrentMagnet(magnet, displayTitle = '', playerMode = 'mpv') {
    if (isWailsRuntimeUnavailable()) return { launched: playerMode !== 'integrated', stream_url: magnet, fallback_type: playerMode === 'integrated' ? 'integrated' : '' }
    return window.go.main.App.StreamTorrentMagnet(magnet, displayTitle, playerMode)
  },
  async getDefaultDownloadPath() {
    if (isWailsRuntimeUnavailable()) return 'C:/Users/User/Videos/Nipah!/Anime'
    return window.go.main.App.GetDefaultDownloadPath()
  },
  async getSettings() {
    if (isWailsRuntimeUnavailable()) {
      const systemLanguage = getSystemLanguage()
      return {
        language: systemLanguage, preferred_sub_lang: systemLanguage, player: 'mpv',
        mpv_path: '', theme: 'dark', manga_reading_direction: 'ltr',
        data_saver: 'false', preferred_quality: '1080p', preferred_audio: 'sub', anime4k_level: 'off',
      }
    }
    return window.go.main.App.GetSettings()
  },
  async saveSettings(settings) {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] saveSettings:', settings); return null }
    return window.go.main.App.SaveSettings(settings)
  },
  async isMPVAvailable() {
    if (isWailsRuntimeUnavailable()) return true
    return window.go.main.App.IsMPVAvailable()
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Library Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getLibraryStats() {
    if (isWailsRuntimeUnavailable()) return { anime: 0, manga: 0, episodes: 0, chapters: 0 }
    return window.go.main.App.GetLibraryStats()
  },
  async scanWithPicker() {
    if (isWailsRuntimeUnavailable()) return { cancelled: false, anime_found: 0, manga_found: 0, files_scanned: 0 }
    return window.go.main.App.ScanWithPicker()
  },
  async pickFolder() {
    if (isWailsRuntimeUnavailable()) return ''
    return window.go.main.App.PickFolder()
  },
  async scanLibrary(path) {
    if (isWailsRuntimeUnavailable()) return {}
    return window.go.main.App.ScanLibrary(path)
  },
  async getAnimeList() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetAnimeList()
  },
  async getAnimeDetail(id) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.GetAnimeDetail(id)
  },
  async deleteLocalAnime(id) {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] deleteLocalAnime:', id); return null }
    return window.go.main.App.DeleteLocalAnime(id)
  },
  async getMangaList() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetMangaList()
  },
  async getMangaDetail(id) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.GetMangaDetail(id)
  },
  async getLibraryPaths() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetLibraryPaths()
  },
  async getAnimeImportDir() {
    if (isWailsRuntimeUnavailable()) return 'C:/Users/User/AppData/Roaming/Nipah/imports/anime'
    return window.go.main.App.GetAnimeImportDir()
  },
  async setAnimeImportDir(path) {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] setAnimeImportDir:', path); return null }
    return window.go.main.App.SetAnimeImportDir(path)
  },
  async removeLibraryPath(id) {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] removeLibraryPath:', id); return null }
    return window.go.main.App.RemoveLibraryPath(id)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Metadata Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getTrending(lang = 'es') {
    if (isWailsRuntimeUnavailable()) return { data: { Page: { media: [] } } }
    return window.go.main.App.GetTrending(lang)
  },
  async searchAniList(query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return { data: { Page: { media: [] } } }
    return window.go.main.App.SearchAniList(query, lang)
  },
  async getAniListAnimeByID(id) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.GetAniListAnimeByID(id)
  },
  async getAniListMangaByID(id) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.GetAniListMangaByID(id)
  },
  async getAniListMangaCatalogHome(lang = 'es') {
    if (isWailsRuntimeUnavailable()) return { featured: [], trending: [], popular: [], recent: [] }
    return window.go.main.App.GetAniListMangaCatalogHome(lang)
  },
  async discoverManga(genre = '', year = 0, sort = 'TRENDING_DESC', page = 1) {
    if (isWailsRuntimeUnavailable()) return { data: { Page: { media: [], pageInfo: { hasNextPage: false } } } }
    return window.go.main.App.DiscoverManga(genre, year, sort, page)
  },
  async discoverAnime(genre = '', season = '', year = 0, sort = 'TRENDING_DESC', status = '', page = 1) {
    if (isWailsRuntimeUnavailable()) return { data: { Page: { media: [], pageInfo: { hasNextPage: false } } } }
    return window.go.main.App.DiscoverAnime(genre, season, year, sort, status, page)
  },
  async searchMangaDex(query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return { data: [] }
    return window.go.main.App.SearchMangaDex(query, lang)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Extensions / Streaming Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async listExtensions() {
    if (isWailsRuntimeUnavailable()) return [{ id: 'animeflv-es', name: 'AnimeFLV', type: 'anime', languages: ['es'] }]
    return window.go.main.App.ListExtensions()
  },
  async searchOnline(query, sourceID = '') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.SearchOnline(query, sourceID)
  },
  async getOnlineEpisodes(sourceID, animeID) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetOnlineEpisodes(sourceID, animeID)
  },
  async getOnlineAudioVariants(sourceID, animeID, episodeID = '') {
    if (isWailsRuntimeUnavailable()) {
      return { sub: true, dub: sourceID === 'animegg-en' }
    }
    return window.go.main.App.GetOnlineAudioVariants(sourceID, animeID, episodeID)
  },
  async getAnimeSynopsis(sourceID, animeID) {
    if (isWailsRuntimeUnavailable()) return 'Sinopsis de ejemplo para modo desarrollo.'
    return window.go.main.App.GetAnimeSynopsis(sourceID, animeID)
  },
  async fetchAnimeSynopsisES(dbID, titleRomaji) {
    if (isWailsRuntimeUnavailable()) return ''
    return window.go.main.App.FetchAnimeSynopsisES(dbID, titleRomaji)
  },
  async getStreamSources(sourceID, episodeID) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetStreamSources(sourceID, episodeID)
  },
  // Full context needed so watch history is recorded properly
  async streamEpisode(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum, episodeTitle, quality = '') {
    if (isWailsRuntimeUnavailable()) {
      console.log('[dev] streamEpisode:', sourceID, episodeID, animeTitle, episodeNum)
      return null
    }
    return window.go.main.App.StreamEpisode(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum, episodeTitle, quality)
  },
  async openOnlineEpisode(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum, episodeTitle, quality = '', playerMode = 'mpv') {
    if (isWailsRuntimeUnavailable()) return { launched: playerMode !== 'integrated', fallback_type: playerMode === 'integrated' ? 'integrated' : '', fallback_url: sourceID, stream_kind: 'hls', resume_sec: 0, duration_sec: 0 }
    return window.go.main.App.OpenOnlineEpisode(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum, episodeTitle, quality, playerMode)
  },
  async diagnoseOnlinePlaybackSource(sourceID, animeID, episodeID = '') {
    if (isWailsRuntimeUnavailable()) return { source_id: sourceID, anime_id: animeID, episode_id: episodeID, classification: 'provider-compatible' }
    return window.go.main.App.DiagnoseOnlinePlaybackSource(sourceID, animeID, episodeID)
  },
  async recordIntegratedPlaybackDiagnostic(payload) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.RecordIntegratedPlaybackDiagnostic(payload)
  },
  async getIntegratedPlaybackDiagnostics() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetIntegratedPlaybackDiagnostics()
  },
  async clearIntegratedPlaybackDiagnostics() {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.ClearIntegratedPlaybackDiagnostics()
  },
  async updateOnlinePlaybackProgress(positionSec, durationSec = 0) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.UpdateOnlinePlaybackProgress(positionSec, durationSec)
  },
  async finalizeOnlinePlayback(positionSec, durationSec = 0, completed = false) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.FinalizeOnlinePlayback(positionSec, durationSec, completed)
  },
  async markOnlineWatched(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.MarkOnlineWatched(sourceID, episodeID, animeID, animeTitle, coverURL, anilistID, malID, episodeNum)
  },
  async getWatchHistory(limit = 50) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetWatchHistory(limit)
  },
  async clearWatchHistory() {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.ClearWatchHistory()
  },
  async removeAnimeFromHistory(sourceID, animeID) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.RemoveAnimeFromHistory(sourceID, animeID)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Dashboard Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getDashboard() {
    if (isWailsRuntimeUnavailable()) return {
      continue_watching: [], continue_watching_online: [], recently_watched: [],
      recent_anime: [], completed_anime: [], continue_reading: [], recent_manga: [],
      watching_list: [],
      stats: { anime: 0, manga: 0, watched: 0, read: 0, episodes: 0, chapters: 0, online_anime: 0 }
    }
    return window.go.main.App.GetDashboard()
  },
  async getHomeMangaRecommendations(seedAniListIDs = [], excludeAniListIDs = [], lang = 'es') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetHomeMangaRecommendations(seedAniListIDs, excludeAniListIDs, lang)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ MangaDex Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async searchMangaOnline(query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.SearchMangaOnline(query, lang)
  },
  async searchMangaGlobal(query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.SearchMangaGlobal(query, lang)
  },
  async getMangaSourceMatches(anilistID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetMangaSourceMatches(anilistID, lang)
  },
  async resolveMangaSourceForAniList(sourceID, anilistID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.ResolveMangaSourceForAniList(sourceID, anilistID, lang)
  },
  async getMangaChaptersForAniListSource(sourceID, anilistID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return { source: null, chapters: [] }
    return window.go.main.App.GetMangaChaptersForAniListSource(sourceID, anilistID, lang)
  },
  async searchMangaSource(sourceID, query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.SearchMangaSource(sourceID, query, lang)
  },
  async getMangaChaptersOnline(mangaID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetMangaChaptersOnline(mangaID, lang)
  },
  async getMangaChaptersSource(sourceID, mangaID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetMangaChaptersSource(sourceID, mangaID, lang)
  },
  async getChapterPages(chapterID, dataSaver = false) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetChapterPages(chapterID, dataSaver)
  },
  async getChapterPagesSource(sourceID, chapterID, dataSaver = false) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetChapterPagesSource(sourceID, chapterID, dataSaver)
  },
  async recordMangaRead(sourceID, mangaID, mangaTitle, coverURL, chapterID, chapterNum, chapterTitle) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.RecordMangaRead(sourceID, mangaID, mangaTitle, coverURL, chapterID, chapterNum, chapterTitle)
  },
  async markMangaChapterCompleted(sourceID, chapterID) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.MarkMangaChapterCompleted(sourceID, chapterID)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Anime List (MAL-like tracking) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getAnimeListByStatus(status) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetAnimeListByStatus(status)
  },
  async getAnimeListAll() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetAnimeListAll()
  },
  async getAnimeListCounts() {
    if (isWailsRuntimeUnavailable()) return {}
    return window.go.main.App.GetAnimeListCounts()
  },
  async addToAnimeList(anilistID, malID, title, titleEnglish, coverImage, status, episodesWatched, episodesTotal, score, airingStatus, year) {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] addToAnimeList:', title, status); return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] } }
    return window.go.main.App.AddToAnimeList(anilistID, malID, title, titleEnglish, coverImage, status, episodesWatched, episodesTotal, score, airingStatus, year)
  },
  async updateAnimeListStatus(anilistID, status) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateAnimeListStatus(anilistID, status)
  },
  async updateAnimeListProgress(anilistID, episodesWatched) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateAnimeListProgress(anilistID, episodesWatched)
  },
  async updateAnimeListScore(anilistID, score) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateAnimeListScore(anilistID, score)
  },
  async removeFromAnimeList(anilistID, syncRemote = false) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.RemoveFromAnimeList(anilistID, syncRemote)
  },
  async importFromMAL(username) {
    if (isWailsRuntimeUnavailable()) return { imported: 0, total: 0, username }
    return window.go.main.App.ImportFromMAL(username)
  },
  async importFromMALFile() {
    if (isWailsRuntimeUnavailable()) return { imported: 0, total: 0 }
    return window.go.main.App.ImportFromMALFile()
  },
  async clearAnimeList() {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.ClearAnimeList()
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ OAuth / Account Linking Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getAuthStatus() {
    if (isWailsRuntimeUnavailable()) return {
      anilist: { logged_in: false },
      mal: { logged_in: false },
    }
    return window.go.main.App.GetAuthStatus()
  },
  async loginAniList() {
    if (isWailsRuntimeUnavailable()) return { username: 'dev-user', user_id: 1, avatar: '' }
    return window.go.main.App.LoginAniList()
  },
  async loginMAL() {
    if (isWailsRuntimeUnavailable()) return { username: 'dev-user', user_id: 1, avatar: '' }
    return window.go.main.App.LoginMAL()
  },
  async logout(provider) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.Logout(provider)
  },
  async syncAniListLists() {
    if (isWailsRuntimeUnavailable()) return { anime_count: 0, manga_count: 0 }
    return window.go.main.App.SyncAniListLists()
  },
  async syncMALLists() {
    if (isWailsRuntimeUnavailable()) return { anime_count: 0, manga_count: 0 }
    return window.go.main.App.SyncMALLists()
  },
  async getRemoteListSyncStatus() {
    if (isWailsRuntimeUnavailable()) return { pending_count: 0, failed_count: 0, by_provider: {}, errors: [] }
    return window.go.main.App.GetRemoteListSyncStatus()
  },
  async retryRemoteListSync(provider = '') {
    if (isWailsRuntimeUnavailable()) return { local_saved: false, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.RetryRemoteListSync(provider)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Manga List (MAL-like tracking for manga) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getMangaListByStatus(status) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetMangaListByStatus(status)
  },
  async getMangaListAll() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetMangaListAll()
  },
  async getMangaListByFormat() {
    if (isWailsRuntimeUnavailable()) return { manga: [], manhwa: [], manhua: [] }
    return window.go.main.App.GetMangaListByFormat()
  },
  async getMangaListCounts() {
    if (isWailsRuntimeUnavailable()) return {}
    return window.go.main.App.GetMangaListCounts()
  },
  async addToMangaList(anilistID, malID, title, titleEnglish, coverImage, bannerImage, status, chaptersRead, chaptersTotal, volumesRead, volumesTotal, score, year) {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] addToMangaList:', title, status); return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] } }
    return window.go.main.App.AddToMangaList(anilistID, malID, title, titleEnglish, coverImage, bannerImage, status, chaptersRead, chaptersTotal, volumesRead, volumesTotal, score, year)
  },
  async updateMangaListStatus(anilistID, status) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateMangaListStatus(anilistID, status)
  },
  async updateMangaListProgress(anilistID, chaptersRead) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateMangaListProgress(anilistID, chaptersRead)
  },
  async updateMangaListScore(anilistID, score) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.UpdateMangaListScore(anilistID, score)
  },
  async removeFromMangaList(anilistID, syncRemote = false) {
    if (isWailsRuntimeUnavailable()) return { local_saved: true, remote_attempted: 0, remote_succeeded: 0, remote_failed: 0, queued_retry: false, messages: [] }
    return window.go.main.App.RemoveFromMangaList(anilistID, syncRemote)
  },
  async clearMangaList() {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.ClearMangaList()
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Local player Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async playEpisode(episodeID) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.PlayEpisode(episodeID)
  },
  async getPlaybackState() {
    if (isWailsRuntimeUnavailable()) return { active: false }
    return window.go.main.App.GetPlaybackState()
  },
  async pauseResume() {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.PauseResume()
  },
  async seekTo(seconds) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.SeekTo(seconds)
  },
  async stopPlayback() {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.StopPlayback()
  },
  async getEpisodeProgress(episodeID) {
    if (isWailsRuntimeUnavailable()) return { episode_id: episodeID, progress_sec: 0, watched: false }
    return window.go.main.App.GetEpisodeProgress(episodeID)
  },
  async markWatched(episodeID) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.MarkWatched(episodeID)
  },
  async markUnwatched(episodeID) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.MarkUnwatched(episodeID)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Downloads Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async getDownloadLinks(sourceID, episodeID) {
    if (isWailsRuntimeUnavailable()) return [{ url: '#', host: 'Mediafire', quality: '720p' }]
    return window.go.main.App.GetDownloadLinks(sourceID, episodeID)
  },
  async startDownload(sourceURL, animeTitle, episodeNum, episodeTitle, coverURL, referer = '', cookie = '') {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] startDownload:', animeTitle, episodeNum); return 1 }
    return window.go.main.App.StartDownload(sourceURL, animeTitle, episodeNum, episodeTitle, coverURL, referer, cookie)
  },
  async getDownloads() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetDownloads()
  },
  async getActiveDownloads() {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetActiveDownloads()
  },
  async cancelDownload(id) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.CancelDownload(id)
  },
  async removeDownload(id, deleteFile = false) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.RemoveDownload(id, deleteFile)
  },
  async playDownloadedEpisode(id) {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.PlayDownloadedEpisode(id)
  },
  async getDownloadDir() {
    if (isWailsRuntimeUnavailable()) return 'C:/Downloads/Nipah'
    return window.go.main.App.GetDownloadDir()
  },
}
