import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildMangaSourceOptions, getDefaultMangaSource, getMangaSourceMeta, MANGA_SOURCE_OPTIONS, normalizeMangaSourceID } from '../lib/mangaSources'
import {
  buildPreferredSourceSettingsPatch,
  cachePreferredSourcePreference,
  readCachedOnlineSourcePreference,
  resolveSavedOnlineSourcePreference,
} from '../lib/onlineSourcePreferences'
import { buildOrderedMangaSearchCandidates, normalizeCandidateList } from '../lib/mangaSearchCandidates'
import { createMangaSelectionSession } from '../lib/mangaSession'
import { getCachedMangaChapters, getMangaFallbackSearchCandidates, MANGA_SOURCE_FALLBACK_EARLY_EXIT_SCORE, pickBestMangaSourceSearchMatch } from '../lib/mangaSourceFallback'
import { buildMangaCatalogFetchArgs } from '../lib/catalogFilters'
import { isAniListUnavailableErrorMessage } from '../lib/anilistStatus'
import { getMangaReaderProgress, getMangaReaderProgressMap, getMostRecentIncompleteChapterID, markMangaReaderChaptersCompletedThrough } from '../lib/mangaReaderProgress'
import { useStableLoadingGate } from '../lib/useStableLoadingGate'
import { proxyImage, wails } from '../lib/wails'
import MangaReader from '../components/ui/MangaReader'
import OnlineMangaDetail from '../components/ui/OnlineMangaDetail'
import { toastError } from '../components/ui/Toast'
import VirtualMediaGrid from '../components/ui/VirtualMediaGrid'
import { useI18n } from '../lib/i18n'
import { perfEnd, perfMark, perfStart } from '../lib/perfTrace'
import Gui2OnlineCatalogSurface, { CatalogIcon, Gui2CatalogPaginationControls, PageArrowButton } from '../gui-v2/routes/catalog/Gui2OnlineCatalogSurface'

const LANG_OPTIONS = [{ value: 'es', label: 'Espanol' }, { value: 'en', label: 'English' }]
const GENRE_LABELS = {
  Action: { es: 'Accion', en: 'Action' }, Adventure: { es: 'Aventura', en: 'Adventure' }, Comedy: { es: 'Comedia', en: 'Comedy' },
  Drama: { es: 'Drama', en: 'Drama' }, Ecchi: { es: 'Ecchi', en: 'Ecchi' }, Fantasy: { es: 'Fantasia', en: 'Fantasy' },
  Horror: { es: 'Terror', en: 'Horror' }, 'Mahou Shoujo': { es: 'Mahou Shoujo', en: 'Mahou Shoujo' }, Mecha: { es: 'Mecha', en: 'Mecha' },
  Music: { es: 'Musica', en: 'Music' }, Mystery: { es: 'Misterio', en: 'Mystery' }, Psychological: { es: 'Psicologico', en: 'Psychological' },
  Romance: { es: 'Romance', en: 'Romance' }, 'Sci-Fi': { es: 'Ciencia ficcion', en: 'Sci-Fi' }, 'Slice of Life': { es: 'Vida cotidiana', en: 'Slice of Life' },
  Sports: { es: 'Deportes', en: 'Sports' }, Supernatural: { es: 'Sobrenatural', en: 'Supernatural' }, Thriller: { es: 'Suspenso', en: 'Thriller' },
}
const GENRES = Object.keys(GENRE_LABELS)
const CATALOG_PAGE_SIZE = 48
const MANGA_FORMAT_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'MANGA', label: 'Manga' },
  { value: 'ONE_SHOT', label: 'One Shot' },
  { value: 'NOVEL', label: 'Novel' },
]
const MANGA_STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'RELEASING', label: 'Publishing' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'NOT_YET_RELEASED', label: 'Upcoming' },
  { value: 'HIATUS', label: 'Hiatus' },
]

function getSortOptions(lang) {
  return [
    { value: 'TRENDING_DESC', label: lang === 'en' ? 'Trending' : 'Tendencia' },
    { value: 'POPULARITY_DESC', label: lang === 'en' ? 'Popularity' : 'Popularidad' },
    { value: 'SCORE_DESC', label: lang === 'en' ? 'Score' : 'Puntuacion' },
    { value: 'START_DATE_DESC', label: lang === 'en' ? 'Newest' : 'Mas recientes' },
  ]
}

function buildYearOptions(lang) {
  const currentYear = new Date().getFullYear()
  const years = [{ value: 0, label: lang === 'en' ? 'Year' : 'Ano' }]
  for (let year = currentYear + 1; year >= currentYear - 30; year -= 1) years.push({ value: year, label: String(year) })
  return years
}

function normalizeCanonicalItem(item, lang) {
  if (!item) return null
  const titleObj = item.title || {}
  const coverObj = item.coverImage || {}
  const startDate = item.start_date || item.startDate || {}
  const endDate = item.end_date || item.endDate || {}
  const title = item.canonical_title || item.title_english || titleObj.english || item.title_romaji || titleObj.romaji || item.title_native || titleObj.native || item.title || ''
  const coverURL = item.cover_url || item.resolved_cover_url || item.cover_large || coverObj.extraLarge || coverObj.large || item.cover_medium || coverObj.medium || ''
  const bannerURL = item.banner_url || item.resolved_banner_url || item.banner_image || item.bannerImage || ''
  const averageScore = Number(item.average_score || item.averageScore || 0)
  return {
    mode: 'canonical',
    id: Number(item.anilist_id || item.id || 0),
    anilist_id: Number(item.anilist_id || item.id || 0),
    mal_id: Number(item.mal_id || item.idMal || 0),
    title,
    canonical_title: title,
    canonical_title_english: item.title_english || titleObj.english || '',
    title_romaji: item.title_romaji || titleObj.romaji || '',
    title_native: item.title_native || titleObj.native || '',
    synonyms: item.synonyms || [],
    cover_url: coverURL,
    resolved_cover_url: coverURL,
    banner_url: bannerURL,
    resolved_banner_url: bannerURL,
    description: item.description || item.resolved_description || '',
    resolved_description: item.description || item.resolved_description || '',
    year: Number(item.year || item.resolved_year || startDate.year || 0),
    resolved_year: Number(item.year || item.resolved_year || startDate.year || 0),
    publication_year: Number(item.publication_year || item.year || item.resolved_year || startDate.year || 0),
    seasonYear: Number(item.season_year || item.seasonYear || item.year || item.resolved_year || startDate.year || 0),
    startDate,
    endDate,
    status: item.status || item.resolved_status || '',
    resolved_status: item.status || item.resolved_status || '',
    format: item.format || item.resolved_format || '',
    resolved_format: item.format || item.resolved_format || '',
    country_of_origin: item.country_of_origin || item.resolved_country_of_origin || item.countryOfOrigin || '',
    countryOfOrigin: item.country_of_origin || item.resolved_country_of_origin || item.countryOfOrigin || '',
    source: item.source || '',
    serialization: item.serialization || '',
    publisher: item.publisher || '',
    demographic: item.demographic || '',
    next_release_at: item.next_release_at || item.nextReleaseAt || '',
    genres: item.genres || [],
    characters: Array.isArray(item.characters) ? item.characters : [],
    average_score: averageScore,
    averageScore,
    popularity: Number(item.popularity || 0),
    in_manga_list: Boolean(item.in_manga_list),
    manga_list_status: item.manga_list_status || '',
    chapters_read: Number(item.chapters_read || 0),
    chapters_total: Number(item.chapters_total || item.chapters || 0),
    volumes_total: Number(item.volumes_total || item.volumes || 0),
    default_source_id: normalizeMangaSourceID(item.default_source_id || getDefaultMangaSource(lang)),
    search_candidates: normalizeCandidateList(item.search_candidates || []),
  }
}

function normalizeDirectItem(item, sourceID, lang) {
  const normalized = normalizeCanonicalItem(item, lang)
  return { ...normalized, mode: 'direct', direct_source_id: normalizeMangaSourceID(item.source_id || sourceID), direct_manga_id: item.id, direct_source_title: item.title || normalized.title }
}

function enrichChaptersWithProgress(chapters, sourceID, mangaID, chaptersReadFloor = 0) {
  const progressMap = getMangaReaderProgressMap(sourceID, mangaID, chapters)
  return (chapters ?? []).map((chapter) => ({
    ...chapter,
    progress_page: progressMap[chapter.id]?.progress_page ?? 0,
    total_pages: progressMap[chapter.id]?.total_pages ?? 0,
    completed: progressMap[chapter.id]?.completed ?? ((Number(chapter.number) || 0) > 0 && (Number(chapter.number) || 0) <= chaptersReadFloor),
  }))
}

function isTransientSearchMessage(message) {
  const normalized = String(message || '').toLowerCase()
  return normalized.includes('metadata request failed: 409') || normalized.includes('metadata request failed: 429')
}

function buildLocationSearchCandidates(state) {
  return normalizeCandidateList([
    ...(Array.isArray(state?.searchCandidates) ? state.searchCandidates : []),
    state?.preSearch,
    state?.altSearch,
  ])
}

function limitFastOpenCandidates(values) {
  return normalizeCandidateList(values).slice(0, 6)
}

function pickPrimarySearchTerm(values) {
  return normalizeCandidateList(Array.isArray(values) ? values : [values])[0] || ''
}

function SectionHeader({ title, subtitle, action = null }) {
  return <div className="online-section-header"><div className="online-section-heading"><h2 className="online-section-title">{title}</h2>{subtitle ? <p className="online-section-copy">{subtitle}</p> : null}</div>{action}</div>
}

function OnlinePosterSkeletonGrid({ count = 10 }) {
  return <div className="skeleton-poster-grid">{Array.from({ length: count }).map((_, index) => <div key={index} className="skeleton-poster-card"><div className="skeleton-block skeleton-poster-image" /><div className="skeleton-block skeleton-line skeleton-line-md" /><div className="skeleton-block skeleton-line skeleton-line-xs" /></div>)}</div>
}

function ChapterSkeletonGrid({ count = 8 }) {
  return <div className="manga-chapter-grid">{Array.from({ length: count }).map((_, index) => <div key={index} className="manga-chapter-card manga-chapter-card-skeleton"><div className="skeleton-block manga-chapter-skeleton-number" /><div className="manga-chapter-body"><div className="skeleton-block skeleton-line skeleton-line-xs" /><div className="skeleton-block skeleton-line skeleton-line-md" /><div className="skeleton-block skeleton-line skeleton-line-sm" /></div></div>)}</div>
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
    const handler = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  const selected = options.find((option) => option.value === value)
  const label = selected?.label ?? placeholder ?? ''
  return (
    <div className={`custom-select gui2-catalog-select${open ? ' open' : ''}`} ref={ref}>
      <button className="custom-select-trigger" onClick={() => setOpen((prev) => !prev)} type="button"><span>{label}</span><span className="custom-select-arrow"><ChevronDownIcon /></span></button>
      {open ? <div className="custom-select-dropdown">{options.map((option) => <div key={`${option.value}-${option.label}`} className={`custom-select-option${option.value === value ? ' selected' : ''}`} onClick={() => { onChange(option.value); setOpen(false) }}>{option.label}</div>)}</div> : null}
    </div>
  )
}

function GenreMultiSelect({ value, onToggle, options, placeholder, selectionLabel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const handler = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  return (
    <div className={`gui2-catalog-multi-select${open ? ' open' : ''}`} ref={ref}>
      <button className="custom-select-trigger gui2-catalog-multi-trigger" onClick={() => setOpen((prev) => !prev)} type="button"><span>{value.length > 0 ? selectionLabel : placeholder}</span><span className="custom-select-arrow"><ChevronDownIcon /></span></button>
      {value.length > 0 ? <div className="gui2-catalog-multi-values">{value.map((genre) => <button key={genre} type="button" className="gui2-catalog-multi-value" onClick={(event) => { event.stopPropagation(); onToggle(genre) }}><span>{genre}</span><span className="gui2-catalog-multi-remove" aria-hidden="true">×</span></button>)}</div> : null}
      {open ? <div className="gui2-catalog-multi-dropdown">{options.map((option) => { const active = value.includes(option.value); return <button key={option.value} type="button" className={`gui2-catalog-multi-option${active ? ' selected' : ''}`} onClick={() => onToggle(option.value)}><span>{option.label}</span><span className="gui2-catalog-multi-option-mark" aria-hidden="true">{active ? '✓' : ''}</span></button> })}</div> : null}
    </div>
  )
}

function OnlinePosterCard({ cover, title, meta, onClick, badge = null, busy = false, noCoverLabel = 'no cover' }) {
  return (
    <button type="button" className={`gui2-catalog-card${busy ? ' busy' : ''}`} onClick={onClick} disabled={busy} title={title}>
      {cover ? <img src={proxyImage(cover)} alt={title} className="gui2-catalog-card-cover" /> : <div className="gui2-catalog-card-cover gui2-catalog-card-cover-placeholder">{noCoverLabel}</div>}
      <div className="gui2-catalog-card-topline">{badge}</div>
      <div className="gui2-catalog-card-body"><div className="gui2-catalog-card-title">{title}</div>{meta?.length ? <div className="gui2-catalog-card-meta">{meta}</div> : null}</div>
    </button>
  )
}

function SourceCard({ item, active, busy, onClick, ui }) {
  const sourceMeta = getMangaSourceMeta(item.source_id)
  return <button className={`btn ${active ? 'btn-primary' : 'btn-ghost'}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }} onClick={onClick} disabled={busy}><span>{item.source_name || sourceMeta.label}</span><span className={`badge ${sourceMeta.badge}`} style={{ fontSize: 10 }}>{item.status === 'ready' ? ui.sourceReady : item.status === 'loading' ? ui.sourceLoading : item.status === 'not_found' || item.status === 'unresolved' || item.status === 'error' ? ui.sourceRetry : ui.sourceOpen}</span></button>
}

function getCatalogTitle(item) {
  return item.canonical_title || item.title_english || item.title_romaji || item.title_native || item.title || 'Manga'
}

function getCatalogMeta(item, isEnglish) {
  const parts = []
  if (item.year) parts.push(item.year)
  if (item.chapters_total > 0) parts.push(`${item.chapters_total} ${isEnglish ? 'chs' : 'caps'}`)
  if (item.average_score > 0) parts.push(`Score ${(item.average_score / 10).toFixed(1)}`)
  return parts
}

function flattenFallbackCatalog(homeCatalog) {
  const seen = new Set()
  const out = []
  for (const bucket of [homeCatalog?.featured, homeCatalog?.trending, homeCatalog?.popular, homeCatalog?.recent]) {
    for (const item of bucket ?? []) {
      const id = Number(item?.anilist_id || item?.id || 0)
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(item)
    }
  }
  return out
}

async function fetchCatalogPage({ sort, page, genres, year, lang, format, status }) {
  const request = buildMangaCatalogFetchArgs({ sort, page, genres, year, format, status })
  try {
    return await wails.discoverManga(request.genres, request.year, request.sort, request.status, request.format, request.page)
  } catch (error) {
    const canFallback = page === 1 && genres.length === 0 && !year && !format && !status && sort === 'TRENDING_DESC'
    if (!canFallback) throw error
    const fallback = await wails.getAniListMangaCatalogHome(lang)
    return {
      data: {
        Page: {
          media: flattenFallbackCatalog(fallback),
          pageInfo: { hasNextPage: false },
        },
      },
    }
  }
}

function normalizeCatalogItems(items, lang) {
  return (items ?? []).map((item) => normalizeCanonicalItem(item, lang)).filter(Boolean)
}

function buildSearchResultKey(item) {
  if (!item) return ''
  if (item.mode === 'direct') {
    return [
      'direct',
      normalizeMangaSourceID(item.direct_source_id || item.source_id || ''),
      String(item.direct_manga_id || item.id || ''),
    ].join(':')
  }
  const canonicalID = Number(item.anilist_id || item.id || 0)
  if (canonicalID > 0) return `canonical:${canonicalID}`
  return ['canonical', String(item.title || item.canonical_title || '').toLowerCase(), Number(item.year || item.resolved_year || 0)].join(':')
}

function dedupeSearchResults(items) {
  const seen = new Set()
  const out = []
  for (const item of items ?? []) {
    const key = buildSearchResultKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function pickPreferredCanonicalResult(items, preferredAniListID) {
  const preferredID = Number(preferredAniListID) || 0
  if (preferredID <= 0) return null
  return (items ?? []).find((item) => Number(item?.anilist_id || item?.id || 0) === preferredID) || null
}

function getSearchCandidatesForItem(item) {
  return getMangaFallbackSearchCandidates(item)
}

async function resolveCanonicalSourceSearchFallback(item, sourceID, lang, options = {}) {
  const needles = getSearchCandidatesForItem(item).slice(0, 6)
  if (!item || !sourceID || needles.length === 0) return null

  const pooledHits = []
  const seenHitKeys = new Set()
  const preferredYear = Number(item?.resolved_year || item?.year || 0)
  const excludedMangaIDs = new Set(
    (options?.excludeMangaIDs ?? [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )

  for (const candidate of needles) {
    let rawHits = []
    try {
      rawHits = await wails.searchMangaSource(sourceID, candidate, lang) ?? []
    } catch {
      continue
    }

    for (const rawHit of rawHits) {
      const normalized = normalizeDirectItem(rawHit, sourceID, lang)
      const sourceMangaID = String(normalized.direct_manga_id || normalized.id || '').trim()
      if (excludedMangaIDs.has(sourceMangaID)) continue
      const hitKey = `${normalized.direct_source_id || sourceID}:${normalized.direct_manga_id || normalized.id || ''}`
      if (!hitKey || seenHitKeys.has(hitKey)) continue
      seenHitKeys.add(hitKey)
      pooledHits.push(normalized)
    }

    const bestSoFar = pickBestMangaSourceSearchMatch(pooledHits, needles, preferredYear)
    if (bestSoFar?.score >= MANGA_SOURCE_FALLBACK_EARLY_EXIT_SCORE) {
      break
    }
  }

  const bestMatch = pickBestMangaSourceSearchMatch(pooledHits, needles, preferredYear)
  if (!bestMatch?.hit?.direct_manga_id) return null

  const chapters = await getCachedMangaChapters(
    sourceID,
    bestMatch.hit.direct_manga_id,
    lang,
    () => wails.getMangaChaptersSource(sourceID, bestMatch.hit.direct_manga_id, lang),
  )
  return {
    source: {
      source_id: sourceID,
      source_name: getMangaSourceMeta(sourceID).label,
      source_manga_id: bestMatch.hit.direct_manga_id,
      source_title: bestMatch.hit.direct_source_title || bestMatch.hit.title || item.title || '',
      matched_title: needles[0] || item.canonical_title || item.title || '',
      confidence: Math.min(1, bestMatch.score / 100),
      status: 'ready',
    },
    chapters: chapters ?? [],
  }
}

function isUsableMangaSourceResult(result) {
  if (!result?.source?.source_manga_id || result?.source?.status !== 'ready') return false
  const chapters = Array.isArray(result?.chapters) ? result.chapters : []
  return chapters.length > 0
}

export default function MangaSearch() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { lang: appLang } = useI18n()
  const isEnglish = appLang === 'en'
  const sortOptions = getSortOptions(appLang)
  const yearOptions = buildYearOptions(appLang)
  const ui = useMemo(() => ({
    mangaOnline: 'Manga',
    title: isEnglish ? 'Find something to read' : 'Encuentra algo para leer',
    searchPlaceholder: isEnglish ? 'Search manga by AniList title or alias...' : 'Busca manga por nombre o alias de AniList...',
    searchButton: isEnglish ? 'Search' : 'Buscar',
    searching: isEnglish ? 'Searching...' : 'Buscando...',
    sourceSearching: (name) => isEnglish ? `Searching on ${name}...` : `Buscando en ${name}...`,
    discoverSubtitle: '',
    noResults: isEnglish ? 'No results' : 'Sin resultados',
    noResultsDesc: (query) => isEnglish ? `Could not find "${query}" in the canonical manga catalog.` : `No se encontro "${query}" en el catalogo canonico de manga.`,
    noCover: isEnglish ? 'no cover' : 'sin portada',
    results: isEnglish ? 'Search results' : 'Resultados',
    resultsReady: (count) => isEnglish ? `${count} canonical result${count !== 1 ? 's' : ''}` : `${count} resultado${count !== 1 ? 's' : ''} canonico${count !== 1 ? 's' : ''}`,
    order: isEnglish ? 'Sort' : 'Orden',
    year: isEnglish ? 'Year' : 'Ano',
    genres: isEnglish ? 'Genres' : 'Generos',
    combineGenres: isEnglish ? 'You can combine multiple genres.' : 'Puedes combinar varios a la vez.',
    genreSelectionCount: (count) => isEnglish ? `${count} genre${count !== 1 ? 's' : ''} selected` : `${count} genero${count !== 1 ? 's' : ''} seleccionado${count !== 1 ? 's' : ''}`,
    clearFilters: isEnglish ? 'Clear filters' : 'Limpiar filtros',
    featured: 'Manga',
    postersLoaded: (count) => isEnglish ? `${count} poster${count !== 1 ? 's' : ''} loaded` : `${count} poster${count !== 1 ? 's' : ''} cargado${count !== 1 ? 's' : ''}`,
    filtersActive: isEnglish ? 'Active filters' : 'Filtros activos',
    directExplore: isEnglish ? 'Direct AniList browsing with source loading after opening' : 'Exploracion directa con AniList y carga de fuente al abrir',
    noCatalog: isEnglish ? 'No catalog available right now' : 'Sin catalogo por ahora',
    noCatalogDesc: isEnglish ? 'Could not load manga to explore. Adjust the filters or try again in a few seconds.' : 'No se pudieron cargar mangas para explorar. Ajusta los filtros o intenta de nuevo en unos segundos.',
    catalogUnavailableTitle: isEnglish ? 'AniList catalog temporarily unavailable' : 'Catalogo de AniList temporalmente no disponible',
    catalogUnavailableDesc: isEnglish
      ? 'AniList is having upstream API problems right now. Catalog browsing is temporarily unavailable, so source resolution will resume after AniList recovers.'
      : 'AniList esta teniendo problemas con su API en este momento. El catalogo esta temporalmente no disponible, asi que la resolucion de fuente volvera cuando AniList se recupere.',
    loadMore: isEnglish ? 'Load more' : 'Cargar mas',
    previousPage: isEnglish ? 'Previous page' : 'Pagina anterior',
    nextPage: isEnglish ? 'Next page' : 'Siguiente pagina',
    pageLabel: isEnglish ? 'Page' : 'Pagina',
    backToResults: isEnglish ? '<- Results' : '<- Resultados',
    myList: isEnglish ? 'My List' : 'Mi Lista',
    addToList: isEnglish ? '+ Add to My List' : '+ Agregar a Mi Lista',
    adding: isEnglish ? 'Adding...' : 'Agregando...',
    addSyncError: 'Some changes could not be synced and were queued for retry.',
    addError: isEnglish ? 'Could not add it to your list' : 'Error al agregar a tu lista',
    unknownError: isEnglish ? 'unknown error' : 'error desconocido',
    chapterError: isEnglish ? 'Error loading chapters' : 'Error al cargar capitulos',
    chapters: isEnglish ? 'Chapters' : 'Capitulos',
    startReading: isEnglish ? 'Select a chapter to start reading. Your progress is saved automatically.' : 'Selecciona un capitulo para comenzar a leer. Tu progreso se guarda automaticamente.',
    resolvingSource: isEnglish ? 'Resolving source...' : 'Resolviendo fuente...',
    loadingChapters: isEnglish ? 'Loading chapters...' : 'Cargando capitulos...',
    sourceTabsTitle: isEnglish ? 'Sources' : 'Fuentes',
    sourceReady: isEnglish ? 'Ready' : 'Lista',
    sourceRetry: isEnglish ? 'Retry' : 'Reintentar',
    sourceLoading: isEnglish ? 'Loading' : 'Cargando',
    sourceOpen: isEnglish ? 'Open' : 'Abrir',
    sourceHint: isEnglish ? 'The default source loads automatically. Switch only if it misses the manga.' : 'La fuente principal carga automaticamente. Cambia solo si falla.',
    sourceNotFound: isEnglish ? 'AniList found this manga, but the current source does not appear to carry it right now.' : 'AniList encontro este manga, pero la fuente actual no parece tenerlo disponible ahora mismo.',
    sourceUnresolved: isEnglish ? 'AniList metadata is temporarily unavailable, so source resolution could not be completed yet.' : 'AniList no esta respondiendo bien ahora mismo, asi que la resolucion de fuente no pudo completarse todavia.',
    sourceError: isEnglish ? 'This source failed to load right now.' : 'Esta fuente fallo al cargar por ahora.',
    noChapters: isEnglish ? 'No chapters' : 'Sin capitulos',
    noChaptersDesc: isEnglish ? 'This source resolved, but it does not currently expose chapters for this title.' : 'La fuente se resolvio, pero no expone capitulos para este titulo ahora mismo.',
    chaptersHydrating: isEnglish ? 'Showing chapters while the full list finishes loading...' : 'Mostrando capitulos mientras termina de cargar la lista completa...',
    unreadChapters: isEnglish ? 'Unread chapters' : 'Capitulos pendientes',
    allChapters: isEnglish ? 'All chapters' : 'Todos los capitulos',
    chapterFilterHint: isEnglish ? 'Focus on what is left to read or keep the full list visible.' : 'Muestra solo lo pendiente o deja visible el listado completo.',
    chapterFilterEmpty: isEnglish ? 'Everything here is already caught up.' : 'Aqui ya no te queda nada pendiente.',
    chapterFilterEmptyDesc: isEnglish ? 'Switch back to all chapters if you want to revisit earlier entries.' : 'Vuelve a todos los capitulos si quieres revisar entradas anteriores.',
    chapterSidebarTitle: isEnglish ? 'Cast' : 'Personajes',
    chapterSidebarCopy: isEnglish ? 'AniList character metadata for a quick refresher before you jump in.' : 'Metadatos de personajes desde AniList para ubicarse rapido antes de entrar.',
    chapterSidebarLoading: isEnglish ? 'Loading character metadata...' : 'Cargando personajes...',
    chapterSidebarEmpty: isEnglish ? 'No character metadata available for this title yet.' : 'Todavia no hay metadatos de personajes para este titulo.',
    supportingRole: isEnglish ? 'Supporting' : 'Secundario',
    mainRole: isEnglish ? 'Main' : 'Principal',
    offline: isEnglish ? 'You appear to be offline. Check your internet connection and try again.' : 'Sin conexion. Verifica tu internet e intenta de nuevo.',
    searchError: (msg) => isEnglish ? `Search error: ${msg}` : `Error al buscar: ${msg}`,
    catalogError: isEnglish ? 'Could not load Manga Online.' : 'No se pudo cargar Manga Online.',
    locked: isEnglish ? 'Locked' : 'Bloqueado',
    completed: isEnglish ? 'Completed' : 'Completado',
    read: isEnglish ? 'Read' : 'Leido',
    continue: isEnglish ? 'Continue' : 'Continuar',
    readNow: isEnglish ? 'Read' : 'Leer',
    coinLabel: (price) => isEnglish ? `${price} coins` : `${price} monedas`,
    statusWatching: 'WATCHING',
  }), [isEnglish])

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detailReturnMode, setDetailReturnMode] = useState('catalog')
  const [chapters, setChapters] = useState([])
  const [chapterFilter, setChapterFilter] = useState('all')
  const [reading, setReading] = useState(null)
  const initialSourceLang = appLang === 'en' ? 'en' : 'es'
  const [lang, setLang] = useState(() => initialSourceLang)
  const [sourceOptions, setSourceOptions] = useState(MANGA_SOURCE_OPTIONS)
  const [activeSourceID, setActiveSourceID] = useState(() => readCachedOnlineSourcePreference({
    mediaType: 'manga',
    lang: initialSourceLang,
    fallbackSourceID: getDefaultMangaSource(initialSourceLang),
    normalizeSourceID: normalizeMangaSourceID,
  }))
  const [sourceSettingsReady, setSourceSettingsReady] = useState(false)
  const [sourceStates, setSourceStates] = useState({})
  const [catalogPage, setCatalogPage] = useState(1)
  const [addingToList, setAddingToList] = useState(false)
  const [readerClosing, setReaderClosing] = useState(false)
  const [pendingAutoReadChapterID, setPendingAutoReadChapterID] = useState('')
  const [catalogSort, setCatalogSort] = useState('TRENDING_DESC')
  const [catalogGenres, setCatalogGenres] = useState([])
  const [catalogYear, setCatalogYear] = useState(0)
  const [catalogFormat, setCatalogFormat] = useState('')
  const [catalogStatus, setCatalogStatus] = useState('')
  const chaptersRef = useRef([])
  const inputRef = useRef(null)
  const navigationLoadRef = useRef(0)
  const searchLoadRef = useRef(0)
  const sessionCounterRef = useRef(0)
  const sessionPerfTokensRef = useRef({})
  const currentSessionKeyRef = useRef('')
  const hasPendingNavigationIntent = Boolean(
    location.state?.autoOpen ||
    location.state?.autoSearch ||
    location.state?.preSearch ||
    Number(location.state?.preferredAnilistID || 0) > 0 ||
    (Array.isArray(location.state?.searchCandidates) && location.state.searchCandidates.length > 0) ||
    (Array.isArray(location.state?.autoSearchCandidates) && location.state.autoSearchCandidates.length > 0)
  )
  const isCatalogBrowseMode = !selected && !searched && !loading && !hasPendingNavigationIntent

  const cancelPendingNavigationLoads = useCallback(() => {
    navigationLoadRef.current += 1
  }, [])

  const cancelPendingSearchLoads = useCallback(() => {
    searchLoadRef.current += 1
  }, [])

  const cancelPendingMangaLoads = useCallback(() => {
    cancelPendingNavigationLoads()
    cancelPendingSearchLoads()
  }, [cancelPendingNavigationLoads, cancelPendingSearchLoads])

  useEffect(() => {
    currentSessionKeyRef.current = selected?.sessionKey || ''
  }, [selected?.sessionKey])

  useEffect(() => {
    setLang(appLang === 'en' ? 'en' : 'es')
  }, [appLang])

  const defaultSourceID = readCachedOnlineSourcePreference({
    mediaType: 'manga',
    lang,
    fallbackSourceID: getDefaultMangaSource(lang),
    normalizeSourceID: normalizeMangaSourceID,
  })

  useEffect(() => {
    let cancelled = false
    setSourceSettingsReady(false)

    wails.getSettings()
      .then((settings) => {
        if (cancelled) return
        const preferredSourceID = resolveSavedOnlineSourcePreference({
          mediaType: 'manga',
          lang,
          settings,
          fallbackSourceID: defaultSourceID,
          normalizeSourceID: normalizeMangaSourceID,
        })
        setActiveSourceID(preferredSourceID)
        cachePreferredSourcePreference('manga', lang, preferredSourceID)
        setSourceSettingsReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setActiveSourceID(defaultSourceID)
        setSourceSettingsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [defaultSourceID, lang])

  const sourceOptionsQuery = useQuery({
    queryKey: ['manga-source-options'],
    queryFn: async () => buildMangaSourceOptions(await wails.listExtensions()),
    initialData: MANGA_SOURCE_OPTIONS,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  })

  useEffect(() => {
    if (sourceOptionsQuery.data?.length) setSourceOptions(sourceOptionsQuery.data)
  }, [sourceOptionsQuery.data])

  const languageSources = useMemo(() => {
    const filtered = sourceOptions.filter((item) => item.languages.includes(lang))
    return filtered.length > 0 ? filtered : MANGA_SOURCE_OPTIONS.filter((item) => item.languages.includes(lang))
  }, [lang, sourceOptions])

  useEffect(() => {
    if (!languageSources.length) return
    if (languageSources.some((item) => item.value === activeSourceID)) return
    setActiveSourceID(defaultSourceID)
  }, [activeSourceID, defaultSourceID, languageSources])

  const persistMangaSourcePreference = useCallback(async (nextSourceID, targetLang = lang) => {
    const normalizedSourceID = normalizeMangaSourceID(nextSourceID)
    if (!normalizedSourceID) return

    setActiveSourceID(normalizedSourceID)
    cachePreferredSourcePreference('manga', targetLang, normalizedSourceID)
    await wails.saveSettings(
      buildPreferredSourceSettingsPatch('manga', targetLang, normalizedSourceID),
    ).catch(() => {})
  }, [lang])

  const cancelActiveSourceQueries = useCallback((sessionKey = '') => {
    const queryKey = sessionKey
      ? ['manga-active-source', sessionKey]
      : ['manga-active-source']
    queryClient.cancelQueries({ queryKey }).catch(() => {})
  }, [queryClient])

  const clearSelectedSession = useCallback((sessionKey = '') => {
    const targetSessionKey = sessionKey || currentSessionKeyRef.current
    cancelActiveSourceQueries(targetSessionKey)
    setChapters([])
    setPendingAutoReadChapterID('')
    const perfToken = sessionPerfTokensRef.current[targetSessionKey]
    if (perfToken) {
      perfEnd(perfToken, 'cancelled')
      delete sessionPerfTokensRef.current[targetSessionKey]
    }
    if (!targetSessionKey) return
    setSourceStates((prev) => {
      if (!prev[targetSessionKey]) return prev
      const next = { ...prev }
      delete next[targetSessionKey]
      return next
    })
  }, [cancelActiveSourceQueries])

  const resetToCatalogState = useCallback(() => {
    cancelPendingNavigationLoads()
    cancelPendingMangaLoads()
    clearSelectedSession()
    setSelected(null)
    setChapters([])
    setResults([])
    setSearched(false)
    setLoading(false)
    setQuery('')
    setPendingAutoReadChapterID('')
  }, [cancelPendingMangaLoads, cancelPendingNavigationLoads, clearSelectedSession])

  useEffect(() => () => {
    cancelActiveSourceQueries()
  }, [cancelActiveSourceQueries])

  const hasCatalogFilters = catalogGenres.length > 0 || Boolean(catalogYear) || Boolean(catalogFormat) || Boolean(catalogStatus)

  useEffect(() => {
    setCatalogPage(1)
  }, [catalogFormat, catalogGenres, catalogSort, catalogStatus, catalogYear, lang])

  const catalogQuery = useQuery({
    queryKey: ['manga-catalog', lang, catalogSort, catalogGenres.join(','), catalogYear, catalogPage, catalogFormat, catalogStatus],
    queryFn: async () => {
      const res = await fetchCatalogPage({ sort: catalogSort, page: catalogPage, genres: catalogGenres, year: catalogYear, lang, format: catalogFormat, status: catalogStatus })
      const pageData = res?.data?.Page
      const media = normalizeCatalogItems(pageData?.media ?? [], lang)
      if (catalogPage === 1 && catalogGenres.length === 0 && !catalogYear && !catalogFormat && !catalogStatus && media.length === 0) {
        const fallback = await wails.getAniListMangaCatalogHome(lang)
        const fallbackMedia = normalizeCatalogItems(flattenFallbackCatalog(fallback), lang)
        return {
          media: fallbackMedia,
          hasNextPage: fallbackMedia.length >= CATALOG_PAGE_SIZE,
          page: catalogPage,
        }
      }
      return {
        media,
        hasNextPage: pageData?.pageInfo?.hasNextPage ?? false,
        page: catalogPage,
      }
    },
    staleTime: 20 * 60_000,
    gcTime: 45 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: isCatalogBrowseMode,
  })

  const catalogAniListUnavailable = isAniListUnavailableErrorMessage(catalogQuery.error)

  useEffect(() => {
    if (catalogQuery.error && !catalogAniListUnavailable) toastError(ui.catalogError)
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

  const sourceMatchesQuery = useQuery({
    queryKey: ['manga-source-matches', selected?.sessionKey ?? '', selected?.mode ?? '', selected?.anilist_id ?? 0, lang],
    queryFn: async () => {
      if (!selected?.anilist_id) return []
      return wails.getMangaSourceMatches(selected.anilist_id, lang)
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(selected?.mode === 'canonical' && selected?.anilist_id > 0),
  })

  const selectedMangaDetailQuery = useQuery({
    queryKey: ['manga-detail-anilist', selected?.anilist_id ?? 0, lang],
    queryFn: async () => {
      if (!selected?.anilist_id) return null
      return normalizeCanonicalItem(await wails.getAniListMangaByID(selected.anilist_id), lang)
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    enabled: Boolean(selected?.anilist_id > 0),
  })

  useEffect(() => { chaptersRef.current = chapters }, [chapters])

  useEffect(() => {
    const sessionKey = selected?.sessionKey || ''
    if (!sessionKey || !selected || selected.mode !== 'canonical' || !sourceMatchesQuery.data?.length) return
    setSourceStates((prev) => {
      const sessionState = { ...(prev[sessionKey] || {}) }
      for (const item of sourceMatchesQuery.data) {
        if (!item?.source_id) continue
        sessionState[item.source_id] = {
          ...sessionState[item.source_id],
          ...item,
          status: sessionState[item.source_id]?.status === 'loading' ? 'loading' : (item.status || sessionState[item.source_id]?.status || 'idle'),
        }
      }
      return { ...prev, [sessionKey]: sessionState }
    })
  }, [selected, sourceMatchesQuery.data])

  useEffect(() => {
    if (!selected || selected.mode !== 'canonical') return
    setActiveSourceID(normalizeMangaSourceID(selected.sessionPreferredSourceID || defaultSourceID))
  }, [defaultSourceID, selected?.sessionKey, selected?.mode, selected?.sessionPreferredSourceID])

  useEffect(() => {
    setChapterFilter('all')
  }, [selected?.sessionKey])

  const selectedSessionKey = selected?.sessionKey || ''
  const currentSourceStates = useMemo(() => (
    selectedSessionKey ? (sourceStates[selectedSessionKey] || {}) : {}
  ), [selectedSessionKey, sourceStates])

  const activeSourceQuery = useQuery({
    queryKey: ['manga-active-source', selectedSessionKey, activeSourceID, lang],
    enabled: Boolean(selected) && Boolean(activeSourceID),
    queryFn: async () => {
      if (!selected) return { selection_key: selectedSessionKey, source: null, chapters: [] }
      if (selected.mode === 'direct') {
        const sourceID = normalizeMangaSourceID(selected.direct_source_id || activeSourceID || getDefaultMangaSource(lang))
        const loaded = await getCachedMangaChapters(
          sourceID,
          selected.direct_manga_id,
          lang,
          () => wails.getMangaChaptersSource(sourceID, selected.direct_manga_id, lang),
        )
        return {
          selection_key: selectedSessionKey,
          source: { source_id: sourceID, source_name: getMangaSourceMeta(sourceID).label, source_manga_id: selected.direct_manga_id, source_title: selected.direct_source_title || selected.title, status: 'ready', confidence: 1 },
          chapters: loaded ?? [],
        }
      }
      const canonicalPromise = (async () => {
        const resolved = await wails.getMangaChaptersForAniListSource(activeSourceID, selected.anilist_id, lang)
        const resolvedChapterCount = Array.isArray(resolved?.chapters) ? resolved.chapters.length : 0
        const normalizedSourceID = normalizeMangaSourceID(resolved?.source?.source_id || activeSourceID)
        const sourceMangaID = resolved?.source?.source_manga_id

        if (resolved?.source?.status === 'ready' && sourceMangaID && resolvedChapterCount === 0) {
          const hydratedChapters = await getCachedMangaChapters(
            normalizedSourceID,
            sourceMangaID,
            lang,
            () => wails.getMangaChaptersSource(normalizedSourceID, sourceMangaID, lang),
          )
          if (hydratedChapters.length > 0) {
            return {
              selection_key: selectedSessionKey,
              ...resolved,
              chapters: hydratedChapters,
              source: {
                ...resolved.source,
                source_id: normalizedSourceID,
                status: 'ready',
              },
            }
          }
        }

        return { selection_key: selectedSessionKey, ...resolved }
      })()

      const canonicalResolved = await canonicalPromise.catch((error) => ({ error }))
      if (canonicalResolved && !canonicalResolved.error && isUsableMangaSourceResult(canonicalResolved)) {
        return canonicalResolved
      }

      const excludedMangaIDs = canonicalResolved?.source?.source_manga_id
        && Array.isArray(canonicalResolved?.chapters)
        && canonicalResolved.chapters.length === 0
        ? [canonicalResolved.source.source_manga_id]
        : []

      const fallbackResolved = await resolveCanonicalSourceSearchFallback(selected, activeSourceID, lang, { excludeMangaIDs: excludedMangaIDs })
        .then((resolved) => (resolved ? { selection_key: selectedSessionKey, ...resolved } : null))
        .catch(() => null)

      if (fallbackResolved && isUsableMangaSourceResult(fallbackResolved)) {
        return fallbackResolved
      }
      if (canonicalResolved && !canonicalResolved.error && canonicalResolved?.source?.source_manga_id) {
        return canonicalResolved
      }
      if (fallbackResolved?.source?.source_manga_id) {
        return fallbackResolved
      }
      if (canonicalResolved?.error) {
        throw canonicalResolved.error
      }
      throw new Error('failed to resolve manga source')
    },
    staleTime: 0,
    gcTime: 2 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  })

  useEffect(() => {
    const sessionKey = selected?.sessionKey || ''
    if (!sessionKey || !selected || !activeSourceID || !activeSourceQuery.isFetching) return
    setSourceStates((prev) => ({
      ...prev,
      [sessionKey]: {
        ...(prev[sessionKey] || {}),
        [activeSourceID]: {
          ...((prev[sessionKey] || {})[activeSourceID] || {}),
          source_id: activeSourceID,
          source_name: getMangaSourceMeta(activeSourceID).label,
          status: 'loading',
        },
      },
    }))
  }, [activeSourceID, activeSourceQuery.isFetching, selected])

  useEffect(() => {
    const sessionKey = selected?.sessionKey || ''
    const sourceInfo = activeSourceQuery.data?.source
    if (!sessionKey || activeSourceQuery.data?.selection_key !== sessionKey) return
    if (!sourceInfo?.source_id) return
    const nextStatus = sourceInfo.status || 'ready'
    setSourceStates((prev) => ({
      ...prev,
      [sessionKey]: {
        ...(prev[sessionKey] || {}),
        [sourceInfo.source_id]: { ...sourceInfo, status: nextStatus },
      },
    }))
    const perfToken = sessionPerfTokensRef.current[sessionKey]
    if (perfToken) {
      perfMark(perfToken, 'source-matched', {
        source_id: sourceInfo.source_id,
        source_manga_id: sourceInfo.source_manga_id || '',
        status: nextStatus,
      })
    }
  }, [activeSourceQuery.data, selected?.sessionKey])

  useEffect(() => {
    const sessionKey = selected?.sessionKey || ''
    if (!sessionKey || !selected || !activeSourceID || !activeSourceQuery.error) return
    setSourceStates((prev) => ({
      ...prev,
      [sessionKey]: {
        ...(prev[sessionKey] || {}),
        [activeSourceID]: {
          ...((prev[sessionKey] || {})[activeSourceID] || {}),
          source_id: activeSourceID,
          source_name: getMangaSourceMeta(activeSourceID).label,
          status: 'error',
        },
      },
    }))
  }, [activeSourceID, activeSourceQuery.error, selected])

  useEffect(() => {
    if (activeSourceQuery.data?.selection_key && activeSourceQuery.data.selection_key !== selectedSessionKey) return
    if (!selected || !activeSourceQuery.data) return
    const sourceInfo = activeSourceQuery.data.source
    if (!sourceInfo || sourceInfo.status !== 'ready' || !sourceInfo.source_manga_id) return setChapters([])
    const enrichedChapters = enrichChaptersWithProgress(activeSourceQuery.data.chapters ?? [], sourceInfo.source_id, sourceInfo.source_manga_id, Number(selected.chapters_read) || 0)
    setChapters(enrichedChapters)
    if (enrichedChapters.length > 0) {
      const perfToken = sessionPerfTokensRef.current[selectedSessionKey]
      if (perfToken) {
        perfEnd(perfToken, 'chapters-ready', {
          source_id: sourceInfo.source_id,
          chapters: enrichedChapters.length,
        })
        delete sessionPerfTokensRef.current[selectedSessionKey]
      }
    }
  }, [activeSourceQuery.data, selected, selectedSessionKey])

  useEffect(() => {
    if (!activeSourceQuery.error) return
    toastError(`${ui.chapterError}: ${activeSourceQuery.error?.message ?? ui.unknownError}`)
  }, [activeSourceQuery.error, ui.chapterError, ui.unknownError])

  const activeSourceMatch = useMemo(() => {
    if (!selected) return null
    if (selected.mode === 'direct') return { source_id: normalizeMangaSourceID(selected.direct_source_id || activeSourceID), source_name: getMangaSourceMeta(normalizeMangaSourceID(selected.direct_source_id || activeSourceID)).label, source_manga_id: selected.direct_manga_id, source_title: selected.direct_source_title || selected.title, status: 'ready' }
    return currentSourceStates[activeSourceID] || { source_id: activeSourceID, source_name: getMangaSourceMeta(activeSourceID).label, status: 'idle' }
  }, [activeSourceID, currentSourceStates, selected])

  const sourceIsHydrating = false
  const sourceIsLoading = Boolean(selected) && !sourceIsHydrating && (activeSourceQuery.isLoading || activeSourceQuery.isFetching || activeSourceMatch?.status === 'loading')
  const canShowChapters = chapters.length > 0 && (activeSourceMatch?.status === 'ready' || sourceIsHydrating)

  const chapterSectionCopy = useMemo(() => {
    if (sourceIsHydrating && chapters.length > 0) return ui.chaptersHydrating
    if (sourceIsLoading) return selected?.mode === 'canonical' ? ui.resolvingSource : ui.loadingChapters
    if (selected?.mode === 'canonical' && !activeSourceMatch?.source_manga_id) return ui.sourceHint
    return ui.startReading
  }, [activeSourceMatch?.source_manga_id, chapters.length, selected?.mode, sourceIsHydrating, sourceIsLoading, ui.chaptersHydrating, ui.loadingChapters, ui.resolvingSource, ui.sourceHint, ui.startReading])

  const sourceCards = useMemo(() => {
    if (!selected) return []
    if (selected.mode === 'direct') return [activeSourceMatch].filter(Boolean)
    return languageSources.map((item) => ({ source_id: item.value, source_name: item.label, status: currentSourceStates[item.value]?.status || 'idle', source_manga_id: currentSourceStates[item.value]?.source_manga_id || '' }))
  }, [activeSourceMatch, currentSourceStates, languageSources, selected])

  const resolveReadingContext = useCallback(() => {
    if (!selected) return null
    if (selected.mode === 'direct') return { sourceID: normalizeMangaSourceID(selected.direct_source_id || activeSourceID), mangaID: selected.direct_manga_id, title: selected.direct_source_title || selected.title }
    if (!activeSourceMatch?.source_manga_id) return null
    return { sourceID: activeSourceMatch.source_id, mangaID: activeSourceMatch.source_manga_id, title: activeSourceMatch.source_title || selected.title }
  }, [activeSourceID, activeSourceMatch, selected])

  const openReader = useCallback((chapter, chapterList = null, resolvedSource = null) => {
    if (!selected || !chapter || chapter.locked) return
    const sourceContext = resolvedSource || resolveReadingContext()
    if (!sourceContext?.sourceID || !sourceContext?.mangaID) return
    const srcID = sourceContext.sourceID
    const sourceMangaID = sourceContext.mangaID
    const resolvedChapterList = chapterList ?? chaptersRef.current
    const chapterNumber = Number(chapter.number) || 0
    const completedThrough = Math.max(chapterNumber - 1, 0)
    if (completedThrough > 0) {
      markMangaReaderChaptersCompletedThrough(srcID, sourceMangaID, resolvedChapterList, completedThrough)
      setChapters((prev) => enrichChaptersWithProgress(prev, srcID, sourceMangaID, Math.max(Number(selected?.chapters_read) || 0, completedThrough)))
      if (selected?.anilist_id > 0 && completedThrough > (Number(selected?.chapters_read) || 0)) {
        wails.updateMangaListProgress(selected.anilist_id, completedThrough).catch(() => {})
        setSelected((prev) => prev ? ({ ...prev, chapters_read: Math.max(Number(prev.chapters_read) || 0, completedThrough) }) : prev)
      }
    }
    wails.recordMangaRead(srcID, sourceMangaID, selected.canonical_title || selected.title, selected.resolved_cover_url || selected.cover_url || '', chapter.id, chapter.number ?? 0, chapter.title ?? `${isEnglish ? 'Chapter' : 'Capitulo'} ${chapter.number}`).catch(() => {})
    setReading({ chapterID: chapter.id, chapterNumber: chapter.number ?? 0, title: `${selected.title} · ${isEnglish ? 'Ch.' : 'Cap.'} ${chapter.number}`, sourceID: srcID, mangaID: sourceMangaID, chapters: resolvedChapterList })
  }, [isEnglish, resolveReadingContext, selected])

  const openReaderRef = useRef(openReader)
  useEffect(() => { openReaderRef.current = openReader }, [openReader])

  const getSearchCandidatesForItemMemo = useCallback((item) => getSearchCandidatesForItem(item), [])

  const handleProgressChange = useCallback(({ chapterID, progressPage, totalPages, completed }) => {
    setChapters((prev) => {
      let changed = false
      const next = prev.map((chapter) => {
        if (chapter.id !== chapterID) return chapter
        const nextCompleted = completed ?? chapter.completed ?? false
        if (chapter.progress_page === progressPage && chapter.total_pages === totalPages && chapter.completed === nextCompleted) return chapter
        changed = true
        return { ...chapter, progress_page: progressPage, total_pages: totalPages, completed: nextCompleted }
      })
      return changed ? next : prev
    })
  }, [])

  const runGlobalSearch = useCallback(async (searchValue, options = {}) => {
    const preferredAniListID = Number(options?.preferredAniListID || 0)
    const term = pickPrimarySearchTerm(searchValue)
    if (!term) return []
    if (!options?.preserveNavigationLoad) {
      cancelPendingNavigationLoads()
    }
    const requestID = searchLoadRef.current + 1
    searchLoadRef.current = requestID
    clearSelectedSession()
    setLoading(true); setSearched(false); setSelected(null); setChapters([])
    try {
      const found = dedupeSearchResults(
        ((await wails.searchMangaGlobal(term, lang) ?? [])
          .map((item) => normalizeCanonicalItem(item, lang))
          .filter(Boolean)),
      ).slice(0, 12)
      if (requestID !== searchLoadRef.current) return []
      setQuery(term)
      setResults(found)
      return found
    } catch (e) {
      if (requestID !== searchLoadRef.current) return []
      setResults([])
      const msg = e?.message ?? String(e)
      if (!isTransientSearchMessage(msg)) {
        toastError(msg.includes('network') || msg.includes('timeout') || msg.includes('fetch') ? ui.offline : ui.searchError(msg))
      }
      return []
    } finally {
      if (requestID === searchLoadRef.current) {
        setLoading(false); setSearched(true)
      }
    }
  }, [cancelPendingNavigationLoads, clearSelectedSession, lang, ui.offline, ui.searchError])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    return runGlobalSearch(query)
  }, [query, runGlobalSearch])

  const handleQueryChange = useCallback((event) => {
    const nextQuery = event.target.value
    setQuery(nextQuery)
    if (!nextQuery.trim()) {
      cancelPendingSearchLoads()
      setLoading(false)
      setResults([])
      setSearched(false)
    }
  }, [cancelPendingSearchLoads])

  const handleKey = useCallback((event) => { if (event.key === 'Enter') handleSearch() }, [handleSearch])
  const handleLanguageChange = useCallback((nextLang) => {
    const normalizedLang = nextLang === 'en' ? 'en' : 'es'
    if (normalizedLang === lang) return
    setLang(normalizedLang)
  }, [lang])
  const handleSearchSourceChange = useCallback((nextSourceID) => {
    const normalizedSourceID = normalizeMangaSourceID(nextSourceID)
    if (!normalizedSourceID || normalizedSourceID === activeSourceID) return
    void persistMangaSourcePreference(normalizedSourceID)
  }, [activeSourceID, persistMangaSourcePreference])
  const openSelectedItem = useCallback((item, options = {}) => {
    if (!item) return null
    if (!options?.preserveNavigationLoad) {
      cancelPendingMangaLoads()
    }
    clearSelectedSession()
    const nextReturnMode = options.returnMode ?? 'results'
    const nextSession = createMangaSelectionSession(item, ++sessionCounterRef.current, lang)
    const perfToken = perfStart('manga-session', nextSession.sessionKey, {
      mode: nextSession.mode,
      anilist_id: Number(nextSession.anilist_id || 0),
      source_id: nextSession.direct_source_id || nextSession.sessionPreferredSourceID || '',
      lang,
    })
    sessionPerfTokensRef.current[nextSession.sessionKey] = perfToken
    perfMark(perfToken, 'session-opened', {
      mode: nextSession.mode,
      anilist_id: Number(nextSession.anilist_id || 0),
    })
    setDetailReturnMode(nextReturnMode)
    setSelected(nextSession)
    setLoading(false)
    if (nextReturnMode === 'catalog') {
      setResults([])
      setSearched(false)
    }
    setActiveSourceID(normalizeMangaSourceID(nextSession.sessionPreferredSourceID || defaultSourceID))
    setPendingAutoReadChapterID(options.pendingAutoReadChapterID || '')
    return nextSession
  }, [cancelPendingMangaLoads, clearSelectedSession, defaultSourceID, lang])

  const openCanonicalItem = useCallback((item, options = {}) => {
    if (!item) return null
    const aniListID = Number(item?.anilist_id || item?.id || 0)
    if (aniListID > 0) {
      void wails.getAniListMangaByID(aniListID).catch(() => {})
    }
    return openSelectedItem(
      {
        ...item,
        default_source_id: normalizeMangaSourceID(options.preferredSourceID || activeSourceID || item.default_source_id || defaultSourceID),
      },
      { ...options, pendingAutoReadChapterID: '', returnMode: options.returnMode ?? 'catalog' },
    )
  }, [activeSourceID, defaultSourceID, openSelectedItem])
  const selectActiveSource = useCallback((nextSourceID) => {
    const normalizedSourceID = normalizeMangaSourceID(nextSourceID)
    if (!normalizedSourceID || normalizedSourceID === activeSourceID) return
    cancelActiveSourceQueries(currentSessionKeyRef.current)
    setChapters([])
    void persistMangaSourcePreference(normalizedSourceID)
  }, [activeSourceID, cancelActiveSourceQueries, persistMangaSourcePreference])
  useEffect(() => {
    if (!location.state?.autoOpen) return
    const item = location.state.autoOpen
    const src = normalizeMangaSourceID(item.source_id)
    openSelectedItem(
      normalizeDirectItem({ id: item.id, title: item.title, cover_url: item.cover_url, resolved_cover_url: item.resolved_cover_url, resolved_banner_url: item.resolved_banner_url, resolved_description: item.resolved_description, canonical_title: item.canonical_title, canonical_title_english: item.canonical_title_english, anilist_id: item.anilist_id, mal_id: item.mal_id, in_manga_list: item.in_manga_list, manga_list_status: item.manga_list_status, chapters_read: item.chapters_read, year: item.year, resolved_year: item.resolved_year, source_id: src }, src, lang),
      { pendingAutoReadChapterID: location.state.autoReadChapterID ?? '', returnMode: 'catalog' },
    )
    navigate(location.pathname, { replace: true, state: null })
  }, [lang, location.pathname, location.state, navigate, openSelectedItem])

  useEffect(() => {
    if (!location.state?.autoSearch) return
    const initialCandidates = normalizeCandidateList([
      ...(Array.isArray(location.state.autoSearchCandidates) ? location.state.autoSearchCandidates : []),
      location.state.autoSearch,
    ])
    const initialQuery = initialCandidates[0] || ''
    if (!initialQuery) return
    cancelPendingMangaLoads()
    clearSelectedSession()
    setQuery(initialQuery)
    void runGlobalSearch(initialCandidates, { preserveNavigationLoad: true })
    navigate(location.pathname, { replace: true, state: null })
  }, [cancelPendingMangaLoads, clearSelectedSession, location.pathname, location.state, navigate, runGlobalSearch])

  useEffect(() => {
    const navigationState = location.state
    if (!navigationState?.preSearch && !navigationState?.preferredAnilistID && !navigationState?.searchCandidates) return
    if (!sourceSettingsReady) return
    const initialCandidates = limitFastOpenCandidates(buildLocationSearchCandidates(navigationState))
    const initialQuery = initialCandidates[0] || ''
    const preferredAniListID = Number(navigationState.preferredAnilistID || 0)
    const seededCanonical = navigationState?.seedItem
      ? normalizeCanonicalItem({ ...navigationState.seedItem, anilist_id: preferredAniListID || Number(navigationState?.seedItem?.anilist_id || 0) }, lang)
      : null
    if (!initialQuery && preferredAniListID <= 0) return
    cancelPendingSearchLoads()
    const requestID = navigationLoadRef.current + 1
    navigationLoadRef.current = requestID
    const isCurrentRequest = () => navigationLoadRef.current === requestID
    clearSelectedSession()
    setQuery(initialQuery); setResults([]); setSearched(false); setLoading(false)
    navigate(location.pathname, { replace: true, state: null })
    const loadPreferred = async () => {
      if (preferredAniListID > 0 && seededCanonical && isCurrentRequest()) {
        openCanonicalItem(seededCanonical, { preserveNavigationLoad: true, returnMode: 'catalog' })
        return
      }
      if (preferredAniListID > 0) {
        try {
          const normalized = normalizeCanonicalItem(await wails.getAniListMangaByID(preferredAniListID), lang)
          if (normalized && isCurrentRequest()) {
            return openCanonicalItem(normalized, { preserveNavigationLoad: true, returnMode: 'catalog' })
          }
        } catch {}
      }
      if (initialCandidates.length > 0 && isCurrentRequest()) {
        const found = await runGlobalSearch(initialCandidates, { preferredAniListID, preserveNavigationLoad: true })
        if (!isCurrentRequest()) return
        const preferredMatch = pickPreferredCanonicalResult(found, preferredAniListID)
        if (preferredMatch) openCanonicalItem(preferredMatch, { preserveNavigationLoad: true, returnMode: 'catalog' })
      }
    }
    void loadPreferred()
  }, [cancelPendingSearchLoads, clearSelectedSession, lang, location.pathname, location.state, navigate, openCanonicalItem, runGlobalSearch, sourceSettingsReady])

  const handleBackFromSelected = useCallback(() => {
    cancelPendingMangaLoads()
    clearSelectedSession()
    setSelected(null)
    if (detailReturnMode === 'catalog') {
      resetToCatalogState()
    }
  }, [cancelPendingMangaLoads, clearSelectedSession, detailReturnMode, resetToCatalogState])

  useEffect(() => {
    if (!pendingAutoReadChapterID || chapters.length === 0) return
    const sourceContext = resolveReadingContext()
    if (!sourceContext) return
    const autoChapter = chapters.find((chapter) => chapter.id === pendingAutoReadChapterID)
    if (!autoChapter) return
    setPendingAutoReadChapterID('')
    openReaderRef.current?.(autoChapter, chapters, sourceContext)
  }, [chapters, pendingAutoReadChapterID, resolveReadingContext])

  const handleAddToMangaList = useCallback(async () => {
    if (!selected?.anilist_id || addingToList) return
    setAddingToList(true)
    try {
      const result = await wails.addToMangaList(selected.anilist_id, Number(selected.mal_id) || 0, selected.canonical_title || selected.title || '', selected.canonical_title_english || '', selected.resolved_cover_url || selected.cover_url || '', selected.resolved_banner_url || '', 'WATCHING', 0, Number(selected.chapters_total) || 0, 0, Number(selected.volumes_total) || 0, 0, Number(selected.resolved_year) || Number(selected.year) || 0)
      if (result?.remote_failed > 0) toastError(result.messages?.join(' ') || ui.addSyncError)
      setSelected((prev) => prev ? ({ ...prev, in_manga_list: true, manga_list_status: 'WATCHING' }) : prev)
    } catch (e) {
      toastError(`${ui.addError}: ${e?.message ?? ui.unknownError}`)
    } finally {
      setAddingToList(false)
    }
  }, [addingToList, selected, ui.addError, ui.addSyncError, ui.unknownError])

  const handleCatalogSort = useCallback((value) => setCatalogSort(value), [])
  const handleYearChange = useCallback((value) => setCatalogYear(Number(value) || 0), [])
  const handleFormatChange = useCallback((value) => setCatalogFormat(value), [])
  const handleStatusChange = useCallback((value) => setCatalogStatus(value), [])
  const toggleGenre = useCallback((genre) => setCatalogGenres((current) => current.includes(genre) ? current.filter((item) => item !== genre) : [...current, genre]), [])
  const clearCatalogFilters = useCallback(() => { setCatalogGenres([]); setCatalogYear(0); setCatalogFormat(''); setCatalogStatus(''); setCatalogSort('TRENDING_DESC') }, [])
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
  const catalogSummary = [`${ui.pageLabel} ${catalogPage}`, `${displayedCatalog.length}/${CATALOG_PAGE_SIZE}`, hasCatalogFilters ? ui.filtersActive : ui.directExplore].join(' / ')
  const manualSourceOptions = languageSources.map((item) => ({ value: item.value, label: item.label }))
  const sourceSummaryValue = (
    <div className="gui2-catalog-source-display">
      <span className="gui2-catalog-source-display-icon"><CatalogIcon kind="language" /></span>
      <span>{getMangaSourceMeta(activeSourceID).label}</span>
    </div>
  )
  const resultsSummary = selected
    ? `${chapters.length} ${isEnglish ? 'chapters' : 'capitulos'}`
    : searched
      ? `${results.length} ${isEnglish ? 'results' : 'resultados'}`
      : `${displayedCatalog.length} ${isEnglish ? 'results' : 'resultados'}`
  const pageSummary = searched ? (isEnglish ? 'AniList search' : 'Busqueda AniList') : `${ui.pageLabel} ${catalogPage}`
  const activeFilterTags = [
    ...catalogGenres.map((genre) => ({ label: isEnglish ? 'Genre' : 'Genero', value: GENRE_LABELS[genre]?.[appLang] ?? genre })),
    ...(catalogYear ? [{ label: isEnglish ? 'Year' : 'Ano', value: String(catalogYear) }] : []),
    ...(catalogFormat ? [{ label: isEnglish ? 'Format' : 'Formato', value: MANGA_FORMAT_OPTIONS.find((item) => item.value === catalogFormat)?.label ?? catalogFormat }] : []),
    ...(catalogStatus ? [{ label: isEnglish ? 'Status' : 'Estado', value: MANGA_STATUS_OPTIONS.find((item) => item.value === catalogStatus)?.label ?? catalogStatus }] : []),
  ]
  const mangaCatalogFilters = [
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
      key: 'year',
      icon: 'season',
      label: isEnglish ? 'Year / Release' : 'Ano / Lanzamiento',
      control: <CustomSelect value={catalogYear} onChange={handleYearChange} options={yearOptions} placeholder={ui.year} />,
    },
    {
      key: 'format',
      icon: 'format',
      label: isEnglish ? 'Format' : 'Formato',
      control: <CustomSelect value={catalogFormat} onChange={handleFormatChange} options={MANGA_FORMAT_OPTIONS} placeholder={isEnglish ? 'All Types' : 'Todos'} />,
    },
    {
      key: 'status',
      icon: 'status',
      label: isEnglish ? 'Status' : 'Estado',
      control: <CustomSelect value={catalogStatus} onChange={handleStatusChange} options={MANGA_STATUS_OPTIONS} placeholder={isEnglish ? 'All Status' : 'Todos'} />,
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
      control: (
        <div className="gui2-catalog-inline-controls">
          <CustomSelect value={lang} onChange={handleLanguageChange} options={LANG_OPTIONS} placeholder="Lang" />
          <CustomSelect value={activeSourceID} onChange={handleSearchSourceChange} options={manualSourceOptions} placeholder="Source" />
        </div>
      ),
    },
  ]
  const mangaSummaryPills = selected
    ? [
        getMangaSourceMeta(activeSourceID).label,
        selected.mode === 'direct'
          ? (isEnglish ? 'Direct source open' : 'Apertura directa de fuente')
          : (isEnglish ? 'Canonical session locked' : 'Sesion canonica estable'),
        chapters.length > 0
          ? (isEnglish ? `${chapters.length} chapters ready` : `${chapters.length} capitulos listos`)
          : (sourceIsLoading
              ? (isEnglish ? 'Loading source and chapters' : 'Cargando fuente y capitulos')
              : (sourceIsHydrating
                  ? (isEnglish ? 'Hydrating chapter list' : 'Hidratando lista de capitulos')
                  : (isEnglish ? 'Waiting for a valid source' : 'Esperando una fuente valida'))),
      ]
    : searched
      ? [
          getMangaSourceMeta(activeSourceID).label,
          isEnglish ? `${results.length} results ready` : `${results.length} resultados listos`,
          isEnglish ? 'Metadata first, source on open' : 'Metadata primero, fuente al abrir',
        ]
      : [
          `${lang.toUpperCase()} / ${getMangaSourceMeta(activeSourceID).label}`,
          isEnglish ? `${displayedCatalog.length} titles loaded` : `${displayedCatalog.length} titulos cargados`,
          catalogAniListUnavailable
            ? (isEnglish ? 'AniList temporarily unavailable' : 'AniList temporalmente no disponible')
            : (hasCatalogFilters ? (isEnglish ? 'Filters shaping the shelf' : 'Filtros afinando el estante') : (isEnglish ? 'Browse and open fast' : 'Explora y abre rapido')),
        ]
  const resumeChapterID = (() => {
    const sourceContext = resolveReadingContext()
    if (!sourceContext?.sourceID || !sourceContext?.mangaID) return ''
    return getMostRecentIncompleteChapterID(sourceContext.sourceID, sourceContext.mangaID, chapters)
  })()
  const selectedDetail = selectedMangaDetailQuery.data
  const selectedCoverURL = selectedDetail?.resolved_cover_url || selected?.resolved_cover_url || selected?.cover_url || ''
  const selectedBannerURL = selectedDetail?.resolved_banner_url || selected?.resolved_banner_url || selected?.banner_url || selectedCoverURL
  const selectedDescription = selectedDetail?.resolved_description || selected?.resolved_description || selected?.description || ''
  const selectedCover = selectedCoverURL ? proxyImage(selectedCoverURL, { sourceID: activeSourceID }) : ''
  const selectedBanner = selectedBannerURL ? proxyImage(selectedBannerURL, { sourceID: activeSourceID }) : selectedCover
  const selectedCharacters = selectedMangaDetailQuery.data?.characters ?? selected?.characters ?? []
  const selectedFacts = [
    (selected?.resolved_year || selected?.year) ? String(selected.resolved_year || selected.year) : null,
    (selected?.resolved_format || selected?.format) ? String(selected.resolved_format || selected.format) : null,
    chapters.length > 0 ? `${chapters.length} ${ui.chapters}` : null,
    Array.isArray(selectedDetail?.genres) && selectedDetail.genres.length > 0 ? selectedDetail.genres.slice(0, 3).join(', ') : null,
  ].filter(Boolean)
  const selectedReadingRows = [
    { label: ui.chapters, value: String(chapters.length || selected?.chapters_total || 0) },
    { label: ui.myList, value: selected?.manga_list_status || ui.statusWatching },
  ].filter(Boolean)
  const visibleChapters = chapterFilter === 'unread'
    ? chapters.filter((chapter) => !chapter.completed)
    : chapters

  if (reading) {
    return (
      <div className={`reader-transition ${readerClosing ? 'reader-exit' : 'reader-enter'}`}>
        <MangaReader
          chapterID={reading.chapterID}
          title={reading.title}
          sourceID={reading.sourceID}
          mangaID={reading.mangaID}
          chapters={reading.chapters}
          contentFormat={selectedDetail?.resolved_format || selected?.resolved_format || selected?.format || ''}
          countryOfOrigin={selectedDetail?.countryOfOrigin || selectedDetail?.country_of_origin || selected?.countryOfOrigin || selected?.country_of_origin || ''}
          onProgressChange={handleProgressChange}
          onOpenChapter={openReader}
          onBack={() => {
            setReaderClosing(true)
            const progress = getMangaReaderProgress(reading.sourceID, reading.mangaID, reading.chapterID)
            if (progress) handleProgressChange({ chapterID: reading.chapterID, progressPage: progress.progress_page, totalPages: progress.total_pages })
            setTimeout(() => { setReading(null); setReaderClosing(false) }, 250)
          }}
        />
      </div>
    )
  }

  if (selected) {
    return (
      <OnlineMangaDetail
        selected={selected}
        detail={selectedDetail}
        selectedCover={selectedCover}
        selectedBanner={selectedBanner}
        selectedDescription={selectedDescription}
        selectedCharacters={selectedCharacters}
        selectedFacts={selectedFacts}
        selectedReadingRows={selectedReadingRows}
        sourceCards={sourceCards}
        activeSourceID={activeSourceID}
        activeSourceQuery={activeSourceQuery}
        onSelectSource={selectActiveSource}
        onBack={handleBackFromSelected}
        backLabel={isEnglish ? 'Back to catalog' : 'Volver al catalogo'}
        canAddToList={Boolean(selected?.anilist_id > 0 && !selected?.in_manga_list)}
        addingToList={addingToList}
        onAddToList={handleAddToMangaList}
        isEnglish={isEnglish}
        ui={ui}
        chapters={chapters}
        visibleChapters={visibleChapters}
        canShowChapters={canShowChapters}
        chapterFilter={chapterFilter}
        onChapterFilterChange={setChapterFilter}
        sourceIsLoading={sourceIsLoading}
        sourceIsHydrating={sourceIsHydrating}
        activeSourceMatch={activeSourceMatch}
        sourceError={activeSourceQuery.error?.message || ''}
        onRetrySource={() => activeSourceQuery.refetch()}
        resumeChapterID={resumeChapterID}
        onOpenChapter={openReader}
        chapterSectionCopy={chapterSectionCopy}
      />
    )
  }

  return (
    <Gui2OnlineCatalogSurface
      title={isEnglish ? 'Manga Online' : 'Manga Online'}
      description={isEnglish ? 'Read thousands of manga chapters from the strongest online sources.' : 'Lee miles de capitulos desde las mejores fuentes online.'}
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
          <button className="gui2-catalog-query-btn" onClick={handleSearch} disabled={loading || !query.trim()} type="button">
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
        filters={mangaCatalogFilters}
        activeFilters={activeFilterTags}
        onClearFilters={hasCatalogFilters ? clearCatalogFilters : null}
        actionLabel={ui.clearFilters}
        bodyTitle={searched ? ui.results : ui.featured}
      bodySubtitle={searched ? ui.resultsReady(results.length) : catalogSummary}
      body={(() => {
        if (showSearchSkeleton) {
          return <OnlinePosterSkeletonGrid count={8} />
        }

        if (searched) {
          if (results.length === 0) {
            return (
              <div className="empty-state">
                <div className="empty-state-title">{ui.noResults}</div>
                <p className="empty-state-desc">{ui.noResultsDesc(query)}</p>
              </div>
            )
          }

          return (
            <VirtualMediaGrid
              items={results}
              listClassName="gui2-catalog-grid"
              itemClassName="gui2-catalog-grid-item"
              itemContent={(item) => (
                <OnlinePosterCard
                  key={`search-${item.id}`}
                  cover={item.resolved_cover_url || item.cover_url}
                  title={getCatalogTitle(item)}
                  meta={getCatalogMeta(item, isEnglish).map((value) => <span key={`${item.id}-${value}`}>{value}</span>)}
                  noCoverLabel={ui.noCover}
                  onClick={() => openCanonicalItem(item, { returnMode: 'results' })}
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
              <p className="empty-state-desc">{catalogAniListUnavailable ? ui.catalogUnavailableDesc : ui.noCatalogDesc}</p>
            </div>
          )
        }

        return (
          <VirtualMediaGrid
            items={displayedCatalog}
            listClassName="gui2-catalog-grid"
            itemClassName="gui2-catalog-grid-item"
            itemContent={(item) => (
              <OnlinePosterCard
                key={`catalog-${item.id}`}
                cover={item.resolved_cover_url || item.cover_url}
                title={getCatalogTitle(item)}
                meta={getCatalogMeta(item, isEnglish).map((value) => <span key={`${item.id}-${value}`}>{value}</span>)}
                badge={item.status ? <span className="gui2-catalog-status-badge">{String(item.status).replaceAll('_', ' ')}</span> : null}
                noCoverLabel={ui.noCover}
                onClick={() => openCanonicalItem(item)}
              />
            )}
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
