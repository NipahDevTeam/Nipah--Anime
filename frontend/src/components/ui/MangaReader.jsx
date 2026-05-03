import { useState, useEffect, useCallback, useRef, useMemo, startTransition } from 'react'
import { proxyImage, wails } from '../../lib/wails'
import {
  markMangaReaderChapterCompleted,
  saveMangaReaderProgress,
} from '../../lib/mangaReaderProgress'
import { useI18n } from '../../lib/i18n'
import {
  getReaderCanvasPageLayout,
  getReaderCanvasVariables,
  getReaderScrollSheetVariables,
  getReaderViewMode,
  getReaderViewport,
  getSavedReaderBookmark,
  getSavedReaderSettings,
  normalizeReaderPages,
  normalizeReaderSettings,
  saveReaderSettings,
  stepReaderIndex,
  toggleReaderBookmark,
} from './mangaReaderLayout'

const INITIAL_VERTICAL_PAGE_BATCH = 8
const VERTICAL_PAGE_BATCH_STEP = 6
const VERTICAL_NEAR_END_PX = 1400
const READER_PAGE_PRELOAD_TIMEOUT_MS = 9000

function ReaderIcon({ kind }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.45,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  switch (kind) {
    case 'back':
      return <svg {...common}><path d="m9.8 3.2-4.1 4.8 4.1 4.8" /></svg>
    case 'chapter-prev':
      return <svg {...common}><path d="M10.7 3.4 6 8l4.7 4.6" /><path d="M5 3.4 5 12.6" /></svg>
    case 'chapter-next':
      return <svg {...common}><path d="M5.3 3.4 10 8l-4.7 4.6" /><path d="M11 3.4 11 12.6" /></svg>
    case 'bookmark':
      return <svg {...common}><path d="M4.4 2.8h7.2v10l-3.6-2.2-3.6 2.2z" /></svg>
    case 'bookmark-filled':
      return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.4 2.8h7.2v10l-3.6-2.2-3.6 2.2z" /></svg>
    case 'reload':
      return <svg {...common}><path d="M12.2 5.4A4.8 4.8 0 1 0 13 8" /><path d="M12.2 2.8v2.8H9.4" /></svg>
    case 'fullscreen':
      return <svg {...common}><path d="M5.4 2.8H2.8v2.6" /><path d="M10.6 2.8h2.6v2.6" /><path d="M13.2 10.6v2.6h-2.6" /><path d="M5.4 13.2H2.8v-2.6" /></svg>
    case 'settings':
      return <svg {...common}><path d="M7.9 2.5v1.2M7.9 12.3v1.2M13.3 7.9h-1.2M3.5 7.9H2.3M11.6 4.1l-.9.9M5.1 10.6l-.9.9M11.6 11.7l-.9-.9M5.1 5.2l-.9-.9" /><circle cx="7.9" cy="7.9" r="2.1" /></svg>
    case 'scroll':
      return <svg {...common}><path d="M4 4.1h8M4 8h8M4 11.9h8" /></svg>
    case 'paged':
      return <svg {...common}><path d="M4 3.5h3.6v9H4z" /><path d="M8.4 3.5H12v9H8.4z" /></svg>
    case 'double':
      return <svg {...common}><path d="M3.2 3.5h4v9h-4z" /><path d="M8.8 3.5h4v9h-4z" /><path d="M8 3.5v9" /></svg>
    case 'width':
      return <svg {...common}><path d="M2.8 8h10.4" /><path d="m4.5 6.2-1.7 1.8 1.7 1.8" /><path d="m11.5 6.2 1.7 1.8-1.7 1.8" /></svg>
    case 'height':
      return <svg {...common}><path d="M8 2.8v10.4" /><path d="m6.2 4.5 1.8-1.7 1.8 1.7" /><path d="m6.2 11.5 1.8 1.7 1.8-1.7" /></svg>
    case 'original':
      return <svg {...common}><rect x="3" y="3" width="10" height="10" rx="1.4" /><path d="M5.3 5.3h5.4v5.4H5.3z" /></svg>
    case 'sun':
      return <svg {...common}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.9v1.6M8 12.5v1.6M14.1 8h-1.6M3.5 8H1.9M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6" /></svg>
    case 'contrast':
      return <svg {...common}><path d="M8 2.6a5.4 5.4 0 1 0 0 10.8V2.6Z" /><circle cx="8" cy="8" r="5.4" /></svg>
    case 'close':
      return <svg {...common}><path d="m4 4 8 8M12 4l-8 8" /></svg>
    case 'minus':
      return <svg {...common}><path d="M3.4 8h9.2" /></svg>
    case 'plus':
      return <svg {...common}><path d="M3.4 8h9.2M8 3.4v9.2" /></svg>
    case 'expand':
      return <svg {...common}><path d="M5 5 3 3M11 5l2-2M5 11l-2 2M11 11l2 2" /></svg>
    default:
      return <svg {...common}><circle cx="8" cy="8" r="5" /></svg>
  }
}

function ReaderToggleButton({ active, icon, label, onClick }) {
  return (
    <button type="button" className={`reader-toggle-btn${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className="reader-toggle-icon"><ReaderIcon kind={icon} /></span>
      <span>{label}</span>
    </button>
  )
}

function ReaderIconButton({ icon, active = false, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`reader-icon-btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <ReaderIcon kind={icon} />
    </button>
  )
}

function ReaderSliderRow({ label, icon, value, min, max, step = 1, suffix = '', onChange }) {
  return (
    <div className="reader-settings-row">
      <div className="reader-settings-row-head">
        <span className="reader-settings-icon"><ReaderIcon kind={icon} /></span>
        <span>{label}</span>
      </div>
      <div className="reader-slider-wrap">
        <input
          type="range"
          className="reader-slider"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="reader-slider-value">{value}{suffix}</span>
      </div>
    </div>
  )
}

function preloadReaderPage(page) {
  return new Promise((resolve) => {
    if (!page?.proxy_url) {
      resolve()
      return
    }

    const image = new Image()
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, READER_PAGE_PRELOAD_TIMEOUT_MS)
    image.onload = finish
    image.onerror = finish
    image.decoding = 'async'
    image.src = page.proxy_url
  })
}

function ReaderPageSheet({ page, alt, pageStyle, pageMediaStyle, sheetClassName = '', onImageLoad = null }) {
  return (
    <div className={`reader-page-sheet${sheetClassName ? ` ${sheetClassName}` : ''}`} style={pageStyle}>
      <img
        src={page.proxy_url}
        alt={alt}
        className="reader-page-media"
        style={pageMediaStyle}
        onLoad={onImageLoad}
        loading="lazy"
        decoding="async"
      />
    </div>
  )
}

export default function MangaReader({
  chapterID,
  title,
  onBack,
  sourceID = 'mangadex-es',
  mangaID = '',
  chapters = [],
  contentFormat = '',
  countryOfOrigin = '',
  onOpenChapter = null,
  onProgressChange = null,
}) {
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [dataSaver, setDataSaver] = useState(false)
  const [readerSettings, setReaderSettings] = useState(getSavedReaderSettings)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VERTICAL_PAGE_BATCH)
  const [transitioningChapterID, setTransitioningChapterID] = useState('')
  const [uiVisible, setUiVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [bookmark, setBookmark] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [spreadSize, setSpreadSize] = useState({ width: 0, height: 0 })
  const [pageIntrinsicSizes, setPageIntrinsicSizes] = useState({})

  const hideTimer = useRef(null)
  const persistTimer = useRef(null)
  const scrollFrame = useRef(0)
  const currentPageRef = useRef(0)
  const pageRefs = useRef([])
  const verticalRef = useRef(null)
  const spreadRef = useRef(null)

  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterID)
  const currentChapter = chapterIndex >= 0 ? chapters[chapterIndex] ?? null : null
  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null
  const nextChapter = chapterIndex >= 0 ? chapters[chapterIndex + 1] ?? null : null
  const renderedPages = useMemo(() => pages.slice(0, visibleCount), [pages, visibleCount])
  const viewport = useMemo(() => getReaderViewport({
    readingMode: readerSettings.readingMode,
    currentPage,
    totalPages: pages.length,
  }), [currentPage, pages.length, readerSettings.readingMode])

  const progressPage = viewport.visiblePages.length
    ? viewport.visiblePages[viewport.visiblePages.length - 1] + 1
    : Math.min(currentPage + 1, pages.length || 1)
  const qualityLabel = dataSaver ? (isEnglish ? 'Saver' : 'Ahorro') : 'HD'
  const { continuousScrollMode, stripReadingMode, effectivePageFit, stripPageFitPreset } = useMemo(() => getReaderViewMode({
    readingMode: readerSettings.readingMode,
    pageFit: readerSettings.pageFit,
    contentFormat,
    countryOfOrigin,
  }), [contentFormat, countryOfOrigin, readerSettings.pageFit, readerSettings.readingMode])

  const persistProgress = useCallback((pageIndex) => {
    if (!chapterID || pages.length === 0) return
    const progressValue = Math.min(Math.max(pageIndex + 1, 1), pages.length)
    saveMangaReaderProgress({
      sourceID,
      mangaID,
      chapterID,
      progressPage: progressValue,
      totalPages: pages.length,
    })
    onProgressChange?.({
      chapterID,
      progressPage: progressValue,
      totalPages: pages.length,
    })
  }, [chapterID, mangaID, onProgressChange, pages.length, sourceID])

  const schedulePersist = useCallback((pageIndex) => {
    clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistProgress(pageIndex)
    }, 180)
  }, [persistProgress])

  const resetReaderViewportToStart = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    if (verticalRef.current) {
      verticalRef.current.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
    const firstPage = pageRefs.current[0]
    if (firstPage) {
      firstPage.scrollIntoView({ block: 'start' })
    }
    setCurrentPage(0)
    if (pages.length > 0) {
      schedulePersist(0)
    }
  }, [pages.length, schedulePersist])

  const preserveReaderViewport = useCallback((pageIndex = currentPageRef.current) => {
    const safeIndex = Math.max(0, Math.min(pageIndex, Math.max(pageRefs.current.length - 1, 0)))
    const restore = () => {
      if (readerSettings.readingMode === 'scroll') {
        const node = pageRefs.current[safeIndex]
        if (node) {
          node.scrollIntoView({ block: 'start' })
        }
      }
      setCurrentPage(safeIndex)
      currentPageRef.current = safeIndex
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(restore)
    })
  }, [readerSettings.readingMode])

  const updateReaderSettings = useCallback((patch) => {
    setReaderSettings((current) => normalizeReaderSettings({ ...current, ...patch }))
  }, [])

  const handleReaderPageLoad = useCallback((pageKey, event) => {
    const naturalWidth = Number(event?.currentTarget?.naturalWidth) || 0
    const naturalHeight = Number(event?.currentTarget?.naturalHeight) || 0
    if (!pageKey || !naturalWidth || !naturalHeight) return

    setPageIntrinsicSizes((current) => {
      const existing = current[pageKey]
      if (existing?.naturalWidth === naturalWidth && existing?.naturalHeight === naturalHeight) {
        return current
      }
      return {
        ...current,
        [pageKey]: { naturalWidth, naturalHeight },
      }
    })
  }, [])

  const stopEvent = useCallback((event) => {
    event.stopPropagation()
  }, [])

  const jumpToChapter = useCallback((chapter) => {
    if (!chapter || !onOpenChapter) return
    onOpenChapter(chapter)
  }, [onOpenChapter])

  const refreshChapter = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleToggleBookmark = useCallback(() => {
    const nextBookmark = toggleReaderBookmark({
      sourceID,
      mangaID,
      chapterID,
      progressPage,
    })
    setBookmark(nextBookmark)
  }, [chapterID, mangaID, progressPage, sourceID])

  const handleNextChapter = useCallback(async () => {
    if (!nextChapter || transitioningChapterID) return

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

    setTransitioningChapterID(nextChapter.id)
    try {
      await wails.getChapterPagesSource(sourceID, nextChapter.id, dataSaver)
    } catch {}
    jumpToChapter(nextChapter)
  }, [chapterID, dataSaver, jumpToChapter, mangaID, nextChapter, onProgressChange, pages.length, sourceID, transitioningChapterID])

  const handlePageStep = useCallback((direction) => {
    startTransition(() => {
      setCurrentPage((page) => stepReaderIndex({
        readingMode: readerSettings.readingMode,
        currentPage: page,
        totalPages: pages.length,
        direction,
      }))
    })
  }, [pages.length, readerSettings.readingMode])

  const handleSliderJump = useCallback((nextPageNumber) => {
    const nextIndex = Math.max(0, Math.min((Number(nextPageNumber) || 1) - 1, Math.max(pages.length - 1, 0)))
    if (readerSettings.readingMode === 'scroll') {
      const node = pageRefs.current[nextIndex]
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      setCurrentPage(nextIndex)
      schedulePersist(nextIndex)
      return
    }
    setCurrentPage(nextIndex)
  }, [pages.length, readerSettings.readingMode, schedulePersist])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {}
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    saveReaderSettings(readerSettings)
  }, [readerSettings])

  useEffect(() => {
    const savedBookmark = getSavedReaderBookmark(sourceID, mangaID, chapterID)
    setBookmark(savedBookmark)
  }, [chapterID, mangaID, sourceID])

  useEffect(() => {
    wails.getSettings().then((settings) => {
      if (!settings) return
      if (settings.data_saver === 'true') setDataSaver(true)
      if (settings.manga_reading_direction === 'rtl') {
        setReaderSettings((current) => normalizeReaderSettings({
          ...current,
          readingDirection: current.readingDirection || 'rtl',
        }))
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setPages([])
    setCurrentPage(0)
    setVisibleCount(INITIAL_VERTICAL_PAGE_BATCH)
    setTransitioningChapterID('')
    setPageIntrinsicSizes({})
    pageRefs.current = []

    ;(async () => {
      const loadedPages = await wails.getChapterPagesSource(sourceID, chapterID, dataSaver)
        const nextPages = normalizeReaderPages(loadedPages, chapterID).map((page) => ({
          ...page,
          proxy_url: proxyImage(page.url, { sourceID }),
        }))
        await Promise.allSettled(nextPages.map(preloadReaderPage))
        setPages(nextPages)
        setCurrentPage(0)
        setVisibleCount(nextPages.length || INITIAL_VERTICAL_PAGE_BATCH)
      })()
      .catch((e) => setError(e?.message ?? (isEnglish ? 'Error loading pages' : 'Error al cargar paginas')))
      .finally(() => setLoading(false))
  }, [chapterID, dataSaver, isEnglish, mangaID, reloadToken, sourceID])

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') {
        if (readerSettings.settingsOpen) {
          updateReaderSettings({ settingsOpen: false })
        } else if (document.fullscreenElement) {
          void document.exitFullscreen()
        }
        return
      }

      if (event.key.toLowerCase() === 'f') {
        void toggleFullscreen()
        return
      }

      const useForward = readerSettings.readingDirection === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const useBackward = readerSettings.readingDirection === 'rtl' ? 'ArrowRight' : 'ArrowLeft'

      if (readerSettings.readingMode !== 'scroll') {
        if (event.key === useForward || event.key === 'ArrowDown') {
          handlePageStep('next')
        }
        if (event.key === useBackward || event.key === 'ArrowUp') {
          handlePageStep('prev')
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handlePageStep, readerSettings.readingDirection, readerSettings.readingMode, readerSettings.settingsOpen, toggleFullscreen, updateReaderSettings])

  useEffect(() => {
    if (loading || error || pages.length === 0) return

    const timeout = window.setTimeout(() => {
      resetReaderViewportToStart()
    }, 40)

    return () => window.clearTimeout(timeout)
  }, [chapterID, error, loading, pages.length, readerSettings.readingMode, resetReaderViewportToStart])

  useEffect(() => {
    if (loading || error || pages.length === 0) return
    preserveReaderViewport()
  }, [error, loading, pages.length, preserveReaderViewport, readerSettings.pageFit, readerSettings.readingMode, readerSettings.zoomPercent])

  useEffect(() => {
    if (loading || error || pages.length === 0 || readerSettings.readingMode === 'scroll') return
    schedulePersist(viewport.endIndex)
  }, [error, loading, pages.length, readerSettings.readingMode, schedulePersist, viewport.endIndex])

  useEffect(() => {
    if (readerSettings.readingMode === 'scroll' || pages.length === 0) return

    const preloadTargets = [
      pages[viewport.startIndex - 1],
      pages[viewport.endIndex + 1],
      pages[viewport.endIndex + 2],
    ].filter(Boolean)

    preloadTargets.forEach((page) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = page.proxy_url
    })
  }, [pages, readerSettings.readingMode, viewport.endIndex, viewport.startIndex])

  useEffect(() => {
    const node = spreadRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined

    const updateSpreadSize = () => {
      const rect = node.getBoundingClientRect()
      setSpreadSize((current) => {
        const nextWidth = Math.round(rect.width)
        const nextHeight = Math.round(rect.height)
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return { width: nextWidth, height: nextHeight }
      })
    }

    updateSpreadSize()
    const observer = new ResizeObserver(() => {
      updateSpreadSize()
    })
    observer.observe(node)

    return () => observer.disconnect()
  }, [pages.length, readerSettings.readingMode, readerSettings.settingsOpen])

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
    clearTimeout(hideTimer.current)
    if (!readerSettings.autoHideUI || readerSettings.settingsOpen || !uiVisible) return
    hideTimer.current = setTimeout(() => setUiVisible(false), readerSettings.autoHideDelaySec * 1000)
  }, [readerSettings.autoHideDelaySec, readerSettings.autoHideUI, readerSettings.settingsOpen, uiVisible])

  const toggleReaderChrome = useCallback(() => {
    setUiVisible((current) => {
      const next = !current
      clearTimeout(hideTimer.current)
      if (next && readerSettings.autoHideUI && !readerSettings.settingsOpen) {
        hideTimer.current = setTimeout(() => setUiVisible(false), readerSettings.autoHideDelaySec * 1000)
      }
      return next
    })
  }, [readerSettings.autoHideDelaySec, readerSettings.autoHideUI, readerSettings.settingsOpen])

  useEffect(() => {
    if (!readerSettings.autoHideUI) {
      clearTimeout(hideTimer.current)
      return undefined
    }

    if (uiVisible) {
      resetHideTimer()
    }
    return () => clearTimeout(hideTimer.current)
  }, [readerSettings.autoHideUI, readerSettings.settingsOpen, resetHideTimer, uiVisible])

  useEffect(() => {
    document.body.classList.add('reader-active')
    return () => {
      document.body.classList.remove('reader-active')
    }
  }, [])

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

  const pageImageStyle = useMemo(() => {
    const filterParts = [
      `brightness(${1 + (readerSettings.brightness / 100)})`,
      `contrast(${1 + (readerSettings.contrast / 100)})`,
    ]
    if (readerSettings.enhance) {
      filterParts.push('grayscale(0.02)')
      filterParts.push('contrast(1.04)')
    }
    return {
      filter: filterParts.join(' '),
    }
  }, [readerSettings.brightness, readerSettings.contrast, readerSettings.enhance])

  const scrollSheetStyle = useMemo(() => {
    return getReaderScrollSheetVariables({
      stripReadingMode,
      stripPageFitPreset,
      effectivePageFit,
      zoomPercent: readerSettings.zoomPercent,
    })
  }, [effectivePageFit, readerSettings.zoomPercent, stripPageFitPreset, stripReadingMode])

  const readerCanvasStyle = useMemo(() => {
    return getReaderCanvasVariables({
      effectivePageFit,
      zoomPercent: readerSettings.zoomPercent,
    })
  }, [effectivePageFit, readerSettings.zoomPercent])

  const pagedSlotMetrics = useMemo(() => {
    const columnCount = readerSettings.readingMode === 'double' ? 2 : 1
    const spreadGap = readerSettings.readingMode === 'double' ? 18 : 0
    const safeSpreadWidth = Math.max(0, spreadSize.width - (spreadGap * (columnCount - 1)))

    return {
      width: columnCount > 0 ? safeSpreadWidth / columnCount : 0,
      height: spreadSize.height,
    }
  }, [readerSettings.readingMode, spreadSize.height, spreadSize.width])

  return (
    <div
      className={`reader-shell-v2${isFullscreen ? ' is-fullscreen' : ''}${uiVisible ? ' reader-ui-visible' : ' reader-ui-hidden'}${readerSettings.settingsOpen ? ' settings-open' : ' settings-closed'}${stripReadingMode ? ' reader-shell-v2--strip' : ''} reader-mode-${readerSettings.readingMode}`}
    >
      <header className="reader-topbar-v2" onClick={stopEvent}>
        <div className="reader-topbar-left">
          <ReaderIconButton icon="back" label={isEnglish ? 'Back to chapter list' : 'Volver a la lista'} onClick={() => {
            persistProgress(viewport.endIndex)
            onBack()
          }} />
          <div className="reader-title-stack">
            <div className="reader-series-title">{title}</div>
            <div className="reader-chapter-line">
              <span>{currentChapter?.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${currentChapter?.number || chapterIndex + 1 || ''}`}</span>
              {chapters.length > 0 ? (
                <label className="reader-chapter-select-shell">
                  <select className="reader-chapter-select" value={chapterID} onChange={(event) => {
                    const next = chapters.find((chapter) => chapter.id === event.target.value)
                    if (next) jumpToChapter(next)
                  }}>
                    {chapters.map((chapter, index) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${chapter.number || index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>
        </div>

        <div className="reader-topbar-center">
          <div className="reader-toggle-group">
            <ReaderToggleButton active={readerSettings.readingMode === 'scroll'} icon="scroll" label="Scroll" onClick={() => updateReaderSettings({ readingMode: 'scroll' })} />
            <ReaderToggleButton active={readerSettings.readingMode === 'paged'} icon="paged" label="Paged" onClick={() => updateReaderSettings({ readingMode: 'paged' })} />
            <ReaderToggleButton active={readerSettings.readingMode === 'double'} icon="double" label="Double Page" onClick={() => updateReaderSettings({ readingMode: 'double' })} />
          </div>
        </div>

        <div className="reader-topbar-right">
          <div className="reader-chapter-jump-group">
            <button type="button" className="reader-chapter-btn" onClick={() => jumpToChapter(prevChapter)} disabled={!prevChapter}>
              <ReaderIcon kind="chapter-prev" />
              <span>{isEnglish ? 'Prev Chapter' : 'Capitulo previo'}</span>
            </button>
            <button type="button" className="reader-chapter-btn" onClick={handleNextChapter} disabled={!nextChapter || Boolean(transitioningChapterID)}>
              <span>{transitioningChapterID ? (isEnglish ? 'Loading...' : 'Cargando...') : (isEnglish ? 'Next Chapter' : 'Siguiente capitulo')}</span>
              <ReaderIcon kind="chapter-next" />
            </button>
          </div>

          <div className="reader-icon-strip">
            <ReaderIconButton
              icon={bookmark ? 'bookmark-filled' : 'bookmark'}
              active={Boolean(bookmark)}
              label={bookmark ? (isEnglish ? 'Remove bookmark' : 'Quitar marcador') : (isEnglish ? 'Bookmark current page' : 'Guardar marcador')}
              onClick={handleToggleBookmark}
            />
            <ReaderIconButton icon="reload" label={isEnglish ? 'Reload chapter pages' : 'Recargar paginas'} onClick={refreshChapter} />
            <ReaderIconButton icon="fullscreen" label={isFullscreen ? (isEnglish ? 'Exit fullscreen' : 'Salir de pantalla completa') : (isEnglish ? 'Fullscreen' : 'Pantalla completa')} onClick={() => void toggleFullscreen()} />
            <ReaderIconButton icon="settings" active={readerSettings.settingsOpen} label={isEnglish ? 'Reading settings' : 'Ajustes de lectura'} onClick={() => updateReaderSettings({ settingsOpen: !readerSettings.settingsOpen })} />
          </div>
        </div>
      </header>

      <div className="reader-workspace-v2">
        <section className={`reader-stage reader-stage--${readerSettings.readingMode} reader-fit--${effectivePageFit}`}>
          {loading ? (
            <div className="reader-state-panel">
              <div className="gui2-loading-dots"><span /><span /><span /></div>
              <div className="reader-state-copy">{isEnglish ? 'Loading chapter pages...' : 'Cargando paginas del capitulo...'}</div>
            </div>
          ) : null}

          {error ? (
            <div className="reader-state-panel">
              <div className="reader-state-error">{error}</div>
              <button type="button" className="btn btn-ghost" onClick={onBack}>{isEnglish ? 'Back' : 'Volver'}</button>
            </div>
          ) : null}

          {!loading && !error && continuousScrollMode ? (
            <div
              ref={verticalRef}
              className={`reader-scroll-canvas${stripReadingMode ? ' reader-scroll-canvas--strip' : ''}`}
              onScroll={handleVerticalScroll}
              onClick={toggleReaderChrome}
            >
              <div className={`reader-scroll-stack${stripReadingMode ? ' reader-scroll-stack--strip' : ''}`} style={scrollSheetStyle}>
                {renderedPages.map((page, index) => (
                  <div
                    key={page.renderKey}
                    ref={(node) => { pageRefs.current[index] = node }}
                    className="reader-scroll-slice"
                  >
                    <img
                      src={page.proxy_url}
                      alt={`${isEnglish ? 'Page' : 'Pagina'} ${index + 1}`}
                      className="reader-scroll-image"
                      style={pageImageStyle}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ))}
              </div>

              <div className="reader-end-card">
                <span>{isEnglish ? 'End of chapter' : 'Fin del capitulo'}</span>
                <div className="reader-end-actions">
                  {nextChapter ? (
                  <button type="button" className="reader-primary-action" onClick={(event) => {
                    event.stopPropagation()
                    handleNextChapter()
                  }} disabled={Boolean(transitioningChapterID)}>
                      {transitioningChapterID ? (isEnglish ? 'Loading...' : 'Cargando...') : (isEnglish ? 'Next chapter' : 'Siguiente capitulo')}
                    </button>
                  ) : null}
                  <button type="button" className="reader-secondary-action" onClick={(event) => {
                    event.stopPropagation()
                    onBack()
                  }}>
                    {isEnglish ? 'Back to list' : 'Volver a la lista'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {!loading && !error && !continuousScrollMode ? (
            <div className={`reader-page-canvas${readerSettings.readingDirection === 'rtl' ? ' is-rtl' : ''}`} onClick={toggleReaderChrome}>
              <button type="button" className="reader-page-zone reader-page-zone--prev" aria-label={isEnglish ? 'Previous page' : 'Pagina anterior'} onClick={(event) => {
                event.stopPropagation()
                handlePageStep('prev')
              }} />
              <button type="button" className="reader-page-zone reader-page-zone--next" aria-label={isEnglish ? 'Next page' : 'Pagina siguiente'} onClick={(event) => {
                event.stopPropagation()
                handlePageStep('next')
              }} />

              <button type="button" className="reader-page-arrow reader-page-arrow--prev" onClick={(event) => {
                event.stopPropagation()
                handlePageStep('prev')
              }} disabled={viewport.startIndex === 0}>
                <ReaderIcon kind="back" />
              </button>

              <div ref={spreadRef} className={`reader-spread reader-spread--${readerSettings.readingMode}`} style={readerCanvasStyle}>
                {(readerSettings.readingDirection === 'rtl' ? [...viewport.visiblePages].reverse() : viewport.visiblePages).map((pageIndex) => {
                  const page = pages[pageIndex]
                  if (!page) return null
                  const intrinsicPageSize = pageIntrinsicSizes[page.renderKey]
                  const pageLayout = getReaderCanvasPageLayout({
                    effectivePageFit,
                    zoomPercent: readerSettings.zoomPercent,
                    slotWidth: pagedSlotMetrics.width,
                    slotHeight: pagedSlotMetrics.height,
                    naturalWidth: intrinsicPageSize?.naturalWidth,
                    naturalHeight: intrinsicPageSize?.naturalHeight,
                  })
                  return (
                    <ReaderPageSheet
                      key={page.renderKey}
                      page={page}
                      alt={`${isEnglish ? 'Page' : 'Pagina'} ${pageIndex + 1}`}
                      pageStyle={pageLayout ? { width: `${pageLayout.width}px`, height: `${pageLayout.height}px` } : undefined}
                      pageMediaStyle={pageLayout ? { ...pageImageStyle, width: '100%', height: '100%' } : pageImageStyle}
                      sheetClassName={readerSettings.readingMode === 'double' ? 'reader-page-sheet--double' : 'reader-page-sheet--paged'}
                      onImageLoad={(event) => handleReaderPageLoad(page.renderKey, event)}
                    />
                  )
                })}
              </div>

              <button type="button" className="reader-page-arrow reader-page-arrow--next" onClick={(event) => {
                event.stopPropagation()
                handlePageStep('next')
              }} disabled={viewport.endIndex >= pages.length - 1}>
                <ReaderIcon kind="chapter-next" />
              </button>
            </div>
          ) : null}
        </section>

        {readerSettings.settingsOpen ? (
          <aside className="reader-settings-panel" onClick={stopEvent}>
            <div className="reader-settings-head">
              <div>
                <h3>Reading Settings</h3>
              </div>
              <ReaderIconButton icon="close" label={isEnglish ? 'Close settings' : 'Cerrar ajustes'} onClick={() => updateReaderSettings({ settingsOpen: false })} />
            </div>

            <div className="reader-settings-section">
              <div className="reader-settings-label">Reading Mode</div>
              <div className="reader-settings-button-grid">
                <ReaderToggleButton active={readerSettings.readingMode === 'scroll'} icon="scroll" label="Scroll" onClick={() => updateReaderSettings({ readingMode: 'scroll' })} />
                <ReaderToggleButton active={readerSettings.readingMode === 'paged'} icon="paged" label="Paged" onClick={() => updateReaderSettings({ readingMode: 'paged' })} />
                <ReaderToggleButton active={readerSettings.readingMode === 'double'} icon="double" label="Double Page" onClick={() => updateReaderSettings({ readingMode: 'double' })} />
              </div>
            </div>

            <div className="reader-settings-section">
              <div className="reader-settings-label">Reading Direction</div>
              <div className="reader-settings-button-grid two-up">
                <ReaderToggleButton active={readerSettings.readingDirection === 'ltr'} icon="chapter-next" label="Left to Right" onClick={() => updateReaderSettings({ readingDirection: 'ltr' })} />
                <ReaderToggleButton active={readerSettings.readingDirection === 'rtl'} icon="chapter-prev" label="Right to Left" onClick={() => updateReaderSettings({ readingDirection: 'rtl' })} />
              </div>
            </div>

            <div className="reader-settings-section">
              <div className="reader-settings-label">Page Fit</div>
              <div className="reader-settings-button-grid three-up">
                <ReaderToggleButton active={readerSettings.pageFit === 'width'} icon="width" label="Fit Width" onClick={() => updateReaderSettings({ pageFit: 'width' })} />
                <ReaderToggleButton active={readerSettings.pageFit === 'height'} icon="height" label="Fit Height" onClick={() => updateReaderSettings({ pageFit: 'height' })} />
                <ReaderToggleButton active={readerSettings.pageFit === 'original'} icon="original" label="Original" onClick={() => updateReaderSettings({ pageFit: 'original' })} />
              </div>
            </div>

            <div className="reader-settings-section">
              <div className="reader-settings-label">Zoom</div>
              <ReaderSliderRow
                label="Zoom"
                icon="expand"
                value={readerSettings.zoomPercent}
                min={60}
                max={180}
                onChange={(value) => updateReaderSettings({ zoomPercent: value })}
                suffix="%"
              />
            </div>

            <div className="reader-settings-section">
              <div className="reader-settings-label">Image</div>
              <div className="reader-settings-toggle-row">
                <div>
                  <div className="reader-settings-toggle-title">Upscaler / Enhance <span className="reader-settings-ai-tag">AI</span></div>
                  <div className="reader-settings-toggle-copy">Improve clarity and reduce noise</div>
                </div>
                <label className="reader-switch">
                  <input type="checkbox" checked={readerSettings.enhance} onChange={(event) => updateReaderSettings({ enhance: event.target.checked })} />
                  <span className="reader-switch-track" />
                </label>
              </div>
              <div className="reader-quality-chip">{qualityLabel}</div>
            </div>

            <div className="reader-settings-section">
              <div className="reader-settings-label">Adjustments</div>
              <ReaderSliderRow label="Brightness" icon="sun" value={readerSettings.brightness} min={-40} max={40} onChange={(value) => updateReaderSettings({ brightness: value })} suffix="%" />
              <ReaderSliderRow label="Contrast" icon="contrast" value={readerSettings.contrast} min={-40} max={40} onChange={(value) => updateReaderSettings({ contrast: value })} suffix="%" />
              <button type="button" className="reader-reset-btn" onClick={() => updateReaderSettings({ brightness: 0, contrast: 0 })}>Reset Adjustments</button>
            </div>

            <div className="reader-settings-section">
              <div className="reader-settings-label">Auto-Hide UI</div>
              <div className="reader-settings-toggle-row">
                <div className="reader-settings-toggle-copy">Hide top and bottom bars after inactivity</div>
                <label className="reader-switch">
                  <input type="checkbox" checked={readerSettings.autoHideUI} onChange={(event) => updateReaderSettings({ autoHideUI: event.target.checked })} />
                  <span className="reader-switch-track" />
                </label>
              </div>
              <label className="reader-delay-select-shell">
                <span>Delay</span>
                <select value={readerSettings.autoHideDelaySec} onChange={(event) => updateReaderSettings({ autoHideDelaySec: Number(event.target.value) })}>
                  {[2, 3, 4, 5, 6].map((value) => (
                    <option key={value} value={value}>{value} sec</option>
                  ))}
                </select>
              </label>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
