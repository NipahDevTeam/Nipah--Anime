import assert from 'node:assert/strict'
import {
  getReaderStageViewport,
  getReaderStagePageLayout,
  getReaderStageSpreadLayout,
} from './readerStageLayout.js'

assert.deepEqual(
  getReaderStageViewport({
    viewportWidth: 1680,
    viewportHeight: 1050,
    headerHeight: 84,
    edgePadding: 24,
  }),
  {
    width: 1632,
    height: 918,
  },
)

assert.deepEqual(
  getReaderStagePageLayout({
    pageFit: 'width',
    zoomPercent: 100,
    slotWidth: 1400,
    slotHeight: 920,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  {
    width: 648,
    height: 972,
  },
)

assert.deepEqual(
  getReaderStagePageLayout({
    pageFit: 'height',
    zoomPercent: 100,
    slotWidth: 1400,
    slotHeight: 920,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  {
    width: 644,
    height: 966,
  },
)

assert.deepEqual(
  getReaderStagePageLayout({
    pageFit: 'original',
    zoomPercent: 100,
    slotWidth: 1400,
    slotHeight: 920,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  {
    width: 607,
    height: 911,
  },
)

assert.deepEqual(
  getReaderStagePageLayout({
    pageFit: 'cover',
    zoomPercent: 100,
    slotWidth: 1400,
    slotHeight: 920,
    naturalWidth: 1600,
    naturalHeight: 2400,
  }),
  {
    width: 1512,
    height: 2268,
  },
)

assert.deepEqual(
  getReaderStageSpreadLayout({
    pageFit: 'height',
    zoomPercent: 100,
    stageWidth: 1600,
    stageHeight: 920,
    naturalLeftWidth: 1600,
    naturalLeftHeight: 2400,
    naturalRightWidth: 1600,
    naturalRightHeight: 2400,
    pageGap: 18,
  }),
  {
    width: 1306,
    height: 966,
    pageWidth: 644,
    pageHeight: 966,
    gap: 18,
  },
)

console.log('reader stage layout tests passed')
