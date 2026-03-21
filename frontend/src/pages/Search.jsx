import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { wails, proxyImage } from '../lib/wails'
import OnlineAnimeDetail from '../components/ui/OnlineAnimeDetail'
import { toastError } from '../components/ui/Toast'
import { enrichJKAnimeHit, resolveAniListToJKAnime } from '../lib/onlineAnimeResolver'
import { useI18n } from '../lib/i18n'

const SOURCE_META = {
  'jkanime-es':   { label: 'JKAnime',   color: '#c084fc' },
  'animepahe-en': { label: 'AnimePahe', color: '#38bdf8' },
}

function getSortOptions(lang) {
  return [
    { value: 'TRENDING_DESC', label: lang === 'en' ? 'Trending' : 'Tendencia' },
    { value: 'POPULARITY_DESC', label: lang === 'en' ? 'Popularity' : 'Popularidad' },
    { value: 'SCORE_DESC', label: lang === 'en' ? 'Score' : 'Puntuacion' },
    { value: 'START_DATE_DESC', label: lang === 'en' ? 'Newest' : 'Mas recientes' },
  ]
}

function getSeasonOptions(lang) {
  return [
    { value: '', label: lang === 'en' ? 'Season' : 'Temporada' },
    { value: 'WINTER', label: lang === 'en' ? 'Winter' : 'Invierno' },
    { value: 'SPRING', label: lang === 'en' ? 'Spring' : 'Primavera' },
    { value: 'SUMMER', label: lang === 'en' ? 'Summer' : 'Verano' },
    { value: 'FALL', label: lang === 'en' ? 'Fall' : 'Otono' },
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

async function fetchCatalogFallback(page) {
  const res = await wails.getTrending('es')
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

function cleanAnimeSearchTerm(value) {
  return String(value ?? '')
    .replace(/[:/\\|()[\]{}]+/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pushAnimeSearchCandidate(list, seen, value) {
  const raw = String(value ?? '').trim()
  if (!raw) return
  if (!seen.has(raw)) {
    seen.add(raw)
    list.push(raw)
  }
  const cleaned = cleanAnimeSearchTerm(raw)
  if (cleaned && !seen.has(cleaned)) {
    seen.add(cleaned)
    list.push(cleaned)
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
      : `No se encontro "${term}" en ninguna fuente.`,
    offline: isEnglish
      ? 'You appear to be offline. Check your internet connection and try again.'
      : 'Sin conexion. Verifica tu internet e intenta de nuevo.',
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
    genres: isEnglish ? 'Genres' : 'Generos',
    combineGenres: isEnglish ? 'You can combine multiple genres.' : 'Puedes combinar varios a la vez.',
    clearFilters: isEnglish ? 'Clear filters' : 'Limpiar filtros',
    sourceSearching: (name) => isEnglish ? `Searching in ${name}...` : `Buscando en ${name}...`,
    noResults: isEnglish ? 'No results' : 'Sin resultados',
    noResultsSource: (query, sourceName, altCount) => isEnglish
      ? `Could not find "${query}" on ${sourceName}. Try the Japanese or English title.${altCount > 0 ? ` (${altCount} result${altCount !== 1 ? 's' : ''} on another source)` : ''}`
      : `No se encontro "${query}" en ${sourceName}. Intenta con el titulo en japones o en ingles.${altCount > 0 ? ` (${altCount} resultado${altCount !== 1 ? 's' : ''} en otra fuente)` : ''}`,
    foundResults: isEnglish ? 'Search results' : 'Resultados encontrados',
    readyToOpen: (count) => isEnglish
      ? `${count} result${count !== 1 ? 's' : ''} ready to open`
      : `${count} resultado${count !== 1 ? 's' : ''} listo${count !== 1 ? 's' : ''} para abrir`,
    exploreTitle: isEnglish ? 'Anime to explore' : 'Anime para explorar',
    postersLoaded: (count) => isEnglish
      ? `${count} poster${count !== 1 ? 's' : ''} loaded`
      : `${count} poster${count !== 1 ? 's' : ''} cargado${count !== 1 ? 's' : ''}`,
    filtersActive: isEnglish ? 'Active filters' : 'Filtros activos',
    directExplore: isEnglish ? 'Direct AniList browsing with source opening' : 'Exploracion directa con AniList y apertura en JKAnime',
    noCatalog: isEnglish ? 'No catalog available right now' : 'Sin catalogo por ahora',
    noCatalogDesc: isEnglish
      ? 'Could not load anime to explore. Adjust the filters or try again in a few seconds.'
      : 'No se pudieron cargar animes para explorar. Ajusta los filtros o intenta de nuevo en unos segundos.',
    loadMore: isEnglish ? 'Load more' : 'Cargar mas',
    noCover: isEnglish ? 'no cover' : 'sin portada',
    animeOnline: isEnglish ? 'Anime Online' : 'Anime online',
    findSomething: isEnglish ? 'Find something to watch' : 'Encuentra algo para ver',
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState(() => location.state?.selectedAnime ?? null)
  const [resolvingKey, setResolvingKey] = useState('')
  const [activeSource, setActiveSource] = useState(() => (appLang === 'en' ? 'animepahe-en' : 'jkanime-es'))
  const [catalog, setCatalog] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogHasNext, setCatalogHasNext] = useState(false)
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogSort, setCatalogSort] = useState('TRENDING_DESC')
  const [catalogGenres, setCatalogGenres] = useState([])
  const [catalogSeason, setCatalogSeason] = useState('')
  const [catalogYear, setCatalogYear] = useState(0)
  const inputRef = useRef(null)
  const searchRequestRef = useRef(0)
  const catalogRequestRef = useRef(0)

  const openResolvedHit = useCallback(async (hit) => {
    try {
      const enriched = await enrichJKAnimeHit(hit, wails, appLang)
      setSelected(enriched)
    } catch (e) {
      setSelected(hit)
      toastError(`${ui.enrichError}: ${e?.message ?? e}`)
    }
  }, [appLang, ui.enrichError])

  const performSearch = useCallback(async (rawQuery, opts = {}) => {
    const {
      alt = '',
      clearSelected = true,
      openFirst = false,
      preferredAnilistID = 0,
      silent = false,
    } = opts

    const term = rawQuery?.trim()
    if (!term) return []
    const requestID = ++searchRequestRef.current

    setQuery(term)
    setLoading(true)
    setSearched(false)
    if (clearSelected) setSelected(null)

    try {
      let preferredMeta = null
      if (preferredAnilistID > 0) {
        try {
          preferredMeta = await wails.getAniListAnimeByID(preferredAnilistID)
        } catch {}
      }

      let candidates = buildAniListSeededAnimeCandidates(term, alt, preferredMeta)
      if (!preferredMeta) {
        try {
          const aniListSearch = await wails.searchAniList(term, appLang)
          const media = aniListSearch?.data?.Page?.media ?? []
          candidates = buildAniListSearchMediaCandidates(term, alt, media)
        } catch {}
      }
      candidates = candidates.slice(0, preferredAnilistID > 0 ? 10 : 8)
      const aggregateResults = []
      const seen = new Set()
      let preferredMatch = null

      for (const candidate of candidates) {
        const res = await wails.searchOnline(candidate, activeSource)
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
          for (const item of currentResults.slice(0, 5)) {
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
          continue
        }

        if (aggregateResults.length > 0) break
      }

      const finalResults = aggregateResults
      if (requestID !== searchRequestRef.current) return []
      setResults(finalResults)

      if (preferredMatch) {
        setSelected(preferredMatch)
      } else if (openFirst && finalResults.length > 0) {
        await openResolvedHit(finalResults[0])
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
  }, [activeSource, appLang, openResolvedHit])

  const resolveAniListMedia = useCallback(async (media, key) => {
    setResolvingKey(key)
    try {
      const { hit, searchedTitle } = await resolveAniListToJKAnime(media, wails, activeSource)
      if (hit) {
        setSelected(hit)
      } else {
        toastError(ui.sourceNotFound(searchedTitle, SOURCE_META[activeSource]?.label ?? activeSource))
      }
    } finally {
      setResolvingKey('')
    }
  }, [activeSource, appLang])

  useEffect(() => {
    setActiveSource((current) => {
      if (appLang === 'en') {
        return current === 'jkanime-es' ? 'animepahe-en' : current
      }
      return current === 'animepahe-en' ? 'jkanime-es' : current
    })
  }, [appLang])

  useEffect(() => {
    const requestID = ++catalogRequestRef.current
    setCatalogLoading(true)

    fetchCatalogPage({
      sort: catalogSort,
      page: catalogPage,
      genres: catalogGenres,
      season: catalogSeason,
      year: catalogYear,
    })
      .catch(async (error) => {
        if (catalogPage !== 1 || catalogGenres.length || catalogSeason || catalogYear) throw error
        return fetchCatalogFallback(catalogPage)
      })
      .then((res) => {
        if (requestID !== catalogRequestRef.current) return
        const pageData = res?.data?.Page
        const media = pageData?.media ?? []

        if (catalogPage === 1) {
          setCatalog(media)
        } else {
          setCatalog(prev => [...prev, ...media])
        }
        setCatalogHasNext(pageData?.pageInfo?.hasNextPage ?? false)
      })
      .catch(() => {
        if (requestID !== catalogRequestRef.current) return
        if (catalogPage === 1) {
          setCatalog([])
          setCatalogHasNext(false)
        }
        toastError(ui.catalogError)
      })
      .finally(() => {
        if (requestID === catalogRequestRef.current) {
          setCatalogLoading(false)
        }
      })
  }, [catalogGenres, catalogPage, catalogSeason, catalogSort, catalogYear, ui.catalogError])

  useEffect(() => {
    const navState = location.state
    if (!navState) return

    navigate(location.pathname, { replace: true, state: null })

    if (navState.selectedAnime) {
      setSelected(navState.selectedAnime)
      return
    }

    if (navState.autoOpen) {
      void openResolvedHit(navState.autoOpen)
      return
    }

    if (navState.preSearch) {
      void performSearch(navState.preSearch, {
        alt: navState.altSearch,
        preferredAnilistID: Number(navState.preferredAnilistID) || 0,
        silent: true,
      })
    }
  }, [location.pathname, location.state, navigate, openResolvedHit, performSearch])

  const handleSearch = useCallback(() => {
    performSearch(query)
  }, [performSearch, query])

  const handleQueryChange = useCallback((event) => {
    const nextQuery = event.target.value
    setQuery(nextQuery)

    if (!nextQuery.trim()) {
      searchRequestRef.current += 1
      setLoading(false)
      setSearched(false)
      setResults([])
    }
  }, [])

  const handleKey = useCallback((event) => {
    if (event.key === 'Enter') handleSearch()
  }, [handleSearch])

  const handleCatalogSort = useCallback((value) => {
    setCatalogSort(value)
    setCatalogPage(1)
  }, [])

  const toggleGenre = useCallback((genre) => {
    setCatalogGenres((current) => (
      current.includes(genre)
        ? current.filter(item => item !== genre)
        : [...current, genre]
    ))
    setCatalogPage(1)
  }, [])

  const handleSeasonChange = useCallback((value) => {
    setCatalogSeason(value)
    setCatalogPage(1)
  }, [])

  const handleYearChange = useCallback((value) => {
    setCatalogYear(Number(value) || 0)
    setCatalogPage(1)
  }, [])

  const clearCatalogFilters = useCallback(() => {
    setCatalogGenres([])
    setCatalogSeason('')
    setCatalogYear(0)
    setCatalogSort('TRENDING_DESC')
    setCatalogPage(1)
  }, [])

  const handleLoadMore = useCallback(() => {
    if (catalogLoading || !catalogHasNext) return
    setCatalogPage(prev => prev + 1)
  }, [catalogHasNext, catalogLoading])

  const hasCatalogFilters = catalogGenres.length > 0 || Boolean(catalogSeason) || Boolean(catalogYear)
  const catalogSummary = [
    ui.postersLoaded(catalog.length),
    hasCatalogFilters ? ui.filtersActive : ui.directExplore,
  ].join(' / ')

  if (selected) {
    return <OnlineAnimeDetail anime={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="fade-in online-directory-page">
      <section className="online-directory-shell">
        <header className="online-directory-toolbar">
          <div className="online-directory-titleblock">
            <span className="online-directory-kicker">{ui.animeOnline}</span>
            <h1 className="online-directory-title">{ui.findSomething}</h1>
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
                    { id: 'jkanime-es', label: 'JKAnime' },
                    { id: 'animepahe-en', label: 'AnimePahe' },
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
                      onClick={() => setActiveSource(src.id)}
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

        {loading ? (
          <div className="empty-state">
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {ui.sourceSearching(SOURCE_META[activeSource]?.label ?? activeSource)}
            </p>
          </div>
        ) : null}

        {(() => {
          const filtered = results.filter(r => r.source_id === activeSource)
          return (
            <>
              {!loading && searched && filtered.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">{ui.noResults}</div>
                  <p className="empty-state-desc">
                    {ui.noResultsSource(query, SOURCE_META[activeSource]?.label ?? activeSource, results.length - filtered.length)}
                  </p>
                </div>
              ) : null}

              {!loading && searched && filtered.length > 0 ? (
                <section className="online-directory-results">
                  <SectionHeader
                    title={ui.foundResults}
                    subtitle={ui.readyToOpen(filtered.length)}
                  />
                  <div className="online-results-grid">
                    {filtered.map((item, index) => (
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
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )
        })()}

        {!searched ? (
          <section className="online-directory-results">
            <SectionHeader
              title={ui.exploreTitle}
              subtitle={catalogSummary}
            />

            {catalogLoading && catalog.length === 0 ? (
              <div className="empty-state">
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
                </div>
              </div>
            ) : !catalogLoading && catalog.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">{ui.noCatalog}</div>
                <p className="empty-state-desc">
                  {ui.noCatalogDesc}
                </p>
              </div>
            ) : (
              <div className="online-results-grid">
                {catalog.map((media) => {
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
                })}
              </div>
            )}

            {!catalogLoading && catalogHasNext ? (
              <div className="online-directory-loadmore">
                <button
                  type="button"
                  className="btn btn-ghost online-directory-loadmore-btn"
                  onClick={handleLoadMore}
                >
                  {ui.loadMore}
                </button>
              </div>
            ) : null}

            {catalogLoading && catalog.length > 0 ? (
              <div className="online-directory-loadmore">
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </div>
  )
}
