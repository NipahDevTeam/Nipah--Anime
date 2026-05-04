import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'Gui2HomeRoute.jsx'), 'utf8')

assert.ok(
  source.includes("wails.getAniListAnimeCatalogHome(season, year)"),
  'GUI v2 Home should load its AniList shelves through the bundled anime home payload',
)

assert.ok(
  source.includes("queryKey: ['gui2-home-anilist', lang, season, year]"),
  'GUI v2 Home should seed and read a dedicated bundled AniList home cache key',
)

assert.ok(
  source.includes("homeAniListQuery.data?.[row.key] ?? []"),
  'GUI v2 Home genre shelves should read from the bundled home payload instead of issuing per-row AniList requests',
)

assert.ok(
  source.includes('const showHomeLoading = !homeData.hero && homeData.sections.length === 0'),
  'GUI v2 Home should detect when AniList shelves are still loading instead of rendering the empty fallback hero as if it were real content',
)

assert.ok(
  source.includes("Fetching AniList shelves..."),
  'GUI v2 Home should render an explicit loading state while AniList-backed hero content is still warming',
)

console.log('gui2 home signature wiring tests passed')
