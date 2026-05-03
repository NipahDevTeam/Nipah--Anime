import assert from 'node:assert/strict'
import { buildResolveSearchQueries, resolveAniListToJKAnime, scoreOnlineSourceHit } from './onlineAnimeResolver.js'

const flatAniListMedia = {
  anilist_id: 44567,
  title_english: "Gals Can't Be Kind to Otaku",
  title_romaji: 'Otaku ni Yasashii Gal',
  title_native: 'ã‚ªã‚¿ã‚¯ã«å„ªã—ã„ã‚®ãƒ£ãƒ«ã¯ã„ãªã„ï¼ï¼Ÿ',
  synonyms: ['OtaGal'],
}

const flatCandidates = buildResolveSearchQueries(flatAniListMedia, 'animeav1-es')

assert.equal(
  flatCandidates[0],
  'Gals Cant Be Kind to Otaku',
  'resolver should prioritize canonical AniList titles before short aliases',
)

assert.ok(
  flatCandidates.includes('Gals Cant Be Kind to Otaku'),
  'resolver should search using the flattened English AniList title when no nested title object is present',
)

assert.ok(
  flatCandidates.indexOf('OtaGal') > flatCandidates.indexOf('Gals Cant Be Kind to Otaku'),
  'resolver should keep short aliases behind the canonical AniList title',
)

assert.ok(
  flatCandidates.includes('Otaku ni Yasashii Gal'),
  'resolver should search using the flattened Romaji AniList title when no nested title object is present',
)

assert.ok(
  flatCandidates.includes('OtaGal'),
  'resolver should still keep short aliases available as weaker fallback candidates',
)

{
  const score = scoreOnlineSourceHit(
    {
      id: '0064c3ca-74ab-733c-3405-9784c6f2a085',
      title: 'Hunter x Hunter (2011)',
      year: 2011,
      source_id: 'animepahe-en',
    },
    ['Hunter x Hunter', 'Hunter x Hunter (2011)', 'HUNTER×HUNTER', 'HxH'],
    {
      targetYear: 2011,
      strictSeason: true,
    },
  )

  assert.ok(
    score >= 96,
    `AnimePahe UUID session ids should not drag exact-title hits below the resolver threshold (observed score ${score})`,
  )
}

{
  const seenSearches = []
  const media = {
    id: 91001,
    title: {
      english: 'Example English',
      romaji: 'Example Romaji',
      native: 'Example Native',
    },
    synonyms: ['Exact Alias'],
    episodes: 12,
    seasonYear: 2024,
  }

  const api = {
    async searchOnline(title, sourceID) {
      seenSearches.push(`${sourceID}:${title}`)
      if (title === 'Exact Alias') {
        return [{
          id: 'alias-hit',
          title: 'Exact Alias',
          year: 2024,
          source_id: sourceID,
        }]
      }
      return []
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      return Array.from({ length: animeID === 'alias-hit' ? 12 : 0 }, (_, index) => ({
        id: `ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.id,
    'alias-hit',
    'AnimePahe resolution should keep searching into later canonical aliases instead of stopping after the first three title candidates',
  )
  assert.ok(
    seenSearches.some((value) => value.endsWith(':Exact Alias')),
    'AnimePahe resolution should actually search the later alias candidate that returns the source hit',
  )
}

{
  let episodeProbeCount = 0
  const media = {
    id: 91002,
    title: {
      english: 'Latency Test Show',
      romaji: 'Latency Test Show',
    },
    episodes: 24,
    seasonYear: 2023,
  }

  const api = {
    async searchOnline(title, sourceID) {
      if (title !== 'Latency Test Show') return []
      return [
        { id: 'top-hit', title: 'Latency Test Show', year: 2023, source_id: sourceID },
        { id: 'alt-hit-a', title: 'Latency Test Show Specials', year: 2023, source_id: sourceID },
        { id: 'alt-hit-b', title: 'Latency Test Show Recap', year: 2023, source_id: sourceID },
        { id: 'alt-hit-c', title: 'Latency Test Show OVA', year: 2023, source_id: sourceID },
      ]
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      episodeProbeCount += 1
      return Array.from({ length: animeID === 'top-hit' ? 24 : 2 }, (_, index) => ({
        id: `${animeID}-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.id,
    'top-hit',
    'AnimePahe resolution should still keep the best matching series as the winner',
  )
  assert.ok(
    episodeProbeCount <= 2,
    `AnimePahe resolution should not fetch episodes for every related hit before returning (observed ${episodeProbeCount} probes)`,
  )
}

{
  let searchCallCount = 0
  const media = {
    id: 91003,
    title: {
      english: 'Fast Match Show',
      romaji: 'Fast Match Show',
    },
    episodes: 12,
    seasonYear: 2024,
  }

  const api = {
    async searchOnline(title, sourceID) {
      searchCallCount += 1
      if (title !== 'Fast Match Show') return []
      return [{
        id: 'fast-match-hit',
        title: 'Fast Match Show',
        year: 2024,
        source_id: sourceID,
      }]
    },
    async getOnlineEpisodes() {
      return Array.from({ length: 12 }, (_, index) => ({
        id: `fast-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.id,
    'fast-match-hit',
    'AnimePahe resolution should still resolve the strong first-query match',
  )
  assert.equal(
    searchCallCount,
    1,
    `AnimePahe resolution should stop after the first strong search hit instead of issuing extra fallback searches (observed ${searchCallCount} searches)`,
  )
}

console.log('online anime resolver tests passed')
