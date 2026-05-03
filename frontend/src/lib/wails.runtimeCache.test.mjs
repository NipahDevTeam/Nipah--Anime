import assert from 'node:assert/strict'

import {
  __clearRuntimeWarmCache,
  rememberRuntimeCache,
  shouldCacheDirectMangaChapterList,
  shouldCacheMangaSourceMatchList,
  shouldCacheResolvedMangaSource,
  shouldCacheResolvedMangaChapters,
} from './wails.js'

async function run() {
  __clearRuntimeWarmCache()
  let partialCalls = 0
  const partialLoader = async () => {
    partialCalls += 1
    return { source: { status: 'ready' }, chapters: [{ id: '1' }], partial: true, hydrating: true }
  }

  await rememberRuntimeCache(['partial-chapters'], 60_000, partialLoader, { shouldCache: shouldCacheResolvedMangaChapters })
  await rememberRuntimeCache(['partial-chapters'], 60_000, partialLoader, { shouldCache: shouldCacheResolvedMangaChapters })
  assert.equal(partialCalls, 2, 'partial chapter payloads should not be cached in the runtime bridge')

  __clearRuntimeWarmCache()
  let unresolvedCalls = 0
  const unresolvedLoader = async () => {
    unresolvedCalls += 1
    return { source_id: 'm440-es', status: 'not_found' }
  }

  await rememberRuntimeCache(['resolve-miss'], 60_000, unresolvedLoader, { shouldCache: shouldCacheResolvedMangaSource })
  await rememberRuntimeCache(['resolve-miss'], 60_000, unresolvedLoader, { shouldCache: shouldCacheResolvedMangaSource })
  assert.equal(unresolvedCalls, 2, 'unresolved source matches should not be cached in the runtime bridge')

  __clearRuntimeWarmCache()
  let readyCalls = 0
  const readyLoader = async () => {
    readyCalls += 1
    return [{ source_id: 'm440-es', status: 'ready' }, { source_id: 'weebcentral-en', status: 'ready' }]
  }

  await rememberRuntimeCache(['source-match-list'], 60_000, readyLoader, { shouldCache: shouldCacheMangaSourceMatchList })
  await rememberRuntimeCache(['source-match-list'], 60_000, readyLoader, { shouldCache: shouldCacheMangaSourceMatchList })
  assert.equal(readyCalls, 1, 'fully ready source-match payloads should still be cached')

  assert.equal(shouldCacheDirectMangaChapterList('m440-es'), true, 'rebuilt manga sources should use direct chapter runtime caching')
  assert.equal(shouldCacheDirectMangaChapterList('senshimanga-es'), true, 'stable chapter sources should still use direct runtime caching')
}

run()
