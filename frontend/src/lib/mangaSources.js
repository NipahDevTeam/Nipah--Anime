export const DEFAULT_MANGA_SOURCE = 'm440-es'
export const DEFAULT_MANGA_SOURCE_BY_LANG = {
  es: 'm440-es',
  en: 'weebcentral-en',
}

export const MANGA_SOURCE_OPTIONS = [
  {
    value: 'm440-es',
    label: 'M440',
    badge: 'badge-accent',
    note: 'Espanol - Principal',
    languages: ['es'],
  },
  {
    value: 'senshimanga-es',
    label: 'SenshiManga',
    badge: 'badge-muted',
    note: 'Espanol - Secundaria',
    languages: ['es'],
  },
  {
    value: 'mangaoni-es',
    label: 'MangaOni',
    badge: 'badge-muted',
    note: 'Espanol - Beta',
    languages: ['es'],
  },
  {
    value: 'weebcentral-en',
    label: 'WeebCentral',
    badge: 'badge-accent',
    note: 'English - Primary',
    languages: ['en'],
  },
  {
    value: 'templetoons-en',
    label: 'TempleToons',
    badge: 'badge-muted',
    note: 'English - Beta',
    languages: ['en'],
  },
  {
    value: 'mangapill-en',
    label: 'MangaPill',
    badge: 'badge-muted',
    note: 'English - Beta',
    languages: ['en'],
  },
  {
    value: 'mangafire-en',
    label: 'MangaFire (EN)',
    badge: 'badge-muted',
    note: 'English - Beta',
    languages: ['en'],
  },
  {
    value: 'mangafire-es',
    label: 'MangaFire (ES)',
    badge: 'badge-muted',
    note: 'Espanol - Beta',
    languages: ['es'],
  },
]

const MANGA_SOURCE_ALIASES = {
  mangadex: 'mangadex-es',
  'mangadex-es': 'mangadex-es',
  lectormanga: 'lectormanga-es',
  'lectormanga-es': 'lectormanga-es',
  mangaoni: 'mangaoni-es',
  'mangaoni-es': 'mangaoni-es',
  m440: 'm440-es',
  'm440-es': 'm440-es',
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
  'mangafire-es': 'mangafire-es',
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

export function getDefaultMangaSource(lang = 'es') {
  return DEFAULT_MANGA_SOURCE_BY_LANG[lang] || DEFAULT_MANGA_SOURCE
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

