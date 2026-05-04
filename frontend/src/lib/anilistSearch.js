import { buildExpandedTitleVariants } from './titleMatching.js'

export function extractAniListAnimeSearchMedia(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data?.Page?.media)) return payload.data.Page.media
  if (Array.isArray(payload?.Page?.media)) return payload.Page.media
  if (Array.isArray(payload?.media)) return payload.media
  return []
}

export function buildAniListAnimeSearchCandidates(query, limit = 3) {
  const resolvedLimit = Math.max(1, Number(limit) || 3)
  return buildExpandedTitleVariants(query).slice(0, resolvedLimit)
}

export function buildAniListAnimeSearchResults(payload, limit = 20) {
  const seen = new Set()
  const resolvedLimit = Math.max(1, Number(limit) || 20)
  return extractAniListAnimeSearchMedia(payload)
    .filter((item) => {
      const id = Number(item?.id || item?.anilist_id || 0)
      if (id <= 0 || seen.has(id)) return false
      seen.add(id)
      return true
    })
    .slice(0, resolvedLimit)
}

export async function searchAniListAnimeWithFallback(query, loadSearch, options = {}) {
  if (typeof loadSearch !== 'function') {
    return { payload: null, results: [], attempts: [] }
  }

  const attempts = []
  const payloads = []
  const minResults = Math.max(1, Number(options.minResults) || 6)
  const resultLimit = Math.max(1, Number(options.limit) || 20)
  const candidates = buildAniListAnimeSearchCandidates(query, options.maxCandidates || 3)
  let bestPayload = null
  let bestResults = []
  let lastError = null

  for (const candidate of candidates) {
    attempts.push(candidate)
    try {
      const payload = await loadSearch(candidate)
      payloads.push(payload)
      const mergedPayload = payloads.length === 1
        ? payloads[0]
        : { data: { Page: { media: payloads.flatMap((entry) => extractAniListAnimeSearchMedia(entry)) } } }
      const results = buildAniListAnimeSearchResults(mergedPayload, resultLimit)
      if (results.length >= bestResults.length) {
        bestPayload = mergedPayload
        bestResults = results
      }
      if (results.length >= minResults || candidate === candidates[candidates.length - 1]) {
        return {
          payload: mergedPayload,
          results,
          attempts,
        }
      }
    } catch (error) {
      lastError = error
      if (bestResults.length > 0) {
        return {
          payload: bestPayload,
          results: bestResults,
          attempts,
        }
      }
    }
  }

  if (bestResults.length > 0) {
    return {
      payload: bestPayload,
      results: bestResults,
      attempts,
    }
  }
  if (lastError) {
    throw lastError
  }
  return { payload: null, results: [], attempts }
}

export async function prewarmAniListAnimeDetails(payload, loadDetail, limit = 4) {
  if (typeof loadDetail !== 'function') return []

  const ids = buildAniListAnimeSearchResults(payload, limit)
    .map((item) => Number(item?.id || item?.anilist_id || 0))
    .filter((id) => id > 0)

  await Promise.allSettled(ids.map((id) => Promise.resolve().then(() => loadDetail(id))))
  return ids
}
