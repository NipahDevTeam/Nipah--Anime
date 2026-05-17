import { resolveAniListToJKAnime } from './onlineAnimeResolver.js'
import { pickEpisodeArtwork } from './episodeArtworkPriority.js'
import { rememberRuntimeCache } from './wails.js'

const PERSISTED_EPISODE_ART_CACHE_KEY = 'nipah:animepahe-episode-art:v1'
const PERSISTED_EPISODE_ART_TTL_MS = 14 * 24 * 60 * 60_000
const PERSISTED_EPISODE_ART_MAX_ENTRIES = 120

function canUseLocalStorage() {
  return typeof window !== 'undefined' && Boolean(window?.localStorage)
}

function normalizeEpisodeArtworkCacheIdentity(anime = {}) {
  const anilistID = Number(anime?.anilist_id || anime?.anilistID || anime?.id || 0)
  if (anilistID > 0) return `anilist:${anilistID}`
  const fallbackTitle = String(anime?.anime_title || anime?.title || '').trim().toLowerCase()
  return fallbackTitle ? `title:${fallbackTitle}` : ''
}

function readPersistedEpisodeArtworkStore() {
  if (!canUseLocalStorage()) return { entries: {} }
  try {
    const raw = window.localStorage.getItem(PERSISTED_EPISODE_ART_CACHE_KEY)
    if (!raw) return { entries: {} }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || !parsed.entries) {
      return { entries: {} }
    }
    return parsed
  } catch {
    return { entries: {} }
  }
}

function prunePersistedEpisodeArtworkEntries(entries = {}) {
  const now = Date.now()
  const rows = Object.entries(entries)
    .filter(([, value]) => value && typeof value === 'object')
    .filter(([, value]) => Number(value?.expiresAt || 0) > now)
    .sort(([, left], [, right]) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
    .slice(0, PERSISTED_EPISODE_ART_MAX_ENTRIES)

  return Object.fromEntries(rows)
}

function writePersistedEpisodeArtworkStore(store = { entries: {} }) {
  if (!canUseLocalStorage()) return
  const nextStore = {
    entries: prunePersistedEpisodeArtworkEntries(store?.entries || {}),
  }
  try {
    window.localStorage.setItem(PERSISTED_EPISODE_ART_CACHE_KEY, JSON.stringify(nextStore))
  } catch {
    // Ignore localStorage quota or serialization failures.
  }
}

function compactDonorEpisodes(donorEpisodes = []) {
  return donorEpisodes
    .filter((ep) => Number(ep?.number) > 0 && String(ep?.thumbnail || '').trim())
    .map((ep) => ({
      number: Number(ep.number),
      thumbnail: String(ep.thumbnail).trim(),
    }))
}

function readPersistedDonorEpisodes(anime) {
  const key = normalizeEpisodeArtworkCacheIdentity(anime)
  if (!key) return []

  const store = readPersistedEpisodeArtworkStore()
  const entry = store.entries?.[key]
  if (!entry || !Array.isArray(entry?.episodes)) return []
  if (Number(entry?.expiresAt || 0) <= Date.now()) {
    delete store.entries[key]
    writePersistedEpisodeArtworkStore(store)
    return []
  }

  entry.updatedAt = Date.now()
  store.entries[key] = entry
  writePersistedEpisodeArtworkStore(store)
  return compactDonorEpisodes(entry.episodes)
}

function writePersistedDonorEpisodes(anime, donorEpisodes = []) {
  const key = normalizeEpisodeArtworkCacheIdentity(anime)
  const compact = compactDonorEpisodes(donorEpisodes)
  if (!key || compact.length === 0) return

  const now = Date.now()
  const store = readPersistedEpisodeArtworkStore()
  store.entries[key] = {
    updatedAt: now,
    expiresAt: now + PERSISTED_EPISODE_ART_TTL_MS,
    episodes: compact,
  }
  writePersistedEpisodeArtworkStore(store)
}

export function __clearPersistedEpisodeArtworkCacheForTests() {
  if (!canUseLocalStorage()) return
  window.localStorage.removeItem(PERSISTED_EPISODE_ART_CACHE_KEY)
}

export function getEpisodeThumbnailCoverage(episodes = []) {
  const total = Array.isArray(episodes) ? episodes.length : 0
  if (total === 0) {
    return { total: 0, withThumbnail: 0, missingThumbnail: 0, ratio: 0 }
  }

  const withThumbnail = episodes.filter((ep) => String(ep?.thumbnail || '').trim()).length
  return {
    total,
    withThumbnail,
    missingThumbnail: total - withThumbnail,
    ratio: withThumbnail / total,
  }
}

export function hasZeroThumbnailCoverage(episodes = []) {
  const coverage = getEpisodeThumbnailCoverage(episodes)
  return coverage.total > 0 && coverage.withThumbnail === 0
}

export function mergeEpisodeArtworkByNumber(episodes = [], donorEpisodes = []) {
  const thumbByNumber = new Map(
    donorEpisodes
      .filter((ep) => ep?.thumbnail && Number(ep?.number) > 0)
      .map((ep) => [Number(ep.number), ep.thumbnail]),
  )

  return episodes.map((ep) => {
    const donor = thumbByNumber.get(Number(ep?.number)) || ''
    const thumbnail = pickEpisodeArtwork({
      providerThumbnail: ep?.thumbnail,
      cachedThumbnail: donor,
      fallbackArtwork: '',
    })

    return thumbnail && thumbnail !== ep?.thumbnail
      ? { ...ep, thumbnail }
      : ep
  })
}

export async function enrichEpisodesWithAnimePaheArtwork(anime, episodes, api, lang = 'en') {
  if (!Array.isArray(episodes) || episodes.length === 0) return episodes

  return rememberRuntimeCache(
    ['animepahe-episode-art', normalizeEpisodeArtworkCacheIdentity(anime) || anime?.title || 'unknown'],
    24 * 60 * 60_000,
    async () => {
      const persistedDonorEpisodes = readPersistedDonorEpisodes(anime)
      if (persistedDonorEpisodes.length > 0) {
        return mergeEpisodeArtworkByNumber(episodes, persistedDonorEpisodes)
      }

      const resolved = await resolveAniListToJKAnime(anime, api, 'animepahe-en', lang)
      if (!resolved?.hit?.id) return episodes
      const donorEpisodes = await api.getOnlineEpisodes('animepahe-en', resolved.hit.id, 3500)
      writePersistedDonorEpisodes(anime, donorEpisodes)
      return mergeEpisodeArtworkByNumber(episodes, donorEpisodes)
    },
    {
      shouldCache: (value) => Array.isArray(value) && value.some((ep) => ep?.thumbnail),
    },
  )
}
