function normalizeItems(items) {
  return Array.isArray(items) ? items : []
}

function normalizePositiveInteger(value, fallback) {
  const numericValue =
    typeof value === 'string'
      ? Number(value.trim())
      : value

  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  const normalizedValue = Math.floor(numericValue)
  return normalizedValue > 0 ? normalizedValue : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function buildPageChips(totalPages, currentPage) {
  if (totalPages <= 3) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const startPage = clamp(currentPage - 1, 1, totalPages - 2)
  return [startPage, startPage + 1, startPage + 2]
}

export function buildLandingQueueWindow({
  items,
  page = 1,
  pageSize = 12,
} = {}) {
  const normalizedItems = normalizeItems(items)
  const normalizedPageSize = normalizePositiveInteger(pageSize, 12)
  const totalPages = Math.max(1, Math.ceil(normalizedItems.length / normalizedPageSize))
  const normalizedPage = clamp(normalizePositiveInteger(page, 1), 1, totalPages)
  const startIndex = (normalizedPage - 1) * normalizedPageSize

  return {
    items: normalizedItems.slice(startIndex, startIndex + normalizedPageSize),
    currentPage: normalizedPage,
    totalPages,
    pageChips: buildPageChips(totalPages, normalizedPage),
    showPagination: totalPages > 1,
  }
}
