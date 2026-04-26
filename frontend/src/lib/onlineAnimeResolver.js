import { buildExpandedTitleVariants, normalizeTitleForMatch, scoreTitleAgainstNeedles, tokenizeTitleForMatch } from './titleMatching'
import { wails } from './wails'

const SPANISH_MARKERS = [' el ', ' la ', ' los ', ' las ', ' del ', ' de ', ' un ', ' una ']
const CACHE_TTL_MS = 10 * 60 * 1000
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_RESOLVE_SEARCH_CANDIDATES = 4
const MAX_RESOLVE_HITS = 4
const RESOLVER_CACHE_VERSION = 'v9'
const GENERIC_SOURCE_TOKENS = new Set(['tv', 'series', 'anime', 'online'])
const VALUE_MISS = Symbol('cache-miss')
const STRICT_ENGLISH_SOURCE_IDS = new Set(['animekai-en', 'animepahe-en', 'animegg-en'])

const onlineSearchCache = new Map()
const aniListSearchCache = new Map()
const episodeCache = new Map()
const resolvedMediaCache = new Map()
const enrichedHitCache = new Map()
const inFlightCache = new Map()

function readCache(map, key) {
  const entry = map.get(key)
  if (!entry) return VALUE_MISS
  if (entry.expiresAt <= Date.now()) {
    map.delete(key)
    return VALUE_MISS
  }
  return entry.value
}

function writeCache(map, key, value, ttl = CACHE_TTL_MS) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttl,
  })
  return value
}

async function getOrLoad(map, key, loader, ttl = CACHE_TTL_MS) {
  const cached = readCache(map, key)
  if (cached !== VALUE_MISS) return cached

  if (inFlightCache.has(key)) {
    return inFlightCache.get(key)
  }

  const pending = Promise.resolve()
    .then(loader)
    .then((value) => {
      inFlightCache.delete(key)
      return writeCache(map, key, value, ttl)
    })
    .catch((error) => {
      inFlightCache.delete(key)
      throw error
    })

  inFlightCache.set(key, pending)
  return pending
}

function uniqueExpandedCandidates(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    for (const variant of buildExpandedTitleVariants(value)) {
      if (seen.has(variant)) continue
      seen.add(variant)
      out.push(variant)
    }
  }
  return out
}

function buildMediaCacheKey(media, candidates, sourceID = '', lang = 'es') {
  const base = media?.id
    ? `media:${media.id}`
    : `media:${normalizeTitleForMatch(candidates[0] ?? '')}`
  return `${RESOLVER_CACHE_VERSION}:${base}:${sourceID}:${lang}`
}

function buildHitCacheKey(hit, lang = 'es') {
  return `${RESOLVER_CACHE_VERSION}:hit:${lang}:${hit?.source_id ?? 'unknown'}:${hit?.id ?? normalizeTitleForMatch(hit?.title ?? hit?.anime_title ?? '')}`
}

function buildSearchCacheKey(prefix, value, extra = '') {
  return `${prefix}:${normalizeTitleForMatch(value)}:${extra}`
}

function buildCandidates(media) {
  const values = [media?.title?.romaji, media?.title?.english, media?.title?.native]

  if (media?.synonyms?.length) {
    const spanishSynonym = media.synonyms.find((synonym) => (
      SPANISH_MARKERS.some((marker) => synonym.toLowerCase().includes(marker))
    ))
    if (spanishSynonym) values.push(spanishSynonym)
    for (const synonym of media.synonyms) {
      if (synonym.length < 60 && !/[\u3000-\u9fff]/.test(synonym)) {
        values.push(synonym)
      }
    }
  }

  return uniqueExpandedCandidates(values)
}

function extractSeasonHintsFromMedia(media) {
  const values = [
    media?.title?.romaji,
    media?.title?.english,
    media?.title?.native,
    ...(media?.synonyms ?? []),
  ]
  const season = getSeasonHint(values)
  const kind = detectVariantKind(values)
  return {
    season,
    kind,
    year: Number(media?.seasonYear ?? media?.startDate?.year ?? 0) || 0,
  }
}

function stripVariantSuffix(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''

  return text
    .replace(/\b(?:\d{1,2}(?:st|nd|rd|th)|season\s*\d{1,2}|temporada\s*\d{1,2}|part\s*\d{1,2}|parte\s*\d{1,2}|cour\s*\d{1,2})\b/gi, ' ')
    .replace(/\b(?:ova|oad|ona|special|movie|film|dub)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function withSeasonVariants(value, season) {
  const out = []
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return out
  out.push(trimmed)
  if (!season || season < 1) return out

  const ordinal = `${season}${({ 1: 'st', 2: 'nd', 3: 'rd' }[season % 10] && ![11, 12, 13].includes(season % 100)) ? ({ 1: 'st', 2: 'nd', 3: 'rd' }[season % 10]) : 'th'}`
  const base = stripVariantSuffix(trimmed)
  if (base && base !== trimmed) {
    out.push(`${base} Season ${season}`)
    out.push(`${base} ${ordinal} Season`)
  }
  return out
}

function buildResolveSearchQueries(media, sourceID = '') {
  const baseCandidates = buildCandidates(media)
  if (!isStrictEnglishAnimeSource(sourceID)) {
    return baseCandidates
  }

  const { season, kind, year } = extractSeasonHintsFromMedia(media)
  const seen = new Set()
  const out = []
  const push = (value) => {
    for (const variant of buildExpandedTitleVariants(value)) {
      const key = normalizeTitleForMatch(variant)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(variant)
    }
  }

  for (const candidate of baseCandidates) {
    for (const variant of withSeasonVariants(candidate, season)) {
      push(variant)
    }
    const stripped = stripVariantSuffix(candidate)
    if (stripped && stripped !== candidate) {
      push(stripped)
      if (season && season > 1) {
        push(`${stripped} Season ${season}`)
      }
    }
  }

    if (kind) {
      for (const candidate of baseCandidates) {
        const stripped = stripVariantSuffix(candidate)
        if (stripped) push(`${stripped} ${kind.toUpperCase()}`)
      }
    }

  if (year > 0) {
    for (const candidate of baseCandidates) {
      const stripped = stripVariantSuffix(candidate) || candidate
      push(`${stripped} ${year}`)
      if (season && season > 0) {
        push(`${stripped} Season ${season} ${year}`)
      }
    }
  }

  return out
}

function resolveSearchCandidateLimit(sourceID = '') {
  switch (String(sourceID || '').toLowerCase()) {
    case 'animegg-en':
      return 6
    case 'animepahe-en':
      return 3
    default:
      return MAX_RESOLVE_SEARCH_CANDIDATES
  }
}

function resolveMinScore(sourceID = '') {
  switch (String(sourceID || '').toLowerCase()) {
    case 'animekai-en':
      return 68
    case 'animegg-en':
      return 62
    case 'animepahe-en':
      return 42
    default:
      return isStrictEnglishAnimeSource(sourceID) ? 50 : 35
  }
}

function buildSourceIDCandidates(hit) {
  const raw = String(hit?.id ?? '').trim()
  if (!raw) return []
  const cleaned = raw
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/(?:watch|series|anime|title)\//i, '')
    .replace(/^\//, '')
    .replace(/#.*$/, '')
    .replace(/\?.*$/, '')
    .replace(/::.*$/, '')
    .replace(/-episode-\d+(?:\.\d+)?\/?$/i, '')
    .replace(/\/+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\b[a-z0-9]{3,5}\b$/i, '')
    .trim()
  return cleaned ? [cleaned] : []
}

function buildHitCandidates(hit) {
  return uniqueExpandedCandidates([
    hit?.title,
    hit?.title_english,
    hit?.anime_title,
    ...buildSourceIDCandidates(hit),
  ])
}

function sourceSlugTokens(hit) {
  const raw = String(hit?.id ?? '').trim()
  if (!raw) return []
  const cleaned = raw
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/(?:watch|series|anime|title)\//i, '')
    .replace(/^\//, '')
    .replace(/#.*$/, '')
    .replace(/\?.*$/, '')
    .replace(/::.*$/, '')
    .replace(/-episode-\d+(?:[^/?#]*)?\/?$/i, '')
  return tokenizeTitleForMatch(cleaned)
}

function sourceSlugAdjustment(hit, needles, strictSeason = false) {
  const slugTokens = sourceSlugTokens(hit)
  if (!slugTokens.length) return 0

  const needleTokens = new Set(
    needles.flatMap((value) => tokenizeTitleForMatch(value))
      .filter((token) => token.length >= 2),
  )
  if (!needleTokens.size) return 0

  const extras = slugTokens.filter((token) => !needleTokens.has(token))
  if (!extras.length) return 0

  const genericExtras = extras.filter((token) => GENERIC_SOURCE_TOKENS.has(token))
  const meaningfulExtras = extras.filter((token) => !GENERIC_SOURCE_TOKENS.has(token))

  let score = 0
  if (genericExtras.length > 0 && meaningfulExtras.length === 0) {
    if (genericExtras.includes('tv')) score += 10
    else score += 2
  }
  if (meaningfulExtras.length > 0) {
    score -= strictSeason
      ? Math.min(80, meaningfulExtras.length * 18)
      : Math.min(30, meaningfulExtras.length * 8)
  }
  return score
}

function detectAudioFlavor(values) {
  for (const value of values) {
    const text = normalizeTitleForMatch(value)
    if (!text) continue
    if (/\bdub(?:bed)?\b/.test(text)) return 'dub'
    if (/\bsub(?:bed|titles?)?\b/.test(text)) return 'sub'
  }
  return ''
}

function sharedSignificantTokenCount(needles, values) {
  const needleTokens = new Set(
    needles.flatMap((value) => tokenizeTitleForMatch(value))
      .filter((token) => token.length >= 3),
  )
  if (needleTokens.size === 0) return 0

  const valueTokens = new Set(
    values.flatMap((value) => tokenizeTitleForMatch(value))
      .filter((token) => token.length >= 3),
  )

  let shared = 0
  for (const token of needleTokens) {
    if (valueTokens.has(token)) shared += 1
  }
  return shared
}

function scoreSourceHit(hit, needles, options = {}) {
  const candidateTitles = buildHitCandidates(hit)
  let best = 0

  for (const candidate of candidateTitles) {
    best = Math.max(best, scoreTitleAgainstNeedles(candidate, needles))
  }

  const targetSeason = options.targetSeason ?? getSeasonHint(needles)
  const strictSeason = Boolean(options.strictSeason)
  const targetKind = options.targetKind ?? detectVariantKind(needles)
  const preferredAudio = normalizeTitleForMatch(options.preferredAudio || 'sub')
  const sharedSignificantTokens = sharedSignificantTokenCount(needles, candidateTitles)
  if (strictSeason && sharedSignificantTokens === 0) {
    return -1100
  }
  if (String(hit?.source_id || '').toLowerCase() === 'animekai-en' && strictSeason && sharedSignificantTokens < 2) {
    return -1150
  }
  const explicitTargetSeason = targetSeason && extractSeasonNumber(needles.join(' ')) === targetSeason
  const explicitCandidateSeason = candidateSeasonPresent(candidateTitles)
  if (targetSeason) {
    const candidateSeason = getSeasonHint(candidateTitles)
    if (strictSeason && explicitTargetSeason && targetSeason > 1 && !candidateSeason) {
      return -975
    }
    if (strictSeason && explicitTargetSeason && explicitCandidateSeason && candidateSeason && candidateSeason !== targetSeason) {
      return -1000
    }
    if (candidateSeason === targetSeason) {
      best += strictSeason ? 36 : 28
    } else if (targetSeason === 1 && !candidateSeason) {
      best += strictSeason ? 10 : 8
    } else if (!candidateSeason) {
      best -= strictSeason ? 18 : 10
    } else {
      best -= strictSeason ? 44 : 26
    }
  } else if (getSeasonHint(candidateTitles)) {
    best -= strictSeason ? 16 : 4
  }

  const candidateKind = detectVariantKind(candidateTitles)
  if (targetKind) {
    if (strictSeason && candidateKind && candidateKind !== targetKind) {
      return -950
    }
    if (candidateKind === targetKind) best += strictSeason ? 30 : 18
    else if (candidateKind) best -= strictSeason ? 28 : 14
  } else if (candidateKind) {
    best -= strictSeason ? 36 : 6
  }

  const targetYear = Number(options.targetYear) || 0
  const candidateYear = Number(hit?.year) || 0
  if (targetYear && candidateYear) {
    if (candidateYear === targetYear) best += 12
    else if (Math.abs(candidateYear - targetYear) === 1) best += 4
    else best -= strictSeason ? 18 : 10
  }

  const candidateAudio = detectAudioFlavor([...candidateTitles, hit?.id])
  if (candidateAudio) {
    if (preferredAudio === 'dub') {
      best += candidateAudio === 'dub' ? 12 : -8
    } else {
      if (candidateAudio === 'dub') {
        best -= strictSeason ? 72 : 18
      } else {
        best += 8
      }
    }
  }

  best += sourceSlugAdjustment(hit, needles, strictSeason)

  return best
}

export function isStrictEnglishAnimeSource(sourceID = '') {
  return STRICT_ENGLISH_SOURCE_IDS.has(String(sourceID || '').toLowerCase())
}

export function rankOnlineSourceHits(results, needles, options = {}) {
  return [...results].sort((a, b) => (
    scoreSourceHit(b, needles, options) - scoreSourceHit(a, needles, options)
  ))
}

function rankJKAnimeResults(results, media, sourceID = '') {
  const needles = [
    media?.title?.romaji,
    media?.title?.english,
    media?.title?.native,
    ...(media?.synonyms ?? []),
  ]

  const strictSeason = isStrictEnglishAnimeSource(sourceID)

  return rankOnlineSourceHits(results, needles, {
    targetSeason: getSeasonHint(needles),
    targetKind: detectVariantKind(needles),
    targetYear: media?.seasonYear ?? media?.startDate?.year ?? 0,
    strictSeason,
  })
    .map((hit) => ({
      hit,
      score: scoreSourceHit(hit, needles, {
        targetSeason: getSeasonHint(needles),
        targetKind: detectVariantKind(needles),
        targetYear: media?.seasonYear ?? media?.startDate?.year ?? 0,
        strictSeason,
      }),
    }))
    .sort((a, b) => b.score - a.score)
}

function firstTruthyResult(promises) {
  return new Promise((resolve) => {
    if (!promises.length) {
      resolve(null)
      return
    }

    let pending = promises.length
    for (const promise of promises) {
      Promise.resolve(promise)
        .then((value) => {
          if (value) {
            resolve(value)
            return
          }
          pending -= 1
          if (pending <= 0) resolve(null)
        })
        .catch(() => {
          pending -= 1
          if (pending <= 0) resolve(null)
        })
    }
  })
}

function extractSeasonNumber(value) {
  const text = String(value ?? '')
  if (!text) return null

  const directMatch = text.match(/(?:season|temporada|parte|part|cour)\s*(\d{1,2})/i)
    || text.match(/(\d{1,2})(?:st|nd|rd|th)\s*(?:season|part|cour)/i)
  if (directMatch) return Number(directMatch[1])

  const romanMap = {
    ii: 2, iii: 3, iv: 4, v: 5, vi: 6,
  }
  const romanMatch = text.match(/\b(ii|iii|iv|v|vi)\b/i)
  if (romanMatch) return romanMap[romanMatch[1].toLowerCase()] ?? null

  return null
}

function detectVariantKind(values) {
  for (const value of values) {
    const text = String(value ?? '').toLowerCase()
    if (!text) continue
    if (/\b(?:ova|oad)\b/.test(text)) return 'ova'
    if (/\bona\b/.test(text)) return 'ona'
    if (/\b(?:movie|film|gekijouban)\b/.test(text)) return 'movie'
    if (/\b(?:special|sp)\b/.test(text)) return 'special'
  }
  return null
}

function candidateSeasonPresent(values) {
  return values.some((value) => extractSeasonNumber(value))
}

function detectAniListKind(entry) {
  const format = String(entry?.format ?? '').toUpperCase()
  switch (format) {
    case 'MOVIE':
      return 'movie'
    case 'OVA':
      return 'ova'
    case 'ONA':
      return 'ona'
    case 'SPECIAL':
      return 'special'
    default:
      return detectVariantKind([
        entry?.title?.english,
        entry?.title?.romaji,
        entry?.title?.native,
        ...(entry?.synonyms ?? []),
      ])
  }
}

function getSeasonHint(values) {
  for (const value of values) {
    const season = extractSeasonNumber(value)
    if (season) return season
  }
  return null
}

function scoreAniListEntry(entry, hit, options = {}) {
  const needles = [hit?.title, hit?.title_english, hit?.anime_title]
  const targetSeason = options.targetSeason ?? getSeasonHint([hit?.title, hit?.title_english, hit?.anime_title])
  const targetYear = Number(hit?.year) || null
  const strictSeason = Boolean(options.strictSeason)

  const candidateTitles = [
    entry?.title?.english,
    entry?.title?.romaji,
    entry?.title?.native,
    ...(entry?.synonyms ?? []),
  ]

  let best = 0
  for (const candidate of candidateTitles) {
    best = Math.max(best, scoreTitleAgainstNeedles(candidate, needles))
  }

  const candidateSeason = getSeasonHint(candidateTitles)
  const targetKind = options.targetKind ?? detectVariantKind(needles)
  const candidateKind = detectAniListKind(entry)
  const explicitTargetSeason = targetSeason && extractSeasonNumber(needles.join(' ')) === targetSeason
  const explicitCandidateSeason = candidateSeasonPresent(candidateTitles)
  if (targetSeason) {
    if (strictSeason && explicitTargetSeason && targetSeason > 1 && !candidateSeason) {
      return -975
    }
    if (strictSeason && explicitTargetSeason && explicitCandidateSeason && candidateSeason && candidateSeason !== targetSeason) {
      return -1000
    }
    if (candidateSeason === targetSeason) best += strictSeason ? 38 : 30
    else if (targetSeason === 1 && !candidateSeason) best += strictSeason ? 8 : 12
    else if (!candidateSeason) best -= strictSeason ? 18 : 8
    else best -= strictSeason ? 42 : 24
  } else if (candidateSeason) {
    best -= strictSeason ? 18 : 5
  }

  if (targetKind) {
    if (strictSeason && candidateKind && candidateKind !== targetKind) {
      return -950
    }
    if (candidateKind === targetKind) best += strictSeason ? 28 : 16
    else if (candidateKind) best -= strictSeason ? 26 : 12
  } else if (candidateKind) {
    best -= strictSeason ? 30 : 6
  }

  const candidateYear = Number(entry?.seasonYear) || Number(entry?.startDate?.year) || null
  if (targetYear && candidateYear) {
    if (candidateYear === targetYear) best += 12
    else if (Math.abs(candidateYear - targetYear) === 1) best += 4
    else best -= strictSeason ? 14 : 8
  }

  return best
}

function rankAniListResults(results, hit, options = {}) {
  return [...results].sort((a, b) => (
    scoreAniListEntry(b, hit, options) - scoreAniListEntry(a, hit, options)
  ))
}

function enrichHit(hit, media, episodes) {
  return {
    ...hit,
    anilist_id: media?.id ?? hit?.anilist_id ?? 0,
    mal_id: media?.idMal ?? hit?.mal_id ?? 0,
    prefetchedEpisodes: episodes,
    anilistDescription: media?.description,
    anilistBannerImage: media?.bannerImage ?? '',
    anilistCoverImage: media?.coverImage?.extraLarge || media?.coverImage?.large || '',
    anilistGenres: media?.genres ?? [],
    anilistScore: media?.averageScore ?? 0,
    anilistYear: media?.seasonYear ?? media?.startDate?.year ?? 0,
    anilistEpisodes: media?.episodes ?? 0,
    anilistStreamingEpisodes: media?.streamingEpisodes ?? [],
  }
}

function episodeCountMatchScore(targetEpisodes, actualEpisodes, sourceID = '') {
  const expected = Number(targetEpisodes) || 0
  const actual = Number(actualEpisodes) || 0
  const strictAnimeGG = String(sourceID || '').toLowerCase() === 'animegg-en'

  if (actual <= 0) return -1000
  if (expected <= 0) return actual > 1 ? 8 : 0
  if (strictAnimeGG && expected > 8 && actual <= 1) return -1200

  const diff = Math.abs(expected - actual)
  const tolerance = Math.max(2, Math.floor(expected * 0.12))
  if (diff === 0) return 42
  if (diff <= tolerance) return 24
  if (diff <= Math.max(6, Math.floor(expected * 0.25))) return 8
  if (actual < expected * 0.35 || actual > expected * 1.8) return strictAnimeGG ? -180 : -90
  return strictAnimeGG ? -40 : -20
}

async function searchOnlineCached(title, api, sourceID = 'jkanime-es') {
  return getOrLoad(
    onlineSearchCache,
    buildSearchCacheKey('jkanime-search', title, sourceID),
    () => api.searchOnline(title, sourceID),
    SEARCH_CACHE_TTL_MS,
  )
}

async function searchAniListCached(title, lang, api) {
  return getOrLoad(
    aniListSearchCache,
    buildSearchCacheKey('anilist-search', title, lang),
    () => api.searchAniList(title, lang),
    SEARCH_CACHE_TTL_MS,
  )
}

async function getEpisodesCached(sourceID, animeID, api) {
  return getOrLoad(
    episodeCache,
    `episodes:${sourceID}:${animeID}`,
    () => api.getOnlineEpisodes(sourceID, animeID),
    SEARCH_CACHE_TTL_MS,
  )
}

export async function resolveAniListToJKAnime(media, api = wails, sourceFilter = null, lang = 'es') {
  const candidates = buildResolveSearchQueries(media, sourceFilter || '')
  const searchSourceID = sourceFilter || 'jkanime-es'
  const cacheKey = buildMediaCacheKey(media, candidates, searchSourceID, lang)
  const cached = readCache(resolvedMediaCache, cacheKey)
  if (cached !== VALUE_MISS) return cached

  let lastErrorMessage = ''
  let searchedTitle = candidates[0] ?? ''

  const seenHits = new Set()
  const aggregatedHits = []

  const searchResults = await Promise.all(
    candidates
      .slice(0, resolveSearchCandidateLimit(searchSourceID))
      .map(async (title) => {
        try {
          return {
            title,
            hits: (await searchOnlineCached(title, api, searchSourceID) ?? [])
              .filter((result) => (sourceFilter ? result.source_id === sourceFilter : true)),
          }
        } catch (error) {
          const message = String(error?.message ?? error ?? '').trim()
          if (message) lastErrorMessage = message
          return { title, hits: [] }
        }
      }),
  )

  for (const { title, hits } of searchResults) {
    if (!hits.length) continue
    if (!searchedTitle) searchedTitle = title

    for (const hit of hits) {
      const key = `${hit?.source_id ?? searchSourceID}:${hit?.id ?? hit?.title ?? ''}`
      if (seenHits.has(key)) continue
      seenHits.add(key)
      aggregatedHits.push(hit)
    }
  }

  const minResolveScore = resolveMinScore(searchSourceID)
  const rankedHits = rankJKAnimeResults(aggregatedHits, media, searchSourceID)
    .filter((entry) => entry.score >= minResolveScore)
    .slice(0, MAX_RESOLVE_HITS)

  const resolvedHits = await Promise.all(
    rankedHits.map(async ({ hit, score }) => {
      try {
        const episodes = await getEpisodesCached(hit.source_id, hit.id, api)
        if (!episodes?.length) return null
        return {
          hit: enrichHit(hit, media, episodes),
          searchedTitle,
          score: score + episodeCountMatchScore(media?.episodes, episodes.length, searchSourceID),
        }
      } catch {
        return null
      }
    }),
  )

  const bestResolved = resolvedHits
    .filter(Boolean)
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0]

  if (bestResolved) {
    return writeCache(resolvedMediaCache, cacheKey, {
      hit: bestResolved.hit,
      searchedTitle: bestResolved.searchedTitle,
    })
  }

  if (rankedHits.length > 0) {
    return writeCache(
      resolvedMediaCache,
      cacheKey,
      {
        hit: rankedHits[0].hit,
        searchedTitle,
        error: lastErrorMessage,
      },
      SEARCH_CACHE_TTL_MS,
    )
  }

  return writeCache(
    resolvedMediaCache,
    cacheKey,
    {
      hit: null,
      searchedTitle,
      error: lastErrorMessage,
    },
    SEARCH_CACHE_TTL_MS,
  )
}

export async function enrichJKAnimeHit(hit, api = wails, lang = 'es') {
  const cacheKey = buildHitCacheKey(hit, lang)
  const cached = readCache(enrichedHitCache, cacheKey)
  if (cached !== VALUE_MISS) {
    if (hit?.prefetchedEpisodes?.length && !cached?.prefetchedEpisodes?.length) {
      return writeCache(enrichedHitCache, cacheKey, { ...cached, prefetchedEpisodes: hit.prefetchedEpisodes })
    }
    return cached
  }

  const candidates = buildHitCandidates(hit)
  let prefetchedEpisodes = hit?.prefetchedEpisodes ?? []

  if (!prefetchedEpisodes?.length) {
    try {
      prefetchedEpisodes = await getEpisodesCached(hit.source_id, hit.id, api)
    } catch {
      prefetchedEpisodes = []
    }
  }

  for (const title of candidates) {
    try {
      const res = await searchAniListCached(title, lang, api)
      const media = res?.data?.Page?.media ?? []
      if (!media.length) continue

      const rankingOptions = {
        strictSeason: isStrictEnglishAnimeSource(hit?.source_id),
        targetKind: detectVariantKind([hit?.title, hit?.title_english, hit?.anime_title]),
      }
      const ranked = rankAniListResults(media, hit, rankingOptions)
      const best = ranked[0]
      if (!best) continue
      const bestScore = scoreAniListEntry(best, hit, rankingOptions)
      if (String(hit?.source_id || '').toLowerCase() === 'animegg-en' && prefetchedEpisodes?.length) {
        const targetEpisodes = Number(best?.episodes ?? 0)
        if (targetEpisodes > 0) {
          const delta = Math.abs(targetEpisodes - prefetchedEpisodes.length)
          if (prefetchedEpisodes.length > 8 && delta > Math.max(12, Math.floor(prefetchedEpisodes.length * 0.35))) {
            continue
          }
          if (prefetchedEpisodes.length <= 4 && targetEpisodes >= 10) {
            continue
          }
        }
      }
      if (isStrictEnglishAnimeSource(hit?.source_id) && bestScore < 76) {
        continue
      }

      return writeCache(enrichedHitCache, cacheKey, enrichHit(hit, best, prefetchedEpisodes))
    } catch {
      // Try next AniList candidate.
    }
  }

  return writeCache(enrichedHitCache, cacheKey, {
    ...hit,
    ...(prefetchedEpisodes?.length ? { prefetchedEpisodes } : {}),
  }, SEARCH_CACHE_TTL_MS)
}
