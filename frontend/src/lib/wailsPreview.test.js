import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPreviewDashboard, buildPreviewWatchHistory } from './wails.js'

const previewDashboard = buildPreviewDashboard()
assert.ok(previewDashboard.continue_watching_online.length > 0)
assert.ok(previewDashboard.recent_anime.length > 0)
assert.ok(previewDashboard.stats.anime > 0)
assert.ok(previewDashboard.stats.online_anime > 0)

const previewHistory = buildPreviewWatchHistory(3)
assert.equal(previewHistory.length, 3)
assert.ok(previewHistory[0].anime_title)
assert.ok(previewHistory[0].cover_url)
assert.ok(previewHistory[0].source_id)

const wailsSource = readFileSync(resolve(import.meta.dirname, './wails.js'), 'utf8')
assert.ok(wailsSource.includes('const runtimeWarmCache = new Map()'), 'runtime bridge should expose a warm cache for repeated source lookups')
assert.ok(wailsSource.includes('rememberRuntimeCache(['), 'runtime bridge should memoize slow source and chapter calls')
assert.ok(wailsSource.includes("['anilist-anime-detail', Number(id) || 0]"), 'runtime bridge should memoize AniList anime detail payloads')
assert.ok(wailsSource.includes("['anilist-manga-detail', Number(id) || 0]"), 'runtime bridge should memoize AniList manga detail payloads')

console.log('wails preview tests passed')
