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
  source.includes('const hydrateSelectedAnimeDetail = useCallback(async (selectedAnime) => {'),
  'Search should expose a dedicated detail hydrator for direct navigation payloads that already include a source match',
)

assert.ok(
  source.includes('const maybeEnrichSelectedEpisodeArtwork = useCallback(async (selectedAnime, selectionToken, perfToken = \'\') => {'),
  'Search should define an early donor-art enrichment pass for resolved source hits before the landing page has to recover thumbnail coverage later',
)

assert.ok(
  source.includes('if (!hasZeroThumbnailCoverage(prefetchedEpisodes)) return'),
  'Search should only trigger AnimePahe donor-art enrichment when the resolved provider episode list has zero thumbnail coverage',
)

assert.ok(
  source.includes('await enrichEpisodesWithAnimePaheArtwork(selectedAnime, prefetchedEpisodes, wails, appLang === \'en\' ? \'en\' : \'es\')'),
  'Search should start AnimePahe donor-art enrichment as soon as source resolution confirms the provider episode list has no episode art',
)

assert.ok(
  source.includes('void hydrateSelectedAnimeDetail(navState.selectedAnime)'),
  'Search should immediately hydrate direct selected anime navigation payloads instead of relying on a later silent detail fetch',
)

assert.ok(
  source.includes('const handleRecommendationOpen = useCallback((item) => {'),
  'Search should define a dedicated in-place recommendation opener instead of re-routing through the same page',
)

assert.ok(
  source.includes("document.querySelector('.gui2-content')?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })"),
  'Search recommendation hops should smoothly reset the shell scroll container before opening the next entry',
)

assert.ok(
  source.includes('void resolveAniListMedia(') && source.includes("`recommendation-${navigationEntry?.id || navigationEntry?.anilist_id || item?.key || 'anime'}`"),
  'Search recommendation clicks should reuse the same AniList-to-source resolution path as catalog cards',
)

assert.ok(
  source.includes('onRecommendationSelect={handleRecommendationOpen}'),
  'Search should pass the in-place recommendation opener down to the online anime detail view',
)

assert.ok(
  source.includes('const catalogBootLoading = !searched && !selected && catalogQuery.isLoading && displayedCatalog.length === 0'),
  'Anime Online should detect the boot-trailing catalog loading case once Home can reveal before the catalog arrives',
)

assert.ok(
  source.includes('ui.catalogBootLoading'),
  'Anime Online should expose a dedicated warm loading message for the trailing startup catalog state',
)

assert.ok(
  source.includes('searchAniListAnimeWithFallback('),
  'Search should run AniList anime lookups through the shared fallback helper so aliases and sequel fragments stay visible',
)

assert.ok(
  !source.includes('wails.getAniListAnimeCatalogHome(season, year)'),
  'Anime Online catalog should stay on the direct discover path instead of silently falling back to the heavier AniList home payload',
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
