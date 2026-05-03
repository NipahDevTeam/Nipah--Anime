export const READER_SETTINGS_KEY = 'nipah:manga-reader-ui-settings-v2'
export const READER_BOOKMARKS_KEY = 'nipah:manga-reader-bookmarks-v1'

export const DEFAULT_READER_SETTINGS = {
  readingMode: 'double',
  pageFit: 'width',
  zoomPercent: 100,
  readingDirection: 'ltr',
  enhance: true,
  brightness: 0,
  contrast: 0,
  settingsOpen: true,
  autoHideUI: true,
  autoHideDelaySec: 3,
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function interpolateZoomRange(value, minOutput, maxOutput) {
  const safeValue = clamp(Number(value) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180)
  const progress = (safeValue - 60) / 120
  return Math.round(minOutput + ((maxOutput - minOutput) * progress))
}

function getZoomProgress(value) {
  const safeValue = clamp(Number(value) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180)
  return (safeValue - 60) / 120
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export function isStripFormattedTitle(format = '', country = '') {
  const normalizedFormat = String(format || '').trim().toUpperCase()
  const normalizedCountry = String(country || '').trim().toUpperCase()
  return (
    normalizedFormat === 'MANHWA' ||
    normalizedFormat === 'MANHUA' ||
    normalizedCountry === 'KR' ||
    normalizedCountry === 'CN'
  )
}

export function normalizeReaderSettings(partial = {}) {
  const next = partial && typeof partial === 'object' ? partial : {}
  const readingMode = ['scroll', 'paged', 'double'].includes(next.readingMode) ? next.readingMode : DEFAULT_READER_SETTINGS.readingMode
  const pageFit = ['width', 'height', 'original'].includes(next.pageFit) ? next.pageFit : DEFAULT_READER_SETTINGS.pageFit
  const readingDirection = ['ltr', 'rtl'].includes(next.readingDirection) ? next.readingDirection : DEFAULT_READER_SETTINGS.readingDirection

  return {
    readingMode,
    pageFit,
    zoomPercent: clamp(Number(next.zoomPercent ?? DEFAULT_READER_SETTINGS.zoomPercent) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180),
    readingDirection,
    enhance: Boolean(next.enhance ?? DEFAULT_READER_SETTINGS.enhance),
    brightness: clamp(Number(next.brightness ?? DEFAULT_READER_SETTINGS.brightness) || 0, -40, 40),
    contrast: clamp(Number(next.contrast ?? DEFAULT_READER_SETTINGS.contrast) || 0, -40, 40),
    settingsOpen: Boolean(next.settingsOpen ?? DEFAULT_READER_SETTINGS.settingsOpen),
    autoHideUI: Boolean(next.autoHideUI ?? DEFAULT_READER_SETTINGS.autoHideUI),
    autoHideDelaySec: clamp(Number(next.autoHideDelaySec ?? DEFAULT_READER_SETTINGS.autoHideDelaySec) || DEFAULT_READER_SETTINGS.autoHideDelaySec, 2, 6),
  }
}

export function getSavedReaderSettings() {
  if (!canUseStorage()) return DEFAULT_READER_SETTINGS
  try {
    const raw = window.localStorage.getItem(READER_SETTINGS_KEY)
    if (!raw) return DEFAULT_READER_SETTINGS
    return normalizeReaderSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_READER_SETTINGS
  }
}

export function saveReaderSettings(settings) {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(normalizeReaderSettings(settings)))
  } catch {}
}

export function getReaderViewMode({
  readingMode = DEFAULT_READER_SETTINGS.readingMode,
  pageFit = DEFAULT_READER_SETTINGS.pageFit,
  contentFormat = '',
  countryOfOrigin = '',
} = {}) {
  const continuousScrollMode = readingMode === 'scroll'
  const stripReadingMode = readingMode === 'scroll' && isStripFormattedTitle(contentFormat, countryOfOrigin)
  return {
    continuousScrollMode,
    stripReadingMode,
    effectivePageFit: stripReadingMode ? 'width' : pageFit,
    stripPageFitPreset: stripReadingMode ? pageFit : 'width',
  }
}

export function getReaderScrollSheetVariables({
  stripReadingMode = false,
  stripPageFitPreset = 'width',
  effectivePageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
} = {}) {
  const safeZoom = clamp(Number(zoomPercent ?? DEFAULT_READER_SETTINGS.zoomPercent) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180)

  if (stripReadingMode) {
    if (stripPageFitPreset === 'height') {
      return {
        '--reader-scroll-page-width': `${clamp(safeZoom - 18, 62, 86)}%`,
      }
    }
    if (stripPageFitPreset === 'original') {
      return {
        '--reader-scroll-page-width': `${clamp(safeZoom - 6, 76, 96)}%`,
      }
    }
    return {
      '--reader-scroll-page-width': `${clamp(safeZoom + 4, 88, 100)}%`,
    }
  }

  if (effectivePageFit === 'height') {
    return {
      '--reader-scroll-page-height': `${Math.max(58, safeZoom)}vh`,
    }
  }
  if (effectivePageFit === 'original') {
    return {
      '--reader-scroll-page-width': `${Math.max(68, safeZoom)}%`,
    }
  }
  return {
    '--reader-scroll-page-width': `${Math.max(72, safeZoom)}%`,
  }
}

export function getReaderCanvasVariables({
  effectivePageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
} = {}) {
  const safeZoom = clamp(Number(zoomPercent ?? DEFAULT_READER_SETTINGS.zoomPercent) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180)

  if (effectivePageFit === 'height') {
    return {
      '--reader-canvas-sheet-width': '100%',
      '--reader-canvas-sheet-height': `${interpolateZoomRange(safeZoom, 58, 100)}%`,
      '--reader-canvas-sheet-max-width': '100%',
      '--reader-canvas-sheet-max-height': '100%',
    }
  }

  if (effectivePageFit === 'original') {
    return {
      '--reader-canvas-sheet-width': 'auto',
      '--reader-canvas-sheet-height': 'auto',
      '--reader-canvas-sheet-max-width': `${interpolateZoomRange(safeZoom, 68, 100)}%`,
      '--reader-canvas-sheet-max-height': `${interpolateZoomRange(safeZoom, 68, 100)}%`,
    }
  }

  return {
    '--reader-canvas-sheet-width': `${interpolateZoomRange(safeZoom, 78, 100)}%`,
    '--reader-canvas-sheet-height': '100%',
    '--reader-canvas-sheet-max-width': '100%',
    '--reader-canvas-sheet-max-height': '100%',
  }
}

export function getReaderCanvasPageLayout({
  effectivePageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
  slotWidth = 0,
  slotHeight = 0,
  naturalWidth = 0,
  naturalHeight = 0,
} = {}) {
  const safeSlotWidth = Math.max(0, Number(slotWidth) || 0)
  const safeSlotHeight = Math.max(0, Number(slotHeight) || 0)
  const safeNaturalWidth = Math.max(0, Number(naturalWidth) || 0)
  const safeNaturalHeight = Math.max(0, Number(naturalHeight) || 0)

  if (!safeSlotWidth || !safeSlotHeight || !safeNaturalWidth || !safeNaturalHeight) {
    return null
  }

  const zoomProgress = getZoomProgress(zoomPercent)
  const fitScale = effectivePageFit === 'height'
    ? 0.72 + (0.28 * zoomProgress)
    : effectivePageFit === 'original'
      ? 0.7 + (0.3 * zoomProgress)
      : 0.74 + (0.26 * zoomProgress)

  let maxWidth = safeSlotWidth * fitScale
  let maxHeight = safeSlotHeight * fitScale

  if (effectivePageFit === 'original') {
    maxWidth = Math.min(maxWidth, safeNaturalWidth)
    maxHeight = Math.min(maxHeight, safeNaturalHeight)
  }

  const containRatio = Math.min(maxWidth / safeNaturalWidth, maxHeight / safeNaturalHeight)
  if (!Number.isFinite(containRatio) || containRatio <= 0) {
    return null
  }

  return {
    width: Math.max(1, Math.round(safeNaturalWidth * containRatio)),
    height: Math.max(1, Math.round(safeNaturalHeight * containRatio)),
  }
}

export function normalizeReaderPages(loadedPages = [], chapterID = '') {
  const safePages = Array.isArray(loadedPages) ? loadedPages : []
  const chapterKey = String(chapterID || 'reader')

  return safePages.map((page, index) => {
    const safePage = page && typeof page === 'object' ? page : {}
    const sourceIndex = Number.isFinite(Number(safePage.index)) ? Number(safePage.index) : index
    const sourceURL = String(safePage.url || '')

    return {
      ...safePage,
      sourceIndex,
      sequenceIndex: index,
      renderKey: `${chapterKey}:${index}:${sourceIndex}:${sourceURL}`,
    }
  })
}

export function getReaderViewport({ readingMode = 'paged', currentPage = 0, totalPages = 0 }) {
  const safeTotal = Math.max(0, Number(totalPages) || 0)
  if (safeTotal === 0) {
    return { startIndex: 0, endIndex: 0, visiblePages: [], pageLabel: '0' }
  }

  const safePage = clamp(Number(currentPage) || 0, 0, safeTotal - 1)
  if (readingMode === 'double') {
    const endIndex = Math.min(safeTotal - 1, safePage + 1)
    return {
      startIndex: safePage,
      endIndex,
      visiblePages: endIndex === safePage ? [safePage] : [safePage, endIndex],
      pageLabel: endIndex === safePage ? `${safePage + 1}` : `${safePage + 1} - ${endIndex + 1}`,
    }
  }

  return {
    startIndex: safePage,
    endIndex: safePage,
    visiblePages: [safePage],
    pageLabel: `${safePage + 1}`,
  }
}

export function stepReaderIndex({ readingMode = 'paged', currentPage = 0, totalPages = 0, direction = 'next' }) {
  const safeTotal = Math.max(0, Number(totalPages) || 0)
  if (safeTotal <= 1) return 0
  const step = readingMode === 'double' ? 2 : 1
  const delta = direction === 'prev' ? -step : step
  return clamp((Number(currentPage) || 0) + delta, 0, safeTotal - 1)
}

function getBookmarkKey(sourceID, mangaID, chapterID) {
  return `${sourceID || 'senshimanga-es'}::${mangaID || ''}::${chapterID || ''}`
}

export function getSavedReaderBookmark(sourceID, mangaID, chapterID) {
  if (!canUseStorage()) return null
  try {
    const raw = window.localStorage.getItem(READER_BOOKMARKS_KEY)
    const store = raw ? JSON.parse(raw) : {}
    return store[getBookmarkKey(sourceID, mangaID, chapterID)] ?? null
  } catch {
    return null
  }
}

export function toggleReaderBookmark({ sourceID, mangaID, chapterID, progressPage }) {
  if (!canUseStorage() || !chapterID) return null
  const key = getBookmarkKey(sourceID, mangaID, chapterID)
  try {
    const raw = window.localStorage.getItem(READER_BOOKMARKS_KEY)
    const store = raw ? JSON.parse(raw) : {}
    if (store[key]) {
      delete store[key]
      window.localStorage.setItem(READER_BOOKMARKS_KEY, JSON.stringify(store))
      return null
    }
    const bookmark = {
      sourceID,
      mangaID,
      chapterID,
      progressPage,
      updatedAt: Date.now(),
    }
    store[key] = bookmark
    window.localStorage.setItem(READER_BOOKMARKS_KEY, JSON.stringify(store))
    return bookmark
  } catch {
    return null
  }
}
