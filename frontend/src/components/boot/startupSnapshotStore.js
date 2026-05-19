export const STARTUP_SNAPSHOT_STORAGE_KEY = 'nipah.startup.snapshot.v1'
export const STARTUP_SNAPSHOT_SCHEMA_VERSION = 1

function canUseLocalStorage() {
  return typeof window !== 'undefined' && Boolean(window?.localStorage)
}

function normalizeSnapshotPayload(payload = {}) {
  const version = payload && Object.prototype.hasOwnProperty.call(payload, 'version')
    ? Number(payload.version)
    : STARTUP_SNAPSHOT_SCHEMA_VERSION
  const lang = typeof payload?.lang === 'string' ? payload.lang : ''
  const season = typeof payload?.season === 'string' ? payload.season : ''
  const year = Number(payload?.year || 0)
  const savedAt = Number(payload?.savedAt || Date.now())
  const snapshot = payload?.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null
  const readiness = payload?.readiness && typeof payload.readiness === 'object' ? payload.readiness : null

  if (!lang || !season || !year || !snapshot || !readiness) return null

  return {
    version,
    lang,
    season,
    year,
    snapshot,
    readiness,
    savedAt,
  }
}

export function loadStartupSnapshot() {
  if (!canUseLocalStorage()) return null

  try {
    const raw = window.localStorage.getItem(STARTUP_SNAPSHOT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return normalizeSnapshotPayload(parsed)
  } catch {
    return null
  }
}

export function saveStartupSnapshot(payload) {
  if (!canUseLocalStorage()) return null

  const normalized = normalizeSnapshotPayload(payload)
  if (!normalized) return null

  try {
    window.localStorage.setItem(STARTUP_SNAPSHOT_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    return null
  }

  return normalized
}

export function clearStartupSnapshot() {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.removeItem(STARTUP_SNAPSHOT_STORAGE_KEY)
  } catch {
    // Ignore browser storage failures.
  }
}

export function isStartupSnapshotUsable(payload, context = {}) {
  const normalized = normalizeSnapshotPayload(payload)
  if (!normalized) return false
  if (normalized.version !== STARTUP_SNAPSHOT_SCHEMA_VERSION) return false

  const expectedLang = typeof context?.lang === 'string' ? context.lang : ''
  const expectedSeason = typeof context?.season === 'string' ? context.season : ''
  const expectedYear = Number(context?.year || 0)

  if (!expectedLang || !expectedSeason || !expectedYear) return false
  if (normalized.lang !== expectedLang) return false
  if (normalized.season !== expectedSeason) return false
  if (normalized.year !== expectedYear) return false
  if (normalized.readiness?.ready !== true) return false

  return true
}
