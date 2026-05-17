import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getReaderCanvasVariables,
  getReaderCanvasPageLayout,
  DEFAULT_READER_SETTINGS,
  getReaderPagedSlotMetrics,
  getReaderSpreadPages,
  getReaderScrollPageLayout,
  getReaderScrollSheetVariables,
  getReaderViewMode,
  getReaderViewport,
  normalizeReaderPages,
  normalizeReaderSettings,
  stepReaderIndex,
} from './mangaReaderLayout.js'

const componentPath = resolve(import.meta.dirname, './MangaReader.jsx')
const cssPath = resolve(import.meta.dirname, '../../gui-v2/styles/gui2.css')
const stageLayoutPath = resolve(import.meta.dirname, './reader/readerStageLayout.js')
const headerPath = resolve(import.meta.dirname, './reader/ReaderStageHeader.jsx')
const settingsSheetPath = resolve(import.meta.dirname, './reader/ReaderSettingsSheet.jsx')
const chapterBrowserPath = resolve(import.meta.dirname, './reader/ReaderChapterBrowser.jsx')

const componentSource = readFileSync(componentPath, 'utf8')
const cssSource = readFileSync(cssPath, 'utf8')
const stageLayoutSource = readFileSync(stageLayoutPath, 'utf8')
const headerSource = readFileSync(headerPath, 'utf8')
const settingsSheetSource = readFileSync(settingsSheetPath, 'utf8')
const chapterBrowserSource = readFileSync(chapterBrowserPath, 'utf8')

assert.equal(DEFAULT_READER_SETTINGS.readingMode, 'double')
assert.equal(DEFAULT_READER_SETTINGS.pageFit, 'contain')
assert.equal(DEFAULT_READER_SETTINGS.zoomPercent, 100)
assert.equal(DEFAULT_READER_SETTINGS.settingsOpen, true)
assert.equal(DEFAULT_READER_SETTINGS.autoHideDelaySec, 3)

assert.deepEqual(
  normalizeReaderSettings({ readingMode: 'scroll', zoomPercent: 150, brightness: 14 }),
  {
    ...DEFAULT_READER_SETTINGS,
    readingMode: 'scroll',
    zoomPercent: 150,
    brightness: 14,
  },
)

assert.deepEqual(
  normalizeReaderSettings({ readingMode: 'bad', pageFit: 'wat', zoomPercent: 999, brightness: -99, contrast: 99, autoHideDelaySec: 20 }),
  {
    ...DEFAULT_READER_SETTINGS,
    zoomPercent: 180,
    brightness: -40,
    contrast: 40,
    autoHideDelaySec: 6,
  },
)

assert.equal(normalizeReaderSettings({ pageFit: 'cover' }).pageFit, 'cover')
assert.equal(normalizeReaderSettings({ pageFit: 'width' }).pageFit, 'overflow')
assert.equal(normalizeReaderSettings({ pageFit: 'height' }).pageFit, 'contain')

assert.deepEqual(
  getReaderViewport({
    readingMode: 'double',
    currentPage: 0,
    totalPages: 6,
    pageMetrics: [
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 2400, naturalHeight: 1600 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
    ],
  }),
  {
    startIndex: 0,
    endIndex: 1,
    visiblePages: [0, 1],
    pageLabel: '1 - 2',
  },
)

assert.deepEqual(
  getReaderViewport({
    readingMode: 'double',
    currentPage: 2,
    totalPages: 6,
    pageMetrics: [
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 2400, naturalHeight: 1600 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
    ],
  }),
  {
    startIndex: 2,
    endIndex: 3,
    visiblePages: [2, 3],
    pageLabel: '3 - 4',
  },
)

assert.deepEqual(
  getReaderViewport({ readingMode: 'paged', currentPage: 0, totalPages: 257 }),
  {
    startIndex: 0,
    endIndex: 0,
    visiblePages: [0],
    pageLabel: '1',
  },
)

assert.deepEqual(
  getReaderSpreadPages({
    readingMode: 'double',
    readingDirection: 'ltr',
    visiblePages: [4, 5],
  }),
  [
    { pageIndex: 4, slot: 'left' },
    { pageIndex: 5, slot: 'right' },
  ],
)

assert.deepEqual(
  getReaderSpreadPages({
    readingMode: 'double',
    readingDirection: 'rtl',
    visiblePages: [4, 5],
  }),
  [
    { pageIndex: 4, slot: 'right' },
    { pageIndex: 5, slot: 'left' },
  ],
)

assert.equal(
  stepReaderIndex({
    readingMode: 'double',
    currentPage: 0,
    totalPages: 6,
    direction: 'next',
    pageMetrics: [
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 2400, naturalHeight: 1600 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
    ],
  }),
  2,
)
assert.equal(
  stepReaderIndex({
    readingMode: 'double',
    currentPage: 2,
    totalPages: 6,
    direction: 'next',
    pageMetrics: [
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 2400, naturalHeight: 1600 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
    ],
  }),
  4,
)
assert.equal(
  stepReaderIndex({
    readingMode: 'double',
    currentPage: 4,
    totalPages: 6,
    direction: 'prev',
    pageMetrics: [
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 2400, naturalHeight: 1600 },
      { naturalWidth: 1600, naturalHeight: 2400 },
      { naturalWidth: 1600, naturalHeight: 2400 },
    ],
  }),
  2,
)
assert.equal(stepReaderIndex({ readingMode: 'paged', currentPage: 0, totalPages: 257, direction: 'prev' }), 0)

assert.deepEqual(
  getReaderViewMode({ readingMode: 'scroll', pageFit: 'height', contentFormat: 'MANHWA', countryOfOrigin: 'KR' }),
  {
    continuousScrollMode: true,
    stripReadingMode: true,
    effectivePageFit: 'height',
    stripPageFitPreset: 'height',
  },
)

assert.deepEqual(
  getReaderViewMode({ readingMode: 'scroll', pageFit: 'original', contentFormat: 'MANHUA', countryOfOrigin: 'CN' }),
  {
    continuousScrollMode: true,
    stripReadingMode: true,
    effectivePageFit: 'original',
    stripPageFitPreset: 'original',
  },
)

assert.deepEqual(
  getReaderViewMode({ readingMode: 'scroll', pageFit: 'height', contentFormat: 'MANGA', countryOfOrigin: 'JP' }),
  {
    continuousScrollMode: true,
    stripReadingMode: false,
    effectivePageFit: 'height',
    stripPageFitPreset: 'height',
  },
)

assert.deepEqual(
  getReaderScrollSheetVariables({ stripReadingMode: true, stripPageFitPreset: 'overflow', effectivePageFit: 'overflow', zoomPercent: 100 }),
  {
    '--reader-scroll-stage-max-width': '1493px',
  },
)

assert.deepEqual(
  getReaderScrollSheetVariables({ stripReadingMode: true, stripPageFitPreset: 'contain', effectivePageFit: 'overflow', zoomPercent: 100 }),
  {
    '--reader-scroll-stage-max-width': '1493px',
  },
)

assert.deepEqual(
  getReaderScrollSheetVariables({ stripReadingMode: true, stripPageFitPreset: 'contain', effectivePageFit: 'contain', zoomPercent: 100 }),
  {
    '--reader-scroll-stage-max-width': '1493px',
  },
)

assert.deepEqual(
  getReaderScrollSheetVariables({ stripReadingMode: true, stripPageFitPreset: 'original', effectivePageFit: 'original', zoomPercent: 100 }),
  {
    '--reader-scroll-stage-max-width': '1493px',
  },
)

assert.deepEqual(
  getReaderCanvasVariables({ effectivePageFit: 'overflow', zoomPercent: 120 }),
  {
    '--reader-canvas-sheet-width': 'auto',
    '--reader-canvas-sheet-height': 'auto',
    '--reader-canvas-sheet-max-width': 'none',
    '--reader-canvas-sheet-max-height': 'none',
  },
)

assert.deepEqual(
  getReaderCanvasVariables({ effectivePageFit: 'contain', zoomPercent: 80 }),
  {
    '--reader-canvas-sheet-width': 'auto',
    '--reader-canvas-sheet-height': 'auto',
    '--reader-canvas-sheet-max-width': 'none',
    '--reader-canvas-sheet-max-height': 'none',
  },
)

assert.deepEqual(
  getReaderCanvasVariables({ effectivePageFit: 'original', zoomPercent: 150 }),
  {
    '--reader-canvas-sheet-width': 'auto',
    '--reader-canvas-sheet-height': 'auto',
    '--reader-canvas-sheet-max-width': 'none',
    '--reader-canvas-sheet-max-height': 'none',
  },
)

const pagedPortraitAtDefaultZoom = getReaderCanvasPageLayout({
  effectivePageFit: 'contain',
  zoomPercent: 100,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

const pagedPortraitOverflow = getReaderCanvasPageLayout({
  effectivePageFit: 'overflow',
  zoomPercent: 100,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

const pagedPortraitCover = getReaderCanvasPageLayout({
  effectivePageFit: 'cover',
  zoomPercent: 100,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

const pagedPortraitOriginal = getReaderCanvasPageLayout({
  effectivePageFit: 'original',
  zoomPercent: 100,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

assert.deepEqual(pagedPortraitAtDefaultZoom, { width: 600, height: 900 })
assert.ok(
  pagedPortraitOverflow.width > pagedPortraitAtDefaultZoom.width,
  'overflow mode should noticeably widen portrait paged pages beyond contain mode',
)
assert.ok(
  pagedPortraitOverflow.height > pagedPortraitAtDefaultZoom.height,
  'overflow mode should allow paged pages to run taller than the contained viewport box',
)
assert.ok(
  pagedPortraitCover.width > pagedPortraitOverflow.width,
  'cover mode should push portrait paged pages beyond overflow mode',
)
assert.ok(
  pagedPortraitCover.height > pagedPortraitOverflow.height,
  'cover mode should crop more aggressively than overflow in paged mode',
)
assert.ok(
  pagedPortraitOriginal.width > pagedPortraitCover.width,
  'original mode should preserve a stronger true-size bias than cover for large portrait pages',
)
assert.ok(
  pagedPortraitOriginal.height > pagedPortraitCover.height,
  'original mode should stay larger than cover when the source page exceeds the viewport',
)

assert.deepEqual(
  getReaderCanvasPageLayout({
    effectivePageFit: 'contain',
    zoomPercent: 100,
    slotWidth: 1280,
    slotHeight: 900,
    naturalWidth: 2400,
    naturalHeight: 1600,
  }),
  { width: 1350, height: 900 },
)

const pagedLandscapeOverflow = getReaderCanvasPageLayout({
  effectivePageFit: 'overflow',
  zoomPercent: 100,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 2400,
  naturalHeight: 1600,
})

const pagedLandscapeCover = getReaderCanvasPageLayout({
  effectivePageFit: 'cover',
  zoomPercent: 100,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 2400,
  naturalHeight: 1600,
})

assert.ok(
  pagedLandscapeOverflow.width > 1350,
  'overflow mode should still noticeably enlarge landscape paged pages beyond contain mode',
)
assert.ok(
  pagedLandscapeCover.width > pagedLandscapeOverflow.width,
  'cover mode should remain more aggressive than overflow on landscape paged pages',
)

assert.deepEqual(
  getReaderCanvasPageLayout({
    effectivePageFit: 'original',
    zoomPercent: 100,
    slotWidth: 1280,
    slotHeight: 900,
    naturalWidth: 600,
    naturalHeight: 800,
  }),
  { width: 675, height: 900 },
)

assert.deepEqual(
  getReaderCanvasPageLayout({
    effectivePageFit: 'contain',
    zoomPercent: 60,
    slotWidth: 1280,
    slotHeight: 900,
    naturalWidth: 600,
    naturalHeight: 800,
  }),
  { width: 675, height: 900 },
)

assert.deepEqual(
  getReaderCanvasPageLayout({
    effectivePageFit: 'original',
    zoomPercent: 100,
    slotWidth: 631,
    slotHeight: 900,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  { width: 1600, height: 2400 },
)

assert.deepEqual(
  getReaderPagedSlotMetrics({
    readingMode: 'paged',
    stageSurfaceMetrics: { width: 1200, height: 1480 },
  }),
  { width: 1200, height: 1480 },
)

assert.deepEqual(
  getReaderPagedSlotMetrics({
    readingMode: 'double',
    stageSurfaceMetrics: { width: 1200, height: 1480 },
  }),
  { width: 591, height: 1480 },
)

assert.deepEqual(
  getReaderScrollPageLayout({
    effectivePageFit: 'contain',
    zoomPercent: 100,
    viewportWidth: 1120,
    viewportHeight: 980,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  { width: 653, height: 980 },
)

assert.deepEqual(
  getReaderScrollPageLayout({
    effectivePageFit: 'original',
    zoomPercent: 100,
    viewportWidth: 1120,
    viewportHeight: 980,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  { width: 1600, height: 2400 },
)

const scrollPortraitContain = getReaderScrollPageLayout({
  effectivePageFit: 'contain',
  zoomPercent: 100,
  viewportWidth: 1120,
  viewportHeight: 980,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

const scrollPortraitOverflow = getReaderScrollPageLayout({
  effectivePageFit: 'overflow',
  zoomPercent: 100,
  viewportWidth: 1120,
  viewportHeight: 980,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

const scrollPortraitCover = getReaderScrollPageLayout({
  effectivePageFit: 'cover',
  zoomPercent: 100,
  viewportWidth: 1120,
  viewportHeight: 980,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

const scrollPortraitOriginal = getReaderScrollPageLayout({
  effectivePageFit: 'original',
  zoomPercent: 100,
  viewportWidth: 1120,
  viewportHeight: 980,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

assert.ok(
  scrollPortraitContain.width < scrollPortraitOverflow.width,
  'overflow mode should visibly widen portrait scroll pages beyond contain mode',
)
assert.ok(
  scrollPortraitOverflow.width < scrollPortraitCover.width,
  'cover mode should remain larger than overflow for portrait scroll pages',
)
assert.ok(
  scrollPortraitCover.width < scrollPortraitOriginal.width,
  'original mode should keep its stronger true-size footprint for large portrait scroll pages',
)

const scrollLandscapeContain = getReaderScrollPageLayout({
  effectivePageFit: 'contain',
  zoomPercent: 100,
  viewportWidth: 1120,
  viewportHeight: 980,
  naturalWidth: 2400,
  naturalHeight: 1600,
})

const scrollLandscapeOverflow = getReaderScrollPageLayout({
  effectivePageFit: 'overflow',
  zoomPercent: 100,
  viewportWidth: 1120,
  viewportHeight: 980,
  naturalWidth: 2400,
  naturalHeight: 1600,
})

const scrollLandscapeCover = getReaderScrollPageLayout({
  effectivePageFit: 'cover',
  zoomPercent: 100,
  viewportWidth: 1120,
  viewportHeight: 980,
  naturalWidth: 2400,
  naturalHeight: 1600,
})

assert.ok(
  scrollLandscapeOverflow.width > scrollLandscapeContain.width,
  'overflow mode should still enlarge landscape scroll pages beyond contain mode',
)
assert.ok(
  scrollLandscapeCover.width > scrollLandscapeOverflow.width,
  'cover mode should stay larger than overflow for landscape scroll pages too',
)

assert.deepEqual(
  normalizeReaderPages([
    { index: 7, url: 'https://cdn.example/page-b.jpg' },
    { index: 7, url: 'https://cdn.example/page-c.jpg' },
    { url: 'https://cdn.example/page-d.jpg' },
  ], 'chapter-77'),
  [
    {
      index: 7,
      url: 'https://cdn.example/page-b.jpg',
      sourceIndex: 7,
      sequenceIndex: 0,
      renderKey: 'chapter-77:0:7:https://cdn.example/page-b.jpg',
    },
    {
      index: 7,
      url: 'https://cdn.example/page-c.jpg',
      sourceIndex: 7,
      sequenceIndex: 1,
      renderKey: 'chapter-77:1:7:https://cdn.example/page-c.jpg',
    },
    {
      url: 'https://cdn.example/page-d.jpg',
      sourceIndex: 2,
      sequenceIndex: 2,
      renderKey: 'chapter-77:2:2:https://cdn.example/page-d.jpg',
    },
  ],
)

assert.ok(componentSource.includes('reader-shell-v2'), 'reader component should render the new shell root')
assert.ok(componentSource.includes('ReaderSettingsSheet'), 'reader component should mount a dedicated settings sheet component')
assert.ok(componentSource.includes('readingMode'), 'reader component should use the new settings model')
assert.ok(componentSource.includes('getReaderViewport'), 'reader component should rely on the shared viewport helper')
assert.ok(headerSource.includes('Double Page'), 'reader header should expose double-page mode in the UI')
assert.ok(!componentSource.includes('reader-shell-visible'), 'reader component should keep the app shell hidden while the reader is open')
assert.ok(componentSource.includes('window.scrollTo({ top: 0, left: 0, behavior: \'auto\' })'), 'reader should reset the window scroll to the top when a chapter opens')
assert.ok(componentSource.includes('verticalRef.current.scrollTo({ top: 0, left: 0, behavior: \'auto\' })'), 'reader should reset the scroll canvas to the top when a chapter opens')
assert.ok(componentSource.includes('pageCanvasRef.current.scrollTo({ top: 0, left: 0, behavior: \'auto\' })'), 'reader should reset the paged canvas scroll to the top when a chapter opens')
assert.ok(componentSource.includes('continuousScrollMode'), 'reader should model scroll as a dedicated continuous rendering path')
assert.ok(componentSource.includes('reader-scroll-canvas--strip'), 'reader should expose a strip-scroll class for webtoon-like titles')
assert.ok(componentSource.includes('reader-scroll-image'), 'reader should render scroll mode through a raw image path')
assert.ok(componentSource.includes('reader-scroll-stack'), 'reader should render scroll mode through a dedicated continuous stack')
assert.ok(componentSource.includes('normalizeReaderPages(loadedPages, chapterID)'), 'reader should normalize page identity before rendering')
assert.ok(componentSource.includes('key={page.renderKey}'), 'reader should use stable local page keys instead of trusting source indexes')
assert.ok(componentSource.includes('contentFormat = \'\''), 'reader should accept a content format hint')
assert.ok(componentSource.includes('countryOfOrigin = \'\''), 'reader should accept a country-of-origin hint')
assert.ok(componentSource.includes('getReaderViewMode({'), 'reader should centralize strip reader mode resolution')
assert.ok(componentSource.includes('getReaderScrollSheetVariables({'), 'reader should centralize scroll-sheet sizing decisions')
assert.ok(componentSource.includes('getReaderCanvasVariables({'), 'reader should centralize paged-canvas sizing decisions')
assert.ok(componentSource.includes('getReaderCanvasPageLayout({'), 'reader should compute direct paged page sizing from slot dimensions')
assert.ok(settingsSheetSource.includes('label="Fit Height"'), 'reader should expose fit-height as a fit option')
assert.ok(settingsSheetSource.includes('label="Fit Width"'), 'reader should expose fit-width as a fit option')
assert.ok(settingsSheetSource.includes('ReaderToggleButton active={readerSettings.pageFit === \'cover\''), 'reader should expose cover as a fit option')
assert.ok(componentSource.includes("if (event.key === 'ArrowDown')"), 'reader should handle down-arrow viewport travel directly')
assert.ok(componentSource.includes("if (event.key === 'ArrowUp')"), 'reader should handle up-arrow viewport travel directly')
assert.ok(componentSource.includes("scrollReaderViewport('down')"), 'reader should scroll the active reader viewport downward when possible')
assert.ok(componentSource.includes("scrollReaderViewport('up')"), 'reader should scroll the active reader viewport upward when possible')
assert.ok(componentSource.includes('const targetNode = readerSettings.readingMode === \'scroll\' ? verticalRef.current : pageCanvasRef.current'), 'reader should unify vertical keyboard travel across scroll and paged canvases')
assert.ok(chapterBrowserSource.includes('reader-chapter-browser-grid'), 'reader should expose a grid-driven chapter browser overlay')
assert.ok(stageLayoutSource.includes('getReaderStageSpreadLayout'), 'reader rebuild should centralize spread geometry in a dedicated stage helper')
assert.ok(stageLayoutSource.includes('getReaderStagePageLayout'), 'reader rebuild should centralize page geometry in a dedicated stage helper')
assert.ok(cssSource.includes('.reader-shell-v2'), 'reader shell styling should remain centralized in gui2.css')
assert.ok(cssSource.includes('.reader-settings-panel'), 'reader settings overlay styling should remain centralized in gui2.css')
assert.ok(componentSource.includes("reader-page-sheet--double-left"), 'reader should expose a gutter-aware left slot class for double-page spreads')
assert.ok(componentSource.includes("reader-page-sheet--double-right"), 'reader should expose a gutter-aware right slot class for double-page spreads')
assert.ok(componentSource.includes("sheetClassName={sheetClassName}"), 'reader should route paged sheet classes through a computed spread slot helper')
assert.ok(componentSource.includes('const stageSurfaceRef = useRef(null)'), 'reader should measure a dedicated stage surface instead of the padded page canvas')
assert.ok(componentSource.includes('const [stageSurfaceMetrics, setStageSurfaceMetrics] = useState({ width: 0, height: 0 })'), 'reader should track full stage metrics separately from the canvas node')
assert.ok(componentSource.includes('getReaderPagedSlotMetrics({'), 'reader should centralize paged slot sizing in a shared helper')
assert.ok(componentSource.includes('stageSurfaceMetrics,'), 'reader should pass stage surface geometry into paged slot sizing')
assert.ok(!componentSource.includes('sheetClassName="reader-page-sheet--scroll"'), 'reader should not render scroll mode through paged sheet wrappers')
assert.ok(!componentSource.includes('preserveReaderViewport, readerSettings.pageFit, readerSettings.readingMode, uiVisible'), 'reader UI visibility toggles should not re-run viewport restoration')
assert.ok(!componentSource.includes('<footer className="reader-bottom-bar"'), 'reader should not render the deprecated bottom toolbar')
assert.ok(!componentSource.includes('const saved = getMangaReaderProgress(sourceID, mangaID, chapterID)'), 'reader should not auto-restore into the last saved page when opening a chapter')
assert.ok(componentSource.includes('const blockingPreloadCount = readerSettings.readingMode === \'scroll\''), 'reader should size the blocking preload window based on the active reading mode')
assert.ok(componentSource.includes('await Promise.allSettled(nextPages.slice(0, blockingPreloadCount).map(preloadReaderPage))'), 'reader should only block on the first visible reader pages before revealing the chapter')
assert.ok(componentSource.includes('void Promise.allSettled(nextPages.slice(blockingPreloadCount).map(preloadReaderPage))'), 'reader should continue warming the remaining chapter pages in the background after the first visible batch is ready')
assert.ok(!componentSource.includes('await Promise.allSettled(nextPages.map(preloadReaderPage))'), 'reader should not block initial chapter reveal on every single page image anymore')
assert.ok(settingsSheetSource.includes('<div className="reader-settings-label">Zoom</div>'), 'reader settings should expose the zoom controls again')
assert.ok(settingsSheetSource.includes('label="Zoom"'), 'reader settings should render a zoom slider row')
assert.ok(componentSource.includes('preserveReaderViewport()'), 'reader should preserve the current viewport when fit/layout changes')
assert.ok(!componentSource.includes('[chapterID, error, loading, pages.length, readerSettings.readingMode, resetReaderViewportToStart]'), 'reader should not reset back to the first page when only the reading mode changes')
assert.ok(componentSource.includes('getReaderSpreadPages({'), 'reader should delegate double-page slot ordering to a shared helper')
assert.ok(!componentSource.includes("(readerSettings.readingDirection === 'rtl' ? [...viewport.visiblePages].reverse() : viewport.visiblePages).map"), 'reader should not reverse spread pages inline for rtl double-page rendering')
assert.ok(componentSource.includes('getReaderScrollPageLayout({'), 'reader should compute explicit scroll-page sizing from intrinsic page geometry')
assert.ok(!componentSource.includes('naturalWidth: contentBoxRect?.width ?? intrinsicPageSize?.naturalWidth'), 'reader should not let detected crop bounds redefine scroll geometry')
assert.ok(!componentSource.includes('naturalHeight: contentBoxRect?.height ?? intrinsicPageSize?.naturalHeight'), 'reader should not let detected crop bounds redefine page height contracts')
assert.ok(!componentSource.includes("'--reader-canvas-sheet-max-width': '100%'"), 'reader should not apply a contain-only width clamp that fights paged height-fill sizing')
assert.ok(!componentSource.includes("'--reader-canvas-sheet-height': '100%'"), 'reader should not switch paged sheet sizing contracts per fit mode')

assert.ok(cssSource.includes('.reader-shell-v2'), 'reader shell CSS should exist in gui2.css')
assert.ok(cssSource.includes('.reader-settings-panel'), 'reader settings panel CSS should exist in gui2.css')
assert.ok(cssSource.includes('.reader-stage--double'), 'reader double-page stage CSS should exist in gui2.css')
assert.ok(cssSource.includes('.reader-scroll-stack'), 'reader CSS should define a dedicated continuous scroll stack')
assert.ok(cssSource.includes('var(--reader-scroll-stage-max-width'), 'reader CSS should keep a configurable stage max-width without per-fit heuristic page caps')
assert.ok(cssSource.includes('.reader-scroll-slice'), 'reader CSS should define seam-free scroll slices')
assert.ok(/\.reader-scroll-slice\s*\{[^}]*width:\s*100%;[^}]*place-items:\s*center;/s.test(cssSource), 'scroll slices should stay full-width and center their page payload')
assert.ok(cssSource.includes('.reader-scroll-image'), 'reader CSS should style scroll pages without page chrome')
assert.ok(cssSource.includes('.reader-stage-surface'), 'reader CSS should define a dedicated full-bleed stage surface for paged modes')
assert.ok(/\.reader-stage-surface\s*\{[^}]*height:\s*100%;/s.test(cssSource), 'reader stage surface should fill the entire reader stage height')
assert.ok(/\.reader-page-canvas\s*\{[^}]*align-items:\s*stretch;/s.test(cssSource), 'reader page canvas should stretch to the stage instead of top-padding pages into place')
assert.ok(/\.reader-page-canvas\s*\{[^}]*padding:\s*0;/s.test(cssSource), 'reader page canvas should not reserve synthetic reader chrome spacing')
assert.ok(cssSource.includes('max-height: 100%;'), 'reader CSS should keep paged media contained without forcing a fixed height')
assert.ok(cssSource.includes('width: var(--reader-canvas-sheet-width, auto);'), 'reader CSS should size paged sheets through explicit canvas box variables')
assert.ok(cssSource.includes('height: var(--reader-canvas-sheet-height, auto);'), 'reader CSS should size pages through explicit sheet height variables without forcing fill')
assert.ok(cssSource.includes('max-width: var(--reader-canvas-sheet-max-width, none);'), 'reader CSS should not silently clamp paged sheets narrower than the computed layout width')
assert.ok(cssSource.includes('max-height: var(--reader-canvas-sheet-max-height, none);'), 'reader CSS should not silently clamp paged sheet height below the computed stage-fill size')
assert.ok(cssSource.includes('.reader-page-sheet--paged,'), 'reader CSS should define dedicated paged sheet classes')
assert.ok(cssSource.includes('.reader-page-sheet--double {'), 'reader CSS should define dedicated double-page sheet classes')
assert.ok(cssSource.includes('justify-self: center;'), 'reader CSS should center paged sheets within their slots')
assert.ok(cssSource.includes('.reader-page-sheet--double-left {'), 'reader CSS should define a left spread slot class')
assert.ok(cssSource.includes('.reader-page-sheet--double-right {'), 'reader CSS should define a right spread slot class')
assert.ok(/\.reader-page-sheet--double-left\s*\{[^}]*grid-column:\s*1;/s.test(cssSource), 'reader double-page left slot should be forced into the left spread column')
assert.ok(/\.reader-page-sheet--double-right\s*\{[^}]*grid-column:\s*2;/s.test(cssSource), 'reader double-page right slot should be forced into the right spread column')
assert.ok(/\.reader-page-sheet--double-left\s*\{[^}]*justify-self:\s*end;/s.test(cssSource), 'reader double-page left slot should anchor toward the gutter')
assert.ok(/\.reader-page-sheet--double-right\s*\{[^}]*justify-self:\s*start;/s.test(cssSource), 'reader double-page right slot should anchor toward the gutter')
assert.ok(cssSource.includes('background: transparent;'), 'reader CSS should avoid rendering dead space as a dark card around paged pages')
assert.ok(/\.reader-stage-surface\s*\{[^}]*height:\s*100%;/s.test(cssSource), 'reader stage surface should own the full geometry height')
assert.ok(/\.reader-page-canvas\s*\{[^}]*align-items:\s*stretch;/s.test(cssSource), 'reader paged canvas should stretch across the full stage instead of using top-padded alignment')
assert.ok(/\.reader-page-canvas\s*\{[^}]*padding:\s*0;/s.test(cssSource), 'reader paged canvas should not reserve reader chrome space inside the geometry surface')
assert.ok(/\.reader-spread\s*\{[^}]*align-content:\s*start;/s.test(cssSource), 'reader spread should stack its page rows from the top to avoid synthetic deadspace')
assert.ok(/\.reader-spread\s*\{[^}]*width: 100%;[^}]*min-height: 100%;[^}]*height:\s*100%;/s.test(cssSource), 'reader spread should own the available viewport height without shrinking below the stage surface')
assert.ok(/\.reader-spread\s*\{[^}]*max-width:\s*none;/s.test(cssSource), 'reader spread should not keep a hidden width cap that diverges from stage-based slot metrics')
assert.ok(!cssSource.includes('max-width: min(1560px, 100%);'), 'reader spread should not reuse the old fixed spread cap in paged or double mode')
assert.ok(/\.reader-spread\s*\{[^}]*padding-bottom:\s*0;/s.test(cssSource), 'reader spread should not reserve synthetic bottom gap below the page content')
assert.ok(/\.reader-page-sheet--paged,\s*\.reader-page-sheet--double\s*\{[^}]*align-self:\s*start;/s.test(cssSource), 'paged sheets should pin to the top of the spread instead of vertically centering')
assert.ok(cssSource.includes('height: calc(100dvh - var(--gui2-topbar-h) - 12px);'), 'reader shell should lock to the available viewport height')
assert.ok(!cssSource.includes('body.reader-active.reader-shell-visible .gui2-content'), 'reader CSS should not restore the app shell while reading')
assert.ok(cssSource.includes('body.reader-active .gui2-content'), 'reader CSS should reclaim the full content viewport while reading')
assert.ok(cssSource.includes('.reader-overlay-layer'), 'reader CSS should define an overlay layer for reader utilities')
assert.ok(!cssSource.includes('.reader-bottom-bar {'), 'reader CSS should not keep the deprecated bottom toolbar layout rules')
assert.ok(/\.reader-overlay-layer\s*\{[^}]*position:\s*fixed;/s.test(cssSource), 'reader overlay layer should stay fixed to the viewport')
assert.ok(cssSource.includes('body.reader-active .gui2-main'), 'reader shell state should reclaim the sidebar lane')
assert.ok(cssSource.includes('body.reader-active .gui2-content'), 'reader shell state should reclaim the content padding offsets')
assert.ok(cssSource.includes('.reader-shell-v2.reader-ui-hidden .reader-scroll-canvas--strip'), 'strip scroll mode should keep dead top and bottom padding removed when chrome auto-hides')
assert.ok(!cssSource.includes('.reader-page-sheet--scroll'), 'reader CSS should not keep a separate scroll page-sheet card path')
assert.ok(!cssSource.includes('.reader-scroll-page-wrap--strip + .reader-scroll-page-wrap--strip'), 'strip scroll mode should not rely on overlapping wrapper hacks that cut page content')
assert.ok(!cssSource.includes('transform: scale(var(--reader-zoom-scale, 1));'), 'reader CSS should not rely on transform zoom that fights fit sizing')
assert.ok(!cssSource.includes('.reader-page-sheet.reader-stage--paged'), 'reader CSS should not couple paged sheet sizing to the stage class names')
assert.ok(!cssSource.includes('--reader-canvas-page-width'), 'reader CSS should not drive crop-prone paged sizing through media width variables')
assert.ok(!cssSource.includes('height: min(var(--reader-scroll-page-height, 78vh), 960px);'), 'scroll sizing should not be capped by the old fit-height heuristic')

console.log('manga reader layout tests passed')
