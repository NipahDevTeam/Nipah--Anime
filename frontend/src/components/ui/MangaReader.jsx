import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { proxyImage, wails } from '../../lib/wails'
import {
  getMangaReaderProgress,
  getSavedReaderViewMode,
  markMangaReaderChapterCompleted,
  saveMangaReaderProgress,
  saveReaderViewMode,
} from '../../lib/mangaReaderProgress'
import { useI18n } from '../../lib/i18n'

const INITIAL_VERTICAL_PAGE_BATCH = 8
const VERTICAL_PAGE_BATCH_STEP = 6
const VERTICAL_NEAR_END_PX = 1400

export default function MangaReader({
  chapterID,
  title,
  onBack,
  sourceID = 'mangadex-es',
  mangaID = '',
  chapters = [],
  onOpenChapter = null,
  onProgressChange = null,
}) {
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('vertical')
  const [currentPage, setCurrentPage] = useState(0)
  const [dataSaver, setDataSaver] = useState(false)
  const [rtl, setRtl] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [viewMode, setViewMode] = useState(getSavedReaderViewMode)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VERTICAL_PAGE_BATCH)

  const hideTimer = useRef(null)
  const persistTimer = useRef(null)
  const scrollFrame = useRef(0)
  const currentPageRef = useRef(0)
  const pageRefs = useRef([])
  const verticalRef = useRef(null)
  const restoredRef = useRef(false)

  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterID)
  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null
  const nextChapter = chapterIndex >= 0 ? chapters[chapterIndex + 1] ?? null : null
  const renderedPages = useMemo(() => pages.slice(0, visibleCount), [pages, visibleCount])

  const persistProgress = useCallback((pageIndex) => {
    if (!chapterID || pages.length === 0) return
    const progressPage = Math.min(Math.max(pageIndex + 1, 1), pages.length)
    saveMangaReaderProgress({
      sourceID,
      mangaID,
      chapterID,
      progressPage,
      totalPages: pages.length,
    })
    onProgressChange?.({
      chapterID,
      progressPage,
      totalPages: pages.length,
    })
  }, [chapterID, mangaID, onProgressChange, pages.length, sourceID])

  const schedulePersist = useCallback((pageIndex) => {
    clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistProgress(pageIndex)
    }, 180)
  }, [persistProgress])

  const jumpToChapter = useCallback((chapter) => {
    if (!chapter || !onOpenChapter) return
    onOpenChapter(chapter)
  }, [onOpenChapter])

  const handleNextChapter = useCallback(async () => {
    if (!nextChapter) return

    markMangaReaderChapterCompleted(sourceID, mangaID, chapterID, pages.length)
    onProgressChange?.({
      chapterID,
      progressPage: pages.length,
      totalPages: pages.length,
      completed: true,
    })

    try {
      await wails.markMangaChapterCompleted(sourceID, chapterID)
    } catch {}

    jumpToChapter(nextChapter)
  }, [chapterID, jumpToChapter, mangaID, nextChapter, onProgressChange, pages.length, sourceID])

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    wails.getSettings().then((settings) => {
      if (!settings) return
      if (settings.data_saver === 'true') setDataSaver(true)
      if (settings.manga_reading_direction === 'rtl') {
        setRtl(true)
        setMode('paged')
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setPages([])
    setCurrentPage(0)
    setVisibleCount(INITIAL_VERTICAL_PAGE_BATCH)
    restoredRef.current = false
    pageRefs.current = []

    wails.getChapterPagesSource(sourceID, chapterID, dataSaver)
      .then((loadedPages) => {
        const nextPages = (loadedPages ?? []).map((page, index) => ({
          ...page,
          proxy_url: proxyImage(page.url, { sourceID }),
          key: page.index ?? index,
        }))
        setPages(nextPages)

        const saved = getMangaReaderProgress(sourceID, mangaID, chapterID)
        if (saved?.progress_page > 1 && saved.progress_page <= nextPages.length) {
          setCurrentPage(saved.progress_page - 1)
          setVisibleCount(Math.max(INITIAL_VERTICAL_PAGE_BATCH, saved.progress_page + 2))
        }
      })
      .catch((e) => setError(e?.message ?? (isEnglish ? 'Error loading pages' : 'Error al cargar paginas')))
      .finally(() => setLoading(false))
  }, [chapterID, dataSaver, isEnglish, mangaID, sourceID])

  useEffect(() => {
    saveReaderViewMode(viewMode)
  }, [viewMode])

  useEffect(() => {
    const handler = (event) => {
      if (mode !== 'paged') return
      const next = rtl ? 'ArrowLeft' : 'ArrowRight'
      const prev = rtl ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === next || event.key === 'ArrowDown') {
        setCurrentPage((page) => Math.min(page + 1, pages.length - 1))
      }
      if (event.key === prev || event.key === 'ArrowUp') {
        setCurrentPage((page) => Math.max(page - 1, 0))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode, pages.length, rtl])

  useEffect(() => {
    if (loading || error || mode !== 'vertical' || pages.length === 0 || restoredRef.current) return
    restoredRef.current = true

    const saved = getMangaReaderProgress(sourceID, mangaID, chapterID)
    const savedIndex = (saved?.progress_page ?? 1) - 1
    if (savedIndex <= 0) {
      schedulePersist(0)
      return
    }

    const timeout = window.setTimeout(() => {
      const node = pageRefs.current[savedIndex]
      if (node) {
        node.scrollIntoView({ block: 'start' })
      }
      setCurrentPage(savedIndex)
      schedulePersist(savedIndex)
    }, 80)

    return () => window.clearTimeout(timeout)
  }, [chapterID, error, loading, mangaID, mode, pages.length, schedulePersist, sourceID])

  useEffect(() => {
    if (loading || error || pages.length === 0 || mode !== 'paged') return
    schedulePersist(currentPage)
  }, [currentPage, error, loading, mode, pages.length, schedulePersist])

  useEffect(() => {
    if (mode !== 'paged' || pages.length === 0) return

    const preloadTargets = [pages[currentPage - 1], pages[currentPage + 1]].filter(Boolean)
    preloadTargets.forEach((page) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = page.proxy_url
    })
  }, [currentPage, mode, pages])

  useEffect(() => {
    return () => {
      clearTimeout(hideTimer.current)
      clearTimeout(persistTimer.current)
      if (scrollFrame.current) {
        window.cancelAnimationFrame(scrollFrame.current)
      }
      if (pages.length > 0) {
        persistProgress(currentPageRef.current)
      }
    }
  }, [pages.length, persistProgress])

  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimer.current)
    if (mode === 'vertical') {
      hideTimer.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [mode])

  useEffect(() => {
    if (mode === 'vertical') resetHideTimer()
    else setShowControls(true)
    return () => clearTimeout(hideTimer.current)
  }, [mode, resetHideTimer])

  const handleVerticalScroll = useCallback(() => {
    const container = verticalRef.current
    if (!container || pageRefs.current.length === 0) return

    if (scrollFrame.current) return

    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = 0

      const marker = container.scrollTop + (container.clientHeight * 0.35)
      let visibleIndex = 0

      for (let index = 0; index < pageRefs.current.length; index += 1) {
        const node = pageRefs.current[index]
        if (!node) continue
        if (node.offsetTop <= marker) {
          visibleIndex = index
          continue
        }
        break
      }

      if (container.scrollTop + container.clientHeight >= container.scrollHeight - VERTICAL_NEAR_END_PX) {
        setVisibleCount((count) => Math.min(count + VERTICAL_PAGE_BATCH_STEP, pages.length))
      }

      setCurrentPage((page) => (page === visibleIndex ? page : visibleIndex))
      schedulePersist(visibleIndex)
    })
  }, [pages.length, schedulePersist])

  return (
    <div
      className={`reader-root reader-size-${viewMode}`}
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
    >
      <div className={`reader-controls ${showControls ? 'visible' : 'hidden'}`}>
        <div className="reader-controls-left">
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              persistProgress(currentPageRef.current)
              onBack()
            }}
          >
            {isEnglish ? '← Back' : '← Volver'}
          </button>
          {prevChapter && (
            <button
              className="btn btn-ghost reader-nav-btn"
              onClick={() => jumpToChapter(prevChapter)}
              title={isEnglish ? 'Previous chapter' : 'Capitulo anterior'}
            >
              ‹
            </button>
          )}
          {nextChapter && (
            <button
              className="btn btn-ghost reader-nav-btn"
              onClick={handleNextChapter}
              title={isEnglish ? 'Next chapter' : 'Siguiente capitulo'}
            >
              ›
            </button>
          )}
          <span className="reader-title">{title}</span>
          {pages.length > 0 && (
            <span className="reader-page-indicator">
              {currentPage + 1} / {pages.length}
            </span>
          )}
        </div>

        <div className="reader-controls-right">
          <div className="reader-button-group">
            <button
              className={`btn ${mode === 'vertical' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => setMode('vertical')}
              title={isEnglish ? 'Vertical scroll' : 'Scroll vertical'}
            >
              Scroll
            </button>
            <button
              className={`btn ${mode === 'paged' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => setMode('paged')}
              title={isEnglish ? 'Page by page' : 'Pagina por pagina'}
            >
              {isEnglish ? 'Pages' : 'Paginas'}
            </button>
          </div>

          <span className="reader-controls-sep" />

          <div className="reader-button-group">
            <button
              className={`btn ${viewMode === 'fit' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => setViewMode('fit')}
              title={isEnglish ? 'Fit' : 'Encajar'}
            >
              {isEnglish ? 'Fit' : 'Encajar'}
            </button>
            <button
              className={`btn ${viewMode === 'cover' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => setViewMode('cover')}
              title={isEnglish ? 'Cover' : 'Cubrir'}
            >
              {isEnglish ? 'Cover' : 'Cubrir'}
            </button>
            <button
              className={`btn ${viewMode === 'actual' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => setViewMode('actual')}
              title={isEnglish ? 'Actual size' : 'Tamano real'}
            >
              {isEnglish ? 'Actual' : 'Tamano real'}
            </button>
          </div>

          <span className="reader-controls-sep" />

          <button
            className={`btn ${dataSaver ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: 11, padding: '5px 10px' }}
            onClick={() => setDataSaver((value) => !value)}
            title={dataSaver ? (isEnglish ? 'Compressed quality enabled' : 'Calidad comprimida activa') : (isEnglish ? 'Full quality' : 'Calidad completa')}
          >
            {dataSaver ? (isEnglish ? 'Saver' : 'Ahorro') : 'HD'}
          </button>

          {mode === 'paged' && (
            <button
              className={`btn ${rtl ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => setRtl((value) => !value)}
              title={rtl ? (isEnglish ? 'Right to left' : 'Derecha a izquierda') : (isEnglish ? 'Left to right' : 'Izquierda a derecha')}
            >
              {rtl ? 'JP' : 'ES'}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="reader-loading">
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
            {isEnglish ? 'Loading pages...' : 'Cargando paginas...'}
          </span>
        </div>
      )}

      {error && (
        <div className="reader-loading">
          <p style={{ color: 'var(--red)' }}>{error}</p>
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onBack}>
            {isEnglish ? 'Back' : 'Volver'}
          </button>
        </div>
      )}

      {!loading && !error && mode === 'vertical' && (
        <div
          ref={verticalRef}
          className="reader-vertical"
          onScroll={handleVerticalScroll}
        >
          {renderedPages.map((page, index) => (
            <img
              key={page.key}
              ref={(node) => { pageRefs.current[index] = node }}
              src={page.proxy_url}
              alt={`${isEnglish ? 'Page' : 'Pagina'} ${index + 1}`}
              className="reader-page-vertical"
              loading="lazy"
              decoding="async"
            />
          ))}

          {visibleCount < pages.length && (
            <div className="reader-loadmore-shell">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setVisibleCount((count) => Math.min(count + VERTICAL_PAGE_BATCH_STEP, pages.length))}
              >
                {isEnglish ? `Load more pages (${pages.length - visibleCount} left)` : `Cargar mas paginas (${pages.length - visibleCount} restantes)`}
              </button>
            </div>
          )}

          <div className="reader-end-marker">
            <span>{isEnglish ? 'End of chapter' : 'Fin del capitulo'}</span>
            <div className="reader-end-actions">
              {nextChapter && (
                <button
                  className="btn btn-primary"
                  onClick={handleNextChapter}
                >
                  {isEnglish ? 'Next chapter' : 'Siguiente capitulo'}
                </button>
              )}
              <button className="btn btn-ghost" onClick={onBack}>
                {isEnglish ? 'Back to list' : 'Volver a la lista'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && mode === 'paged' && pages.length > 0 && (
        <div className="reader-paged">
          <img
            key={pages[currentPage]?.proxy_url}
            src={pages[currentPage]?.proxy_url}
            alt={`${isEnglish ? 'Page' : 'Pagina'} ${currentPage + 1}`}
            className="reader-page-single"
            decoding="async"
          />

          <div
            className="reader-zone reader-zone-prev"
            onClick={() => rtl
              ? setCurrentPage((page) => Math.min(page + 1, pages.length - 1))
              : setCurrentPage((page) => Math.max(page - 1, 0))}
          />
          <div
            className="reader-zone reader-zone-next"
            onClick={() => rtl
              ? setCurrentPage((page) => Math.max(page - 1, 0))
              : setCurrentPage((page) => Math.min(page + 1, pages.length - 1))}
          />

          <button
            className="reader-arrow reader-arrow-prev"
            onClick={() => rtl
              ? setCurrentPage((page) => Math.min(page + 1, pages.length - 1))
              : setCurrentPage((page) => Math.max(page - 1, 0))}
            disabled={rtl ? currentPage === pages.length - 1 : currentPage === 0}
          >
            ‹
          </button>
          <button
            className="reader-arrow reader-arrow-next"
            onClick={() => rtl
              ? setCurrentPage((page) => Math.max(page - 1, 0))
              : setCurrentPage((page) => Math.min(page + 1, pages.length - 1))}
            disabled={rtl ? currentPage === 0 : currentPage === pages.length - 1}
          >
            ›
          </button>

          {currentPage === pages.length - 1 && nextChapter && (
            <div className="reader-next-card">
              <div className="reader-next-label">{isEnglish ? 'Chapter finished' : 'Capitulo terminado'}</div>
              <button
                className="btn btn-primary"
                onClick={handleNextChapter}
              >
                {isEnglish ? 'Go to next' : 'Ir al siguiente'}
              </button>
            </div>
          )}
        </div>
      )}

      {pages.length > 0 && (
        <div className="reader-bottom-progress">
          <div
            className="reader-bottom-progress-fill"
            style={{ width: `${((currentPage + 1) / pages.length) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
