export const GUI2_LOCAL_GRID_LIMIT = 10
export const GUI2_LOCAL_RECENT_WINDOW_DAYS = 7

function toDateValue(value) {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase()
}

function formatBytes(bytes) {
  const amount = Number(bytes || 0)
  if (!amount) return '--'
  if (amount < 1024) return `${amount} B`
  if (amount < 1024 * 1024) return `${(amount / 1024).toFixed(1)} KB`
  if (amount < 1024 * 1024 * 1024) return `${(amount / (1024 * 1024)).toFixed(1)} MB`
  return `${(amount / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRelativeTime(value, now, isEnglish) {
  const diff = Math.max(0, toDateValue(now) - toDateValue(value))
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) {
    const minutes = Math.max(1, Math.round(diff / minute))
    return isEnglish ? `${minutes}m ago` : `hace ${minutes} min`
  }

  if (diff < day) {
    const hours = Math.max(1, Math.round(diff / hour))
    return isEnglish ? `${hours}h ago` : `hace ${hours} h`
  }

  const days = Math.max(1, Math.round(diff / day))
  return isEnglish ? `${days}d ago` : `hace ${days} d`
}

function formatMediaStatus(status, isEnglish) {
  const mediaMap = isEnglish
    ? { FINISHED: 'Completed', RELEASING: 'Airing', NOT_YET_RELEASED: 'Upcoming', HIATUS: 'Hiatus', CANCELLED: 'Cancelled', ONGOING: 'Ongoing' }
    : { FINISHED: 'Completado', RELEASING: 'En emision', NOT_YET_RELEASED: 'Proximo', HIATUS: 'En pausa', CANCELLED: 'Cancelado', ONGOING: 'En curso' }

  const downloadMap = isEnglish
    ? { pending: 'Pending', downloading: 'Downloading', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled' }
    : { pending: 'Pendiente', downloading: 'Descargando', completed: 'Listo', failed: 'Fallido', cancelled: 'Cancelado' }

  return mediaMap[String(status || '').toUpperCase()] || downloadMap[String(status || '').toLowerCase()] || String(status || '-')
}

function formatMediaType(kind, isEnglish) {
  if (kind === 'anime') return isEnglish ? 'Anime' : 'Anime'
  if (kind === 'manga') return isEnglish ? 'Manga' : 'Manga'
  return isEnglish ? 'Download' : 'Descarga'
}

function buildMediaLine(kind, item, isEnglish) {
  const count = kind === 'anime' ? item.episodes_total : item.chapters_total
  const countLabel = kind === 'anime'
    ? `${count || 0} ${isEnglish ? 'episodes' : 'episodios'}`
    : `${count || 0} ${isEnglish ? 'chapters' : 'capitulos'}`

  return [item.year || null, countLabel, formatMediaStatus(item.status, isEnglish)].filter(Boolean).join(' · ')
}

function normalizeLibraryItem(kind, item, isEnglish) {
  return {
    id: item.id,
    kind,
    selectionKey: `${kind}-${item.id}`,
    anilistID: item.anilist_id || 0,
    title: item.display_title || item.title_english || item.title_romaji || (isEnglish ? 'Untitled' : 'Sin titulo'),
    subtitle: item.title_romaji && item.title_romaji !== item.display_title ? item.title_romaji : (item.title_english || ''),
    cover: item.cover_image || '',
    banner: item.banner_image || '',
    status: item.status || '',
    year: item.year || 0,
    count: kind === 'anime' ? Number(item.episodes_total || 0) : Number(item.chapters_total || 0),
    countLabel: kind === 'anime'
      ? `${item.episodes_total || 0} ${isEnglish ? 'episodes' : 'episodios'}`
      : `${item.chapters_total || 0} ${isEnglish ? 'chapters' : 'capitulos'}`,
    typeLabel: formatMediaType(kind, isEnglish),
    metaLine: buildMediaLine(kind, item, isEnglish),
    statusLabel: formatMediaStatus(item.status, isEnglish),
    addedAt: item.added_at || item.updated_at || '',
    updatedAt: item.updated_at || item.added_at || '',
    searchHaystack: [
      item.display_title,
      item.title_english,
      item.title_romaji,
      item.status,
      item.year,
    ].filter(Boolean).join(' ').toLowerCase(),
  }
}

function normalizeDownloadItem(item, isEnglish) {
  return {
    id: item.id,
    kind: 'download',
    selectionKey: `download-${item.id}`,
    title: item.anime_title || (isEnglish ? 'Download' : 'Descarga'),
    subtitle: `${isEnglish ? 'Episode' : 'Episodio'} ${item.episode_num || '?'}`,
    cover: item.cover_url || '',
    banner: '',
    status: item.status || '',
    year: 0,
    count: Number(item.progress || 0),
    countLabel: `${Math.round(item.progress || 0)}%`,
    typeLabel: isEnglish ? 'Transfer' : 'Transferencia',
    metaLine: [formatMediaStatus(item.status, isEnglish), formatBytes(item.file_size)].filter(Boolean).join(' · '),
    statusLabel: formatMediaStatus(item.status, isEnglish),
    addedAt: item.created_at || item.updated_at || '',
    updatedAt: item.updated_at || item.created_at || '',
    searchHaystack: [
      item.anime_title,
      item.episode_title,
      item.status,
      item.episode_num,
    ].filter(Boolean).join(' ').toLowerCase(),
    progress: Number(item.progress || 0),
    fileSize: Number(item.file_size || 0),
  }
}

export function buildGui2LocalOverview({
  animeItems = [],
  mangaItems = [],
  downloadItems = [],
  libraryPaths = [],
  now = new Date(),
  isEnglish = false,
}) {
  const recentWindowStart = toDateValue(now) - GUI2_LOCAL_RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const recentlyAdded = [...animeItems, ...mangaItems].filter((item) => toDateValue(item.added_at) >= recentWindowStart).length
  const storageBytes = downloadItems.reduce((total, item) => total + Number(item.file_size || 0), 0)

  return {
    totalAnime: {
      key: 'anime',
      label: isEnglish ? 'Total Anime' : 'Anime total',
      value: animeItems.length,
    },
    totalManga: {
      key: 'manga',
      label: isEnglish ? 'Total Manga' : 'Manga total',
      value: mangaItems.length,
    },
    recentlyAdded: {
      key: 'recent',
      label: isEnglish ? 'Recently Added' : 'Recientes',
      value: recentlyAdded,
      meta: isEnglish ? `${GUI2_LOCAL_RECENT_WINDOW_DAYS} days` : `${GUI2_LOCAL_RECENT_WINDOW_DAYS} dias`,
    },
    storageUsed: {
      key: 'storage',
      label: isEnglish ? 'Storage Used' : 'Almacenamiento',
      value: formatBytes(storageBytes),
    },
    sources: {
      key: 'sources',
      label: isEnglish ? 'Sources' : 'Fuentes',
      value: libraryPaths.length,
    },
  }
}

export function buildGui2LocalCatalog({
  animeItems = [],
  mangaItems = [],
  downloadItems = [],
  activeTab = 'all',
  sort = 'RECENT',
  query = '',
  isEnglish = false,
}) {
  let items = []
  if (activeTab === 'anime') {
    items = animeItems.map((item) => normalizeLibraryItem('anime', item, isEnglish))
  } else if (activeTab === 'manga') {
    items = mangaItems.map((item) => normalizeLibraryItem('manga', item, isEnglish))
  } else if (activeTab === 'downloads') {
    items = downloadItems.map((item) => normalizeDownloadItem(item, isEnglish))
  } else {
    items = [
      ...animeItems.map((item) => normalizeLibraryItem('anime', item, isEnglish)),
      ...mangaItems.map((item) => normalizeLibraryItem('manga', item, isEnglish)),
    ]
  }

  const term = normalizeQuery(query)
  const filtered = term
    ? items.filter((item) => item.searchHaystack.includes(term))
    : items

  return filtered.toSorted((a, b) => {
    if (sort === 'TITLE') {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    }

    if (sort === 'YEAR') {
      return Number(b.year || 0) - Number(a.year || 0) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    }

    if (sort === 'COUNT') {
      return Number(b.count || 0) - Number(a.count || 0) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    }

    return toDateValue(b.updatedAt || b.addedAt) - toDateValue(a.updatedAt || a.addedAt)
      || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  })
}

export function buildGui2LocalActivity({
  animeItems = [],
  mangaItems = [],
  downloadItems = [],
  scanResult = null,
  now = new Date(),
  isEnglish = false,
}) {
  const events = []

  if (scanResult && !scanResult.cancelled) {
    events.push({
      kind: 'scan',
      title: isEnglish ? 'Scan completed' : 'Escaneo completado',
      copy: isEnglish
        ? `${scanResult.files_scanned || 0} files checked · ${scanResult.anime_found || 0} anime · ${scanResult.manga_found || 0} manga`
        : `${scanResult.files_scanned || 0} archivos · ${scanResult.anime_found || 0} anime · ${scanResult.manga_found || 0} manga`,
      meta: scanResult.scanned_path || '',
      when: now,
    })
  }

  for (const item of animeItems) {
    events.push({
      kind: 'anime',
      selectionKey: `anime-${item.id}`,
      title: item.display_title || item.title_english || item.title_romaji || (isEnglish ? 'Anime added' : 'Anime agregado'),
      copy: isEnglish ? 'Added to local anime' : 'Agregado al anime local',
      meta: formatRelativeTime(item.added_at || item.updated_at, now, isEnglish),
      when: item.added_at || item.updated_at,
    })
  }

  for (const item of mangaItems) {
    events.push({
      kind: 'manga',
      selectionKey: `manga-${item.id}`,
      title: item.display_title || item.title_english || item.title_romaji || (isEnglish ? 'Manga added' : 'Manga agregado'),
      copy: isEnglish ? 'Added to local manga' : 'Agregado al manga local',
      meta: formatRelativeTime(item.added_at || item.updated_at, now, isEnglish),
      when: item.added_at || item.updated_at,
    })
  }

  for (const item of downloadItems) {
    if (String(item.status || '').toLowerCase() !== 'completed') continue
    events.push({
      kind: 'download',
      selectionKey: `download-${item.id}`,
      title: item.anime_title || (isEnglish ? 'Download ready' : 'Descarga lista'),
      copy: isEnglish ? `Episode ${item.episode_num || '?'} is ready to open` : `Episodio ${item.episode_num || '?'} listo para abrir`,
      meta: formatRelativeTime(item.updated_at || item.created_at, now, isEnglish),
      when: item.updated_at || item.created_at,
    })
  }

  return events
    .toSorted((a, b) => toDateValue(b.when) - toDateValue(a.when))
    .slice(0, 8)
}

export function formatGui2LocalStorage(bytes) {
  return formatBytes(bytes)
}
