import assert from 'node:assert/strict'
import {
  STARTUP_BACKGROUND_DELAY_MS,
  STARTUP_EXIT_MS,
  STARTUP_HOME_MIN_ANIME_RECENT_ITEMS,
  STARTUP_HOME_MIN_ANIME_SHELVES,
  STARTUP_HOME_MIN_MANGA_RECENT_ITEMS,
  STARTUP_HOME_MIN_MANGA_SHELVES,
  STARTUP_REQUIRED_READY_RETRY_MS,
  STARTUP_REQUIRED_READY_TIMEOUT_MS,
  STARTUP_TASK_TIMEOUT_MS,
  STARTUP_MIN_VISIBLE_MS,
  buildStartupWarmupPlan,
  buildStartupHomeSnapshot,
  collectAniListWarmupIDs,
  getStartupSeason,
  getStartupHomeReadiness,
  getStartupWarmupLanguage,
  prewarmAniListDetailEntries,
  runStartupWarmup,
  runStartupWarmupQueue,
  runStartupWarmupTask,
} from './startupWarmup.js'
import {
  BOOT_STAGE_FINAL_REVEAL,
  BOOT_STAGE_HYDRATING_ANIME,
  BOOT_STAGE_HYDRATING_MANGA,
  BOOT_STAGE_PREPARING_HOME,
} from './bootStageModel.js'
import { wails } from '../../lib/wails.js'

assert.equal(getStartupWarmupLanguage({ language: 'en' }), 'en')
assert.equal(getStartupWarmupLanguage({ language: 'es' }), 'es')
assert.equal(getStartupWarmupLanguage({ language: 'pt-BR' }), 'es')

assert.deepEqual(getStartupSeason(new Date('2026-01-15T10:00:00Z')), { season: 'WINTER', year: 2026 })
assert.deepEqual(getStartupSeason(new Date('2026-05-15T10:00:00Z')), { season: 'SPRING', year: 2026 })
assert.deepEqual(getStartupSeason(new Date('2026-08-15T10:00:00Z')), { season: 'SUMMER', year: 2026 })
assert.deepEqual(getStartupSeason(new Date('2026-11-15T10:00:00Z')), { season: 'FALL', year: 2026 })

const plan = buildStartupWarmupPlan({ language: 'en' })
assert.equal(plan.lang, 'en')
assert.ok(plan.blocking.some((task) => task.key === 'home-dashboard'))
assert.ok(plan.blocking.some((task) => task.key === 'anime-home-catalog'))
assert.ok(plan.blocking.some((task) => task.key === 'manga-home-catalog'))
assert.ok(plan.blocking.some((task) => task.key === 'anime-catalog-default'))
assert.ok(plan.blocking.some((task) => task.key === 'manga-catalog-default'))
assert.ok(plan.blocking.some((task) => task.key === 'my-lists-anime-entries'))
assert.ok(plan.blocking.some((task) => task.key === 'my-lists-anime-counts'))
assert.ok(plan.blocking.some((task) => task.key === 'my-lists-manga-entries'))
assert.ok(plan.blocking.some((task) => task.key === 'my-lists-manga-counts'))
assert.ok(plan.blocking.some((task) => task.key === 'remote-sync-status'))
assert.ok(!plan.blocking.some((task) => task.key === 'mpv-status'))
assert.ok(!plan.background.some((task) => task.key === 'home-popular-now'))
assert.ok(!plan.background.some((task) => task.key === 'home-trending-season'))
assert.ok(!plan.background.some((task) => task.key === 'home-top-rated'))
assert.ok(plan.background.some((task) => task.key === 'mpv-status'))
assert.ok(plan.background.some((task) => task.key === 'auth-status'))
assert.ok(!plan.background.some((task) => task.key === 'anime-home-catalog'))
assert.ok(!plan.background.some((task) => task.key === 'manga-home-catalog'))
assert.ok(STARTUP_MIN_VISIBLE_MS >= 5000)
assert.ok(STARTUP_EXIT_MS <= 320)
assert.ok(STARTUP_BACKGROUND_DELAY_MS <= 200)
assert.ok(STARTUP_TASK_TIMEOUT_MS >= 5000)
assert.ok(STARTUP_HOME_MIN_ANIME_SHELVES >= 2)
assert.ok(STARTUP_HOME_MIN_ANIME_RECENT_ITEMS >= 3)
assert.ok(STARTUP_HOME_MIN_MANGA_SHELVES >= 2)
assert.ok(STARTUP_HOME_MIN_MANGA_RECENT_ITEMS >= 3)
assert.ok(STARTUP_REQUIRED_READY_TIMEOUT_MS >= 20000)
assert.ok(STARTUP_REQUIRED_READY_RETRY_MS >= 200)

assert.equal(plan.blocking[0]?.key, 'home-dashboard')
assert.equal(plan.blocking[1]?.key, 'anime-home-catalog')
assert.equal(plan.blocking[2]?.key, 'manga-home-catalog')

const fullSnapshot = buildStartupHomeSnapshot({
  lang: 'en',
  dashboard: {
    continue_watching_online: [{ episode_id: 1, anime_title: 'Keep Going' }],
  },
  animeCatalogHome: {
    featured: [
      { id: 1001, title: { english: 'Hero One' }, bannerImage: 'https://example.com/hero-banner.jpg', status: 'RELEASING', nextAiringEpisode: { episode: 8 } },
    ],
    newlyTrending: Array.from({ length: 6 }, (_, index) => ({
      id: 1100 + index,
      title: { english: `Trending ${index + 1}` },
      coverImage: { large: `https://example.com/trending-${index + 1}.jpg` },
      status: 'RELEASING',
      nextAiringEpisode: { episode: index + 1 },
    })),
    seasonalPopular: Array.from({ length: 6 }, (_, index) => ({
      id: 1200 + index,
      title: { english: `Seasonal ${index + 1}` },
      coverImage: { large: `https://example.com/seasonal-${index + 1}.jpg` },
      status: 'RELEASING',
      nextAiringEpisode: { episode: index + 4 },
    })),
    upcoming: Array.from({ length: 6 }, (_, index) => ({
      id: 1300 + index,
      title: { english: `Upcoming ${index + 1}` },
      coverImage: { large: `https://example.com/upcoming-${index + 1}.jpg` },
      status: 'NOT_YET_RELEASED',
    })),
  },
  mangaCatalogHome: {
    featured: [
      { id: 2001, title: { english: 'Manga Hero' }, banner_url: 'https://example.com/manga-banner.jpg', cover_url: 'https://example.com/manga-cover.jpg' },
    ],
    recent: Array.from({ length: 5 }, (_, index) => ({
      id: 2100 + index,
      title: { english: `Recent Manga ${index + 1}` },
      cover_url: `https://example.com/recent-manga-${index + 1}.jpg`,
      chapter_number: 40 + index,
    })),
    popular: Array.from({ length: 5 }, (_, index) => ({
      id: 2200 + index,
      title: { english: `Popular Manga ${index + 1}` },
      cover_url: `https://example.com/popular-manga-${index + 1}.jpg`,
    })),
  },
})

assert.equal(fullSnapshot.anime.hero?.id, 1001)
assert.equal(fullSnapshot.anime.recent.length, 5)
assert.equal(fullSnapshot.anime.shelves.length, 3)
assert.equal(fullSnapshot.manga.hero?.id, 2001)
assert.equal(fullSnapshot.manga.shelves.length, 3)
assert.equal(getStartupHomeReadiness(fullSnapshot).mode, 'full')
assert.equal(getStartupHomeReadiness(fullSnapshot).ready, true)

const animeFallbackSnapshot = buildStartupHomeSnapshot({
  lang: 'en',
  dashboard: {},
  animeCatalogHome: {
    featured: [{ id: 3001, title: { english: 'Fallback Hero' }, status: 'RELEASING', nextAiringEpisode: { episode: 3 } }],
    newlyTrending: Array.from({ length: 6 }, (_, index) => ({
      id: 3100 + index,
      title: { english: `Fallback Trending ${index + 1}` },
      coverImage: { large: `https://example.com/fallback-trending-${index + 1}.jpg` },
      status: 'RELEASING',
      nextAiringEpisode: { episode: index + 1 },
    })),
    seasonalPopular: Array.from({ length: 6 }, (_, index) => ({
      id: 3200 + index,
      title: { english: `Fallback Seasonal ${index + 1}` },
      coverImage: { large: `https://example.com/fallback-seasonal-${index + 1}.jpg` },
      status: 'RELEASING',
      nextAiringEpisode: { episode: index + 5 },
    })),
    upcoming: Array.from({ length: 6 }, (_, index) => ({
      id: 3300 + index,
      title: { english: `Fallback Upcoming ${index + 1}` },
      coverImage: { large: `https://example.com/fallback-upcoming-${index + 1}.jpg` },
      status: 'NOT_YET_RELEASED',
    })),
  },
  mangaCatalogHome: {},
})

const fallbackReadiness = getStartupHomeReadiness(animeFallbackSnapshot)
assert.equal(fallbackReadiness.mode, 'blocked')
assert.equal(fallbackReadiness.ready, false)
assert.equal(fallbackReadiness.usingFallback, false)
assert.ok(fallbackReadiness.missing.includes('manga-hero'))
assert.ok(fallbackReadiness.missing.includes('manga-recent'))
assert.ok(fallbackReadiness.missing.includes('manga-shelves'))

const blockedSnapshot = buildStartupHomeSnapshot({
  lang: 'en',
  dashboard: {},
  animeCatalogHome: {
    featured: [{ id: 4001, title: { english: 'Blocked Hero' } }],
    newlyTrending: [{ id: 4101, title: { english: 'Only One Shelf Item' } }],
  },
  mangaCatalogHome: {},
})

const blockedReadiness = getStartupHomeReadiness(blockedSnapshot)
assert.equal(blockedReadiness.ready, false)
assert.equal(blockedReadiness.mode, 'blocked')
assert.ok(blockedReadiness.missing.includes('anime-recent'))
assert.ok(blockedReadiness.missing.includes('anime-shelves'))

const mangaCatalogTask = plan.blocking.find((task) => task.key === 'manga-catalog-default')
assert.ok(mangaCatalogTask, 'manga catalog blocking task should exist')
const mangaRunSource = String(mangaCatalogTask.run)
assert.ok(mangaRunSource.includes('normalizeMangaCatalogPage'), 'manga catalog startup task should normalize AniList data before it reaches the route cache')
assert.ok(mangaRunSource.includes('prewarmAniListDetailEntries'), 'manga catalog startup task should immediately seed a small AniList manga detail band for the first landing opens')

assert.deepEqual(
  collectAniListWarmupIDs([
    { id: 101 },
    { anilist_id: 202 },
    { id: 202 },
    { id: 303 },
    { id: 0 },
  ], 2),
  [101, 202],
  'AniList warmup id collection should dedupe ids and keep the earliest stable order',
)

const seededQueryCalls = []
const seededResult = await runStartupWarmupTask(
  {
    queryKey: ['anime-catalog', 'es'],
    run: async () => ({ media: [{ id: 1 }], hasNextPage: true, page: 1 }),
  },
  {
    setQueryData(queryKey, value) {
      seededQueryCalls.push({ queryKey, value })
    },
    prefetchQuery() {
      throw new Error('startup warmup should seed the cache directly instead of opening a live prefetch')
    },
  },
)

assert.deepEqual(seededResult, { media: [{ id: 1 }], hasNextPage: true, page: 1 })
assert.deepEqual(seededQueryCalls, [
  {
    queryKey: ['anime-catalog', 'es'],
    value: { media: [{ id: 1 }], hasNextPage: true, page: 1 },
  },
])

{
  const detailQueryCalls = []
  const warmedIDs = []
  const results = await prewarmAniListDetailEntries(
    [{ id: 401 }, { anilist_id: 402 }, { id: 401 }],
    'en',
    async (id) => {
      warmedIDs.push(id)
      return { anilist_id: id, recommendations: [{ id: id + 1 }] }
    },
    (id, lang) => ['manga-detail-anilist-v3', id, lang],
    {
      setQueryData(queryKey, value) {
        detailQueryCalls.push({ queryKey, value })
      },
    },
    2,
  )

  assert.deepEqual(results, [401, 402], 'detail warmup should return the deduped AniList ids it seeded')
  assert.deepEqual(warmedIDs, [401, 402], 'detail warmup should invoke the loader once per deduped AniList id')
  assert.deepEqual(detailQueryCalls, [
    {
      queryKey: ['manga-detail-anilist-v3', 401, 'en'],
      value: { anilist_id: 401, recommendations: [{ id: 402 }] },
    },
    {
      queryKey: ['manga-detail-anilist-v3', 402, 'en'],
      value: { anilist_id: 402, recommendations: [{ id: 403 }] },
    },
  ], 'detail warmup should seed the matching react-query cache entries for the warmed AniList detail payloads')
}

const queueEvents = []
await runStartupWarmupQueue([
  {
    run: async () => {
      queueEvents.push('start-a')
      await new Promise((resolve) => setTimeout(resolve, 10))
      queueEvents.push('end-a')
    },
  },
  {
    run: async () => {
      queueEvents.push('start-b')
      queueEvents.push('end-b')
    },
  },
], null, 1)

assert.deepEqual(queueEvents, ['start-a', 'end-a', 'start-b', 'end-b'])

{
  const originalMethods = {
    getSettings: wails.getSettings,
    getDashboard: wails.getDashboard,
    getAniListAnimeCatalogHome: wails.getAniListAnimeCatalogHome,
    getAniListMangaCatalogHome: wails.getAniListMangaCatalogHome,
    getAuthStatus: wails.getAuthStatus,
    getLibraryStats: wails.getLibraryStats,
    getLibraryPaths: wails.getLibraryPaths,
    getAnimeImportDir: wails.getAnimeImportDir,
    getRemoteListSyncStatus: wails.getRemoteListSyncStatus,
    isMPVAvailable: wails.isMPVAvailable,
    discoverAnime: wails.discoverAnime,
    discoverManga: wails.discoverManga,
    getAnimeListAll: wails.getAnimeListAll,
    getAniListAnimeByID: wails.getAniListAnimeByID,
    getMangaListAll: wails.getMangaListAll,
    getAniListMangaByID: wails.getAniListMangaByID,
    getWatchHistory: wails.getWatchHistory,
    getAnimeListCounts: wails.getAnimeListCounts,
    getMangaListCounts: wails.getMangaListCounts,
  }

  const queryCalls = []
  const runtimeCalls = []
  const seenStages = []

  try {
    wails.getSettings = async () => ({ language: 'en' })
    wails.getDashboard = async () => {
      runtimeCalls.push('getDashboard')
      return { continue_watching_online: [{ episode_id: 1, anime_title: 'Keep Going' }] }
    }
    wails.getAniListAnimeCatalogHome = async (season, year) => {
      runtimeCalls.push(`getAniListAnimeCatalogHome:${season}:${year}`)
      return {
        featured: [{ id: 5001, title: { english: 'Home Hero' }, status: 'RELEASING', nextAiringEpisode: { episode: 5 } }],
        newlyTrending: Array.from({ length: 6 }, (_, index) => ({
          id: 5100 + index,
          title: { english: `Trending ${index + 1}` },
          status: 'RELEASING',
          nextAiringEpisode: { episode: index + 1 },
        })),
        seasonalPopular: Array.from({ length: 6 }, (_, index) => ({
          id: 5200 + index,
          title: { english: `Popular ${index + 1}` },
          status: 'RELEASING',
          nextAiringEpisode: { episode: index + 4 },
        })),
        upcoming: Array.from({ length: 6 }, (_, index) => ({
          id: 5300 + index,
          title: { english: `Upcoming ${index + 1}` },
          status: 'NOT_YET_RELEASED',
        })),
      }
    }
    wails.getAniListMangaCatalogHome = async (lang) => {
      runtimeCalls.push(`getAniListMangaCatalogHome:${lang}`)
      return {
        featured: [{ id: 6001, title: { english: 'Manga Home Hero' } }],
        recent: Array.from({ length: 4 }, (_, index) => ({
          id: 6100 + index,
          title: { english: `Recent Manga ${index + 1}` },
        })),
      }
    }
    wails.getAnimeListAll = async () => { runtimeCalls.push('getAnimeListAll'); return [{ anilist_id: 9001, title: 'Anime List Item', status: 'WATCHING' }] }
    wails.getAuthStatus = async () => { runtimeCalls.push('getAuthStatus'); return {} }
    wails.getLibraryStats = async () => { runtimeCalls.push('getLibraryStats'); return {} }
    wails.getLibraryPaths = async () => { runtimeCalls.push('getLibraryPaths'); return [] }
    wails.getAnimeImportDir = async () => { runtimeCalls.push('getAnimeImportDir'); return '' }
    wails.getRemoteListSyncStatus = async () => { runtimeCalls.push('getRemoteListSyncStatus'); return {} }
    wails.isMPVAvailable = async () => { runtimeCalls.push('isMPVAvailable'); return true }
    wails.discoverAnime = async () => {
      runtimeCalls.push('discoverAnime')
      return { data: { Page: { media: [{ id: 7001 }], pageInfo: { hasNextPage: false, currentPage: 1 } } } }
    }
    wails.discoverManga = async () => {
      runtimeCalls.push('discoverManga')
      return { data: { Page: { media: [{ id: 8001, title: { english: 'Catalog Manga' } }], pageInfo: { hasNextPage: false, currentPage: 1 } } } }
    }
    wails.getAniListAnimeByID = async (id) => { runtimeCalls.push(`getAniListAnimeByID:${id}`); return { id } }
    wails.getMangaListAll = async () => { runtimeCalls.push('getMangaListAll'); return [{ anilist_id: 9101, title: 'Manga List Item', status: 'WATCHING' }] }
    wails.getAniListMangaByID = async (id) => { runtimeCalls.push(`getAniListMangaByID:${id}`); return { id } }
    wails.getWatchHistory = async () => { runtimeCalls.push('getWatchHistory'); return [] }
    wails.getAnimeListCounts = async () => { runtimeCalls.push('getAnimeListCounts'); return {} }
    wails.getMangaListCounts = async () => { runtimeCalls.push('getMangaListCounts'); return {} }

    const warmPlan = buildStartupWarmupPlan({ language: 'en' })
    const warmup = await runStartupWarmup({
      setQueryData(queryKey, value) {
        queryCalls.push({ queryKey, value })
      },
    }, {
      onStageChange(stage) {
        seenStages.push(stage)
      },
    })

    assert.equal(warmup.homeReady, true)
    assert.equal(warmup.blockingReady, true)
    assert.equal(warmup.ready, true)
    assert.equal(warmup.homeReadiness.mode, 'full')
    assert.deepEqual(seenStages.slice(0, 4), [
      BOOT_STAGE_PREPARING_HOME,
      BOOT_STAGE_HYDRATING_ANIME,
      BOOT_STAGE_HYDRATING_MANGA,
      BOOT_STAGE_FINAL_REVEAL,
    ])
    assert.deepEqual(
      queryCalls.map((entry) => JSON.stringify(entry.queryKey)).sort(),
      [
        ['gui2-home-dashboard'],
        ['gui2-my-lists-anime-entries'],
        ['gui2-my-lists-anime-counts'],
        ['gui2-my-lists-manga-entries'],
        ['gui2-my-lists-manga-counts'],
        ['gui2-remote-sync-status'],
        ['gui2-home-anilist', 'en', warmPlan.season, warmPlan.year],
        ['anime-catalog', 'en', 'TRENDING_DESC', '', '', 0, 1, '', ''],
        ['anime-detail-anilist-v3', 7001, 'en'],
        ['gui2-home-manga-catalog', 'en'],
        ['manga-catalog', 'en', 'TRENDING_DESC', '', 0, 1, '', ''],
        ['manga-detail-anilist-v3', 8001, 'en'],
        ['gui2-home-startup-snapshot', 'en', warmPlan.season, warmPlan.year],
        ['gui2-home-startup-readiness', 'en', warmPlan.season, warmPlan.year],
      ].map((queryKey) => JSON.stringify(queryKey)).sort(),
      'runStartupWarmup should seed the full blocking startup contract before the app shell mounts',
    )
    assert.ok(runtimeCalls.includes('getDashboard'))
    assert.ok(runtimeCalls.includes('getAnimeListAll'))
    assert.ok(runtimeCalls.includes('getAnimeListCounts'))
    assert.ok(runtimeCalls.includes('getMangaListAll'))
    assert.ok(runtimeCalls.includes('getMangaListCounts'))
    assert.ok(runtimeCalls.includes('getRemoteListSyncStatus'))
    assert.ok(runtimeCalls.includes(`getAniListAnimeCatalogHome:${warmPlan.season}:${warmPlan.year}`))
    assert.ok(runtimeCalls.includes('getAniListMangaCatalogHome:en'))
    assert.ok(runtimeCalls.includes('discoverAnime'))
    assert.ok(runtimeCalls.includes('discoverManga'))
    assert.ok(!runtimeCalls.includes('getAuthStatus'))
    assert.ok(!runtimeCalls.includes('isMPVAvailable'))

    await warmup.startBackground()

    assert.ok(runtimeCalls.includes('getAuthStatus'))
    assert.ok(runtimeCalls.includes('isMPVAvailable'))
    assert.ok(runtimeCalls.includes('discoverAnime'))
    assert.ok(runtimeCalls.includes('discoverManga'))
  } finally {
    Object.assign(wails, originalMethods)
  }
}

console.log('startup warmup tests passed')
