import assert from 'node:assert/strict'
import { buildResolveSearchQueries, enrichJKAnimeHit, isStrictEnglishAnimeSource, resolveAniListToJKAnime, scoreOnlineSourceHit } from './onlineAnimeResolver.js'

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

assert.equal(
  isStrictEnglishAnimeSource('animeheaven-en'),
  false,
  'AnimeHeaven should stay on the faster generic resolver path so exact English hits do not pay the stricter sequel-only scoring cost',
)

{
  const sequelQueries = buildResolveSearchQueries({
    title: {
      english: 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season',
      romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season',
    },
    seasonYear: 2020,
  }, 'animeheaven-en')

  assert.ok(
    sequelQueries.some((query) => /\bSeason 2\b/i.test(query)),
    `AnimeHeaven sequel lookups should expand AniList season titles into alternate season-number variants instead of searching only the single raw title: ${JSON.stringify(sequelQueries)}`,
  )
  assert.ok(
    sequelQueries.every((query) => !/Season Season/i.test(query)),
    `AnimeHeaven sequel lookups should normalize season variants cleanly without malformed duplicate markers: ${JSON.stringify(sequelQueries)}`,
  )
}

{
  const media = {
    id: 93000,
    title: {
      english: 'Re:ZERO -Starting Life in Another World- Season 2',
      romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season',
    },
    episodes: 25,
    seasonYear: 2020,
  }

  const seasonOne = {
    id: 'rezero-season-1',
    title: 'Re:ZERO -Starting Life in Another World-',
    year: 2016,
    source_id: 'animeheaven-en',
  }

  const seasonTwo = {
    id: 'rezero-season-2',
    title: 'Re:ZERO -Starting Life in Another World- Season 2',
    year: 2020,
    source_id: 'animeheaven-en',
  }

  const api = {
    async searchOnline(title, sourceID) {
      if (!title.includes('Re:ZERO')) return []
      return [
        { ...seasonOne, source_id: sourceID },
        { ...seasonTwo, source_id: sourceID },
      ]
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      return Array.from({ length: animeID === seasonTwo.id ? 25 : 25 }, (_, index) => ({
        id: `${animeID}-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animeheaven-en', 'en')

  assert.equal(
    resolved.hit?.id,
    seasonTwo.id,
    'AnimeHeaven resolution should keep explicit sequel titles on the matching season instead of drifting back to season 1',
  )
}

{
  const hit = {
    id: 'rezero-season-2',
    title: 'Re:ZERO -Starting Life in Another World- Season 2',
    title_english: 'Re:ZERO -Starting Life in Another World- Season 2',
    year: 2020,
    source_id: 'animeheaven-en',
  }

  const api = {
    async searchAniList() {
      return {
        data: {
          Page: {
            media: [
              {
                id: 1001,
                episodes: 25,
                seasonYear: 2016,
                title: {
                  english: 'Re:ZERO -Starting Life in Another World-',
                  romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu',
                },
                synonyms: [],
              },
              {
                id: 1002,
                episodes: 25,
                seasonYear: 2020,
                title: {
                  english: 'Re:ZERO -Starting Life in Another World- Season 2',
                  romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season',
                },
                synonyms: [],
              },
            ],
          },
        },
      }
    },
    async getOnlineEpisodes() {
      return Array.from({ length: 25 }, (_, index) => ({
        id: `rezero-s2-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const enriched = await enrichJKAnimeHit(hit, api, 'en')

  assert.equal(
    enriched.anilist_id,
    1002,
    'AnimeHeaven enrichment should keep sequel hits attached to the matching AniList season instead of sliding back to season 1 metadata',
  )
}

{
  let searchCallCount = 0
  const media = {
    id: 91000,
    title: {
      english: 'Speed Test Show',
      romaji: 'Speed Test Show',
    },
    episodes: 12,
    seasonYear: 2024,
  }

  const api = {
    async searchOnline(title, sourceID) {
      searchCallCount += 1
      if (title !== 'Speed Test Show') return []
      return [{
        id: 'speed-test-hit',
        title: 'Speed Test Show',
        year: 2024,
        source_id: sourceID,
      }]
    },
    async getOnlineEpisodes() {
      return Array.from({ length: 12 }, (_, index) => ({
        id: `speed-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animeheaven-en', 'en')

  assert.equal(
    resolved.hit?.id,
    'speed-test-hit',
    'AnimeHeaven should still resolve the first strong exact-title hit',
  )
  assert.equal(
    searchCallCount,
    1,
    `AnimeHeaven should stop after the first strong search hit instead of fanning out extra fallback searches (observed ${searchCallCount} searches)`,
  )
}

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

{
  const seenSearches = []
  const good = {
    id: '5d569a65-d80b-fcc5-7506-dd32d0ab403f',
    title: 'Re:ZERO -Starting Life in Another World- Season 2',
    year: 2020,
    source_id: 'animepahe-en',
  }
  const bad = {
    id: '345fb717-b8fc-7b61-c640-de3dc0156b9b',
    title: 'Re:ZERO ~Starting Break Time From Zero~ Season 2',
    year: 2020,
    source_id: 'animepahe-en',
  }
  const media = {
    id: 99904,
    title: {
      english: 'Re:ZERO -Starting Life in Another World- Season 2',
      romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season',
      native: 'Re:ゼロから始める異世界生活 2nd season',
    },
    episodes: 25,
    seasonYear: 2020,
  }

  const api = {
    async searchOnline(title, sourceID) {
      seenSearches.push(`${sourceID}:${title}`)
      if (title === media.title.english) {
        return [bad]
      }
      if (title === media.title.romaji) {
        return [good]
      }
      return []
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      return Array.from({ length: 25 }, (_, index) => ({
        id: `${animeID}-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.id,
    good.id,
    'AnimePahe resolution should continue past a misleading English-title sibling hit and allow later Romaji queries to contribute the correct series',
  )
  assert.ok(
    seenSearches.some((value) => value.endsWith(`:${media.title.romaji}`)),
    'AnimePahe resolution should not short-circuit before the Romaji search variant when the first English hit is only a near-match sibling',
  )
}

{
  const media = {
    id: 99905,
    title: {
      english: 'Attack on Titan: The Final Season Part 2',
      romaji: 'Shingeki no Kyojin: The Final Season Part 2',
    },
    episodes: 12,
    seasonYear: 2022,
  }
  const bad = {
    id: 'aot-final-season',
    title: 'Attack on Titan: The Final Season',
    year: 2020,
    source_id: 'animepahe-en',
  }
  const good = {
    id: 'aot-final-season-part-2',
    title: 'Attack on Titan: The Final Season Part 2',
    year: 2022,
    source_id: 'animepahe-en',
  }
  const seenSearches = []

  const api = {
    async searchOnline(title, sourceID) {
      seenSearches.push(`${sourceID}:${title}`)
      if (title === media.title.english) {
        return [bad]
      }
      if (title === media.title.romaji) {
        return [good]
      }
      return []
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      return Array.from({ length: animeID === good.id ? 12 : 16 }, (_, index) => ({
        id: `${animeID}-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.id,
    good.id,
    'AnimePahe resolution should search the exact Romaji sequel title before English separator-derived fallbacks crowd it out of the strict search window',
  )
  assert.ok(
    seenSearches.some((value) => value.endsWith(`:${media.title.romaji}`)),
    'AnimePahe resolution should keep the exact Romaji sequel title within the strict AnimePahe search window',
  )
}

{
  const media = {
    id: 99906,
    title: {
      english: 'JUJUTSU KAISEN',
      romaji: 'Jujutsu Kaisen',
    },
    episodes: 24,
    seasonYear: 2020,
  }
  const stalled = {
    id: 'jjk-stalled-hit',
    title: 'JUJUTSU KAISEN',
    year: 2020,
    source_id: 'animepahe-en',
  }
  const working = {
    id: 'jjk-working-hit',
    title: 'Jujutsu Kaisen',
    year: 2020,
    source_id: 'animepahe-en',
  }

  const api = {
    episodeProbeTimeoutMs: 5,
    async searchOnline(title, sourceID) {
      if (title === media.title.english) {
        return [stalled, working].map((item) => ({ ...item, source_id: sourceID }))
      }
      return []
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      if (animeID === stalled.id) {
        return await new Promise(() => {})
      }
      return Array.from({ length: 24 }, (_, index) => ({
        id: `${animeID}-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.id,
    working.id,
    'AnimePahe resolution should skip a stalled episode probe and continue to the next validated source hit',
  )
}

{
  const media = {
    id: 99907,
    title: {
      english: 'The Angel Next Door Spoils Me Rotten 2',
      romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season',
    },
    episodes: 12,
    seasonYear: 2026,
  }
  const unresolved = {
    id: 'angel-next-door-stalled-hit',
    title: 'The Angel Next Door Spoils Me Rotten 2nd Season',
    year: 2026,
    source_id: 'animepahe-en',
  }
  let callPhase = 'fail'

  const api = {
    episodeProbeTimeoutMs: 5,
    async searchOnline(title, sourceID) {
      if (title !== media.title.english) return []
      return [{ ...unresolved, source_id: sourceID }]
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      if (callPhase === 'fail') {
        return await new Promise(() => {})
      }
      return Array.from({ length: 12 }, (_, index) => ({
        id: `${animeID}-ep-${index + 1}`,
        number: index + 1,
      }))
    },
  }

  const failed = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')
  assert.equal(
    failed.hit,
    null,
    'AnimePahe resolution should not return an unvalidated hit when every episode probe stalls',
  )

  callPhase = 'recover'
  const recovered = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')
  assert.equal(
    recovered.hit?.id,
    unresolved.id,
    'AnimePahe failed resolutions should not be cached, so an immediate retry can recover once the source responds',
  )
}

console.log('online anime resolver tests passed')
