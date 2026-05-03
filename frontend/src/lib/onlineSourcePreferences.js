const ONLINE_SOURCE_PREFERENCE_CACHE_PREFIX = 'nipah-online-source-pref'

function normalizeMediaType(mediaType = 'anime') {
  return mediaType === 'manga' ? 'manga' : 'anime'
}

function normalizeLang(lang = 'es') {
  return String(lang || '').trim().toLowerCase() === 'en' ? 'en' : 'es'
}

function readNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export function getPreferredSourceSettingKey(mediaType, lang) {
  return `preferred_${normalizeMediaType(mediaType)}_source_${normalizeLang(lang)}`
}

export function getPreferredSourceCacheKey(mediaType, lang) {
  return `${ONLINE_SOURCE_PREFERENCE_CACHE_PREFIX}:${normalizeMediaType(mediaType)}:${normalizeLang(lang)}`
}

export function readCachedOnlineSourcePreference({
  mediaType,
  lang,
  fallbackSourceID = '',
  normalizeSourceID = (value) => value,
} = {}) {
  if (typeof localStorage === 'undefined') return fallbackSourceID

  try {
    const rawValue = readNonEmptyString(localStorage.getItem(getPreferredSourceCacheKey(mediaType, lang)))
    if (!rawValue) return fallbackSourceID
    return normalizeSourceID(rawValue) || fallbackSourceID
  } catch {
    return fallbackSourceID
  }
}

export function cachePreferredSourcePreference(mediaType, lang, sourceID) {
  if (typeof localStorage === 'undefined') return

  const normalizedSourceID = readNonEmptyString(sourceID)
  if (!normalizedSourceID) return

  try {
    localStorage.setItem(getPreferredSourceCacheKey(mediaType, lang), normalizedSourceID)
  } catch {}
}

export function resolveSavedOnlineSourcePreference({
  mediaType,
  lang,
  settings = {},
  fallbackSourceID = '',
  normalizeSourceID = (value) => value,
} = {}) {
  const settingKey = getPreferredSourceSettingKey(mediaType, lang)
  const legacySettingKey = `preferred_${normalizeMediaType(mediaType)}_source`
  const rawValue = readNonEmptyString(settings?.[settingKey])
    || readNonEmptyString(settings?.[legacySettingKey])
    || readCachedOnlineSourcePreference({
      mediaType,
      lang,
      fallbackSourceID: '',
      normalizeSourceID,
    })

  if (!rawValue) return fallbackSourceID
  return normalizeSourceID(rawValue) || fallbackSourceID
}

export function buildPreferredSourceSettingsPatch(mediaType, lang, sourceID) {
  return {
    [getPreferredSourceSettingKey(mediaType, lang)]: sourceID,
  }
}
