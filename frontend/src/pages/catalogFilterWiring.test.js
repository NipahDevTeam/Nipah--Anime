import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const animeSource = readFileSync(resolve(import.meta.dirname, 'Search.jsx'), 'utf8')
const mangaSource = readFileSync(resolve(import.meta.dirname, 'MangaSearch.jsx'), 'utf8')

assert.ok(
  animeSource.includes('format: catalogFormat'),
  'Anime Online should pass the format filter into its catalog fetch request',
)

assert.ok(
  animeSource.includes('status: catalogStatus'),
  'Anime Online should pass the status filter into its catalog fetch request',
)

assert.ok(
  !animeSource.includes("if (catalogFormat && String(media?.format || '') !== catalogFormat) return false"),
  'Anime Online should not filter format only on the current client-side page',
)

assert.ok(
  !animeSource.includes("if (catalogStatus && String(media?.status || '') !== catalogStatus) return false"),
  'Anime Online should not filter status only on the current client-side page',
)

assert.ok(
  mangaSource.includes('format: catalogFormat'),
  'Manga Online should pass the format filter into its catalog fetch request',
)

assert.ok(
  mangaSource.includes('status: catalogStatus'),
  'Manga Online should pass the status filter into its catalog fetch request',
)

assert.ok(
  !mangaSource.includes("if (catalogFormat && String(item?.resolved_format || item?.format || '') !== catalogFormat) return false"),
  'Manga Online should not filter format only on the current client-side page',
)

assert.ok(
  !mangaSource.includes("if (catalogStatus && String(item?.resolved_status || item?.status || '') !== catalogStatus) return false"),
  'Manga Online should not filter status only on the current client-side page',
)

console.log('catalog filter wiring tests passed')
