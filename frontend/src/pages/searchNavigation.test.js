import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'Search.jsx'), 'utf8')

assert.ok(
  source.includes("const defaultSourceID = appLang === 'en' ? 'animeheaven-en' : 'animeav1-es'"),
  'Search should derive a default source before reading navigation state',
)

assert.ok(
  source.includes("const [activeSource, setActiveSource] = useState(defaultSourceID)"),
  'Search should keep its default source stable for first render',
)

assert.ok(
  source.includes("const [selected, setSelected] = useState(() => getInitialSelectedAnimePayload(location.state, defaultSourceID))"),
  'Search should normalize selected anime from navigation state on initial mount',
)

assert.ok(
  source.includes('if (navState.seedAniListMedia) {'),
  'Search should support opening a seeded AniList media shell from navigation state',
)

assert.ok(
  source.includes('wails.getAniListAnimeByID'),
  'Search should be able to hydrate sparse AniList-seeded navigation payloads before opening the detail shell',
)

assert.ok(
  source.includes('const hydratedMedia = aniListID > 0 ? await wails.getAniListAnimeByID(aniListID).catch(() => null) : null'),
  'Search should hydrate sparse seeded anime navigation payloads before rendering the landing shell',
)

assert.ok(
  source.includes('searchAniListAnimeWithFallback('),
  'Search should run AniList anime lookups through the shared fallback helper so aliases and sequel fragments stay visible',
)

assert.ok(
  source.includes('wails.getAniListAnimeCatalogHome(season, year)'),
  'Anime Online catalog fallback should reuse the bundled AniList home payload instead of collapsing to the 20-card trending fallback',
)

assert.ok(
  !source.includes('prewarmAniListAnimeDetails('),
  'Anime Online typed search should not launch extra AniList detail warmups after every search result set',
)

assert.ok(
  !source.includes('wails.searchOnline(candidate, activeSource)'),
  'Anime Online typed search should not perform direct provider searches before a card is clicked',
)

assert.ok(
  source.includes("onClick={() => resolveAniListMedia(item, `search-${item.id || index}`, { returnMode: 'results' })}"),
  'Anime Online typed search cards should resolve the chosen AniList result only after click',
)

assert.ok(
  !source.includes('badge={<SourceBadge sourceID={item.source_id} />}'),
  'Anime Online typed search cards should no longer render provider-first result badges',
)

console.log('search navigation tests passed')
