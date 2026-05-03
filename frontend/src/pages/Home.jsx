import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MANGA_SOURCE_IDS, normalizeMangaSourceID } from '../lib/mangaSources'
import { buildOrderedMangaSearchCandidates } from '../lib/mangaSearchCandidates'
import { isAniListUnavailableErrorMessage } from '../lib/anilistStatus'
import { useStableLoadingGate } from '../lib/useStableLoadingGate'
import { buildAnimeNavigationState } from '../lib/mediaNavigation'
import { proxyImage, wails } from '../lib/wails'
import { enrichJKAnimeHit } from '../lib/onlineAnimeResolver'
import { toastSuccess, toastError } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'
import { EventsOn } from '../../wailsjs/runtime/runtime'

/* ─────────────────────────────────────────────────────────────
   Manga grid card — large portrait card used in the manga tab
   ───────────────────────────────────────────────────────────── */
function MangaGridCard({ title, cover, badge, sub, onClick }) {
  const [imgErr, setImgErr] = useState(false)
  return (
    <div className="mgcard" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick && onClick()}>
      <div className="mgcard-cover">
        {!imgErr && cover
          ? <img src={cover} alt={title} onError={() => setImgErr(true)} loading="lazy" />
          : <div className="mgcard-cover-fallback">{title?.[0] ?? '?'}</div>}
        {badge && <span className="mgcard-badge">{badge}</span>}
      </div>
      <div className="mgcard-title">{title}</div>
      {sub && <div className="mgcard-sub">{sub}</div>}
    </div>
  )
}

function MangaGridSection({ title, count, items }) {
  if (!items || items.length === 0) return null
  return (
    <div className="manga-grid-section">
      <div className="manga-grid-section-header">
        <span className="manga-grid-section-title">{title}</span>
        <span className="manga-grid-section-count">[{count ?? items.length}]</span>
      </div>
      <div className="manga-grid">
        {items.map(item => <MangaGridCard key={item.key} {...item} />)}
      </div>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="fade-in home-catalog-page">
      <div className="home-catalog-body home-skeleton-page">
        <div className="home-main-tabs">
          <div className="skeleton-block home-skeleton-pill" />
          <div className="skeleton-block home-skeleton-pill" />
        </div>

        <section className="home-skeleton-hero">
          <div className="home-skeleton-hero-copy">
            <div className="skeleton-block skeleton-line skeleton-line-lg" />
            <div className="skeleton-block skeleton-line skeleton-line-md" />
            <div className="skeleton-block skeleton-line skeleton-line-sm" />
          </div>
          <div className="home-skeleton-hero-visual">
            <div className="skeleton-block home-skeleton-poster" />
            <div className="skeleton-block home-skeleton-poster tall" />
            <div className="skeleton-block home-skeleton-poster" />
          </div>
        </section>

        {[0, 1, 2].map((section) => (
          <section key={section} className="home-skeleton-shelf">
            <div className="home-skeleton-shelf-head">
              <div className="skeleton-block skeleton-line skeleton-line-md" />
              <div className="skeleton-block skeleton-line skeleton-line-xs" />
            </div>
            <div className="home-skeleton-card-row">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`${section}-${index}`} className="home-skeleton-card">
                  <div className="skeleton-block home-skeleton-card-image" />
                  <div className="skeleton-block skeleton-line skeleton-line-md" />
                  <div className="skeleton-block skeleton-line skeleton-line-xs" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function HomeDiscoverFallback({ isEnglish = false }) {
  return (
    <section className="home-shelf">
      <div className="home-shelf-header">
        <div className="home-shelf-copy">
          <div className="home-shelf-title">{isEnglish ? 'Loading discover feed' : 'Cargando descubrir'}</div>
          <div className="home-shelf-subtitle">{isEnglish ? 'Preparing your home feed...' : 'Preparando tu feed inicial...'}</div>
        </div>
      </div>
      <div className="home-skeleton-card-row">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="home-skeleton-card">
            <div className="skeleton-block home-skeleton-card-image" />
            <div className="skeleton-block skeleton-line skeleton-line-md" />
            <div className="skeleton-block skeleton-line skeleton-line-xs" />
          </div>
        ))}
      </div>
    </section>
  )
}

const SOURCE_COLORS = {
  'jkanime-es': '#c084fc',
  'animepahe-en': '#38bdf8',
  'mangaoni-es': '#52c07a',
  mangaoni: '#52c07a',
  'mangadex-es': '#f5a623',
  mangadex: '#f5a623',
}

const LIST_STATUS_PRIORITY = {
  WATCHING: 0,
  PLANNING: 1,
  ON_HOLD: 2,
  COMPLETED: 3,
  DROPPED: 4,
}

const HOME_GENRE_ROWS = [
  { key: 'romance', genre: 'Romance', labelEs: 'Romance para maratonear', labelEn: 'Romance picks' },
  { key: 'fantasy', genre: 'Fantasy', labelEs: 'Mundos de fantasia', labelEn: 'Fantasy worlds' },
  { key: 'slice', genre: 'Slice of Life', labelEs: 'Slice of life', labelEn: 'Slice of life' },
  { key: 'drama', genre: 'Drama', labelEs: 'Dramas que atrapan', labelEn: 'Drama picks' },
  { key: 'action', genre: 'Action', labelEs: 'Accion sin descanso', labelEn: 'Action essentials' },
  { key: 'scifi', genre: 'Sci-Fi', labelEs: 'Ciencia ficcion para perderse', labelEn: 'Sci-fi standouts' },
  { key: 'comedy', genre: 'Comedy', labelEs: 'Comedia para relajar', labelEn: 'Comedy comfort picks' },
]

const HOME_QUERY_TIMEOUT_MS = 6500

function runHomeQueryWithTimeout(promise, label) {
  let timer = null
  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`AniList ${label} timeout`))
    }, HOME_QUERY_TIMEOUT_MS)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer != null) window.clearTimeout(timer)
  })
}

function isMangaHistorySource(sourceID) {
  const raw = String(sourceID || '').trim()
  if (!raw) return false
  return MANGA_SOURCE_IDS.has(normalizeMangaSourceID(raw))
}

function normalizeOptionalMangaSourceID(sourceID) {
  const raw = String(sourceID || '').trim()
  return raw ? normalizeMangaSourceID(raw) : ''
}

function getListStatusLabel(status, isEnglish = false) {
  switch (status) {
    case 'WATCHING': return isEnglish ? 'Watching' : 'Viendo'
    case 'CURRENT': return isEnglish ? 'Reading' : 'Leyendo'
    case 'PLANNING': return isEnglish ? 'Planning' : 'Planeado'
    case 'ON_HOLD': return isEnglish ? 'On Hold' : 'En pausa'
    case 'COMPLETED': return isEnglish ? 'Completed' : 'Completado'
    case 'DROPPED': return isEnglish ? 'Dropped' : 'Abandonado'
    default: return status || ''
  }
}

function sortTrackedEntries(items) {
  return [...(items ?? [])].sort((a, b) => {
    const priorityDelta = (LIST_STATUS_PRIORITY[a.status] ?? 99) - (LIST_STATUS_PRIORITY[b.status] ?? 99)
    if (priorityDelta !== 0) return priorityDelta
    const aUpdated = new Date(a.updated_at ?? a.added_at ?? 0).getTime()
    const bUpdated = new Date(b.updated_at ?? b.added_at ?? 0).getTime()
    return bUpdated - aUpdated
  })
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

function uniqueMedia(items) {
  const seen = new Set()
  return (items ?? []).filter((item) => {
    const id = Number(item?.id || 0)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function normalizeHomeMangaKey(item) {
  const anilistID = Number(item?.anilist_id || item?.AniListID || 0)
  if (anilistID > 0) return `anilist:${anilistID}`
  const candidates = buildOrderedMangaSearchCandidates(item)
  const rawTitle = String(candidates[0] || item?.canonical_title || item?.title || item?.anime_title || item?.manga_title || item?.title_english || '').trim().toLowerCase()
  if (!rawTitle) return ''
  return `title:${rawTitle
    .replace(/[_\-:.,/()]+/g, ' ')
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()}`
}

function getHomeDirectMangaID(item) {
  const explicitSourceMangaID = String(item?.source_manga_id || '').trim()
  if (explicitSourceMangaID) return explicitSourceMangaID
  const sourceID = normalizeOptionalMangaSourceID(item?.source_id || '')
  if (!isMangaHistorySource(sourceID)) return ''
  return String(item?.anime_id || '').trim()
}

function buildHomeMangaNavigationState(item) {
  const preferredAnilistID = Number(item?.anilist_id || item?.AniListID || 0)
  const preferredSourceID = normalizeOptionalMangaSourceID(item?.default_source_id || item?.source_id || '')
  const directMangaID = getHomeDirectMangaID(item)
  const candidates = buildOrderedMangaSearchCandidates(item)
  const preSearch = candidates[0] || ''
  const altSearch = candidates.find((value) => value && value !== preSearch) || ''
  const canAutoOpenDirect = Boolean(preferredSourceID && directMangaID && (String(item?.source_manga_id || '').trim() || isMangaHistorySource(preferredSourceID)))
  const state = {}
  const seedItem = {
    anilist_id: preferredAnilistID,
    title: item?.title || item?.anime_title || item?.manga_title || '',
    canonical_title: item?.canonical_title || item?.title || item?.anime_title || item?.manga_title || '',
    title_english: item?.title_english || '',
    canonical_title_english: item?.canonical_title_english || item?.title_english || '',
    title_romaji: item?.title_romaji || '',
    title_native: item?.title_native || '',
    cover_url: item?.resolved_cover_url || item?.cover_url || item?.cover_image || '',
    resolved_cover_url: item?.resolved_cover_url || item?.cover_url || item?.cover_image || '',
    banner_url: item?.resolved_banner_url || item?.banner_url || item?.banner_image || '',
    resolved_banner_url: item?.resolved_banner_url || item?.banner_url || item?.banner_image || '',
    description: item?.resolved_description || item?.description || '',
    resolved_description: item?.resolved_description || item?.description || '',
    year: Number(item?.resolved_year || item?.year || 0),
    resolved_year: Number(item?.resolved_year || item?.year || 0),
    format: item?.resolved_format || item?.format || item?.media_format || '',
    resolved_format: item?.resolved_format || item?.format || item?.media_format || '',
    country_of_origin: item?.resolved_country_of_origin || item?.country_of_origin || '',
    synonyms: Array.isArray(item?.synonyms) ? item.synonyms : [],
    chapters_read: Number(item?.chapters_read || 0),
    chapters_total: Number(item?.chapters_total || 0),
    default_source_id: preferredSourceID,
    search_candidates: candidates,
  }
  if (canAutoOpenDirect) {
    state.autoOpen = {
      id: directMangaID,
      title: item?.title || item?.anime_title || item?.manga_title || '',
      cover_url: item?.resolved_cover_url || item?.cover_url || item?.cover_image || '',
      resolved_cover_url: item?.resolved_cover_url || item?.cover_url || item?.cover_image || '',
      resolved_banner_url: item?.resolved_banner_url || item?.banner_url || item?.banner_image || '',
      resolved_description: item?.resolved_description || item?.description || '',
      canonical_title: item?.canonical_title || item?.title || item?.anime_title || item?.manga_title || '',
      canonical_title_english: item?.canonical_title_english || item?.title_english || '',
      anilist_id: preferredAnilistID,
      mal_id: Number(item?.mal_id || item?.MalID || 0),
      in_manga_list: Boolean(item?.in_manga_list),
      manga_list_status: item?.manga_list_status || item?.status || '',
      chapters_read: Number(item?.chapters_read || 0),
      year: Number(item?.resolved_year || item?.year || 0),
      resolved_year: Number(item?.resolved_year || item?.year || 0),
      source_id: preferredSourceID,
    }
    if (item?.episode_id) state.autoReadChapterID = item.episode_id
    return state
  }
  if (preferredAnilistID > 0) state.preferredAnilistID = preferredAnilistID
  if (candidates.length > 0) state.searchCandidates = candidates
  if (preSearch) state.preSearch = preSearch
  if (altSearch) state.altSearch = altSearch
  if (preferredAnilistID > 0 || seedItem.title || seedItem.cover_url) state.seedItem = seedItem
  return state
}

function formatHomeMangaChapterBadge(chapterNum, isEnglish = false) {
  const numeric = Number(chapterNum || 0)
  if (numeric <= 0) return ''
  return `${isEnglish ? 'Ch.' : 'Cap.'} ${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)}`
}

function buildContinueHistoryMangaCard(item, isEnglish, onOpen) {
  const sourceName = item?.source_name || String(item?.source_id || '').replace(/-es$|-en$/, '')
  return {
    key: `home-manga-history-${item?.source_id || 'src'}-${item?.episode_id || item?.anime_id || item?.anilist_id || item?.anime_title || 'manga'}`,
    title: item?.anime_title || item?.manga_title || item?.title || 'Manga',
    image: item?.cover_url || item?.cover_image || '',
    badge: formatHomeMangaChapterBadge(item?.episode_num, isEnglish),
    meta: [sourceName].filter(Boolean),
    onClick: () => onOpen(item),
  }
}

function buildTrackedMangaCard(item, isEnglish, onOpen, className = '') {
  const chaptersRead = Number(item?.chapters_read || 0)
  const chaptersTotal = Number(item?.chapters_total || 0)
  const progressBadge = chaptersRead > 0 ? (chaptersTotal > 0 ? `${chaptersRead}/${chaptersTotal}` : `${isEnglish ? 'Ch.' : 'Cap.'} ${chaptersRead}`) : ''
  return {
    key: `home-manga-tracked-${item?.anilist_id || item?.mal_id || item?.id || item?.title}`,
    title: item?.title_english || item?.title || 'Manga',
    image: item?.cover_image || item?.cover_url || '',
    badge: progressBadge || getListStatusLabel(item?.status, isEnglish),
    meta: [
      item?.year ? String(item.year) : '',
      chaptersTotal > 0 ? `${chaptersTotal} ${isEnglish ? 'chapters' : 'caps'}` : '',
    ].filter(Boolean),
    className,
    onClick: () => onOpen(item),
  }
}

function buildRecommendedMangaCard(item, isEnglish, onOpen) {
  const genres = Array.isArray(item?.genres) ? item.genres.filter(Boolean) : []
  return {
    key: `home-manga-recommendation-${item?.anilist_id || item?.id || item?.title}`,
    title: item?.title_english || item?.title || 'Manga',
    image: item?.resolved_cover_url || item?.cover_url || item?.cover_image || '',
    badge: genres[0] || (item?.format ? String(item.format) : ''),
    meta: [
      item?.year ? String(item.year) : '',
      item?.status ? getListStatusLabel(item.status, isEnglish) : '',
      ...genres.slice(1, 3),
    ].filter(Boolean),
    className: 'home-manga-feature-card',
    onClick: () => onOpen(item),
  }
}

function getAniListTitle(media, isEnglish = false) {
  return isEnglish
    ? media?.title?.english || media?.title?.romaji || media?.title?.native || 'Anime'
    : media?.title?.english || media?.title?.romaji || media?.title?.native || 'Anime'
}

function getAniListMeta(media) {
  const parts = []
  if (media?.seasonYear) parts.push(String(media.seasonYear))
  if (media?.format) parts.push(media.format)
  if (media?.episodes > 0) parts.push(`${media.episodes} eps`)
  if (media?.averageScore > 0) parts.push(`${(media.averageScore / 10).toFixed(1)}`)
  return parts
}

function getGenreSubtitle(genreKey, isEnglish = false) {
  switch (genreKey) {
    case 'romance': return isEnglish ? 'Warm, dramatic, and a little messy' : 'Calidas, dramaticas y un poco caoticas'
    case 'fantasy': return isEnglish ? 'Big worlds, stronger vibes' : 'Grandes mundos y mejores sensaciones'
    case 'slice': return isEnglish ? 'Quieter stories that still hit hard' : 'Historias tranquilas que igual pegan fuerte'
    case 'drama': return isEnglish ? 'For nights that need tension' : 'Para noches que piden tension'
    case 'action': return isEnglish ? 'Fast, loud, and impossible to ignore' : 'Rapidas, intensas e imposibles de ignorar'
    case 'scifi': return isEnglish ? 'Future shock and strange worlds' : 'Futuros raros y mundos fuera de norma'
    case 'comedy': return isEnglish ? 'Lighter picks with good rhythm' : 'Series ligeras con muy buen ritmo'
    default: return ''
  }
}

function ProgressRing({ percent, size = 32 }) {
  const r = (size - 4) / 2
  const circ = 2 * Math.PI * r
  const filled = circ * (Math.min(percent, 100) / 100)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={3}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
      />
    </svg>
  )
}

function ShelfSection({ title, subtitle, action, children, className = '', customTrack = false }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null
  return (
    <section className={`home-shelf ${className}`.trim()}>
      <div className="home-shelf-header">
        <div className="home-shelf-copy">
          <div className="home-shelf-title">{title}</div>
          {subtitle ? <div className="home-shelf-subtitle">{subtitle}</div> : null}
        </div>
        {action ? <div className="home-shelf-action">{action}</div> : null}
      </div>
      {customTrack ? children : <div className="home-shelf-track">{children}</div>}
    </section>
  )
}

function ShelfScroller({ children, showArrows = false, className = '' }) {
  const trackRef = useRef(null)

  const scrollByAmount = useCallback((direction) => {
    const track = trackRef.current
    if (!track) return
    const amount = Math.max(320, Math.round(track.clientWidth * 0.82))
    track.scrollBy({ left: direction * amount, behavior: 'smooth' })
  }, [])

  return (
    <div className={`home-shelf-track-shell${showArrows ? ' with-arrows' : ''} ${className}`.trim()}>
      {showArrows && (
        <button type="button" className="home-shelf-arrow home-shelf-arrow-left" onClick={() => scrollByAmount(-1)} aria-label="Scroll left">
          ‹
        </button>
      )}
      <div className="home-shelf-track" ref={trackRef}>{children}</div>
      {showArrows && (
        <button type="button" className="home-shelf-arrow home-shelf-arrow-right" onClick={() => scrollByAmount(1)} aria-label="Scroll right">
          ›
        </button>
      )}
    </div>
  )
}

function HomeRailCard({ item, title, meta = [], image, badge = '', onClick, busy = false, className = '' }) {
  return (
    <button type="button" className={`home-rail-card${busy ? ' busy' : ''} ${className}`.trim()} onClick={onClick} disabled={busy}>
      {image ? (
        <img src={image} alt={title} className="home-rail-card-image" />
      ) : (
        <div className="home-rail-card-image home-rail-card-image-placeholder">N/A</div>
      )}
      <div className="home-rail-card-overlay" />
      {badge ? <div className="home-rail-card-badge">{badge}</div> : null}
      <div className="home-rail-card-copy">
        <div className="home-rail-card-title">{title}</div>
        {meta?.length ? <div className="home-rail-card-meta">{meta.join(' · ')}</div> : null}
      </div>
    </button>
  )
}

function OnlineHistoryCard({ item, navigate, targetPath = '/search', chapterPrefix = 'Ep.', autoRead = false, onOpenAnime }) {
  const color = SOURCE_COLORS[item.source_id] ?? '#9090a8'
  return (
    <div
      className="home-progress-card"
      onClick={() => {
        if (targetPath === '/search' && onOpenAnime) {
          onOpenAnime(item)
          return
        }
        navigate(targetPath, {
          state: {
            autoOpen: {
              id: item.anime_id,
              title: item.anime_title,
              cover_url: item.cover_url,
              source_id: item.source_id,
              source_name: item.source_name,
            },
            ...(autoRead ? { autoReadChapterID: item.episode_id } : {}),
          },
        })
      }}
      title={`${item.anime_title} - ${chapterPrefix} ${item.episode_num ?? '?'}`}
    >
      <div className="home-progress-poster">
        {item.cover_url
          ? <img src={proxyImage(item.cover_url)} alt={item.anime_title} className="home-progress-poster-image" />
          : <div className="home-progress-poster-image" />}
      </div>
      <div className="home-progress-copy">
        <div className="home-progress-title">{item.anime_title}</div>
        <div className="home-progress-meta">
          {chapterPrefix} {item.episode_num ?? '?'}
          {item.episode_title ? ` · ${item.episode_title}` : ''}
        </div>
        <div className="home-progress-source" style={{ color }}>
          {item.source_name}
        </div>
      </div>
    </div>
  )
}

function ContinueCard({ item, onClick }) {
  const [imgErr, setImgErr] = useState(false)
  const title = item?.anime_title || item?.animeTitle || 'Anime'
  const episodeValue = item?.episode_num ?? item?.episodeTitle ?? '?'
  const percent = item?.percent ?? item?.progressPercent ?? 0
  const image = resolveResumeCardImage(item)
  return (
    <div className="home-progress-card" onClick={onClick}>
      <div className="home-progress-poster">
        {image && !imgErr
          ? <img src={image} alt={title} className="home-progress-poster-image" onError={() => setImgErr(true)} />
          : <div className="home-progress-poster-image home-progress-poster-fallback">{title?.[0] ?? '?'}</div>
        }
        <div className="home-progress-ring">
          <ProgressRing percent={percent} />
        </div>
      </div>
      <div className="home-progress-copy">
        <div className="home-progress-title">{title}</div>
        <div className="home-progress-meta">
          Ep. {item.episode_num ?? '?'}
          {item.percent != null && item.percent > 0 ? ` · ${Math.round(item.percent)}%` : ''}
        </div>
      </div>
    </div>
  )
}

function formatCompactDuration(seconds, isEnglish = false) {
  const safe = Math.max(0, Math.round(Number(seconds || 0)))
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600)
    const minutes = Math.floor((safe % 3600) / 60)
    return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  }
  const minutes = Math.max(1, Math.round(safe / 60))
  return isEnglish ? `${minutes} min` : `${minutes} min`
}

function buildResumeBadge(progressSec, durationSec, isEnglish = false) {
  const progress = Number(progressSec || 0)
  const duration = Number(durationSec || 0)
  if (duration > 0 && progress > 0) {
    const remaining = Math.max(duration - progress, 0)
    if (remaining > 0) {
      return isEnglish ? `${formatCompactDuration(remaining, true)} left` : `${formatCompactDuration(remaining)} restantes`
    }
    return isEnglish ? 'Ready to finish' : 'Listo para terminar'
  }
  return isEnglish ? 'Resume' : 'Continuar'
}

function resolveResumeCardImage(item) {
  const image = item?.image
    || item?.resolved_cover_url
    || item?.cover_url
    || item?.cover_image
    || item?.resolved_banner_url
    || item?.banner_url
    || item?.banner_image
    || ''
  return image ? proxyImage(image) : ''
}

function ContinueWatchingRailCard({ entry }) {
  const [imgErr, setImgErr] = useState(false)
  const progressWidth = entry.progressPercent != null ? `${Math.max(4, Math.min(100, Math.round(entry.progressPercent)))}%` : '0%'

  return (
    <button type="button" className="home-crunchy-card" onClick={entry.onOpen}>
      <div className="home-crunchy-card-media">
        {!imgErr && entry.image ? (
          <img src={entry.image} alt={entry.animeTitle} className="home-crunchy-card-image" onError={() => setImgErr(true)} />
        ) : (
          <div className="home-crunchy-card-image home-crunchy-card-image-fallback">
            {entry.animeTitle?.[0] ?? '?'}
          </div>
        )}
        <div className="home-crunchy-card-shade" />
        <div className="home-crunchy-card-play" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 1.5 8 5 2 8.5V1.5Z" fill="currentColor" />
          </svg>
        </div>
        <div className="home-crunchy-card-pill">{entry.badge}</div>
        {entry.progressPercent != null ? (
          <div className="home-crunchy-card-progress">
            <span style={{ width: progressWidth }} />
          </div>
        ) : null}
      </div>
      <div className="home-crunchy-card-copy">
        <div className="home-crunchy-card-series">{entry.animeTitle}</div>
        <div className="home-crunchy-card-episode">{entry.episodeTitle}</div>
        <div className="home-crunchy-card-meta">{entry.metaLine}</div>
      </div>
    </button>
  )
}

function WatchHistoryDrawer({
  open,
  onClose,
  items = [],
  isLoading = false,
  error = '',
  isEnglish = false,
  onOpenItem,
  onRemoveItem,
  onClearAll,
}) {
  if (!open) return null

  return (
    <div className="home-history-overlay" onClick={(event) => event.target === event.currentTarget && onClose?.()}>
      <aside className="home-history-drawer">
        <div className="home-history-header">
          <div>
            <div className="home-history-title">{isEnglish ? 'Watch history' : 'Historial'}</div>
            <div className="home-history-subtitle">
              {isEnglish ? 'Your latest online anime sessions.' : 'Tus sesiones recientes de anime online.'}
            </div>
          </div>
          <div className="home-history-actions">
            {items.length > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={onClearAll}>
                {isEnglish ? 'Clear all' : 'Limpiar'}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={onClose}>x</button>
          </div>
        </div>

        <div className="home-history-body">
          {isLoading ? <div className="home-history-empty">{isEnglish ? 'Loading history...' : 'Cargando historial...'}</div> : null}
          {!isLoading && error ? <div className="home-history-empty">{error}</div> : null}
          {!isLoading && !error && items.length === 0 ? (
            <div className="home-history-empty">
              {isEnglish ? 'No recent online episodes yet.' : 'Todavia no hay episodios online recientes.'}
            </div>
          ) : null}
          {!isLoading && !error && items.length > 0 ? items.map((item) => {
            const image = resolveResumeCardImage(item)
            const watchedAt = item.watched_at ? new Date(item.watched_at).toLocaleDateString() : ''
            const progressBadge = buildResumeBadge(item.progress_sec, item.duration_sec, isEnglish)
            return (
              <div key={`${item.source_id}-${item.episode_id}`} className="home-history-item">
                <button type="button" className="home-history-hit" onClick={() => onOpenItem?.(item)}>
                  <div className="home-history-thumb">
                    {image ? <img src={image} alt={item.anime_title} className="home-history-thumb-image" /> : <div className="home-history-thumb-image" />}
                  </div>
                  <div className="home-history-copy">
                    <div className="home-history-anime">{item.anime_title}</div>
                    <div className="home-history-episode">{item.episode_title || `${isEnglish ? 'Episode' : 'Episodio'} ${item.episode_num ?? '?'}`}</div>
                    <div className="home-history-meta">{[item.source_name, progressBadge, watchedAt].filter(Boolean).join(' / ')}</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="home-history-remove"
                  onClick={() => onRemoveItem?.(item.source_id, item.anime_id)}
                  title={isEnglish ? 'Remove from history' : 'Eliminar del historial'}
                >
                  x
                </button>
              </div>
            )
          }) : null}
        </div>
      </aside>
    </div>
  )
}

function TrackedListCard({ item, navigate, type = 'anime', isEnglish = false, className = '' }) {
  const progressDone = type === 'manga' ? item.chapters_read : item.episodes_watched
  const progressTotal = type === 'manga' ? item.chapters_total : item.episodes_total
  const badgeText = getListStatusLabel(item.status, isEnglish)
  return (
    <HomeRailCard
      item={item}
      title={item.title_english || item.title}
      meta={[
        progressTotal > 0 ? `${progressDone}/${progressTotal}` : '?',
        type === 'manga' ? 'caps' : 'eps',
        badgeText,
        ]}
        image={item.cover_image}
        className={className}
        onClick={() => navigate(type === 'manga' ? '/manga-online' : '/search', {
          state: type === 'manga'
            ? buildHomeMangaNavigationState(item)
            : buildAnimeNavigationState(item),
        })}
      />
  )
}

function MediaCard({ item, onClick }) {
  const total = item.episodes_total
  const done = item.watched_count
  const unitLabel = item.unit_label || 'eps'
  return (
    <HomeRailCard
      item={item}
      title={item.title}
      meta={[
        item.year ? String(item.year) : '',
        total > 0 ? `${done}/${total}` : '?',
        unitLabel,
      ].filter(Boolean)}
      image={item.cover_image}
      onClick={onClick}
    />
  )
}

function SpotlightHero({ slides, current, onSelect, onJump, lang, searching }) {
  const slide = slides[current] ?? null
  const isEnglish = lang === 'en'
  const sideCards = slides.filter((_, index) => index !== current).slice(0, 4)

  if (!slide) return null

  const title = getAniListTitle(slide, isEnglish)
  const meta = getAniListMeta(slide)
  const busy = searching.has(slide.id)
  const backdrop = slide.bannerImage || slide.coverImage?.extraLarge || slide.coverImage?.large || ''
  const poster = slide.coverImage?.extraLarge || slide.coverImage?.large || ''
  const preferredSourceLabel = isEnglish ? 'AnimeHeaven' : 'AnimeAV1'

  return (
    <section className="home-spotlight">
      <div
        className="home-spotlight-bg"
        style={backdrop ? { backgroundImage: `linear-gradient(90deg, rgba(5,8,14,0.96) 8%, rgba(5,8,14,0.76) 44%, rgba(5,8,14,0.22) 100%), url(${backdrop})` } : undefined}
      />
      <div className="home-spotlight-noise" />
      <div className="home-spotlight-content home-spotlight-content--rebuilt">
        {poster ? (
          <div className="home-spotlight-poster-column">
            <img src={poster} alt={title} className="home-spotlight-poster" />
          </div>
        ) : null}

        <div className="home-spotlight-copy">
          <div className="home-spotlight-kicker">{isEnglish ? 'Trending this week' : 'Tendencia de la semana'}</div>
          <h1 className="home-spotlight-title">{title}</h1>
          {meta.length > 0 && <div className="home-spotlight-meta">{meta.join(' · ')}</div>}
          <div className="home-spotlight-actions">
            <button className="btn btn-primary" type="button" onClick={() => onSelect(slide)} disabled={busy}>
              {busy ? (isEnglish ? 'Opening...' : 'Abriendo...') : (isEnglish ? 'Watch now' : 'Ver ahora')}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => onSelect(slide)} disabled={busy}>
              {isEnglish ? `Watch in ${preferredSourceLabel}` : `Ver en ${preferredSourceLabel}`}
            </button>
          </div>
          {slides.length > 1 ? (
            <div className="home-spotlight-pager">
              {slides.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`home-spotlight-dot${index === current ? ' active' : ''}`}
                  onClick={() => onJump(item.id)}
                  aria-label={`${isEnglish ? 'Open featured title' : 'Abrir destacado'} ${index + 1}`}
                />
              ))}
            </div>
          ) : null}
        </div>

        <aside className="home-spotlight-side">
          <div className="home-spotlight-side-title">{isEnglish ? 'Up next' : 'Sigue despues'}</div>
          <div className="home-spotlight-stack">
            {sideCards.map((item) => {
              const itemTitle = getAniListTitle(item, isEnglish)
              const itemPoster = item.coverImage?.large || item.coverImage?.extraLarge || ''
              return (
                <button key={item.id} type="button" className="home-spotlight-mini" onClick={() => onJump(item.id)}>
                  {itemPoster ? <img src={itemPoster} alt={itemTitle} className="home-spotlight-mini-image" /> : null}
                  <div className="home-spotlight-mini-copy">
                    <div className="home-spotlight-mini-title">{itemTitle}</div>
                    <div className="home-spotlight-mini-meta">{getAniListMeta(item).slice(0, 2).join(' · ')}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>
      </div>
    </section>
  )
}

function buildHomeHeroSummary(media, isEnglish = false) {
  const meta = getAniListMeta(media)
  const desc = stripHtml(media?.description || '')
  const summary = desc ? desc.slice(0, 220) : (isEnglish ? 'Open the strongest title in your feed without leaving Home.' : 'Abre el titulo mas fuerte de tu feed sin salir de Inicio.')
  return {
    meta: meta.join('  /  '),
    summary,
  }
}

function HomeFeatureTile({ title, image, meta, onClick, actionLabel = '', compact = false }) {
  const [imgErr, setImgErr] = useState(false)
  const resolvedImage = image ? proxyImage(image) : ''

  return (
    <button
      type="button"
      className={`home-feature-tile${compact ? ' compact' : ''}`}
      onClick={onClick}
      title={title}
    >
      <div className="home-feature-tile-media">
        {resolvedImage && !imgErr ? (
          <img src={resolvedImage} alt={title} className="home-feature-tile-image" onError={() => setImgErr(true)} />
        ) : (
          <div className="home-feature-tile-image home-feature-tile-fallback">{title?.[0] ?? '?'}</div>
        )}
        <div className="home-feature-tile-shade" />
      </div>
      <div className="home-feature-tile-copy">
        <div className="home-feature-tile-title">{title}</div>
        {meta ? <div className="home-feature-tile-meta">{meta}</div> : null}
        {actionLabel ? <div className="home-feature-tile-action">{actionLabel}</div> : null}
      </div>
    </button>
  )
}

export default function Home() {
  const [heroIndex, setHeroIndex] = useState(0)
  const [searchingIDs, setSearchingIDs] = useState(new Set())
  const [mangaRecommendationsReady, setMangaRecommendationsReady] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyReloadToken, setHistoryReloadToken] = useState(0)
  const { t, lang } = useI18n()
  const isEnglish = lang === 'en'
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const dashboardQuery = useQuery({
    queryKey: ['home-dashboard'],
    queryFn: async () => wails.getDashboard(),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const syncedMangaQuery = useQuery({
    queryKey: ['home-synced-manga'],
    queryFn: async () => wails.getMangaListAll(),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  })

  const dash = dashboardQuery.data ?? null
  const syncedManga = syncedMangaQuery.data ?? []
  const homeTab = 'anime'
  const loadingMangaTab = !syncedMangaQuery.data && syncedMangaQuery.isLoading

  const refreshDashboard = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['home-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['home-synced-manga'] })
    setHistoryReloadToken((value) => value + 1)
  }, [queryClient])

  useEffect(() => {
    if (!(typeof window !== 'undefined' && window?.runtime?.EventsOnMultiple)) {
      return undefined
    }
    const unsubscribe = EventsOn('history:online-updated', () => {
      refreshDashboard()
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [refreshDashboard])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshDashboard()
      }
    }
    const handleFocus = () => {
      refreshDashboard()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refreshDashboard])

  const homeHeroQuery = useQuery({
    queryKey: ['home-catalog-anime-hero', lang],
    enabled: true,
    queryFn: async () => {
      const trendingRes = await runHomeQueryWithTimeout(wails.getTrending(lang), 'home hero')
      const trending = uniqueMedia(trendingRes?.data?.Page?.media ?? [])
      const heroSlides = trending.filter((item) => item.bannerImage || item.coverImage?.extraLarge || item.coverImage?.large).slice(0, 6)
      return heroSlides.length ? heroSlides : trending.slice(0, 6)
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const homeCatalogQuery = useQuery({
    queryKey: ['home-catalog-anime-primary', lang],
    enabled: true,
    queryFn: async () => {
      const currentYear = new Date().getFullYear()
      const settled = await Promise.allSettled([
        runHomeQueryWithTimeout(wails.discoverAnime('', '', currentYear, 'POPULARITY_DESC', '', '', 1), 'home popular'),
        runHomeQueryWithTimeout(wails.discoverAnime('', '', currentYear, 'START_DATE_DESC', '', '', 1), 'home new releases'),
      ])

      const pick = (index) => (settled[index]?.status === 'fulfilled' ? settled[index].value : null)
      const popularYearRes = pick(0)
      const newReleaseRes = pick(1)

      return [
        {
          key: 'popular',
          title: isEnglish ? `Popular in ${currentYear}` : `Populares en ${currentYear}`,
          subtitle: isEnglish ? 'The shows everyone is opening right now' : 'Los shows que mas se estan abriendo ahora mismo',
          items: uniqueMedia(popularYearRes?.data?.Page?.media ?? []).slice(0, 14),
        },
        {
          key: 'new',
          title: isEnglish ? 'Not yet released' : 'Aun no estrenados',
          subtitle: isEnglish ? 'Upcoming series and premieres' : 'Series y estrenos por venir',
          items: uniqueMedia(newReleaseRes?.data?.Page?.media ?? []).slice(0, 14),
        },
      ]
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const homeMangaCatalogQuery = useQuery({
    queryKey: ['home-catalog-manga-primary', lang],
    queryFn: async () => wails.getAniListMangaCatalogHome(lang),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const genreCatalogQuery = useQuery({
    queryKey: ['home-catalog-anime-genres', lang],
    enabled: Boolean(homeCatalogQuery.data),
    queryFn: async () => {
      const genreResults = await Promise.allSettled(
        HOME_GENRE_ROWS.map((row) => runHomeQueryWithTimeout(wails.discoverAnime(row.genre, '', 0, 'POPULARITY_DESC', '', '', 1), `genre ${row.key}`)),
      )

      return HOME_GENRE_ROWS.map((row, index) => ({
        key: row.key,
        title: isEnglish ? row.labelEn : row.labelEs,
        subtitle: getGenreSubtitle(row.key, isEnglish),
        items: uniqueMedia(genreResults[index]?.status === 'fulfilled' ? genreResults[index].value?.data?.Page?.media ?? [] : []).slice(0, 16),
      })).filter((row) => row.items.length > 0)
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const heroSlides = homeHeroQuery.data ?? []
  const primaryAnimeRows = (homeCatalogQuery.data ?? []).filter((row) => (row?.items?.length ?? 0) > 0)
  const genreAnimeRows = genreCatalogQuery.data ?? []
  const homeAniListUnavailable = isAniListUnavailableErrorMessage(homeHeroQuery.error)
    || isAniListUnavailableErrorMessage(homeCatalogQuery.error)
    || isAniListUnavailableErrorMessage(genreCatalogQuery.error)

  const historyQuery = useQuery({
    queryKey: ['home-watch-history', historyReloadToken],
    enabled: historyOpen,
    queryFn: async () => wails.getWatchHistory(60),
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (heroSlides.length < 2) return

    const timer = window.setInterval(() => {
      setHeroIndex((value) => (value + 1) % heroSlides.length)
    }, 5500)

    return () => window.clearInterval(timer)
  }, [heroSlides.length])

  const handleOpenAniListMedia = useCallback((media) => {
    if (!media || searchingIDs.has(media.id)) return
    const fallbackSourceID = isEnglish ? 'animegg-en' : 'animeav1-es'
    navigate('/search', { state: buildAnimeNavigationState(media, fallbackSourceID) })
  }, [isEnglish, navigate, searchingIDs])

  const handleOpenOnlineAnime = useCallback(async (item) => {
    const base = {
      id: item.anime_id ?? item.id,
      title: item.anime_title ?? item.title,
      title_english: item.title_english,
      anime_title: item.anime_title,
      cover_url: item.cover_url ?? item.cover_image,
      source_id: item.source_id,
      source_name: item.source_name,
      prefetchedEpisodes: item.prefetchedEpisodes,
    }

    try {
      const enriched = await enrichJKAnimeHit(base, wails, isEnglish ? 'en' : 'es')
      navigate('/search', { state: { selectedAnime: enriched } })
    } catch {
      navigate('/search', { state: { autoOpen: base } })
    }
  }, [isEnglish, navigate])

  const handleRemoveAnime = useCallback(async (sourceID, animeID) => {
    try {
      await wails.removeAnimeFromHistory(sourceID, animeID)
      refreshDashboard()
    } catch (error) {
      toastError(`${isEnglish ? 'Error removing from history' : 'Error al eliminar'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refreshDashboard])

  const handleClearHistory = useCallback(async () => {
    try {
      await wails.clearWatchHistory()
      setHistoryReloadToken((value) => value + 1)
      toastSuccess(isEnglish ? 'History cleared.' : 'Historial limpiado.')
    } catch (error) {
      toastError(`${isEnglish ? 'Error clearing history' : 'Error al limpiar el historial'}: ${error?.message ?? error}`)
    }
  }, [isEnglish])

  const handleOpenHomeManga = useCallback((item) => {
    const state = buildHomeMangaNavigationState(item)
    navigate('/manga-online', { state: Object.keys(state).length > 0 ? state : undefined })
  }, [navigate])

  const handlePlayLocalEpisode = useCallback(async (item) => {
    try {
      await wails.playEpisode(item.episode_id)
      toastSuccess(isEnglish ? 'Opening in MPV...' : 'Abriendo en MPV...')
    } catch (error) {
      const msg = error?.message ?? String(error)
      if (msg.includes('MPV') || msg.includes('player')) {
        toastError(isEnglish ? 'MPV not found. Check the path in Settings.' : 'MPV no encontrado. Verifica la ruta en Ajustes.')
      } else {
        toastError(isEnglish ? `Could not play it: ${msg}` : `No se pudo reproducir: ${msg}`)
      }
    }
  }, [isEnglish])

  const continueOnline = (dash?.continue_watching_online ?? []).filter((entry) => !isMangaHistorySource(entry.source_id))
  const continueLocal = dash?.continue_watching ?? []
  const watchingList = dash?.watching_list ?? []
  const continueMangaSeries = dash?.continue_reading_online_manga ?? []
  const planningList = dash?.planning_list ?? []
  const onHoldList = dash?.on_hold_list ?? []
  const continueAnimeSeen = new Set([
    ...continueOnline.map((item) => `remote:${Number(item?.anilist_id || item?.mal_id || 0)}:${String(item?.anime_id || '')}`),
    ...continueLocal.map((item) => `local:${Number(item?.anilist_id || item?.mal_id || 0)}:${String(item?.anime_id || '')}`),
  ])
  const continueTrackedAnime = sortTrackedEntries(watchingList)
    .filter((item) => {
      const key = `remote:${Number(item?.anilist_id || item?.mal_id || 0)}:${String(item?.id || item?.anime_id || '')}`
      if (continueAnimeSeen.has(key)) return false
      continueAnimeSeen.add(key)
      return true
    })
    .slice(0, 14)
  const plannedAnime = sortTrackedEntries(planningList).slice(0, 14)
  const onHoldAnime = sortTrackedEntries(onHoldList).slice(0, 14)
  const mangaListHighlights = sortTrackedEntries(syncedManga)
  const resumeAnimeEntries = [
    ...continueOnline.map((item) => {
      const durationSec = Number(item.duration_sec || 0)
      const progressSec = Number(item.progress_sec || 0)
      const progressPercent = durationSec > 0 ? (progressSec / durationSec) * 100 : null
      const fallbackEpisodeTitle = `${isEnglish ? 'Episode' : 'Episodio'} ${item.episode_num ?? '?'}`
      return {
        key: `online-${item.source_id}-${item.episode_id}`,
        animeTitle: item.anime_title || 'Anime',
        episodeNum: item.episode_num ?? '?',
        episodeTitle: item.episode_title || fallbackEpisodeTitle,
        image: resolveResumeCardImage(item),
        badge: buildResumeBadge(progressSec, durationSec, isEnglish),
        metaLine: [item.source_name, `${isEnglish ? 'Episode' : 'Episodio'} ${item.episode_num ?? '?'}`].filter(Boolean).join(' / '),
        progressPercent,
        onOpen: () => handleOpenOnlineAnime(item),
      }
    }),
    ...continueLocal.map((item) => {
      const durationSec = Number(item.duration_sec || 0)
      const progressSec = Number(item.progress_sec || 0)
      const progressPercent = item.percent != null && item.percent > 0 ? item.percent : (durationSec > 0 ? (progressSec / durationSec) * 100 : null)
      const fallbackEpisodeTitle = `${isEnglish ? 'Episode' : 'Episodio'} ${item.episode_num ?? '?'}`
      return {
        key: `local-${item.episode_id}`,
        animeTitle: item.anime_title || 'Anime',
        episodeNum: item.episode_num ?? '?',
        episodeTitle: item.episode_title || fallbackEpisodeTitle,
        image: resolveResumeCardImage(item),
        badge: buildResumeBadge(progressSec, durationSec, isEnglish),
        metaLine: [(isEnglish ? 'Local library' : 'Biblioteca local'), `${isEnglish ? 'Episode' : 'Episodio'} ${item.episode_num ?? '?'}`].join(' / '),
        progressPercent,
        onOpen: () => handlePlayLocalEpisode(item),
      }
    }),
  ]

  const continueMangaSeen = new Set()
  const continueMangaHistory = []
  for (const item of continueMangaSeries) {
    const key = normalizeHomeMangaKey(item)
    if (!key || continueMangaSeen.has(key)) continue
    const chapterNum = Number(item?.episode_num || 0)
    if (!item?.episode_id && chapterNum <= 0) continue
    continueMangaSeen.add(key)
    continueMangaHistory.push(item)
  }

  const continueMangaTracked = []
  const planningManga = []
  const onHoldManga = []
  const droppedManga = []
  const planningSeen = new Set()
  const onHoldSeen = new Set()
  const droppedSeen = new Set()
  for (const item of mangaListHighlights) {
    const key = normalizeHomeMangaKey(item)
    const status = String(item?.status || '').trim().toUpperCase()
    const chaptersRead = Number(item?.chapters_read || 0)

    if (chaptersRead > 0 && !['PLANNING', 'ON_HOLD', 'DROPPED', 'COMPLETED'].includes(status) && key && !continueMangaSeen.has(key)) {
      continueMangaSeen.add(key)
      continueMangaTracked.push(item)
    }

    if (status === 'PLANNING' && key && !planningSeen.has(key)) {
      planningSeen.add(key)
      planningManga.push(item)
    } else if (status === 'ON_HOLD' && key && !onHoldSeen.has(key)) {
      onHoldSeen.add(key)
      onHoldManga.push(item)
    } else if (status === 'DROPPED' && key && !droppedSeen.has(key)) {
      droppedSeen.add(key)
      droppedManga.push(item)
    }
  }

  const continueReadingManga = [...continueMangaHistory, ...continueMangaTracked]
  const recommendationSeedIDs = Array.from(new Set(
    continueReadingManga
      .map((item) => Number(item?.anilist_id || item?.AniListID || 0))
      .filter((value) => value > 0),
  ))
  const recommendationExcludeIDs = Array.from(new Set(
    [...continueReadingManga, ...planningManga, ...onHoldManga, ...droppedManga]
      .map((item) => Number(item?.anilist_id || item?.AniListID || 0))
      .filter((value) => value > 0),
  ))
  const recommendationSeedKey = recommendationSeedIDs.join(',')
  const recommendationExcludeKey = recommendationExcludeIDs.join(',')

  useEffect(() => {
    if (recommendationSeedIDs.length === 0) {
      setMangaRecommendationsReady(false)
      return
    }
    setMangaRecommendationsReady(false)
    const timer = window.setTimeout(() => {
      setMangaRecommendationsReady(true)
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [recommendationExcludeKey, recommendationSeedKey, recommendationSeedIDs.length])

  const homeMangaRecommendationsQuery = useQuery({
    queryKey: ['home-manga-recommendations', lang, recommendationSeedKey, recommendationExcludeKey],
    enabled: mangaRecommendationsReady && recommendationSeedIDs.length > 0,
    queryFn: async () => wails.getHomeMangaRecommendations(recommendationSeedIDs, recommendationExcludeIDs, lang),
    staleTime: 20 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const showHomeSkeleton = useStableLoadingGate(
    !dash && (
      dashboardQuery.isLoading
      || syncedMangaQuery.isLoading
      || (homeCatalogQuery.isLoading && !homeCatalogQuery.data)
      || (homeHeroQuery.isLoading && !homeHeroQuery.data)
    ),
    { delayMs: 0, minVisibleMs: 360 },
  )

  if (showHomeSkeleton) {
    return <HomeSkeleton />
  }

  const continueReadingCards = [
    ...continueMangaHistory.map((item) => buildContinueHistoryMangaCard(item, isEnglish, handleOpenHomeManga)),
    ...continueMangaTracked.map((item) => buildTrackedMangaCard(item, isEnglish, handleOpenHomeManga)),
  ]
  const planningCards = planningManga.map((item) => buildTrackedMangaCard(item, isEnglish, handleOpenHomeManga))
  const onHoldCards = onHoldManga.map((item) => buildTrackedMangaCard(item, isEnglish, handleOpenHomeManga))
  const droppedCards = droppedManga.map((item) => buildTrackedMangaCard(item, isEnglish, handleOpenHomeManga))
  const recommendationCards = (homeMangaRecommendationsQuery.data ?? []).map((item) => buildRecommendedMangaCard(item, isEnglish, handleOpenHomeManga))
  const seenRecentAnime = new Set()
  const recentAnimeUpdates = [
    ...(primaryAnimeRows.find((row) => row.key === 'new')?.items ?? []),
    ...(primaryAnimeRows.find((row) => row.key === 'popular')?.items ?? []),
  ]
    .filter((item) => {
      if (!item) return false
      const key = Number(item.id || 0)
      if (key && seenRecentAnime.has(key)) return false
      if (key) seenRecentAnime.add(key)
      return item?.status === 'RELEASING' || Boolean(item?.nextAiringEpisode?.episode)
    })
    .slice(0, 6)
    .map((item) => ({
      key: `anime-update-${item.id}`,
      title: getAniListTitle(item, isEnglish),
      meta: item?.nextAiringEpisode?.episode
        ? (isEnglish ? `Episode ${item.nextAiringEpisode.episode} next` : `Siguiente ep ${item.nextAiringEpisode.episode}`)
        : (isEnglish ? 'Currently releasing' : 'En emision'),
      badge: isEnglish ? 'Airing' : 'Emision',
      onOpen: () => handleOpenAniListMedia(item),
    }))

  const recentMangaUpdates = [
    ...((homeMangaCatalogQuery.data?.recent ?? []).slice(0, 4)),
    ...((homeMangaCatalogQuery.data?.featured ?? []).slice(0, 2)),
  ]
    .filter(Boolean)
    .slice(0, 6)
    .map((item) => ({
      key: `manga-update-${item.anilist_id || item.AniListID || item.id}`,
      title: item.canonical_title || item.title_english || item.title_romaji || item.title_native || item.title || 'Manga',
      meta: Number(item.chapters_total || item.chapters || 0) > 0
        ? `${Number(item.chapters_total || item.chapters || 0)} ${isEnglish ? 'chapters' : 'caps'}`
        : (item.format || item.resolved_format || (isEnglish ? 'Manga' : 'Manga')),
      badge: item.status || (isEnglish ? 'Updated' : 'Actualizado'),
      onOpen: () => handleOpenHomeManga(item),
    }))

  const hasUserAnimeContent = resumeAnimeEntries.length > 0 || continueTrackedAnime.length > 0 || plannedAnime.length > 0 || onHoldAnime.length > 0
  const homeResumePreview = resumeAnimeEntries.slice(0, 4).map((entry) => ({
    anime_title: entry.animeTitle,
    episode_num: entry.episodeNum,
    percent: entry.progressPercent ?? 0,
    image: entry.image,
    onOpen: entry.onOpen,
    key: entry.key,
  }))
  const homeQuickStats = [
    {
      label: isEnglish ? 'Anime tracked' : 'Anime en seguimiento',
      value: resumeAnimeEntries.length + plannedAnime.length + onHoldAnime.length,
      note: isEnglish ? 'Across home and lists' : 'Entre inicio y listas',
    },
    {
      label: isEnglish ? 'Manga shelves' : 'Estantes manga',
      value: continueReadingCards.length + planningCards.length + onHoldCards.length + recommendationCards.length,
      note: isEnglish ? 'Reading, planning, and recs' : 'Lectura, planeado y recs',
    },
    {
      label: isEnglish ? 'Featured rows' : 'Filas destacadas',
      value: primaryAnimeRows.length + genreAnimeRows.length,
      note: isEnglish ? 'Live discovery sections' : 'Secciones en vivo',
    },
  ]
  const featuredAnimeRows = primaryAnimeRows.slice(0, 2)
  const discoveryAnimeRows = genreAnimeRows.slice(0, 1)
  const featuredHero = heroSlides[heroIndex % Math.max(heroSlides.length, 1)]
    ?? featuredAnimeRows[0]?.items?.[0]
    ?? discoveryAnimeRows[0]?.items?.[0]
    ?? null
  const heroSummary = featuredHero ? buildHomeHeroSummary(featuredHero, isEnglish) : { meta: '', summary: '' }
  const heroTitle = featuredHero ? getAniListTitle(featuredHero, isEnglish).toUpperCase() : ''
  const continueWatchingTiles = resumeAnimeEntries.length > 0
    ? resumeAnimeEntries.slice(0, 4).map((entry) => ({
        key: entry.key,
        title: entry.animeTitle,
        image: entry.image,
        meta: entry.metaLine,
        onClick: entry.onOpen,
        actionLabel: entry.badge,
      }))
    : heroSlides.slice(0, 4).map((media) => ({
        key: `hero-${media.id}`,
        title: getAniListTitle(media, isEnglish),
        image: media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || '',
        meta: getAniListMeta(media).join(' / '),
        onClick: () => handleOpenAniListMedia(media),
        actionLabel: isEnglish ? 'Open now' : 'Abrir ahora',
      }))
  const recentAnimeRail = uniqueMedia([
    ...(featuredAnimeRows.find((row) => row.key === 'new')?.items ?? []),
    ...(featuredAnimeRows.find((row) => row.key === 'popular')?.items ?? []),
    ...(discoveryAnimeRows.flatMap((row) => row.items ?? [])),
  ])
    .filter((item) => item && item.id !== featuredHero?.id)
    .slice(0, 5)
  const mangaPreviewTiles = recentMangaUpdates.slice(0, 4)

  const userAnimeSlot = hasUserAnimeContent ? (
    <div className="home-user-band home-user-band-anime">
      <div className="home-user-band-label">
        {isEnglish ? 'Anime progress' : 'Tu anime'}
      </div>

      {resumeAnimeEntries.length > 0 && (
        <ShelfSection
          title={isEnglish ? 'Continue watching' : 'Seguir viendo'}
          subtitle={isEnglish ? 'Pick up what you already started' : 'Retoma lo que ya empezaste'}
          action={(
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '6px 12px', color: 'var(--text-muted)' }}
              onClick={() => setHistoryOpen(true)}
              type="button"
            >
              {isEnglish ? 'View History' : 'Ver historial'}
            </button>
          )}
          customTrack
        >
          <ShelfScroller showArrows className="home-shelf-track-arrows home-shelf-track-premium">
            {homeResumePreview.map((entry) => (
              <ContinueCard key={entry.key} item={entry} onClick={entry.onOpen} />
            ))}
          </ShelfScroller>
        </ShelfSection>
      )}

      {false && (continueOnline.length > 0 || continueLocal.length > 0 || continueTrackedAnime.length > 0) && (
        <ShelfSection
          title={isEnglish ? 'Watching list' : 'En seguimiento'}
          subtitle={isEnglish ? 'Tracked titles without an active resume point' : 'Titulos seguidos sin un punto de reanudacion activo'}
          customTrack
        >
          <ShelfScroller showArrows className="home-shelf-track-arrows">
          {continueOnline.map((item) => (
            <div key={`${item.source_id}-${item.episode_id}`} style={{ position: 'relative', flexShrink: 0 }}>
              {editMode && (
                <button
                  onClick={() => handleRemoveAnime(item.source_id, item.anime_id)}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 10,
                    background: '#b91c1c',
                    border: 'none',
                    borderRadius: '50%',
                    width: 24,
                    height: 24,
                    color: 'white',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                  title={isEnglish ? 'Remove' : 'Eliminar'}
                  type="button"
                >
                  ×
                </button>
              )}
              <OnlineHistoryCard item={item} navigate={navigate} onOpenAnime={handleOpenOnlineAnime} />
            </div>
          ))}
          {continueLocal.map((item) => (
            <ContinueCard
              key={`local-${item.episode_id}`}
              item={item}
              onClick={async () => {
                try {
                  await wails.playEpisode(item.episode_id)
                  toastSuccess(isEnglish ? 'Opening in MPV...' : 'Abriendo en MPV...')
                } catch (error) {
                  const msg = error?.message ?? String(error)
                  if (msg.includes('MPV') || msg.includes('player')) {
                    toastError(isEnglish ? 'MPV not found. Check the path in Settings.' : 'MPV no encontrado. Verifica la ruta en Ajustes.')
                  } else {
                    toastError(isEnglish ? `Could not play it: ${msg}` : `No se pudo reproducir: ${msg}`)
                  }
                }
              }}
            />
          ))}
          {continueTrackedAnime.map((item) => (
            <TrackedListCard
              key={`watching-anime-${item.anilist_id || item.mal_id || item.id}`}
              item={item}
              navigate={navigate}
              type="anime"
              isEnglish={isEnglish}
              className="home-anime-status-card"
            />
          ))}
          </ShelfScroller>
        </ShelfSection>
      )}

      {plannedAnime.length > 0 && (
        <ShelfSection
          title={isEnglish ? 'Planned' : 'Planeado'}
          subtitle={isEnglish ? 'Titles saved for later' : 'Titulos guardados para despues'}
          customTrack
        >
          <ShelfScroller showArrows className="home-shelf-track-arrows">
            {plannedAnime.map((item) => (
              <TrackedListCard
                key={`planned-anime-${item.anilist_id || item.mal_id || item.id}`}
                item={item}
                navigate={navigate}
                type="anime"
                isEnglish={isEnglish}
                className="home-anime-status-card"
              />
            ))}
          </ShelfScroller>
        </ShelfSection>
      )}

      {onHoldAnime.length > 0 && (
        <ShelfSection
          title={isEnglish ? 'On Hold' : 'En pausa'}
          subtitle={isEnglish ? 'Series waiting for you to come back' : 'Series esperando a que vuelvas'}
          customTrack
        >
          <ShelfScroller showArrows className="home-shelf-track-arrows">
            {onHoldAnime.map((item) => (
              <TrackedListCard
                key={`onhold-anime-${item.anilist_id || item.mal_id || item.id}`}
                item={item}
                navigate={navigate}
                type="anime"
                isEnglish={isEnglish}
                className="home-anime-status-card"
              />
            ))}
          </ShelfScroller>
        </ShelfSection>
      )}
    </div>
  ) : null

  return (
    <div className="fade-in home-catalog-page">
      <div className="home-catalog-body home-dashboard-layout">
        <div className="home-dashboard-main">

        {/* ── Anime / Manga top tab switcher ── */}


        {/* ── Anime tab ── */}
          <>
            {heroSlides.length > 0 ? (
              <SpotlightHero
                slides={heroSlides}
                current={heroIndex % heroSlides.length}
                onSelect={handleOpenAniListMedia}
                onJump={(id) => {
                  const nextIndex = heroSlides.findIndex((item) => item.id === id)
                  if (nextIndex >= 0) setHeroIndex(nextIndex)
                }}
                lang={lang}
                searching={searchingIDs}
              />
            ) : (homeHeroQuery.isLoading || homeHeroQuery.isFetching) ? (
              <HomeDiscoverFallback isEnglish={isEnglish} />
            ) : null}

            {userAnimeSlot}

            {featuredAnimeRows.map((row) => (
              <ShelfSection key={row.key} title={row.title} subtitle={row.subtitle} customTrack>
                <ShelfScroller showArrows className="home-shelf-track-arrows">
                  {row.items.map((item) => (
                    <HomeRailCard
                      key={`${row.key}-${item.id}`}
                      item={item}
                      title={getAniListTitle(item, isEnglish)}
                      meta={getAniListMeta(item)}
                      image={item.coverImage?.large || item.coverImage?.extraLarge || ''}
                      badge={item.status ? String(item.status).replaceAll('_', ' ') : ''}
                      onClick={() => handleOpenAniListMedia(item)}
                    />
                  ))}
                </ShelfScroller>
              </ShelfSection>
            ))}

            {discoveryAnimeRows.map((row) => (
              <ShelfSection key={row.key} title={row.title} subtitle={row.subtitle} customTrack>
                <ShelfScroller showArrows className="home-shelf-track-arrows">
                  {row.items.map((item) => (
                    <HomeRailCard
                      key={`${row.key}-${item.id}`}
                      item={item}
                      title={getAniListTitle(item, isEnglish)}
                      meta={getAniListMeta(item)}
                      image={item.coverImage?.large || item.coverImage?.extraLarge || ''}
                      badge={item.status ? String(item.status).replaceAll('_', ' ') : ''}
                      onClick={() => handleOpenAniListMedia(item)}
                    />
                  ))}
                </ShelfScroller>
              </ShelfSection>
            ))}

            {continueReadingCards.length > 0 ? (
              <ShelfSection
                title={isEnglish ? 'Manga picks for tonight' : 'Manga para esta noche'}
                subtitle={isEnglish ? 'Continue reading without leaving the home workspace' : 'Sigue leyendo sin salir del inicio'}
                customTrack
              >
                <ShelfScroller showArrows className="home-shelf-track-premium">
                  {continueReadingCards.map((item) => (
                    <HomeRailCard
                      key={item.key}
                      item={item}
                      title={item.title}
                      meta={item.meta}
                      image={item.image}
                      badge={item.badge}
                      onClick={item.onClick}
                      className={item.className || ''}
                    />
                  ))}
                </ShelfScroller>
              </ShelfSection>
            ) : null}

            {recommendationCards.length > 0 ? (
              <ShelfSection
                title={isEnglish ? 'Recommended manga' : 'Manga recomendado'}
                subtitle={isEnglish ? 'A cleaner second rail, just like the reference layout' : 'Un segundo carril mas limpio, igual que en la referencia'}
                customTrack
              >
                <ShelfScroller showArrows className="home-shelf-track-premium">
                  {recommendationCards.map((item) => (
                    <HomeRailCard
                      key={item.key}
                      item={item}
                      title={item.title}
                      meta={item.meta}
                      image={item.image}
                      badge={item.badge}
                      onClick={item.onClick}
                      className={item.className || ''}
                    />
                  ))}
                </ShelfScroller>
              </ShelfSection>
            ) : null}

            {!heroSlides.length && !featuredAnimeRows.length && !discoveryAnimeRows.length && homeAniListUnavailable ? (
              <section className="home-shelf">
                <div className="home-shelf-header">
                  <div className="home-shelf-copy">
                    <div className="home-shelf-title">{isEnglish ? 'AniList catalog temporarily unavailable' : 'Catalogo de AniList temporalmente no disponible'}</div>
                    <div className="home-shelf-subtitle">{isEnglish ? 'Home recommendations are limited right now, but direct source search still works.' : 'Las recomendaciones del inicio estan limitadas por ahora, pero la busqueda directa en fuentes sigue funcionando.'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-ghost" onClick={() => navigate('/search')}>
                      {isEnglish ? 'Open Anime Online' : 'Abrir Anime online'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => navigate('/manga-online')}>
                      {isEnglish ? 'Open Manga Online' : 'Abrir Manga online'}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {!heroSlides.length && !featuredAnimeRows.length && !discoveryAnimeRows.length && !homeAniListUnavailable && !homeCatalogQuery.isLoading && !homeCatalogQuery.isFetching ? (
              <HomeDiscoverFallback isEnglish={isEnglish} />
            ) : null}
          </>

        {/* ── Manga tab ── */}
        {homeTab === 'manga' && (() => {
          const renderShelf = (title, subtitle, items, scrollerClass = '') => {
            if (!items || items.length === 0) return null
            return (
              <ShelfSection title={`${title} [${items.length}]`} subtitle={subtitle} customTrack>
                <ShelfScroller showArrows className={scrollerClass || 'home-shelf-track-arrows'}>
                  {items.map((item) => (
                    <HomeRailCard
                      key={item.key}
                      item={item}
                      title={item.title}
                      meta={item.meta}
                      image={item.image}
                      badge={item.badge}
                      onClick={item.onClick}
                      className={item.className || ''}
                    />
                  ))}
                </ShelfScroller>
              </ShelfSection>
            )
          }

          const hasAnyMangaRows = continueReadingCards.length > 0 ||
            planningCards.length > 0 ||
            onHoldCards.length > 0 ||
            droppedCards.length > 0 ||
            recommendationCards.length > 0

          return (
            <div className="home-manga-tab-content">
              {renderShelf(
                isEnglish ? 'Continue reading' : 'Continuar leyendo',
                isEnglish ? 'Resume the chapters you already started' : 'Retoma los capitulos que ya empezaste',
                continueReadingCards,
              )}
              {renderShelf(
                isEnglish ? 'Planned' : 'Planeado',
                isEnglish ? 'Titles saved for later' : 'Titulos guardados para despues',
                planningCards,
              )}
              {renderShelf(
                isEnglish ? 'On hold' : 'En pausa',
                isEnglish ? 'Stories waiting for you to return' : 'Historias esperando a que vuelvas',
                onHoldCards,
              )}
              {renderShelf(
                isEnglish ? 'Dropped' : 'Abandonado',
                isEnglish ? 'Series you set aside for now' : 'Series que dejaste apartadas por ahora',
                droppedCards,
              )}
              {renderShelf(
                isEnglish ? 'Recommendations' : 'Recomendaciones',
                isEnglish ? 'Similar tags to what you are reading right now' : 'Basado en etiquetas parecidas a lo que ya estas leyendo',
                recommendationCards,
                'home-shelf-track-premium',
              )}
              {loadingMangaTab ? (
                <div className="home-manga-empty">
                  <span style={{ fontSize: 30 }}>···</span>
                  <span>{isEnglish ? 'Loading your manga shelves...' : 'Cargando tus estantes de manga...'}</span>
                </div>
              ) : null}
              {!hasAnyMangaRows && !loadingMangaTab ? (
                <div className="home-manga-empty">
                    <span style={{ fontSize: 34 }}>◫</span>
                    <span>
                      {isEnglish
                        ? 'No manga yet. Sync AniList or start reading online to see it here.'
                        : 'Todavia no hay manga. Sincroniza AniList o empieza a leer online para verlo aqui.'}
                    </span>
                  </div>
              ) : null}
            </div>
          )
        })()}

        </div>

        <aside className="home-dashboard-side">
          <section className="nipah-side-panel">
            <div className="nipah-side-panel-head">
              <div>
                <div className="nipah-side-panel-title">{isEnglish ? 'Recently updated anime' : 'Anime actualizado'}</div>
                <div className="nipah-side-panel-copy">
                  {isEnglish ? 'Only titles that are actively airing right now.' : 'Solo series que estan en emision ahora mismo.'}
                </div>
              </div>
            </div>
            <div className="home-side-list home-side-list-updates">
              {recentAnimeUpdates.length > 0 ? recentAnimeUpdates.map((entry) => (
                <button key={entry.key} type="button" className="home-side-list-item" onClick={entry.onOpen}>
                  <div className="home-side-list-copy">
                    <span className="home-side-list-title">{entry.title}</span>
                    <span className="home-side-list-meta">{entry.meta}</span>
                  </div>
                  <span className="home-side-list-badge">{entry.badge}</span>
                </button>
              )) : (
                <div className="home-side-empty-copy">
                  {isEnglish ? 'No airing titles are available right now.' : 'No hay series en emision disponibles ahora mismo.'}
                </div>
              )}
            </div>
          </section>

          <section className="nipah-side-panel">
            <div className="nipah-side-panel-head">
              <div>
                <div className="nipah-side-panel-title">{isEnglish ? 'Recently updated manga' : 'Manga actualizado'}</div>
                <div className="nipah-side-panel-copy">
                  {isEnglish ? 'Recent catalog motion, ready to open without leaving Home.' : 'Lo mas reciente del catalogo, listo para abrir sin salir de Inicio.'}
                </div>
              </div>
            </div>
            <div className="home-side-list home-side-list-updates">
              {recentMangaUpdates.length > 0 ? recentMangaUpdates.map((entry) => (
                <button key={entry.key} type="button" className="home-side-list-item" onClick={entry.onOpen}>
                  <div className="home-side-list-copy">
                    <span className="home-side-list-title">{entry.title}</span>
                    <span className="home-side-list-meta">{entry.meta}</span>
                  </div>
                  <span className="home-side-list-badge">{entry.badge}</span>
                </button>
              )) : (
                <div className="home-side-empty-copy">
                  {isEnglish ? 'Sync AniList or open Manga Online to start filling this rail.' : 'Sincroniza AniList o abre Manga online para empezar a llenar este panel.'}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      <WatchHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        items={historyQuery.data ?? []}
        isLoading={historyQuery.isLoading}
        error={historyQuery.error?.message ?? ''}
        isEnglish={isEnglish}
        onOpenItem={(item) => {
          setHistoryOpen(false)
          handleOpenOnlineAnime(item)
        }}
        onRemoveItem={handleRemoveAnime}
        onClearAll={handleClearHistory}
      />
    </div>
  )
}
