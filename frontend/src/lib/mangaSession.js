import { getDefaultMangaSource, normalizeMangaSourceID } from './mangaSources.js'

export function buildMangaSessionBaseKey(item) {
  if (!item) return ''
  if (item.mode === 'direct') {
    return [
      'direct',
      normalizeMangaSourceID(item.direct_source_id || item.source_id || ''),
      String(item.direct_manga_id || item.id || ''),
    ].join(':')
  }
  return ['canonical', Number(item.anilist_id || item.id || 0)].join(':')
}

export function createMangaSelectionSession(item, sessionCounter, lang = 'es') {
  if (!item) return null
  const mode = item.mode === 'direct' ? 'direct' : 'canonical'
  const baseKey = buildMangaSessionBaseKey({ ...item, mode })
  const suffix = Number(sessionCounter) || 0
  const sessionPreferredSourceID = mode === 'direct'
    ? normalizeMangaSourceID(item.direct_source_id || item.source_id || getDefaultMangaSource(lang))
    : normalizeMangaSourceID(item.default_source_id || getDefaultMangaSource(lang))
  return {
    ...item,
    mode,
    sessionKey: `${baseKey}:${suffix}`,
    sessionPreferredSourceID,
  }
}

export function mergeMangaSessionMetadata(session, patch) {
  if (!session || !patch) return session
  return {
    ...session,
    ...patch,
    sessionKey: session.sessionKey,
    sessionPreferredSourceID: session.sessionPreferredSourceID,
  }
}
