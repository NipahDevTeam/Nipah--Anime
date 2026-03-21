export const DEFAULT_MANGA_SOURCE = 'senshimanga-es'

export const MANGA_SOURCE_OPTIONS = [
  {
    value: 'senshimanga-es',
    label: 'SenshiManga',
    badge: 'badge-accent',
    note: 'Espanol - Principal',
    languages: ['es'],
  },
  {
    value: 'mangaoni-es',
    label: 'MangaOni',
    badge: 'badge-muted',
    note: 'Espanol - Fallback',
    languages: ['es'],
  },
  {
    value: 'templetoons-en',
    label: 'TempleToons',
    badge: 'badge-muted',
    note: 'English - Beta',
    languages: ['en'],
  },
  {
    value: 'weebcentral-en',
    label: 'WeebCentral',
    badge: 'badge-muted',
    note: 'English - Fallback',
    languages: ['en'],
  },
  {
    value: 'mangapill-en',
    label: 'MangaPill',
    badge: 'badge-muted',
    note: 'English - Fallback',
    languages: ['en'],
  },
  {
    value: 'mangafire-en',
    label: 'MangaFire',
    badge: 'badge-muted',
    note: 'English - Beta',
    languages: ['en'],
  },
]

const MANGA_SOURCE_ALIASES = {
  mangadex: 'mangadex-es',
  'mangadex-es': 'mangadex-es',
  lectormanga: 'lectormanga-es',
  'lectormanga-es': 'lectormanga-es',
  mangaoni: 'mangaoni-es',
  'mangaoni-es': 'mangaoni-es',
  senshimanga: 'senshimanga-es',
  'senshimanga-es': 'senshimanga-es',
  templetoons: 'templetoons-en',
  'templetoons-en': 'templetoons-en',
  weebcentral: 'weebcentral-en',
  'weebcentral-en': 'weebcentral-en',
  mangapill: 'mangapill-en',
  'mangapill-en': 'mangapill-en',
  mangafire: 'mangafire-en',
  'mangafire-en': 'mangafire-en',
}

export const MANGA_SOURCE_IDS = new Set(Object.keys(MANGA_SOURCE_ALIASES))

const LEGACY_MANGA_SOURCE_META = [
  {
    value: 'mangadex-es',
    label: 'MangaDex',
    badge: 'badge-muted',
    note: 'Deprecated',
    languages: ['es', 'en'],
  },
]

const MANGA_SOURCE_META = new Map(
  [...MANGA_SOURCE_OPTIONS, ...LEGACY_MANGA_SOURCE_META].map((item) => [item.value, item]),
)

export function normalizeMangaSourceID(sourceID) {
  return MANGA_SOURCE_ALIASES[sourceID] || sourceID || DEFAULT_MANGA_SOURCE
}

export function getMangaSourceMeta(sourceID) {
  const normalized = normalizeMangaSourceID(sourceID)
  return MANGA_SOURCE_META.get(normalized) ?? MANGA_SOURCE_OPTIONS[0]
}

export function buildMangaSourceOptions(extensions = []) {
  const filtered = (extensions ?? [])
    .filter((item) => item?.type === 'manga')
    .map((item) => {
      const normalized = normalizeMangaSourceID(item.id)
      const meta = getMangaSourceMeta(normalized)
      return {
        value: normalized,
        label: item.name || meta.label,
        badge: meta.badge,
        note: meta.note,
        languages: item.languages?.length ? item.languages : meta.languages,
      }
    })
    .filter((item) => item.value !== 'mangadex-es')

  const deduped = filtered.filter((item, index, arr) => (
    arr.findIndex((candidate) => candidate.value === item.value) === index
  ))

  return deduped.length > 0 ? deduped : MANGA_SOURCE_OPTIONS
}

