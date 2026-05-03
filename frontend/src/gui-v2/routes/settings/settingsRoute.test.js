import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routePath = resolve(import.meta.dirname, '../Gui2SettingsRoute.jsx')
const appPath = resolve(import.meta.dirname, '../../Gui2App.jsx')
const cssPath = resolve(import.meta.dirname, '../../styles/gui2.css')

const routeSource = readFileSync(routePath, 'utf8')
const appSource = readFileSync(appPath, 'utf8')
const cssSource = readFileSync(cssPath, 'utf8')

assert.ok(routeSource.includes('AniList'), 'settings route should keep AniList integration')
assert.ok(!routeSource.includes('MyAnimeList'), 'settings route should not expose MyAnimeList controls')
assert.ok(!routeSource.includes('preferred_audio'), 'settings route should not expose preferred audio controls')
assert.ok(routeSource.includes('gui2-settingsv2'), 'settings route should render the new settings v2 shell')
assert.ok(appSource.includes("if (canonical === '/settings') return <Gui2SettingsRoute />"), 'gui2 app should mount the dedicated settings route')
assert.ok(cssSource.includes('.gui2-settingsv2-workspace'), 'settings v2 CSS should exist')

console.log('gui2 settings route tests passed')
