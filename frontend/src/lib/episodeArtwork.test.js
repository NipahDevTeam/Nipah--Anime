import assert from 'node:assert/strict'
import {
  __clearPersistedEpisodeArtworkCacheForTests,
  enrichEpisodesWithAnimePaheArtwork,
  getEpisodeThumbnailCoverage,
  hasZeroThumbnailCoverage,
  mergeEpisodeArtworkByNumber,
} from './episodeArtwork.js'
import { pickEpisodeArtwork } from './episodeArtworkPriority.js'

global.window = {
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, value) {
      this.store.set(key, String(value))
    },
    removeItem(key) {
      this.store.delete(key)
    },
  },
}

__clearPersistedEpisodeArtworkCacheForTests()

const merged = mergeEpisodeArtworkByNumber(
  [{ number: 1, title: 'Episode 1' }, { number: 2, title: 'Episode 2' }],
  [{ number: 1, thumbnail: 'https://cdn.example.com/1.jpg' }],
)

assert.equal(merged[0].thumbnail, 'https://cdn.example.com/1.jpg')
assert.equal(merged[1].thumbnail, undefined)

const preservesExisting = mergeEpisodeArtworkByNumber(
  [{ number: 1, title: 'Episode 1', thumbnail: 'https://already.local/1.jpg' }],
  [{ number: 1, thumbnail: 'https://cdn.example.com/1.jpg' }],
)

assert.equal(preservesExisting[0].thumbnail, 'https://already.local/1.jpg')

const zeroCoverage = getEpisodeThumbnailCoverage(
  [{ number: 1, title: 'Episode 1' }, { number: 2, title: 'Episode 2' }],
)
assert.equal(zeroCoverage.total, 2)
assert.equal(zeroCoverage.withThumbnail, 0)
assert.equal(hasZeroThumbnailCoverage([{ number: 1 }, { number: 2 }]), true)
assert.equal(hasZeroThumbnailCoverage([{ number: 1, thumbnail: 'https://cdn.example.com/1.jpg' }]), false)

assert.equal(
  pickEpisodeArtwork({
    providerThumbnail: 'https://provider/ep1.jpg',
    cachedThumbnail: 'file:///thumbs/ep1.webp',
    fallbackArtwork: 'https://fallback/ep1.jpg',
  }),
  'https://provider/ep1.jpg',
)

let resolveCalls = 0
let donorEpisodeCalls = 0

const anime = { anilist_id: 100, title: 'Demo Anime' }
const episodes = [{ number: 1, title: 'Episode 1' }, { number: 2, title: 'Episode 2' }]
const api = {
  async searchOnline(query, sourceID) {
    resolveCalls += 1
    if (sourceID === 'animepahe-en') {
      return [{
        id: 'animepahe-demo',
        source_id: 'animepahe-en',
        title: 'Demo Anime',
        anime_title: 'Demo Anime',
        title_english: 'Demo Anime',
      }]
    }
    return []
  },
  async searchAniList() {
    return {
      data: {
        Page: {
          media: [{
            id: 100,
            title: { romaji: 'Demo Anime', english: 'Demo Anime' },
            episodes: 2,
            streamingEpisodes: [],
          }],
        },
      },
    }
  },
  async getOnlineEpisodes(sourceID, animeID) {
    donorEpisodeCalls += 1
    assert.equal(sourceID, 'animepahe-en')
    assert.equal(animeID, 'animepahe-demo')
    return [{ number: 1, thumbnail: 'https://cdn.example.com/donor-1.jpg' }]
  },
}

const firstEnriched = await enrichEpisodesWithAnimePaheArtwork(anime, episodes, api, 'en')
assert.equal(firstEnriched[0].thumbnail, 'https://cdn.example.com/donor-1.jpg')
assert.equal(resolveCalls > 0, true)
assert.equal(donorEpisodeCalls, 2)

resolveCalls = 0
donorEpisodeCalls = 0

const secondEnriched = await enrichEpisodesWithAnimePaheArtwork(anime, episodes, api, 'en')
assert.equal(secondEnriched[0].thumbnail, 'https://cdn.example.com/donor-1.jpg')
assert.equal(resolveCalls, 0)
assert.equal(donorEpisodeCalls, 0)

console.log('episode artwork tests passed')
