import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const homeSource = readFileSync(resolve(import.meta.dirname, 'Home.jsx'), 'utf8')
const discoverSource = readFileSync(resolve(import.meta.dirname, 'Descubrir.jsx'), 'utf8')

assert.ok(
  homeSource.includes("wails.discoverAnime('', '', currentYear, 'POPULARITY_DESC', '', '', 1)"),
  'Home should pass the explicit format slot before the page argument for discoverAnime',
)

assert.ok(
  homeSource.includes("wails.discoverAnime('', '', currentYear, 'START_DATE_DESC', '', '', 1)"),
  'Home new releases should pass the explicit format slot before the page argument',
)

assert.ok(
  homeSource.includes("wails.discoverAnime(row.genre, '', 0, 'POPULARITY_DESC', '', '', 1)"),
  'Home genre shelves should pass the explicit format slot before the page argument',
)

assert.ok(
  discoverSource.includes("wails.discoverAnime('', '', currentYear, 'POPULARITY_DESC', '', '', 1)"),
  'Discover should pass the explicit format slot before the page argument',
)

assert.ok(
  discoverSource.includes("wails.discoverAnime('', '', 0, 'POPULARITY_DESC', 'FINISHED', '', 1)"),
  'Discover recommended shelf should preserve status and still pass an explicit format slot',
)

assert.ok(
  discoverSource.includes("wails.discoverAnime(row.genre, '', 0, 'POPULARITY_DESC', '', '', 1)"),
  'Discover genre shelves should pass the explicit format slot before the page argument',
)

console.log('discover anime signature wiring tests passed')
