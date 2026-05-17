function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function pixelOffset(x, y, width) {
  return ((y * width) + x) * 4
}

function isContentPixel(alphaData, offset, whiteThreshold, alphaThreshold) {
  const alpha = alphaData[offset + 3] ?? 0
  if (alpha <= alphaThreshold) return false

  const red = alphaData[offset] ?? 0
  const green = alphaData[offset + 1] ?? 0
  const blue = alphaData[offset + 2] ?? 0
  return red < whiteThreshold || green < whiteThreshold || blue < whiteThreshold
}

function rowHasContent({ width, y, alphaData, whiteThreshold, alphaThreshold, minContentPixels }) {
  let contentPixels = 0
  for (let x = 0; x < width; x += 1) {
    if (isContentPixel(alphaData, pixelOffset(x, y, width), whiteThreshold, alphaThreshold)) {
      contentPixels += 1
      if (contentPixels >= minContentPixels) return true
    }
  }
  return false
}

function columnHasContent({ height, x, width, alphaData, whiteThreshold, alphaThreshold, minContentPixels }) {
  let contentPixels = 0
  for (let y = 0; y < height; y += 1) {
    if (isContentPixel(alphaData, pixelOffset(x, y, width), whiteThreshold, alphaThreshold)) {
      contentPixels += 1
      if (contentPixels >= minContentPixels) return true
    }
  }
  return false
}

export function detectContentBox({
  width = 0,
  height = 0,
  alphaData = [],
  whiteThreshold = 245,
  alphaThreshold = 8,
} = {}) {
  const safeWidth = Math.max(0, Number(width) || 0)
  const safeHeight = Math.max(0, Number(height) || 0)
  if (!safeWidth || !safeHeight || !alphaData?.length) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }

  const minRowContentPixels = Math.max(1, Math.floor(safeWidth * 0.004))
  const minColumnContentPixels = Math.max(1, Math.floor(safeHeight * 0.004))

  let top = 0
  while (top < safeHeight && !rowHasContent({
    width: safeWidth,
    y: top,
    alphaData,
    whiteThreshold,
    alphaThreshold,
    minContentPixels: minRowContentPixels,
  })) {
    top += 1
  }

  let bottom = safeHeight - 1
  while (bottom >= top && !rowHasContent({
    width: safeWidth,
    y: bottom,
    alphaData,
    whiteThreshold,
    alphaThreshold,
    minContentPixels: minRowContentPixels,
  })) {
    bottom -= 1
  }

  let left = 0
  while (left < safeWidth && !columnHasContent({
    width: safeWidth,
    height: safeHeight,
    x: left,
    alphaData,
    whiteThreshold,
    alphaThreshold,
    minContentPixels: minColumnContentPixels,
  })) {
    left += 1
  }

  let right = safeWidth - 1
  while (right >= left && !columnHasContent({
    width: safeWidth,
    height: safeHeight,
    x: right,
    alphaData,
    whiteThreshold,
    alphaThreshold,
    minContentPixels: minColumnContentPixels,
  })) {
    right -= 1
  }

  if (top >= safeHeight || left >= safeWidth || bottom < top || right < left) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }

  return {
    top: clamp(top / safeHeight, 0, 1),
    right: clamp((safeWidth - right - 1) / safeWidth, 0, 1),
    bottom: clamp((safeHeight - bottom - 1) / safeHeight, 0, 1),
    left: clamp(left / safeWidth, 0, 1),
  }
}

export function normalizeReaderContentBox(contentBox = null, {
  minAxisTrim = 0.01,
  maxEdgeTrim = 0.08,
  maxAxisTrim = 0.14,
  maxAxisAsymmetry = 0.04,
} = {}) {
  const rawTop = clamp(Number(contentBox?.top) || 0, 0, 1)
  const rawRight = clamp(Number(contentBox?.right) || 0, 0, 1)
  const rawBottom = clamp(Number(contentBox?.bottom) || 0, 0, 1)
  const rawLeft = clamp(Number(contentBox?.left) || 0, 0, 1)

  let top = rawTop
  let right = rawRight
  let bottom = rawBottom
  let left = rawLeft

  const horizontalTrim = left + right
  const verticalTrim = top + bottom

  if (
    horizontalTrim < minAxisTrim
    || horizontalTrim > maxAxisTrim
    || Math.max(left, right) > maxEdgeTrim
    || Math.abs(left - right) > maxAxisAsymmetry
  ) {
    left = 0
    right = 0
  }

  if (
    verticalTrim < minAxisTrim
    || verticalTrim > maxAxisTrim
    || Math.max(top, bottom) > maxEdgeTrim
    || Math.abs(top - bottom) > maxAxisAsymmetry
  ) {
    top = 0
    bottom = 0
  }

  if (!top && !right && !bottom && !left) return null
  return { top, right, bottom, left }
}

export function getContentBoxRect({
  naturalWidth = 0,
  naturalHeight = 0,
  contentBox = null,
} = {}) {
  const safeNaturalWidth = Math.max(0, Number(naturalWidth) || 0)
  const safeNaturalHeight = Math.max(0, Number(naturalHeight) || 0)
  if (!safeNaturalWidth || !safeNaturalHeight) return null

  const topRatio = clamp(Number(contentBox?.top) || 0, 0, 1)
  const rightRatio = clamp(Number(contentBox?.right) || 0, 0, 1)
  const bottomRatio = clamp(Number(contentBox?.bottom) || 0, 0, 1)
  const leftRatio = clamp(Number(contentBox?.left) || 0, 0, 1)

  const left = Math.round(safeNaturalWidth * leftRatio)
  const top = Math.round(safeNaturalHeight * topRatio)
  const rightInset = Math.round(safeNaturalWidth * rightRatio)
  const bottomInset = Math.round(safeNaturalHeight * bottomRatio)

  return {
    left,
    top,
    width: Math.max(1, safeNaturalWidth - left - rightInset),
    height: Math.max(1, safeNaturalHeight - top - bottomInset),
  }
}

export function getCroppedMediaLayout({
  naturalWidth = 0,
  naturalHeight = 0,
  contentBox = null,
  frameWidth = 0,
  frameHeight = 0,
} = {}) {
  const rect = getContentBoxRect({ naturalWidth, naturalHeight, contentBox })
  const safeFrameWidth = Math.max(0, Number(frameWidth) || 0)
  const safeFrameHeight = Math.max(0, Number(frameHeight) || 0)
  if (!rect || !safeFrameWidth || !safeFrameHeight) return null

  const widthScale = safeFrameWidth / rect.width
  const heightScale = safeFrameHeight / rect.height
  const scale = Math.max(widthScale, heightScale)
  if (!Number.isFinite(scale) || scale <= 0) return null

  const croppedWidth = rect.width * scale
  const croppedHeight = rect.height * scale

  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
    left: Math.round(((safeFrameWidth - croppedWidth) / 2) - (rect.left * scale)),
    top: Math.round(((safeFrameHeight - croppedHeight) / 2) - (rect.top * scale)),
  }
}

export function measureReaderContentBox(image, {
  maxSampleSize = 256,
  whiteThreshold = 245,
  alphaThreshold = 8,
} = {}) {
  const naturalWidth = Number(image?.naturalWidth) || 0
  const naturalHeight = Number(image?.naturalHeight) || 0
  if (!image || !naturalWidth || !naturalHeight || typeof document === 'undefined') {
    return Promise.resolve(null)
  }

  const longestEdge = Math.max(naturalWidth, naturalHeight)
  const scale = longestEdge > maxSampleSize ? (maxSampleSize / longestEdge) : 1
  const sampleWidth = Math.max(1, Math.round(naturalWidth * scale))
  const sampleHeight = Math.max(1, Math.round(naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return Promise.resolve(null)

  try {
    context.clearRect(0, 0, sampleWidth, sampleHeight)
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight)
    const imageData = context.getImageData(0, 0, sampleWidth, sampleHeight)
    return Promise.resolve(detectContentBox({
      width: sampleWidth,
      height: sampleHeight,
      alphaData: imageData.data,
      whiteThreshold,
      alphaThreshold,
    }))
  } catch {
    return Promise.resolve(null)
  }
}
