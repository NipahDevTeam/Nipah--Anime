import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getReaderCanvasVariables,
  getReaderCanvasPageLayout,
  DEFAULT_READER_SETTINGS,
  getReaderScrollSheetVariables,
  getReaderViewMode,
  getReaderViewport,
  normalizeReaderPages,
  normalizeReaderSettings,
  stepReaderIndex,
} from './mangaReaderLayout.js'

const componentPath = resolve(import.meta.dirname, './MangaReader.jsx')
const cssPath = resolve(import.meta.dirname, '../../gui-v2/styles/gui2.css')

const componentSource = readFileSync(componentPath, 'utf8')
const cssSource = readFileSync(cssPath, 'utf8')

assert.equal(DEFAULT_READER_SETTINGS.readingMode, 'double')
assert.equal(DEFAULT_READER_SETTINGS.pageFit, 'width')
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

assert.deepEqual(
  getReaderViewport({ readingMode: 'double', currentPage: 121, totalPages: 257 }),
  {
    startIndex: 121,
    endIndex: 122,
    visiblePages: [121, 122],
    pageLabel: '122 - 123',
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

assert.equal(stepReaderIndex({ readingMode: 'double', currentPage: 121, totalPages: 257, direction: 'next' }), 123)
assert.equal(stepReaderIndex({ readingMode: 'double', currentPage: 121, totalPages: 257, direction: 'prev' }), 119)
assert.equal(stepReaderIndex({ readingMode: 'paged', currentPage: 0, totalPages: 257, direction: 'prev' }), 0)

assert.deepEqual(
  getReaderViewMode({ readingMode: 'scroll', pageFit: 'height', contentFormat: 'MANHWA', countryOfOrigin: 'KR' }),
  {
    continuousScrollMode: true,
    stripReadingMode: true,
    effectivePageFit: 'width',
    stripPageFitPreset: 'height',
  },
)

assert.deepEqual(
  getReaderViewMode({ readingMode: 'scroll', pageFit: 'original', contentFormat: 'MANHUA', countryOfOrigin: 'CN' }),
  {
    continuousScrollMode: true,
    stripReadingMode: true,
    effectivePageFit: 'width',
    stripPageFitPreset: 'original',
  },
)

assert.deepEqual(
  getReaderViewMode({ readingMode: 'scroll', pageFit: 'height', contentFormat: 'MANGA', countryOfOrigin: 'JP' }),
  {
    continuousScrollMode: true,
    stripReadingMode: false,
    effectivePageFit: 'height',
    stripPageFitPreset: 'width',
  },
)

assert.deepEqual(
  getReaderScrollSheetVariables({ stripReadingMode: true, stripPageFitPreset: 'width', effectivePageFit: 'width', zoomPercent: 100 }),
  { '--reader-scroll-page-width': '100%' },
)

assert.deepEqual(
  getReaderScrollSheetVariables({ stripReadingMode: true, stripPageFitPreset: 'height', effectivePageFit: 'width', zoomPercent: 100 }),
  { '--reader-scroll-page-width': '82%' },
)

assert.deepEqual(
  getReaderScrollSheetVariables({ stripReadingMode: true, stripPageFitPreset: 'original', effectivePageFit: 'width', zoomPercent: 100 }),
  { '--reader-scroll-page-width': '94%' },
)

assert.deepEqual(
  getReaderCanvasVariables({ effectivePageFit: 'width', zoomPercent: 120 }),
  {
    '--reader-canvas-sheet-width': '89%',
    '--reader-canvas-sheet-height': '100%',
    '--reader-canvas-sheet-max-width': '100%',
    '--reader-canvas-sheet-max-height': '100%',
  },
)

assert.deepEqual(
  getReaderCanvasVariables({ effectivePageFit: 'height', zoomPercent: 80 }),
  {
    '--reader-canvas-sheet-width': '100%',
    '--reader-canvas-sheet-height': '65%',
    '--reader-canvas-sheet-max-width': '100%',
    '--reader-canvas-sheet-max-height': '100%',
  },
)

assert.deepEqual(
  getReaderCanvasVariables({ effectivePageFit: 'original', zoomPercent: 150 }),
  {
    '--reader-canvas-sheet-width': 'auto',
    '--reader-canvas-sheet-height': 'auto',
    '--reader-canvas-sheet-max-width': '92%',
    '--reader-canvas-sheet-max-height': '92%',
  },
)

const pagedPortraitAtDefaultZoom = getReaderCanvasPageLayout({
  effectivePageFit: 'width',
  zoomPercent: 100,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

const pagedPortraitAtHighZoom = getReaderCanvasPageLayout({
  effectivePageFit: 'width',
  zoomPercent: 180,
  slotWidth: 1280,
  slotHeight: 900,
  naturalWidth: 1600,
  naturalHeight: 2400,
})

assert.deepEqual(pagedPortraitAtDefaultZoom, { width: 496, height: 744 })
assert.deepEqual(pagedPortraitAtHighZoom, { width: 600, height: 900 })
assert.ok(
  pagedPortraitAtHighZoom.height > pagedPortraitAtDefaultZoom.height,
  'paged zoom should enlarge the page itself instead of just inflating its wrapper',
)

assert.deepEqual(
  getReaderCanvasPageLayout({
    effectivePageFit: 'width',
    zoomPercent: 180,
    slotWidth: 631,
    slotHeight: 900,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  { width: 600, height: 900 },
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
assert.ok(componentSource.includes('reader-settings-panel'), 'reader component should render a toggled settings panel')
assert.ok(componentSource.includes('readingMode'), 'reader component should use the new settings model')
assert.ok(componentSource.includes('getReaderViewport'), 'reader component should rely on the shared viewport helper')
assert.ok(componentSource.includes('Double Page'), 'reader component should expose double-page mode in the UI')
assert.ok(!componentSource.includes('reader-shell-visible'), 'reader component should keep the app shell hidden while the reader is open')
assert.ok(componentSource.includes('window.scrollTo({ top: 0, left: 0, behavior: \'auto\' })'), 'reader should reset the window scroll to the top when a chapter opens')
assert.ok(componentSource.includes('verticalRef.current.scrollTo({ top: 0, left: 0, behavior: \'auto\' })'), 'reader should reset the scroll canvas to the top when a chapter opens')
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
assert.ok(componentSource.includes("sheetClassName={readerSettings.readingMode === 'double' ? 'reader-page-sheet--double' : 'reader-page-sheet--paged'}"), 'reader should use dedicated sheet classes for paged layouts instead of reusing the stage classes')
assert.ok(!componentSource.includes('sheetClassName="reader-page-sheet--scroll"'), 'reader should not render scroll mode through paged sheet wrappers')
assert.ok(!componentSource.includes('preserveReaderViewport, readerSettings.pageFit, readerSettings.readingMode, uiVisible'), 'reader UI visibility toggles should not re-run viewport restoration')
assert.ok(!componentSource.includes('<footer className="reader-bottom-bar"'), 'reader should not render the deprecated bottom toolbar')
assert.ok(!componentSource.includes('const saved = getMangaReaderProgress(sourceID, mangaID, chapterID)'), 'reader should not auto-restore into the last saved page when opening a chapter')
assert.ok(componentSource.includes('await Promise.allSettled(nextPages.map(preloadReaderPage))'), 'reader should wait for chapter pages to preload before revealing the chapter')
assert.ok(componentSource.includes('<div className="reader-settings-label">Zoom</div>'), 'reader settings should expose the zoom controls again')
assert.ok(componentSource.includes('label="Zoom"'), 'reader settings should render a zoom slider row')
assert.ok(componentSource.includes('preserveReaderViewport()'), 'reader should preserve the current viewport when fit/layout changes')

assert.ok(cssSource.includes('.reader-shell-v2'), 'reader shell CSS should exist in gui2.css')
assert.ok(cssSource.includes('.reader-settings-panel'), 'reader settings panel CSS should exist in gui2.css')
assert.ok(cssSource.includes('.reader-stage--double'), 'reader double-page stage CSS should exist in gui2.css')
assert.ok(cssSource.includes('.reader-scroll-stack'), 'reader CSS should define a dedicated continuous scroll stack')
assert.ok(cssSource.includes('.reader-scroll-slice'), 'reader CSS should define seam-free scroll slices')
assert.ok(cssSource.includes('.reader-scroll-image'), 'reader CSS should style scroll pages without page chrome')
assert.ok(cssSource.includes('max-height: 100%;'), 'reader CSS should keep paged media contained without forcing a fixed height')
assert.ok(cssSource.includes('width: var(--reader-canvas-sheet-width, 100%);'), 'reader CSS should size paged sheets through explicit canvas box variables')
assert.ok(cssSource.includes('height: var(--reader-canvas-sheet-height, 100%);'), 'reader CSS should size fit-height pages through explicit sheet height variables')
assert.ok(cssSource.includes('max-width: var(--reader-canvas-sheet-max-width, 100%);'), 'reader CSS should size original pages through explicit sheet max-width bounds')
assert.ok(cssSource.includes('max-height: var(--reader-canvas-sheet-max-height, 100%);'), 'reader CSS should cap paged sheet height to the viewport bounds')
assert.ok(cssSource.includes('.reader-page-sheet--paged,'), 'reader CSS should define dedicated paged sheet classes')
assert.ok(cssSource.includes('.reader-page-sheet--double {'), 'reader CSS should define dedicated double-page sheet classes')
assert.ok(cssSource.includes('justify-self: center;'), 'reader CSS should center paged sheets within their slots')
assert.ok(cssSource.includes('background: transparent;'), 'reader CSS should avoid rendering dead space as a dark card around paged pages')
assert.ok(/\.reader-spread\s*\{[^}]*width: 100%;[^}]*height: 100%;/s.test(cssSource), 'reader spread should own the available viewport height for contained page sizing')
assert.ok(cssSource.includes('height: calc(100dvh - var(--gui2-topbar-h) - 24px);'), 'reader shell should lock to the available viewport height')
assert.ok(!cssSource.includes('body.reader-active.reader-shell-visible .gui2-content'), 'reader CSS should not restore the app shell while reading')
assert.ok(cssSource.includes('body.reader-active .gui2-content'), 'reader CSS should reclaim the full content viewport while reading')
assert.ok(cssSource.includes('.reader-shell-v2.settings-open .reader-topbar-v2'), 'reader CSS should reserve space for the settings rail when it is open')
assert.ok(!cssSource.includes('.reader-bottom-bar {'), 'reader CSS should not keep the deprecated bottom toolbar layout rules')
assert.ok(cssSource.includes('position: fixed;'), 'reader settings panel should use fixed positioning in gui2.css')
assert.ok(cssSource.includes('body.reader-active .gui2-main'), 'reader shell state should reclaim the sidebar lane')
assert.ok(cssSource.includes('body.reader-active .gui2-content'), 'reader shell state should reclaim the content padding offsets')
assert.ok(cssSource.includes('.reader-shell-v2.reader-ui-hidden .reader-scroll-canvas--strip'), 'strip scroll mode should keep dead top and bottom padding removed when chrome auto-hides')
assert.ok(!cssSource.includes('.reader-page-sheet--scroll'), 'reader CSS should not keep a separate scroll page-sheet card path')
assert.ok(!cssSource.includes('.reader-scroll-page-wrap--strip + .reader-scroll-page-wrap--strip'), 'strip scroll mode should not rely on overlapping wrapper hacks that cut page content')
assert.ok(!cssSource.includes('transform: scale(var(--reader-zoom-scale, 1));'), 'reader CSS should not rely on transform zoom that fights fit sizing')
assert.ok(!cssSource.includes('.reader-page-sheet.reader-stage--paged'), 'reader CSS should not couple paged sheet sizing to the stage class names')
assert.ok(!cssSource.includes('--reader-canvas-page-width'), 'reader CSS should not drive crop-prone paged sizing through media width variables')

console.log('manga reader layout tests passed')
