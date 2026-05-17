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
  source.includes("queryKey: ['gui2-home-startup-snapshot', lang, season, year]"),
  'GUI v2 Home should read a dedicated startup snapshot cache key seeded during boot',
)

assert.ok(
  source.includes("queryKey: ['gui2-home-startup-readiness', lang, season, year]"),
  'GUI v2 Home should also read the startup readiness state so the reveal contract stays aligned with boot',
)

assert.ok(
  source.includes('buildGui2HomeDataFromStartupSnapshot({'),
  'GUI v2 Home should be able to reconstruct a meaningful first-paint Home view from the boot snapshot',
)

assert.ok(
  source.includes('const effectiveHomeData = useMemo(() => {'),
  'GUI v2 Home should explicitly choose between live route data and the boot-seeded startup fallback',
)

assert.ok(
  source.includes('const liveHasPrimaryContent = useMemo(() => hasPrimaryHomeCatalogContent(homeData), [homeData])'),
  'GUI v2 Home should only drop the startup snapshot after live Home data proves both anime and manga catalog content are genuinely ready',
)

assert.ok(
  source.includes('const deferredHomeReady = homeMangaGenreQuery.isFetched && (!recommendationSeedIDs.length || homeMangaRecommendationsQuery.isFetched)'),
  'GUI v2 Home should wait for post-reveal hydration to finish before expanding beyond the guaranteed opening shelf set',
)

assert.ok(
  source.includes('const visibleAnimeLanes = deferredHomeReady ? animeLanes : animeLanes.slice(0, 3)'),
  'GUI v2 Home should keep the first reveal focused on the opening anime lanes before deeper rows fade in',
)

assert.ok(
  source.includes('const visibleMangaLanes = useMemo(() => {'),
  'GUI v2 Home should compute a reduced opening manga lane set before deferred hydration completes',
)

assert.equal(
  source.indexOf('{lane.subtitle ? <div className="gui2-homev2-band-subtitle">{lane.subtitle}</div> : null}'),
  -1,
  'GUI v2 Home discovery lanes should not render subtitle copy under row titles',
)

assert.equal(
  source.indexOf('{section.subtitle ? <div className="gui2-homev2-band-subtitle">{section.subtitle}</div> : null}'),
  -1,
  'GUI v2 Home shelf bands should not render subtitle copy under row titles',
)

assert.ok(
  source.includes('return (openingLanes.length > 0 ? openingLanes : mangaLanes).slice(0, 3)'),
  'GUI v2 Home should keep the first Manga reveal to a compact multi-lane set instead of collapsing to a single shelf',
)

assert.ok(
  source.includes("homeAniListQuery.data?.[row.key] ?? []"),
  'GUI v2 Home genre shelves should read from the bundled home payload instead of issuing per-row AniList requests',
)

assert.ok(
  source.includes("homeAniListQuery.data?.newlyTrending ?? []"),
  'GUI v2 Home should read a dedicated newly trending AniList shelf from the bundled home payload',
)

assert.ok(
  source.includes("homeAniListQuery.data?.seasonalPopular ?? []"),
  'GUI v2 Home should read a dedicated popular-this-season shelf from the bundled home payload',
)

assert.ok(
  source.includes("homeAniListQuery.data?.upcoming ?? []"),
  'GUI v2 Home should read a dedicated upcoming AniList shelf from the bundled home payload',
)

assert.ok(
  source.includes("homeAniListQuery.data?.lastSeason ?? []"),
  'GUI v2 Home should read a dedicated last-season shelf from the bundled home payload',
)

assert.ok(
  source.includes('const homeMangaRecommendationsQuery = useQuery({'),
  'GUI v2 Home should restore the dedicated manga recommendations query used to seed Manga Home shelves',
)

assert.ok(
  source.includes("queryKey: ['gui2-home-manga-recommendations', lang, recommendationSeedKey, recommendationExcludeKey]"),
  'GUI v2 Home should cache manga recommendations with their own GUI2 Home query key',
)

assert.ok(
  source.includes('mangaFeaturedRows:'),
  'GUI v2 Home should pass dedicated manga featured rows into the shared home data builder',
)

assert.ok(
  source.includes('mangaGenreRows:'),
  'GUI v2 Home should pass dedicated manga genre rows into the shared home data builder',
)

assert.ok(
  source.includes("const mangaRecentItems = useMemo(() => dedupeLaneItems(["),
  'GUI v2 Home should derive a dedicated manga recent rail source before building home data',
)

assert.ok(
  source.includes("...(homeMangaCatalogQuery.data?.recent ?? []),"),
  'GUI v2 Home should source the manga recent rail from the manga catalog recent-updates payload first',
)

assert.ok(
  source.includes('mangaRecentItems: mangaRecentItems,'),
  'GUI v2 Home should pass explicit manga recent rail items into the shared home data builder',
)

assert.ok(
  !source.includes("(dashboardQuery.data?.recently_watched ?? []).filter((item) => isMangaHistorySource(item?.source_id))"),
  'GUI v2 Home should not drive the recent chapter rail from recently read manga history',
)

assert.ok(
  source.includes(".slice(0, GUI2_HOME_POSTER_LIMIT)"),
  'GUI v2 Home should enrich each row with the expanded poster limit instead of the older sparse shelf count',
)

assert.ok(
  source.includes("status === 'NOT_YET_RELEASED'"),
  'GUI v2 Home should keep the Upcoming shelf exclusive to not-yet-released anime',
)

assert.ok(
  source.includes('const showHomeLoading = !effectiveHomeData.hero && effectiveHomeData.animeSections.length === 0 && effectiveHomeData.mangaSections.length === 0'),
  'GUI v2 Home should detect loading from the effective first-paint data source instead of ignoring the boot snapshot',
)

assert.ok(
  source.includes("Fetching AniList shelves..."),
  'GUI v2 Home should render an explicit loading state while AniList-backed hero content is still warming',
)

console.log('gui2 home signature wiring tests passed')
