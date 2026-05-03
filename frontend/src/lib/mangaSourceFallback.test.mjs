import assert from 'node:assert/strict'

import { getCachedMangaChapters, __resetMangaChapterCacheForTests } from './mangaSourceFallback.js'

async function run() {
  __resetMangaChapterCacheForTests()
  let stableCalls = 0
  const stableLoader = async () => {
    stableCalls += 1
    return [{ id: '/manga/the-knight-who-only-lives-today/1', number: 1 }]
  }

  const managedFirst = await getCachedMangaChapters('m440-es', 'the-knight-who-only-lives-today', 'es', stableLoader)
  const managedSecond = await getCachedMangaChapters('m440-es', 'the-knight-who-only-lives-today', 'es', stableLoader)

  assert.equal(stableCalls, 1, 'rebuilt manga sources should now benefit from the frontend chapter cache')
  assert.deepEqual(managedFirst, managedSecond, 'rebuilt manga sources should reuse the cached full chapter list')

  __resetMangaChapterCacheForTests()
  let staticCalls = 0
  const staticLoader = async () => {
    staticCalls += 1
    return [{ id: '/manga/stable-source/1', number: 1 }]
  }

  const stableFirst = await getCachedMangaChapters('senshimanga-es', 'stable-source', 'es', staticLoader)
  const stableSecond = await getCachedMangaChapters('senshimanga-es', 'stable-source', 'es', staticLoader)

  assert.equal(staticCalls, 1, 'static sources should still benefit from the frontend chapter cache')
  assert.deepEqual(stableFirst, stableSecond, 'stable sources should reuse the cached chapter list')
}

run()
