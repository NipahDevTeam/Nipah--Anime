import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const detailSource = readFileSync(resolve(import.meta.dirname, './OnlineAnimeDetail.jsx'), 'utf8')
const settingsSource = readFileSync(resolve(import.meta.dirname, '../../pages/Settings.jsx'), 'utf8')
const wailsSource = readFileSync(resolve(import.meta.dirname, '../../lib/wails.js'), 'utf8')

assert.ok(wailsSource.includes("player: 'mpv'"), 'preview settings should default to MPV while the in-app player is hidden')
assert.ok(detailSource.includes('Temporarily the only playback mode while the in-app player is being stabilized.'), 'online anime detail should explain that MPV is temporarily the only playback mode')
assert.ok(!detailSource.includes("handlePlayerModeChange('integrated')"), 'online anime detail should not expose an integrated player toggle')
assert.ok(!settingsSource.includes("{ value: 'integrated'"), 'settings should not offer the integrated player as an option')
assert.ok(settingsSource.includes('MPV is temporarily the only playback mode while we finish stabilizing the in-app player.'), 'settings should explain that MPV is temporarily the only playback mode')

console.log('online anime playback mode tests passed')
