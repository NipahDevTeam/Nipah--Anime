function cleanTitleCandidate(value) {
  return String(value || '')
    .replace(/[_\-:/]+/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pushCandidate(target, seen, value) {
  const cleaned = cleanTitleCandidate(value)
  if (!cleaned) return
  const key = cleaned.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  target.push(cleaned)
}

function buildShortTitleVariants(value) {
  const raw = String(value || '').trim()
  if (!raw) return []
  const variants = []
  const push = (candidate) => {
    const cleaned = cleanTitleCandidate(candidate)
    if (!cleaned) return
    if (!variants.includes(cleaned)) variants.push(cleaned)
  }

  push(raw)
  push(raw.split('(')[0])

  for (const separator of [':', ' - ']) {
    const parts = raw.split(separator).map((item) => item.trim()).filter(Boolean)
    if (parts.length < 2) continue
    push(parts[0])
    push(parts[parts.length - 1])
  }

  for (const separator of [',', ' / ']) {
    const parts = raw.split(separator).map((item) => item.trim()).filter(Boolean)
    if (parts.length < 2) continue
    const first = parts[0]
    const last = parts[parts.length - 1]
    if (first.split(/\s+/).length <= 8) push(first)
    if (last.split(/\s+/).length <= 5) push(last)
  }

  return variants
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
      for (const variant of buildShortTitleVariants(value)) {
        pushCandidate(candidates, seen, variant)
      }
    }
  }

  return candidates
}

export function normalizeCandidateList(values) {
  const seen = new Set()
  const candidates = []
  for (const value of Array.isArray(values) ? values : [values]) {
    for (const variant of buildShortTitleVariants(value)) {
      pushCandidate(candidates, seen, variant)
    }
  }
  return candidates
}
