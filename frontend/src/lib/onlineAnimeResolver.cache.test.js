import assert from 'node:assert/strict'

import { resolveAniListToJKAnime } from './onlineAnimeResolver.js'

function buildEpisodes(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    number: index + 1,
    title: `Episode ${index + 1}`,
  }))
}

const sequelMedia = {
  title: {
    english: 'The Angel Next Door Spoils Me Rotten 2',
    romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season',
  },
  title_english: 'The Angel Next Door Spoils Me Rotten 2',
  title_romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season',
  synonyms: [
    'The Angel Next Door Spoils Me Rotten Season 2',
    'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season',
  ],
  episodes: 12,
  seasonYear: 2026,
}

const healthySearch = new Map([
  ['The Angel Next Door Spoils Me Rotten 2', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['The Angel Next Door Spoils Me Rotten 2 Healthy', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season Healthy', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['The Angel Next Door Spoils Me Rotten Season 2', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['The Angel Next Door Spoils Me Rotten Healthy Season 2', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['The Angel Next Door Spoils Me Rotten', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['The Angel Next Door Spoils Me Rotten Healthy', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken Season 2', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken Healthy Season 2', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
  ['Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken Healthy', [{ id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' }]],
])

{
  const counters = new Map()
  const api = {
    episodeProbeTimeoutMs: 12_000,
    async searchOnline(title, sourceID) {
      const key = `${sourceID}:${title}`
      const count = (counters.get(key) ?? 0) + 1
      counters.set(key, count)
      if (count === 1) return []
      return (healthySearch.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      if (animeID === 'angel-s2') return buildEpisodes(6, 'angel-s2')
      return []
    },
  }

  const first = await resolveAniListToJKAnime(sequelMedia, api, 'animepahe-en', 'en')
  const second = await resolveAniListToJKAnime(sequelMedia, api, 'animepahe-en', 'en')

  assert.equal(first.hit, null, 'first resolve should fail under the transient-empty AnimePahe fixture')
  assert.equal(
    second?.hit?.title ?? null,
    'The Angel Next Door Spoils Me Rotten 2',
    `second resolve should recover after the transient empty search, got ${JSON.stringify(second)}`,
  )
}

{
  const counters = new Map()
  const api = {
    episodeProbeTimeoutMs: 12_000,
    async searchOnline(title, sourceID) {
      const key = `${sourceID}:${title}`
      counters.set(key, (counters.get(key) ?? 0) + 1)
      return (healthySearch.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      if (animeID === 'angel-s2') return buildEpisodes(6, 'angel-s2')
      return []
    },
  }

  await resolveAniListToJKAnime({
    ...sequelMedia,
    title_english: 'The Angel Next Door Spoils Me Rotten 2 Healthy',
    title_romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season Healthy',
    title: {
      ...sequelMedia.title,
      english: 'The Angel Next Door Spoils Me Rotten 2 Healthy',
      romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season Healthy',
    },
    synonyms: [
      'The Angel Next Door Spoils Me Rotten Healthy Season 2',
      'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken Healthy 2nd Season',
    ],
  }, api, 'animepahe-en', 'en')

  await resolveAniListToJKAnime({
    ...sequelMedia,
    title_english: 'The Angel Next Door Spoils Me Rotten 2 Healthy',
    title_romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season Healthy',
    title: {
      ...sequelMedia.title,
      english: 'The Angel Next Door Spoils Me Rotten 2 Healthy',
      romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season Healthy',
    },
    synonyms: [
      'The Angel Next Door Spoils Me Rotten Healthy Season 2',
      'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken Healthy 2nd Season',
    ],
  }, api, 'animepahe-en', 'en')

  assert.equal(
    counters.get('animepahe-en:The Angel Next Door Spoils Me Rotten 2 Healthy'),
    1,
    'healthy AnimePahe search hits should still be cached',
  )
}

console.log('animepahe cache resilience tests passed')
