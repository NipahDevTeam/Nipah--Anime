import assert from 'node:assert/strict'
import { mirrorLocaleQueryCache } from './localeQueryCache.js'

const cacheEntries = new Map()

function keyOf(queryKey) {
  return JSON.stringify(queryKey)
}

const queryClient = {
  getQueryCache() {
    return {
      findAll() {
        return [
          {
            queryKey: ['anime-catalog', 'en', 'TRENDING_DESC', '', '', 0, 1, '', ''],
            state: { data: { media: [{ id: 1 }], hasNextPage: true, page: 1 } },
          },
          {
            queryKey: ['manga-catalog', 'en', 'TRENDING_DESC', '', 0, 1, '', ''],
            state: { data: { media: [{ id: 2 }], hasNextPage: true, page: 1 } },
          },
          {
            queryKey: ['gui2-home-featured-rows', 'en'],
            state: { data: [{ id: 'featured' }] },
          },
          {
            queryKey: ['gui2-home-dashboard'],
            state: { data: { stats: 1 } },
          },
          {
            queryKey: ['anime-catalog', 'es', 'TRENDING_DESC', '', '', 0, 1, '', ''],
            state: { data: { media: [{ id: 99 }], hasNextPage: false, page: 1 } },
          },
        ]
      },
    }
  },
  getQueryData(queryKey) {
    return cacheEntries.get(keyOf(queryKey))
  },
  setQueryData(queryKey, value) {
    cacheEntries.set(keyOf(queryKey), value)
  },
}

cacheEntries.set(
  keyOf(['anime-catalog', 'es', 'TRENDING_DESC', '', '', 0, 1, '', '']),
  { media: [{ id: 99 }], hasNextPage: false, page: 1 },
)

const mirroredCount = mirrorLocaleQueryCache(queryClient, 'en', 'es')

assert.equal(mirroredCount, 2)
assert.deepEqual(
  cacheEntries.get(keyOf(['anime-catalog', 'es', 'TRENDING_DESC', '', '', 0, 1, '', ''])),
  { media: [{ id: 99 }], hasNextPage: false, page: 1 },
  'existing locale cache entries should not be overwritten',
)
assert.deepEqual(
  cacheEntries.get(keyOf(['manga-catalog', 'es', 'TRENDING_DESC', '', 0, 1, '', ''])),
  { media: [{ id: 2 }], hasNextPage: true, page: 1 },
)
assert.deepEqual(
  cacheEntries.get(keyOf(['gui2-home-featured-rows', 'es'])),
  [{ id: 'featured' }],
)
assert.equal(
  cacheEntries.has(keyOf(['gui2-home-dashboard', 'es'])),
  false,
  'non-locale dashboard data should not be mirrored',
)

console.log('i18n cache mirroring tests passed')
