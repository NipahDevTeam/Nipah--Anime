import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bootSource = readFileSync(resolve(import.meta.dirname, './NipahBootRoot.jsx'), 'utf8')
const cssSource = readFileSync(resolve(import.meta.dirname, '../../gui-v2/styles/gui2.css'), 'utf8')
const indexHtml = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')

assert.ok(
  bootSource.includes('nipah-boot-cozy-host-transparent.png'),
  'boot overlay should import the transparent production chibi asset instead of the matted placeholder image',
)

assert.ok(
  !cssSource.includes('mix-blend-mode: darken;'),
  'transparent production art should not depend on darken blending to hide a white rectangle',
)

assert.ok(
  cssSource.includes('.gui2-boot-scene-lamp {'),
  'boot CSS should define the outer room lamp cue so the frameless window perimeter feels authored',
)

assert.ok(
  cssSource.includes('.gui2-boot-scene-desk {'),
  'boot CSS should define a desk plane so the chamber does not float in dead space',
)

assert.ok(
  cssSource.includes('width: 100vw;'),
  'boot chamber should take over the full boot window so the perimeter no longer reads as a shell around it',
)

assert.ok(
  cssSource.includes('min-height: 100dvh;'),
  'boot chamber should own the full boot window height instead of sitting inset inside a dark wrapper',
)

assert.ok(
  cssSource.includes('padding: 0;'),
  'boot room wrapper should not keep extra padding that recreates a blank moat around the chamber',
)

assert.ok(
  cssSource.includes("font-family: 'DM Sans', 'Plus Jakarta Sans', sans-serif;"),
  'boot catchphrase should use a softer text face that sits more gently inside the room composition',
)

assert.ok(
  cssSource.includes('.gui2-boot-status-track {'),
  'boot should expose a dedicated loading track',
)

assert.ok(
  !cssSource.includes('.gui2-boot-status-mark {'),
  'live boot should not keep rail marks once the loading indicator is reduced to a single wandering drop',
)

assert.ok(
  !indexHtml.includes('boot-fallback-status-mark'),
  'fallback boot should not keep rail marks once the loading indicator is reduced to a single wandering drop',
)

assert.ok(
  cssSource.includes('@keyframes gui2BootDropWander'),
  'live boot should animate the loading indicator as a small wandering drop instead of a sliding bar',
)

assert.ok(
  indexHtml.includes('@keyframes bootFallbackDropWander'),
  'fallback boot should mirror the same wandering drop animation as the live overlay',
)

assert.ok(
  cssSource.includes('@keyframes gui2BootLampDrift'),
  'boot should include a lived-in lamp drift animation instead of staying visually static',
)

assert.ok(
  cssSource.includes('@keyframes gui2BootAtmosphereFloat'),
  'boot should include ambient room motion so the startup screen feels lived-in',
)

assert.ok(
  indexHtml.includes('boot-fallback-status-track'),
  'fallback boot HTML should carry the same loading track structure as the live overlay',
)

console.log('boot visual contract tests passed')
