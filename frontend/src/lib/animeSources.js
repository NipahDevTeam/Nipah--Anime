export const DEFAULT_ANIME_SOURCE = 'animeav1-es'
export const DEFAULT_ANIME_SOURCE_BY_LANG = {
  es: 'animeav1-es',
  en: 'animeheaven-en',
}

export const ANIME_SOURCE_OPTIONS = [
  { value: 'animeav1-es', label: 'AnimeAV1', color: '#9333ea', languages: ['es'] },
  { value: 'jkanime-es', label: 'JKAnime', color: '#c084fc', languages: ['es'] },
  { value: 'animeflv-es', label: 'AnimeFLV', color: '#b7791f', languages: ['es'] },
  { value: 'animepahe-en', label: 'AnimePahe', color: '#38bdf8', languages: ['en'] },
  { value: 'animeheaven-en', label: 'AnimeHeaven', color: '#0ea5e9', languages: ['en'] },
  { value: 'animegg-en', label: 'AnimeGG', color: '#6366f1', languages: ['en'] },
  { value: 'animekai-en', label: 'AnimeKai', color: '#22c55e', languages: ['en'] },
]

const ANIME_SOURCE_ALIASES = {
  animeav1: 'animeav1-es',
  'animeav1-es': 'animeav1-es',
  jkanime: 'jkanime-es',
  'jkanime-es': 'jkanime-es',
  animeflv: 'animeflv-es',
  'animeflv-es': 'animeflv-es',
  animepahe: 'animepahe-en',
  'animepahe-en': 'animepahe-en',
  animeheaven: 'animeheaven-en',
  'animeheaven-en': 'animeheaven-en',
  animegg: 'animegg-en',
  'animegg-en': 'animegg-en',
  animekai: 'animekai-en',
  'animekai-en': 'animekai-en',
}

const ANIME_SOURCE_META = new Map(
  ANIME_SOURCE_OPTIONS.map((item) => [item.value, item]),
)

export function normalizeAnimeSourceID(sourceID) {
  return ANIME_SOURCE_ALIASES[sourceID] || sourceID || DEFAULT_ANIME_SOURCE
}

export function getDefaultAnimeSource(lang = 'es') {
  return DEFAULT_ANIME_SOURCE_BY_LANG[lang] || DEFAULT_ANIME_SOURCE
}

export function getAnimeSourceMeta(sourceID) {
  const normalized = normalizeAnimeSourceID(sourceID)
  return ANIME_SOURCE_META.get(normalized) ?? ANIME_SOURCE_OPTIONS[0]
}
