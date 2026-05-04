import assert from 'node:assert/strict'
import {
  buildAniListAnimeSearchCandidates,
  buildAniListAnimeSearchResults,
  extractAniListAnimeSearchMedia,
  prewarmAniListAnimeDetails,
  searchAniListAnimeWithFallback,
} from './anilistSearch.js'

const graphQlPayload = {
  data: {
    Page: {
      media: [
        {
          id: 154587,
          title: {
            romaji: 'Sousou no Frieren',
            english: 'Frieren: Beyond Journey’s End',
            native: '葬送のフリーレン',
          },
        },
      ],
    },
  },
}

assert.deepEqual(
  extractAniListAnimeSearchMedia(graphQlPayload).map((item) => item.id),
  [154587],
  'AniList anime search extraction should read media from the GraphQL data.Page.media payload',
)

assert.deepEqual(
  extractAniListAnimeSearchMedia([{ id: 42 }, { id: 77 }]).map((item) => item.id),
  [42, 77],
  'AniList anime search extraction should also accept a plain media array for defensive compatibility',
)

assert.deepEqual(
  extractAniListAnimeSearchMedia({ Page: { media: [{ id: 11 }] } }).map((item) => item.id),
  [11],
  'AniList anime search extraction should tolerate a partially unwrapped Page.media payload',
)

assert.deepEqual(
  extractAniListAnimeSearchMedia(null),
  [],
  'AniList anime search extraction should return an empty array for missing payloads',
)

const sequelPayload = {
  data: {
    Page: {
      media: Array.from({ length: 11 }, (_, index) => ({
        id: index + 1,
        title: {
          english: index === 10 ? 'Re:ZERO -Starting Life in Another World- Season 2 Part 2' : `Result ${index + 1}`,
          romaji: index === 10 ? 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season Part 2' : `Result ${index + 1}`,
        },
      })),
    },
  },
}

assert.deepEqual(
  buildAniListAnimeSearchResults(sequelPayload).map((item) => item.id).slice(-1),
  [11],
  'AniList anime search shaping should keep sequel and part entries that fall just beyond the first ten raw matches',
)

assert.equal(
  buildAniListAnimeSearchResults({
    data: {
      Page: {
        media: [
          { id: 7, title: { english: 'Duplicate' } },
          { id: 7, title: { english: 'Duplicate Again' } },
          { id: 8, title: { english: 'Unique' } },
        ],
      },
    },
  }).length,
  2,
  'AniList anime search shaping should still deduplicate repeated AniList ids before returning UI results',
)

assert.deepEqual(
  buildAniListAnimeSearchCandidates('Frieren: Beyond Journey\'s End'),
  ['Frieren: Beyond Journeys End', 'Frieren'],
  'AniList anime search candidates should expand a title into bounded alias-friendly variants',
)

{
  const attempts = []
  const result = await searchAniListAnimeWithFallback('Frieren: Beyond Journey\'s End', async (candidate) => {
    attempts.push(candidate)
    if (candidate === 'Frieren') {
      return {
        data: {
          Page: {
            media: [{ id: 1, title: { english: 'Frieren: Beyond Journey\'s End' } }],
          },
        },
      }
    }
    return { data: { Page: { media: [] } } }
  }, { minResults: 1 })

  assert.deepEqual(
    attempts,
    ['Frieren: Beyond Journeys End', 'Frieren'],
    'AniList anime search fallback should stop once an alias variant produces enough results',
  )
  assert.deepEqual(
    result.results.map((item) => item.id),
    [1],
    'AniList anime search fallback should return the deduped merged result set',
  )
}

{
  const attempts = []
  await searchAniListAnimeWithFallback('Re:Zero', async (candidate) => {
    attempts.push(candidate)
    return {
      data: {
        Page: {
          media: Array.from({ length: 8 }, (_, index) => ({ id: index + 1, title: { english: `Result ${index + 1}` } })),
        },
      },
    }
  })

  assert.deepEqual(
    attempts,
    ['Re:Zero'],
    'AniList anime search fallback should avoid extra requests when the first AniList query already returns a healthy result set',
  )
}

{
  const result = await searchAniListAnimeWithFallback('Frieren: Beyond Journey\'s End', async (candidate) => {
    if (candidate === 'Frieren: Beyond Journeys End') {
      return {
        data: {
          Page: {
            media: [{ id: 21, title: { english: 'Frieren: Beyond Journey\'s End' } }],
          },
        },
      }
    }
    throw new Error('metadata request failed: 429')
  }, { minResults: 6 })

  assert.deepEqual(
    result.results.map((item) => item.id),
    [21],
    'AniList anime search fallback should keep the best successful results when a later alias attempt fails under load',
  )
}

{
  const warmed = []
  const ids = await prewarmAniListAnimeDetails({
    data: {
      Page: {
        media: [
          { id: 1001 },
          { id: 1002 },
          { id: 1002 },
          { id: 1003 },
        ],
      },
    },
  }, async (id) => {
    warmed.push(id)
  }, 2)

  assert.deepEqual(
    ids,
    [1001, 1002],
    'AniList anime detail warmup should only schedule unique ids up to the configured limit',
  )
  assert.deepEqual(
    warmed,
    [1001, 1002],
    'AniList anime detail warmup should invoke the loader for the deduped id list in order',
  )
}

console.log('anilist search helpers tests passed')
