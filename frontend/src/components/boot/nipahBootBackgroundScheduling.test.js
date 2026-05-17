import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve('frontend/src/components/boot/NipahBootRoot.jsx'), 'utf8')

assert.match(source, /const warmupPromise = runStartupWarmup\(queryClient,\s*\{/, 'boot root should retain the warmup promise before launching the shell even when wiring boot stage callbacks')
assert.match(source, /onStageChange\(nextStage\)/, 'boot root should forward warmup stage updates into boot UI state')
assert.match(source, /let warmup = null/, 'boot root should keep the latest warmup result while waiting for a fully ready Home snapshot')
assert.match(source, /warmup = await warmupPromise\.catch\(\(\) => null\)/, 'boot root should resolve each warmup pass before deciding whether startup can reveal')
assert.match(source, /warmup\?\.ready === true/, 'boot root should keep waiting until the full startup contract is ready before reveal')
assert.match(source, /warmup\?\.startBackground\?\.\(\)/, 'boot root should start background warmup explicitly after the shell is ready')
assert.doesNotMatch(source, /runStartupWarmup\(queryClient\),\s*\]\)/, 'boot root should not fire warmup inline without retaining its background scheduler')

console.log('nipah boot background scheduling tests passed')
