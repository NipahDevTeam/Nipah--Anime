import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  buildMangaSourceOptions,
  DEFAULT_MANGA_SOURCE,
  getMangaSourceMeta,
  MANGA_SOURCE_OPTIONS,
  normalizeMangaSourceID,
} from '../lib/mangaSources'
import {
  getMangaReaderProgress,
  getMangaReaderProgressMap,
  getMostRecentIncompleteChapterID,
  markMangaReaderChaptersCompletedThrough,
} from '../lib/mangaReaderProgress'
import { proxyImage, wails } from '../lib/wails'
import MangaReader from '../components/ui/MangaReader'
import { toastError } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'

const LANG_OPTIONS = [
  { value: 'es', label: 'Espanol' },
  { value: 'en', label: 'English' },
]

function cleanMangaSearchTerm(value) {
  return String(value ?? '')
    .replace(/[:/\\|()[\]{}]+/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pushSearchCandidate(list, seen, value) {
  const raw = String(value ?? '').trim()
  if (!raw) return
  if (!seen.has(raw)) {
    seen.add(raw)
    list.push(raw)
  }
  const cleaned = cleanMangaSearchTerm(raw)
  if (cleaned && !seen.has(cleaned)) {
    seen.add(cleaned)
    list.push(cleaned)
  }
}

function buildAniListSeededSearchCandidates(query, meta) {
  const out = []
  const seen = new Set()

  pushSearchCandidate(out, seen, query)
  pushSearchCandidate(out, seen, meta?.title_english)
  pushSearchCandidate(out, seen, meta?.title_romaji)
  pushSearchCandidate(out, seen, meta?.title_native)
  ;(meta?.synonyms ?? []).forEach((value) => pushSearchCandidate(out, seen, value))

  return out.slice(0, 7)
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

export default function MangaSearch() {
  const { lang: appLang } = useI18n()
  const isEnglish = appLang === 'en'
  const ui = useMemo(() => ({
    searchPlaceholder: (label) => isEnglish ? `Search manga on ${label}...` : `Buscar manga en ${label}...`,
    searching: isEnglish ? 'Searching...' : 'Buscando...',
    search: isEnglish ? 'Search' : 'Buscar',
    noChaptersLang: (label) => isEnglish ? `No chapters available in ${label}.` : `Sin capitulos en ${label}.`,
    offline: isEnglish ? 'You appear to be offline. Check your internet connection and try again.' : 'Sin conexion. Verifica tu internet e intenta de nuevo.',
    searchError: (msg) => isEnglish ? `Search error: ${msg}` : `Error al buscar: ${msg}`,
    addSyncError: 'Some changes could not be synced and were queued for retry.',
    addToList: isEnglish ? '+ Add to My List' : '+ Agregar a Mi Lista',
    adding: isEnglish ? 'Adding...' : 'Agregando...',
    backToResults: isEnglish ? '<- Results' : '<- Resultados',
    myList: isEnglish ? 'My List' : 'Mi Lista',
    onlineManga: isEnglish ? 'Manga Online' : 'Manga online',
    chapters: isEnglish ? 'Chapters' : 'Capitulos',
    chapterSingular: isEnglish ? 'chapter' : 'capitulo',
    startReading: isEnglish ? 'Select a chapter to start reading. Your progress is saved automatically.' : 'Selecciona un capitulo para comenzar a leer. Tu progreso se guarda automaticamente.',
    loadingChapters: isEnglish ? 'Loading chapters...' : 'Cargando capitulos...',
    noChapters: isEnglish ? 'No chapters' : 'Sin capitulos',
    noChaptersDesc: isEnglish ? 'No chapters are available. Try another language or source.' : 'No hay capitulos disponibles. Prueba con otro idioma o fuente.',
    locked: isEnglish ? 'Locked' : 'Bloqueado',
    completed: isEnglish ? 'Completed' : 'Completado',
    read: isEnglish ? 'Read' : 'Leido',
    continue: isEnglish ? 'Continue' : 'Continuar',
    readNow: isEnglish ? 'Read' : 'Leer',
    noResults: isEnglish ? 'No results' : 'Sin resultados',
    noResultsDesc: (query, sourceName) => isEnglish
      ? `Could not find "${query}" on ${sourceName}. Try another title or switch sources.`
      : `No se encontro "${query}" en ${sourceName}. Intenta con otro nombre o cambia de fuente.`,
    results: isEnglish ? 'Results' : 'Resultados',
    emptyTitle: isEnglish ? 'Read manga online' : 'Leer manga online',
    emptyDesc: isEnglish ? 'Choose a source above and search for your manga.' : 'Selecciona una fuente arriba y busca tu manga.',
    noCover: isEnglish ? 'no cover' : 'sin portada',
    unknownError: isEnglish ? 'unknown error' : 'error desconocido',
    addError: isEnglish ? 'Could not add it to your list' : 'Error al agregar a tu lista',
    chapterError: isEnglish ? 'Error loading chapters' : 'Error al cargar capitulos',
    coinLabel: (price) => isEnglish ? `${price} coins` : `${price} monedas`,
    statusWatching: isEnglish ? 'WATCHING' : 'WATCHING',
  }), [isEnglish])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState(null)
  const [chapters, setChapters] = useState([])
  const [chapLoading, setChapLoading] = useState(false)
  const [reading, setReading] = useState(null)
  const [lang, setLang] = useState(() => (appLang === 'en' ? 'en' : 'es'))
  const [source, setSource] = useState(() => (appLang === 'en' ? 'mangafire-en' : DEFAULT_MANGA_SOURCE))
  const [sourceOptions, setSourceOptions] = useState(MANGA_SOURCE_OPTIONS)
  const [pendingAutoReadChapterID, setPendingAutoReadChapterID] = useState('')
  const [pendingPreferredAniListID, setPendingPreferredAniListID] = useState(0)
  const [addingToList, setAddingToList] = useState(false)
  const [readerClosing, setReaderClosing] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const chaptersRef = useRef([])

  const sourceMeta = sourceOptions.find((item) => item.value === source) ?? getMangaSourceMeta(source)
  const availableLangs = LANG_OPTIONS.filter((item) => sourceMeta.languages.includes(item.value))
  const selectedSource = selected?.source_id ?? source
  const selectedSourceMeta = sourceOptions.find((item) => item.value === selectedSource) ?? getMangaSourceMeta(selectedSource)
  const selectedCoverURL = selected?.resolved_cover_url || selected?.cover_url || ''
  const selectedBannerURL = selected?.resolved_banner_url || selectedCoverURL
  const selectedDescription = selected?.resolved_description || selected?.description || ''
  const selectedCover = selectedCoverURL
    ? proxyImage(selectedCoverURL, { sourceID: selectedSource })
    : ''
  const selectedBanner = selectedBannerURL
    ? proxyImage(selectedBannerURL, { sourceID: selectedSource })
    : selectedCover

  const openReader = useCallback((chapter, chapterList = null) => {
    if (!selected || !chapter || chapter.locked) return
    const srcID = selected.source_id ?? source
    const resolvedChapterList = chapterList ?? chaptersRef.current
    const chapterNumber = Number(chapter.number) || 0
    if (chapterNumber > 0) {
      markMangaReaderChaptersCompletedThrough(srcID, selected.id, resolvedChapterList, chapterNumber)
      setChapters((prev) => enrichChaptersWithProgress(prev, srcID, selected.id, Math.max(Number(selected?.chapters_read) || 0, chapterNumber)))
      if (selected?.anilist_id > 0 && chapterNumber > (Number(selected?.chapters_read) || 0)) {
        wails.updateMangaListProgress(selected.anilist_id, chapterNumber).catch(() => {})
        setSelected((prev) => prev ? ({
          ...prev,
          chapters_read: Math.max(Number(prev.chapters_read) || 0, chapterNumber),
        }) : prev)
      }
    }
    wails.recordMangaRead(
      srcID,
      selected.id,
      selected.canonical_title || selected.title,
      selected.resolved_cover_url || selected.cover_url || '',
      chapter.id,
      chapter.number ?? 0,
      chapter.title ?? `${isEnglish ? 'Chapter' : 'Capitulo'} ${chapter.number}`,
    ).catch(() => {})

    setReading({
      chapterID: chapter.id,
      chapterNumber: chapter.number ?? 0,
      title: `${selected.title} · ${isEnglish ? 'Ch.' : 'Cap.'} ${chapter.number}`,
      sourceID: srcID,
      mangaID: selected.id,
      chapters: resolvedChapterList,
    })
  }, [isEnglish, selected, source])

  const openReaderRef = useRef(openReader)

  useEffect(() => {
    openReaderRef.current = openReader
  }, [openReader])

  const handleProgressChange = useCallback(({ chapterID, progressPage, totalPages, completed }) => {
    setChapters((prev) => prev.map((chapter) => (
      chapter.id === chapterID
        ? {
            ...chapter,
            progress_page: progressPage,
            total_pages: totalPages,
            completed: completed ?? chapter.completed ?? false,
          }
        : chapter
    )))
  }, [])

  useEffect(() => {
    chaptersRef.current = chapters
  }, [chapters])

  useEffect(() => {
    if (location.state?.autoOpen) {
      const item = location.state.autoOpen
      const src = normalizeMangaSourceID(item.source_id)
      setSource(src)
      setPendingAutoReadChapterID(location.state.autoReadChapterID ?? '')
      setPendingPreferredAniListID(Number(location.state.preferredAnilistID) || 0)
      setSelected({
        id: item.id,
        title: item.title,
        cover_url: item.cover_url,
        resolved_cover_url: item.resolved_cover_url,
        resolved_banner_url: item.resolved_banner_url,
        resolved_description: item.resolved_description,
        canonical_title: item.canonical_title,
        canonical_title_english: item.canonical_title_english,
        anilist_id: item.anilist_id,
        mal_id: item.mal_id,
        in_manga_list: item.in_manga_list,
        manga_list_status: item.manga_list_status,
        chapters_read: item.chapters_read,
        source_id: src,
        source_name: item.source_name,
      })
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    if (!sourceMeta.languages.includes(lang)) {
      setLang(sourceMeta.languages[0])
    }
  }, [lang, sourceMeta])

  useEffect(() => {
    if (appLang === 'en') {
      setLang('en')
      setSource((current) => (current === 'senshimanga-es' || current === 'mangaoni-es' ? 'mangafire-en' : current))
      return
    }
    setLang((current) => (current === 'en' ? 'es' : current))
    setSource((current) => (current === 'mangafire-en' || current === 'templetoons-en' ? DEFAULT_MANGA_SOURCE : current))
  }, [appLang])

  useEffect(() => {
    let cancelled = false

    wails.listExtensions()
      .then((extensions) => {
        if (cancelled) return
        setSourceOptions(buildMangaSourceOptions(extensions))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (sourceOptions.length === 0) return
    if (!sourceOptions.some((item) => item.value === source)) {
      setSource(sourceOptions[0].value)
    }
  }, [source, sourceOptions])

  useEffect(() => {
    if (!selected) return
    setChapLoading(true)
    setChapters([])

    const srcID = selected.source_id ?? source
    wails.getMangaChaptersSource(srcID, selected.id, lang)
      .then((loaded) => {
        const nextChapters = enrichChaptersWithProgress(loaded ?? [], srcID, selected.id, Number(selected?.chapters_read) || 0)
        setChapters(nextChapters)
        if (pendingAutoReadChapterID) {
          const autoChapter = nextChapters.find((chapter) => chapter.id === pendingAutoReadChapterID)
          if (autoChapter) {
            setPendingAutoReadChapterID('')
            openReaderRef.current?.(autoChapter, nextChapters)
            return
          }
          setPendingAutoReadChapterID('')
        }
        if (nextChapters.length === 0) {
          const langLabel = LANG_OPTIONS.find((item) => item.value === lang)?.label ?? lang
          toastError(ui.noChaptersLang(langLabel))
        }
      })
      .catch((e) => toastError(`${ui.chapterError}: ${e?.message ?? ui.unknownError}`))
      .finally(() => setChapLoading(false))
  }, [lang, pendingAutoReadChapterID, selected?.id, selected?.source_id, source, ui.chapterError, ui.noChaptersLang, ui.unknownError])

  const resumeChapterID = selected
    ? getMostRecentIncompleteChapterID(selectedSource, selected.id, chapters)
    : ''

  const runSearch = useCallback(async (searchValue) => {
    const normalizedQuery = (searchValue ?? '').trim()
    if (!normalizedQuery) return
    setLoading(true)
    setSearched(false)
    setSelected(null)
    setChapters([])
    try {
      let anilistMeta = null
      if (pendingPreferredAniListID > 0) {
        try {
          anilistMeta = await wails.getAniListMangaByID(pendingPreferredAniListID)
        } catch {}
      }

      const searchCandidates = buildAniListSeededSearchCandidates(normalizedQuery, anilistMeta)
      const aggregateResults = []
      const seenResultIDs = new Set()
      let preferredResult = null

      for (const candidate of searchCandidates) {
        const res = await wails.searchMangaSource(source, candidate, lang)
        const nextResults = (res ?? []).map((item) => ({ ...item, source_id: source }))

        for (const item of nextResults) {
          const key = `${item.source_id ?? source}:${item.id}`
          if (!seenResultIDs.has(key)) {
            seenResultIDs.add(key)
            aggregateResults.push(item)
          }
        }

        if (pendingPreferredAniListID > 0) {
          preferredResult = nextResults.find((item) => Number(item.anilist_id) === pendingPreferredAniListID) ?? preferredResult
          if (preferredResult) {
            break
          }
          continue
        }

        if (aggregateResults.length > 0) {
          break
        }
      }

      setResults(aggregateResults)
      if (preferredResult) {
        setSelected(preferredResult)
        setPendingPreferredAniListID(0)
      }
    } catch (e) {
      setResults([])
      const msg = e?.message ?? String(e)
      if (msg.includes('network') || msg.includes('timeout')) {
        toastError(ui.offline)
      } else {
        toastError(ui.searchError(msg))
      }
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [lang, pendingPreferredAniListID, source])

  const handleSearch = useCallback(async () => {
    await runSearch(query)
  }, [query, runSearch])

  useEffect(() => {
    if (!location.state?.preSearch) return
    const initialQuery = location.state.preSearch || location.state.altSearch || ''
    if (!initialQuery) return
    setPendingPreferredAniListID(Number(location.state.preferredAnilistID) || 0)
    setQuery(initialQuery)
    runSearch(initialQuery)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate, runSearch])

  const handleAddToMangaList = useCallback(async () => {
    if (!selected?.anilist_id || addingToList) return
    setAddingToList(true)
    try {
      const result = await wails.addToMangaList(
        selected.anilist_id,
        Number(selected.mal_id) || 0,
        selected.canonical_title || selected.title || '',
        selected.canonical_title_english || '',
        selected.resolved_cover_url || selected.cover_url || '',
        selected.resolved_banner_url || '',
        'WATCHING',
        0,
        Number(selected.chapters_total) || 0,
        0,
        Number(selected.volumes_total) || 0,
        0,
        Number(selected.resolved_year) || Number(selected.year) || 0,
      )
      if (result?.remote_failed > 0) {
        toastError(result.messages?.join(' ') || ui.addSyncError)
      }
      setSelected((prev) => prev ? ({
        ...prev,
        in_manga_list: true,
        manga_list_status: 'WATCHING',
      }) : prev)
    } catch (e) {
      toastError(`${ui.addError}: ${e?.message ?? ui.unknownError}`)
    } finally {
      setAddingToList(false)
    }
  }, [addingToList, selected, ui.addError, ui.addSyncError, ui.unknownError])

  if (reading) {
    return (
      <div className={`reader-transition ${readerClosing ? 'reader-exit' : 'reader-enter'}`}>
        <MangaReader
          chapterID={reading.chapterID}
          title={reading.title}
          sourceID={reading.sourceID}
          mangaID={reading.mangaID}
          chapters={reading.chapters}
          onProgressChange={handleProgressChange}
          onOpenChapter={openReader}
          onBack={() => {
            setReaderClosing(true)
            const progress = getMangaReaderProgress(reading.sourceID, reading.mangaID, reading.chapterID)
            if (progress) {
              handleProgressChange({
                chapterID: reading.chapterID,
                progressPage: progress.progress_page,
                totalPages: progress.total_pages,
              })
            }
            setTimeout(() => {
              setReading(null)
              setReaderClosing(false)
            }, 250)
          }}
        />
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="online-search-bar">
        <input
          className="online-search-input"
          placeholder={ui.searchPlaceholder(sourceMeta.label)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
          autoFocus={!selected}
        />
        <select
          className="setting-select"
          value={lang}
          onChange={(event) => setLang(event.target.value)}
          style={{ minWidth: 150 }}
          disabled={availableLangs.length === 1}
        >
          {availableLangs.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? ui.searching : ui.search}
        </button>
      </div>

      {sourceOptions.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          {sourceOptions.map((option) => (
            <button
              key={option.value}
              className={`btn ${source === option.value ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => {
                setSource(option.value)
                setResults([])
                setSearched(false)
              }}
            >
              {option.label}
              <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>{option.note}</span>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
          </div>
        </div>
      )}

      {!loading && selected && (
        <div className="fade-in">
          <div
            className="detail-hero"
            style={selectedBanner ? {
              backgroundImage: `linear-gradient(to bottom, rgba(10,10,14,0.4) 0%, rgba(10,10,14,1) 100%), url(${selectedBanner})`,
            } : {}}
          >
            <button className="btn btn-ghost detail-back" onClick={() => setSelected(null)}>
              {ui.backToResults}
            </button>
            <div className="detail-hero-content">
              {selectedCover && (
                <img src={selectedCover} alt={selected.title} className="detail-cover" />
              )}
              <div className="detail-info">
                <h1 className="detail-title">{selected.canonical_title || selected.title}</h1>
                <div className="detail-tags">
                  {(selected.resolved_year || selected.year) && <span className="badge badge-muted">{selected.resolved_year || selected.year}</span>}
                  <span className={`badge ${selectedSourceMeta.badge}`}>{selectedSourceMeta.label}</span>
                  {selected.in_manga_list && (
                    <span className="badge badge-green">{ui.myList} · {selected.manga_list_status || ui.statusWatching}</span>
                  )}
                </div>

                {selected.anilist_id > 0 && !selected.in_manga_list && (
                  <div style={{ marginTop: 12 }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleAddToMangaList}
                      disabled={addingToList}
                    >
                      {addingToList ? ui.adding : ui.addToList}
                    </button>
                  </div>
                )}

                {selectedSourceMeta.languages.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {availableLangs.map((option) => (
                      <button
                        key={option.value}
                        className={`btn ${lang === option.value ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={() => setLang(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}

                {selectedDescription && (
                  <p className="detail-synopsis" style={{ marginTop: 10 }}>{selectedDescription}</p>
                )}
              </div>
            </div>
          </div>

          <div className="episode-list-section">
            <div className="episode-section-head">
              <div>
                <div className="episode-section-kicker">{ui.onlineManga}</div>
                <span className="section-title">
                  {ui.chapters}
                  {chapters.length > 0 && (
                    <span className="badge badge-muted" style={{ marginLeft: 8 }}>{chapters.length}</span>
                  )}
                </span>
              </div>
              <p className="episode-section-copy">
                {ui.startReading}
              </p>
            </div>

            {chapLoading && (
              <div style={{ display: 'flex', gap: 6, padding: '20px 0', alignItems: 'center' }}>
                <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
                <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>
                  {ui.loadingChapters}
                </span>
              </div>
            )}

            {!chapLoading && chapters.length === 0 && (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-state-title">{ui.noChapters}</div>
                <p className="empty-state-desc">
                  {ui.noChaptersDesc}
                </p>
              </div>
            )}

            {!chapLoading && chapters.length > 0 && (
              <div className="manga-chapter-grid">
                {chapters.map((chapter) => {
                  const isResume = chapter.id === resumeChapterID
                  const isLocked = Boolean(chapter.locked)
                  const hasProgress = chapter.progress_page > 0 && !chapter.completed
                  const progressPercent = hasProgress && chapter.total_pages > 0
                    ? Math.round((chapter.progress_page / chapter.total_pages) * 100) : 0

                  return (
                    <div
                      key={chapter.id}
                      className={`manga-chapter-card${chapter.completed ? ' manga-chapter-completed' : ''}${isResume ? ' manga-chapter-resume' : ''}${isLocked ? ' manga-chapter-locked' : ''}`}
                      onClick={() => {
                        if (isLocked) return
                        openReader(chapter)
                      }}
                    >
                      <div className="manga-chapter-num">
                        <span className="manga-chapter-num-label">{chapter.number || '?'}</span>
                      </div>

                      <div className="manga-chapter-body">
                        <div className="manga-chapter-meta">
                          <span>{new Date(chapter.uploaded_at).toLocaleDateString(isEnglish ? 'en-US' : 'es-CL')}</span>
                          {isLocked && <span>{chapter.price > 0 ? ui.coinLabel(chapter.price) : ui.locked}</span>}
                          {hasProgress && <span>{progressPercent}%</span>}
                          {chapter.completed && <span>✓ {ui.completed}</span>}
                        </div>
                        <div className="manga-chapter-title">{chapter.title}</div>
                        {hasProgress && (
                          <div className="manga-chapter-progress">
                            <div className="manga-chapter-progress-fill" style={{ width: `${progressPercent}%` }} />
                          </div>
                        )}
                      </div>

                      <div className="manga-chapter-actions">
                        <button
                          className={`btn ${isLocked ? 'btn-ghost' : chapter.completed ? 'btn-ghost manga-btn-completed' : isResume ? 'btn-primary manga-btn-continue' : 'btn-primary'} episode-play-btn`}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (isLocked) return
                            openReader(chapter)
                          }}
                          disabled={isLocked}
                        >
                          {isLocked ? ui.locked : chapter.completed ? `✓ ${ui.read}` : isResume ? `▶ ${ui.continue}` : ui.readNow}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && !selected && searched && results.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">{ui.noResults}</div>
          <p className="empty-state-desc">
            {ui.noResultsDesc(query, sourceMeta.label)}
          </p>
        </div>
      )}

      {!loading && !selected && results.length > 0 && (
        <>
          <div className="section-header">
            <span className="section-title">
              {ui.results}
              <span className="badge badge-muted" style={{ marginLeft: 8 }}>{results.length}</span>
            </span>
            <span className={`badge ${sourceMeta.badge}`} style={{ marginLeft: 8 }}>{sourceMeta.label}</span>
          </div>
          <div className="media-grid">
            {results.map((item) => (
              <div
                key={item.id}
                className="media-card"
                onClick={() => setSelected({ ...item, source_id: item.source_id ?? source })}
              >
                {(item.resolved_cover_url || item.cover_url)
                  ? <img
                      src={proxyImage(item.resolved_cover_url || item.cover_url, { sourceID: item.source_id ?? source })}
                      alt={item.title}
                      className="media-card-cover"
                    />
                  : <div className="media-card-cover-placeholder">{ui.noCover}</div>}
                <div className="media-card-overlay" />
                <div className="media-card-body">
                  <div className="media-card-title">{item.title}</div>
                  <div className="media-card-meta">{item.year || ''}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !searched && !selected && (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>📖</div>
          <h2 className="empty-state-title">{ui.emptyTitle}</h2>
          <p className="empty-state-desc">
            {ui.emptyDesc}
          </p>
        </div>
      )}
    </div>
  )
}
