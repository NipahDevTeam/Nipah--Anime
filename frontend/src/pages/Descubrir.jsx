import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { useI18n } from '../lib/i18n'
import { resolveAniListToJKAnime } from '../lib/onlineAnimeResolver'
import OnlineAnimeDetail from '../components/ui/OnlineAnimeDetail'
// VirtualMediaGrid removed — genre rows now use HScrollRow (horizontal scroll)

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

const DISCOVER_GENRE_ROWS = [
  { key: 'action',        genre: 'Action',        titleEs: 'Accion sin descanso',             titleEn: 'Action'           },
  { key: 'adventure',     genre: 'Adventure',     titleEs: 'Aventuras que enganchan',          titleEn: 'Adventure'        },
  { key: 'comedy',        genre: 'Comedy',        titleEs: 'Comedia para relajar',             titleEn: 'Comedy'           },
  { key: 'drama',         genre: 'Drama',         titleEs: 'Dramas que atrapan',               titleEn: 'Drama'            },
  { key: 'fantasy',       genre: 'Fantasy',       titleEs: 'Mundos de fantasia',               titleEn: 'Fantasy'          },
  { key: 'romance',       genre: 'Romance',       titleEs: 'Romance',                          titleEn: 'Romance'          },
  { key: 'scifi',         genre: 'Sci-Fi',        titleEs: 'Ciencia ficcion',                  titleEn: 'Sci-Fi'           },
  { key: 'slice',         genre: 'Slice of Life', titleEs: 'Slice of Life',                    titleEn: 'Slice of Life'    },
  { key: 'supernatural',  genre: 'Supernatural',  titleEs: 'Sobrenatural',                     titleEn: 'Supernatural'     },
  { key: 'thriller',      genre: 'Thriller',      titleEs: 'Suspenso',                         titleEn: 'Thriller'         },
  { key: 'mystery',       genre: 'Mystery',       titleEs: 'Misterio',                         titleEn: 'Mystery'          },
  { key: 'psychological', genre: 'Psychological', titleEs: 'Psicologico',                      titleEn: 'Psychological'    },
  { key: 'sports',        genre: 'Sports',        titleEs: 'Deporte y determinacion',          titleEn: 'Sports'           },
  { key: 'horror',        genre: 'Horror',        titleEs: 'Terror',                           titleEn: 'Horror'           },
  { key: 'mecha',         genre: 'Mecha',         titleEs: 'Mecha',                            titleEn: 'Mecha'            },
  { key: 'music',         genre: 'Music',         titleEs: 'Musica y ritmo',                   titleEn: 'Music'            },
]

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
  const score = slide.averageScore > 0 ? (slide.averageScore / 10).toFixed(1) : null
  const genres = (slide.genres ?? []).slice(0, 4)
  const isSearching = searching.has(slide.id)
  const preferredSourceLabel = lang === 'en' ? 'AnimeHeaven' : 'AnimeAV1'

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

          <div className="hero-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-primary hero-cta" onClick={() => onSelect(slide)} disabled={isSearching}>
              {isSearching
                ? <><span className="btn-spinner" />Buscando...</>
                : <>{lang === 'en' ? `Watch in ${preferredSourceLabel}` : `Ver en ${preferredSourceLabel}`}</>}
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
          {lang === 'en' ? `Searching ${preferredSourceLabel}...` : `Buscando en ${preferredSourceLabel}...`}
        </div>
      )}
    </div>
  )
}

/* ── Portrait card for horizontal scroll rows ─────────────────────────────── */
function PortraitCard({ item, lang, onSelect, searching }) {
  const title = getBestTitle(item, lang)
  const score = item.averageScore > 0 ? (item.averageScore / 10).toFixed(1) : null
  const isLoading = searching?.has(item.id)
  const statusLabel = getMediaStatusLabel(item.status, lang)

  return (
    <div
      className={`pcard${isLoading ? ' pcard-busy' : ''}`}
      onClick={() => !isLoading && onSelect(item)}
      title={title}
      style={{ cursor: isLoading ? 'wait' : 'pointer' }}
    >
      {item.coverImage?.large
        ? <img src={item.coverImage.large} alt={title} className="pcard-img" draggable={false} />
        : <div className="pcard-img-empty" />}

      <div className="pcard-vignette" />
      {score && <div className="pcard-score">★ {score}</div>}
      {statusLabel && <div className="pcard-status">{statusLabel}</div>}

      {isLoading && <div className="pcard-loading"><div className="card-spinner" /></div>}

      <div className="pcard-body">
        <div className="pcard-title">{title}</div>
        {item.seasonYear ? <div className="pcard-meta">{item.seasonYear}</div> : null}
      </div>
    </div>
  )
}

/* ── Horizontal scroll track ─────────────────────────────────────────────── */
function HScrollTrack({ media, lang, onSelect, searching }) {
  if (!media?.length) return null
  return (
    <div className="hrow-track">
      {media.map((item) => (
        <PortraitCard
          key={item.id}
          item={item}
          lang={lang}
          onSelect={onSelect}
          searching={searching}
        />
      ))}
    </div>
  )
}

// Legacy placeholder — kept so existing call sites compile (unused visually)
function TrendingShowcase({ media, lang, onSelect, searching }) {
  return <HScrollTrack media={media} lang={lang} onSelect={onSelect} searching={searching} />
}

function DiscoverRow({ title, media, lang, onSelect, searching }) {
  const trackRef = useRef(null)
  if (!media?.length) return null

  const scrollRight = () => {
    if (trackRef.current) {
      trackRef.current.scrollBy({ left: 760, behavior: 'smooth' })
    }
  }

  const scrollLeft = () => {
    if (trackRef.current) {
      trackRef.current.scrollBy({ left: -760, behavior: 'smooth' })
    }
  }

  return (
    <div className="hrow">
      <div className="hrow-header">
        <div className="hrow-title">{title}</div>
      </div>
      {/* hrow-body: left arrow + scrollable track + right arrow */}
      <div className="hrow-body">
        <button
          className="hrow-start-arrow"
          type="button"
          onClick={scrollLeft}
          aria-label={lang === 'en' ? 'Scroll left' : 'Desplazar izquierda'}
        >
          ‹
        </button>
        <div className="hrow-track" ref={trackRef}>
          {media.map((item) => (
            <PortraitCard
              key={item.id}
              item={item}
              lang={lang}
              onSelect={onSelect}
              searching={searching}
            />
          ))}
        </div>
        <button
          className="hrow-end-arrow"
          type="button"
          onClick={scrollRight}
          aria-label={lang === 'en' ? 'Scroll right' : 'Desplazar derecha'}
        >
          ›
        </button>
      </div>
    </div>
  )
}

export function DiscoverFeed({ embedded = false, afterHeroSlot = null }) {
  const navigate = useNavigate()
  const [flashMsg, setFlashMsg] = useState(null)
  const [selected, setSelected] = useState(null)
  const [searching, setSearching] = useState(new Set())
  const { lang } = useI18n()

  const flash = useCallback((message) => {
    setFlashMsg(message)
    setTimeout(() => setFlashMsg(null), 4000)
  }, [])

  const {
    data: discoverData,
    isLoading: loading,
  } = useQuery({
    queryKey: ['discover-anime', lang],
    queryFn: async () => {
      const currentYear = new Date().getFullYear()
      const settled = await Promise.allSettled([
        wails.getTrending(lang),
        wails.discoverAnime('', '', currentYear, 'POPULARITY_DESC', '', 1),
        wails.discoverAnime('', '', currentYear, 'START_DATE_DESC', '', 1),
        wails.discoverAnime('', '', 0, 'POPULARITY_DESC', 'FINISHED', 1),
        ...DISCOVER_GENRE_ROWS.map((row) => wails.discoverAnime(row.genre, '', 0, 'POPULARITY_DESC', '', 1)),
      ])

      const pick = (index) => (settled[index]?.status === 'fulfilled' ? settled[index].value : null)
      const trendingRes = pick(0)
      const popularRes = pick(1)
      const newRes = pick(2)
      const recommendedRes = pick(3)
      const genreResults = DISCOVER_GENRE_ROWS.map((_, index) => pick(index + 4))

      const trending = uniqueMedia(trendingRes?.data?.Page?.media ?? [])
      const withBanner = trending.filter((item) => item.bannerImage)
      const genreRows = DISCOVER_GENRE_ROWS.map((row, index) => ({
        key: row.key,
        genre: row.genre,
        title: lang === 'en' ? row.titleEn : row.titleEs,
        media: uniqueMedia(genreResults[index]?.data?.Page?.media ?? []).slice(0, 20),
      })).filter((row) => row.media.length > 0)

      return {
        slides: (withBanner.length >= 3 ? withBanner : trending).slice(0, 10),
        trendingMedia: trending.slice(0, 20),
        popularYearMedia: uniqueMedia(popularRes?.data?.Page?.media ?? []).slice(0, 20),
        newReleaseMedia: uniqueMedia(newRes?.data?.Page?.media ?? []).slice(0, 20),
        recommendedMedia: shuffleMedia(uniqueMedia(recommendedRes?.data?.Page?.media ?? [])).slice(0, 20),
        genreRows,
      }
    },
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
  })

  useEffect(() => {
    if (loading || discoverData) return
    flash(lang === 'en' ? 'Could not load trending anime.' : 'No se pudieron cargar tendencias.')
  }, [discoverData, flash, lang, loading])

  const slides = discoverData?.slides ?? []
  const trendingMedia = discoverData?.trendingMedia ?? []
  const popularYearMedia = discoverData?.popularYearMedia ?? []
  const newReleaseMedia = discoverData?.newReleaseMedia ?? []
  const recommendedMedia = discoverData?.recommendedMedia ?? []
  const genreRows = discoverData?.genreRows ?? []
  const showcaseMedia = embedded ? trendingMedia.slice(0, 20) : trendingMedia.slice(0, 20)
  const hasAnyDiscoverContent = slides.length > 0 ||
    trendingMedia.length > 0 ||
    popularYearMedia.length > 0 ||
    newReleaseMedia.length > 0 ||
    recommendedMedia.length > 0 ||
    genreRows.length > 0

  const handleSelect = useCallback(async (media) => {
    if (searching.has(media.id)) return
    setSearching((prev) => new Set([...prev, media.id]))

    try {
      const preferredSource = lang === 'en' ? 'animeheaven-en' : 'animeav1-es'
      const preferredSourceLabel = lang === 'en' ? 'AnimeHeaven' : 'AnimeAV1'
      const { hit, searchedTitle } = await resolveAniListToJKAnime(media, wails, preferredSource)
      if (hit) {
        setSelected(hit)
      } else {
        flash(
          lang === 'en'
            ? `"${searchedTitle}" was not found on ${preferredSourceLabel}.`
            : `"${searchedTitle}" no encontrado en ${preferredSourceLabel}.`,
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
    <div className={`discover-page fade-in${embedded ? ' discover-page-embedded' : ''}`}>
      {flashMsg && <div className="discover-flash">{flashMsg}</div>}

      {slides.length > 0 && (
        <HeroCarousel slides={slides} lang={lang} onSelect={handleSelect} searching={searching} />
      )}

      {afterHeroSlot}

      {!embedded && (
        <div className="discover-tabs">
          <button className="discover-tab active" onClick={() => {}}>
            {lang === 'en' ? 'Trending' : 'Tendencias'}
          </button>
          <button className="discover-tab" onClick={() => navigate('/search')}>
            {lang === 'en' ? 'Anime Online' : 'Anime Online'}
          </button>
        </div>
      )}

      <div className="discover-content">
        {hasAnyDiscoverContent && (
          <>
            {showcaseMedia.length > 0 && (
              <DiscoverRow
                title={lang === 'en' ? 'Trending now' : 'En tendencia'}
                media={showcaseMedia}
                lang={lang}
                onSelect={handleSelect}
                searching={searching}
              />
            )}
            {popularYearMedia.length > 0 && (
              <DiscoverRow
                title={lang === 'en' ? `Popular in ${new Date().getFullYear()}` : `Populares en ${new Date().getFullYear()}`}
                media={popularYearMedia}
                lang={lang}
                onSelect={handleSelect}
                searching={searching}
              />
            )}
            {newReleaseMedia.length > 0 && (
              <DiscoverRow
                title={lang === 'en' ? 'New Releases' : 'Nuevos lanzamientos'}
                media={newReleaseMedia}
                lang={lang}
                onSelect={handleSelect}
                searching={searching}
              />
            )}
            {recommendedMedia.length > 0 && (
              <DiscoverRow
                title={lang === 'en' ? 'Recommendations' : 'Recomendaciones'}
                media={recommendedMedia}
                lang={lang}
                onSelect={handleSelect}
                searching={searching}
              />
            )}
            {genreRows.map((row) => (
              <DiscoverRow
                key={row.key}
                title={row.title}
                media={row.media}
                lang={lang}
                onSelect={handleSelect}
                searching={searching}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default function Descubrir() {
  return <DiscoverFeed />
}
