import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'startupWarmup.js'), 'utf8')

assert.ok(
  source.includes("await wails.discoverManga('', 0, 'TRENDING_DESC', '', '', 1)"),
  'Startup warmup should pass explicit status and format slots before the manga catalog page argument',
)

assert.ok(
  source.includes("await wails.discoverAnime('', '', 0, 'TRENDING_DESC', '', '', 1)"),
  'Startup warmup default anime catalog prefetch should pass the explicit format slot before the page argument',
)

assert.ok(
  source.includes("() => wails.discoverAnime('', '', year, 'POPULARITY_DESC', '', '', 1)"),
  'Startup warmup popular shelf should pass the explicit format slot before the page argument',
)

assert.ok(
  source.includes("() => wails.discoverAnime('', season, year, 'TRENDING_DESC', 'RELEASING', '', 1)"),
  'Startup warmup seasonal shelf should preserve status and still pass the explicit format slot',
)

assert.ok(
  source.includes("() => wails.discoverAnime('', '', 0, 'SCORE_DESC', '', '', 1)"),
  'Startup warmup top-rated shelf should pass the explicit format slot before the page argument',
)

console.log('startup warmup signature wiring tests passed')
