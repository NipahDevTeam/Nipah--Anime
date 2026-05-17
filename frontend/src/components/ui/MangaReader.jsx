import { useState, useEffect, useCallback, useRef, useMemo, startTransition } from 'react'
import { createPortal } from 'react-dom'
import { proxyImage, wails } from '../../lib/wails'
import {
  markMangaReaderChapterCompleted,
  saveMangaReaderProgress,
} from '../../lib/mangaReaderProgress'
import { useI18n } from '../../lib/i18n'
import {
  getReaderCanvasPageLayout,
  getReaderPagedSlotMetrics,
  getReaderCanvasVariables,
  getReaderScrollPageLayout,
  getReaderScrollSheetVariables,
  getReaderSpreadPages,
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
import {
  getContentBoxRect,
  getCroppedMediaLayout,
  measureReaderContentBox,
  normalizeReaderContentBox,
} from './reader/readerContentBox'
import ReaderStageHeader from './reader/ReaderStageHeader'
import ReaderSettingsSheet from './reader/ReaderSettingsSheet'
import ReaderChapterBrowser from './reader/ReaderChapterBrowser'

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
    case 'cover':
      return <svg {...common}><rect x="2.9" y="3.2" width="10.2" height="9.6" rx="1.2" /><path d="M4.4 5.1h7.2M4.4 10.9h7.2" /><path d="M6.1 3.2v9.6M9.9 3.2v9.6" /></svg>
    case 'chapters':
      return <svg {...common}><rect x="3" y="3" width="4.2" height="4.2" rx="0.8" /><rect x="8.8" y="3" width="4.2" height="4.2" rx="0.8" /><rect x="3" y="8.8" width="4.2" height="4.2" rx="0.8" /><rect x="8.8" y="8.8" width="4.2" height="4.2" rx="0.8" /></svg>
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
      resolve(null)
      return
    }

    const image = new Image()
    let finished = false
    const finish = (metrics = null) => {
      if (finished) return
      finished = true
      window.clearTimeout(timeout)
      resolve(metrics)
    }
    const timeout = window.setTimeout(finish, READER_PAGE_PRELOAD_TIMEOUT_MS)
    image.onload = () => finish({
      renderKey: page.renderKey,
      naturalWidth: Number(image.naturalWidth) || 0,
      naturalHeight: Number(image.naturalHeight) || 0,
    })
    image.onerror = () => finish(null)
    image.decoding = 'async'
    image.src = page.proxy_url
  })
}

function ReaderPageSheet({
  page,
  alt,
  pageStyle,
  pageMediaStyle,
  sheetClassName = '',
  cropStyle = null,
  croppedMediaStyle = null,
  onImageLoad = null,
}) {
  return (
    <div className={`reader-page-sheet${sheetClassName ? ` ${sheetClassName}` : ''}`} style={pageStyle}>
      {croppedMediaStyle ? (
        <div className="reader-page-media-crop" style={cropStyle}>
          <img
            src={page.proxy_url}
            alt={alt}
            className="reader-page-media reader-page-media--cropped"
            style={croppedMediaStyle}
            onLoad={onImageLoad}
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : (
        <img
          src={page.proxy_url}
          alt={alt}
          className="reader-page-media"
          style={pageMediaStyle}
          onLoad={onImageLoad}
          loading="lazy"
          decoding="async"
        />
      )}
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
  const [scrollViewportMetrics, setScrollViewportMetrics] = useState({ width: 0, height: 0 })
  const [stageSurfaceMetrics, setStageSurfaceMetrics] = useState({ width: 0, height: 0 })
  const [pageIntrinsicSizes, setPageIntrinsicSizes] = useState({})
  const [chapterBrowserOpen, setChapterBrowserOpen] = useState(false)

  const hideTimer = useRef(null)
  const persistTimer = useRef(null)
  const scrollFrame = useRef(0)
  const currentPageRef = useRef(0)
  const chapterLoadGeneration = useRef(0)
  const pageRefs = useRef([])
  const stageSurfaceRef = useRef(null)
  const verticalRef = useRef(null)
  const pageCanvasRef = useRef(null)

  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterID)
  const currentChapter = chapterIndex >= 0 ? chapters[chapterIndex] ?? null : null
  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null
  const nextChapter = chapterIndex >= 0 ? chapters[chapterIndex + 1] ?? null : null
  const renderedPages = useMemo(() => pages.slice(0, visibleCount), [pages, visibleCount])
  const pageMetrics = useMemo(
    () => pages.map((page) => pageIntrinsicSizes[page.renderKey] ?? null),
    [pageIntrinsicSizes, pages],
  )
  const viewport = useMemo(() => getReaderViewport({
    readingMode: readerSettings.readingMode,
    currentPage,
    totalPages: pages.length,
    pageMetrics,
  }), [currentPage, pageMetrics, pages.length, readerSettings.readingMode])
  const spreadPages = useMemo(() => getReaderSpreadPages({
    readingMode: readerSettings.readingMode,
    readingDirection: readerSettings.readingDirection,
    visiblePages: viewport.visiblePages,
  }), [readerSettings.readingDirection, readerSettings.readingMode, viewport.visiblePages])

  const progressPage = viewport.visiblePages.length
    ? viewport.visiblePages[viewport.visiblePages.length - 1] + 1
    : Math.min(currentPage + 1, pages.length || 1)
  const qualityLabel = dataSaver ? (isEnglish ? 'Saver' : 'Ahorro') : 'HD'
  const readerOverlayOpen = readerSettings.settingsOpen || chapterBrowserOpen
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
    if (pageCanvasRef.current) {
      pageCanvasRef.current.scrollTo({ top: 0, left: 0, behavior: 'auto' })
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

  const openChapterBrowser = useCallback(() => {
    setChapterBrowserOpen(true)
    if (readerSettings.settingsOpen) {
      updateReaderSettings({ settingsOpen: false })
    }
  }, [readerSettings.settingsOpen, updateReaderSettings])

  const toggleSettingsSheet = useCallback(() => {
    setChapterBrowserOpen(false)
    updateReaderSettings({ settingsOpen: !readerSettings.settingsOpen })
  }, [readerSettings.settingsOpen, updateReaderSettings])

  const storePageMetrics = useCallback((pageKey, nextMetrics) => {
    if (!pageKey || !nextMetrics) return

    setPageIntrinsicSizes((current) => {
      const existing = current[pageKey]
      const sameContentBox = existing?.contentBox?.top === nextMetrics.contentBox?.top
        && existing?.contentBox?.right === nextMetrics.contentBox?.right
        && existing?.contentBox?.bottom === nextMetrics.contentBox?.bottom
        && existing?.contentBox?.left === nextMetrics.contentBox?.left
      if (
        existing?.naturalWidth === nextMetrics.naturalWidth
        && existing?.naturalHeight === nextMetrics.naturalHeight
        && sameContentBox
      ) {
        return current
      }
      return {
        ...current,
        [pageKey]: nextMetrics,
      }
    })
  }, [])

  const handleReaderPageLoad = useCallback((pageKey, event) => {
    const naturalWidth = Number(event?.currentTarget?.naturalWidth) || 0
    const naturalHeight = Number(event?.currentTarget?.naturalHeight) || 0
    if (!pageKey || !naturalWidth || !naturalHeight) return

    storePageMetrics(pageKey, { naturalWidth, naturalHeight, contentBox: null })
    void measureReaderContentBox(event?.currentTarget).then((contentBox) => {
      const normalizedContentBox = normalizeReaderContentBox(contentBox)
      if (!normalizedContentBox) return
      storePageMetrics(pageKey, { naturalWidth, naturalHeight, contentBox: normalizedContentBox })
    }).catch(() => {})
  }, [storePageMetrics])

  const scrollReaderViewport = useCallback((direction, behavior = 'smooth') => {
    const targetNode = readerSettings.readingMode === 'scroll' ? verticalRef.current : pageCanvasRef.current
    if (!targetNode) return false

    const maxScrollTop = Math.max(0, targetNode.scrollHeight - targetNode.clientHeight)
    const currentScrollTop = targetNode.scrollTop
    if (direction === 'up' && currentScrollTop <= 2) return false
    if (direction === 'down' && currentScrollTop >= maxScrollTop - 2) return false

    const scrollStep = Math.max(140, Math.round(targetNode.clientHeight * 0.72))
    const targetScrollTop = direction === 'down'
      ? Math.min(currentScrollTop + scrollStep, maxScrollTop)
      : Math.max(currentScrollTop - scrollStep, 0)

    if (Math.abs(targetScrollTop - currentScrollTop) < 2) return false

    targetNode.scrollTo({ top: targetScrollTop, left: 0, behavior })
    return true
  }, [readerSettings.readingMode])

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
        pageMetrics,
      }))
    })
  }, [pageMetrics, pages.length, readerSettings.readingMode])

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
    setScrollViewportMetrics({ width: 0, height: 0 })
    setPageIntrinsicSizes({})
    pageRefs.current = []
    const loadGeneration = ++chapterLoadGeneration.current

    ;(async () => {
      const loadedPages = await wails.getChapterPagesSource(sourceID, chapterID, dataSaver)
      if (chapterLoadGeneration.current !== loadGeneration) return
        const nextPages = normalizeReaderPages(loadedPages, chapterID).map((page) => ({
          ...page,
          proxy_url: proxyImage(page.url, { sourceID }),
        }))
        const blockingPreloadCount = readerSettings.readingMode === 'scroll'
          ? Math.min(INITIAL_VERTICAL_PAGE_BATCH, Math.max(nextPages.length, 1))
          : Math.min(nextPages.length, readerSettings.readingMode === 'double' ? 2 : 1)
        const blockingPreloadResults = await Promise.allSettled(nextPages.slice(0, blockingPreloadCount).map(preloadReaderPage))
        const blockingMetrics = blockingPreloadResults.reduce((accumulator, result) => {
          const value = result.status === 'fulfilled' ? result.value : null
          if (!value?.renderKey || !value.naturalWidth || !value.naturalHeight) return accumulator
          accumulator[value.renderKey] = {
            naturalWidth: value.naturalWidth,
            naturalHeight: value.naturalHeight,
            contentBox: null,
          }
          return accumulator
        }, {})
        void Promise.allSettled(nextPages.slice(blockingPreloadCount).map(preloadReaderPage))
        setPageIntrinsicSizes(blockingMetrics)
        setPages(nextPages)
        setCurrentPage(0)
        setVisibleCount(
          readerSettings.readingMode === 'scroll'
            ? Math.min(INITIAL_VERTICAL_PAGE_BATCH, Math.max(nextPages.length, 1))
            : (nextPages.length || INITIAL_VERTICAL_PAGE_BATCH),
        )
      })()
      .catch((e) => {
        if (chapterLoadGeneration.current !== loadGeneration) return
        setError(e?.message ?? (isEnglish ? 'Error loading pages' : 'Error al cargar paginas'))
      })
      .finally(() => {
        if (chapterLoadGeneration.current !== loadGeneration) return
        setLoading(false)
      })
  }, [chapterID, dataSaver, isEnglish, mangaID, reloadToken, sourceID])

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') {
        if (chapterBrowserOpen) {
          setChapterBrowserOpen(false)
        } else if (readerSettings.settingsOpen) {
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

      if (event.key === 'ArrowDown') {
        if (scrollReaderViewport('down')) {
          event.preventDefault()
        }
        return
      }

      if (event.key === 'ArrowUp') {
        if (scrollReaderViewport('up')) {
          event.preventDefault()
        }
        return
      }

      if (readerSettings.readingMode !== 'scroll') {
        if (event.key === useForward) {
          handlePageStep('next')
        }
        if (event.key === useBackward) {
          handlePageStep('prev')
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [chapterBrowserOpen, handlePageStep, readerSettings.readingDirection, readerSettings.readingMode, readerSettings.settingsOpen, scrollReaderViewport, toggleFullscreen, updateReaderSettings])

  useEffect(() => {
    if (loading || error || pages.length === 0) return

    const timeout = window.setTimeout(() => {
      resetReaderViewportToStart()
    }, 40)

    return () => window.clearTimeout(timeout)
  }, [chapterID, error, loading, pages.length, resetReaderViewportToStart])

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
    const node = verticalRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined

    const updateScrollViewportMetrics = () => {
      setScrollViewportMetrics((current) => {
        const nextWidth = Math.max(0, Math.round(node.clientWidth))
        const nextHeight = Math.max(0, Math.round(node.clientHeight))
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return { width: nextWidth, height: nextHeight }
      })
    }

    updateScrollViewportMetrics()
    const observer = new ResizeObserver(() => {
      updateScrollViewportMetrics()
    })
    observer.observe(node)

    return () => observer.disconnect()
  }, [readerSettings.readingMode])

  useEffect(() => {
    const node = stageSurfaceRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined

    const updateStageSurfaceMetrics = () => {
      setStageSurfaceMetrics((current) => {
        const nextWidth = Math.max(0, Math.round(node.clientWidth))
        const nextHeight = Math.max(0, Math.round(node.clientHeight))
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return { width: nextWidth, height: nextHeight }
      })
    }

    updateStageSurfaceMetrics()
    const observer = new ResizeObserver(() => {
      updateStageSurfaceMetrics()
    })
    observer.observe(node)

    return () => observer.disconnect()
  }, [readerSettings.readingMode, readerSettings.settingsOpen, uiVisible])

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
    if (!readerSettings.autoHideUI || readerOverlayOpen || !uiVisible) return
    hideTimer.current = setTimeout(() => setUiVisible(false), readerSettings.autoHideDelaySec * 1000)
  }, [readerOverlayOpen, readerSettings.autoHideDelaySec, readerSettings.autoHideUI, uiVisible])

  const toggleReaderChrome = useCallback(() => {
    setUiVisible((current) => {
      const next = !current
      clearTimeout(hideTimer.current)
      if (next && readerSettings.autoHideUI && !readerOverlayOpen) {
        hideTimer.current = setTimeout(() => setUiVisible(false), readerSettings.autoHideDelaySec * 1000)
      }
      return next
    })
  }, [readerOverlayOpen, readerSettings.autoHideDelaySec, readerSettings.autoHideUI])

  useEffect(() => {
    if (!readerSettings.autoHideUI) {
      clearTimeout(hideTimer.current)
      return undefined
    }

    if (uiVisible) {
      resetHideTimer()
    }
    return () => clearTimeout(hideTimer.current)
  }, [readerOverlayOpen, readerSettings.autoHideUI, resetHideTimer, uiVisible])

  useEffect(() => {
    document.body.classList.add('reader-active')
    return () => {
      document.body.classList.remove('reader-active')
    }
  }, [])

  useEffect(() => {
    if (!readerOverlayOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [readerOverlayOpen])

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
      filterParts.push('grayscale(0.01)')
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
    return getReaderPagedSlotMetrics({
      readingMode: readerSettings.readingMode,
      stageSurfaceMetrics,
    })
  }, [readerSettings.readingMode, stageSurfaceMetrics.height, stageSurfaceMetrics.width])

  const chapterLineTitle = currentChapter?.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${currentChapter?.number || chapterIndex + 1 || ''}`

  const readerOverlayLayer = readerOverlayOpen ? createPortal(
    <div
      className="reader-overlay-layer"
      onClick={() => {
        setChapterBrowserOpen(false)
        if (readerSettings.settingsOpen) {
          updateReaderSettings({ settingsOpen: false })
        }
      }}
    >
      <div className="reader-overlay-backdrop" />
      {chapterBrowserOpen ? (
        <ReaderChapterBrowser
          isEnglish={isEnglish}
          chapters={chapters}
          currentChapterID={chapterID}
          currentPageLabel={viewport.pageLabel}
          onClose={() => setChapterBrowserOpen(false)}
          onOpenChapter={(chapter) => {
            setChapterBrowserOpen(false)
            jumpToChapter(chapter)
          }}
        />
      ) : null}
      {readerSettings.settingsOpen ? (
        <ReaderSettingsSheet
          isEnglish={isEnglish}
          readerSettings={readerSettings}
          qualityLabel={qualityLabel}
          onClose={() => updateReaderSettings({ settingsOpen: false })}
          onSetReadingMode={(readingMode) => updateReaderSettings({ readingMode })}
          onSetReadingDirection={(readingDirection) => updateReaderSettings({ readingDirection })}
          onSetPageFit={(pageFit) => updateReaderSettings({ pageFit })}
          onSetZoom={(zoomPercent) => updateReaderSettings({ zoomPercent })}
          onSetEnhance={(enhance) => updateReaderSettings({ enhance })}
          onSetBrightness={(brightness) => updateReaderSettings({ brightness })}
          onSetContrast={(contrast) => updateReaderSettings({ contrast })}
          onResetAdjustments={() => updateReaderSettings({ brightness: 0, contrast: 0 })}
          onSetAutoHideUI={(autoHideUI) => updateReaderSettings({ autoHideUI })}
          onSetAutoHideDelaySec={(autoHideDelaySec) => updateReaderSettings({ autoHideDelaySec })}
          ReaderIconButton={ReaderIconButton}
          ReaderToggleButton={ReaderToggleButton}
          ReaderSliderRow={ReaderSliderRow}
        />
      ) : null}
    </div>,
    document.body,
  ) : null

  return (
    <div
      className={`reader-shell-v2${isFullscreen ? ' is-fullscreen' : ''}${uiVisible ? ' reader-ui-visible' : ' reader-ui-hidden'}${readerSettings.settingsOpen ? ' settings-open' : ' settings-closed'}${stripReadingMode ? ' reader-shell-v2--strip' : ''}${chapterBrowserOpen ? ' chapter-browser-open' : ''} reader-mode-${readerSettings.readingMode}`}
    >
      <ReaderStageHeader
        title={title}
        chapterTitle={chapterLineTitle}
        chapterID={chapterID}
        chapters={chapters}
        isEnglish={isEnglish}
        currentPageLabel={viewport.pageLabel}
        qualityLabel={qualityLabel}
        bookmarkActive={Boolean(bookmark)}
        onBack={() => {
          persistProgress(viewport.endIndex)
          onBack()
        }}
        onSelectChapter={(nextChapterID) => {
          const next = chapters.find((chapter) => chapter.id === nextChapterID)
          if (next) jumpToChapter(next)
        }}
        onOpenChapterBrowser={openChapterBrowser}
        onSetReadingMode={(readingMode) => updateReaderSettings({ readingMode })}
        readingMode={readerSettings.readingMode}
        prevChapter={prevChapter}
        nextChapter={nextChapter}
        onOpenPreviousChapter={() => jumpToChapter(prevChapter)}
        onOpenNextChapter={handleNextChapter}
        transitioningChapter={transitioningChapterID}
        onToggleBookmark={handleToggleBookmark}
        onReloadChapter={refreshChapter}
        onToggleFullscreen={() => void toggleFullscreen()}
        isFullscreen={isFullscreen}
        onToggleSettings={toggleSettingsSheet}
        settingsOpen={readerSettings.settingsOpen}
        ReaderIcon={ReaderIcon}
        ReaderIconButton={ReaderIconButton}
        ReaderToggleButton={ReaderToggleButton}
      />

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
                {renderedPages.map((page, index) => {
                  const intrinsicPageSize = pageIntrinsicSizes[page.renderKey]
                  const contentBoxRect = getContentBoxRect({
                    naturalWidth: intrinsicPageSize?.naturalWidth,
                    naturalHeight: intrinsicPageSize?.naturalHeight,
                    contentBox: intrinsicPageSize?.contentBox,
                  })
                  const scrollPageLayout = getReaderScrollPageLayout({
                    effectivePageFit,
                    zoomPercent: readerSettings.zoomPercent,
                    viewportWidth: scrollViewportMetrics.width,
                    viewportHeight: scrollViewportMetrics.height,
                    naturalWidth: intrinsicPageSize?.naturalWidth,
                    naturalHeight: intrinsicPageSize?.naturalHeight,
                  })
                  const croppedScrollMediaStyle = scrollPageLayout && contentBoxRect
                    ? getCroppedMediaLayout({
                      naturalWidth: intrinsicPageSize?.naturalWidth,
                      naturalHeight: intrinsicPageSize?.naturalHeight,
                      contentBox: intrinsicPageSize?.contentBox,
                      frameWidth: scrollPageLayout.width,
                      frameHeight: scrollPageLayout.height,
                    })
                    : null

                  return (
                    <div
                      key={page.renderKey}
                      ref={(node) => { pageRefs.current[index] = node }}
                      className="reader-scroll-slice"
                    >
                      {croppedScrollMediaStyle && scrollPageLayout ? (
                        <div
                          className="reader-page-media-crop reader-page-media-crop--scroll"
                          style={{ width: `${scrollPageLayout.width}px`, height: `${scrollPageLayout.height}px` }}
                        >
                          <img
                            src={page.proxy_url}
                            alt={`${isEnglish ? 'Page' : 'Pagina'} ${index + 1}`}
                            className="reader-page-media reader-page-media--cropped"
                            style={{
                              ...pageImageStyle,
                              width: `${croppedScrollMediaStyle.width}px`,
                              height: `${croppedScrollMediaStyle.height}px`,
                              left: `${croppedScrollMediaStyle.left}px`,
                              top: `${croppedScrollMediaStyle.top}px`,
                            }}
                            onLoad={(event) => handleReaderPageLoad(page.renderKey, event)}
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      ) : (
                        <img
                          src={page.proxy_url}
                          alt={`${isEnglish ? 'Page' : 'Pagina'} ${index + 1}`}
                          className="reader-scroll-image"
                          style={scrollPageLayout
                            ? { ...pageImageStyle, width: `${scrollPageLayout.width}px`, height: `${scrollPageLayout.height}px` }
                            : pageImageStyle}
                          onLoad={(event) => handleReaderPageLoad(page.renderKey, event)}
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                    </div>
                  )
                })}
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
            <div ref={stageSurfaceRef} className="reader-stage-surface">
              <div
                ref={pageCanvasRef}
                className={`reader-page-canvas${readerSettings.readingDirection === 'rtl' ? ' is-rtl' : ''}`}
                onClick={toggleReaderChrome}
              >
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

                <div className={`reader-spread reader-spread--${readerSettings.readingMode}`} style={readerCanvasStyle}>
                  {spreadPages.map(({ pageIndex, slot }, spreadSlotIndex) => {
                    const page = pages[pageIndex]
                    if (!page) return null
                    const intrinsicPageSize = pageIntrinsicSizes[page.renderKey]
                    const contentBoxRect = getContentBoxRect({
                      naturalWidth: intrinsicPageSize?.naturalWidth,
                      naturalHeight: intrinsicPageSize?.naturalHeight,
                      contentBox: intrinsicPageSize?.contentBox,
                    })
                    const pageLayout = getReaderCanvasPageLayout({
                      effectivePageFit,
                      zoomPercent: readerSettings.zoomPercent,
                      slotWidth: pagedSlotMetrics.width,
                      slotHeight: pagedSlotMetrics.height,
                      naturalWidth: intrinsicPageSize?.naturalWidth,
                      naturalHeight: intrinsicPageSize?.naturalHeight,
                    })
                    const croppedMediaStyle = pageLayout && contentBoxRect
                      ? getCroppedMediaLayout({
                        naturalWidth: intrinsicPageSize?.naturalWidth,
                        naturalHeight: intrinsicPageSize?.naturalHeight,
                        contentBox: intrinsicPageSize?.contentBox,
                        frameWidth: pageLayout.width,
                        frameHeight: pageLayout.height,
                      })
                      : null
                    const sheetClassName = readerSettings.readingMode === 'double'
                      ? `reader-page-sheet--double ${slot === 'left' ? 'reader-page-sheet--double-left' : 'reader-page-sheet--double-right'}`
                      : 'reader-page-sheet--paged'
                    return (
                      <ReaderPageSheet
                        key={page.renderKey}
                        page={page}
                        alt={`${isEnglish ? 'Page' : 'Pagina'} ${pageIndex + 1}`}
                        pageStyle={pageLayout ? { width: `${pageLayout.width}px`, height: `${pageLayout.height}px` } : undefined}
                        pageMediaStyle={pageLayout ? { ...pageImageStyle, width: '100%', height: '100%' } : pageImageStyle}
                        cropStyle={pageLayout ? { width: `${pageLayout.width}px`, height: `${pageLayout.height}px` } : null}
                        croppedMediaStyle={croppedMediaStyle ? {
                          ...pageImageStyle,
                          width: `${croppedMediaStyle.width}px`,
                          height: `${croppedMediaStyle.height}px`,
                          left: `${croppedMediaStyle.left}px`,
                          top: `${croppedMediaStyle.top}px`,
                        } : null}
                        sheetClassName={sheetClassName}
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
            </div>
          ) : null}
        </section>
      </div>
      {readerOverlayLayer}
    </div>
  )
}
