function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function filterAndSortMangaEntries(entries = [], options = {}) {
  const {
    query = '',
    status = 'ALL',
    sort = 'UPDATED_DESC',
    year = 'ALL',
  } = options

  const normalizedQuery = String(query || '').trim().toLowerCase()

  const filtered = entries.filter((entry) => {
    if (status !== 'ALL' && entry.status !== status) return false
    if (year !== 'ALL' && Number(entry.year || 0) !== Number(year)) return false
    if (!normalizedQuery) return true

    const haystack = [
      entry.title,
      entry.title_english,
      entry.media_format,
      entry.status,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })

  return [...filtered].sort((a, b) => {
    switch (sort) {
      case 'TITLE_ASC':
        return (a.title_english || a.title || '').localeCompare(b.title_english || b.title || '')
      case 'TITLE_DESC':
        return (b.title_english || b.title || '').localeCompare(a.title_english || a.title || '')
      case 'SCORE_DESC':
        return (Number(b.score) || 0) - (Number(a.score) || 0)
      case 'YEAR_DESC':
        return (Number(b.year) || 0) - (Number(a.year) || 0)
      case 'PROGRESS_DESC':
        return (Number(b.chapters_read) || 0) - (Number(a.chapters_read) || 0)
      case 'ADDED_DESC':
        return toTimestamp(b.added_at) - toTimestamp(a.added_at)
      case 'UPDATED_DESC':
      default:
        return toTimestamp(b.updated_at) - toTimestamp(a.updated_at)
    }
  })
}

export function buildMyListsOverviewCards({
  activeMediaType = 'anime',
  animeEntries = [],
  mangaEntries = [],
  filteredMangaEntries = [],
  isEnglish = false,
}) {
  const animeWatching = animeEntries.filter((entry) => entry.status === 'WATCHING').length
  const animeCompleted = animeEntries.filter((entry) => entry.status === 'COMPLETED').length
  const mangaReading = mangaEntries.filter((entry) => entry.status === 'WATCHING').length
  const mangaCompleted = mangaEntries.filter((entry) => entry.status === 'COMPLETED').length
  const mangaChaptersRead = mangaEntries.reduce((sum, entry) => sum + (Number(entry.chapters_read) || 0), 0)
  const animeEpisodesWatched = animeEntries.reduce((sum, entry) => sum + (Number(entry.episodes_watched) || 0), 0)

  if (activeMediaType === 'manga') {
    return [
      {
        label: isEnglish ? 'Visible now' : 'Visibles ahora',
        value: String(filteredMangaEntries.length),
        detail: isEnglish ? 'Titles matching your current filters' : 'Titulos segun tus filtros actuales',
      },
      {
        label: isEnglish ? 'Reading' : 'Leyendo',
        value: String(mangaReading),
        detail: isEnglish ? 'Active manga in progress' : 'Series activas en progreso',
      },
      {
        label: isEnglish ? 'Completed' : 'Completados',
        value: String(mangaCompleted),
        detail: isEnglish ? 'Finished series in your shelf' : 'Series ya terminadas en tu biblioteca',
      },
      {
        label: isEnglish ? 'Chapters read' : 'Capitulos leidos',
        value: String(mangaChaptersRead),
        detail: isEnglish ? 'Tracked reading progress across your list' : 'Progreso de lectura acumulado en tu lista',
      },
    ]
  }

  return [
    {
      label: isEnglish ? 'Watching' : 'Viendo',
      value: String(animeWatching),
      detail: isEnglish ? 'Tracked anime you are actively watching' : 'Anime en seguimiento activo',
    },
    {
      label: isEnglish ? 'Completed' : 'Completados',
      value: String(animeCompleted),
      detail: isEnglish ? 'Series already finished' : 'Series ya terminadas',
    },
    {
      label: isEnglish ? 'Episodes watched' : 'Episodios vistos',
      value: String(animeEpisodesWatched),
      detail: isEnglish ? 'Progress synced into your list' : 'Progreso sincronizado en tu lista',
    },
    {
      label: isEnglish ? 'Library size' : 'Tamano de lista',
      value: String(animeEntries.length),
      detail: isEnglish ? 'All anime currently tracked locally' : 'Todo el anime seguido localmente',
    },
  ]
}
