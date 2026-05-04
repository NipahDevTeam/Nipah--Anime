// wails.js Ã¢â‚¬â€ bridge between React and the Go backend.
// In dev mode (no Wails runtime), returns safe mock data.
const isWailsRuntimeUnavailable = () => !(typeof window !== 'undefined' && window?.go?.main?.App)
const INTERNAL_SERVER_BASE_URL = 'http://127.0.0.1:43212'
const runtimeBridgeState = {
  available: !isWailsRuntimeUnavailable(),
  mode: isWailsRuntimeUnavailable() ? 'browser-preview' : 'wails-runtime',
}
const runtimeWarmCache = new Map()
const SOURCE_METADATA_CACHE_TTL_MS = 10 * 60_000
const CHAPTER_PAGES_CACHE_TTL_MS = 30 * 60_000

function readRuntimeCache(key) {
  const entry = runtimeWarmCache.get(key)
  if (!entry) return null
  if ((entry.expiresAt ?? 0) <= Date.now()) {
    runtimeWarmCache.delete(key)
    return null
  }
  return entry.value
}

function writeRuntimeCache(key, value, ttlMs) {
  runtimeWarmCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
  return value
}

export function __clearRuntimeWarmCache() {
  runtimeWarmCache.clear()
}

export function shouldCacheResolvedMangaSource(value) {
  return String(value?.status || '').toLowerCase() === 'ready'
}

export function shouldCacheResolvedMangaChapters(value) {
  if (!value || typeof value !== 'object') return true
  if (value.partial || value.hydrating) return false
  return String(value?.source?.status || '').toLowerCase() === 'ready'
}

export function shouldCacheMangaSourceMatchList(value) {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((item) => String(item?.status || '').toLowerCase() === 'ready')
}

export function shouldCacheDirectMangaChapterList(sourceID) {
  return true
}

export async function rememberRuntimeCache(keyParts, ttlMs, loader, options = {}) {
  const key = JSON.stringify(keyParts)
  const cached = readRuntimeCache(key)
  if (cached !== null) {
    return cached
  }
  const value = await loader()
  const shouldCache = typeof options.shouldCache === 'function' ? options.shouldCache(value) : true
  if (!shouldCache || !(ttlMs > 0)) {
    return value
  }
  return writeRuntimeCache(key, value, ttlMs)
}

if (typeof window !== 'undefined') {
  window.__nipahRuntimeMode = runtimeBridgeState.mode
  window.__nipahRuntimeAvailable = runtimeBridgeState.available
  document?.documentElement?.setAttribute('data-nipah-runtime', runtimeBridgeState.mode)

  if (!runtimeBridgeState.available && !window.__nipahRuntimeBridgeLogged) {
    window.__nipahRuntimeBridgeLogged = true
    console.info('[runtime] browser preview fallback active')
  }
}

function getSystemLanguage() {
  if (typeof navigator === 'undefined') return 'en'
  return `${navigator.language || ''}`.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function isWailsRuntimeAvailable() {
  return runtimeBridgeState.available
}

export function getRuntimeBridgeState() {
  return runtimeBridgeState
}

const PREVIEW_PAGE_SIZE = 24

function buildPreviewImage(label, wide = false) {
  const title = String(label || 'Miruro').slice(0, 28)
  const hueSeed = Array.from(title).reduce((total, char) => total + char.charCodeAt(0), wide ? 61 : 19)
  const hueA = hueSeed % 360
  const hueB = (hueSeed + 48) % 360
  const width = wide ? 1280 : 600
  const height = wide ? 720 : 900
  const accentX = wide ? 890 : 390
  const accentY = wide ? 165 : 250
  const textY = wide ? 610 : 760
  const titleMarkup = wide
    ? ''
    : `<text x="40" y="${textY}" fill="#f5efe6" font-family="Arial, sans-serif" font-size="42" font-weight="700">${title.replace(/[<&>]/g, '')}</text>`
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${hueA} 48% 20%)"/>
          <stop offset="42%" stop-color="#111319"/>
          <stop offset="100%" stop-color="hsl(${hueB} 38% 12%)"/>
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(240,183,98,0.8)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </linearGradient>
        <linearGradient id="blade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.26)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <circle cx="${accentX}" cy="${accentY}" r="${wide ? 280 : 190}" fill="url(#glow)" opacity="0.58"/>
      <path d="M${wide ? 640 : 280} ${wide ? 48 : 70}L${wide ? 1060 : 520} ${wide ? 186 : 244}L${wide ? 930 : 446} ${wide ? 520 : 540}L${wide ? 520 : 182} ${wide ? 414 : 422}Z" fill="url(#blade)" opacity="0.38"/>
      <path d="M${wide ? 710 : 320} ${wide ? 94 : 108}C${wide ? 746 : 348} ${wide ? 164 : 170},${wide ? 726 : 330} ${wide ? 314 : 292},${wide ? 666 : 292} ${wide ? 366 : 338}C${wide ? 606 : 254},${wide ? 606 : 258} ${wide ? 166 : 184},${wide ? 664 : 286} ${wide ? 132 : 142},${wide ? 690 : 304} ${wide ? 94 : 108}Z" fill="rgba(10,10,12,0.62)"/>
      <path d="M0 ${wide ? 510 : 650}C${wide ? 220 : 140} ${wide ? 430 : 560},${wide ? 360 : 210} ${wide ? 780 : 1020},${width} ${wide ? 520 : 680}V${height}H0Z" fill="rgba(0,0,0,0.38)"/>
      ${titleMarkup}
    </svg>
  `.trim()
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function normalizePreviewQuery(value) {
  return String(value || '').trim().toLowerCase()
}

const PREVIEW_ANIME_SEED = [
  { title: 'Neon Requiem', genres: ['Action', 'Sci-Fi'], season: 'SPRING', year: 2026, episodes: 12, averageScore: 82, status: 'RELEASING', nextEpisode: 6 },
  { title: 'Lunar Parade', genres: ['Fantasy', 'Adventure'], season: 'WINTER', year: 2026, episodes: 24, averageScore: 79, status: 'RELEASING', nextEpisode: 14 },
  { title: 'Glass Harbor', genres: ['Drama', 'Mystery'], season: 'FALL', year: 2025, episodes: 13, averageScore: 86, status: 'FINISHED' },
  { title: 'Velvet Trigger', genres: ['Action', 'Thriller'], season: 'SUMMER', year: 2025, episodes: 12, averageScore: 80, status: 'FINISHED' },
  { title: 'Skyline Sonata', genres: ['Romance', 'Slice of Life'], season: 'SPRING', year: 2026, episodes: 12, averageScore: 78, status: 'RELEASING', nextEpisode: 5 },
  { title: 'Ashen Crown', genres: ['Action', 'Fantasy'], season: 'WINTER', year: 2025, episodes: 25, averageScore: 84, status: 'FINISHED' },
  { title: 'Midnight Courier', genres: ['Mystery', 'Drama'], season: 'SUMMER', year: 2026, episodes: 12, averageScore: 81, status: 'RELEASING', nextEpisode: 8 },
  { title: 'Signal Bloom', genres: ['Sci-Fi', 'Romance'], season: 'FALL', year: 2026, episodes: 12, averageScore: 77, status: 'RELEASING', nextEpisode: 3 },
  { title: 'Paper Lantern Days', genres: ['Slice of Life', 'Comedy'], season: 'SPRING', year: 2025, episodes: 12, averageScore: 74, status: 'FINISHED' },
  { title: 'Hollow Meridian', genres: ['Action', 'Drama'], season: 'SUMMER', year: 2024, episodes: 24, averageScore: 83, status: 'FINISHED' },
  { title: 'Aurora Circuit', genres: ['Sci-Fi', 'Sports'], season: 'WINTER', year: 2026, episodes: 12, averageScore: 76, status: 'RELEASING', nextEpisode: 9 },
  { title: 'Scarlet Archive', genres: ['Thriller', 'Mystery'], season: 'FALL', year: 2024, episodes: 13, averageScore: 81, status: 'FINISHED' },
  { title: 'Blue Hour Atlas', genres: ['Adventure', 'Fantasy'], season: 'SPRING', year: 2024, episodes: 24, averageScore: 79, status: 'FINISHED' },
  { title: 'Comet Waltz', genres: ['Music', 'Romance'], season: 'SUMMER', year: 2026, episodes: 12, averageScore: 75, status: 'RELEASING', nextEpisode: 4 },
  { title: 'Kite Protocol', genres: ['Action', 'Sci-Fi'], season: 'WINTER', year: 2024, episodes: 24, averageScore: 82, status: 'FINISHED' },
  { title: 'Dawn Garden', genres: ['Fantasy', 'Slice of Life'], season: 'FALL', year: 2026, episodes: 12, averageScore: 80, status: 'RELEASING', nextEpisode: 2 },
  { title: 'Quiet Voltage', genres: ['Drama', 'Sci-Fi'], season: 'SPRING', year: 2023, episodes: 12, averageScore: 73, status: 'FINISHED' },
  { title: 'Afterglow Runners', genres: ['Sports', 'Comedy'], season: 'SUMMER', year: 2025, episodes: 12, averageScore: 77, status: 'FINISHED' },
  { title: 'Ivory Tempest', genres: ['Fantasy', 'Action'], season: 'WINTER', year: 2023, episodes: 24, averageScore: 85, status: 'FINISHED' },
  { title: 'Nocturne Current', genres: ['Mystery', 'Supernatural'], season: 'FALL', year: 2026, episodes: 12, averageScore: 78, status: 'RELEASING', nextEpisode: 7 },
  { title: 'Silver Orchard', genres: ['Romance', 'Drama'], season: 'SPRING', year: 2024, episodes: 13, averageScore: 76, status: 'FINISHED' },
  { title: 'Cinder Relay', genres: ['Action', 'Sports'], season: 'SUMMER', year: 2023, episodes: 12, averageScore: 72, status: 'FINISHED' },
  { title: 'Echo Harbor', genres: ['Mystery', 'Adventure'], season: 'WINTER', year: 2026, episodes: 12, averageScore: 80, status: 'RELEASING', nextEpisode: 10 },
  { title: 'Starframe Kitchen', genres: ['Comedy', 'Slice of Life'], season: 'FALL', year: 2025, episodes: 12, averageScore: 71, status: 'FINISHED' },
]

const PREVIEW_MANGA_SEED = [
  { title: 'Inkbound Reverie', genres: ['Fantasy', 'Adventure'], year: 2026, chapters: 48, averageScore: 83, status: 'RELEASING' },
  { title: 'Rainlight District', genres: ['Drama', 'Mystery'], year: 2025, chapters: 37, averageScore: 80, status: 'RELEASING' },
  { title: 'Silent Orbit', genres: ['Sci-Fi', 'Action'], year: 2024, chapters: 92, averageScore: 84, status: 'FINISHED' },
  { title: 'Petal Theory', genres: ['Romance', 'Slice of Life'], year: 2026, chapters: 18, averageScore: 77, status: 'RELEASING' },
  { title: 'Obsidian Chorus', genres: ['Thriller', 'Mystery'], year: 2025, chapters: 56, averageScore: 81, status: 'RELEASING' },
  { title: 'Velvet Compass', genres: ['Adventure', 'Fantasy'], year: 2023, chapters: 104, averageScore: 79, status: 'FINISHED' },
  { title: 'Crimson Study', genres: ['Drama', 'School'], year: 2024, chapters: 63, averageScore: 75, status: 'FINISHED' },
  { title: 'Signal Orchard', genres: ['Sci-Fi', 'Romance'], year: 2026, chapters: 14, averageScore: 78, status: 'RELEASING' },
  { title: 'Northbound Letters', genres: ['Drama', 'Slice of Life'], year: 2022, chapters: 87, averageScore: 74, status: 'FINISHED' },
  { title: 'Ash Relay', genres: ['Action', 'Sports'], year: 2025, chapters: 41, averageScore: 76, status: 'RELEASING' },
  { title: 'Mirage Bakery', genres: ['Comedy', 'Slice of Life'], year: 2024, chapters: 29, averageScore: 72, status: 'FINISHED' },
  { title: 'Cobalt Meadow', genres: ['Fantasy', 'Romance'], year: 2026, chapters: 21, averageScore: 79, status: 'RELEASING' },
  { title: 'Harbor of Thorns', genres: ['Mystery', 'Supernatural'], year: 2023, chapters: 71, averageScore: 82, status: 'FINISHED' },
  { title: 'Static Prince', genres: ['Action', 'Sci-Fi'], year: 2025, chapters: 52, averageScore: 80, status: 'RELEASING' },
  { title: 'Porcelain Rain', genres: ['Drama', 'Romance'], year: 2022, chapters: 66, averageScore: 73, status: 'FINISHED' },
  { title: 'Sunset Machine', genres: ['Sci-Fi', 'Comedy'], year: 2026, chapters: 16, averageScore: 77, status: 'RELEASING' },
  { title: 'Hollow Stage', genres: ['Music', 'Drama'], year: 2025, chapters: 33, averageScore: 75, status: 'RELEASING' },
  { title: 'Fable Junction', genres: ['Adventure', 'Fantasy'], year: 2024, chapters: 58, averageScore: 81, status: 'FINISHED' },
  { title: 'Moon Archive', genres: ['Mystery', 'Sci-Fi'], year: 2026, chapters: 13, averageScore: 82, status: 'RELEASING' },
  { title: 'Paper Crown', genres: ['Romance', 'Drama'], year: 2023, chapters: 44, averageScore: 74, status: 'FINISHED' },
  { title: 'Rusted Anthem', genres: ['Action', 'Thriller'], year: 2025, chapters: 39, averageScore: 79, status: 'RELEASING' },
  { title: 'Sugar Comet', genres: ['Comedy', 'Fantasy'], year: 2024, chapters: 31, averageScore: 71, status: 'FINISHED' },
  { title: 'Winterline', genres: ['Drama', 'Adventure'], year: 2026, chapters: 11, averageScore: 78, status: 'RELEASING' },
  { title: 'Aster Voltage', genres: ['Sci-Fi', 'Sports'], year: 2025, chapters: 34, averageScore: 76, status: 'RELEASING' },
]

function buildPreviewSynopsis(title, genres = [], status = 'RELEASING') {
  const genreLine = genres.filter(Boolean).slice(0, 2).join(' and ').toLowerCase() || 'late-night genre'
  const stateLine = status === 'FINISHED' ? 'complete season' : 'current run'
  return `${title} is a ${stateLine} shaped around ${genreLine}, with a lead cast carrying the story through a darker late-night tone.`
}

const PREVIEW_ANIME_LIBRARY = PREVIEW_ANIME_SEED.map((item, index) => {
  const id = 7000 + index
  return {
    id,
    title: { romaji: item.title, english: item.title, native: item.title },
    season: item.season,
    seasonYear: item.year,
    episodes: item.episodes,
    averageScore: item.averageScore,
    status: item.status,
    genres: item.genres,
    format: 'TV',
    bannerImage: buildPreviewImage(`${item.title} Banner`, true),
    coverImage: { large: buildPreviewImage(item.title) },
    nextAiringEpisode: item.nextEpisode ? { episode: item.nextEpisode, airingAt: Date.now() + index * 3600_000 } : null,
    description: buildPreviewSynopsis(item.title, item.genres, item.status),
  }
})

const PREVIEW_MANGA_LIBRARY = PREVIEW_MANGA_SEED.map((item, index) => {
  const id = 9000 + index
  return {
    anilist_id: id,
    id,
    canonical_title: item.title,
    title_english: item.title,
    title_romaji: item.title,
    title_native: item.title,
    title: item.title,
    year: item.year,
    chapters_total: item.chapters,
    average_score: item.averageScore,
    status: item.status,
    genres: item.genres,
    format: 'MANGA',
    cover_image: buildPreviewImage(item.title),
    banner_image: buildPreviewImage(`${item.title} Banner`, true),
    description: buildPreviewSynopsis(item.title, item.genres, item.status),
  }
})

function previewMatchGenres(entryGenres = [], genresValue = '') {
  const wanted = String(genresValue || '').split(',').map((value) => value.trim()).filter(Boolean)
  if (wanted.length === 0) return true
  const haystack = entryGenres.map((value) => String(value).toLowerCase())
  return wanted.some((value) => haystack.includes(String(value).toLowerCase()))
}

function sortPreviewItems(items, sortKey, scoreKey, yearKey) {
  const list = [...items]
  const scoreAccessor = (item) => Number(item?.[scoreKey] || 0)
  const yearAccessor = (item) => Number(item?.[yearKey] || 0)
  switch (sortKey) {
    case 'SCORE_DESC':
      return list.sort((a, b) => scoreAccessor(b) - scoreAccessor(a))
    case 'POPULARITY_DESC':
      return list.sort((a, b) => scoreAccessor(b) - scoreAccessor(a) || yearAccessor(b) - yearAccessor(a))
    case 'START_DATE':
    case 'START_DATE_DESC':
    case 'UPDATED_AT_DESC':
      return list.sort((a, b) => yearAccessor(b) - yearAccessor(a) || scoreAccessor(b) - scoreAccessor(a))
    default:
      return list.sort((a, b) => scoreAccessor(b) - scoreAccessor(a) || yearAccessor(b) - yearAccessor(a))
  }
}

function paginatePreview(items, page = 1) {
  const safePage = Math.max(1, Number(page || 1))
  const start = (safePage - 1) * PREVIEW_PAGE_SIZE
  const media = items.slice(start, start + PREVIEW_PAGE_SIZE)
  return {
    media,
    pageInfo: {
      hasNextPage: start + PREVIEW_PAGE_SIZE < items.length,
      currentPage: safePage,
      perPage: PREVIEW_PAGE_SIZE,
    },
  }
}

function getPreviewAnimeCatalog({ genres = '', season = '', year = 0, sort = 'TRENDING_DESC', status = '', format = '', page = 1 } = {}) {
  const filtered = PREVIEW_ANIME_LIBRARY.filter((item) => {
    if (!previewMatchGenres(item.genres, genres)) return false
    if (season && item.season !== season) return false
    if (Number(year || 0) > 0 && Number(item.seasonYear || 0) !== Number(year)) return false
    if (status && item.status !== status) return false
    if (format && item.format !== format) return false
    return true
  })
  return paginatePreview(sortPreviewItems(filtered, sort, 'averageScore', 'seasonYear'), page)
}

function getPreviewMangaCatalog({ genres = '', year = 0, sort = 'TRENDING_DESC', status = '', format = '', page = 1 } = {}) {
  const filtered = PREVIEW_MANGA_LIBRARY.filter((item) => {
    if (!previewMatchGenres(item.genres, genres)) return false
    if (Number(year || 0) > 0 && Number(item.year || 0) !== Number(year)) return false
    if (status && item.status !== status) return false
    if (format && item.format !== format) return false
    return true
  })
  return paginatePreview(sortPreviewItems(filtered, sort, 'average_score', 'year'), page)
}

function searchPreviewAnimeCatalog(query = '') {
  const term = normalizePreviewQuery(query)
  if (!term) return PREVIEW_ANIME_LIBRARY.slice(0, 12)
  return PREVIEW_ANIME_LIBRARY.filter((item) => {
    const values = [item.title?.english, item.title?.romaji, item.title?.native, ...(item.genres ?? [])]
    return values.some((value) => normalizePreviewQuery(value).includes(term))
  }).slice(0, 12)
}

function searchPreviewMangaCatalog(query = '') {
  const term = normalizePreviewQuery(query)
  if (!term) return PREVIEW_MANGA_LIBRARY.slice(0, 12)
  return PREVIEW_MANGA_LIBRARY.filter((item) => {
    const values = [item.canonical_title, item.title_english, item.title_romaji, ...(item.genres ?? [])]
    return values.some((value) => normalizePreviewQuery(value).includes(term))
  }).slice(0, 12)
}

function getPreviewMangaCatalogHome() {
  return {
    featured: PREVIEW_MANGA_LIBRARY.slice(0, 6),
    trending: PREVIEW_MANGA_LIBRARY.slice(6, 12),
    popular: PREVIEW_MANGA_LIBRARY.slice(12, 18),
    recent: PREVIEW_MANGA_LIBRARY.filter((item) => item.status === 'RELEASING').slice(0, 6),
  }
}

function getPreviewAnimeCatalogHome(season = '', year = 0) {
  return {
    featured: getPreviewAnimeCatalog({ sort: 'TRENDING_DESC', status: 'RELEASING', page: 1 }).media.slice(0, 20),
    popular: getPreviewAnimeCatalog({ sort: 'POPULARITY_DESC', page: 1 }).media.slice(0, 12),
    seasonal: getPreviewAnimeCatalog({ season, year, sort: 'TRENDING_DESC', status: 'RELEASING', page: 1 }).media.slice(0, 12),
    topRated: getPreviewAnimeCatalog({ sort: 'SCORE_DESC', page: 1 }).media.slice(0, 12),
    action: getPreviewAnimeCatalog({ genres: 'Action', sort: 'POPULARITY_DESC', page: 1 }).media.slice(0, 12),
    fantasy: getPreviewAnimeCatalog({ genres: 'Fantasy', sort: 'POPULARITY_DESC', page: 1 }).media.slice(0, 12),
    romance: getPreviewAnimeCatalog({ genres: 'Romance', sort: 'POPULARITY_DESC', page: 1 }).media.slice(0, 12),
    scifi: getPreviewAnimeCatalog({ genres: 'Sci-Fi', sort: 'POPULARITY_DESC', page: 1 }).media.slice(0, 12),
    drama: getPreviewAnimeCatalog({ genres: 'Drama', sort: 'POPULARITY_DESC', page: 1 }).media.slice(0, 12),
    slice: getPreviewAnimeCatalog({ genres: 'Slice of Life', sort: 'POPULARITY_DESC', page: 1 }).media.slice(0, 12),
  }
}

function buildPreviewLocalAnimeEpisodes(localID, totalEpisodes = 12) {
  return Array.from({ length: totalEpisodes }, (_, index) => {
    const episodeNum = index + 1
    const watched = episodeNum < 4
    const inProgress = episodeNum === 4
    const folderName = episodeNum > 8 ? 'Season 2' : ''
    return {
      id: localID * 100 + episodeNum,
      anime_id: localID,
      episode_num: episodeNum,
      title: `Episode ${episodeNum}`,
      watched,
      progress_s: inProgress ? 802 : 0,
      duration_s: 1440,
      folder_name: folderName,
      file_path: `C:/Media/Anime/${localID}/Episode-${episodeNum}.mkv`,
    }
  })
}

function buildPreviewLocalMangaChapters(localID, totalChapters = 24) {
  return Array.from({ length: totalChapters }, (_, index) => {
    const chapterNum = index + 1
    const read = chapterNum < 7
    const inProgress = chapterNum === 7
    return {
      id: localID * 100 + chapterNum,
      manga_id: localID,
      chapter_num: chapterNum,
      title: `Chapter ${chapterNum}`,
      read,
      progress_page: inProgress ? 14 : 0,
    }
  })
}

const PREVIEW_LOCAL_ANIME = PREVIEW_ANIME_LIBRARY.slice(0, 6).map((item, index) => {
  const localID = index + 1
  const episodes = buildPreviewLocalAnimeEpisodes(localID, item.episodes || 12)
  return {
    id: localID,
    anilist_id: item.id,
    mal_id: item.id + 1000,
    display_title: item.title?.english || item.title?.romaji || 'Anime',
    title_romaji: item.title?.romaji || item.title?.english || 'Anime',
    title_english: item.title?.english || item.title?.romaji || 'Anime',
    cover_image: item.coverImage?.large || item.coverImage?.extraLarge || '',
    cover_blurhash: '',
    banner_image: item.bannerImage || '',
    synopsis: stripPreviewSynopsis(item.description),
    synopsis_es: stripPreviewSynopsis(item.description),
    status: item.status,
    year: item.seasonYear || item.year || 2025,
    episodes_total: episodes.length,
    episodes,
  }
})

const PREVIEW_LOCAL_MANGA = PREVIEW_MANGA_LIBRARY.slice(0, 6).map((item, index) => {
  const localID = index + 1
  const chapters = buildPreviewLocalMangaChapters(localID, item.chapters_total || item.chapters || 24)
  return {
    id: localID,
    anilist_id: item.anilist_id || item.id,
    mangadex_id: `preview-mangadex-${localID}`,
    display_title: item.title_english || item.canonical_title || item.title || 'Manga',
    title_romaji: item.title_romaji || item.canonical_title || item.title || 'Manga',
    title_english: item.title_english || item.canonical_title || item.title || 'Manga',
    cover_image: item.cover_image || '',
    cover_blurhash: '',
    banner_image: item.banner_image || '',
    synopsis_es: stripPreviewSynopsis(item.description),
    status: item.status,
    year: item.year || 2025,
    chapters_total: chapters.length,
    chapters,
  }
})

const PREVIEW_ANIME_LIST_ENTRIES = [
  { sourceIndex: 0, status: 'WATCHING', progress: 3, score: 8, airing_status: 'RELEASING' },
  { sourceIndex: 1, status: 'PLANNING', progress: 0, score: 0, airing_status: 'RELEASING' },
  { sourceIndex: 2, status: 'COMPLETED', progress: 13, score: 9, airing_status: 'FINISHED' },
  { sourceIndex: 3, status: 'ON_HOLD', progress: 6, score: 7, airing_status: 'FINISHED' },
  { sourceIndex: 4, status: 'DROPPED', progress: 2, score: 5, airing_status: 'RELEASING' },
].map((config) => {
  const item = PREVIEW_ANIME_LIBRARY[config.sourceIndex]
  return {
    anilist_id: item.id,
    mal_id: item.id + 1000,
    title: item.title?.romaji || item.title?.english || 'Anime',
    title_english: item.title?.english || item.title?.romaji || 'Anime',
    cover_image: item.coverImage?.large || item.coverImage?.extraLarge || '',
    status: config.status,
    episodes_watched: config.progress,
    episodes_total: item.episodes || 12,
    score: config.score,
    airing_status: config.airing_status,
    year: item.seasonYear || item.year || 2025,
  }
})

const PREVIEW_MANGA_LIST_ENTRIES = [
  { sourceIndex: 0, status: 'WATCHING', progress: 12, score: 8, volumesRead: 2, volumesTotal: 8 },
  { sourceIndex: 1, status: 'PLANNING', progress: 0, score: 0, volumesRead: 0, volumesTotal: 6 },
  { sourceIndex: 2, status: 'COMPLETED', progress: 92, score: 9, volumesRead: 10, volumesTotal: 10 },
  { sourceIndex: 3, status: 'ON_HOLD', progress: 9, score: 7, volumesRead: 1, volumesTotal: 4 },
  { sourceIndex: 4, status: 'DROPPED', progress: 7, score: 5, volumesRead: 1, volumesTotal: 5 },
].map((config) => {
  const item = PREVIEW_MANGA_LIBRARY[config.sourceIndex]
  return {
    anilist_id: item.anilist_id || item.id,
    mal_id: (item.anilist_id || item.id) + 1000,
    title: item.title_romaji || item.title_english || item.canonical_title || 'Manga',
    title_english: item.title_english || item.title_romaji || item.canonical_title || 'Manga',
    cover_image: item.cover_image || '',
    banner_image: item.banner_image || '',
    status: config.status,
    chapters_read: config.progress,
    chapters_total: item.chapters_total || item.chapters || 24,
    volumes_read: config.volumesRead,
    volumes_total: config.volumesTotal,
    score: config.score,
    year: item.year || 2025,
  }
})

function countPreviewStatuses(entries = []) {
  return entries.reduce((acc, entry) => {
    const status = String(entry.status || '').toUpperCase()
    if (!status) return acc
    acc[status] = Number(acc[status] || 0) + 1
    return acc
  }, {})
}

function stripPreviewSynopsis(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPreviewAnimeSourceName(sourceID = '') {
  const labels = {
    'jkanime-es': 'JKAnime',
    'animeflv-es': 'AnimeFLV',
    'animeav1-es': 'AnimeAV1',
    'animepahe-en': 'AnimePahe',
    'animeheaven-en': 'AnimeHeaven',
    'animegg-en': 'AnimeGG',
  }
  return labels[sourceID] || sourceID || 'Anime source'
}

function buildPreviewAnimeSearchResults(query = '', sourceID = '') {
  return searchPreviewAnimeCatalog(query).map((item) => ({
    id: `${sourceID || 'animeav1-es'}-${item.id}`,
    anime_id: `${item.id}`,
    anilist_id: item.id,
    source_id: sourceID || 'animeav1-es',
    source_name: getPreviewAnimeSourceName(sourceID || 'animeav1-es'),
    title: item.title?.english || item.title?.romaji || 'Anime',
    title_english: item.title?.english || item.title?.romaji || 'Anime',
    cover_url: item.coverImage?.large || '',
    resolved_cover_url: item.coverImage?.large || '',
    banner_url: item.bannerImage || '',
    resolved_banner_url: item.bannerImage || '',
    synopsis: item.description || '',
    year: item.seasonYear || 0,
  }))
}

function buildPreviewAnimeEpisodes(sourceID = '', animeID = '') {
  const normalizedAnimeID = String(animeID || '').split('-').pop()
  const selected = PREVIEW_ANIME_LIBRARY.find((item) => String(item.id) === normalizedAnimeID)
  const totalEpisodes = Math.max(6, Math.min(12, Number(selected?.episodes || 12)))
  return Array.from({ length: totalEpisodes }, (_, index) => ({
    id: `${sourceID || 'animeav1-es'}-${normalizedAnimeID}-ep-${index + 1}`,
    anime_id: `${normalizedAnimeID}`,
    number: index + 1,
    episode_num: index + 1,
    title: `Episode ${index + 1}`,
  }))
}

function getPreviewMangaSourceIDs(lang = 'es') {
  return lang === 'en'
    ? ['weebcentral-en', 'templetoons-en', 'mangapill-en']
    : ['m440-es', 'senshimanga-es', 'mangafire-es']
}

function getPreviewMangaSourceName(sourceID = '') {
  const labels = {
    'weebcentral-en': 'WeebCentral',
    'templetoons-en': 'TempleToons',
    'mangapill-en': 'MangaPill',
    'm440-es': 'M440',
    'senshimanga-es': 'SenshiManga',
    'mangafire-es': 'MangaFire (ES)',
  }
  return labels[sourceID] || sourceID || 'Manga source'
}

function buildPreviewMangaSourceMatches(anilistID, lang = 'es') {
  return getPreviewMangaSourceIDs(lang).map((sourceID, index) => ({
    source_id: sourceID,
    source_name: getPreviewMangaSourceName(sourceID),
    source_manga_id: `${sourceID}-${anilistID}`,
    source_title: PREVIEW_MANGA_LIBRARY.find((item) => Number(item.anilist_id || item.id) === Number(anilistID))?.title || 'Manga',
    status: index === 0 ? 'ready' : 'idle',
    confidence: index === 0 ? 0.96 : 0.72 - (index * 0.08),
    partial: false,
    hydrating: false,
  }))
}

function buildPreviewMangaChapters(sourceID = '', mangaID = '', count = 18) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${sourceID}-${mangaID}-ch-${count - index}`,
    chapter_id: `${sourceID}-${mangaID}-ch-${count - index}`,
    manga_id: `${mangaID}`,
    source_id: sourceID,
    number: count - index,
    title: `Chapter ${count - index}`,
  }))
}

export function buildPreviewWatchHistory(limit = 6) {
  return PREVIEW_ANIME_LIBRARY.slice(0, limit).map((item, index) => ({
    id: `history-${item.id}-${index + 1}`,
    anime_id: String(item.id),
    anime_title: item.title?.english || item.title?.romaji || 'Anime',
    episode_id: `animeav1-es-${item.id}-ep-${index + 1}`,
    episode_num: index + 1,
    cover_url: item.coverImage?.large || '',
    source_id: 'animeav1-es',
    progress: Math.max(0.22, 0.88 - (index * 0.12)),
    watched_at: Date.now() - (index * 86_400_000),
    mal_id: 0,
    anilist_id: item.id,
  }))
}

export function buildPreviewDashboard() {
  const continueWatchingOnline = buildPreviewWatchHistory(4).map((entry, index) => ({
    ...entry,
    next_episode_label: `Episode ${index + 2}`,
  }))

  return {
    continue_watching: [],
    continue_watching_online: continueWatchingOnline,
    recently_watched: continueWatchingOnline.slice(0, 3),
    recent_anime: PREVIEW_ANIME_LIBRARY.slice(0, 10),
    completed_anime: PREVIEW_ANIME_LIBRARY.filter((item) => item.status === 'FINISHED').slice(0, 8),
    continue_reading: PREVIEW_MANGA_LIBRARY.slice(0, 6),
    recent_manga: PREVIEW_MANGA_LIBRARY.filter((item) => item.status === 'RELEASING').slice(0, 8),
    watching_list: PREVIEW_ANIME_LIBRARY.filter((item) => item.status === 'RELEASING').slice(0, 8),
    stats: {
      anime: PREVIEW_ANIME_LIBRARY.length,
      manga: PREVIEW_MANGA_LIBRARY.length,
      watched: continueWatchingOnline.length,
      read: 6,
      episodes: continueWatchingOnline.length * 3,
      chapters: 24,
      online_anime: PREVIEW_ANIME_LIBRARY.filter((item) => item.status === 'RELEASING').length,
    },
  }
}

// Route external images through the local proxy server to avoid CORS blocks
// in the Wails webview. AniList and MangaDex images load fine directly;
// AnimeFLV and scraper sources need the proxy.
export function proxyImage(url, options = {}) {
  if (!url) return ''
  if (
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('file:') ||
    url.startsWith('http://localhost') ||
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('https://127.0.0.1') ||
    url.startsWith(INTERNAL_SERVER_BASE_URL)
  ) return url
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
  if (
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('file:') ||
    url.startsWith('http://localhost') ||
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('https://127.0.0.1') ||
    url.startsWith(INTERNAL_SERVER_BASE_URL)
  ) return url
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
  async completeStartupLaunch() {
    if (isWailsRuntimeUnavailable()) return null
    return window.go.main.App.CompleteStartupLaunch()
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
    if (isWailsRuntimeUnavailable()) return PREVIEW_LOCAL_ANIME
    return window.go.main.App.GetAnimeList()
  },
  async getAnimeDetail(id) {
    if (isWailsRuntimeUnavailable()) return PREVIEW_LOCAL_ANIME.find((item) => Number(item.id) === Number(id)) ?? null
    return window.go.main.App.GetAnimeDetail(id)
  },
  async deleteLocalAnime(id) {
    if (isWailsRuntimeUnavailable()) { console.log('[dev] deleteLocalAnime:', id); return null }
    return window.go.main.App.DeleteLocalAnime(id)
  },
  async getMangaList() {
    if (isWailsRuntimeUnavailable()) return PREVIEW_LOCAL_MANGA
    return window.go.main.App.GetMangaList()
  },
  async getMangaDetail(id) {
    if (isWailsRuntimeUnavailable()) return PREVIEW_LOCAL_MANGA.find((item) => Number(item.id) === Number(id)) ?? null
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
    if (isWailsRuntimeUnavailable()) return { data: { Page: getPreviewAnimeCatalog({ sort: 'TRENDING_DESC', page: 1 }) } }
    return window.go.main.App.GetTrending(lang)
  },
  async searchAniList(query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return { data: { Page: { media: searchPreviewAnimeCatalog(query) } } }
    return window.go.main.App.SearchAniList(query, lang)
  },
  async getAniListAnimeByID(id) {
    if (isWailsRuntimeUnavailable()) return PREVIEW_ANIME_LIBRARY.find((item) => Number(item.id) === Number(id)) ?? null
    return rememberRuntimeCache(['anilist-anime-detail', Number(id) || 0], SOURCE_METADATA_CACHE_TTL_MS, () => window.go.main.App.GetAniListAnimeByID(id))
  },
  async getAniListAnimeCatalogHome(season = '', year = 0) {
    if (isWailsRuntimeUnavailable()) return getPreviewAnimeCatalogHome(season, year)
    return window.go.main.App.GetAniListAnimeCatalogHome(season, year)
  },
  async getAniListMangaByID(id) {
    if (isWailsRuntimeUnavailable()) return PREVIEW_MANGA_LIBRARY.find((item) => Number(item.anilist_id || item.id) === Number(id)) ?? null
    return rememberRuntimeCache(['anilist-manga-detail', Number(id) || 0], SOURCE_METADATA_CACHE_TTL_MS, () => window.go.main.App.GetAniListMangaByID(id))
  },
  async getAniListMangaCatalogHome(lang = 'es') {
    if (isWailsRuntimeUnavailable()) return getPreviewMangaCatalogHome()
    return window.go.main.App.GetAniListMangaCatalogHome(lang)
  },
  async discoverManga(genre = '', year = 0, sort = 'TRENDING_DESC', status = '', format = '', page = 1) {
    if (isWailsRuntimeUnavailable()) return { data: { Page: getPreviewMangaCatalog({ genres: genre, year, sort, status, format, page }) } }
    return window.go.main.App.DiscoverManga(genre, year, sort, status, format, page)
  },
  async discoverAnime(genre = '', season = '', year = 0, sort = 'TRENDING_DESC', status = '', format = '', page = 1) {
    if (isWailsRuntimeUnavailable()) return { data: { Page: getPreviewAnimeCatalog({ genres: genre, season, year, sort, status, format, page }) } }
    return window.go.main.App.DiscoverAnime(genre, season, year, sort, status, format, page)
  },
  async searchMangaDex(query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return { data: searchPreviewMangaCatalog(query) }
    return window.go.main.App.SearchMangaDex(query, lang)
  },

  // Ã¢â€â‚¬Ã¢â€â‚¬ Extensions / Streaming Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async listExtensions() {
    if (isWailsRuntimeUnavailable()) {
      return [
        { id: 'animeav1-es', name: 'AnimeAV1', type: 'anime', languages: ['es'] },
        { id: 'animeflv-es', name: 'AnimeFLV', type: 'anime', languages: ['es'] },
        { id: 'animegg-en', name: 'AnimeGG', type: 'anime', languages: ['en'] },
        { id: 'weebcentral-en', name: 'WeebCentral', type: 'manga', languages: ['en'] },
        { id: 'm440-es', name: 'M440', type: 'manga', languages: ['es'] },
      ]
    }
    return window.go.main.App.ListExtensions()
  },
  async searchOnline(query, sourceID = '') {
    if (isWailsRuntimeUnavailable()) return buildPreviewAnimeSearchResults(query, sourceID)
    return window.go.main.App.SearchOnline(query, sourceID)
  },
  async getOnlineEpisodes(sourceID, animeID) {
    if (isWailsRuntimeUnavailable()) return buildPreviewAnimeEpisodes(sourceID, animeID)
    return rememberRuntimeCache(['online-episodes', sourceID, animeID], SOURCE_METADATA_CACHE_TTL_MS, () => window.go.main.App.GetOnlineEpisodes(sourceID, animeID))
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
    if (isWailsRuntimeUnavailable()) return buildPreviewWatchHistory(limit)
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
    if (isWailsRuntimeUnavailable()) return buildPreviewDashboard()
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
    if (isWailsRuntimeUnavailable()) return buildPreviewMangaSourceMatches(anilistID, lang)
    return rememberRuntimeCache(
      ['manga-source-matches', anilistID, lang],
      SOURCE_METADATA_CACHE_TTL_MS,
      () => window.go.main.App.GetMangaSourceMatches(anilistID, lang),
      { shouldCache: shouldCacheMangaSourceMatchList },
    )
  },
  async resolveMangaSourceForAniList(sourceID, anilistID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return buildPreviewMangaSourceMatches(anilistID, lang).find((item) => item.source_id === sourceID) ?? null
    return rememberRuntimeCache(
      ['manga-source-resolve', sourceID, anilistID, lang],
      SOURCE_METADATA_CACHE_TTL_MS,
      () => window.go.main.App.ResolveMangaSourceForAniList(sourceID, anilistID, lang),
      { shouldCache: shouldCacheResolvedMangaSource },
    )
  },
  async getMangaChaptersForAniListSource(sourceID, anilistID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) {
      return {
        source: buildPreviewMangaSourceMatches(anilistID, lang).find((item) => item.source_id === sourceID) ?? null,
        chapters: buildPreviewMangaChapters(sourceID, `${sourceID}-${anilistID}`),
      }
    }
    return rememberRuntimeCache(
      ['manga-source-chapters-for-anilist', sourceID, anilistID, lang],
      SOURCE_METADATA_CACHE_TTL_MS,
      () => window.go.main.App.GetMangaChaptersForAniListSource(sourceID, anilistID, lang),
      { shouldCache: shouldCacheResolvedMangaChapters },
    )
  },
  async searchMangaSource(sourceID, query, lang = 'es') {
    if (isWailsRuntimeUnavailable()) {
      return searchPreviewMangaCatalog(query).map((item) => ({
        id: `${sourceID}-${item.anilist_id || item.id}`,
        title: item.canonical_title || item.title || 'Manga',
        cover_url: item.cover_image || '',
        resolved_cover_url: item.cover_image || '',
        resolved_banner_url: item.banner_image || '',
        resolved_description: item.description || '',
        canonical_title: item.canonical_title || item.title || 'Manga',
        canonical_title_english: item.title_english || item.canonical_title || item.title || 'Manga',
        anilist_id: item.anilist_id || item.id,
        year: item.year || 0,
        source_id: sourceID,
      }))
    }
    return window.go.main.App.SearchMangaSource(sourceID, query, lang)
  },
  async getMangaChaptersOnline(mangaID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return buildPreviewMangaChapters(lang === 'en' ? 'weebcentral-en' : 'm440-es', mangaID)
    return window.go.main.App.GetMangaChaptersOnline(mangaID, lang)
  },
  async getMangaChaptersSource(sourceID, mangaID, lang = 'es') {
    if (isWailsRuntimeUnavailable()) return buildPreviewMangaChapters(sourceID, mangaID)
    return rememberRuntimeCache(
      ['manga-source-chapters', sourceID, mangaID, lang],
      SOURCE_METADATA_CACHE_TTL_MS,
      () => window.go.main.App.GetMangaChaptersSource(sourceID, mangaID, lang),
      { shouldCache: () => shouldCacheDirectMangaChapterList(sourceID) },
    )
  },
  async getChapterPages(chapterID, dataSaver = false) {
    if (isWailsRuntimeUnavailable()) return []
    return window.go.main.App.GetChapterPages(chapterID, dataSaver)
  },
  async getChapterPagesSource(sourceID, chapterID, dataSaver = false) {
    if (isWailsRuntimeUnavailable()) return []
    return rememberRuntimeCache(['manga-chapter-pages', sourceID, chapterID, dataSaver], CHAPTER_PAGES_CACHE_TTL_MS, () => window.go.main.App.GetChapterPagesSource(sourceID, chapterID, dataSaver))
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
    if (isWailsRuntimeUnavailable()) return PREVIEW_ANIME_LIST_ENTRIES
    return window.go.main.App.GetAnimeListAll()
  },
  async getAnimeListCounts() {
    if (isWailsRuntimeUnavailable()) return countPreviewStatuses(PREVIEW_ANIME_LIST_ENTRIES)
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
    if (isWailsRuntimeUnavailable()) return PREVIEW_MANGA_LIST_ENTRIES
    return window.go.main.App.GetMangaListAll()
  },
  async getMangaListByFormat() {
    if (isWailsRuntimeUnavailable()) return { manga: [], manhwa: [], manhua: [] }
    return window.go.main.App.GetMangaListByFormat()
  },
  async getMangaListCounts() {
    if (isWailsRuntimeUnavailable()) return countPreviewStatuses(PREVIEW_MANGA_LIST_ENTRIES)
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
