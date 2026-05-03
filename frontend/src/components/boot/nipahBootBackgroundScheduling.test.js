import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve('frontend/src/components/boot/NipahBootRoot.jsx'), 'utf8')

assert.match(source, /const warmupPromise = runStartupWarmup\(queryClient\)/, 'boot root should retain the warmup promise before launching the shell')
assert.match(source, /const warmup = await warmupPromise\.catch\(\(\) => null\)/, 'boot root should resolve warmup state before scheduling background work')
assert.match(source, /warmup\?\.startBackground\?\.\(\)/, 'boot root should start background warmup explicitly after the shell is ready')
assert.doesNotMatch(source, /runStartupWarmup\(queryClient\),\s*\]\)/, 'boot root should not fire warmup inline without retaining its background scheduler')

console.log('nipah boot background scheduling tests passed')
