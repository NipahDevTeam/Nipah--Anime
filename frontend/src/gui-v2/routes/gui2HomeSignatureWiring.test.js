import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'Gui2HomeRoute.jsx'), 'utf8')

assert.ok(
  source.includes("wails.discoverAnime('', '', year, 'POPULARITY_DESC', '', '', 1)"),
  'GUI v2 Home popular shelf should pass the explicit format slot before the page argument',
)

assert.ok(
  source.includes("wails.discoverAnime('', season, year, 'TRENDING_DESC', 'RELEASING', '', 1)"),
  'GUI v2 Home trending shelf should preserve status and still pass the explicit format slot',
)

assert.ok(
  source.includes("wails.discoverAnime('', '', 0, 'SCORE_DESC', '', '', 1)"),
  'GUI v2 Home top-rated shelf should pass the explicit format slot before the page argument',
)

assert.ok(
  source.includes("GUI2_HOME_DISCOVERY_ROWS.map((row) => wails.discoverAnime(row.genre, '', 0, 'POPULARITY_DESC', '', '', 1))"),
  'GUI v2 Home genre shelves should pass the explicit format slot before the page argument',
)

console.log('gui2 home signature wiring tests passed')
