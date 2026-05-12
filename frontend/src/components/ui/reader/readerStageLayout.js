const DEFAULT_ZOOM = 100

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getZoomProgress(zoomPercent = DEFAULT_ZOOM) {
  const safeZoom = clamp(Number(zoomPercent) || DEFAULT_ZOOM, 60, 180)
  return (safeZoom - 60) / 120
}

function getFitScale(pageFit = 'width', zoomPercent = DEFAULT_ZOOM) {
  const zoomProgress = getZoomProgress(zoomPercent)
  if (pageFit === 'height') return 0.99 + (0.18 * zoomProgress)
  if (pageFit === 'original') return 0.91 + (0.24 * zoomProgress)
  if (pageFit === 'cover') return 1.02 + (0.18 * zoomProgress)
  return 1.0 + (0.17 * zoomProgress)
}

export function getReaderStageViewport({
  viewportWidth = 0,
  viewportHeight = 0,
  headerHeight = 0,
  edgePadding = 24,
} = {}) {
  return {
    width: Math.max(0, Math.round((Number(viewportWidth) || 0) - (edgePadding * 2))),
    height: Math.max(0, Math.round((Number(viewportHeight) || 0) - (Number(headerHeight) || 0) - (edgePadding * 2))),
  }
}

export function getReaderStagePageLayout({
  pageFit = 'width',
  zoomPercent = DEFAULT_ZOOM,
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

  const fitScale = getFitScale(pageFit, zoomPercent)
  let maxWidth = safeSlotWidth * fitScale
  let maxHeight = safeSlotHeight * fitScale

  if (pageFit === 'original') {
    maxWidth = Math.min(maxWidth, safeNaturalWidth)
    maxHeight = Math.min(maxHeight, safeNaturalHeight)
  }

  const aspectRatio = safeNaturalWidth / safeNaturalHeight
  const widthLimitedHeight = maxWidth / aspectRatio
  const heightLimitedWidth = maxHeight * aspectRatio

  if (pageFit === 'cover') {
    if (widthLimitedHeight >= maxHeight) {
      return {
        width: Math.max(1, Math.round(maxWidth)),
        height: Math.max(1, Math.round(widthLimitedHeight)),
      }
    }
    return {
      width: Math.max(1, Math.round(heightLimitedWidth)),
      height: Math.max(1, Math.round(maxHeight)),
    }
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

export function getReaderStageSpreadLayout({
  pageFit = 'width',
  zoomPercent = DEFAULT_ZOOM,
  stageWidth = 0,
  stageHeight = 0,
  naturalLeftWidth = 0,
  naturalLeftHeight = 0,
  naturalRightWidth = 0,
  naturalRightHeight = 0,
  pageGap = 18,
} = {}) {
  const safeGap = Math.max(0, Number(pageGap) || 0)
  const halfSlotWidth = Math.max(0, ((Number(stageWidth) || 0) - safeGap) / 2)
  const safeStageHeight = Math.max(0, Number(stageHeight) || 0)

  const leftLayout = getReaderStagePageLayout({
    pageFit,
    zoomPercent,
    slotWidth: halfSlotWidth,
    slotHeight: safeStageHeight,
    naturalWidth: naturalLeftWidth,
    naturalHeight: naturalLeftHeight,
  })
  const rightLayout = getReaderStagePageLayout({
    pageFit,
    zoomPercent,
    slotWidth: halfSlotWidth,
    slotHeight: safeStageHeight,
    naturalWidth: naturalRightWidth || naturalLeftWidth,
    naturalHeight: naturalRightHeight || naturalLeftHeight,
  })

  if (!leftLayout || !rightLayout) return null

  const pageWidth = Math.max(leftLayout.width, rightLayout.width)
  const pageHeight = Math.max(leftLayout.height, rightLayout.height)

  return {
    width: pageWidth * 2 + safeGap,
    height: pageHeight,
    pageWidth,
    pageHeight,
    gap: safeGap,
  }
}
