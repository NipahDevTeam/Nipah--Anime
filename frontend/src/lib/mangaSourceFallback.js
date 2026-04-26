import { buildOrderedMangaSearchCandidates, normalizeCandidateList } from './mangaSearchCandidates.js'
import { scoreTitleAgainstNeedles } from './titleMatching.js'

export const MANGA_SOURCE_FALLBACK_MIN_SCORE = 76
export const MANGA_SOURCE_FALLBACK_EARLY_EXIT_SCORE = 96
const MANGA_CHAPTER_CACHE_TTL_MS = 15 * 60 * 1000
const mangaChapterCache = new Map()

function buildFallbackHitKey(hit) {
  return [
    String(hit?.direct_source_id || hit?.source_id || '').trim(),
    String(hit?.direct_manga_id || hit?.id || '').trim(),
  ].join(':')
}

export function getMangaFallbackSearchCandidates(item) {
  if (!item) return []
  if (Array.isArray(item.search_candidates) && item.search_candidates.length > 0) {
    return normalizeCandidateList(item.search_candidates)
  }
  return normalizeCandidateList(buildOrderedMangaSearchCandidates(item))
}

export function scoreMangaSourceSearchMatch(hit, needles, preferredYear = 0) {
  const title = hit?.direct_source_title || hit?.title || hit?.canonical_title || ''
  if (!title) return 0

  let score = scoreTitleAgainstNeedles(title, needles)
  const hitYear = Number(hit?.resolved_year || hit?.year || 0)
  const targetYear = Number(preferredYear || 0)

  if (targetYear > 0 && hitYear > 0) {
    if (hitYear === targetYear) score += 8
    else if (Math.abs(hitYear - targetYear) === 1) score += 3
    else score -= 6
  }

  return score
}

export function pickBestMangaSourceSearchMatch(results, needles, preferredYear = 0, minScore = MANGA_SOURCE_FALLBACK_MIN_SCORE) {
  const seen = new Set()
  let best = null

  for (const hit of results ?? []) {
    const key = buildFallbackHitKey(hit)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const score = scoreMangaSourceSearchMatch(hit, needles, preferredYear)
    if (score < minScore) continue
    if (!best || score > best.score) {
      best = { hit, score }
    }
  }

  return best
}

function readMangaChapterCache(sourceID, mangaID, lang = 'es') {
  const key = `${sourceID}:${mangaID}:${lang}`
  const cached = mangaChapterCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    mangaChapterCache.delete(key)
    return null
  }
  return cached.chapters
}

export async function getCachedMangaChapters(sourceID, mangaID, lang = 'es', loader) {
  const cached = readMangaChapterCache(sourceID, mangaID, lang)
  if (cached) return cached
  const chapters = await loader()
  mangaChapterCache.set(`${sourceID}:${mangaID}:${lang}`, {
    chapters: chapters ?? [],
    expiresAt: Date.now() + MANGA_CHAPTER_CACHE_TTL_MS,
  })
  return chapters ?? []
}
