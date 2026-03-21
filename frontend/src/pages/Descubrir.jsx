import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { useI18n } from '../lib/i18n'
import { resolveAniListToJKAnime } from '../lib/onlineAnimeResolver'
import OnlineAnimeDetail from '../components/ui/OnlineAnimeDetail'

const SEASON_ES = { WINTER: 'Invierno', SPRING: 'Primavera', SUMMER: 'Verano', FALL: 'Otono' }
const SEASON_EN = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' }
const SPANISH_MARKERS = [' el ', ' la ', ' los ', ' las ', ' del ', ' de ', ' un ', ' una ']

const GENRE_LABELS = {
  Action: { es: 'Accion', en: 'Action' },
  Adventure: { es: 'Aventura', en: 'Adventure' },
  Comedy: { es: 'Comedia', en: 'Comedy' },
  Drama: { es: 'Drama', en: 'Drama' },
  Ecchi: { es: 'Ecchi', en: 'Ecchi' },
  Fantasy: { es: 'Fantasia', en: 'Fantasy' },
  Horror: { es: 'Terror', en: 'Horror' },
  'Mahou Shoujo': { es: 'Mahou Shoujo', en: 'Mahou Shoujo' },
  Mecha: { es: 'Mecha', en: 'Mecha' },
  Music: { es: 'Musica', en: 'Music' },
  Mystery: { es: 'Misterio', en: 'Mystery' },
  Psychological: { es: 'Psicologico', en: 'Psychological' },
  Romance: { es: 'Romance', en: 'Romance' },
  'Sci-Fi': { es: 'Ciencia ficcion', en: 'Sci-Fi' },
  'Slice of Life': { es: 'Vida cotidiana', en: 'Slice of Life' },
  Sports: { es: 'Deportes', en: 'Sports' },
  Supernatural: { es: 'Sobrenatural', en: 'Supernatural' },
  Thriller: { es: 'Suspenso', en: 'Thriller' },
}

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getMediaStatusLabel(status, lang) {
  if (status === 'RELEASING') return lang === 'en' ? 'Airing' : 'En emision'
  if (status === 'FINISHED') return lang === 'en' ? 'Finished' : 'Finalizado'
  if (status === 'NOT_YET_RELEASED') return lang === 'en' ? 'Coming soon' : 'Proximamente'
  return ''
}

function getBestTitle(media, lang) {
  if (media.synonyms?.length) {
    for (const synonym of media.synonyms) {
      const lower = synonym.toLowerCase()
      if (SPANISH_MARKERS.some((marker) => lower.includes(marker))) return synonym
    }
  }
  if (lang === 'en') return media.title?.english || media.title?.romaji || 'Untitled'
  return media.title?.english || media.title?.romaji || 'Sin titulo'
}

function uniqueMedia(items) {
  const seen = new Set()
  return (items ?? []).filter((item) => {
    const id = Number(item?.id || 0)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function shuffleMedia(items) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function HeroCarousel({ slides, lang, onSelect, searching }) {
  const [current, setCurrent] = useState(0)
  const timerRef = useRef(null)

  const resetTimer = useCallback(() => {
    clearInterval(timerRef.current)
    if (slides.length < 2) return
    timerRef.current = setInterval(() => setCurrent((value) => (value + 1) % slides.length), 7000)
  }, [slides.length])

  useEffect(() => {
    resetTimer()
    return () => clearInterval(timerRef.current)
  }, [resetTimer])

  const go = useCallback((dir) => {
    setCurrent((value) => (value + dir + slides.length) % slides.length)
    resetTimer()
  }, [slides.length, resetTimer])

  const gotoIndex = useCallback((index) => {
    setCurrent(index)
    resetTimer()
  }, [resetTimer])

  const slide = slides[current]
  if (!slide) return null

  const seasonLabel = (lang === 'en' ? SEASON_EN : SEASON_ES)[slide.season]
  const title = getBestTitle(slide, lang)
  const synopsis = stripHtml(slide.description)
  const score = slide.averageScore > 0 ? (slide.averageScore / 10).toFixed(1) : null
  const genres = (slide.genres ?? []).slice(0, 4)
  const isSearching = searching.has(slide.id)

  return (
    <div
      className="hero-carousel"
      onClick={() => !isSearching && onSelect(slide)}
      style={{ cursor: isSearching ? 'wait' : 'pointer' }}
    >
      <div
        key={`bg-${current}`}
        className="hero-banner"
        style={{ backgroundImage: slide.bannerImage ? `url(${slide.bannerImage})` : 'none' }}
      />
      <div className="hero-gradient" />

      <div key={`content-${current}`} className="hero-content fade-in">
        {slide.coverImage?.large && (
          <img src={slide.coverImage.large} alt={title} className="hero-cover" draggable={false} />
        )}

        <div className="hero-info">
          <div className="hero-eyebrow">
            {seasonLabel && slide.seasonYear && `${seasonLabel} ${slide.seasonYear}`}
            {score && <span className="hero-score-inline">* {score}</span>}
          </div>

          <div className="hero-title">{title}</div>

          {genres.length > 0 && (
            <div className="hero-genres">
              {genres.map((genre) => (
                <span key={genre} className="hero-genre-tag">
                  {GENRE_LABELS[genre]?.[lang] ?? GENRE_LABELS[genre]?.es ?? genre}
                </span>
              ))}
            </div>
          )}

          {synopsis && <p className="hero-synopsis">{synopsis}</p>}

          <div className="hero-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-primary hero-cta" onClick={() => onSelect(slide)} disabled={isSearching}>
              {isSearching
                ? <><span className="btn-spinner" />Buscando...</>
                : <>{lang === 'en' ? 'Open in JKAnime' : 'Ver en JKAnime'}</>}
            </button>
            {slide.episodes > 0 && <span className="hero-ep-count">{slide.episodes} eps</span>}
          </div>
        </div>
      </div>

      {slides.length > 1 && !isSearching && (
        <>
          <button className="hero-nav hero-nav-prev" onClick={(e) => { e.stopPropagation(); go(-1) }}>{'<'}</button>
          <button className="hero-nav hero-nav-next" onClick={(e) => { e.stopPropagation(); go(1) }}>{'>'}</button>
          <div className="hero-dots" onClick={(e) => e.stopPropagation()}>
            {slides.map((_, index) => (
              <button
                key={index}
                className={`hero-dot${index === current ? ' active' : ''}`}
                onClick={() => gotoIndex(index)}
              />
            ))}
          </div>
        </>
      )}

      {isSearching && (
        <div className="hero-loading-badge">
          <span className="btn-spinner" style={{ width: 14, height: 14 }} />
          {lang === 'en' ? 'Searching JKAnime...' : 'Buscando en JKAnime...'}
        </div>
      )}
    </div>
  )
}

function AnimeGrid({ media, lang, onSelect, searching }) {
  return (
    <div className="media-grid">
      {media.map((item) => {
        const title = getBestTitle(item, lang)
        const score = item.averageScore > 0 ? (item.averageScore / 10).toFixed(1) : null
        const isLoading = searching.has(item.id)
        const statusLabel = getMediaStatusLabel(item.status, lang)

        return (
          <div
            key={item.id}
            className={`media-card${isLoading ? ' media-card-busy' : ''}`}
            onClick={() => !isLoading && onSelect(item)}
            style={{ cursor: isLoading ? 'wait' : 'pointer' }}
          >
            {item.coverImage?.large
              ? <img src={item.coverImage.large} alt={title} className="media-card-cover" draggable={false} />
              : <div className="media-card-cover-placeholder">{lang === 'en' ? 'no cover' : 'sin portada'}</div>}

            {score && <div className="media-score-badge">* {score}</div>}
            {statusLabel && <div className="media-status-badge">{statusLabel}</div>}
            <div className="media-card-overlay" />

            {isLoading && (
              <div className="media-card-loading-overlay"><div className="card-spinner" /></div>
            )}

            <div className="media-card-body">
              <div className="media-card-title">{title}</div>
              <div className="media-card-meta">
                {score ? `* ${score}` : ''}
                {item.seasonYear ? ` · ${item.seasonYear}` : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TrendingShowcase({ media, lang, onSelect, searching }) {
  return (
    <div className="discover-highlight-grid">
      {media.map((item) => {
        const title = getBestTitle(item, lang)
        const score = item.averageScore > 0 ? (item.averageScore / 10).toFixed(1) : null
        const isLoading = searching.has(item.id)
        const backdrop = item.bannerImage || item.coverImage?.extraLarge || item.coverImage?.large || ''
        const poster = item.coverImage?.extraLarge || item.coverImage?.large || ''
        const statusLabel = getMediaStatusLabel(item.status, lang)
        const seasonLabel = (lang === 'en' ? SEASON_EN : SEASON_ES)[item.season] ?? item.season
        const synopsis = stripHtml(item.description)
        const genres = (item.genres ?? []).slice(0, 2)

        return (
          <article
            key={item.id}
            className={`discover-highlight-card${isLoading ? ' busy' : ''}`}
            onClick={() => !isLoading && onSelect(item)}
            style={{ cursor: isLoading ? 'wait' : 'pointer' }}
          >
            <div
              className="discover-highlight-backdrop"
              style={backdrop ? {
                backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.16) 0%, rgba(7,7,10,0.32) 26%, rgba(7,7,10,0.94) 100%), url(${backdrop})`,
              } : undefined}
            />

            <div className="discover-highlight-topline">
              {statusLabel && <span className="discover-highlight-pill">{statusLabel}</span>}
              {score && <span className="discover-highlight-pill accent">* {score}</span>}
            </div>

            {poster && (
              <img
                src={poster}
                alt={title}
                className="discover-highlight-poster"
                draggable={false}
              />
            )}

            <div className="discover-highlight-copy">
              <div className="discover-highlight-meta">
                {seasonLabel && <span>{seasonLabel}</span>}
                {item.seasonYear ? <span>{item.seasonYear}</span> : null}
                {item.episodes > 0 ? <span>{item.episodes} eps</span> : null}
              </div>

              <div className="discover-highlight-title">{title}</div>

              {genres.length > 0 && (
                <div className="discover-highlight-genres">
                  {genres.map((genre) => (
                    <span key={genre}>{GENRE_LABELS[genre]?.[lang] ?? GENRE_LABELS[genre]?.es ?? genre}</span>
                  ))}
                </div>
              )}

              {synopsis && (
                <p className="discover-highlight-synopsis">{synopsis}</p>
              )}

              <div className="discover-highlight-link">
                {lang === 'en' ? 'Open in JKAnime' : 'Abrir en JKAnime'}
              </div>
            </div>

            {isLoading && (
              <div className="discover-showcase-loading">
                <div className="card-spinner" />
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

function DiscoverRow({ title, media, lang, onSelect, searching }) {
  if (!media?.length) return null
  return (
    <div className="discover-subsection">
      <div className="discover-subsection-header">
        <div className="discover-subsection-title">{title}</div>
      </div>
      <AnimeGrid media={media} lang={lang} onSelect={onSelect} searching={searching} />
    </div>
  )
}

export default function Descubrir() {
  const navigate = useNavigate()
  const [slides, setSlides] = useState([])
  const [trendingMedia, setTrendingMedia] = useState([])
  const [popularYearMedia, setPopularYearMedia] = useState([])
  const [newReleaseMedia, setNewReleaseMedia] = useState([])
  const [recommendedMedia, setRecommendedMedia] = useState([])
  const [loading, setLoading] = useState(true)
  const [flashMsg, setFlashMsg] = useState(null)
  const [selected, setSelected] = useState(null)
  const [searching, setSearching] = useState(new Set())
  const { lang } = useI18n()

  const flash = useCallback((message) => {
    setFlashMsg(message)
    setTimeout(() => setFlashMsg(null), 4000)
  }, [])

  useEffect(() => {
    let cancelled = false
    const currentYear = new Date().getFullYear()
    setLoading(true)

    Promise.all([
      wails.getTrending(lang),
      wails.discoverAnime('', '', currentYear, 'POPULARITY_DESC', '', 1),
      wails.discoverAnime('', '', currentYear, 'START_DATE_DESC', '', 1),
      wails.discoverAnime('', '', 0, 'POPULARITY_DESC', 'FINISHED', 1),
    ]).then(([trendingRes, popularRes, newRes, recommendedRes]) => {
      if (cancelled) return

      const trending = uniqueMedia(trendingRes?.data?.Page?.media ?? [])
      const withBanner = trending.filter((item) => item.bannerImage)

      setSlides((withBanner.length >= 3 ? withBanner : trending).slice(0, 8))
      setTrendingMedia(trending.slice(0, 20))
      setPopularYearMedia(uniqueMedia(popularRes?.data?.Page?.media ?? []).slice(0, 12))
      setNewReleaseMedia(uniqueMedia(newRes?.data?.Page?.media ?? []).slice(0, 12))
      setRecommendedMedia(shuffleMedia(uniqueMedia(recommendedRes?.data?.Page?.media ?? [])).slice(0, 12))
    }).catch(() => {
      if (!cancelled) {
        flash(lang === 'en' ? 'Could not load trending anime.' : 'No se pudieron cargar tendencias.')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [lang, flash])

  const handleSelect = useCallback(async (media) => {
    if (searching.has(media.id)) return
    setSearching((prev) => new Set([...prev, media.id]))

    try {
      const { hit, searchedTitle } = await resolveAniListToJKAnime(media, wails)
      if (hit) {
        setSelected(hit)
      } else {
        flash(
          lang === 'en'
            ? `"${searchedTitle}" was not found on JKAnime.`
            : `"${searchedTitle}" no encontrado en JKAnime.`,
        )
      }
    } catch (error) {
      flash(String(error?.message ?? error))
    } finally {
      setSearching((prev) => {
        const next = new Set(prev)
        next.delete(media.id)
        return next
      })
    }
  }, [searching, lang, flash])

  if (selected) {
    return <OnlineAnimeDetail anime={selected} onBack={() => setSelected(null)} />
  }

  if (loading) {
    return (
      <div className="discover-loading">
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="loading-dot" />
          <span className="loading-dot" />
          <span className="loading-dot" />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {lang === 'en' ? 'Loading...' : 'Cargando...'}
        </p>
      </div>
    )
  }

  return (
    <div className="discover-page fade-in">
      {flashMsg && <div className="discover-flash">{flashMsg}</div>}

      {slides.length > 0 && (
        <HeroCarousel slides={slides} lang={lang} onSelect={handleSelect} searching={searching} />
      )}

      <div className="discover-tabs">
        <button className="discover-tab active" onClick={() => {}}>
          {lang === 'en' ? 'Trending' : 'Tendencias'}
        </button>
        <button className="discover-tab" onClick={() => navigate('/search')}>
          {lang === 'en' ? 'Anime Online' : 'Anime Online'}
        </button>
      </div>

      <div className="discover-content">
        <div className="discover-section-heading">
          <div className="discover-section-title discover-section-title-stacked">
            {lang === 'en' ? 'Trending right now' : 'En tendencia ahora'}
          </div>
        </div>

        {trendingMedia.length > 0 && (
          <>
            <TrendingShowcase media={trendingMedia.slice(0, 4)} lang={lang} onSelect={handleSelect} searching={searching} />
            <DiscoverRow
              title={lang === 'en' ? 'More to watch' : 'Mas para ver'}
              media={trendingMedia.slice(4, 16)}
              lang={lang}
              onSelect={handleSelect}
              searching={searching}
            />
            <DiscoverRow
              title={lang === 'en' ? `Popular in ${new Date().getFullYear()}` : `Populares en ${new Date().getFullYear()}`}
              media={popularYearMedia}
              lang={lang}
              onSelect={handleSelect}
              searching={searching}
            />
            <DiscoverRow
              title={lang === 'en' ? 'New Releases' : 'Nuevos Lanzamientos'}
              media={newReleaseMedia}
              lang={lang}
              onSelect={handleSelect}
              searching={searching}
            />
            <DiscoverRow
              title={lang === 'en' ? 'Recommendations' : 'Recomendaciones'}
              media={recommendedMedia}
              lang={lang}
              onSelect={handleSelect}
              searching={searching}
            />
          </>
        )}
      </div>
    </div>
  )
}
