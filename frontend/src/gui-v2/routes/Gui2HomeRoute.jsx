import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../lib/i18n'
import { buildAnimeNavigationState } from '../../lib/mediaNavigation'
import { proxyImage, wails } from '../../lib/wails'
import {
  GUI2_HOME_DISCOVERY_ROWS,
  GUI2_HOME_HERO_FADE_MS,
  GUI2_HOME_HERO_ROTATE_MS,
  GUI2_HOME_POSTER_LIMIT,
  buildGui2HomeData,
  buildGui2HomeDataFromStartupSnapshot,
  getNextHomeHeroIndex,
  hasPrimaryHomeCatalogContent,
} from './home/homeData'
import { buildMotionVars, buildStaggerDelayMs } from '../motion/gui2Motion'

const GUI2_HOME_LANE_ROTATE_MS = 6200
const GUI2_HOME_LANE_ROTATE_VARIANCE_MS = 1800
const GUI2_HOME_LANE_INITIAL_DELAY_MS = 900
const GUI2_HOME_LANE_INITIAL_VARIANCE_MS = 2600

function getCurrentAniListSeason() {
  const now = new Date()
  const month = now.getMonth() + 1
  if (month <= 3) return { season: 'WINTER', year: now.getFullYear() }
  if (month <= 6) return { season: 'SPRING', year: now.getFullYear() }
  if (month <= 9) return { season: 'SUMMER', year: now.getFullYear() }
  return { season: 'FALL', year: now.getFullYear() }
}

function shiftAniListSeason(season, year, offset = 0) {
  const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
  const seasonIndex = Math.max(0, seasons.indexOf(String(season || '').toUpperCase()))
  const totalIndex = seasonIndex + offset
  const normalizedIndex = ((totalIndex % seasons.length) + seasons.length) % seasons.length
  const yearShift = Math.floor((seasonIndex + offset) / seasons.length)
  return {
    season: seasons[normalizedIndex],
    year: year + yearShift,
  }
}

function uniqueMedia(items) {
  const seen = new Set()
  return (items || []).filter((item) => {
    const key = Number(item?.id || 0)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function toAniListMediaList(result) {
  return uniqueMedia(result?.data?.Page?.media ?? [])
}

function hashLaneKey(key = '') {
  return [...String(key || '')].reduce((accumulator, character, index) => (
    accumulator + character.charCodeAt(0) * (index + 1)
  ), 0)
}

function getLaneRotateMs(laneKey, motionIndex = 0) {
  const variance = hashLaneKey(laneKey) % GUI2_HOME_LANE_ROTATE_VARIANCE_MS
  return GUI2_HOME_LANE_ROTATE_MS + variance + motionIndex * 120
}

function getLaneInitialDelayMs(laneKey, motionIndex = 0) {
  const variance = hashLaneKey(`${laneKey}-${motionIndex}`) % GUI2_HOME_LANE_INITIAL_VARIANCE_MS
  return GUI2_HOME_LANE_INITIAL_DELAY_MS + variance
}

function HomePosterCard({ item, onClick }) {
  return (
    <button type="button" className="gui2-homev2-poster" onClick={onClick} title={item.title}>
      <div className="gui2-homev2-poster-hitarea">
        <div className="gui2-homev2-poster-art">
          {item.image ? (
            <img src={proxyImage(item.image)} alt={item.title} className="gui2-homev2-poster-image" />
          ) : (
            <div className="gui2-homev2-poster-fallback">{item.title.slice(0, 1)}</div>
          )}
          <div className="gui2-homev2-poster-overlay" />
          {item.meta ? <div className="gui2-homev2-poster-chip">{item.meta}</div> : null}
          <div className="gui2-homev2-poster-pop">{'Open'}</div>
        </div>
        <div className="gui2-homev2-poster-copy">
          <div className="gui2-homev2-poster-title">{item.title}</div>
          {item.meta ? <div className="gui2-homev2-poster-meta">{item.meta}</div> : null}
        </div>
      </div>
    </button>
  )
}

function HomeContinueCard({ item, onClick }) {
  return (
    <button type="button" className="gui2-homev2-continue" onClick={onClick} title={item.title}>
      <div className="gui2-homev2-continue-art">
        {item.image ? (
          <img src={proxyImage(item.image)} alt={item.title} className="gui2-homev2-continue-image" />
        ) : (
          <div className="gui2-homev2-continue-fallback">{item.title.slice(0, 1)}</div>
        )}
        <div className="gui2-homev2-continue-overlay" />
        <span className="gui2-homev2-playmark" aria-hidden="true">{'>'}</span>
      </div>
      <div className="gui2-homev2-continue-copy">
        <div className="gui2-homev2-continue-title">{item.title}</div>
        <div className="gui2-homev2-continue-meta">{item.meta}</div>
        <div className="gui2-homev2-progress">
          <span className="gui2-homev2-progress-bar">
            <span className="gui2-homev2-progress-fill" style={{ width: `${item.progressPercent}%` }} />
          </span>
          <span className="gui2-homev2-progress-label">{item.progressPercent}%</span>
        </div>
      </div>
    </button>
  )
}

function HomeRecentFeature({ item, onClick, isEnglish = false, motionIndex = 0 }) {
  const metaLabel = item.chapterLabel || item.episodeLabel
  return (
    <div
      className="gui2-homev2-recent-feature-shell gui2-motion-enter"
      style={{ ...buildMotionVars('card'), animationDelay: `${buildStaggerDelayMs(motionIndex, 24)}ms` }}
    >
      <button type="button" className="gui2-homev2-recent-feature" onClick={onClick} title={item.title}>
        <div className="gui2-homev2-recent-feature-art">
          {item.image ? (
            <img src={proxyImage(item.image)} alt={item.title} className="gui2-homev2-recent-feature-image" />
          ) : (
            <div className="gui2-homev2-recent-feature-fallback">{item.title.slice(0, 1)}</div>
          )}
          <div className="gui2-homev2-recent-feature-overlay" />
          <div className="gui2-homev2-recent-feature-copy">
            <div className="gui2-homev2-recent-feature-kicker">{isEnglish ? 'Recently updated' : 'Recientemente actualizado'}</div>
            <div className="gui2-homev2-recent-feature-title">{item.title}</div>
            <div className="gui2-homev2-recent-feature-meta">
              <span>{metaLabel}</span>
              <span>{item.ageLabel}</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}

function HomeRecentMini({ item, active = false, onClick }) {
  const metaLabel = item.chapterLabel || item.episodeLabel
  return (
    <button
      type="button"
      className={`gui2-homev2-recent-mini${active ? ' active' : ''}`}
      onClick={onClick}
      title={item.title}
    >
      <div className="gui2-homev2-recent-mini-art">
        {item.image ? (
          <img src={proxyImage(item.image)} alt={item.title} className="gui2-homev2-recent-mini-image" />
        ) : (
          <div className="gui2-homev2-recent-mini-fallback">{item.title.slice(0, 1)}</div>
        )}
      </div>
      <div className="gui2-homev2-recent-mini-copy">
        <div className="gui2-homev2-recent-mini-title">{item.title}</div>
        <div className="gui2-homev2-recent-mini-meta">
          <span>{metaLabel}</span>
          <span>{item.ageLabel}</span>
        </div>
      </div>
    </button>
  )
}

function HomeRecentRow({ item, onClick, motionIndex = 0 }) {
  const metaLabel = item.chapterLabel || item.episodeLabel
  return (
    <div
      className="gui2-homev2-recent-shell gui2-motion-enter"
      style={{ ...buildMotionVars('card'), animationDelay: `${buildStaggerDelayMs(motionIndex, 18)}ms` }}
    >
      <button type="button" className="gui2-homev2-recent-row" onClick={onClick} title={item.title}>
        <div className="gui2-homev2-recent-thumb">
          {item.image ? (
            <img src={proxyImage(item.image)} alt={item.title} className="gui2-homev2-recent-image" />
          ) : (
            <div className="gui2-homev2-recent-fallback">{item.title.slice(0, 1)}</div>
          )}
        </div>
        <div className="gui2-homev2-recent-copy">
          <div className="gui2-homev2-recent-title">{item.title}</div>
          <div className="gui2-homev2-recent-episode">{metaLabel}</div>
          <div className="gui2-homev2-recent-age">{item.ageLabel}</div>
        </div>
      </button>
    </div>
  )
}

function HomeLoadingSection({ isEnglish = false }) {
  return (
    <section className="gui2-homev2-band gui2-homev2-band-loading" aria-hidden="true">
      <div className="gui2-homev2-band-head">
        <div className="gui2-homev2-band-copy">
          <div className="gui2-homev2-band-title">{isEnglish ? 'Loading Shelves' : 'Cargando secciones'}</div>
          <div className="gui2-homev2-band-subtitle">
            {isEnglish ? 'Preparing the first AniList rows for Home.' : 'Preparando las primeras filas de AniList para Home.'}
          </div>
        </div>
      </div>
      <div className="gui2-homev2-loading-poster-rail">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`home-loading-card-${index}`} className="gui2-homev2-loading-poster" />
        ))}
      </div>
    </section>
  )
}

function dedupeLaneItems(items = []) {
  const seen = new Set()
  return items.filter((item) => {
    const key = String(item?.id || item?.title || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildLaneGenreTabs(items = [], isEnglish = false) {
  const genreCounts = new Map()
  for (const item of items) {
    const genres = Array.isArray(item?.selectedAnime?.genres)
      ? item.selectedAnime.genres
      : (Array.isArray(item?.genres) ? item.genres : [])
    for (const genre of genres) {
      const normalized = String(genre || '').trim()
      if (!normalized) continue
      genreCounts.set(normalized, (genreCounts.get(normalized) || 0) + 1)
    }
  }

  return [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([genre]) => ({
      key: `genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: genre,
      items: items.filter((item) => {
        const genres = Array.isArray(item?.selectedAnime?.genres)
          ? item.selectedAnime.genres
          : (Array.isArray(item?.genres) ? item.genres : [])
        return genres.includes(genre)
      }),
      emptyLabel: isEnglish ? 'No genre matches' : 'Sin coincidencias de genero',
    }))
    .filter((tab) => tab.items.length > 0)
}

function buildLaneTab(key, label, section, itemsOverride = null) {
  const resolvedItems = Array.isArray(itemsOverride) ? itemsOverride : (section?.items || [])
  return {
    key,
    label,
    href: section?.href || '/anime-online',
    items: dedupeLaneItems(resolvedItems).slice(0, GUI2_HOME_POSTER_LIMIT),
  }
}

function chunkLaneItems(items = [], pageSize = 7, step = 3) {
  if (!items.length) return []
  if (items.length <= pageSize) return [items]

  const pages = []
  for (let start = 0; start + pageSize < items.length; start += step) {
    pages.push(items.slice(start, start + pageSize))
  }

  const finalStart = Math.max(items.length - pageSize, 0)
  if (!pages.length || pages[pages.length - 1]?.[0]?.id !== items[finalStart]?.id) {
    pages.push(items.slice(finalStart, finalStart + pageSize))
  }

  return pages
}

function HomeLane({ lane, activeTabKey, onChangeTab, onOpenPoster, motionIndex = 0 }) {
  const tabs = lane.tabs.filter((tab) => (tab?.items?.length || 0) > 0)
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeTabKey))
  const clampedActiveIndex = activeIndex >= 0 ? activeIndex : 0
  const activeTab = tabs[clampedActiveIndex] || tabs[0]
  const lanePages = useMemo(() => chunkLaneItems(activeTab?.items || [], 7, 3), [activeTab])
  const rotateMs = useMemo(() => getLaneRotateMs(lane.key, motionIndex), [lane.key, motionIndex])
  const initialDelayMs = useMemo(() => getLaneInitialDelayMs(lane.key, motionIndex), [lane.key, motionIndex])
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    setPageIndex(0)
  }, [activeTab?.key])

  const clampedPageIndex = Math.min(pageIndex, Math.max(lanePages.length - 1, 0))
  const canScrollLane = lanePages.length > 1

  useEffect(() => {
    if (!canScrollLane) return undefined
    let intervalId = null
    const advancePage = () => {
      setPageIndex((current) => (current >= lanePages.length - 1 ? 0 : current + 1))
    }
    const timeoutId = window.setTimeout(() => {
      advancePage()
      intervalId = window.setInterval(advancePage, rotateMs)
    }, initialDelayMs)
    return () => {
      window.clearTimeout(timeoutId)
      if (intervalId) {
        window.clearInterval(intervalId)
      }
    }
  }, [canScrollLane, initialDelayMs, lanePages.length, rotateMs])

  return (
    <section
      className="gui2-homev2-band gui2-homev2-discovery-lane gui2-motion-enter"
      style={{ ...buildMotionVars('section'), animationDelay: `${buildStaggerDelayMs(motionIndex + 1, 30)}ms` }}
    >
      <div className="gui2-homev2-band-head">
        <div className="gui2-homev2-band-copy">
          <div className="gui2-homev2-band-title">{lane.title}</div>
        </div>
      </div>

      {tabs.length > 1 ? (
        <div className="gui2-homev2-lane-tabs" role="tablist" aria-label={lane.title}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`gui2-homev2-lane-tab${tab.key === tabs[clampedActiveIndex]?.key ? ' active' : ''}`}
              onClick={() => onChangeTab(lane.key, tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="gui2-homev2-lane-shell">
        <div className="gui2-homev2-lane-viewport">
          <div className="gui2-homev2-lane-track" style={{ transform: `translateX(-${clampedPageIndex * 100}%)` }}>
            {lanePages.map((pageItems, pageNumber) => (
              <div key={`${lane.key}-${activeTab?.key || 'tab'}-page-${pageNumber}`} className="gui2-homev2-lane-page">
              <div
                className="gui2-homev2-poster-rail"
              >
                {pageItems.map((item, itemIndex) => (
                  <div
                    key={item.id}
                    className="gui2-homev2-poster-shell gui2-motion-enter"
                    style={{ ...buildMotionVars('card'), animationDelay: `${buildStaggerDelayMs(itemIndex, 18)}ms` }}
                  >
                    <HomePosterCard item={item} onClick={() => onOpenPoster(item)} />
                  </div>
                ))}
              </div>
              </div>
            ))}
          </div>
        </div>

        {canScrollLane ? (
          <>
            <button
              type="button"
              className={`gui2-homev2-lane-arrow gui2-homev2-lane-arrow-left${clampedPageIndex === 0 ? ' is-hidden' : ''}`}
              onClick={() => setPageIndex((current) => Math.max(current - 1, 0))}
              aria-label={`Previous ${lane.title} page`}
            >
              {'<'}
            </button>
            <button
              type="button"
              className={`gui2-homev2-lane-arrow gui2-homev2-lane-arrow-right${clampedPageIndex >= lanePages.length - 1 ? ' is-hidden' : ''}`}
              onClick={() => setPageIndex((current) => Math.min(current + 1, lanePages.length - 1))}
              aria-label={`Next ${lane.title} page`}
            >
              {'>'}
            </button>
            <div className="gui2-homev2-lane-pagination" aria-hidden="true">
              {lanePages.map((_, pageNumber) => (
                <span
                  key={`${lane.key}-page-dot-${pageNumber}`}
                  className={`gui2-homev2-lane-page-dot${pageNumber === clampedPageIndex ? ' active' : ''}`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

function HomeBand({ section, onOpenPoster, onOpenContinue, motionIndex = 0 }) {
  const bandClassName = `gui2-homev2-band gui2-motion-enter gui2-homev2-band-${section.variant} gui2-homev2-band-${section.key}${section.className ? ` ${section.className}` : ''}`
  const continuePageSize = section.pageSize || 6
  const continuePages = section.variant === 'landscape'
    ? Array.from({ length: Math.ceil(section.items.length / continuePageSize) }, (_, index) => (
      section.items.slice(index * continuePageSize, (index + 1) * continuePageSize)
    ))
    : []
  const [continuePageIndex, setContinuePageIndex] = useState(0)

  useEffect(() => {
    setContinuePageIndex(0)
  }, [section.items, section.key])

  const canPageContinue = continuePages.length > 1
  const clampedContinuePageIndex = Math.min(continuePageIndex, Math.max(continuePages.length - 1, 0))

  return (
    <section
      className={bandClassName}
      style={{ ...buildMotionVars('section'), animationDelay: `${buildStaggerDelayMs(motionIndex + 1, 30)}ms` }}
    >
      <div className="gui2-homev2-band-head">
        <div className="gui2-homev2-band-copy">
          <div className="gui2-homev2-band-title">{section.title}</div>
        </div>
      </div>

      {section.variant === 'landscape' ? (
        <div className="gui2-homev2-continue-shell">
          <div className="gui2-homev2-continue-viewport">
            <div
              className="gui2-homev2-continue-track"
              style={{ transform: `translateX(-${clampedContinuePageIndex * 100}%)` }}
            >
              {continuePages.map((pageItems, pageIndex) => (
                <div key={`${section.key}-page-${pageIndex}`} className="gui2-homev2-continue-page">
                  <div className="gui2-homev2-continue-rail">
                    {pageItems.map((item, itemIndex) => (
                      <div
                        key={item.id}
                        className="gui2-homev2-continue-shell-item gui2-motion-enter"
                        style={{ ...buildMotionVars('card'), animationDelay: `${buildStaggerDelayMs(itemIndex, 22)}ms` }}
                      >
                        <HomeContinueCard item={item} onClick={() => onOpenContinue(section, item)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {canPageContinue ? (
            <>
              <button
                type="button"
                className={`gui2-homev2-rail-arrow gui2-homev2-rail-arrow-left${clampedContinuePageIndex === 0 ? ' is-hidden' : ''}`}
                onClick={() => setContinuePageIndex((current) => Math.max(current - 1, 0))}
                aria-label="Previous continue page"
              >
                {'<'}
              </button>
              <button
                type="button"
                className={`gui2-homev2-rail-arrow gui2-homev2-rail-arrow-right${clampedContinuePageIndex >= continuePages.length - 1 ? ' is-hidden' : ''}`}
                onClick={() => setContinuePageIndex((current) => Math.min(current + 1, continuePages.length - 1))}
                aria-label="Next continue page"
              >
                {'>'}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="gui2-homev2-poster-rail">
          {section.items.map((item, itemIndex) => (
            <div
              key={item.id}
              className="gui2-homev2-poster-shell gui2-motion-enter"
              style={{ ...buildMotionVars('card'), animationDelay: `${buildStaggerDelayMs(itemIndex, 22)}ms` }}
            >
              <HomePosterCard item={item} onClick={() => onOpenPoster(item, section)} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function buildHomeMangaState(item = {}) {
  const selectedItem = item?.selectedAnime || item
  const preferredAnilistID = Number(selectedItem?.anilist_id || selectedItem?.AniListID || selectedItem?.id || item?.id || 0)
  const title = selectedItem?.canonical_title || selectedItem?.title || selectedItem?.anime_title || selectedItem?.manga_title || item?.title || ''
  const cover = selectedItem?.resolved_cover_url || selectedItem?.cover_url || selectedItem?.cover_image || selectedItem?.image || item?.image || ''
  const banner = selectedItem?.resolved_banner_url || selectedItem?.banner_url || selectedItem?.banner_image || cover
  const description = selectedItem?.resolved_description || selectedItem?.description || ''
  const year = Number(selectedItem?.resolved_year || selectedItem?.year || 0)

  const state = {}
  if (preferredAnilistID > 0) state.preferredAnilistID = preferredAnilistID
  if (title) state.preSearch = title
  if (preferredAnilistID > 0 || title || cover) {
    state.seedItem = {
      anilist_id: preferredAnilistID,
      title,
      canonical_title: title,
      title_english: selectedItem?.title_english || '',
      title_romaji: selectedItem?.title_romaji || title,
      title_native: selectedItem?.title_native || '',
      cover_url: cover,
      resolved_cover_url: cover,
      banner_url: banner,
      resolved_banner_url: banner,
      description,
      resolved_description: description,
      year,
      resolved_year: year,
      chapters_total: Number(selectedItem?.chapters_total || 0),
      default_source_id: selectedItem?.default_source_id || selectedItem?.source_id || '',
    }
  }
  return state
}

export default function Gui2HomeRoute({ preview = false }) {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const { season, year } = getCurrentAniListSeason()
  const nextSeasonInfo = useMemo(() => shiftAniListSeason(season, year, 1), [season, year])
  const previousSeasonInfo = useMemo(() => shiftAniListSeason(season, year, -1), [season, year])
  const [heroIndex, setHeroIndex] = useState(0)
  const [recentIndex, setRecentIndex] = useState(0)
  const [recentIsSliding, setRecentIsSliding] = useState(false)
  const [heroIsFading, setHeroIsFading] = useState(false)
  const [homeMode, setHomeMode] = useState('anime')
  const [laneSelections, setLaneSelections] = useState({})
  const fadeTimeoutRef = useRef(null)
  const recentSlideTimeoutRef = useRef(null)

  const dashboardQuery = useQuery({
    queryKey: ['gui2-home-dashboard'],
    queryFn: async () => wails.getDashboard(),
    staleTime: 60_000,
  })

  const homeAniListQuery = useQuery({
    queryKey: ['gui2-home-anilist', lang, season, year],
    queryFn: async () => wails.getAniListAnimeCatalogHome(season, year),
    staleTime: 10 * 60_000,
  })

  const homeMangaCatalogQuery = useQuery({
    queryKey: ['gui2-home-manga-catalog', lang],
    queryFn: async () => wails.getAniListMangaCatalogHome(lang),
    staleTime: 10 * 60_000,
  })

  const startupSnapshotQuery = useQuery({
    queryKey: ['gui2-home-startup-snapshot', lang, season, year],
    queryFn: async () => null,
    enabled: false,
    staleTime: 10 * 60_000,
  })

  const startupReadinessQuery = useQuery({
    queryKey: ['gui2-home-startup-readiness', lang, season, year],
    queryFn: async () => null,
    enabled: false,
    staleTime: 10 * 60_000,
  })

  const trending = useMemo(() => (
    toAniListMediaList({ data: { Page: { media: homeAniListQuery.data?.featured ?? [] } } })
  ), [homeAniListQuery.data])

  const mangaTrending = useMemo(() => (
    uniqueMedia([
      ...(homeMangaCatalogQuery.data?.featured ?? []),
      ...(homeMangaCatalogQuery.data?.trending ?? []),
      ...(homeMangaCatalogQuery.data?.popular ?? []),
    ]).slice(0, GUI2_HOME_POSTER_LIMIT)
  ), [homeMangaCatalogQuery.data])

  const featuredRows = useMemo(() => ([
    {
      key: 'newly-trending',
      title: isEnglish ? 'Newly Trending Anime' : 'Anime en nueva tendencia',
      subtitle: isEnglish ? 'Fresh movement from AniList before it settles into the season.' : 'Movimiento fresco desde AniList antes de que la temporada se acomode.',
      href: '/anime-online',
      items: (homeAniListQuery.data?.newlyTrending ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'popular-this-season',
      title: isEnglish ? 'Popular This Season' : 'Popular esta temporada',
      subtitle: isEnglish ? 'The current season with stronger shelf gravity and better breadth.' : 'La temporada actual con mas peso de catalogo y mejor amplitud.',
      href: '/anime-online',
      items: (homeAniListQuery.data?.seasonalPopular ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'upcoming-watchlist',
      title: isEnglish ? 'Upcoming' : 'Proximamente',
      subtitle: isEnglish ? `Big releases building into ${nextSeasonInfo.season.toLowerCase()} ${nextSeasonInfo.year}.` : `Lanzamientos fuertes entrando a ${nextSeasonInfo.season.toLowerCase()} ${nextSeasonInfo.year}.`,
      href: '/anime-online',
      items: (homeAniListQuery.data?.upcoming ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'top-rated-picks',
      title: isEnglish ? 'Top Rated' : 'Mejor valorados',
      subtitle: isEnglish ? 'High-scoring anime that still deserves front-row attention.' : 'Anime de nota alta que todavia merece primera fila.',
      href: '/anime-online',
      items: (homeAniListQuery.data?.topRated ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'best-of-last-season',
      title: isEnglish ? 'Best of Last Season' : 'Lo mejor de la ultima temporada',
      subtitle: isEnglish ? `Carryovers worth catching from ${previousSeasonInfo.season.toLowerCase()} ${previousSeasonInfo.year}.` : `Series que vale alcanzar desde ${previousSeasonInfo.season.toLowerCase()} ${previousSeasonInfo.year}.`,
      href: '/anime-online',
      items: (homeAniListQuery.data?.lastSeason ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
  ]).filter((row) => row.items.length > 0), [homeAniListQuery.data, isEnglish, nextSeasonInfo.season, nextSeasonInfo.year, previousSeasonInfo.season, previousSeasonInfo.year])

  const discoveryRows = useMemo(() => (
    GUI2_HOME_DISCOVERY_ROWS.map((row) => ({
      key: row.key,
      title: isEnglish ? row.titleEn : row.titleEs,
      subtitle: isEnglish ? row.subtitleEn : row.subtitleEs,
      href: '/anime-online',
      items: (homeAniListQuery.data?.[row.key] ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    })).filter((row) => row.items.length > 0)
  ), [homeAniListQuery.data, isEnglish])

  const homeMangaGenreQuery = useQuery({
    queryKey: ['gui2-home-manga-genres', lang],
    queryFn: async () => {
      const results = await Promise.allSettled(
        GUI2_HOME_DISCOVERY_ROWS.map((row) => wails.discoverManga(row.genre, 0, 'TRENDING_DESC', '', '', 1)),
      )

      const seenIDs = new Set()
      return GUI2_HOME_DISCOVERY_ROWS.map((row, index) => {
        const items = toAniListMediaList(results[index]?.status === 'fulfilled' ? results[index].value : null)
          .filter((item) => {
            const id = Number(item?.id || 0)
            if (!id || seenIDs.has(id)) return false
            seenIDs.add(id)
            return true
          })
          .slice(0, GUI2_HOME_POSTER_LIMIT)

        return {
          key: `manga-${row.key}`,
          title: isEnglish ? row.titleEn : row.titleEs,
          subtitle: isEnglish ? row.subtitleEn : row.subtitleEs,
          href: '/manga-online',
          items,
        }
      }).filter((row) => row.items.length > 0)
    },
    staleTime: 10 * 60_000,
  })

  const goTo = useCallback((path, state = undefined) => {
    navigate(preview ? `/__rebuild${path}` : path, state ? { state } : undefined)
  }, [navigate, preview])

  const openAnimeItem = useCallback((item) => {
    if (!item) {
      goTo('/anime-online')
      return
    }
    const selectedAnime = item?.selectedAnime || item
    const fallbackSourceID = isEnglish ? 'animeheaven-en' : 'animeav1-es'
    goTo('/anime-online', buildAnimeNavigationState(selectedAnime, fallbackSourceID))
  }, [goTo, isEnglish])

  const openMangaItem = useCallback((item) => {
    const state = buildHomeMangaState(item)
    goTo('/manga-online', Object.keys(state).length > 0 ? state : undefined)
  }, [goTo])
  const handleChangeLaneTab = useCallback((laneKey, tabKey) => {
    setLaneSelections((current) => ({ ...current, [laneKey]: tabKey }))
  }, [])

  const recommendationSeedIDs = useMemo(() => Array.from(new Set(
    (dashboardQuery.data?.continue_reading_online_manga ?? [])
      .map((item) => Number(item?.anilist_id || item?.AniListID || 0))
      .filter((value) => value > 0),
  )), [dashboardQuery.data])

  const recommendationExcludeIDs = useMemo(() => Array.from(new Set(
    (dashboardQuery.data?.continue_reading_online_manga ?? [])
      .map((item) => Number(item?.anilist_id || item?.AniListID || 0))
      .filter((value) => value > 0),
  )), [dashboardQuery.data])

  const recommendationSeedKey = recommendationSeedIDs.join(',')
  const recommendationExcludeKey = recommendationExcludeIDs.join(',')

  const homeMangaRecommendationsQuery = useQuery({
    queryKey: ['gui2-home-manga-recommendations', lang, recommendationSeedKey, recommendationExcludeKey],
    enabled: recommendationSeedIDs.length > 0,
    queryFn: async () => wails.getHomeMangaRecommendations(recommendationSeedIDs, recommendationExcludeIDs, lang),
    staleTime: 20 * 60_000,
  })

  const mangaFeaturedRows = useMemo(() => {
    const recommendationItems = dedupeLaneItems(homeMangaRecommendationsQuery.data ?? []).slice(0, GUI2_HOME_POSTER_LIMIT)
    const freshItems = dedupeLaneItems([
      ...(homeMangaCatalogQuery.data?.recent ?? []),
      ...(homeMangaCatalogQuery.data?.featured ?? []).slice(0, 6),
      ...(homeMangaCatalogQuery.data?.popular ?? []).slice(0, 6),
      ...((homeMangaGenreQuery.data ?? []).flatMap((section) => section.items || []).slice(0, 8)),
    ]).slice(0, GUI2_HOME_POSTER_LIMIT)

    return [
      recommendationItems.length > 0 ? {
        key: 'recommended-for-you',
        title: isEnglish ? 'Recommended For You' : 'Recomendado para ti',
        subtitle: isEnglish ? 'Picked from your current reading momentum' : 'Elegido desde tu impulso actual de lectura',
        href: '/manga-online',
        items: recommendationItems,
      } : null,
      freshItems.length > 0 ? {
        key: 'fresh-manga-picks',
        title: isEnglish ? 'Fresh Manga Picks' : 'Manga fresco para descubrir',
        subtitle: isEnglish ? 'Recent chapter movement and broader manga discovery' : 'Movimiento reciente de capitulos y descubrimiento manga mas amplio',
        href: '/manga-online',
        items: freshItems,
      } : null,
    ].filter(Boolean)
  }, [homeMangaCatalogQuery.data, homeMangaGenreQuery.data, homeMangaRecommendationsQuery.data, isEnglish])

  const mangaGenreRows = useMemo(() => {
    const seededIDs = new Set(
      mangaFeaturedRows.flatMap((section) => section.items || []).map((item) => Number(item?.id || item?.anilist_id || 0)).filter((value) => value > 0),
    )
    const seenIDs = new Set(seededIDs)

    return (homeMangaGenreQuery.data ?? []).map((section) => ({
      ...section,
      items: (section.items || []).filter((item) => {
        const id = Number(item?.id || item?.anilist_id || 0)
        if (!id || seenIDs.has(id)) return false
        seenIDs.add(id)
        return true
      }),
    })).filter((section) => section.items.length > 0)
  }, [homeMangaGenreQuery.data, mangaFeaturedRows])

  const mangaRecentItems = useMemo(() => dedupeLaneItems([
    ...(homeMangaCatalogQuery.data?.recent ?? []),
    ...(homeMangaCatalogQuery.data?.featured ?? []).slice(0, 4),
    ...(homeMangaCatalogQuery.data?.popular ?? []).slice(0, 4),
    ...(dashboardQuery.data?.recent_manga_updates ?? []),
    ...(dashboardQuery.data?.recent_manga_online ?? []),
    ...(dashboardQuery.data?.recent_manga ?? []),
  ]), [dashboardQuery.data, homeMangaCatalogQuery.data])

  const homeData = useMemo(() => buildGui2HomeData({
    dashboard: dashboardQuery.data ?? {},
    trending,
    featuredRows,
    genreRows: discoveryRows,
    mangaTrending: mangaTrending,
    mangaRecentItems: mangaRecentItems,
    mangaFeaturedRows: mangaFeaturedRows,
    mangaGenreRows: mangaGenreRows,
    isEnglish,
  }), [dashboardQuery.data, discoveryRows, featuredRows, isEnglish, mangaFeaturedRows, mangaGenreRows, mangaRecentItems, mangaTrending, trending])
  const startupHomeData = useMemo(() => buildGui2HomeDataFromStartupSnapshot({
    snapshot: startupSnapshotQuery.data,
    isEnglish,
  }), [isEnglish, startupSnapshotQuery.data])
  const liveHasPrimaryContent = useMemo(() => hasPrimaryHomeCatalogContent(homeData), [homeData])
  const effectiveHomeData = useMemo(() => {
    return liveHasPrimaryContent ? homeData : startupHomeData
  }, [homeData, liveHasPrimaryContent, startupHomeData])
  const showHomeLoading = !effectiveHomeData.hero && effectiveHomeData.animeSections.length === 0 && effectiveHomeData.mangaSections.length === 0 && (
    startupReadinessQuery.data?.ready !== true
    || !startupSnapshotQuery.data
  ) && (
    homeAniListQuery.isLoading
    || homeAniListQuery.isFetching
    || homeMangaCatalogQuery.isLoading
    || homeMangaGenreQuery.isLoading
  )
  const featuredRecentSection = effectiveHomeData.featuredRecentSection
  const mangaFeaturedRecentSection = effectiveHomeData.mangaFeaturedRecentSection
  const activeRecentSection = homeMode === 'manga' ? mangaFeaturedRecentSection : featuredRecentSection
  const recentItems = activeRecentSection?.items ?? []
  const visibleSections = homeMode === 'manga' ? effectiveHomeData.mangaSections : effectiveHomeData.animeSections
  const heroSlides = effectiveHomeData.heroSlides
  const mangaHeroSlides = effectiveHomeData.mangaHeroSlides
  const activeHeroSlides = homeMode === 'manga' ? mangaHeroSlides : heroSlides
  const animeSectionMap = useMemo(
    () => Object.fromEntries(effectiveHomeData.animeSections.map((section) => [section.key, section])),
    [effectiveHomeData.animeSections],
  )
  const animeFeaturedSections = useMemo(
    () => ['newly-trending', 'popular-this-season', 'upcoming-watchlist', 'top-rated-picks', 'best-of-last-season']
      .map((key) => animeSectionMap[key])
      .filter(Boolean),
    [animeSectionMap],
  )
  const animeContinueSection = animeSectionMap['continue-watching'] || null
  const animeLanes = useMemo(() => ([
    {
      key: 'newly-trending-anime',
      title: isEnglish ? 'Newly Trending Anime' : 'Anime en nueva tendencia',
      subtitle: isEnglish ? 'Fresh AniList momentum with a wider genre filter bar.' : 'Impulso fresco de AniList con una barra de generos mas amplia.',
      tabs: (() => {
        const laneItems = dedupeLaneItems(animeFeaturedSections[0]?.items || []).slice(0, GUI2_HOME_POSTER_LIMIT)
        return [
          buildLaneTab('all', isEnglish ? 'All' : 'Todo', animeFeaturedSections[0], laneItems),
          ...buildLaneGenreTabs(laneItems, isEnglish).map((tab) => buildLaneTab(tab.key, tab.label, animeFeaturedSections[0], tab.items)),
        ]
      })(),
    },
    {
      key: 'popular-this-season-lane',
      title: isEnglish ? 'Popular This Season' : 'Popular esta temporada',
      subtitle: isEnglish ? 'Season-led browsing with stronger shelf density and better flow.' : 'Navegacion de temporada con mas densidad de catalogo y mejor ritmo.',
      tabs: (() => {
        const sourceSection = animeFeaturedSections[1] || animeFeaturedSections[0]
        const laneItems = dedupeLaneItems(sourceSection?.items || []).slice(0, GUI2_HOME_POSTER_LIMIT)
        return [
          buildLaneTab('all', isEnglish ? 'All' : 'Todo', sourceSection, laneItems),
          ...buildLaneGenreTabs(laneItems, isEnglish).map((tab) => buildLaneTab(tab.key, tab.label, sourceSection, tab.items)),
        ]
      })(),
    },
    {
      key: 'upcoming-lane',
      title: isEnglish ? 'Upcoming' : 'Proximamente',
      subtitle: isEnglish ? 'Future-facing releases that deserve space before they land.' : 'Lanzamientos futuros que merecen espacio antes de salir.',
      tabs: [
        buildLaneTab(
          'all',
          isEnglish ? 'Upcoming' : 'Proximamente',
          animeFeaturedSections[2] || animeFeaturedSections[1] || animeFeaturedSections[0],
          dedupeLaneItems(
            (animeFeaturedSections[2]?.items || []).filter((item) => item?.selectedAnime?.status === 'NOT_YET_RELEASED' || item?.status === 'NOT_YET_RELEASED'),
          ).slice(0, GUI2_HOME_POSTER_LIMIT),
        ),
      ],
    },
    {
      key: 'top-rated-lane',
      title: isEnglish ? 'Top Rated' : 'Mejor valorados',
      subtitle: isEnglish ? 'The sharper critical shelf without leaving the Home flow.' : 'La fila de mayor nota sin salir del flujo Home.',
      tabs: (() => {
        const sourceSection = animeFeaturedSections[3] || animeFeaturedSections[0]
        const laneItems = dedupeLaneItems(sourceSection?.items || []).slice(0, GUI2_HOME_POSTER_LIMIT)
        return [
          buildLaneTab('all', isEnglish ? 'All' : 'Todo', sourceSection, laneItems),
          ...buildLaneGenreTabs(laneItems, isEnglish).map((tab) => buildLaneTab(tab.key, tab.label, sourceSection, tab.items)),
        ]
      })(),
    },
    {
      key: 'best-of-last-season-lane',
      title: isEnglish ? 'Best of Last Season' : 'Lo mejor de la ultima temporada',
      subtitle: isEnglish ? 'Carryovers and delayed watches with a stronger reason to return.' : 'Series pendientes y tardias con una razon mas fuerte para volver.',
      tabs: (() => {
        const sourceSection = animeFeaturedSections[4] || animeFeaturedSections[3] || animeFeaturedSections[0]
        const laneItems = dedupeLaneItems(sourceSection?.items || []).slice(0, GUI2_HOME_POSTER_LIMIT)
        return [
          buildLaneTab('all', isEnglish ? 'All' : 'Todo', sourceSection, laneItems),
          ...buildLaneGenreTabs(laneItems, isEnglish).map((tab) => buildLaneTab(tab.key, tab.label, sourceSection, tab.items)),
        ]
      })(),
    },
  ]), [animeFeaturedSections, isEnglish])
  const mangaSectionMap = useMemo(
    () => Object.fromEntries(effectiveHomeData.mangaSections.map((section) => [section.key, section])),
    [effectiveHomeData.mangaSections],
  )
  const mangaContinueSection = mangaSectionMap['continue-reading-manga'] || null
  const mangaFeaturedSections = useMemo(() => ({
    continue: mangaContinueSection,
    recommendations: mangaSectionMap['recommended-for-you'] || null,
    fresh: mangaSectionMap['fresh-manga-picks'] || null,
    lowerRows: effectiveHomeData.mangaSections.filter((section) => !['continue-reading-manga', 'recommended-for-you', 'fresh-manga-picks'].includes(section.key)),
  }), [effectiveHomeData.mangaSections, mangaContinueSection, mangaSectionMap])
  const mangaLanes = useMemo(() => ([
    mangaFeaturedSections.recommendations ? {
      key: 'recommended-manga-lane',
      title: mangaFeaturedSections.recommendations.title,
      subtitle: mangaFeaturedSections.recommendations.subtitle,
      tabs: [buildLaneTab('all', isEnglish ? 'All' : 'Todo', mangaFeaturedSections.recommendations)],
    } : null,
    mangaFeaturedSections.fresh ? {
      key: 'fresh-manga-lane',
      title: mangaFeaturedSections.fresh.title,
      subtitle: mangaFeaturedSections.fresh.subtitle,
      tabs: [buildLaneTab('all', isEnglish ? 'All' : 'Todo', mangaFeaturedSections.fresh)],
    } : null,
    ...mangaFeaturedSections.lowerRows.map((section) => ({
      key: `${section.key}-lane`,
      title: section.title,
      subtitle: section.subtitle,
      tabs: [buildLaneTab('all', isEnglish ? 'All' : 'Todo', section)],
    })),
  ].filter(Boolean)), [isEnglish, mangaFeaturedSections])
  const deferredHomeReady = homeMangaGenreQuery.isFetched && (!recommendationSeedIDs.length || homeMangaRecommendationsQuery.isFetched)
  const visibleAnimeLanes = deferredHomeReady ? animeLanes : animeLanes.slice(0, 3)
  const visibleMangaLanes = useMemo(() => {
    if (deferredHomeReady) return mangaLanes

    const openingKeys = [
      'fresh-manga-lane',
      'recent-manga-updates-lane',
      'popular-manga-right-now-lane',
      'recommended-manga-lane',
    ]
    const openingLanes = openingKeys
      .map((key) => mangaLanes.find((lane) => lane.key === key))
      .filter(Boolean)

    return (openingLanes.length > 0 ? openingLanes : mangaLanes).slice(0, 3)
  }, [deferredHomeReady, mangaLanes])

  useEffect(() => {
    setHeroIndex((current) => {
      if (activeHeroSlides.length <= 1) return 0
      return Math.min(current, activeHeroSlides.length - 1)
    })
  }, [activeHeroSlides.length])

  useEffect(() => {
    setRecentIndex((current) => {
      if (recentItems.length <= 1) return 0
      return Math.min(current, recentItems.length - 1)
    })
  }, [recentItems.length])

  const runHeroTransition = useCallback((direction = 'next') => {
    if (activeHeroSlides.length <= 1) return
    if (fadeTimeoutRef.current) {
      window.clearTimeout(fadeTimeoutRef.current)
      fadeTimeoutRef.current = null
    }

    setHeroIsFading(true)
    fadeTimeoutRef.current = window.setTimeout(() => {
      startTransition(() => {
        setHeroIndex((current) => {
          if (direction === 'prev') return current <= 0 ? activeHeroSlides.length - 1 : current - 1
          return getNextHomeHeroIndex(current, activeHeroSlides.length)
        })
      })
      window.requestAnimationFrame(() => {
        setHeroIsFading(false)
      })
      fadeTimeoutRef.current = null
    }, GUI2_HOME_HERO_FADE_MS)
  }, [activeHeroSlides.length])

  useEffect(() => {
    if (activeHeroSlides.length <= 1) return undefined
    const intervalId = window.setInterval(() => {
      runHeroTransition('next')
    }, GUI2_HOME_HERO_ROTATE_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeHeroSlides.length, runHeroTransition])

  useEffect(() => () => {
    if (fadeTimeoutRef.current) {
      window.clearTimeout(fadeTimeoutRef.current)
    }
    if (recentSlideTimeoutRef.current) {
      window.clearTimeout(recentSlideTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (recentItems.length <= 1) return undefined
    const intervalId = window.setInterval(() => {
      if (recentSlideTimeoutRef.current) {
        window.clearTimeout(recentSlideTimeoutRef.current)
      }
      setRecentIsSliding(true)
      recentSlideTimeoutRef.current = window.setTimeout(() => {
        setRecentIndex((current) => (current >= recentItems.length - 1 ? 0 : current + 1))
        window.requestAnimationFrame(() => {
          setRecentIsSliding(false)
        })
        recentSlideTimeoutRef.current = null
      }, 220)
    }, 4200)

    return () => {
      window.clearInterval(intervalId)
      if (recentSlideTimeoutRef.current) {
        window.clearTimeout(recentSlideTimeoutRef.current)
        recentSlideTimeoutRef.current = null
      }
    }
  }, [recentItems.length])

  const hasMangaModeContent = Boolean(effectiveHomeData.mangaHero || effectiveHomeData.mangaSections.length > 0 || ((mangaFeaturedRecentSection?.items?.length ?? 0) > 0))

  useEffect(() => {
    if (homeMode === 'manga' && !hasMangaModeContent && effectiveHomeData.animeSections.length > 0) {
      setHomeMode('anime')
    }
  }, [effectiveHomeData.animeSections.length, hasMangaModeContent, homeMode])

  const clampedHeroIndex = activeHeroSlides.length ? Math.min(heroIndex, activeHeroSlides.length - 1) : 0
  const animeHero = heroSlides[clampedHeroIndex] || effectiveHomeData.hero
  const mangaHero = mangaHeroSlides[clampedHeroIndex] || effectiveHomeData.mangaHero
  const hero = homeMode === 'manga'
    ? (mangaHero
        ? {
            ...mangaHero,
            summary: mangaHero.summary || (isEnglish
              ? 'Shift into the reading side of Nipah! Anime with a cleaner manga-first discovery flow.'
              : 'Pasa al lado de lectura de Nipah! Anime con un flujo manga mas limpio y directo.'),
          }
        : null)
    : animeHero
  const clampedRecentIndex = recentItems.length ? Math.min(recentIndex, recentItems.length - 1) : 0
  const visibleRecentItems = useMemo(() => {
    if (recentItems.length === 0) return []
    return recentItems.map((_, offset) => {
      const originalIndex = (clampedRecentIndex + offset) % recentItems.length
      return {
        item: recentItems[originalIndex],
        originalIndex,
      }
    })
  }, [clampedRecentIndex, recentItems])
  const recentListItems = visibleRecentItems.slice(0, 6)
  const heroBackdrop = hero?.banner || hero?.image || ''
  const heroTitleLength = hero?.title?.length || 0
  const heroTitleClassName = `gui2-homev2-hero-title${heroTitleLength > 18 ? ' is-long' : ''}${heroTitleLength > 28 ? ' is-longer' : ''}`

  return (
    <div className="gui2-homev2 gui2-homev2-shell-premium gui2-motion-enter" style={buildMotionVars('page')}>
      <section
        className="gui2-homev2-stage-shell gui2-homev2-stage-band gui2-motion-enter"
        style={{ ...buildMotionVars('section'), animationDelay: `${buildStaggerDelayMs(0)}ms` }}
      >
        <div className={`gui2-homev2-stage${heroIsFading ? ' transitioning' : ''}${showHomeLoading ? ' gui2-homev2-stage-loading' : ''}`}>
          {showHomeLoading ? (
            <>
              <div className="gui2-homev2-hero-loading-sheen" />
            </>
          ) : (
            <>
              {heroBackdrop ? (
                <img src={proxyImage(heroBackdrop)} alt={hero.title} className="gui2-homev2-stage-image" />
              ) : (
                <div className="gui2-homev2-stage-fallback">{hero?.title?.slice(0, 1) || 'N'}</div>
              )}
            </>
          )}
          <div className="gui2-homev2-stage-overlay" />

          <div className="gui2-homev2-stage-grid">
            <div className="gui2-homev2-stage-main">
              {showHomeLoading ? (
                <div className="gui2-homev2-hero-copy gui2-homev2-hero-copy-loading">
                  <h1 className="gui2-homev2-hero-title">{isEnglish ? 'Fetching AniList shelves...' : 'Cargando secciones de AniList...'}</h1>
                  <p className="gui2-homev2-hero-summary">
                    {isEnglish
                      ? 'Preparing the featured banner, recently updated rail, and opening rows.'
                      : 'Preparando el banner destacado, la columna de actualizados y las primeras filas.'}
                  </p>
                </div>
              ) : (
                <>
                  {activeHeroSlides.length > 1 ? (
                    <div className="gui2-homev2-hero-dots" aria-hidden="true">
                      {activeHeroSlides.map((slide, index) => (
                        <span key={slide.id} className={`gui2-homev2-hero-dot${index === clampedHeroIndex ? ' active' : ''}`} />
                      ))}
                    </div>
                  ) : null}

                  <div className="gui2-homev2-hero-copy">
                    {hero?.image ? (
                      <div className="gui2-homev2-hero-poster">
                        <img src={proxyImage(hero.image)} alt={hero.title} className="gui2-homev2-hero-poster-image" />
                      </div>
                    ) : null}

                    <div className="gui2-homev2-hero-body">
                      {hero?.meta?.length ? (
                        <div className="gui2-homev2-hero-meta-row">
                          {hero.meta.map((metaBit) => (
                            <span key={`${hero.id}-${metaBit}`} className="gui2-homev2-hero-meta-chip">{metaBit}</span>
                          ))}
                        </div>
                      ) : null}
                      <h1 className={heroTitleClassName}>{hero?.title || 'NIPAH!'}</h1>
                      <button type="button" className="gui2-homev2-primary" onClick={() => (homeMode === 'manga' ? openMangaItem(hero) : openAnimeItem(hero))}>
                        {homeMode === 'manga' ? (isEnglish ? 'Read Now' : 'Leer ahora') : (isEnglish ? 'Watch Now' : 'Ver ahora')}
                      </button>
                      {hero?.summary ? <p className="gui2-homev2-hero-summary">{hero.summary}</p> : null}
                    </div>
                  </div>
                </>
              )}
            </div>

            <aside className="gui2-homev2-hero-recent">
              <div className="gui2-homev2-hero-recent-head">
                <div className="gui2-homev2-hero-recent-label">{activeRecentSection.title}</div>
              </div>

              {showHomeLoading ? (
                <div className="gui2-homev2-recent-rail">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={`home-recent-loading-${index}`} className="gui2-homev2-loading-recent-row" aria-hidden="true">
                      <div className="gui2-homev2-loading-recent-thumb" />
                      <div className="gui2-homev2-loading-recent-copy">
                        <div className="gui2-homev2-loading-line gui2-homev2-loading-line-title" />
                        <div className="gui2-homev2-loading-line gui2-homev2-loading-line-meta" />
                        <div className="gui2-homev2-loading-line gui2-homev2-loading-line-meta gui2-homev2-loading-line-short" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentListItems.length > 0 ? (
                <div className={`gui2-homev2-recent-rail${recentIsSliding ? ' is-sliding' : ''}`}>
                  {recentListItems.map(({ item, originalIndex }, index) => (
                    <HomeRecentRow
                      key={`${item.id}-${originalIndex}`}
                      item={item}
                      motionIndex={index + 1}
                      onClick={() => (homeMode === 'manga' ? openMangaItem(item) : openAnimeItem(item))}
                    />
                  ))}
                </div>
              ) : null}
            </aside>
          </div>

          <div className="gui2-homev2-hero-switch">
            <div className="gui2-homev2-mode-tabs" role="tablist" aria-label={isEnglish ? 'Home modes' : 'Modos Home'}>
              <button
                type="button"
                className={`gui2-homev2-mode-tab${homeMode === 'anime' ? ' active' : ''}`}
                onClick={() => setHomeMode('anime')}
                aria-pressed={homeMode === 'anime'}
              >
                {isEnglish ? 'Anime' : 'Anime'}
              </button>
              <button
                type="button"
                className={`gui2-homev2-mode-tab${homeMode === 'manga' ? ' active' : ''}`}
                onClick={() => setHomeMode('manga')}
                aria-pressed={homeMode === 'manga'}
                disabled={!hasMangaModeContent}
              >
                {isEnglish ? 'Manga' : 'Manga'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="gui2-homev2-stack">
        {showHomeLoading && visibleSections.length === 0 ? <HomeLoadingSection isEnglish={isEnglish} /> : null}

        {!showHomeLoading && animeContinueSection && homeMode === 'anime' ? (
          <HomeBand
            key={animeContinueSection.key}
            section={animeContinueSection}
            motionIndex={0}
            onOpenPoster={(item) => openAnimeItem(item)}
            onOpenContinue={(_, item) => openAnimeItem(item)}
          />
        ) : null}

        {!showHomeLoading && homeMode === 'manga' && mangaContinueSection ? (
          <HomeBand
            key={mangaContinueSection.key}
            section={{ ...mangaContinueSection, className: 'gui2-homev2-band-continue-reading' }}
            motionIndex={0}
            onOpenPoster={(item) => openMangaItem(item)}
            onOpenContinue={(_, item) => openMangaItem(item)}
          />
        ) : null}

        {!showHomeLoading && homeMode === 'anime'
          ? visibleAnimeLanes.map((lane, index) => (
            <HomeLane
              key={lane.key}
              lane={lane}
              motionIndex={index + 1}
              activeTabKey={laneSelections[lane.key]}
              onChangeTab={handleChangeLaneTab}
              onOpenPoster={(item) => openAnimeItem(item)}
            />
          ))
          : null}

        {!showHomeLoading && homeMode === 'manga'
          ? visibleMangaLanes.map((lane, index) => (
            <HomeLane
              key={lane.key}
              lane={lane}
              motionIndex={index + 1}
              activeTabKey={laneSelections[lane.key]}
              onChangeTab={handleChangeLaneTab}
              onOpenPoster={(item) => openMangaItem(item)}
            />
          ))
          : null}
      </div>
    </div>
  )
}
