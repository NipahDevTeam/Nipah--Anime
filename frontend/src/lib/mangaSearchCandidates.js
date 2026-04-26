import { buildExpandedTitleVariants } from './titleMatching.js'

function pushCandidate(target, seen, value) {
  for (const cleaned of buildExpandedTitleVariants(value)) {
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    target.push(cleaned)
  }
}

export function isManhwaLike(item) {
  const format = String(item?.format || item?.resolved_format || '').trim().toUpperCase()
  const country = String(item?.country_of_origin || item?.resolved_country_of_origin || '').trim().toUpperCase()
  return format === 'MANHWA' || country === 'KR'
}

export function buildOrderedMangaSearchCandidates(item) {
  const seen = new Set()
  const candidates = []
  const englishFirst = isManhwaLike(item)
  const englishGroup = [
    item?.canonical_title_english,
    item?.title_english,
  ]
  const primaryGroup = [
    item?.canonical_title,
    item?.title,
    item?.anime_title,
    item?.manga_title,
    item?.title_romaji,
    item?.title_native,
  ]
  const synonyms = Array.isArray(item?.synonyms) ? item.synonyms : []

  const orderedGroups = englishFirst
    ? [englishGroup, synonyms, primaryGroup]
    : [englishGroup, primaryGroup, synonyms]

  for (const group of orderedGroups) {
    for (const value of group) {
      pushCandidate(candidates, seen, value)
    }
  }

  return candidates
}

export function normalizeCandidateList(values) {
  const seen = new Set()
  const candidates = []
  for (const value of Array.isArray(values) ? values : [values]) {
    pushCandidate(candidates, seen, value)
  }
  return candidates
}
