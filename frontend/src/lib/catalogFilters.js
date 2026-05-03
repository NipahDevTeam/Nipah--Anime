export function buildAnimeCatalogFetchArgs({
  sort = 'TRENDING_DESC',
  page = 1,
  genres = [],
  season = '',
  year = 0,
  format = '',
  status = '',
} = {}) {
  return {
    sort,
    page,
    genres: Array.isArray(genres) ? genres.join(',') : String(genres || ''),
    season,
    year: Number(year) || 0,
    format,
    status,
  }
}

export function buildMangaCatalogFetchArgs({
  sort = 'TRENDING_DESC',
  page = 1,
  genres = [],
  year = 0,
  format = '',
  status = '',
} = {}) {
  return {
    sort,
    page,
    genres: Array.isArray(genres) ? genres.join(',') : String(genres || ''),
    year: Number(year) || 0,
    format,
    status,
  }
}
