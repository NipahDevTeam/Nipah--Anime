import { wails } from '../../lib/wails.js'
import {
  BOOT_STAGE_FINAL_REVEAL,
  BOOT_STAGE_HYDRATING_ANIME,
  BOOT_STAGE_HYDRATING_MANGA,
  BOOT_STAGE_PREPARING_HOME,
} from './bootStageModel.js'

export const STARTUP_MIN_VISIBLE_MS = 5000
export const STARTUP_EXIT_MS = 280
export const STARTUP_TASK_TIMEOUT_MS = 5200
export const STARTUP_BACKGROUND_DELAY_MS = 120
export const STARTUP_BACKGROUND_CONCURRENCY = 2
export const STARTUP_DETAIL_WARM_LIMIT = 4
export const STARTUP_HOME_MIN_ANIME_RECENT_ITEMS = 3
export const STARTUP_HOME_MIN_ANIME_SHELVES = 2
export const STARTUP_HOME_MIN_MANGA_SHELVES = 2
export const STARTUP_HOME_MIN_MANGA_RECENT_ITEMS = 3
export const STARTUP_REQUIRED_READY_TIMEOUT_MS = 24000
export const STARTUP_REQUIRED_READY_RETRY_MS = 260

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

function pickString(...values) {
  const match = values.find((value) => typeof value === 'string' && value.trim())
  return match ? match.trim() : ''
}

function getMediaID(item) {
  return Number(item?.id || item?.anilist_id || 0)
}

function getMediaTitle(item, fallback = '') {
  return pickString(
    item?.title,
    item?.canonical_title,
    item?.title_english,
    item?.title_romaji,
    item?.anime_title,
    item?.title?.english,
    item?.title?.romaji,
    item?.title?.native,
    fallback,
  )
}

function uniqueMedia(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = getMediaID(item)
    const title = getMediaTitle(item)
    const key = id > 0 ? `id:${id}` : `title:${title}`
    if (!title && id <= 0) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasAiringSignal(item) {
  return item?.status === 'RELEASING' || Number(item?.nextAiringEpisode?.episode || item?.episode_num || 0) > 0
}

function buildStartupShelf(key, items) {
  return {
    key,
    items: uniqueMedia(items),
  }
}

function filterStartupShelfItems(items, limit = 20) {
  return uniqueMedia(items).slice(0, limit)
}

function unwrapStartupTaskResult(result) {
  if (!result || result.timedOut || result.error) return null
  return result
}

export function buildStartupHomeSnapshot({
  lang = 'es',
  dashboard = {},
  animeCatalogHome = {},
  mangaCatalogHome = {},
} = {}) {
  const animeHero = uniqueMedia(animeCatalogHome?.featured || [])[0] || null
  const animeRecent = uniqueMedia([
    ...(animeCatalogHome?.newlyTrending || []),
    ...(animeCatalogHome?.seasonalPopular || []),
    ...(animeCatalogHome?.topRated || []),
    ...(animeCatalogHome?.lastSeason || []),
    ...(animeCatalogHome?.featured || []),
  ]).filter(hasAiringSignal).slice(0, 5)
  const animeShelves = [
    buildStartupShelf('newly-trending', filterStartupShelfItems(animeCatalogHome?.newlyTrending || [])),
    buildStartupShelf('popular-this-season', filterStartupShelfItems(animeCatalogHome?.seasonalPopular || [])),
    buildStartupShelf('upcoming', filterStartupShelfItems(animeCatalogHome?.upcoming || [])),
  ].filter((section) => section.items.length > 0)

  const mangaHero = uniqueMedia([
    ...(mangaCatalogHome?.featured || []),
    ...(mangaCatalogHome?.trending || []),
    ...(mangaCatalogHome?.popular || []),
  ])[0] || null
  const mangaRecent = uniqueMedia([
    ...(mangaCatalogHome?.recent || []),
    ...(dashboard?.recent_manga_updates || []),
    ...(dashboard?.recent_manga_online || []),
    ...(dashboard?.recent_manga || []),
  ]).slice(0, 5)
  const mangaShelves = [
    buildStartupShelf('recent-manga-updates', filterStartupShelfItems([
      ...(mangaCatalogHome?.recent || []),
      ...(mangaCatalogHome?.featured || []).slice(0, 6),
    ])),
    buildStartupShelf('fresh-manga-picks', filterStartupShelfItems([
      ...(mangaCatalogHome?.recent || []),
      ...(mangaCatalogHome?.featured || []).slice(0, 6),
      ...(mangaCatalogHome?.popular || []).slice(0, 6),
    ])),
    buildStartupShelf('popular-manga-right-now', filterStartupShelfItems([
      ...(mangaCatalogHome?.popular || []),
      ...(mangaCatalogHome?.featured || []).slice(0, 6),
      ...(mangaCatalogHome?.recent || []).slice(0, 6),
    ])),
  ].filter((section) => section.items.length > 0)

  return {
    lang,
    dashboard,
    anime: {
      hero: animeHero,
      recent: animeRecent,
      shelves: animeShelves,
    },
    manga: {
      hero: mangaHero,
      recent: mangaRecent,
      shelves: mangaShelves,
    },
  }
}

export function getStartupHomeReadiness(snapshot = {}) {
  const animeHeroReady = Boolean(snapshot?.anime?.hero && getMediaTitle(snapshot.anime.hero))
  const animeRecentReady = (snapshot?.anime?.recent?.length || 0) >= STARTUP_HOME_MIN_ANIME_RECENT_ITEMS
  const animeShelfCount = (snapshot?.anime?.shelves || []).filter((section) => (section?.items?.length || 0) > 0).length
  const animeShelvesReady = animeShelfCount >= STARTUP_HOME_MIN_ANIME_SHELVES
  const mangaHeroReady = Boolean(snapshot?.manga?.hero && getMediaTitle(snapshot.manga.hero))
  const mangaRecentReady = (snapshot?.manga?.recent?.length || 0) >= STARTUP_HOME_MIN_MANGA_RECENT_ITEMS
  const mangaShelfCount = (snapshot?.manga?.shelves || []).filter((section) => (section?.items?.length || 0) > 0).length
  const mangaShelvesReady = mangaShelfCount >= STARTUP_HOME_MIN_MANGA_SHELVES

  const missing = []
  if (!animeHeroReady) missing.push('anime-hero')
  if (!animeRecentReady) missing.push('anime-recent')
  if (!animeShelvesReady) missing.push('anime-shelves')
  if (!mangaHeroReady) missing.push('manga-hero')
  if (!mangaRecentReady) missing.push('manga-recent')
  if (!mangaShelvesReady) missing.push('manga-shelves')

  const animeReady = animeHeroReady && animeRecentReady && animeShelvesReady
  const mangaReady = mangaHeroReady && mangaRecentReady && mangaShelvesReady
  if (!animeReady || !mangaReady) {
    return {
      ready: false,
      mode: 'blocked',
      usingFallback: false,
      missing,
    }
  }

  return {
    ready: true,
    mode: 'full',
    usingFallback: false,
    missing: [],
  }
}

export function collectAniListWarmupIDs(items, limit = STARTUP_DETAIL_WARM_LIMIT) {
  const resolvedLimit = Math.max(1, Number(limit) || STARTUP_DETAIL_WARM_LIMIT)
  const seen = new Set()
  const ids = []

  for (const item of Array.isArray(items) ? items : []) {
    const id = Number(item?.anilist_id || item?.id || 0)
    if (id <= 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= resolvedLimit) break
  }

  return ids
}

export async function prewarmAniListDetailEntries(
  items,
  lang,
  loadDetail,
  buildQueryKey,
  queryClient = null,
  limit = STARTUP_DETAIL_WARM_LIMIT,
) {
  if (typeof loadDetail !== 'function') return []

  const ids = collectAniListWarmupIDs(items, limit)
  await Promise.allSettled(ids.map(async (id) => {
    const detail = await loadDetail(id)
    if (!detail || typeof buildQueryKey !== 'function' || !queryClient?.setQueryData) return
    queryClient.setQueryData(buildQueryKey(id, lang), detail)
  }))
  return ids
}

export async function runStartupWarmupTask(task, queryClient) {
  const result = await task.run(queryClient)
  if (task?.queryKey && queryClient?.setQueryData) {
    queryClient.setQueryData(task.queryKey, result)
  }
  return result
}

export async function runStartupWarmupQueue(tasks, queryClient, concurrency = STARTUP_BACKGROUND_CONCURRENCY) {
  const queue = Array.isArray(tasks) ? tasks.filter(Boolean) : []
  if (queue.length === 0) return

  const safeConcurrency = Math.max(1, Math.min(queue.length, Number(concurrency) || 1))

  const worker = async (workerIndex) => {
    for (let taskIndex = workerIndex; taskIndex < queue.length; taskIndex += safeConcurrency) {
      await runStartupWarmupTask(queue[taskIndex], queryClient)
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, (_, workerIndex) => worker(workerIndex)))
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

export function buildStartupWarmupPlan(settings = {}) {
  const lang = getStartupWarmupLanguage(settings)
  const { season, year } = getStartupSeason()

  return {
    lang,
    season,
    year,
    blocking: [
      {
        key: 'home-dashboard',
        queryKey: ['gui2-home-dashboard'],
        staleTime: 60_000,
        run: () => wails.getDashboard(),
      },
      {
        key: 'anime-home-catalog',
        queryKey: ['gui2-home-anilist', lang, season, year],
        staleTime: 10 * 60_000,
        run: () => wails.getAniListAnimeCatalogHome(season, year),
      },
      {
        key: 'manga-home-catalog',
        queryKey: ['gui2-home-manga-catalog', lang],
        staleTime: 10 * 60_000,
        run: () => wails.getAniListMangaCatalogHome(lang),
      },
      {
        key: 'anime-catalog-default',
        queryKey: ['anime-catalog', lang, 'TRENDING_DESC', '', '', 0, 1, '', ''],
        staleTime: 20 * 60_000,
        run: async (queryClient) => {
          const page = normalizeCatalogPage(await wails.discoverAnime('', '', 0, 'TRENDING_DESC', '', '', 1))
          await prewarmAniListDetailEntries(
            page.media,
            lang,
            (id) => wails.getAniListAnimeByID(id),
            (id, queryLang) => ['anime-detail-anilist-v3', id, queryLang],
            queryClient,
          )
          return page
        },
      },
      {
        key: 'manga-catalog-default',
        queryKey: ['manga-catalog', lang, 'TRENDING_DESC', '', 0, 1, '', ''],
        staleTime: 20 * 60_000,
        run: async (queryClient) => {
          const page = normalizeMangaCatalogPage(await wails.discoverManga('', 0, 'TRENDING_DESC', '', '', 1))
          await prewarmAniListDetailEntries(
            page.media,
            lang,
            (id) => wails.getAniListMangaByID(id),
            (id, queryLang) => ['manga-detail-anilist-v3', id, queryLang],
            queryClient,
          )
          return page
        },
      },
      {
        key: 'remote-sync-status',
        queryKey: ['gui2-remote-sync-status'],
        staleTime: 30_000,
        run: () => wails.getRemoteListSyncStatus(),
      },
    ],
    background: [
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
        key: 'mpv-status',
        run: () => wails.isMPVAvailable(),
      },
      {
        key: 'history',
        run: () => wails.getWatchHistory(12),
      },
      // My Lists should never gate first paint. Fresh installs and empty databases
      // can legitimately have no shelf data yet, and existing users still get these
      // caches warmed immediately after reveal.
      {
        key: 'my-lists-anime-entries',
        queryKey: ['gui2-my-lists-anime-entries'],
        staleTime: 60_000,
        run: () => wails.getAnimeListAll(),
      },
      {
        key: 'my-lists-anime-counts',
        queryKey: ['gui2-my-lists-anime-counts'],
        staleTime: 60_000,
        run: () => wails.getAnimeListCounts(),
      },
      {
        key: 'my-lists-manga-entries',
        queryKey: ['gui2-my-lists-manga-entries'],
        staleTime: 60_000,
        run: () => wails.getMangaListAll(),
      },
      {
        key: 'my-lists-manga-counts',
        queryKey: ['gui2-my-lists-manga-counts'],
        staleTime: 60_000,
        run: () => wails.getMangaListCounts(),
      },
    ],
  }
}

export async function runStartupWarmup(queryClient, options = {}) {
  const onStageChange = typeof options?.onStageChange === 'function' ? options.onStageChange : null
  onStageChange?.(BOOT_STAGE_PREPARING_HOME)

  const rawSettings = await settleWithin(() => wails.getSettings(), 2400)
  const settings = rawSettings && !rawSettings.timedOut && !rawSettings.error ? rawSettings : {}
  const plan = buildStartupWarmupPlan(settings)
  const blockingTaskResults = {}
  const getTaskTimeout = (task) => (Number(task?.timeoutMs) > 0 ? Number(task.timeoutMs) : STARTUP_TASK_TIMEOUT_MS)
  const preparationTasks = plan.blocking.filter((task) => [
    'home-dashboard',
    'my-lists-anime-entries',
    'my-lists-anime-counts',
    'my-lists-manga-entries',
    'my-lists-manga-counts',
    'remote-sync-status',
  ].includes(task.key))
  const animeTasks = plan.blocking.filter((task) => [
    'anime-home-catalog',
    'anime-catalog-default',
  ].includes(task.key))
  const mangaTasks = plan.blocking.filter((task) => [
    'manga-home-catalog',
    'manga-catalog-default',
  ].includes(task.key))

  const blockingPromises = []

  for (const task of preparationTasks) {
    blockingPromises.push((async () => {
      blockingTaskResults[task.key] = await settleWithin(
        () => runStartupWarmupTask(task, queryClient),
        getTaskTimeout(task),
      )
    })())
  }

  if (animeTasks.length > 0) {
    onStageChange?.(BOOT_STAGE_HYDRATING_ANIME)
    for (const task of animeTasks) {
      blockingPromises.push((async () => {
        blockingTaskResults[task.key] = await settleWithin(
          () => runStartupWarmupTask(task, queryClient),
          getTaskTimeout(task),
        )
      })())
    }
  }

  if (mangaTasks.length > 0) {
    onStageChange?.(BOOT_STAGE_HYDRATING_MANGA)
    for (const task of mangaTasks) {
      blockingPromises.push((async () => {
        blockingTaskResults[task.key] = await settleWithin(
          () => runStartupWarmupTask(task, queryClient),
          getTaskTimeout(task),
        )
      })())
    }
  }

  await Promise.allSettled(blockingPromises)

  const snapshot = buildStartupHomeSnapshot({
    lang: plan.lang,
    dashboard: unwrapStartupTaskResult(blockingTaskResults['home-dashboard']) || {},
    animeCatalogHome: unwrapStartupTaskResult(blockingTaskResults['anime-home-catalog']) || {},
    mangaCatalogHome: unwrapStartupTaskResult(blockingTaskResults['manga-home-catalog']) || {},
  })
  const readiness = getStartupHomeReadiness(snapshot)
  const blockingReady = plan.blocking.every((task) => {
    const result = blockingTaskResults[task.key]
    return Boolean(result) && !result?.timedOut && !result?.error
  })
  const startupReady = readiness.ready && blockingReady
  if (startupReady) {
    onStageChange?.(BOOT_STAGE_FINAL_REVEAL)
  }
  if (queryClient?.setQueryData) {
    queryClient.setQueryData(['gui2-home-startup-snapshot', plan.lang, plan.season, plan.year], snapshot)
    queryClient.setQueryData(['gui2-home-startup-readiness', plan.lang, plan.season, plan.year], readiness)
  }

  return {
    lang: plan.lang,
    season: plan.season,
    year: plan.year,
    blockingCount: plan.blocking.length,
    backgroundCount: plan.background.length,
    homeSnapshot: snapshot,
    homeReadiness: readiness,
    homeReady: readiness.ready,
    blockingReady: blockingReady,
    ready: startupReady,
    startBackground: () => runStartupWarmupQueue(plan.background, queryClient, STARTUP_BACKGROUND_CONCURRENCY),
  }
}
