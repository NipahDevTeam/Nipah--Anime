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
  source.includes("wails.getAniListAnimeCatalogHome(season, year)"),
  'Startup warmup should seed the bundled anime home AniList payload before the gui-v2 Home route renders',
)

assert.ok(
  source.includes("timeoutMs: 9000"),
  'Startup warmup should give the bundled Home AniList payload a longer cold-start blocking window so the first Home shelf fetch stays behind the boot screen when possible',
)

console.log('startup warmup signature wiring tests passed')
