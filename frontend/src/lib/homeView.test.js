import assert from 'node:assert/strict'
import { buildHomeCommandDeckData } from './homeView.js'

const animeDeck = buildHomeCommandDeckData({
  homeTab: 'anime',
  isEnglish: true,
  heroSlides: [{ id: 1 }, { id: 2 }],
  primaryAnimeRows: [{ key: 'trending' }],
  genreAnimeRows: [{ key: 'romance' }, { key: 'action' }],
  continueTrackedAnime: [{ id: 11 }],
  plannedAnime: [{ id: 21 }],
  onHoldAnime: [{ id: 31 }, { id: 41 }],
})

assert.equal(animeDeck.actions[0].href, '/search')
assert.equal(animeDeck.metrics[0].value, 2)
assert.equal(animeDeck.metrics[2].value, 3)
assert.equal(animeDeck.metrics[3].value, 3)

const mangaDeck = buildHomeCommandDeckData({
  homeTab: 'manga',
  isEnglish: false,
  continueReadingCards: [{ key: 1 }, { key: 2 }],
  planningCards: [{ key: 3 }],
  recommendationCards: [{ key: 4 }, { key: 5 }, { key: 6 }],
  loadingMangaTab: true,
})

assert.equal(mangaDeck.actions[0].href, '/manga-online')
assert.equal(mangaDeck.metrics[0].value, 2)
assert.equal(mangaDeck.metrics[2].detail, 'cargando estantes')

console.log('homeView tests passed')
