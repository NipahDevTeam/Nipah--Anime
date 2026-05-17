import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const detailSource = readFileSync(resolve(import.meta.dirname, './OnlineAnimeDetail.jsx'), 'utf8')
const settingsSource = readFileSync(resolve(import.meta.dirname, '../../pages/Settings.jsx'), 'utf8')
const wailsSource = readFileSync(resolve(import.meta.dirname, '../../lib/wails.js'), 'utf8')

assert.ok(wailsSource.includes("player: 'mpv'"), 'preview settings should still fall back to MPV in browser-only mode')
assert.ok(detailSource.includes("const [playbackMode, setPlaybackMode] = useState('mpv')"), 'online anime detail should track a local playback mode selection')
assert.ok(detailSource.includes('gui2-landing-playback-toggle'), 'online anime detail should expose the playback mode switch in the episode queue tools')
assert.ok(detailSource.includes('ui.integratedMode'), 'online anime detail should expose the in-app playback label for testing')
assert.ok(detailSource.includes("modeOverride ?? playbackMode"), 'online anime detail should honor the selected playback mode when launching an episode')
assert.ok(!settingsSource.includes("{ value: 'integrated'"), 'settings can remain MPV-only until the dedicated settings pass revisits the global player picker')
assert.ok(settingsSource.includes('MPV is temporarily the only playback mode while we finish stabilizing the in-app player.'), 'settings should keep the current MPV-only copy until that dedicated pass lands')

console.log('online anime playback mode tests passed')
