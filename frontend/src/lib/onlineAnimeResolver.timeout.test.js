import assert from 'node:assert/strict'

import { resolveAniListToJKAnime } from './onlineAnimeResolver.js'

{
  const media = {
    title_english: 'The Angel Next Door Spoils Me Rotten 2',
    title_romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season',
    title_native: 'お隣の天使様にいつの間にか駄目人間にされていた件 第2期',
    synonyms: [
      'The Angel Next Door Spoils Me Rotten Season 2',
      'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken Season 2',
    ],
    episodes: 12,
    seasonYear: 2026,
  }

  let searchCalls = 0
  const api = {
    searchProbeTimeoutMs: 20,
    async searchOnline() {
      searchCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 45))
      return []
    },
    async getOnlineEpisodes() {
      return []
    },
  }

  const startedAt = Date.now()
  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')
  const elapsedMs = Date.now() - startedAt

  assert.equal(resolved.hit, null, `expected AnimePahe timeout budget to fail cleanly, got ${JSON.stringify(resolved)}`)
  assert.ok(
    elapsedMs < 80,
    `AnimePahe should stop a doomed title search near the first timeout budget instead of exhausting all sequel candidates. Took ${elapsedMs}ms.`,
  )
  assert.ok(
    searchCalls <= 2,
    `AnimePahe should not fan out through the full sequel candidate list after repeated search timeouts. Search calls: ${searchCalls}.`,
  )
}

console.log('animepahe timeout budget tests passed')
