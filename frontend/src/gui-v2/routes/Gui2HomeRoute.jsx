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
  getNextHomeHeroIndex,
} from './home/homeData'

function getCurrentAniListSeason() {
  const now = new Date()
  const month = now.getMonth() + 1
  if (month <= 3) return { season: 'WINTER', year: now.getFullYear() }
  if (month <= 6) return { season: 'SPRING', year: now.getFullYear() }
  if (month <= 9) return { season: 'SUMMER', year: now.getFullYear() }
  return { season: 'FALL', year: now.getFullYear() }
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

function HomePosterCard({ item, onClick }) {
  return (
    <button type="button" className="gui2-homev2-poster" onClick={onClick} title={item.title}>
      <div className="gui2-homev2-poster-art">
        {item.image ? (
          <img src={proxyImage(item.image)} alt={item.title} className="gui2-homev2-poster-image" />
        ) : (
          <div className="gui2-homev2-poster-fallback">{item.title.slice(0, 1)}</div>
        )}
      </div>
      <div className="gui2-homev2-poster-copy">
        <div className="gui2-homev2-poster-title">{item.title}</div>
        {item.meta ? <div className="gui2-homev2-poster-meta">{item.meta}</div> : null}
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

function HomeRecentRow({ item, onClick }) {
  return (
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
        <div className="gui2-homev2-recent-episode">{item.episodeLabel}</div>
        <div className="gui2-homev2-recent-age">{item.ageLabel}</div>
      </div>
    </button>
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

function HomeBand({ section, onViewAll, onOpenPoster, onOpenContinue }) {
  const bandClassName = `gui2-homev2-band gui2-homev2-band-${section.variant} gui2-homev2-band-${section.key}`
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
    <section className={bandClassName}>
      <div className="gui2-homev2-band-head">
        <div className="gui2-homev2-band-copy">
          <div className="gui2-homev2-band-title">{section.title}</div>
          {section.subtitle ? <div className="gui2-homev2-band-subtitle">{section.subtitle}</div> : null}
        </div>
        {section.actionLabel ? (
          <button type="button" className="gui2-homev2-link" onClick={() => onViewAll(section)}>
            {section.actionLabel}
          </button>
        ) : null}
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
                    {pageItems.map((item) => (
                      <HomeContinueCard key={item.id} item={item} onClick={() => onOpenContinue(section, item)} />
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
        <div
          className="gui2-homev2-poster-rail"
          style={{ '--gui2-homev2-poster-columns': String(Math.max(section.items.length, 1)) }}
        >
          {section.items.map((item) => (
            <HomePosterCard key={item.id} item={item} onClick={() => onOpenPoster(item, section)} />
          ))}
        </div>
      )}
    </section>
  )
}

export default function Gui2HomeRoute({ preview = false }) {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const { season, year } = getCurrentAniListSeason()
  const [heroIndex, setHeroIndex] = useState(0)
  const [heroIsFading, setHeroIsFading] = useState(false)
  const fadeTimeoutRef = useRef(null)

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

  const trending = useMemo(() => (
    toAniListMediaList({ data: { Page: { media: homeAniListQuery.data?.featured ?? [] } } })
  ), [homeAniListQuery.data])

  const featuredRows = useMemo(() => ([
    {
      key: 'popular-now',
      title: isEnglish ? 'Popular Now' : 'Popular ahora',
      subtitle: isEnglish ? 'The shows everyone is opening right now' : 'Los shows que mas se estan abriendo ahora mismo',
      href: '/anime-online',
      items: (homeAniListQuery.data?.popular ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'trending-season',
      title: isEnglish ? 'Trending This Season' : 'Tendencia esta temporada',
      subtitle: isEnglish ? 'What is moving fastest across AniList this season' : 'Lo que mas se mueve esta temporada en AniList',
      href: '/anime-online',
      items: (homeAniListQuery.data?.seasonal ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'top-rated-picks',
      title: isEnglish ? 'Top Rated Picks' : 'Mejor valorados',
      subtitle: isEnglish ? 'Highly rated anime worth opening next' : 'Anime muy bien valorado para abrir despues',
      href: '/anime-online',
      items: (homeAniListQuery.data?.topRated ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    },
  ]).filter((row) => row.items.length > 0), [homeAniListQuery.data, isEnglish])

  const discoveryRows = useMemo(() => (
    GUI2_HOME_DISCOVERY_ROWS.map((row) => ({
      key: row.key,
      title: isEnglish ? row.titleEn : row.titleEs,
      subtitle: isEnglish ? row.subtitleEn : row.subtitleEs,
      href: '/anime-online',
      items: (homeAniListQuery.data?.[row.key] ?? []).slice(0, GUI2_HOME_POSTER_LIMIT),
    })).filter((row) => row.items.length > 0)
  ), [homeAniListQuery.data, isEnglish])

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

  const homeData = useMemo(() => buildGui2HomeData({
    dashboard: dashboardQuery.data ?? {},
    trending,
    featuredRows,
    genreRows: discoveryRows,
    isEnglish,
  }), [dashboardQuery.data, discoveryRows, featuredRows, isEnglish, trending])
  const showHomeLoading = !homeData.hero && homeData.sections.length === 0 && (
    homeAniListQuery.isLoading
    || homeAniListQuery.isFetching
  )

  const heroSlides = homeData.heroSlides

  useEffect(() => {
    setHeroIndex((current) => {
      if (heroSlides.length <= 1) return 0
      return Math.min(current, heroSlides.length - 1)
    })
  }, [heroSlides.length])

  const runHeroTransition = useCallback((direction = 'next') => {
    if (heroSlides.length <= 1) return
    if (fadeTimeoutRef.current) {
      window.clearTimeout(fadeTimeoutRef.current)
      fadeTimeoutRef.current = null
    }

    setHeroIsFading(true)
    fadeTimeoutRef.current = window.setTimeout(() => {
      startTransition(() => {
        setHeroIndex((current) => {
          if (direction === 'prev') return current <= 0 ? heroSlides.length - 1 : current - 1
          return getNextHomeHeroIndex(current, heroSlides.length)
        })
      })
      window.requestAnimationFrame(() => {
        setHeroIsFading(false)
      })
      fadeTimeoutRef.current = null
    }, GUI2_HOME_HERO_FADE_MS)
  }, [heroSlides.length])

  useEffect(() => {
    if (heroSlides.length <= 1) return undefined
    const intervalId = window.setInterval(() => {
      runHeroTransition('next')
    }, GUI2_HOME_HERO_ROTATE_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [heroSlides.length, runHeroTransition])

  useEffect(() => () => {
    if (fadeTimeoutRef.current) {
      window.clearTimeout(fadeTimeoutRef.current)
    }
  }, [])

  const clampedHeroIndex = heroSlides.length ? Math.min(heroIndex, heroSlides.length - 1) : 0
  const hero = heroSlides[clampedHeroIndex] || homeData.hero

  return (
    <div className="gui2-homev2">
      <section className="gui2-homev2-hero-shell">
        <div className="gui2-homev2-hero">
          <div className={`gui2-homev2-hero-stage${heroIsFading ? ' transitioning' : ''}${showHomeLoading ? ' gui2-homev2-hero-stage-loading' : ''}`}>
            {showHomeLoading ? (
              <>
                <div className="gui2-homev2-hero-loading-sheen" />
                <div className="gui2-homev2-hero-overlay" />
                <div className="gui2-homev2-hero-copy gui2-homev2-hero-copy-loading">
                  <div className="gui2-homev2-hero-meta">{isEnglish ? 'Loading Home' : 'Cargando Home'}</div>
                  <h1 className="gui2-homev2-hero-title">{isEnglish ? 'Fetching AniList shelves...' : 'Cargando secciones de AniList...'}</h1>
                  <p className="gui2-homev2-hero-summary">
                    {isEnglish
                      ? 'Preparing the featured banner, recently updated rail, and opening rows.'
                      : 'Preparando el banner destacado, la columna de actualizados y las primeras filas.'}
                  </p>
                </div>
              </>
            ) : (
              <>
                {hero?.banner ? (
                  <img src={proxyImage(hero.banner)} alt={hero.title} className="gui2-homev2-hero-image" />
                ) : (
                  <div className="gui2-homev2-hero-fallback">{hero?.title?.slice(0, 1) || 'N'}</div>
                )}
                <div className="gui2-homev2-hero-overlay" />

                {heroSlides.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className="gui2-homev2-hero-arrow gui2-homev2-hero-arrow-left"
                      onClick={() => runHeroTransition('prev')}
                      aria-label={isEnglish ? 'Previous slide' : 'Slide anterior'}
                    >
                      {'<'}
                    </button>
                    <button
                      type="button"
                      className="gui2-homev2-hero-arrow gui2-homev2-hero-arrow-right"
                      onClick={() => runHeroTransition('next')}
                      aria-label={isEnglish ? 'Next slide' : 'Siguiente slide'}
                    >
                      {'>'}
                    </button>
                  </>
                ) : null}

                <div className="gui2-homev2-hero-copy">
                  <h1 className="gui2-homev2-hero-title">{hero?.title || 'NIPAH!'}</h1>
                  {hero?.meta?.length ? <div className="gui2-homev2-hero-meta">{hero.meta.join(' - ')}</div> : null}
                  <button type="button" className="gui2-homev2-primary" onClick={() => openAnimeItem(hero)}>
                    {isEnglish ? 'Watch Now' : 'Ver ahora'}
                  </button>
                  {hero?.summary ? <p className="gui2-homev2-hero-summary">{hero.summary}</p> : null}
                </div>

                {heroSlides.length > 1 ? (
                  <div className="gui2-homev2-hero-dots" aria-hidden="true">
                    {heroSlides.map((slide, index) => (
                      <span key={slide.id} className={`gui2-homev2-hero-dot${index === clampedHeroIndex ? ' active' : ''}`} />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <aside className="gui2-homev2-recent">
          <div className="gui2-homev2-band-head">
            <div className="gui2-homev2-band-copy">
              <div className="gui2-homev2-band-title">{isEnglish ? 'Recently Updated' : 'Recientemente actualizado'}</div>
              <div className="gui2-homev2-band-subtitle">
                {isEnglish ? 'Only anime with active AniList episode releases.' : 'Solo anime con episodios activos en AniList.'}
              </div>
            </div>
            <button type="button" className="gui2-homev2-link" onClick={() => goTo('/anime-online')}>
              View All
            </button>
          </div>
          <div className="gui2-homev2-recent-list">
            {showHomeLoading ? (
              Array.from({ length: 4 }, (_, index) => (
                <div key={`home-recent-loading-${index}`} className="gui2-homev2-loading-recent-row" aria-hidden="true">
                  <div className="gui2-homev2-loading-recent-thumb" />
                  <div className="gui2-homev2-loading-recent-copy">
                    <div className="gui2-homev2-loading-line gui2-homev2-loading-line-title" />
                    <div className="gui2-homev2-loading-line gui2-homev2-loading-line-meta" />
                    <div className="gui2-homev2-loading-line gui2-homev2-loading-line-meta gui2-homev2-loading-line-short" />
                  </div>
                </div>
              ))
            ) : (
              homeData.recentUpdates.map((item) => (
                <HomeRecentRow key={item.id} item={item} onClick={() => openAnimeItem(item)} />
              ))
            )}
          </div>
        </aside>
      </section>

      <div className="gui2-homev2-stack">
        {showHomeLoading && homeData.sections.length === 0 ? (
          <HomeLoadingSection isEnglish={isEnglish} />
        ) : (
          homeData.sections.map((section) => (
            <HomeBand
              key={section.key}
              section={section}
              onViewAll={(selectedSection) => goTo(selectedSection.href)}
              onOpenPoster={(item) => openAnimeItem(item)}
              onOpenContinue={(_, item) => openAnimeItem(item)}
            />
          ))
        )}
      </div>
    </div>
  )
}
