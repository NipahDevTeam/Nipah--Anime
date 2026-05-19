import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const overlayPath = resolve(import.meta.dirname, './MetadataFallbackOverlay.jsx')
const appPath = resolve(import.meta.dirname, '../../gui-v2/Gui2App.jsx')
const statusPath = resolve(import.meta.dirname, '../../lib/anilistStatus.js')
const cssPath = resolve(import.meta.dirname, '../../gui-v2/styles/gui2.css')

const overlaySource = readFileSync(overlayPath, 'utf8')
const appSource = readFileSync(appPath, 'utf8')
const statusSource = readFileSync(statusPath, 'utf8')
const css = readFileSync(cssPath, 'utf8')

assert.ok(overlaySource.includes('AniList API is currently unstable; Jikan API is currently active. AniList tracking is not enabled right now!'), 'overlay should explain that Jikan fallback is active and AniList tracking is unavailable')
assert.ok(overlaySource.includes('sessionStorage'), 'overlay should persist dismissal only for the current session')
assert.ok(overlaySource.includes('activated_at_unix'), 'overlay should key visibility to the current fallback activation timestamp')
assert.ok(overlaySource.includes('getMetadataSourceStatus'), 'overlay should read metadata-source health through the shared Wails bridge')
assert.ok(overlaySource.includes('dismissedActivation === activationKey'), 'overlay should stay hidden only for the matching activation')
assert.ok(statusSource.includes('isAniListMetadataFallbackActive'), 'AniList status helpers should expose a dedicated metadata fallback gate')
assert.ok(appSource.includes('<MetadataFallbackOverlay />'), 'GUI2 shell should mount the metadata fallback overlay')
assert.ok(css.includes('.metadata-fallback-overlay {'), 'GUI2 styles should include the metadata fallback overlay shell')
assert.ok(css.includes('.metadata-fallback-overlay__dismiss {'), 'GUI2 styles should include the overlay dismiss action')

console.log('metadata fallback overlay tests passed')
