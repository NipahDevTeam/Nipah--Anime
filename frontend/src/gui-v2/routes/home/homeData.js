import { MANGA_SOURCE_IDS, normalizeMangaSourceID } from '../../../lib/mangaSources.js'

export const GUI2_HOME_HERO_ROTATE_MS = 7000
export const GUI2_HOME_HERO_FADE_MS = 320
export const GUI2_HOME_CONTINUE_LIMIT = 6
export const GUI2_HOME_POSTER_LIMIT = 10
export const GUI2_HOME_RECENT_LIMIT = 5

export const GUI2_HOME_DISCOVERY_ROWS = [
  {
    key: 'action',
    genre: 'Action',
    titleEn: 'Action Essentials',
    titleEs: 'Accion sin descanso',
    subtitleEn: 'Fast, loud, and impossible to ignore',
    subtitleEs: 'Rapidas, intensas e imposibles de ignorar',
  },
  {
    key: 'fantasy',
    genre: 'Fantasy',
    titleEn: 'Fantasy Worlds',
    titleEs: 'Mundos de fantasia',
    subtitleEn: 'Big worlds, stronger vibes',
    subtitleEs: 'Grandes mundos y mejores sensaciones',
  },
  {
    key: 'romance',
    genre: 'Romance',
    titleEn: 'Romance Picks',
    titleEs: 'Romance para maratonear',
    subtitleEn: 'Warm, dramatic, and a little messy',
    subtitleEs: 'Calidas, dramaticas y un poco caoticas',
  },
  {
    key: 'scifi',
    genre: 'Sci-Fi',
    titleEn: 'Sci-Fi Standouts',
    titleEs: 'Ciencia ficcion para perderse',
    subtitleEn: 'Future shock and strange worlds',
    subtitleEs: 'Futuros raros y mundos fuera de norma',
  },
  {
    key: 'drama',
    genre: 'Drama',
    titleEn: 'Drama Picks',
    titleEs: 'Dramas que atrapan',
    subtitleEn: 'For nights that need tension',
    subtitleEs: 'Para noches que piden tension',
  },
  {
    key: 'slice',
    genre: 'Slice of Life',
    titleEn: 'Slice of Life',
    titleEs: 'Slice of life',
    subtitleEn: 'Quieter stories that still hit hard',
    subtitleEs: 'Historias tranquilas que igual pegan fuerte',
  },
]

function pickString(...values) {
  const match = values.find((value) => typeof value === 'string' && value.trim())
  return match ? match.trim() : ''
}

function getTitle(item) {
  return pickString(
    item?.display_title,
    item?.anime_title,
    item?.canonical_title,
    item?.title_english,
    item?.title_romaji,
    item?.title?.english,
    item?.title?.romaji,
    item?.title?.native,
    typeof item?.title === 'string' ? item.title : '',
  ) || 'Anime'
}

function getPosterImage(item) {
  return item?.cover_image || item?.cover_url || item?.banner_url || item?.image || item?.coverImage?.extraLarge || item?.coverImage?.large || item?.bannerImage || ''
}

function getBannerImage(item) {
  return item?.bannerImage || item?.banner_image || item?.coverImage?.extraLarge || item?.coverImage?.large || item?.cover_image || item?.cover_url || ''
}

function getYear(item) {
  return item?.year || item?.seasonYear || ''
}

function getFormat(item) {
  return item?.format || item?.media_format || item?.source_name || ''
}

function getEpisodes(item) {
  return item?.episodes || item?.episodes_total || item?.episode_count || 0
}

function getGenres(item) {
  if (Array.isArray(item?.genres)) return item.genres
  return []
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildHeroMeta(item) {
  const bits = []
  if (getYear(item)) bits.push(String(getYear(item)))
  if (getEpisodes(item)) bits.push(`${getEpisodes(item)} Episodes`)
  const genres = getGenres(item).slice(0, 2)
  if (genres.length) bits.push(...genres)
  return bits
}

function buildRecentSubtitle(item, isEnglish) {
  const nextEpisode = Number(item?.nextAiringEpisode?.episode || item?.episode_num || 0)
  return {
    episodeLabel: nextEpisode > 0
      ? `${isEnglish ? 'Episode' : 'Episodio'} ${nextEpisode}`
      : (isEnglish ? 'Currently airing' : 'En emision'),
    ageLabel: isEnglish ? 'Airing now' : 'En emision',
  }
}

function mapPosterItem(item) {
  return {
    id: item?.id || item?.anilist_id || item?.episode_id || getTitle(item),
    title: getTitle(item),
    image: getPosterImage(item),
    meta: getYear(item) ? String(getYear(item)) : '',
    selectedAnime: item,
  }
}

function mapContinueItem(item, index, isEnglish) {
  const progressPercent = Number(item?.progress_percent || 0) || (item?.episode_num ? Math.min(95, 22 + (index * 15)) : 0)
  const seasonLabel = item?.season_label || item?.episode_title || `${isEnglish ? 'S1' : 'T1'} - ${isEnglish ? 'E' : 'E'}${item?.episode_num || index + 8}`
  return {
    id: item?.episode_id || item?.id || `${getTitle(item)}-${index}`,
    title: getTitle(item),
    image: item?.banner_url || item?.image || item?.cover_url || item?.cover_image || getPosterImage(item),
    meta: seasonLabel,
    progressPercent,
    selectedAnime: item,
  }
}

function uniqueItems(items) {
  const seen = new Set()
  return (items || []).filter((item) => {
    const key = String(item?.id || item?.anilist_id || item?.episode_id || getTitle(item))
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isMangaContinueItem(item) {
  const rawSourceID = String(item?.source_id || '').trim()
  if (!rawSourceID) return false
  return MANGA_SOURCE_IDS.has(normalizeMangaSourceID(rawSourceID))
}

function isAiringItem(item) {
  return item?.status === 'RELEASING' || Number(item?.nextAiringEpisode?.episode || 0) > 0
}

function fillSectionItems(items, backupPool, limit) {
  const resolved = uniqueItems(items).slice(0, limit)
  if (resolved.length >= limit) return resolved
  const seen = new Set(resolved.map((item) => String(item?.id || item?.anilist_id || getTitle(item))))
  for (const candidate of backupPool || []) {
    const key = String(candidate?.id || candidate?.anilist_id || getTitle(candidate))
    if (!key || seen.has(key)) continue
    resolved.push(candidate)
    seen.add(key)
    if (resolved.length >= limit) break
  }
  return resolved
}

function buildFallbackFeaturedRows(featuredPool, isEnglish) {
  return [
    {
      key: 'popular-now',
      title: isEnglish ? 'Popular Now' : 'Popular ahora',
      subtitle: isEnglish ? 'The shows everyone is opening right now' : 'Los shows que mas se estan abriendo ahora mismo',
      href: '/anime-online',
      items: featuredPool.slice(1, 1 + GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'trending-season',
      title: isEnglish ? 'Trending This Season' : 'Tendencia esta temporada',
      subtitle: isEnglish ? 'Fresh weekly momentum from AniList' : 'Impulso semanal fresco desde AniList',
      href: '/anime-online',
      items: featuredPool.slice(11, 11 + GUI2_HOME_POSTER_LIMIT),
    },
  ].filter((row) => row.items.length > 0)
}

function mapSection(section, variant = 'poster') {
  return {
    key: section.key,
    title: section.title,
    subtitle: section.subtitle || '',
    actionLabel: 'View All',
    href: section.href || '/anime-online',
    variant,
    items: (section.items || []).slice(0, variant === 'landscape' ? GUI2_HOME_CONTINUE_LIMIT : GUI2_HOME_POSTER_LIMIT).map(
      variant === 'landscape'
        ? (item, index) => mapContinueItem(item, index, true)
        : mapPosterItem,
    ),
  }
}

export function getNextHomeHeroIndex(currentIndex, totalSlides) {
  if (Number(totalSlides || 0) <= 1) return 0
  return currentIndex >= totalSlides - 1 ? 0 : currentIndex + 1
}

export function buildGui2HomeData({
  dashboard = {},
  trending = [],
  featuredRows = [],
  genreRows = [],
  isEnglish = false,
}) {
  const resolvedFeaturedRows = featuredRows.filter((row) => (row?.items?.length || 0) > 0)
  const resolvedGenreRows = genreRows.filter((row) => (row?.items?.length || 0) > 0)
  const featuredPool = uniqueItems(
    trending.length
      ? trending
      : [
          ...resolvedFeaturedRows.flatMap((row) => row.items || []),
          ...(dashboard?.recent_anime || []),
        ],
  )

  const heroSlides = featuredPool.slice(0, 5)
  const hero = heroSlides[0] || null
  const continuePool = [...(dashboard?.continue_watching_online || []), ...(dashboard?.continue_watching || [])]
    .filter((item) => !isMangaContinueItem(item))

  const recentSourcePool = uniqueItems([
    ...resolvedFeaturedRows.flatMap((row) => row.items || []),
    ...resolvedGenreRows.flatMap((row) => row.items || []),
    ...featuredPool,
  ]).filter(isAiringItem)

  const recentUpdates = recentSourcePool.slice(0, GUI2_HOME_RECENT_LIMIT).map((item, index) => {
    const subtitle = buildRecentSubtitle(item, isEnglish, index)
    return {
      id: item?.id || item?.anilist_id || index,
      title: getTitle(item),
      image: getPosterImage(item),
      episodeLabel: subtitle.episodeLabel,
      ageLabel: subtitle.ageLabel,
      selectedAnime: item,
    }
  })

  const fallbackFeaturedRows = resolvedFeaturedRows.length
    ? resolvedFeaturedRows
    : buildFallbackFeaturedRows(featuredPool, isEnglish)
  const fillPool = uniqueItems([
    ...featuredPool,
    ...resolvedFeaturedRows.flatMap((row) => row.items || []),
    ...resolvedGenreRows.flatMap((row) => row.items || []),
  ])

  return {
    hero: hero
      ? {
          id: hero?.id || getTitle(hero),
          title: getTitle(hero),
          banner: getBannerImage(hero),
          meta: buildHeroMeta(hero),
          summary: stripHtml(hero?.description || ''),
          selectedAnime: hero,
        }
      : null,
    heroSlides: heroSlides.map((item) => ({
      id: item?.id || getTitle(item),
      title: getTitle(item),
      banner: getBannerImage(item),
      meta: buildHeroMeta(item),
      summary: stripHtml(item?.description || ''),
      selectedAnime: item,
    })),
    recentUpdates,
    sections: [
      {
        key: 'continue-watching',
        title: isEnglish ? 'Continue Watching' : 'Continuar viendo',
        subtitle: isEnglish ? 'Pick up what you already started' : 'Retoma lo que ya empezaste',
        actionLabel: '',
        pageSize: GUI2_HOME_CONTINUE_LIMIT,
        variant: 'landscape',
        items: continuePool.map((item, index) => mapContinueItem(item, index, isEnglish)),
      },
      ...fallbackFeaturedRows.map((section) => ({
        key: section.key,
        title: section.title,
        subtitle: section.subtitle || '',
        actionLabel: 'View All',
        href: section.href || '/anime-online',
        variant: 'poster',
        items: fillSectionItems(section.items || [], fillPool, GUI2_HOME_POSTER_LIMIT).map(mapPosterItem),
      })),
      ...resolvedGenreRows.map((section) => ({
        key: section.key,
        title: section.title,
        subtitle: section.subtitle || '',
        actionLabel: 'View All',
        href: section.href || '/anime-online',
        variant: 'poster',
        items: fillSectionItems(section.items || [], fillPool, GUI2_HOME_POSTER_LIMIT).map(mapPosterItem),
      })),
    ].filter((section) => section.items.length > 0),
  }
}
