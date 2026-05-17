export const READER_SETTINGS_KEY = 'nipah:manga-reader-ui-settings-v2'
export const READER_BOOKMARKS_KEY = 'nipah:manga-reader-bookmarks-v1'

export const DEFAULT_READER_SETTINGS = {
  readingMode: 'double',
  pageFit: 'contain',
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

function lerp(start, end, amount) {
  return start + ((end - start) * amount)
}

function interpolateZoomRange(value, minOutput, maxOutput) {
  const safeValue = clamp(Number(value) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180)
  const progress = (safeValue - 60) / 120
  return Math.round(minOutput + ((maxOutput - minOutput) * progress))
}

function getZoomScale(value) {
  const safeValue = clamp(Number(value) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180)
  return 1 + ((safeValue - 100) / 200)
}

function normalizePageFit(value) {
  if (value === 'width') return 'overflow'
  if (value === 'height') return 'contain'
  if (['contain', 'overflow', 'original', 'cover'].includes(value)) return value
  return DEFAULT_READER_SETTINGS.pageFit
}

function getBasePageScale({
  pageFit = DEFAULT_READER_SETTINGS.pageFit,
  slotWidth = 0,
  slotHeight = 0,
  naturalWidth = 0,
  naturalHeight = 0,
} = {}) {
  const safeSlotWidth = Math.max(0, Number(slotWidth) || 0)
  const safeSlotHeight = Math.max(0, Number(slotHeight) || 0)
  const safeNaturalWidth = Math.max(0, Number(naturalWidth) || 0)
  const safeNaturalHeight = Math.max(0, Number(naturalHeight) || 0)

  if (!safeNaturalWidth || !safeNaturalHeight) return 0

  if (!safeSlotWidth || !safeSlotHeight) return 0

  const containScale = Math.min(safeSlotWidth / safeNaturalWidth, safeSlotHeight / safeNaturalHeight)
  const coverScale = Math.max(safeSlotWidth / safeNaturalWidth, safeSlotHeight / safeNaturalHeight)

  if (pageFit === 'original') return Math.max(1, containScale)
  if (pageFit === 'cover') return coverScale
  if (pageFit === 'overflow') return lerp(containScale, coverScale, 0.45)
  return containScale
}

function getPagedBasePageScale({
  pageFit = DEFAULT_READER_SETTINGS.pageFit,
  slotWidth = 0,
  slotHeight = 0,
  naturalWidth = 0,
  naturalHeight = 0,
} = {}) {
  const safeSlotWidth = Math.max(0, Number(slotWidth) || 0)
  const safeSlotHeight = Math.max(0, Number(slotHeight) || 0)
  const safeNaturalWidth = Math.max(0, Number(naturalWidth) || 0)
  const safeNaturalHeight = Math.max(0, Number(naturalHeight) || 0)

  if (!safeNaturalWidth || !safeNaturalHeight || !safeSlotHeight) return 0

  const heightScale = safeSlotHeight / safeNaturalHeight
  const widthScale = safeSlotWidth > 0 ? (safeSlotWidth / safeNaturalWidth) : 0
  const trueSizeScale = 1
  const growthTargetScale = Math.max(widthScale, trueSizeScale)

  if (pageFit === 'overflow') {
    return Math.max(
      heightScale * 1.14,
      lerp(heightScale, growthTargetScale, 0.38),
    )
  }
  if (pageFit === 'cover') {
    return Math.max(
      heightScale * 1.28,
      lerp(heightScale, growthTargetScale, 0.74),
    )
  }
  if (pageFit === 'original') {
    return Math.max(trueSizeScale, heightScale)
  }
  return heightScale
}

function getSizedPageLayout({
  pageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
  slotWidth = 0,
  slotHeight = 0,
  naturalWidth = 0,
  naturalHeight = 0,
} = {}) {
  const safeNaturalWidth = Math.max(0, Number(naturalWidth) || 0)
  const safeNaturalHeight = Math.max(0, Number(naturalHeight) || 0)
  if (!safeNaturalWidth || !safeNaturalHeight) return null

  const baseScale = getBasePageScale({
    pageFit,
    slotWidth,
    slotHeight,
    naturalWidth: safeNaturalWidth,
    naturalHeight: safeNaturalHeight,
  })
  if (!Number.isFinite(baseScale) || baseScale <= 0) return null

  const scale = baseScale * getZoomScale(zoomPercent)
  if (!Number.isFinite(scale) || scale <= 0) return null

  return {
    width: Math.max(1, Math.round(safeNaturalWidth * scale)),
    height: Math.max(1, Math.round(safeNaturalHeight * scale)),
  }
}

function getPagedSizedPageLayout({
  pageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
  slotWidth = 0,
  slotHeight = 0,
  naturalWidth = 0,
  naturalHeight = 0,
} = {}) {
  const safeNaturalWidth = Math.max(0, Number(naturalWidth) || 0)
  const safeNaturalHeight = Math.max(0, Number(naturalHeight) || 0)
  if (!safeNaturalWidth || !safeNaturalHeight) return null

  const baseScale = getPagedBasePageScale({
    pageFit,
    slotWidth,
    slotHeight,
    naturalWidth: safeNaturalWidth,
    naturalHeight: safeNaturalHeight,
  })
  if (!Number.isFinite(baseScale) || baseScale <= 0) return null

  const requestedScale = baseScale * getZoomScale(zoomPercent)
  const scale = Math.max(baseScale, requestedScale)
  if (!Number.isFinite(scale) || scale <= 0) return null

  return {
    width: Math.max(1, Math.round(safeNaturalWidth * scale)),
    height: Math.max(1, Math.round(safeNaturalHeight * scale)),
  }
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
  const pageFit = normalizePageFit(next.pageFit)
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
    effectivePageFit: pageFit,
    stripPageFitPreset: pageFit,
  }
}

export function getReaderScrollSheetVariables({
  stripReadingMode = false,
  stripPageFitPreset = 'contain',
  effectivePageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
} = {}) {
  const safeZoom = clamp(Number(zoomPercent ?? DEFAULT_READER_SETTINGS.zoomPercent) || DEFAULT_READER_SETTINGS.zoomPercent, 60, 180)
  return {
    '--reader-scroll-stage-max-width': `${interpolateZoomRange(safeZoom, 1220, 2040)}px`,
  }
}

export function getReaderCanvasVariables({
  effectivePageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
} = {}) {
  return {
    '--reader-canvas-sheet-width': 'auto',
    '--reader-canvas-sheet-height': 'auto',
    '--reader-canvas-sheet-max-width': 'none',
    '--reader-canvas-sheet-max-height': 'none',
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
  return getPagedSizedPageLayout({
    pageFit: effectivePageFit,
    zoomPercent,
    slotWidth,
    slotHeight,
    naturalWidth,
    naturalHeight,
  })
}

export function getReaderPagedSlotMetrics({
  readingMode = DEFAULT_READER_SETTINGS.readingMode,
  stageSurfaceMetrics = {},
} = {}) {
  const columnCount = readingMode === 'double' ? 2 : 1
  const spreadGap = readingMode === 'double' ? 18 : 0
  const stageWidth = Math.max(0, Number(stageSurfaceMetrics?.width) || 0)
  const stageHeight = Math.max(0, Number(stageSurfaceMetrics?.height) || 0)
  const safeSpreadWidth = Math.max(0, stageWidth - (spreadGap * (columnCount - 1)))

  return {
    width: columnCount > 0 ? safeSpreadWidth / columnCount : 0,
    height: stageHeight,
  }
}

export function getReaderScrollPageLayout({
  effectivePageFit = DEFAULT_READER_SETTINGS.pageFit,
  zoomPercent = DEFAULT_READER_SETTINGS.zoomPercent,
  viewportWidth = 0,
  viewportHeight = 0,
  naturalWidth = 0,
  naturalHeight = 0,
} = {}) {
  return getSizedPageLayout({
    pageFit: effectivePageFit,
    zoomPercent,
    slotWidth: viewportWidth,
    slotHeight: viewportHeight,
    naturalWidth,
    naturalHeight,
  })
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

export function getReaderViewport({ readingMode = 'paged', currentPage = 0, totalPages = 0, pageMetrics = [] }) {
  const safeTotal = Math.max(0, Number(totalPages) || 0)
  if (safeTotal === 0) {
    return { startIndex: 0, endIndex: 0, visiblePages: [], pageLabel: '0' }
  }

  const safePage = clamp(Number(currentPage) || 0, 0, safeTotal - 1)
  if (readingMode === 'double') {
    const startIndex = safePage - (safePage % 2)
    const endIndex = Math.min(safeTotal - 1, startIndex + 1)
    const visiblePages = endIndex === startIndex ? [startIndex] : [startIndex, endIndex]
    return {
      startIndex,
      endIndex,
      visiblePages,
      pageLabel: visiblePages.length === 1 ? `${startIndex + 1}` : `${startIndex + 1} - ${endIndex + 1}`,
    }
  }

  return {
    startIndex: safePage,
    endIndex: safePage,
    visiblePages: [safePage],
    pageLabel: `${safePage + 1}`,
  }
}

export function stepReaderIndex({ readingMode = 'paged', currentPage = 0, totalPages = 0, direction = 'next', pageMetrics = [] }) {
  const safeTotal = Math.max(0, Number(totalPages) || 0)
  if (safeTotal <= 1) return 0

  if (readingMode === 'double') {
    const startIndex = clamp((Number(currentPage) || 0) - ((Number(currentPage) || 0) % 2), 0, safeTotal - 1)
    const delta = direction === 'prev' ? -2 : 2
    return clamp(startIndex + delta, 0, safeTotal - 1)
  }

  const step = 1
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
