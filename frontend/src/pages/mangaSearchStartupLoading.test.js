import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'MangaSearch.jsx'), 'utf8')

assert.ok(
  source.includes('const catalogBootLoading = !searched && !selected && catalogQuery.isLoading && displayedCatalog.length === 0'),
  'Manga Online should detect the boot-trailing catalog loading case once Home can reveal before the manga catalog arrives',
)

assert.ok(
  source.includes('ui.catalogBootLoading'),
  'Manga Online should expose a dedicated warm loading message for the trailing startup catalog state',
)

console.log('manga startup loading tests passed')
