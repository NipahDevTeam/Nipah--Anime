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
  source.includes('recommendations: Array.isArray(item.recommendations) ? item.recommendations : []'),
  'Manga Online should preserve AniList recommendation arrays when normalizing canonical detail payloads',
)

assert.ok(
  source.includes("queryKey: ['manga-detail-anilist-v3', selected?.anilist_id ?? 0, lang]"),
  'Manga Online should version the AniList detail query key so stale pre-recommendation caches do not suppress entry recommendations',
)

assert.ok(
  source.includes('const hydrateSelectedMangaDetail = useCallback(async (selectedManga) => {'),
  'Manga Online should expose a dedicated AniList detail hydrator so the selected landing shell can enrich independently of source resolution',
)

assert.ok(
  source.includes('recommendations: Array.isArray(detail?.recommendations) ? detail.recommendations : (current?.recommendations || [])'),
  'Manga Online should merge AniList recommendation payloads directly into the selected shell when the detail hydrator completes',
)

assert.ok(
  source.includes('const hydratePreferredNavigationItem = async () => {'),
  'Manga Online should define a dedicated preferred-entry hydrator for navigation launches',
)

assert.ok(
  source.includes('const hydratedPreferred = await hydratePreferredNavigationItem()'),
  'Manga Online should try the full AniList manga detail payload before opening a seeded navigation item shell',
)

assert.ok(
  source.includes('void hydrateSelectedMangaDetail(nextSession)'),
  'Manga Online should start hydrating the selected AniList detail shell immediately after opening a canonical item',
)

assert.ok(
  source.includes('const handleRecommendationOpen = useCallback((item) => {'),
  'Manga Online should define a dedicated in-place recommendation opener instead of re-routing through the same page',
)

assert.ok(
  source.includes("document.querySelector('.gui2-content')?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })"),
  'Manga Online recommendation hops should smoothly reset the shell scroll container before opening the next entry',
)

assert.ok(
  source.includes("openCanonicalItem(normalizeCanonicalItem(navigationEntry, lang), { returnMode: 'catalog' })"),
  'Manga Online recommendation clicks should reuse the canonical open flow used by catalog cards',
)

assert.ok(
  source.includes('onRecommendationSelect={handleRecommendationOpen}'),
  'Manga Online should pass the in-place recommendation opener down to the landing detail view',
)

assert.ok(
  source.includes('AniList is having upstream API problems right now. Catalog browsing is temporarily unavailable, so source resolution will resume after AniList recovers.'),
  'Manga Online should explain AniList outages without claiming the page switches into direct source search mode',
)

assert.ok(
  !source.includes('wails.getAniListMangaCatalogHome(lang)'),
  'Manga Online catalog should stay on the direct discover path instead of silently switching to the heavier home payload',
)

assert.ok(
  !source.includes('pageInfo: { hasNextPage: false }'),
  'Manga Online catalog should not collapse into a forced single-page fallback when discover fails',
)

console.log('manga search catalog mode tests passed')
