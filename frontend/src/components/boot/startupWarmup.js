import { wails } from '../../lib/wails.js'

export const STARTUP_MIN_VISIBLE_MS = 3200
export const STARTUP_EXIT_MS = 360
export const STARTUP_TASK_TIMEOUT_MS = 4800
export const STARTUP_BACKGROUND_DELAY_MS = 1200
export const STARTUP_BACKGROUND_CONCURRENCY = 1
const STARTUP_DETAIL_PRELOAD_LIMIT = 4

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function waitForStartupDelay(ms) {
  return wait(ms)
}

export function getStartupWarmupLanguage(settings = {}) {
  return String(settings?.language || '').toLowerCase() === 'en' ? 'en' : 'es'
}

export function getStartupSeason(now = new Date()) {
  const month = now.getMonth() + 1
  if (month <= 3) return { season: 'WINTER', year: now.getFullYear() }
  if (month <= 6) return { season: 'SPRING', year: now.getFullYear() }
  if (month <= 9) return { season: 'SUMMER', year: now.getFullYear() }
  return { season: 'FALL', year: now.getFullYear() }
}

export async function runStartupWarmupTask(task, queryClient) {
  const result = await task.run()
  if (task?.queryKey && queryClient?.setQueryData) {
    queryClient.setQueryData(task.queryKey, result)
  }
  return result
}

export async function runStartupWarmupQueue(tasks, queryClient, concurrency = STARTUP_BACKGROUND_CONCURRENCY) {
  const queue = Array.isArray(tasks) ? tasks.filter(Boolean) : []
  if (queue.length === 0) return

  const safeConcurrency = Math.max(1, Math.min(queue.length, Number(concurrency) || 1))
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < queue.length) {
      const currentTask = queue[nextIndex]
      nextIndex += 1
      await runStartupWarmupTask(currentTask, queryClient)
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()))
}

function normalizeCatalogPage(payload) {
  const pageData = payload?.data?.Page
  return {
    media: pageData?.media ?? [],
    hasNextPage: pageData?.pageInfo?.hasNextPage ?? false,
    page: pageData?.pageInfo?.currentPage ?? 1,
  }
}

function normalizeMangaCatalogItem(item) {
  if (!item) return null

  const titleObj = item.title || {}
  const coverObj = item.coverImage || {}
  const startDate = item.startDate || {}
  const canonicalTitle =
    item.canonical_title ||
    item.title_english ||
    titleObj.english ||
    item.title_romaji ||
    titleObj.romaji ||
    item.title_native ||
    titleObj.native ||
    (typeof item.title === 'string' ? item.title : '') ||
    ''
  const coverURL =
    item.cover_url ||
    item.resolved_cover_url ||
    item.cover_large ||
    coverObj.extraLarge ||
    coverObj.large ||
    item.cover_medium ||
    coverObj.medium ||
    ''
  const bannerURL =
    item.banner_url ||
    item.resolved_banner_url ||
    item.banner_image ||
    item.bannerImage ||
    ''

  return {
    mode: 'canonical',
    id: Number(item.anilist_id || item.id || 0),
    anilist_id: Number(item.anilist_id || item.id || 0),
    mal_id: Number(item.mal_id || item.idMal || 0),
    title: canonicalTitle,
    canonical_title: canonicalTitle,
    canonical_title_english: item.title_english || titleObj.english || '',
    title_english: item.title_english || titleObj.english || '',
    title_romaji: item.title_romaji || titleObj.romaji || '',
    title_native: item.title_native || titleObj.native || '',
    resolved_cover_url: coverURL,
    cover_url: coverURL,
    resolved_banner_url: bannerURL,
    banner_url: bannerURL,
    resolved_description: item.description || item.resolved_description || '',
    description: item.description || item.resolved_description || '',
    resolved_year: Number(item.year || item.resolved_year || startDate.year || 0),
    year: Number(item.year || item.resolved_year || startDate.year || 0),
    resolved_status: item.status || item.resolved_status || '',
    status: item.status || item.resolved_status || '',
    resolved_format: item.format || item.resolved_format || '',
    format: item.format || item.resolved_format || '',
    average_score: Number(item.average_score || item.averageScore || 0),
    chapters_total: Number(item.chapters_total || item.chapters || 0),
    volumes_total: Number(item.volumes_total || item.volumes || 0),
    genres: Array.isArray(item.genres) ? item.genres : [],
    characters: Array.isArray(item.characters) ? item.characters : [],
    default_source_id: item.default_source_id || '',
    search_candidates: Array.isArray(item.search_candidates) ? item.search_candidates : [],
  }
}

function normalizeMangaCatalogPage(payload) {
  const pageData = payload?.data?.Page
  return {
    media: (pageData?.media ?? []).map(normalizeMangaCatalogItem).filter(Boolean),
    hasNextPage: pageData?.pageInfo?.hasNextPage ?? false,
    page: pageData?.pageInfo?.currentPage ?? 1,
  }
}

async function settleWithin(task, timeoutMs = STARTUP_TASK_TIMEOUT_MS) {
  return Promise.race([
    Promise.resolve().then(task),
    wait(timeoutMs).then(() => ({ timedOut: true })),
  ]).catch((error) => ({ error }))
}

async function warmAnimeDetailSet(lang) {
  const response = await wails.getTrending(lang)
  const media = response?.data?.Page?.media ?? []
  const ids = media
    .map((item) => Number(item?.id || item?.anilist_id || 0))
    .filter((value) => value > 0)
    .slice(0, STARTUP_DETAIL_PRELOAD_LIMIT)

  await Promise.allSettled(ids.map((id) => wails.getAniListAnimeByID(id)))
}

async function warmMangaDetailSet(lang) {
  const response = await wails.discoverManga('', 0, 'TRENDING_DESC', '', '', 1)
  const media = response?.data?.Page?.media ?? []
  const ids = media
    .map((item) => Number(item?.id || item?.anilist_id || 0))
    .filter((value) => value > 0)
    .slice(0, STARTUP_DETAIL_PRELOAD_LIMIT)

  await Promise.allSettled(ids.map((id) => wails.getAniListMangaByID(id)))
}

export function buildStartupWarmupPlan(settings = {}) {
  const lang = getStartupWarmupLanguage(settings)
  const { season, year } = getStartupSeason()

  return {
    lang,
    blocking: [
      {
        key: 'home-dashboard',
        queryKey: ['gui2-home-dashboard'],
        staleTime: 60_000,
        run: () => wails.getDashboard(),
      },
      {
        key: 'auth-status',
        run: () => wails.getAuthStatus(),
      },
      {
        key: 'library-stats',
        run: () => wails.getLibraryStats(),
      },
      {
        key: 'library-paths',
        run: () => Promise.all([wails.getLibraryPaths(), wails.getAnimeImportDir()]),
      },
      {
        key: 'remote-sync-status',
        run: () => wails.getRemoteListSyncStatus(),
      },
      {
        key: 'mpv-status',
        run: () => wails.isMPVAvailable(),
      },
      {
        key: 'home-trending',
        queryKey: ['gui2-home-trending', lang],
        staleTime: 10 * 60_000,
        run: async () => {
          const response = await wails.getTrending(lang)
          return response?.data?.Page?.media ?? []
        },
      },
      {
        key: 'anime-catalog-default',
        queryKey: ['anime-catalog', lang, 'TRENDING_DESC', '', '', 0, 1, '', ''],
        staleTime: 20 * 60_000,
        run: async () => normalizeCatalogPage(await wails.discoverAnime('', '', 0, 'TRENDING_DESC', '', '', 1)),
      },
      {
        key: 'manga-catalog-default',
        queryKey: ['manga-catalog', lang, 'TRENDING_DESC', '', 0, 1, '', ''],
        staleTime: 20 * 60_000,
        run: async () => normalizeMangaCatalogPage(await wails.discoverManga('', 0, 'TRENDING_DESC', '', '', 1)),
      },
    ],
    background: [
      {
        key: 'home-popular-now',
        run: () => wails.discoverAnime('', '', year, 'POPULARITY_DESC', '', '', 1),
      },
      {
        key: 'home-trending-season',
        run: () => wails.discoverAnime('', season, year, 'TRENDING_DESC', 'RELEASING', '', 1),
      },
      {
        key: 'home-top-rated',
        run: () => wails.discoverAnime('', '', 0, 'SCORE_DESC', '', '', 1),
      },
      {
        key: 'history',
        run: () => wails.getWatchHistory(12),
      },
      {
        key: 'anime-list-counts',
        run: () => wails.getAnimeListCounts(),
      },
      {
        key: 'manga-list-counts',
        run: () => wails.getMangaListCounts(),
      },
      {
        key: 'manga-catalog-home',
        run: () => wails.getAniListMangaCatalogHome(lang),
      },
      {
        key: 'anime-detail-seed',
        run: () => warmAnimeDetailSet(lang),
      },
      {
        key: 'manga-detail-seed',
        run: () => warmMangaDetailSet(lang),
      },
    ],
  }
}

export async function runStartupWarmup(queryClient) {
  const rawSettings = await settleWithin(() => wails.getSettings(), 2400)
  const settings = rawSettings && !rawSettings.timedOut && !rawSettings.error ? rawSettings : {}
  const plan = buildStartupWarmupPlan(settings)

  const blockingTasks = plan.blocking.map((task) => settleWithin(() => runStartupWarmupTask(task, queryClient)))
  await Promise.allSettled(blockingTasks)

  return {
    lang: plan.lang,
    blockingCount: plan.blocking.length,
    backgroundCount: plan.background.length,
    startBackground: () => runStartupWarmupQueue(plan.background, queryClient, STARTUP_BACKGROUND_CONCURRENCY),
  }
}
