import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { wails, proxyImage } from '../lib/wails'
import OnlineAnimeDetail from '../components/ui/OnlineAnimeDetail'
import { toastError } from '../components/ui/Toast'
import {
  enrichJKAnimeHit,
  isStrictEnglishAnimeSource,
  rankOnlineSourceHits,
  resolveAniListToJKAnime,
} from '../lib/onlineAnimeResolver'
import { extractAniListAnimeSearchMedia } from '../lib/anilistSearch'
import { normalizeAnimeSourceID } from '../lib/animeSources'
import { buildPendingAniListSelectedAnime, getInitialSelectedAnimePayload, normalizeSelectedAnimePayload } from '../lib/mediaNavigation'
import {
  buildPreferredSourceSettingsPatch,
  cachePreferredSourcePreference,
  resolveSavedOnlineSourcePreference,
} from '../lib/onlineSourcePreferences'
import { buildExpandedTitleVariants } from '../lib/titleMatching'
import { isAniListUnavailableErrorMessage } from '../lib/anilistStatus'
import { buildAnimeCatalogFetchArgs } from '../lib/catalogFilters'
import { useStableLoadingGate } from '../lib/useStableLoadingGate'
import VirtualMediaGrid from '../components/ui/VirtualMediaGrid'
import { useI18n } from '../lib/i18n'
import { perfEnd, perfMark, perfStart } from '../lib/perfTrace'
import Gui2OnlineCatalogSurface, { CatalogIcon, Gui2CatalogPaginationControls, PageArrowButton } from '../gui-v2/routes/catalog/Gui2OnlineCatalogSurface'

// Spanish sources: purple family  |  English sources: blue family
const SOURCE_META = {
  'jkanime-es':     { label: 'JKAnime',     color: '#c084fc' }, // purple-400
  'animeflv-es':    { label: 'AnimeFLV',    color: '#b7791f' }, // amber-700
  'animeav1-es':    { label: 'AnimeAV1',    color: '#9333ea' }, // purple-600
  'animepahe-en':   { label: 'AnimePahe',   color: '#38bdf8' }, // sky-400
  'animeheaven-en': { label: 'AnimeHeaven', color: '#0ea5e9' }, // sky-500
  'animegg-en':     { label: 'AnimeGG',     color: '#6366f1' }, // indigo-500
  'animekai-en':    { label: 'AnimeKai',    color: '#22c55e' }, // hidden for now
}

function getSortOptions(lang) {
  return [
    { value: 'TRENDING_DESC', label: lang === 'en' ? 'Trending' : 'Tendencia' },
    { value: 'POPULARITY_DESC', label: lang === 'en' ? 'Popularity' : 'Popularidad' },
    { value: 'SCORE_DESC', label: lang === 'en' ? 'Score' : 'Puntuación' },
    { value: 'START_DATE_DESC', label: lang === 'en' ? 'Newest' : 'Más recientes' },
  ]
}

function getSeasonOptions(lang) {
  return [
    { value: '', label: lang === 'en' ? 'Season' : 'Temporada' },
    { value: 'WINTER', label: lang === 'en' ? 'Winter' : 'Invierno' },
    { value: 'SPRING', label: lang === 'en' ? 'Spring' : 'Primavera' },
    { value: 'SUMMER', label: lang === 'en' ? 'Summer' : 'Verano' },
    { value: 'FALL', label: lang === 'en' ? 'Fall' : 'Otoño' },
  ]
}

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

const GENRES = Object.keys(GENRE_LABELS)
const CATALOG_PAGE_SIZE = 48
const ANIME_FORMAT_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'TV', label: 'TV' },
  { value: 'MOVIE', label: 'Movie' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'SPECIAL', label: 'Special' },
]
const ANIME_STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'RELEASING', label: 'Airing' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'NOT_YET_RELEASED', label: 'Upcoming' },
  { value: 'HIATUS', label: 'Hiatus' },
]

function buildYearOptions(lang) {
  const currentYear = new Date().getFullYear()
  const years = [{ value: 0, label: 'Año' }]
  for (let year = currentYear + 1; year >= currentYear - 30; year -= 1) {
    years.push({ value: year, label: String(year) })
  }
  return years
}

const YEAR_OPTIONS = buildYearOptions()
const ANIME_SOURCE_OPTIONS = [
  { value: 'animeav1-es', label: 'AnimeAV1' },
  { value: 'jkanime-es', label: 'JKAnime' },
  { value: 'animeflv-es', label: 'AnimeFLV' },
  { value: 'animepahe-en', label: 'AnimePahe' },
  { value: 'animeheaven-en', label: 'AnimeHeaven' },
  { value: 'animegg-en', label: 'AnimeGG' },
]

function SourceBadge({ sourceID = 'jkanime-es' }) {
  const meta = SOURCE_META[sourceID] ?? { label: sourceID, color: '#9090a8' }
  return (
    <span
      className="gui2-catalog-source-badge"
      style={{
        background: `${meta.color}22`,
        color: meta.color,
        borderColor: `${meta.color}55`,
      }}
    >
      {meta.label}
    </span>
  )
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="online-section-header">
      <div className="online-section-heading">
        <h2 className="online-section-title">{title}</h2>
        {subtitle ? <p className="online-section-copy">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

function OnlinePosterSkeletonGrid({ count = 10 }) {
  return (
    <div className="skeleton-poster-grid">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton-poster-card">
          <div className="skeleton-block skeleton-poster-image" />
          <div className="skeleton-block skeleton-line skeleton-line-md" />
          <div className="skeleton-block skeleton-line skeleton-line-xs" />
        </div>
      ))}
    </div>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CustomSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find(option => option.value === value)
  const label = selected?.label ?? placeholder ?? ''

  return (
    <div className={`custom-select gui2-catalog-select${open ? ' open' : ''}`} ref={ref}>
      <button className="custom-select-trigger" onClick={() => setOpen(prev => !prev)} type="button">
        <span>{label}</span>
        <span className="custom-select-arrow"><ChevronDownIcon /></span>
      </button>
      {open && (
        <div className="custom-select-dropdown">
          {options.map(option => (
            <div
              key={`${option.value}-${option.label}`}
              className={`custom-select-option${option.value === value ? ' selected' : ''}`}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GenreMultiSelect({ value, onToggle, options, placeholder, selectionLabel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className={`gui2-catalog-multi-select${open ? ' open' : ''}`} ref={ref}>
      <button className="custom-select-trigger gui2-catalog-multi-trigger" onClick={() => setOpen((prev) => !prev)} type="button">
        <span>{value.length > 0 ? selectionLabel : placeholder}</span>
        <span className="custom-select-arrow"><ChevronDownIcon /></span>
      </button>
      {value.length > 0 ? (
        <div className="gui2-catalog-multi-values">
          {value.map((genre) => (
            <button
              key={genre}
              type="button"
              className="gui2-catalog-multi-value"
              onClick={(event) => {
                event.stopPropagation()
                onToggle(genre)
              }}
            >
              <span>{genre}</span>
              <span className="gui2-catalog-multi-remove" aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="gui2-catalog-multi-dropdown">
          {options.map((option) => {
            const active = value.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                className={`gui2-catalog-multi-option${active ? ' selected' : ''}`}
                onClick={() => onToggle(option.value)}
              >
                <span>{option.label}</span>
                <span className="gui2-catalog-multi-option-mark" aria-hidden="true">{active ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function OnlinePosterCard({ cover, title, meta, onClick, badge, busy = false, noCoverLabel = 'no cover' }) {
  return (
    <button
      type="button"
      className={`gui2-catalog-card${busy ? ' busy' : ''}`}
      onClick={onClick}
      disabled={busy}
      title={title}
    >
      {cover ? (
        <img src={proxyImage(cover)} alt={title} className="gui2-catalog-card-cover" />
      ) : (
        <div className="gui2-catalog-card-cover gui2-catalog-card-cover-placeholder">{noCoverLabel}</div>
      )}
      <div className="gui2-catalog-card-topline">
        {badge}
      </div>
      <div className="gui2-catalog-card-body">
        <div className="gui2-catalog-card-title">{title}</div>
        {meta?.length ? <div className="gui2-catalog-card-meta">{meta}</div> : null}
      </div>
    </button>
  )
}

function getCatalogTitle(media) {
  return media?.title?.english || media?.title?.romaji || media?.title?.native || 'Anime'
}

function getCatalogMeta(media) {
  const parts = []
  if (media?.seasonYear) parts.push(media.seasonYear)
  if (media?.episodes > 0) parts.push(`${media.episodes} eps`)
  if (media?.averageScore > 0) parts.push(`Score ${(media.averageScore / 10).toFixed(1)}`)
  return parts
}

async function fetchCatalogPage({ sort, page, genres, season, year, format, status }) {
  const request = buildAnimeCatalogFetchArgs({ sort, page, genres, season, year, format, status })
  let lastError = null
  return await (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await wails.discoverAnime(request.genres, request.season, request.year, request.sort, request.status, request.format, request.page)
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      }
    }
    throw lastError
  })()
}

async function fetchCatalogFallback(page, lang = 'es') {
  const res = await wails.getTrending(lang)
  const pageData = res?.data?.Page
  const media = pageData?.media ?? []
  return {
    data: {
      Page: {
        media,
        pageInfo: {
          hasNextPage: page === 1 ? (media.length >= CATALOG_PAGE_SIZE) : false,
        },
      },
    },
  }
}

function pushAnimeSearchCandidate(list, seen, value) {
  for (const candidate of buildExpandedTitleVariants(value)) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    list.push(candidate)
  }
}

function createCatalogSelectedAnime(media, sourceID, selectionToken, perfToken) {
  return buildPendingAniListSelectedAnime(media, sourceID, {
    selection_token: selectionToken,
    perf_token: perfToken,
  })
}

function buildAniListSeededAnimeCandidates(query, alt, meta) {
  const out = []
  const seen = new Set()

  pushAnimeSearchCandidate(out, seen, query)
  pushAnimeSearchCandidate(out, seen, alt)
  pushAnimeSearchCandidate(out, seen, meta?.titleEnglish || meta?.TitleEnglish)
  pushAnimeSearchCandidate(out, seen, meta?.titleRomaji || meta?.TitleRomaji)
  pushAnimeSearchCandidate(out, seen, meta?.titleNative || meta?.TitleNative)
  pushAnimeSearchCandidate(out, seen, meta?.titleSpanish || meta?.TitleSpanish)
  ;(meta?.synonyms || meta?.Synonyms || []).forEach((value) => pushAnimeSearchCandidate(out, seen, value))
  return out
}

function buildAniListSearchMediaCandidates(query, alt, mediaList = []) {
  const out = []
  const seen = new Set()

  pushAnimeSearchCandidate(out, seen, query)
  pushAnimeSearchCandidate(out, seen, alt)

  for (const media of mediaList.slice(0, 3)) {
    pushAnimeSearchCandidate(out, seen, media?.title?.english)
    pushAnimeSearchCandidate(out, seen, media?.title?.romaji)
    pushAnimeSearchCandidate(out, seen, media?.title?.native)
    ;(media?.synonyms ?? []).forEach((value) => pushAnimeSearchCandidate(out, seen, value))
  }
  return out
}

export default function Search() {
  const location = useLocation()
  const navigate = useNavigate()
  const { lang: appLang } = useI18n()
  const isEnglish = appLang === 'en'
  const sortOptions = getSortOptions(appLang)
  const seasonOptions = getSeasonOptions(appLang)
  const yearOptions = buildYearOptions(appLang).map((option, index) => (
    index === 0 ? { ...option, label: isEnglish ? 'Year' : 'Año' } : option
  ))
  const ui = {
    enrichError: isEnglish ? 'Could not enrich the entry' : 'No se pudo enriquecer la ficha',
    notFoundAny: (term) => isEnglish
      ? `Could not find "${term}" in any source.`
      : `No se encontró "${term}" en ninguna fuente.`,
    offline: isEnglish
      ? 'You appear to be offline. Check your internet connection and try again.'
      : 'Sin conexión. Verifica tu internet e intenta de nuevo.',
    searchError: (msg) => isEnglish ? `Search error: ${msg}` : `Error al buscar: ${msg}`,
    sourceNotFound: (title, sourceName) => isEnglish
      ? `"${title}" was not found on ${sourceName}.`
      : `"${title}" no encontrado en ${sourceName}.`,
    catalogError: isEnglish ? 'Could not load Anime Online.' : 'No se pudo cargar Anime Online.',
    searchPlaceholder: isEnglish ? 'Search anime to watch online...' : 'Busca un anime para verlo online...',
    searchButton: isEnglish ? 'Search' : 'Buscar',
    searching: isEnglish ? 'Searching...' : 'Buscando...',
    order: isEnglish ? 'Sort' : 'Orden',
    season: isEnglish ? 'Season' : 'Temporada',
    year: isEnglish ? 'Year' : 'Año',
    genres: isEnglish ? 'Genres' : 'Géneros',
    combineGenres: isEnglish ? 'You can combine multiple genres.' : 'Puedes combinar varios a la vez.',
    genreSelectionCount: (count) => isEnglish
      ? `${count} genre${count !== 1 ? 's' : ''} selected`
      : `${count} genero${count !== 1 ? 's' : ''} seleccionado${count !== 1 ? 's' : ''}`,
    clearFilters: isEnglish ? 'Clear filters' : 'Limpiar filtros',
    sourceSearching: (name) => isEnglish ? `Searching in ${name}...` : `Buscando en ${name}...`,
    noResults: isEnglish ? 'No results' : 'Sin resultados',
    noResultsSource: (query, sourceName, altCount) => isEnglish
      ? `Could not find "${query}" in AniList metadata for ${sourceName}. Try the Japanese or English title.`
      : `No se encontró "${query}" en ${sourceName}. Intenta con el título en japonés o en inglés.${altCount > 0 ? ` (${altCount} resultado${altCount !== 1 ? 's' : ''} en otra fuente)` : ''}`,
    foundResults: isEnglish ? 'Search results' : 'Resultados encontrados',
    readyToOpen: (count) => isEnglish
      ? `${count} result${count !== 1 ? 's' : ''} ready to open`
      : `${count} resultado${count !== 1 ? 's' : ''} listo${count !== 1 ? 's' : ''} para abrir`,
    exploreTitle: 'Anime',
    postersLoaded: (count) => isEnglish
      ? `${count} poster${count !== 1 ? 's' : ''} loaded`
      : `${count} póster${count !== 1 ? 's' : ''} cargado${count !== 1 ? 's' : ''}`,
    filtersActive: isEnglish ? 'Active filters' : 'Filtros activos',
    directExplore: isEnglish ? 'Direct AniList browsing with source opening' : 'Exploración directa con AniList y apertura en JKAnime',
    noCatalog: isEnglish ? 'No catalog available right now' : 'Sin catálogo por ahora',
    noCatalogDesc: isEnglish
      ? 'Could not load anime to explore. Adjust the filters or try again in a few seconds.'
      : 'No se pudieron cargar animes para explorar. Ajusta los filtros o intenta de nuevo en unos segundos.',
    catalogUnavailableTitle: isEnglish ? 'AniList catalog temporarily unavailable' : 'Catálogo de AniList temporalmente no disponible',
    catalogUnavailableDesc: isEnglish
      ? 'AniList is having upstream API problems right now. Search and catalog browsing will resume after AniList recovers.'
      : 'AniList está teniendo problemas con su API en este momento. Igual puedes buscar directo en las fuentes de streaming desde esta página.',
    loadMore: isEnglish ? 'Load more' : 'Cargar más',
    previousPage: isEnglish ? 'Previous page' : 'Pagina anterior',
    nextPage: isEnglish ? 'Next page' : 'Siguiente pagina',
    pageLabel: isEnglish ? 'Page' : 'Pagina',
    noCover: isEnglish ? 'no cover' : 'sin portada',
    animeOnline: 'Anime',
    findSomething: isEnglish ? 'Find something to watch' : 'Encuentra algo para ver',
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const defaultSourceID = appLang === 'en' ? 'animeheaven-en' : 'animeav1-es'
  const [activeSource, setActiveSource] = useState(defaultSourceID)
  const [selected, setSelected] = useState(() => getInitialSelectedAnimePayload(location.state, defaultSourceID))
  const [sourceSettingsReady, setSourceSettingsReady] = useState(false)
  const [detailReturnMode, setDetailReturnMode] = useState('catalog')
  const [resolvingKey, setResolvingKey] = useState('')
  const [catalogSort, setCatalogSort] = useState('TRENDING_DESC')
  const [catalogGenres, setCatalogGenres] = useState([])
  const [catalogSeason, setCatalogSeason] = useState('')
  const [catalogYear, setCatalogYear] = useState(0)
  const [catalogFormat, setCatalogFormat] = useState('')
  const [catalogStatus, setCatalogStatus] = useState('')
  const [catalogPage, setCatalogPage] = useState(1)
  const [preferredAudio, setPreferredAudio] = useState('sub')
  const inputRef = useRef(null)
  const searchRequestRef = useRef(0)
  const selectionTaskRef = useRef(0)
  const catalogPerfTokenRef = useRef('')
  const hasPendingNavigationIntent = Boolean(
    location.state?.selectedAnime ||
    location.state?.seedAniListMedia ||
    location.state?.autoOpen ||
    location.state?.preSearch ||
    Number(location.state?.preferredAnilistID || 0) > 0
  )
  const isCatalogBrowseMode = !selected && !searched && !loading && !hasPendingNavigationIntent

  const cancelPendingSearches = useCallback(() => {
    searchRequestRef.current += 1
  }, [])

  const cancelPendingSelectionTasks = useCallback(() => {
    selectionTaskRef.current += 1
  }, [])

  const persistAnimeSourcePreference = useCallback(async (nextSourceID) => {
    const normalizedSourceID = normalizeAnimeSourceID(nextSourceID)
    if (!normalizedSourceID) return

    setActiveSource(normalizedSourceID)
    cachePreferredSourcePreference('anime', appLang, normalizedSourceID)
    await wails.saveSettings(
      buildPreferredSourceSettingsPatch('anime', appLang, normalizedSourceID),
    ).catch(() => {})
  }, [appLang])

  const openResolvedHit = useCallback(async (hit, options = {}) => {
    cancelPendingSearches()
    cancelPendingSelectionTasks()
    const aniListID = Number(hit?.anilist_id || 0)
    if (aniListID > 0) {
      void wails.getAniListAnimeByID(aniListID).catch(() => {})
    }
    const selectionToken = selectionTaskRef.current
    const perfToken = perfStart('anime-detail', `${hit?.source_id || activeSource}:${hit?.id || 'direct'}:${selectionToken}`, {
      source_id: hit?.source_id || activeSource,
      anime_id: Number(hit?.id || 0),
    })
    setDetailReturnMode(options.returnMode ?? 'results')
    setSelected({
      ...normalizeSelectedAnimePayload(hit, activeSource),
      selection_token: selectionToken,
      perf_token: perfToken,
      pending_resolve: false,
      source_resolve_error: '',
    })
    perfMark(perfToken, 'selected-shell', {
      source_id: hit?.source_id || activeSource,
      anime_id: Number(hit?.id || 0),
    })
    try {
      const enriched = await enrichJKAnimeHit(hit, wails, appLang)
      if (selectionToken !== selectionTaskRef.current) return
      setSelected((current) => {
        if (!current || current.selection_token !== selectionToken) return current
        return {
          ...normalizeSelectedAnimePayload(current, activeSource),
          ...normalizeSelectedAnimePayload(enriched, activeSource),
          selection_token: selectionToken,
          perf_token: perfToken,
          pending_resolve: false,
          source_resolve_error: '',
        }
      })
    } catch (e) {
      toastError(`${ui.enrichError}: ${e?.message ?? e}`)
    }
  }, [activeSource, appLang, cancelPendingSearches, cancelPendingSelectionTasks, ui.enrichError])

  const resolveAniListMedia = useCallback(async (media, key, options = {}) => {
    cancelPendingSearches()
    cancelPendingSelectionTasks()
    const aniListID = Number(media?.id || media?.anilist_id || 0)
    if (aniListID > 0) {
      void wails.getAniListAnimeByID(aniListID).catch(() => {})
    }
    const selectionToken = selectionTaskRef.current
    const perfToken = perfStart('anime-detail', `catalog:${media?.id || key}:${selectionToken}`, {
      anilist_id: Number(media?.id || 0),
      source_id: activeSource,
    })
    setResolvingKey(key)
    setDetailReturnMode(options.returnMode ?? 'catalog')
    setSelected(createCatalogSelectedAnime(media, activeSource, selectionToken, perfToken))
    perfMark(perfToken, 'selected-shell', {
      anilist_id: Number(media?.id || 0),
      pending_resolve: true,
      source_id: activeSource,
    })
    try {
      const { hit, searchedTitle, error } = await resolveAniListToJKAnime(media, wails, activeSource, appLang)
      if (selectionToken !== selectionTaskRef.current) return
      if (hit) {
        setSelected((current) => {
          if (!current || current.selection_token !== selectionToken) return current
          return {
            ...normalizeSelectedAnimePayload(current, activeSource),
            ...normalizeSelectedAnimePayload(hit, activeSource),
            selection_token: selectionToken,
            perf_token: perfToken,
            pending_resolve: false,
            source_resolve_error: '',
          }
        })
      } else {
        const message = error || ui.sourceNotFound(searchedTitle, SOURCE_META[activeSource]?.label ?? activeSource)
        setSelected((current) => {
          if (!current || current.selection_token !== selectionToken) return current
          return {
            ...current,
            pending_resolve: false,
            source_resolve_error: message,
            selection_token: selectionToken,
            perf_token: perfToken,
          }
        })
      }
    } finally {
      if (selectionToken === selectionTaskRef.current) {
        setResolvingKey('')
      }
    }
  }, [activeSource, appLang, cancelPendingSearches, cancelPendingSelectionTasks, ui])

  const performSearch = useCallback(async (rawQuery, opts = {}) => {
    const {
      alt = '',
      clearSelected = true,
      openFirst = false,
      preferredAnilistID = 0,
      silent = false,
      returnMode = 'results',
    } = opts

    const term = rawQuery?.trim()
    if (!term) return []
    const requestID = ++searchRequestRef.current

    setQuery(term)
    setLoading(true)
    setSearched(false)
    if (clearSelected) setSelected(null)

    try {
      const aniListSearch = await wails.searchAniList(term, appLang)
      const media = extractAniListAnimeSearchMedia(aniListSearch)
      const seen = new Set()
      const finalResults = media
        .filter((item) => {
          const id = Number(item?.id || item?.anilist_id || 0)
          if (id <= 0 || seen.has(id)) return false
          seen.add(id)
          return true
        })
        .slice(0, preferredAnilistID > 0 ? 12 : 10)
      if (requestID !== searchRequestRef.current) return []
      setResults(finalResults)

      const preferredMatch = preferredAnilistID > 0
        ? finalResults.find((item) => Number(item?.id || item?.anilist_id || 0) === preferredAnilistID) || null
        : null

      if (preferredMatch) {
        await resolveAniListMedia(preferredMatch, `search-${preferredAnilistID}`, { returnMode })
      } else if (openFirst && finalResults.length > 0) {
        await resolveAniListMedia(finalResults[0], `search-${finalResults[0]?.id || 0}`, { returnMode })
      }

      if (!silent && finalResults.length === 0) {
        toastError(ui.notFoundAny(term))
      }

      return finalResults
    } catch (e) {
      if (requestID !== searchRequestRef.current) return []
      setResults([])
      const msg = e?.message ?? String(e)
      if (isAniListUnavailableErrorMessage(e)) {
        toastError(ui.catalogUnavailableDesc)
      } else if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch')) {
        toastError(ui.offline)
      } else {
        toastError(ui.searchError(msg))
      }
      return []
    } finally {
      if (requestID === searchRequestRef.current) {
        setLoading(false)
        setSearched(true)
      }
    }
  }, [appLang, resolveAniListMedia, ui])

  useEffect(() => {
    let cancelled = false
    setSourceSettingsReady(false)

    wails.getSettings()
      .then((settings) => {
        if (cancelled) return
        const preferredAudioValue = String(settings?.preferred_audio ?? 'sub').trim().toLowerCase()
        const preferredSourceID = resolveSavedOnlineSourcePreference({
          mediaType: 'anime',
          lang: appLang,
          settings,
          fallbackSourceID: defaultSourceID,
          normalizeSourceID: normalizeAnimeSourceID,
        })
        setPreferredAudio(preferredAudioValue === 'dub' ? 'dub' : 'sub')
        setActiveSource(preferredSourceID)
        cachePreferredSourcePreference('anime', appLang, preferredSourceID)
        setSourceSettingsReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setPreferredAudio('sub')
        setActiveSource(defaultSourceID)
        setSourceSettingsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [appLang, defaultSourceID])

  const hasCatalogFilters = catalogGenres.length > 0 || Boolean(catalogSeason) || Boolean(catalogYear) || Boolean(catalogFormat) || Boolean(catalogStatus)

  useEffect(() => {
    setSelected((current) => {
      if (!current?.pending_resolve || current.source_id === activeSource) return current
      return {
        ...current,
        source_id: activeSource,
      }
    })
  }, [activeSource])

  useEffect(() => {
    setCatalogPage(1)
  }, [appLang, catalogFormat, catalogGenres, catalogSeason, catalogSort, catalogStatus, catalogYear])

  const catalogQuery = useQuery({
    queryKey: ['anime-catalog', appLang, catalogSort, catalogGenres.join(','), catalogSeason, catalogYear, catalogPage, catalogFormat, catalogStatus],
    queryFn: async () => {
      try {
        const res = await fetchCatalogPage({
          sort: catalogSort,
          page: catalogPage,
          genres: catalogGenres,
          season: catalogSeason,
          year: catalogYear,
          format: catalogFormat,
          status: catalogStatus,
        })
        const pageData = res?.data?.Page
        const media = pageData?.media ?? []
        if (catalogPage === 1 && catalogGenres.length === 0 && !catalogSeason && !catalogYear && !catalogFormat && !catalogStatus && media.length === 0) {
          const fallback = await fetchCatalogFallback(catalogPage, appLang)
          const fallbackPage = fallback?.data?.Page
          return {
            media: fallbackPage?.media ?? [],
            hasNextPage: fallbackPage?.pageInfo?.hasNextPage ?? false,
            page: catalogPage,
          }
        }
        return {
          media,
          hasNextPage: pageData?.pageInfo?.hasNextPage ?? false,
          page: catalogPage,
        }
      } catch (error) {
        if (catalogPage !== 1 || catalogGenres.length || catalogSeason || catalogYear || catalogFormat || catalogStatus) {
          throw error
        }
        const res = await fetchCatalogFallback(catalogPage, appLang)
        const pageData = res?.data?.Page
        return {
          media: pageData?.media ?? [],
          hasNextPage: pageData?.pageInfo?.hasNextPage ?? false,
          page: catalogPage,
        }
      }
    },
    staleTime: 20 * 60_000,
    gcTime: 45 * 60_000,
    placeholderData: previousData => previousData,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: isCatalogBrowseMode,
  })

  const catalogAniListUnavailable = isAniListUnavailableErrorMessage(catalogQuery.error)

  useEffect(() => {
    if (catalogQuery.error && !catalogAniListUnavailable) {
      toastError(ui.catalogError)
    }
  }, [catalogAniListUnavailable, catalogQuery.error, ui.catalogError])

  const catalogItems = catalogQuery.data?.media ?? []
  const displayedCatalog = useMemo(() => catalogItems, [catalogItems])
  const catalogLoading = displayedCatalog.length === 0 && (
    catalogQuery.isLoading
    || catalogQuery.isFetching
  )
  const catalogHasNext = Boolean(catalogQuery.data?.hasNextPage)
  const showSearchSkeleton = useStableLoadingGate(
    loading || hasPendingNavigationIntent,
    { delayMs: 0, minVisibleMs: 320 },
  )
  const showCatalogSkeleton = useStableLoadingGate(
    isCatalogBrowseMode && catalogLoading,
    { delayMs: 0, minVisibleMs: 280 },
  )

  useEffect(() => {
    const perfKey = [appLang, catalogSort, catalogGenres.join(','), catalogSeason, catalogYear, catalogFormat, catalogStatus].join(':')
    if (!isCatalogBrowseMode) {
      if (catalogPerfTokenRef.current) {
        perfEnd(catalogPerfTokenRef.current, 'cancelled')
        catalogPerfTokenRef.current = ''
      }
      return
    }
    if (!catalogPerfTokenRef.current.endsWith(`:${perfKey}`)) {
      if (catalogPerfTokenRef.current) {
        perfEnd(catalogPerfTokenRef.current, 'restarted')
      }
      const nextToken = perfStart('anime-catalog', perfKey, {
        lang: appLang,
        sort: catalogSort,
        genres: catalogGenres.length,
        season: catalogSeason || '',
        year: catalogYear || 0,
        page: catalogPage,
        format: catalogFormat || '',
        status: catalogStatus || '',
      })
      catalogPerfTokenRef.current = nextToken
      perfMark(nextToken, 'initial-paint')
    }
  }, [appLang, catalogFormat, catalogGenres, catalogPage, catalogSeason, catalogSort, catalogStatus, catalogYear, isCatalogBrowseMode])

  useEffect(() => {
    if (!catalogPerfTokenRef.current || displayedCatalog.length === 0) return
    perfEnd(catalogPerfTokenRef.current, 'catalog-ready', {
      items: displayedCatalog.length,
      page: catalogPage,
    })
    catalogPerfTokenRef.current = ''
  }, [catalogPage, displayedCatalog.length])

  useEffect(() => {
    const navState = location.state
    if (!navState) return
    if (!sourceSettingsReady && (navState.seedAniListMedia || navState.preSearch)) return

    navigate(location.pathname, { replace: true, state: null })

    if (navState.selectedAnime) {
      setDetailReturnMode('catalog')
      setSelected(normalizeSelectedAnimePayload(navState.selectedAnime, activeSource))
      return
    }

    if (navState.seedAniListMedia) {
      void (async () => {
        const aniListID = Number(
          navState.seedAniListMedia?.id
          || navState.seedAniListMedia?.anilist_id
          || navState.preferredAnilistID
          || 0,
        )
        const hydratedMedia = aniListID > 0 ? await wails.getAniListAnimeByID(aniListID).catch(() => null) : null
        await resolveAniListMedia(
          hydratedMedia || {
            ...navState.seedAniListMedia,
            ...(aniListID > 0 ? { id: aniListID, anilist_id: aniListID } : {}),
          },
          `nav-seed-${aniListID || navState.seedAniListMedia?.id || 'anime'}`,
        )
      })()
      return
    }

    if (navState.autoOpen) {
      void openResolvedHit(navState.autoOpen, { returnMode: 'catalog' })
      return
    }

    if (navState.preSearch) {
      void performSearch(navState.preSearch, {
        alt: navState.altSearch,
        openFirst: true,
        preferredAnilistID: Number(navState.preferredAnilistID) || 0,
        returnMode: 'catalog',
        silent: true,
      })
    }
  }, [activeSource, location.pathname, location.state, navigate, openResolvedHit, performSearch, resolveAniListMedia, sourceSettingsReady])

  const handleActiveSourceChange = useCallback((nextSourceID) => {
    const normalizedSourceID = normalizeAnimeSourceID(nextSourceID)
    if (!normalizedSourceID || normalizedSourceID === activeSource) return
    void persistAnimeSourcePreference(normalizedSourceID)
  }, [activeSource, persistAnimeSourcePreference])

  const handleAnimeChange = useCallback((nextAnime) => {
    if (!nextAnime) return
    const nextSourceID = normalizeAnimeSourceID(nextAnime?.source_id || activeSource)
    setSelected(normalizeSelectedAnimePayload(nextAnime, nextSourceID))
    if (nextSourceID && nextSourceID !== activeSource) {
      void persistAnimeSourcePreference(nextSourceID)
    }
  }, [activeSource, persistAnimeSourcePreference])

  const handleBackFromDetail = useCallback(() => {
    cancelPendingSearches()
    cancelPendingSelectionTasks()
    setResolvingKey('')
    setSelected(null)
    if (detailReturnMode === 'catalog') {
      setResults([])
      setSearched(false)
      setLoading(false)
      setQuery('')
    }
  }, [cancelPendingSearches, cancelPendingSelectionTasks, detailReturnMode])

  const handleSearch = useCallback(() => {
    performSearch(query)
  }, [performSearch, query])

  const handleQueryChange = useCallback((event) => {
    const nextQuery = event.target.value
    setQuery(nextQuery)

    if (!nextQuery.trim()) {
      cancelPendingSearches()
      setLoading(false)
      setSearched(false)
      setResults([])
    }
  }, [cancelPendingSearches])

  const handleKey = useCallback((event) => {
    if (event.key === 'Enter') handleSearch()
  }, [handleSearch])

  const handleCatalogSort = useCallback((value) => {
    setCatalogSort(value)
  }, [])

  const toggleGenre = useCallback((genre) => {
    setCatalogGenres((current) => (
      current.includes(genre)
        ? current.filter(item => item !== genre)
        : [...current, genre]
    ))
  }, [])

  const handleSeasonChange = useCallback((value) => {
    setCatalogSeason(value)
  }, [])

  const handleYearChange = useCallback((value) => {
    setCatalogYear(Number(value) || 0)
  }, [])

  const handleFormatChange = useCallback((value) => {
    setCatalogFormat(value)
  }, [])

  const handleStatusChange = useCallback((value) => {
    setCatalogStatus(value)
  }, [])

  const clearCatalogFilters = useCallback(() => {
    setCatalogGenres([])
    setCatalogSeason('')
    setCatalogYear(0)
    setCatalogFormat('')
    setCatalogStatus('')
    setCatalogSort('TRENDING_DESC')
  }, [])

  const handleNextPage = useCallback(() => {
    if (!catalogHasNext || catalogQuery.isFetching) return
    setCatalogPage((current) => current + 1)
  }, [catalogHasNext, catalogQuery.isFetching])

    const handlePreviousPage = useCallback(() => {
      setCatalogPage((current) => Math.max(1, current - 1))
    }, [])
    const handlePageJump = useCallback((page) => {
      const nextPage = Number(page) || 1
      if (catalogQuery.isFetching || nextPage < 1 || nextPage === catalogPage) return
      setCatalogPage(nextPage)
    }, [catalogPage, catalogQuery.isFetching])

  const catalogSummary = [
    `${ui.pageLabel} ${catalogPage}`,
    `${displayedCatalog.length}/${CATALOG_PAGE_SIZE}`,
    hasCatalogFilters ? ui.filtersActive : ui.directExplore,
  ].join(' / ')
  const activeSourceLabel = SOURCE_META[activeSource]?.label ?? activeSource
  const sourceSummaryValue = (
    <div className="gui2-catalog-source-display">
      <span className="gui2-catalog-source-display-icon"><CatalogIcon kind="language" /></span>
      <span>{activeSourceLabel}</span>
    </div>
  )
  const resultsSummary = searched
    ? `${results.length} ${isEnglish ? 'results' : 'resultados'}`
    : `${displayedCatalog.length} ${isEnglish ? 'results' : 'resultados'}`
  const pageSummary = `${ui.pageLabel} ${catalogPage}`
  const activeFilterTags = [
    { label: 'Source', value: activeSourceLabel },
    ...catalogGenres.map((genre) => ({ label: isEnglish ? 'Genre' : 'Genero', value: GENRE_LABELS[genre]?.[appLang] ?? genre })),
    ...(catalogSeason ? [{ label: isEnglish ? 'Season' : 'Temporada', value: seasonOptions.find((item) => item.value === catalogSeason)?.label ?? catalogSeason }] : []),
    ...(catalogYear ? [{ label: isEnglish ? 'Year' : 'Ano', value: String(catalogYear) }] : []),
    ...(catalogFormat ? [{ label: isEnglish ? 'Format' : 'Formato', value: ANIME_FORMAT_OPTIONS.find((item) => item.value === catalogFormat)?.label ?? catalogFormat }] : []),
    ...(catalogStatus ? [{ label: isEnglish ? 'Status' : 'Estado', value: ANIME_STATUS_OPTIONS.find((item) => item.value === catalogStatus)?.label ?? catalogStatus }] : []),
  ]
  const animeCatalogFilters = [
      {
        key: 'genre',
        icon: 'genre',
        label: isEnglish ? 'Genre' : 'Genero',
        control: (
          <GenreMultiSelect
            value={catalogGenres}
            onToggle={toggleGenre}
            options={GENRES.map((genre) => ({
              value: genre,
              label: GENRE_LABELS[genre]?.[appLang] ?? GENRE_LABELS[genre]?.es ?? genre,
            }))}
            placeholder={ui.genres}
            selectionLabel={ui.genreSelectionCount(catalogGenres.length)}
          />
        ),
        wide: true,
      },
    {
      key: 'season-year',
      icon: 'season',
      label: isEnglish ? 'Year / Season' : 'Ano / Temporada',
      control: (
        <div className="gui2-catalog-inline-controls">
          <CustomSelect value={catalogYear} onChange={handleYearChange} options={yearOptions} placeholder={ui.year} />
          <CustomSelect value={catalogSeason} onChange={handleSeasonChange} options={seasonOptions} placeholder={ui.season} />
        </div>
      ),
    },
    {
      key: 'format',
      icon: 'format',
      label: isEnglish ? 'Format' : 'Formato',
      control: <CustomSelect value={catalogFormat} onChange={handleFormatChange} options={ANIME_FORMAT_OPTIONS} placeholder={isEnglish ? 'All Types' : 'Todos'} />,
    },
    {
      key: 'status',
      icon: 'status',
      label: isEnglish ? 'Status' : 'Estado',
      control: <CustomSelect value={catalogStatus} onChange={handleStatusChange} options={ANIME_STATUS_OPTIONS} placeholder={isEnglish ? 'All Status' : 'Todos'} />,
    },
    {
      key: 'sort',
      icon: 'sort',
      label: isEnglish ? 'Sort' : 'Orden',
      control: <CustomSelect value={catalogSort} onChange={handleCatalogSort} options={sortOptions} placeholder={ui.order} />,
    },
    {
      key: 'source',
      icon: 'language',
      label: isEnglish ? 'Language / Source' : 'Idioma / Fuente',
      control: <CustomSelect value={activeSource} onChange={handleActiveSourceChange} options={ANIME_SOURCE_OPTIONS} placeholder={isEnglish ? 'All Sources' : 'Todas'} />,
    },
  ]
  const searchSummaryPills = searched
    ? [
        activeSourceLabel,
        isEnglish ? `${results.length} AniList result${results.length !== 1 ? 's' : ''}` : `${results.length} resultado${results.length !== 1 ? 's' : ''} de AniList`,
        isEnglish ? 'Metadata first, source on open' : 'Metadata primero, fuente al abrir',
      ]
    : [
        activeSourceLabel,
        isEnglish ? `${displayedCatalog.length} titles visible` : `${displayedCatalog.length} titulos visibles`,
        hasCatalogFilters
          ? (isEnglish ? 'Filters shaping the feed' : 'Filtros afinando el feed')
          : (isEnglish ? 'Discover mode active' : 'Modo descubrir activo'),
      ]

  if (selected) {
    return (
      <OnlineAnimeDetail
        anime={selected}
        onBack={handleBackFromDetail}
        onAnimeChange={handleAnimeChange}
      />
    )
  }

  return (
    <Gui2OnlineCatalogSurface
      title={isEnglish ? 'Anime Online' : 'Anime Online'}
      description={isEnglish ? 'Stream thousands of anime shows and movies in high quality.' : 'Ve miles de animes y peliculas en alta calidad.'}
      accentText={isEnglish ? 'Updated daily.' : 'Actualizado cada dia.'}
      searchControl={(
        <div className="gui2-catalog-query">
          <span className="gui2-catalog-query-icon"><CatalogIcon kind="search" /></span>
          <input
            ref={inputRef}
            className="gui2-catalog-query-input"
            placeholder={ui.searchPlaceholder}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKey}
          />
          <button
            type="button"
            className="gui2-catalog-query-btn"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? ui.searching : ui.searchButton}
          </button>
        </div>
      )}
      sourceSummaryLabel={isEnglish ? 'Source' : 'Fuente'}
      sourceSummaryValue={sourceSummaryValue}
      resultsSummary={resultsSummary}
      pageSummary={pageSummary}
      topPagination={(
        <div className="gui2-catalog-top-pagination">
          <PageArrowButton direction="prev" onClick={handlePreviousPage} disabled={catalogPage === 1 || catalogQuery.isFetching || searched} label={ui.previousPage} />
          <PageArrowButton direction="next" onClick={handleNextPage} disabled={!catalogHasNext || catalogQuery.isFetching || searched} label={ui.nextPage} />
        </div>
      )}
      filters={animeCatalogFilters}
      activeFilters={activeFilterTags}
      onClearFilters={hasCatalogFilters ? clearCatalogFilters : null}
      actionLabel={ui.clearFilters}
      bodyTitle={searched ? ui.foundResults : ui.exploreTitle}
      bodySubtitle={searched ? ui.readyToOpen(results.length) : catalogSummary}
      body={(() => {
        if (showSearchSkeleton) {
          return <OnlinePosterSkeletonGrid count={8} />
        }

        if (searched && results.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-title">{ui.noResults}</div>
              <p className="empty-state-desc">
                {ui.noResultsSource(query, SOURCE_META[activeSource]?.label ?? activeSource, 0)}
              </p>
            </div>
          )
        }

        if (searched && results.length > 0) {
          return (
            <VirtualMediaGrid
              items={results}
              listClassName="gui2-catalog-grid"
              itemClassName="gui2-catalog-grid-item"
              itemContent={(item, index) => (
                <OnlinePosterCard
                  key={`search-${item.id || index}`}
                  cover={item?.coverImage?.extraLarge || item?.coverImage?.large || item?.coverImage?.medium}
                  title={getCatalogTitle(item)}
                  meta={getCatalogMeta(item).map((value) => <span key={`${item.id}-${value}`}>{value}</span>)}
                  badge={item?.status ? <span className="gui2-catalog-status-badge">{item.status.replace('_', ' ')}</span> : null}
                  busy={resolvingKey === `search-${item.id || index}`}
                  noCoverLabel={ui.noCover}
                  onClick={() => resolveAniListMedia(item, `search-${item.id || index}`, { returnMode: 'results' })}
                />
              )}
            />
          )
        }

        if (showCatalogSkeleton && displayedCatalog.length === 0) {
          return <OnlinePosterSkeletonGrid count={CATALOG_PAGE_SIZE} />
        }

        if (!showCatalogSkeleton && displayedCatalog.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-title">{catalogAniListUnavailable ? ui.catalogUnavailableTitle : ui.noCatalog}</div>
              <p className="empty-state-desc">
                {catalogAniListUnavailable ? ui.catalogUnavailableDesc : ui.noCatalogDesc}
              </p>
            </div>
          )
        }

        return (
          <VirtualMediaGrid
            items={displayedCatalog}
            listClassName="gui2-catalog-grid"
            itemClassName="gui2-catalog-grid-item"
            itemContent={(media) => {
              const title = getCatalogTitle(media)
              const key = `catalog-${media.id}`
              return (
                <OnlinePosterCard
                  key={key}
                  cover={media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium}
                  title={title}
                  meta={getCatalogMeta(media).map((value) => <span key={`${media.id}-${value}`}>{value}</span>)}
                  badge={media?.status ? <span className="gui2-catalog-status-badge">{media.status.replace('_', ' ')}</span> : null}
                  busy={resolvingKey === key}
                  noCoverLabel={ui.noCover}
                  onClick={() => resolveAniListMedia(media, key)}
                />
              )
            }}
          />
        )
      })()}
      bottomPagination={!searched ? (
          <Gui2CatalogPaginationControls
            onPrev={handlePreviousPage}
            onNext={handleNextPage}
            onJumpToPage={handlePageJump}
            canPrev={catalogPage > 1}
            canNext={catalogHasNext}
            currentPage={catalogPage}
            pageSizeLabel={`${CATALOG_PAGE_SIZE} ${isEnglish ? 'per page' : 'por pagina'}`}
            prevLabel={ui.previousPage}
          nextLabel={ui.nextPage}
          busy={catalogQuery.isFetching}
        />
      ) : null}
    />
  )
}
