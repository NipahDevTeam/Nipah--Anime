import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
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
import { buildExpandedTitleVariants } from '../lib/titleMatching'
import { isAniListUnavailableErrorMessage } from '../lib/anilistStatus'
import VirtualMediaGrid from '../components/ui/VirtualMediaGrid'
import { useI18n } from '../lib/i18n'
import { perfEnd, perfMark, perfStart } from '../lib/perfTrace'

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

function buildYearOptions(lang) {
  const currentYear = new Date().getFullYear()
  const years = [{ value: 0, label: 'Año' }]
  for (let year = currentYear + 1; year >= currentYear - 30; year -= 1) {
    years.push({ value: year, label: String(year) })
  }
  return years
}

const YEAR_OPTIONS = buildYearOptions()

function SourceBadge({ sourceID = 'jkanime-es' }) {
  const meta = SOURCE_META[sourceID] ?? { label: sourceID, color: '#9090a8' }
  return (
    <span
      className="online-source-badge"
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
    <div className={`custom-select online-custom-select${open ? ' open' : ''}`} ref={ref}>
      <button className="custom-select-trigger" onClick={() => setOpen(prev => !prev)} type="button">
        <span>{label}</span>
        <span className="custom-select-arrow">v</span>
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

function OnlinePosterCard({ cover, title, meta, onClick, badge, busy = false, noCoverLabel = 'no cover' }) {
  return (
    <button
      type="button"
      className={`online-result-card${busy ? ' busy' : ''}`}
      onClick={onClick}
      disabled={busy}
      title={title}
    >
      {cover ? (
        <img src={proxyImage(cover)} alt={title} className="online-result-cover" />
      ) : (
        <div className="online-result-cover online-result-cover-placeholder">{noCoverLabel}</div>
      )}
      <div className="online-result-overlay" />
      <div className="online-result-topline">
        {badge}
      </div>
      <div className="online-result-body">
        <div className="online-result-title">{title}</div>
        {meta?.length ? <div className="online-result-meta">{meta}</div> : null}
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

async function fetchCatalogPage({ sort, page, genres, season, year }) {
  let lastError = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await wails.discoverAnime(genres.join(','), season, year, sort, '', page)
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
  }

  throw lastError
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
          hasNextPage: page === 1 ? (media.length >= 20) : false,
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
  const title = getCatalogTitle(media)
  const coverURL = media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium || ''
  return {
    ...media,
    selection_token: selectionToken,
    perf_token: perfToken,
    pending_resolve: true,
    source_id: sourceID,
    id: 0,
    title,
    anime_title: title,
    cover_url: coverURL,
    anilist_id: Number(media?.id || 0),
    mal_id: Number(media?.idMal || 0),
    year: Number(media?.seasonYear || media?.startDate?.year || 0),
    anilistDescription: media?.description || '',
    anilistBannerImage: media?.bannerImage || '',
    anilistCoverImage: coverURL,
    source_resolve_error: '',
  }
}

function normalizeSelectedAnimePayload(anime, fallbackSourceID = '') {
  if (!anime) return anime
  const sourceID = anime.source_id || fallbackSourceID || ''
  const sourceAnimeID = anime.id ?? anime.anime_id ?? anime.animeID ?? ''
  const title = anime.title || anime.anime_title || anime.title_english || anime.title_romaji || anime.title_native || ''
  const providerCoverURL = anime.cover_url || anime.cover_image || ''
  const anilistCoverURL = anime.anilistCoverImage || ''
  const coverURL = (isStrictEnglishAnimeSource(sourceID) && sourceID !== 'animekai-en')
    ? (anilistCoverURL || providerCoverURL)
    : (providerCoverURL || anilistCoverURL)
  return {
    ...anime,
    source_id: sourceID,
    id: sourceAnimeID,
    anime_id: anime.anime_id ?? sourceAnimeID,
    title,
    anime_title: anime.anime_title || title,
    cover_url: coverURL,
  }
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
    clearFilters: isEnglish ? 'Clear filters' : 'Limpiar filtros',
    sourceSearching: (name) => isEnglish ? `Searching in ${name}...` : `Buscando en ${name}...`,
    noResults: isEnglish ? 'No results' : 'Sin resultados',
    noResultsSource: (query, sourceName, altCount) => isEnglish
      ? `Could not find "${query}" on ${sourceName}. Try the Japanese or English title.${altCount > 0 ? ` (${altCount} result${altCount !== 1 ? 's' : ''} on another source)` : ''}`
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
      ? 'AniList is having upstream API problems right now. You can still search directly in the streaming sources from this page.'
      : 'AniList está teniendo problemas con su API en este momento. Igual puedes buscar directo en las fuentes de streaming desde esta página.',
    loadMore: isEnglish ? 'Load more' : 'Cargar más',
    noCover: isEnglish ? 'no cover' : 'sin portada',
    animeOnline: 'Anime',
    findSomething: isEnglish ? 'Find something to watch' : 'Encuentra algo para ver',
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState(() => location.state?.selectedAnime ?? null)
  const [detailReturnMode, setDetailReturnMode] = useState('catalog')
  const [resolvingKey, setResolvingKey] = useState('')
  const [activeSource, setActiveSource] = useState(() => (appLang === 'en' ? 'animeheaven-en' : 'animeav1-es'))
  const [catalogSort, setCatalogSort] = useState('TRENDING_DESC')
  const [catalogGenres, setCatalogGenres] = useState([])
  const [catalogSeason, setCatalogSeason] = useState('')
  const [catalogYear, setCatalogYear] = useState(0)
  const [preferredAudio, setPreferredAudio] = useState('sub')
  const inputRef = useRef(null)
  const searchRequestRef = useRef(0)
  const selectionTaskRef = useRef(0)
  const catalogPerfTokenRef = useRef('')
  const hasPendingNavigationIntent = Boolean(
    location.state?.selectedAnime ||
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

  const openResolvedHit = useCallback(async (hit, options = {}) => {
    cancelPendingSearches()
    cancelPendingSelectionTasks()
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
      let candidates = buildAniListSeededAnimeCandidates(term, alt, null)
      try {
        const aniListSearch = await wails.searchAniList(term, appLang)
        const media = aniListSearch?.data?.Page?.media ?? []
        const seeded = buildAniListSearchMediaCandidates(term, alt, media)
        if (seeded.length > 0) {
          candidates = seeded
        }
      } catch {}
      candidates = candidates.slice(0, preferredAnilistID > 0 ? 10 : 8)
      const aggregateResults = []
      const seen = new Set()
      let preferredMatch = null
      let lastSourceError = null

      for (const candidate of candidates) {
        let res
        try {
          res = await wails.searchOnline(candidate, activeSource)
        } catch (error) {
          lastSourceError = error
          continue
        }
        if (requestID !== searchRequestRef.current) return []
        const currentResults = res ?? []

        for (const item of currentResults) {
          const key = `${item.source_id ?? activeSource}:${item.id}`
          if (!seen.has(key)) {
            seen.add(key)
            aggregateResults.push(item)
          }
        }

        if (preferredAnilistID > 0) {
          const rankedCurrentResults = rankOnlineSourceHits(currentResults, candidates, {
            strictSeason: isStrictEnglishAnimeSource(activeSource),
            preferredAudio,
          }).slice(0, 6)
          for (const item of rankedCurrentResults) {
            try {
              const enriched = await enrichJKAnimeHit(item, wails, appLang)
              if (requestID !== searchRequestRef.current) return []
              if (Number(enriched?.anilist_id || 0) === preferredAnilistID) {
                preferredMatch = enriched
                break
              }
            } catch {}
          }
          if (preferredMatch) break
        }
      }

      if (!preferredMatch && aggregateResults.length === 0 && lastSourceError) {
        throw lastSourceError
      }

      const finalResults = rankOnlineSourceHits(aggregateResults, candidates, {
        strictSeason: isStrictEnglishAnimeSource(activeSource),
        preferredAudio,
      })
      if (requestID !== searchRequestRef.current) return []
      setResults(finalResults)

      if (preferredMatch) {
        setDetailReturnMode(returnMode)
        setSelected(normalizeSelectedAnimePayload(preferredMatch, activeSource))
      } else if (openFirst && finalResults.length > 0) {
        await openResolvedHit(finalResults[0], { returnMode })
      }

      if (!silent && finalResults.length === 0) {
        toastError(ui.notFoundAny(term))
      }

      return finalResults
    } catch (e) {
      if (requestID !== searchRequestRef.current) return []
      setResults([])
      const msg = e?.message ?? String(e)
      if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch')) {
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
  }, [activeSource, appLang, openResolvedHit, preferredAudio])

  useEffect(() => {
    let cancelled = false
    wails.getSettings()
      .then((settings) => {
        if (cancelled) return
        const value = String(settings?.preferred_audio ?? 'sub').trim().toLowerCase()
        setPreferredAudio(value === 'dub' ? 'dub' : 'sub')
      })
      .catch(() => {
        if (!cancelled) setPreferredAudio('sub')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const resolveAniListMedia = useCallback(async (media, key) => {
    cancelPendingSearches()
    cancelPendingSelectionTasks()
    const selectionToken = selectionTaskRef.current
    const perfToken = perfStart('anime-detail', `catalog:${media?.id || key}:${selectionToken}`, {
      anilist_id: Number(media?.id || 0),
      source_id: activeSource,
    })
    setResolvingKey(key)
    setDetailReturnMode('catalog')
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

  const hasCatalogFilters = catalogGenres.length > 0 || Boolean(catalogSeason) || Boolean(catalogYear)

  const starterFeedQuery = useQuery({
    queryKey: ['anime-starter-feed', appLang],
    queryFn: async () => {
      const res = await wails.getTrending(appLang)
      return res?.data?.Page?.media ?? []
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: previousData => previousData,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: isCatalogBrowseMode && !hasCatalogFilters,
  })

  useEffect(() => {
    setActiveSource((current) => {
      const esSourceIDs = ['jkanime-es', 'animeflv-es', 'animeav1-es']
      const enSourceIDs = ['animepahe-en', 'animeheaven-en', 'animegg-en']
      if (appLang === 'en') {
        if (esSourceIDs.includes(current) || current === 'animekai-en') return 'animegg-en'
        return current
      }
      return enSourceIDs.includes(current) ? 'animeav1-es' : current
    })
  }, [appLang])

  const catalogQuery = useInfiniteQuery({
    queryKey: ['anime-catalog', appLang, catalogSort, catalogGenres.join(','), catalogSeason, catalogYear],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      try {
        const res = await fetchCatalogPage({
          sort: catalogSort,
          page: pageParam,
          genres: catalogGenres,
          season: catalogSeason,
          year: catalogYear,
        })
        const pageData = res?.data?.Page
        return {
          media: pageData?.media ?? [],
          hasNextPage: pageData?.pageInfo?.hasNextPage ?? false,
          page: pageParam,
        }
      } catch (error) {
        if (pageParam !== 1 || catalogGenres.length || catalogSeason || catalogYear) {
          throw error
        }
        const res = await fetchCatalogFallback(pageParam, appLang)
        const pageData = res?.data?.Page
        return {
          media: pageData?.media ?? [],
          hasNextPage: pageData?.pageInfo?.hasNextPage ?? false,
          page: pageParam,
        }
      }
    },
    getNextPageParam: (lastPage, allPages) => lastPage?.hasNextPage ? allPages.length + 1 : undefined,
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

  const catalog = useMemo(
    () => (catalogQuery.data?.pages ?? []).flatMap((page) => page.media ?? []),
    [catalogQuery.data],
  )
  const starterCatalog = starterFeedQuery.data ?? []
  const displayedCatalog = catalog.length > 0 ? catalog : (!hasCatalogFilters ? starterCatalog : [])
  const catalogLoading = displayedCatalog.length === 0 && (
    catalogQuery.isLoading
    || catalogQuery.isFetching
    || (!hasCatalogFilters && starterFeedQuery.isLoading)
  )
  const catalogFetchingMore = catalogQuery.isFetchingNextPage
  const catalogHasNext = Boolean(catalogQuery.hasNextPage)

  useEffect(() => {
    const perfKey = [appLang, catalogSort, catalogGenres.join(','), catalogSeason, catalogYear].join(':')
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
      })
      catalogPerfTokenRef.current = nextToken
      perfMark(nextToken, 'initial-paint')
    }
  }, [appLang, catalogGenres, catalogSeason, catalogSort, catalogYear, isCatalogBrowseMode])

  useEffect(() => {
    if (!catalogPerfTokenRef.current || displayedCatalog.length === 0) return
    perfEnd(catalogPerfTokenRef.current, 'catalog-ready', {
      items: displayedCatalog.length,
      starter_feed: catalog.length === 0,
    })
    catalogPerfTokenRef.current = ''
  }, [catalog.length, displayedCatalog.length])

  useEffect(() => {
    const navState = location.state
    if (!navState) return

    navigate(location.pathname, { replace: true, state: null })

    if (navState.selectedAnime) {
      setDetailReturnMode('catalog')
      setSelected(normalizeSelectedAnimePayload(navState.selectedAnime, activeSource))
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
  }, [location.pathname, location.state, navigate, openResolvedHit, performSearch])

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

  const clearCatalogFilters = useCallback(() => {
    setCatalogGenres([])
    setCatalogSeason('')
    setCatalogYear(0)
    setCatalogSort('TRENDING_DESC')
  }, [])

  const handleLoadMore = useCallback(() => {
    if (catalogFetchingMore || !catalogHasNext) return
    void catalogQuery.fetchNextPage()
  }, [catalogFetchingMore, catalogHasNext, catalogQuery])

  const catalogSummary = [
    ui.postersLoaded(displayedCatalog.length),
    catalog.length === 0 && displayedCatalog.length > 0 && !hasCatalogFilters
      ? ui.directExplore
      : (hasCatalogFilters ? ui.filtersActive : ui.directExplore),
  ].join(' / ')
  const activeSourceLabel = SOURCE_META[activeSource]?.label ?? activeSource
  const searchSummaryPills = searched
    ? [
        activeSourceLabel,
        isEnglish ? `${results.length} source matches` : `${results.length} coincidencias`,
        catalogAniListUnavailable
          ? (isEnglish ? 'AniList fallback active' : 'Fallback de AniList activo')
          : (isEnglish ? 'Direct source search' : 'Busqueda directa por fuente'),
      ]
    : [
        activeSourceLabel,
        isEnglish ? `${displayedCatalog.length} titles visible` : `${displayedCatalog.length} titulos visibles`,
        hasCatalogFilters
          ? (isEnglish ? 'Filters shaping the feed' : 'Filtros afinando el feed')
          : (catalog.length === 0 && displayedCatalog.length > 0
              ? (isEnglish ? 'Starter feed ready first' : 'Feed inicial listo primero')
              : (isEnglish ? 'Discover mode active' : 'Modo descubrir activo')),
      ]

  if (selected) {
    return (
      <OnlineAnimeDetail
        anime={selected}
        onBack={handleBackFromDetail}
        onAnimeChange={(nextAnime) => setSelected(normalizeSelectedAnimePayload(nextAnime, nextAnime?.source_id || activeSource))}
      />
    )
  }

  return (
    <div className="fade-in online-directory-page">
      <section className="online-directory-shell">
        <header className="online-directory-toolbar">
          <div className="online-directory-titleblock">
            <span className="online-directory-kicker">{ui.animeOnline}</span>
          </div>

          <div className="online-directory-controls">
            <div className="online-directory-searchbar">
              <input
                ref={inputRef}
                className="online-directory-searchinput"
                placeholder={ui.searchPlaceholder}
                value={query}
                onChange={handleQueryChange}
                onKeyDown={handleKey}
                autoFocus
              />
              <button
                className="btn btn-primary online-directory-searchbtn"
                onClick={handleSearch}
                disabled={loading || !query.trim()}
              >
                {loading ? ui.searching : ui.searchButton}
              </button>
            </div>

            <div className="online-directory-meta">
              <div className="online-directory-upper">
                <div className="online-directory-badges">
                  {[
                    { id: 'jkanime-es',     label: 'JKAnime' },
                    { id: 'animeflv-es',    label: 'AnimeFLV' },
                  { id: 'animeav1-es',    label: 'AnimeAV1' },
                    { id: 'animepahe-en',   label: 'AnimePahe' },
                    { id: 'animeheaven-en', label: 'AnimeHeaven' },
                    { id: 'animegg-en',     label: 'AnimeGG' },
                  ].map(src => (
                    <button
                      key={src.id}
                      type="button"
                      className={`online-source-toggle${activeSource === src.id ? ' active' : ''}`}
                      style={activeSource === src.id ? {
                        background: `${SOURCE_META[src.id]?.color ?? '#f5a623'}33`,
                        borderColor: SOURCE_META[src.id]?.color ?? '#f5a623',
                        color: SOURCE_META[src.id]?.color ?? '#f5a623',
                      } : {}}
                      onClick={() => {
                        cancelPendingSearches()
                        setActiveSource(src.id)
                      }}
                    >
                      {src.label}
                    </button>
                  ))}
                </div>

                <div className="online-directory-actions">
                  <div className="online-directory-filter-group">
                    <span className="online-directory-sortlabel">{ui.order}</span>
                    <CustomSelect
                      value={catalogSort}
                      onChange={handleCatalogSort}
                      options={sortOptions}
                      placeholder={ui.order}
                    />
                  </div>

                  <div className="online-directory-filter-group">
                    <span className="online-directory-sortlabel">{ui.season}</span>
                    <CustomSelect
                      value={catalogSeason}
                      onChange={handleSeasonChange}
                      options={seasonOptions}
                      placeholder={ui.season}
                    />
                  </div>

                  <div className="online-directory-filter-group">
                    <span className="online-directory-sortlabel">{ui.year}</span>
                    <CustomSelect
                      value={catalogYear}
                      onChange={handleYearChange}
                      options={yearOptions}
                      placeholder={ui.year}
                    />
                  </div>
                </div>
              </div>

              <div className="online-directory-genrebar">
                <div className="online-directory-genrecopy">
                  <span className="online-directory-sortlabel">{ui.genres}</span>
                  <span className="online-directory-note">{ui.combineGenres}</span>
                </div>

                <div className="online-directory-genrepills">
                  {GENRES.map((genre) => {
                    const active = catalogGenres.includes(genre)
                    return (
                      <button
                        key={genre}
                        type="button"
                        className={`online-genre-pill${active ? ' active' : ''}`}
                        onClick={() => toggleGenre(genre)}
                      >
                        {GENRE_LABELS[genre]?.[appLang] ?? GENRE_LABELS[genre]?.es ?? genre}
                      </button>
                    )
                  })}
                </div>

                {hasCatalogFilters ? (
                  <button type="button" className="btn btn-ghost online-directory-clearbtn" onClick={clearCatalogFilters}>
                    {ui.clearFilters}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className="nipah-summary-strip online-summary-strip">
          {searchSummaryPills.map((pill) => <span key={pill} className="nipah-summary-pill">{pill}</span>)}
        </div>

        {loading ? (
          <section className="online-directory-results">
            <SectionHeader
              title={ui.foundResults}
              subtitle={ui.sourceSearching(SOURCE_META[activeSource]?.label ?? activeSource)}
            />
            <OnlinePosterSkeletonGrid count={8} />
          </section>
        ) : null}

        {(() => {
          const filtered = results.filter(r => r.source_id === activeSource)
          const displayed = filtered.length > 0 ? filtered : results
          return (
            <>
              {!loading && searched && displayed.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">{ui.noResults}</div>
                  <p className="empty-state-desc">
                    {ui.noResultsSource(query, SOURCE_META[activeSource]?.label ?? activeSource, results.length - filtered.length)}
                  </p>
                </div>
              ) : null}

              {!loading && searched && displayed.length > 0 ? (
                <section className="online-directory-results">
                  <SectionHeader
                    title={ui.foundResults}
                    subtitle={ui.readyToOpen(displayed.length)}
                  />
                  <VirtualMediaGrid
                    items={displayed}
                    listClassName="virtuoso-online-grid"
                    itemClassName="virtuoso-online-grid-item"
                    itemContent={(item, index) => (
                      <OnlinePosterCard
                        key={`${item.source_id}-${item.id}-${index}`}
                        cover={item.cover_url}
                        title={item.title}
                        meta={[SOURCE_META[item.source_id]?.label || item.source_id, item.year]
                          .filter(Boolean)
                          .map(value => <span key={`${item.id}-${value}`}>{value}</span>)}
                        badge={<SourceBadge sourceID={item.source_id} />}
                        noCoverLabel={ui.noCover}
                        onClick={() => openResolvedHit(item)}
                      />
                    )}
                  />
                </section>
              ) : null}
            </>
          )
        })()}

        {!searched && !loading ? (
          <section className="online-directory-results">
            <SectionHeader
              title={ui.exploreTitle}
              subtitle={catalogSummary}
            />

            {catalogLoading && displayedCatalog.length === 0 ? (
              <OnlinePosterSkeletonGrid count={12} />
            ) : !catalogLoading && displayedCatalog.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">{catalogAniListUnavailable ? ui.catalogUnavailableTitle : ui.noCatalog}</div>
                <p className="empty-state-desc">
                  {catalogAniListUnavailable ? ui.catalogUnavailableDesc : ui.noCatalogDesc}
                </p>
              </div>
            ) : (
              <VirtualMediaGrid
                items={displayedCatalog}
                listClassName="virtuoso-online-grid"
                itemClassName="virtuoso-online-grid-item"
                itemContent={(media) => {
                  const title = getCatalogTitle(media)
                  const key = `catalog-${media.id}`
                  return (
                    <OnlinePosterCard
                      key={key}
                      cover={media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium}
                      title={title}
                      meta={getCatalogMeta(media).map(value => <span key={`${media.id}-${value}`}>{value}</span>)}
                      badge={media?.status ? <span className="online-directory-status">{media.status.replace('_', ' ')}</span> : null}
                      busy={resolvingKey === key}
                      noCoverLabel={ui.noCover}
                      onClick={() => resolveAniListMedia(media, key)}
                    />
                  )
                }}
              />
            )}

            {!catalogLoading && isCatalogBrowseMode && catalogHasNext && catalog.length > 0 ? (
              <div className="online-directory-loadmore">
                <button
                  type="button"
                  className="btn btn-ghost online-directory-loadmore-btn"
                  onClick={handleLoadMore}
                  disabled={catalogFetchingMore}
                >
                  {catalogFetchingMore ? ui.searching : ui.loadMore}
                </button>
              </div>
            ) : null}

            {catalogLoading && displayedCatalog.length > 0 ? (
              <div className="online-directory-loadmore">
                <div className="skeleton-inline-row">
                  <span className="skeleton-inline-chip" />
                  <span className="skeleton-inline-chip short" />
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </div>
  )
}
