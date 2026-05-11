import assert from 'node:assert/strict'
import { resolveAniListToJKAnime } from './onlineAnimeResolver.js'

function buildEpisodes(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-ep-${index + 1}`,
    number: index + 1,
  }))
}

{
  const media = {
    title_english: 'The Angel Next Door Spoils Me Rotten 2',
    title_romaji: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season',
    synonyms: [
      'The Angel Next Door Spoils Me Rotten Season 2',
      'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season',
    ],
    episodes: 12,
    seasonYear: 2026,
  }

  const searchFixtures = new Map([
    ['The Angel Next Door Spoils Me Rotten 2', [
      { id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' },
      { id: 'angel-s1', title: 'The Angel Next Door Spoils Me Rotten', year: 2023, source_id: 'animepahe-en' },
    ]],
    ['Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season', [
      { id: 'angel-s1', title: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken', year: 2023, source_id: 'animepahe-en' },
      { id: 'angel-s2', title: 'Otonari no Tenshi-sama ni Itsunomanika Dame Ningen ni Sareteita Ken 2nd Season', year: 2026, source_id: 'animepahe-en' },
    ]],
    ['2nd Season', [
      { id: 'space-dandy-s2', title: 'Space Dandy 2nd Season', year: 2014, source_id: 'animepahe-en' },
      { id: 'ajin-s2', title: 'Ajin 2nd Season', year: 2016, source_id: 'animepahe-en' },
    ]],
    ['The Angel Next Door Spoils Me Rotten Season 2', [
      { id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' },
    ]],
    ['The Angel Next Door Spoils Me Rotten', [
      { id: 'angel-s1', title: 'The Angel Next Door Spoils Me Rotten', year: 2023, source_id: 'animepahe-en' },
      { id: 'angel-s2', title: 'The Angel Next Door Spoils Me Rotten 2', year: 2026, source_id: 'animepahe-en' },
    ]],
  ])

  const episodeFixtures = new Map([
    ['angel-s2', buildEpisodes(5, 'angel-s2')],
    ['angel-s1', buildEpisodes(12, 'angel-s1')],
    ['space-dandy-s2', buildEpisodes(13, 'space-dandy-s2')],
    ['ajin-s2', buildEpisodes(13, 'ajin-s2')],
  ])

  const api = {
    async searchOnline(title, sourceID) {
      return (searchFixtures.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      return episodeFixtures.get(animeID) ?? []
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.title ?? null,
    'The Angel Next Door Spoils Me Rotten 2',
    `Angel sequel regression: expected the season-2 hit, but resolver returned ${JSON.stringify(resolved)}`,
  )
}

{
  const media = {
    title_english: 'Re:ZERO -Starting Life in Another World- Season 4',
    title_romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu 4th Season',
    synonyms: ['Re:Zero kara Hajimeru Isekai Seikatsu 4th Season'],
    episodes: 16,
    seasonYear: 2026,
  }

  const searchFixtures = new Map([
    ['Re:ZERO -Starting Life in Another World- Season 4', [
      { id: 'break-time-s4', title: 'Re:ZERO ~Starting Break Time From Zero~ Season 4', year: 2026, source_id: 'animepahe-en' },
      { id: 'rezero-s4', title: 'Re:ZERO -Starting Life in Another World- Season 4', year: 2026, source_id: 'animepahe-en' },
    ]],
    ['Re:Zero kara Hajimeru Isekai Seikatsu 4th Season', [
      { id: 'break-time-s4', title: 'Re:ZERO ~Starting Break Time From Zero~ Season 4', year: 2026, source_id: 'animepahe-en' },
      { id: 'rezero-s4', title: 'Re:ZERO -Starting Life in Another World- Season 4', year: 2026, source_id: 'animepahe-en' },
    ]],
  ])

  const episodeFixtures = new Map([
    ['break-time-s4', buildEpisodes(16, 'break-time-s4')],
    ['rezero-s4', buildEpisodes(3, 'rezero-s4')],
  ])

  const api = {
    async searchOnline(title, sourceID) {
      return (searchFixtures.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      return episodeFixtures.get(animeID) ?? []
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.title ?? null,
    'Re:ZERO -Starting Life in Another World- Season 4',
    `Re:ZERO recovery regression: expected the mainline season-4 hit, but resolver returned ${JSON.stringify(resolved)}`,
  )
}

{
  const media = {
    title_english: "Frieren: Beyond Journey's End Season 2",
    title_romaji: 'Sousou no Frieren 2nd Season',
    synonyms: [
      "Frieren: Beyond Journey's End Season 2",
      'Sousou no Frieren 2nd Season',
    ],
    episodes: 10,
    seasonYear: 2026,
  }

  const slowQuery = 'Sousou no Frieren Season 2'
  const searchFixtures = new Map([
    ["Frieren: Beyond Journeys End Season 2", [
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
      { id: 'frieren-s1', title: "Frieren: Beyond Journey's End", year: 2023, source_id: 'animepahe-en' },
    ]],
    ['Sousou no Frieren 2nd Season', [
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
    ]],
    ['Frieren', [
      { id: 'frieren-s1', title: "Frieren: Beyond Journey's End", year: 2023, source_id: 'animepahe-en' },
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
    ]],
    ["Frieren: Beyond Journeys End", [
      { id: 'frieren-s1', title: "Frieren: Beyond Journey's End", year: 2023, source_id: 'animepahe-en' },
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
    ]],
    ["Frieren: Beyond Journeys End 2nd Season", [
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
    ]],
    [slowQuery, []],
  ])

  const api = {
    async searchOnline(title, sourceID) {
      if (title === slowQuery) {
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      return (searchFixtures.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      if (animeID === 'frieren-s2') return buildEpisodes(10, 'frieren-s2')
      if (animeID === 'frieren-s1') return buildEpisodes(28, 'frieren-s1')
      return []
    },
  }

  const startedAt = Date.now()
  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')
  const elapsedMs = Date.now() - startedAt

  assert.equal(
    resolved.hit?.title ?? null,
    "Frieren: Beyond Journey's End Season 2",
    `Frieren timeout regression: expected the sequel hit, but resolver returned ${JSON.stringify(resolved)}`,
  )
  assert.ok(
    elapsedMs < 90,
    `AnimePahe should not wait for a slow low-value search candidate once a strong sequel hit is available. Took ${elapsedMs}ms.`,
  )
}

{
  const media = {
    title_english: 'Black Clover Timeout',
    title_romaji: 'Black Clover Timeout',
    title_native: 'Black Clover Timeout',
    synonyms: ['Black Clover Timeout'],
    episodes: 170,
    seasonYear: 2017,
  }

  const probeCounts = new Map()
  const searchFixtures = new Map([
    ['Black Clover Timeout', [
      { id: 'black-clover-tv-timeout', title: 'Black Clover Timeout', year: 2017, source_id: 'animepahe-en' },
      { id: 'black-clover-special', title: 'Black Clover: The All Magic Knights Thanksgiving Festa', year: 2018, source_id: 'animepahe-en' },
      { id: 'black-clover-movie', title: 'Black Clover: Sword of the Wizard King', year: 2023, source_id: 'animepahe-en' },
    ]],
  ])

  const api = {
    episodeProbeTimeoutMs: 20,
    episodeProbeRetryTimeoutMs: 60,
    async searchOnline(title, sourceID) {
      return (searchFixtures.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      probeCounts.set(animeID, (probeCounts.get(animeID) ?? 0) + 1)
      if (animeID === 'black-clover-tv-timeout') {
        if ((probeCounts.get(animeID) ?? 0) === 1) {
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        return buildEpisodes(170, animeID)
      }
      if (animeID === 'black-clover-special') return buildEpisodes(1, animeID)
      if (animeID === 'black-clover-movie') return buildEpisodes(1, animeID)
      return []
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.equal(
    resolved.hit?.title ?? null,
    'Black Clover Timeout',
    `AnimePahe should retry a strong exact TV hit before falling through to specials or movies. Got ${JSON.stringify(resolved)}`,
  )
  assert.equal(
    probeCounts.get('black-clover-tv-timeout'),
    2,
    'AnimePahe should retry one timed-out exact episode probe for the primary TV hit',
  )
}

{
  const media = {
    title_english: 'Black Clover Timeout Hard',
    title_romaji: 'Black Clover Timeout Hard',
    title_native: 'Black Clover Timeout Hard',
    synonyms: ['Black Clover Timeout Hard'],
    episodes: 170,
    seasonYear: 2017,
  }

  const probeCounts = new Map()
  const searchFixtures = new Map([
    ['Black Clover Timeout Hard', [
      { id: 'black-clover-tv-hard', title: 'Black Clover Timeout Hard', year: 2017, source_id: 'animepahe-en' },
      { id: 'black-clover-special', title: 'Black Clover: The All Magic Knights Thanksgiving Festa', year: 2018, source_id: 'animepahe-en' },
      { id: 'black-clover-movie', title: 'Black Clover: Sword of the Wizard King', year: 2023, source_id: 'animepahe-en' },
    ]],
  ])

  const api = {
    episodeProbeTimeoutMs: 20,
    episodeProbeRetryTimeoutMs: 200,
    async searchOnline(title, sourceID) {
      return (searchFixtures.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      probeCounts.set(animeID, (probeCounts.get(animeID) ?? 0) + 1)
      if (animeID === 'black-clover-tv-hard') {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return buildEpisodes(170, animeID)
      }
      if (animeID === 'black-clover-special') return buildEpisodes(1, animeID)
      if (animeID === 'black-clover-movie') return buildEpisodes(1, animeID)
      return []
    },
  }

  const startedAt = Date.now()
  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')
  const elapsedMs = Date.now() - startedAt

  assert.equal(
    resolved.hit,
    null,
    `AnimePahe should fail cleanly instead of falling through to a movie/special when the exact TV hit keeps timing out. Got ${JSON.stringify(resolved)}`,
  )
  assert.equal(
    probeCounts.get('black-clover-tv-hard') ?? 0,
    2,
    'AnimePahe should give the strong exact TV hit one bounded retry before aborting',
  )
  assert.equal(
    probeCounts.get('black-clover-special') ?? 0,
    0,
    'AnimePahe should not probe the lower-ranked special once a strong exact TV hit keeps timing out',
  )
  assert.equal(
    probeCounts.get('black-clover-movie') ?? 0,
    0,
    'AnimePahe should not probe the lower-ranked movie once a strong exact TV hit keeps timing out',
  )
  assert.ok(
    elapsedMs < 120,
    `AnimePahe should cap exact-hit episode validation instead of drifting through a long timeout tail. Took ${elapsedMs}ms.`,
  )
}

{
  const media = {
    title_english: "Frieren: Beyond Journey's End",
    title_romaji: 'Sousou no Frieren',
    title_native: '葬送のフリーレン',
    synonyms: ['Frieren'],
    episodes: 0,
    seasonYear: 2023,
  }

  const searchFixtures = new Map([
    ["Frieren: Beyond Journey's End", [
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
      { id: 'frieren-s1', title: "Frieren: Beyond Journey's End", year: 2023, source_id: 'animepahe-en' },
    ]],
    ['Sousou no Frieren', [
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
      { id: 'frieren-s1', title: "Frieren: Beyond Journey's End", year: 2023, source_id: 'animepahe-en' },
    ]],
    ['Frieren', [
      { id: 'frieren-s2', title: "Frieren: Beyond Journey's End Season 2", year: 2026, source_id: 'animepahe-en' },
      { id: 'frieren-s1', title: "Frieren: Beyond Journey's End", year: 2023, source_id: 'animepahe-en' },
    ]],
  ])

  const api = {
    episodeProbeTimeoutMs: 20,
    episodeProbeRetryTimeoutMs: 40,
    async searchOnline(title, sourceID) {
      return (searchFixtures.get(title) ?? []).map((hit) => ({ ...hit, source_id: sourceID }))
    },
    async getOnlineEpisodes(_sourceID, animeID) {
      if (animeID === 'frieren-s2') return buildEpisodes(12, 'frieren-s2')
      if (animeID === 'frieren-s1') {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return buildEpisodes(28, 'frieren-s1')
      }
      return []
    },
  }

  const resolved = await resolveAniListToJKAnime(media, api, 'animepahe-en', 'en')

  assert.notEqual(
    resolved.hit?.title ?? null,
    "Frieren: Beyond Journey's End Season 2",
    `Seasonless AnimePahe titles should not drift into sequel episode lists when the primary season-1 validation stalls. Got ${JSON.stringify(resolved)}`,
  )
}
