import assert from 'node:assert/strict'
import {
  buildAnimeNavigationState,
  buildAnimeListNavigationState,
  buildPendingAniListSelectedAnime,
  buildMangaListNavigationState,
  getInitialSelectedAnimePayload,
  normalizeSelectedAnimePayload,
} from './mediaNavigation.js'

const rawAniListMedia = {
  id: 7011,
  title: {
    english: 'Neon Requiem',
    romaji: 'Neon Requiem',
    native: 'ネオンレクイエム',
  },
  coverImage: {
    large: 'https://example.com/neon-large.jpg',
  },
}

const normalizedHomePayload = normalizeSelectedAnimePayload(rawAniListMedia, 'animeav1-es')
assert.equal(normalizedHomePayload.source_id, 'animeav1-es')
assert.equal(normalizedHomePayload.id, 7011)
assert.equal(normalizedHomePayload.anime_id, 7011)
assert.equal(normalizedHomePayload.title, 'Neon Requiem')
assert.equal(normalizedHomePayload.anime_title, 'Neon Requiem')

const initialSelectedPayload = getInitialSelectedAnimePayload({
  selectedAnime: rawAniListMedia,
}, 'animeav1-es')

assert.equal(initialSelectedPayload.source_id, 'animeav1-es')
assert.equal(initialSelectedPayload.title, 'Neon Requiem')
assert.equal(initialSelectedPayload.anime_title, 'Neon Requiem')

const homePosterNavigationState = buildAnimeNavigationState(rawAniListMedia, 'animeav1-es')
assert.equal(homePosterNavigationState.seedAniListMedia.id, 7011)
assert.equal(homePosterNavigationState.preferredAnilistID, 7011)
assert.ok(!('selectedAnime' in homePosterNavigationState))

const pendingHomeShell = buildPendingAniListSelectedAnime(rawAniListMedia, 'animeheaven-en')
assert.equal(pendingHomeShell.pending_resolve, true)
assert.equal(pendingHomeShell.source_id, 'animeheaven-en')
assert.equal(pendingHomeShell.id, 0)
assert.equal(pendingHomeShell.anime_id, 0)
assert.equal(pendingHomeShell.anilist_id, 7011)
assert.equal(pendingHomeShell.title, 'Neon Requiem')

const initialPendingSeedPayload = getInitialSelectedAnimePayload({
  seedAniListMedia: rawAniListMedia,
}, 'animeheaven-en')
assert.equal(initialPendingSeedPayload.pending_resolve, true)
assert.equal(initialPendingSeedPayload.source_id, 'animeheaven-en')
assert.equal(initialPendingSeedPayload.anilist_id, 7011)
assert.equal(initialPendingSeedPayload.title, 'Neon Requiem')

const resolvedHomeState = buildAnimeNavigationState({
  id: 'jk-neon',
  anime_id: 'jk-neon',
  anilist_id: 7011,
  source_id: 'animeav1-es',
  anime_title: 'Neon Requiem',
}, 'animeav1-es')
assert.equal(resolvedHomeState.preferredAnilistID, 7011)
assert.equal(resolvedHomeState.selectedAnime.source_id, 'animeav1-es')
assert.equal(resolvedHomeState.selectedAnime.id, 'jk-neon')

const continueWatchingPayload = normalizeSelectedAnimePayload({
  id: 44,
  anime_id: 'series-44',
  anilist_id: 7011,
  source_id: 'animeheaven-en',
  anime_title: 'Neon Requiem',
}, 'animeheaven-en')

assert.equal(continueWatchingPayload.id, 'series-44')
assert.equal(continueWatchingPayload.anime_id, 'series-44')

const animeListState = buildAnimeListNavigationState({
  id: 42,
  anilist_id: 7011,
  title: 'Neon Requiem',
  title_english: 'Neon Requiem',
})
assert.equal(animeListState.seedAniListMedia.id, 7011)
assert.equal(animeListState.seedAniListMedia.title.english, 'Neon Requiem')
assert.equal(animeListState.seedAniListMedia.anime_title, 'Neon Requiem')
assert.equal(animeListState.seedAniListMedia.title_english, 'Neon Requiem')
assert.equal(animeListState.preferredAnilistID, 7011)
assert.ok(!('preSearch' in animeListState))

const aliasHeavyListState = buildAnimeListNavigationState({
  anilist_id: 44567,
  title: 'OtaGal',
  title_english: "Gals Can't Be Kind to Otaku",
  title_romaji: 'Otaku ni Yasashii Gal',
})
assert.equal(aliasHeavyListState.seedAniListMedia.title.english, "Gals Can't Be Kind to Otaku")
assert.equal(aliasHeavyListState.seedAniListMedia.anime_title, "Gals Can't Be Kind to Otaku")
assert.equal(aliasHeavyListState.seedAniListMedia.title_english, "Gals Can't Be Kind to Otaku")
assert.equal(aliasHeavyListState.seedAniListMedia.title_romaji, 'Otaku ni Yasashii Gal')

const mangaListState = buildMangaListNavigationState({
  anilist_id: 9001,
  title: 'Inkbound Reverie',
  title_english: 'Inkbound Reverie',
  title_romaji: 'Inkbound Reverie',
  cover_image: 'https://example.com/inkbound.jpg',
  banner_image: 'https://example.com/inkbound-banner.jpg',
  year: 2026,
  chapters_total: 48,
  chapters_read: 12,
  format: 'MANGA',
  status: 'RELEASING',
})

assert.equal(mangaListState.preferredAnilistID, 9001)
assert.equal(mangaListState.preSearch, 'Inkbound Reverie')
assert.ok(Array.isArray(mangaListState.searchCandidates))
assert.ok(mangaListState.searchCandidates.includes('Inkbound Reverie'))
assert.equal(mangaListState.seedItem.anilist_id, 9001)
assert.equal(mangaListState.seedItem.canonical_title, 'Inkbound Reverie')
assert.equal(mangaListState.seedItem.resolved_cover_url, 'https://example.com/inkbound.jpg')

console.log('media navigation tests passed')
