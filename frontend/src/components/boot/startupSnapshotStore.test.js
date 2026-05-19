import assert from 'node:assert/strict'
import {
  STARTUP_SNAPSHOT_SCHEMA_VERSION,
  clearStartupSnapshot,
  isStartupSnapshotUsable,
  loadStartupSnapshot,
  saveStartupSnapshot,
} from './startupSnapshotStore.js'

global.window = {
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, value) {
      this.store.set(key, String(value))
    },
    removeItem(key) {
      this.store.delete(key)
    },
  },
}

clearStartupSnapshot()
assert.deepEqual(loadStartupSnapshot(), null)

saveStartupSnapshot({
  lang: 'en',
  season: 'FALL',
  year: 2026,
  snapshot: { anime: { hero: { id: 1 } } },
  readiness: { ready: true, mode: 'full', missing: [] },
})

const persisted = loadStartupSnapshot()
assert.equal(persisted?.version, STARTUP_SNAPSHOT_SCHEMA_VERSION)
assert.equal(persisted?.lang, 'en')
assert.equal(persisted?.season, 'FALL')
assert.equal(persisted?.year, 2026)
assert.deepEqual(persisted?.snapshot, { anime: { hero: { id: 1 } } })
assert.deepEqual(persisted?.readiness, { ready: true, mode: 'full', missing: [] })
assert.equal(typeof persisted?.savedAt, 'number')

assert.equal(
  isStartupSnapshotUsable(
    {
      version: STARTUP_SNAPSHOT_SCHEMA_VERSION,
      lang: 'en',
      season: 'FALL',
      year: 2026,
      snapshot: {},
      readiness: { ready: true },
      savedAt: Date.now(),
    },
    { lang: 'en', season: 'FALL', year: 2026 },
  ),
  true,
)

assert.equal(
  isStartupSnapshotUsable(
    {
      version: STARTUP_SNAPSHOT_SCHEMA_VERSION - 1,
      lang: 'en',
      season: 'FALL',
      year: 2026,
      snapshot: {},
      readiness: { ready: true },
      savedAt: Date.now(),
    },
    { lang: 'en', season: 'FALL', year: 2026 },
  ),
  false,
)

assert.equal(
  isStartupSnapshotUsable(
    {
      version: STARTUP_SNAPSHOT_SCHEMA_VERSION,
      lang: 'es',
      season: 'FALL',
      year: 2026,
      snapshot: {},
      readiness: { ready: true },
      savedAt: Date.now(),
    },
    { lang: 'en', season: 'FALL', year: 2026 },
  ),
  false,
)

window.localStorage.setItem('nipah.startup.snapshot.v1', '{bad json')
assert.deepEqual(loadStartupSnapshot(), null)

console.log('startup snapshot store tests passed')
