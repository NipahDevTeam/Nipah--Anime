import assert from 'node:assert/strict'
import { pickEpisodeArtwork } from './episodeArtworkPriority.js'

assert.equal(
  pickEpisodeArtwork({
    providerThumbnail: 'https://cdn.provider/ep7.jpg',
    anilistThumbnail: 'https://cdn.anilist/ep7.jpg',
    cachedThumbnail: 'file:///thumbs/ep7.webp',
    fallbackArtwork: 'https://cdn.banner/fallback.jpg',
  }),
  'https://cdn.provider/ep7.jpg',
)

assert.equal(
  pickEpisodeArtwork({
    providerThumbnail: '',
    anilistThumbnail: '',
    cachedThumbnail: 'file:///thumbs/ep7.webp',
    fallbackArtwork: 'https://cdn.banner/fallback.jpg',
  }),
  'file:///thumbs/ep7.webp',
)

assert.equal(
  pickEpisodeArtwork({
    providerThumbnail: '',
    anilistThumbnail: '',
    cachedThumbnail: '',
    fallbackArtwork: 'https://cdn.banner/fallback.jpg',
  }),
  'https://cdn.banner/fallback.jpg',
)

console.log('episode artwork priority tests passed')
