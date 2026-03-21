import { wails } from './wails'

const SPANISH_MARKERS = [' el ', ' la ', ' los ', ' las ', ' del ', ' de ', ' un ', ' una ']
const CACHE_TTL_MS = 10 * 60 * 1000
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const VALUE_MISS = Symbol('cache-miss')

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

function buildMediaCacheKey(media, candidates) {
  if (media?.id) return `media:${media.id}`
  return `media:${normalizeTitle(candidates[0] ?? '')}`
}

function buildHitCacheKey(hit) {
  return `hit:${hit?.source_id ?? 'unknown'}:${hit?.id ?? normalizeTitle(hit?.title ?? hit?.anime_title ?? '')}`
}

function buildSearchCacheKey(prefix, value, extra = '') {
  return `${prefix}:${normalizeTitle(value)}:${extra}`
}

function buildCandidates(media) {
  const seen = new Set()
  const list = []

  const push = (value) => {
    if (!value) return
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    list.push(trimmed)
  }

  const pushClean = (value) => {
    if (!value) return
    push(value)
    push(value
      .replace(/[\[\]【】(){}]/g, ' ')
      .replace(/[:：]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
  }

  pushClean(media?.title?.romaji)
  pushClean(media?.title?.english)

  if (media?.synonyms?.length) {
    for (const synonym of media.synonyms) {
      if (SPANISH_MARKERS.some(marker => synonym.toLowerCase().includes(marker))) {
        pushClean(synonym)
        break
      }
    }
  }

  const shorten = (title) => {
    if (!title) return null
    const words = title.split(/\s+/).filter(Boolean)
    if (words.length <= 3) return null
    return words.slice(0, 4).join(' ')
  }

  pushClean(shorten(media?.title?.romaji))
  pushClean(shorten(media?.title?.english))

  if (media?.synonyms?.length) {
    for (const synonym of media.synonyms) {
      if (synonym.length < 60 && !/[\u3000-\u9fff]/.test(synonym)) {
        pushClean(synonym)
      }
    }
  }

  return list
}

function buildHitCandidates(hit) {
  const seen = new Set()
  const list = []

  const push = (value) => {
    if (!value) return
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    list.push(trimmed)
  }

  const pushClean = (value) => {
    if (!value) return
    push(value)
    push(value
      .replace(/[\[\]【】(){}]/g, ' ')
      .replace(/[:：]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
  }

  pushClean(hit?.title)
  pushClean(hit?.title_english)
  pushClean(hit?.anime_title)

  const shorten = (title) => {
    if (!title) return null
    const words = title.split(/\s+/).filter(Boolean)
    if (words.length <= 3) return null
    return words.slice(0, 4).join(' ')
  }

  pushClean(shorten(hit?.title))
  pushClean(shorten(hit?.title_english))
  pushClean(shorten(hit?.anime_title))

  return list
}

function normalizeTitle(value) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactTitle(value) {
  return normalizeTitle(value).replace(/\s+/g, '')
}

function tokenizeTitle(value) {
  return normalizeTitle(value)
    .split(' ')
    .filter(token => token.length >= 2)
}

function scoreAgainstNeedles(title, needles) {
  let best = 0
  const titleTokens = tokenizeTitle(title)
  const compact = compactTitle(title)
  for (const needle of needles) {
    const compactNeedle = compactTitle(needle)
    const needleTokens = tokenizeTitle(needle)
    if (title === needle) return 100
    if (compact && compactNeedle) {
      if (compact === compactNeedle) return 96
      if (compact.startsWith(compactNeedle) || compactNeedle.startsWith(compact)) best = Math.max(best, 74)
      if (compact.includes(compactNeedle) || compactNeedle.includes(compact)) best = Math.max(best, 48)
    }
    if (title.startsWith(needle) || needle.startsWith(title)) best = Math.max(best, 70)
    if (title.includes(needle) || needle.includes(title)) best = Math.max(best, 40)
    if (titleTokens.length && needleTokens.length) {
      let shared = 0
      for (const token of needleTokens) {
        if (titleTokens.includes(token)) shared += 1
      }
      const ratio = shared / Math.max(needleTokens.length, titleTokens.length)
      if (shared >= 2 && ratio >= 0.45) best = Math.max(best, 62)
      else if (shared >= 2 && ratio >= 0.3) best = Math.max(best, 48)
    }
  }
  return best
}

function rankJKAnimeResults(results, media) {
  const needles = [
    media?.title?.romaji,
    media?.title?.english,
    ...(media?.synonyms ?? []),
  ].map(normalizeTitle).filter(Boolean)

  return [...results]
    .map(hit => ({
      hit,
      score: scoreAgainstNeedles(normalizeTitle(hit.title), needles),
    }))
    .sort((a, b) => b.score - a.score)
}

function rankAniListResults(results, hit) {
  const needles = [
    hit?.title,
    hit?.title_english,
    hit?.anime_title,
  ].map(normalizeTitle).filter(Boolean)
  const targetSeason = getSeasonHint([hit?.title, hit?.title_english, hit?.anime_title])
  const targetYear = Number(hit?.year) || null

  return [...results].sort((a, b) => {
    const score = (entry) => {
      const candidateTitles = [
        entry?.title?.english,
        entry?.title?.romaji,
        entry?.title?.native,
        ...(entry?.synonyms ?? []),
      ].map(normalizeTitle).filter(Boolean)

      let best = 0
      for (const candidate of candidateTitles) {
        for (const needle of needles) {
          if (candidate === needle) best = Math.max(best, 100)
          else if (candidate.startsWith(needle) || needle.startsWith(candidate)) best = Math.max(best, 70)
          else if (candidate.includes(needle) || needle.includes(candidate)) best = Math.max(best, 40)
        }
      }

      const candidateSeason = getSeasonHint([
        entry?.title?.english,
        entry?.title?.romaji,
        entry?.title?.native,
        ...(entry?.synonyms ?? []),
      ])
      if (targetSeason) {
        if (candidateSeason === targetSeason) best += 30
        else if (targetSeason === 1 && !candidateSeason) best += 12
        else if (!candidateSeason) best -= 8
        else best -= 24
      } else if (candidateSeason) {
        best -= 5
      }

      const candidateYear = Number(entry?.seasonYear) || Number(entry?.startDate?.year) || null
      if (targetYear && candidateYear) {
        if (candidateYear === targetYear) best += 12
        else if (Math.abs(candidateYear - targetYear) === 1) best += 4
        else best -= 8
      }

      return best
    }

    return score(b) - score(a)
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

function getSeasonHint(values) {
  for (const value of values) {
    const season = extractSeasonNumber(value)
    if (season) return season
  }
  return null
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

export async function resolveAniListToJKAnime(media, api = wails, sourceFilter = null) {
  const candidates = buildCandidates(media)
  const searchSourceID = sourceFilter || 'jkanime-es'
  const cacheKey = buildMediaCacheKey(media, candidates) + `:${searchSourceID}`
  const cached = readCache(resolvedMediaCache, cacheKey)
  if (cached !== VALUE_MISS) return cached

  for (const title of candidates) {
    try {
      const results = await searchOnlineCached(title, api, searchSourceID)
      const hits = (results ?? []).filter(result => {
        if (sourceFilter) return result.source_id === sourceFilter
        return true // accept any registered source
      })
      if (!hits.length) continue

      const rankedHits = rankJKAnimeResults(hits, media)
        .filter(entry => entry.score >= 35)
        .slice(0, 4)
      if (!rankedHits.length) continue

      for (const { hit } of rankedHits) {
        try {
          const episodes = await getEpisodesCached(hit.source_id, hit.id, api)
          if (episodes?.length) {
            return writeCache(resolvedMediaCache, cacheKey, {
              hit: enrichHit(hit, media, episodes),
              searchedTitle: title,
            })
          }
        } catch {
          // Try the next validated candidate.
        }
      }
    } catch {
      // Try the next title candidate.
    }
  }

  return writeCache(resolvedMediaCache, cacheKey, { hit: null, searchedTitle: candidates[0] ?? '' }, SEARCH_CACHE_TTL_MS)
}

export async function enrichJKAnimeHit(hit, api = wails, lang = 'es') {
  const cacheKey = buildHitCacheKey(hit)
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

      const best = rankAniListResults(media, hit)[0]
      if (!best) continue

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
