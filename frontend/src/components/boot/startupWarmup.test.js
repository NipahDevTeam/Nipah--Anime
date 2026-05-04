import assert from 'node:assert/strict'
import {
  STARTUP_BACKGROUND_DELAY_MS,
  STARTUP_EXIT_MS,
  STARTUP_TASK_TIMEOUT_MS,
  STARTUP_MIN_VISIBLE_MS,
  buildStartupWarmupPlan,
  getStartupSeason,
  getStartupWarmupLanguage,
  runStartupWarmupQueue,
  runStartupWarmupTask,
} from './startupWarmup.js'

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
assert.ok(plan.blocking.some((task) => task.key === 'mpv-status'))
assert.ok(plan.blocking.some((task) => task.key === 'home-anilist'))
assert.ok(plan.blocking.find((task) => task.key === 'home-anilist')?.timeoutMs >= 9000)
assert.ok(!plan.blocking.some((task) => task.key === 'anime-catalog-default'))
assert.ok(!plan.blocking.some((task) => task.key === 'manga-catalog-default'))
assert.ok(!plan.background.some((task) => task.key === 'home-popular-now'))
assert.ok(!plan.background.some((task) => task.key === 'home-trending-season'))
assert.ok(!plan.background.some((task) => task.key === 'home-top-rated'))
assert.ok(plan.background.some((task) => task.key === 'anime-catalog-default'))
assert.ok(plan.background.some((task) => task.key === 'manga-catalog-default'))
assert.ok(plan.background.some((task) => task.key === 'anime-list-counts'))
assert.ok(plan.background.some((task) => task.key === 'manga-list-counts'))
assert.ok(plan.background.some((task) => task.key === 'manga-catalog-home'))
assert.ok(!plan.background.some((task) => task.key === 'anime-detail-seed'))
assert.ok(!plan.background.some((task) => task.key === 'manga-detail-seed'))
assert.ok(STARTUP_MIN_VISIBLE_MS <= 1500)
assert.ok(STARTUP_EXIT_MS <= 320)
assert.ok(STARTUP_BACKGROUND_DELAY_MS <= 800)
assert.ok(STARTUP_TASK_TIMEOUT_MS <= 3000)

const mangaCatalogTask = plan.background.find((task) => task.key === 'manga-catalog-default')
assert.ok(mangaCatalogTask, 'manga catalog warmup task should exist')
const mangaRunSource = String(mangaCatalogTask.run)
assert.ok(mangaRunSource.includes('normalizeMangaCatalogPage'), 'manga catalog warmup should normalize AniList data before it reaches the route cache')

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

console.log('startup warmup tests passed')
