const DASH_PATTERN = /[\u2010-\u2015\u2212\u30fc]+/g
const COLON_PATTERN = /[\uFF1A\uFE13\uFE55]+/g
const SLASH_PATTERN = /[\\\/]+/g
const BRACKET_PATTERN = /[\u3010\u3011\u300c\u300d\u300e\u300f\uFF08\uFF09()[\]{}<>]/g
const QUOTE_PATTERN = /["'\u2018\u2019\u201C\u201D`]+/g
const DECORATION_PATTERN = /[|~*+]+/g
const PART_SUFFIX_PATTERN = /\b(?:part|parte|cour)\s+\d+\b.*$/i
const SEASON_BASE_PATTERN = /\b(?:season|temporada)\s+\d+\b/i

function normalizeVariantWhitespace(value) {
  return String(value ?? '')
    .replace(DASH_PATTERN, ' - ')
    .replace(COLON_PATTERN, ':')
    .replace(SLASH_PATTERN, ' / ')
    .replace(BRACKET_PATTERN, ' ')
    .replace(QUOTE_PATTERN, '')
    .replace(DECORATION_PATTERN, ' ')
    .replace(/[_.,;!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pushVariant(target, seen, value) {
  const cleaned = normalizeVariantWhitespace(value)
  if (!cleaned) return
  const key = cleaned.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  target.push(cleaned)
}

function isUsefulFragment(value) {
  const cleaned = normalizeVariantWhitespace(value)
  if (!cleaned) return false
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return true
  return cleaned.length >= 4
}

function pushSeparatorVariants(target, seen, value) {
  for (const separator of [':', ' - ', ' / ', ',']) {
    const parts = value.split(separator).map((item) => normalizeVariantWhitespace(item)).filter(Boolean)
    if (parts.length < 2) continue
    if (isUsefulFragment(parts[0])) {
      pushVariant(target, seen, parts[0])
    }
    if (separator !== ':' && separator !== ' - ') {
      const last = parts[parts.length - 1]
      const wordCount = last.split(/\s+/).filter(Boolean).length
      if (wordCount > 0 && wordCount <= 5 && isUsefulFragment(last)) {
        pushVariant(target, seen, last)
      }
    }
  }
}

function pushSeasonVariants(target, seen, value) {
  const seasonMatch = value.match(SEASON_BASE_PATTERN)
  if (!seasonMatch || seasonMatch.index == null) return
  const seasonEnd = seasonMatch.index + seasonMatch[0].length
  pushVariant(target, seen, value.slice(0, seasonEnd))
  if (isUsefulFragment(value.slice(0, seasonMatch.index))) {
    pushVariant(target, seen, value.slice(0, seasonMatch.index))
  }
}

function pushTrimmedVariants(target, seen, value) {
  pushVariant(target, seen, value.split('(')[0])
  pushVariant(target, seen, value.replace(PART_SUFFIX_PATTERN, ''))
  pushSeparatorVariants(target, seen, value)
  pushSeasonVariants(target, seen, value)
}

export function buildExpandedTitleVariants(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return []

  const normalized = normalizeVariantWhitespace(raw)
  const out = []
  const seen = new Set()

  pushVariant(out, seen, raw)
  pushVariant(out, seen, normalized)
  pushTrimmedVariants(out, seen, normalized)

  const compactSeparators = normalized
    .replace(/ - /g, ' ')
    .replace(/ : /g, ' ')
    .replace(/ \/ /g, ' ')
  pushVariant(out, seen, compactSeparators)
  pushTrimmedVariants(out, seen, compactSeparators)

  return out
}

export function normalizeTitleForMatch(value) {
  return normalizeVariantWhitespace(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function compactTitleForMatch(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, '')
}

export function tokenizeTitleForMatch(value) {
  return normalizeTitleForMatch(value)
    .split(' ')
    .filter((token) => token.length >= 2)
}

export function scoreTitleAgainstNeedles(title, needles) {
  const normalizedTitle = normalizeTitleForMatch(title)
  if (!normalizedTitle) return 0

  let best = 0
  const titleTokens = tokenizeTitleForMatch(title)
  const compactTitle = compactTitleForMatch(title)

  for (const needleValue of needles) {
    const normalizedNeedle = normalizeTitleForMatch(needleValue)
    if (!normalizedNeedle) continue

    const compactNeedle = compactTitleForMatch(needleValue)
    const needleTokens = tokenizeTitleForMatch(needleValue)

    if (normalizedTitle === normalizedNeedle) return 100

    if (compactTitle && compactNeedle) {
      if (compactTitle === compactNeedle) return 96
      if (compactTitle.startsWith(compactNeedle) || compactNeedle.startsWith(compactTitle)) {
        best = Math.max(best, 82)
      } else if (compactTitle.includes(compactNeedle) || compactNeedle.includes(compactTitle)) {
        best = Math.max(best, 60)
      }
    }

    if (normalizedTitle.startsWith(normalizedNeedle) || normalizedNeedle.startsWith(normalizedTitle)) {
      best = Math.max(best, 76)
    } else if (normalizedTitle.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedTitle)) {
      best = Math.max(best, 54)
    }

    if (titleTokens.length && needleTokens.length) {
      let shared = 0
      for (const token of needleTokens) {
        if (titleTokens.includes(token)) shared += 1
      }
      const ratio = shared / Math.max(needleTokens.length, titleTokens.length)
      if (shared >= 3 && ratio >= 0.5) best = Math.max(best, 74)
      else if (shared >= 2 && ratio >= 0.4) best = Math.max(best, 62)
    }
  }

  return best
}
