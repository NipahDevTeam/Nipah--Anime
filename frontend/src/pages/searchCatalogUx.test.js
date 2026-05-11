import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, './Search.jsx'), 'utf8')

assert.ok(
  source.includes('noResultsMetadata: (query) => isEnglish'),
  'Anime catalog search should expose an AniList-first empty-state copy helper',
)

assert.ok(
  source.includes('Could not find "${query}" in AniList metadata. Try the Japanese, Romaji, or English title.'),
  'Anime catalog empty-state copy should explain AniList metadata matching rather than source failure',
)

assert.ok(
  source.includes('ui.noResultsMetadata(query)'),
  'Anime catalog search should render the AniList metadata empty-state copy',
)

assert.ok(
  !source.includes('ui.noResultsSource('),
  'Anime catalog search should not blame source availability during plain AniList search',
)

console.log('search catalog ux tests passed')
