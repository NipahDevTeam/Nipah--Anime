import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'MangaSearch.jsx'), 'utf8')

assert.ok(
  source.includes('await wails.searchMangaGlobal(term, lang)'),
  'Manga Online typed search should use the AniList-backed global catalog search',
)

assert.ok(
  !source.includes("const [manualMode, setManualMode] = useState(false)"),
  'Manga Online should not keep a dedicated direct-source search mode in the page state',
)

assert.ok(
  !source.includes('manualModeTitle'),
  'Manga Online should not render the legacy direct-source search messaging',
)

assert.ok(
  !source.includes('runDirectSearch('),
  'Manga Online typed search should not run a direct source search path before the user opens a result',
)

assert.ok(
  source.includes('onClick={() => openCanonicalItem(item, { returnMode: \'results\' })}'),
  'Manga Online typed search results should open the canonical item and defer source resolution until click',
)

assert.ok(
  source.includes('AniList is having upstream API problems right now. Catalog browsing is temporarily unavailable, so source resolution will resume after AniList recovers.'),
  'Manga Online should explain AniList outages without claiming the page switches into direct source search mode',
)

console.log('manga search catalog mode tests passed')
