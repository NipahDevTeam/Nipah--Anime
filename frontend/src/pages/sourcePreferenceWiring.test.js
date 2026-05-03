import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const animeSource = readFileSync(resolve(import.meta.dirname, 'Search.jsx'), 'utf8')
const mangaSource = readFileSync(resolve(import.meta.dirname, 'MangaSearch.jsx'), 'utf8')

assert.ok(
  animeSource.includes('resolveSavedOnlineSourcePreference'),
  'Anime Online should resolve its initial source from persisted settings before using fallback defaults',
)

assert.ok(
  animeSource.includes('buildPreferredSourceSettingsPatch'),
  'Anime Online should persist source changes through the shared source-preference helper',
)

assert.ok(
  mangaSource.includes('resolveSavedOnlineSourcePreference'),
  'Manga Online should resolve its initial source from persisted settings before using fallback defaults',
)

assert.ok(
  mangaSource.includes('buildPreferredSourceSettingsPatch'),
  'Manga Online should persist source changes through the shared source-preference helper',
)

console.log('source preference wiring tests passed')
