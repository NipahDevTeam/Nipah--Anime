import assert from 'node:assert/strict'
import { extractAniListAnimeSearchMedia } from './anilistSearch.js'

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

console.log('anilist search helpers tests passed')
