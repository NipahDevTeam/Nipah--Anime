import assert from 'node:assert/strict'

import {
  detectContentBox,
  getContentBoxRect,
  getCroppedMediaLayout,
  normalizeReaderContentBox,
} from './readerContentBox.js'

assert.deepEqual(
  detectContentBox({
    width: 4,
    height: 4,
    alphaData: [
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ],
  }),
  { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 },
)

assert.deepEqual(
  detectContentBox({
    width: 4,
    height: 4,
    alphaData: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 32, 32, 32, 255, 32, 32, 32, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 32, 32, 32, 255, 32, 32, 32, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
  }),
  { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 },
)

assert.deepEqual(
  getContentBoxRect({
    naturalWidth: 1600,
    naturalHeight: 2400,
    contentBox: { top: 0.1, right: 0.1, bottom: 0.15, left: 0.05 },
  }),
  { left: 80, top: 240, width: 1360, height: 1800 },
)

assert.deepEqual(
  getCroppedMediaLayout({
    naturalWidth: 1600,
    naturalHeight: 2400,
    contentBox: { top: 0.1, right: 0.1, bottom: 0.15, left: 0.05 },
    frameWidth: 680,
    frameHeight: 900,
  }),
  { width: 800, height: 1200, left: -40, top: -120 },
)

assert.deepEqual(
  normalizeReaderContentBox({ top: 0.01, right: 0.26, bottom: 0.01, left: 0.01 }),
  { top: 0.01, right: 0, bottom: 0.01, left: 0 },
)

assert.deepEqual(
  normalizeReaderContentBox({ top: 0.03, right: 0.03, bottom: 0.04, left: 0.02 }),
  { top: 0.03, right: 0.03, bottom: 0.04, left: 0.02 },
)

console.log('reader content box tests passed')
