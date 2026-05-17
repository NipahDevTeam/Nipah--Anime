import { MANGA_SOURCE_IDS, normalizeMangaSourceID } from '../../../lib/mangaSources.js'

export const GUI2_HOME_HERO_ROTATE_MS = 7000
export const GUI2_HOME_HERO_FADE_MS = 320
export const GUI2_HOME_CONTINUE_LIMIT = 6
export const GUI2_HOME_POSTER_LIMIT = 20
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
    key: 'adventure',
    genre: 'Adventure',
    titleEn: 'Adventure Trails',
    titleEs: 'Aventuras para seguir',
    subtitleEn: 'Journeys, quests, and bigger horizons',
    subtitleEs: 'Viajes, misiones y horizontes mas grandes',
  },
  {
    key: 'comedy',
    genre: 'Comedy',
    titleEn: 'Comedy Rotation',
    titleEs: 'Comedia para levantar el ritmo',
    subtitleEn: 'Lighter shelves with faster energy',
    subtitleEs: 'Filas mas ligeras con energia mas rapida',
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
    key: 'mystery',
    genre: 'Mystery',
    titleEn: 'Mystery Signals',
    titleEs: 'Misterios para seguir tirando del hilo',
    subtitleEn: 'Slow-burn hooks and sharper reveals',
    subtitleEs: 'Ganchos lentos y revelaciones mas filosas',
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
    key: 'sports',
    genre: 'Sports',
    titleEn: 'Sports Momentum',
    titleEs: 'Deportes con impulso',
    subtitleEn: 'Training arcs, tension, and momentum',
    subtitleEs: 'Arcos de entrenamiento, tension e impulso',
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
  {
    key: 'supernatural',
    genre: 'Supernatural',
    titleEn: 'Supernatural Nights',
    titleEs: 'Noches sobrenaturales',
    subtitleEn: 'Stranger rules, darker moods, bigger stakes',
    subtitleEs: 'Reglas raras, climas oscuros y apuestas mayores',
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
    item?.title_native,
    item?.title?.english,
    item?.title?.romaji,
    item?.title?.native,
    typeof item?.title === 'string' ? item.title : '',
  ) || 'Anime'
}

function getPosterImage(item) {
  return item?.cover_image
    || item?.cover_url
    || item?.cover_large
    || item?.cover_medium
    || item?.banner_url
    || item?.banner_image
    || item?.image
    || item?.coverImage?.extraLarge
    || item?.coverImage?.large
    || item?.bannerImage
    || ''
}

function getBannerImage(item) {
  return item?.resolved_banner_url || item?.banner_url || item?.bannerImage || item?.banner_image || item?.coverImage?.extraLarge || item?.coverImage?.large || item?.cover_image || item?.cover_url || ''
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

function getChapters(item) {
  return item?.chapters || item?.chapters_total || item?.chapter_count || 0
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

function buildMangaHeroMeta(item, isEnglish) {
  const bits = []
  const format = pickString(item?.format, item?.media_format, item?.resolved_format)
  if (format) bits.push(format)
  if (getYear(item)) bits.push(String(getYear(item)))
  const chapters = getChapters(item)
  if (chapters) bits.push(`${chapters} ${isEnglish ? 'Chapters' : 'Capitulos'}`)
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

function buildMangaRecentSubtitle(item, isEnglish) {
  const chapterNumber = Number(item?.chapter_number || item?.chapter || item?.chapters_read || item?.episode_num || 0)
  return {
    chapterLabel: chapterNumber > 0
      ? `${isEnglish ? 'Chapter' : 'Capitulo'} ${chapterNumber}`
      : (isEnglish ? 'New chapter' : 'Nuevo capitulo'),
    ageLabel: pickString(
      item?.updated_at_relative,
      item?.relative_time,
      item?.last_updated_relative,
      item?.read_at_relative,
      isEnglish ? 'Recently updated' : 'Actualizado recientemente',
    ),
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

function mapMangaContinueItem(item, index, isEnglish) {
  const chaptersRead = Number(item?.chapters_read || item?.chapter_number || item?.episode_num || 0)
  const chaptersTotal = Number(item?.chapters_total || item?.chapters || 0)
  const progressPercent = chaptersTotal > 0
    ? Math.min(100, Math.max(0, (chaptersRead / chaptersTotal) * 100))
    : (chaptersRead > 0 ? Math.min(95, 24 + (index * 12)) : 0)
  const meta = chaptersRead > 0
    ? `${isEnglish ? 'Chapter' : 'Capitulo'} ${chaptersRead}`
    : (isEnglish ? 'Continue reading' : 'Continuar leyendo')
  return {
    id: item?.episode_id || item?.anilist_id || item?.id || `${getTitle(item)}-${index}`,
    title: getTitle(item),
    image: item?.banner_url || item?.banner_image || item?.image || item?.cover_url || item?.cover_image || getPosterImage(item),
    meta,
    progressPercent,
    selectedAnime: item,
  }
}

function mapMangaRecentItem(item, index, isEnglish) {
  const subtitle = buildMangaRecentSubtitle(item, isEnglish)
  return {
    id: item?.id || item?.anilist_id || `${getTitle(item)}-${index}`,
    title: getTitle(item),
    image: getPosterImage(item),
    chapterLabel: subtitle.chapterLabel,
    ageLabel: subtitle.ageLabel,
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

function buildFallbackFeaturedRows(featuredPool, isEnglish) {
  return [
    {
      key: 'newly-trending',
      title: isEnglish ? 'Newly Trending Anime' : 'Anime en nueva tendencia',
      subtitle: isEnglish ? 'Fresh movement from AniList before it settles into the season.' : 'Movimiento fresco desde AniList antes de que la temporada se acomode.',
      href: '/anime-online',
      items: featuredPool.slice(1, 1 + GUI2_HOME_POSTER_LIMIT),
    },
    {
      key: 'popular-this-season',
      title: isEnglish ? 'Popular This Season' : 'Popular esta temporada',
      subtitle: isEnglish ? 'The current season with stronger shelf gravity and better breadth.' : 'La temporada actual con mas peso de catalogo y mejor amplitud.',
      href: '/anime-online',
      items: featuredPool.slice(11, 11 + GUI2_HOME_POSTER_LIMIT),
    },
  ].filter((row) => row.items.length > 0)
}

function buildMangaSections({
  dashboard,
  mangaFeaturedRows,
  mangaGenreRows,
  isEnglish,
}) {
  const continueReading = uniqueItems(dashboard?.continue_reading_online_manga || [])
  const recommendations = mangaFeaturedRows.find((section) => section.key === 'recommended-for-you')
  const freshPicks = mangaFeaturedRows.find((section) => section.key === 'fresh-manga-picks')
  const lowerRows = mangaGenreRows.filter((section) => (section?.items?.length || 0) > 0)

  return [
    continueReading.length > 0
      ? {
          key: 'continue-reading-manga',
          title: isEnglish ? 'Continue Reading' : 'Continuar leyendo',
          subtitle: isEnglish ? 'Return to the chapters you already opened' : 'Vuelve a los capitulos que ya abriste',
          actionLabel: '',
          href: '/manga-online',
          pageSize: GUI2_HOME_CONTINUE_LIMIT,
          variant: 'landscape',
          items: continueReading.slice(0, GUI2_HOME_POSTER_LIMIT).map((item, index) => mapMangaContinueItem(item, index, isEnglish)),
        }
      : null,
    recommendations
      ? {
          key: 'recommended-for-you',
          title: recommendations.title || (isEnglish ? 'Recommended For You' : 'Recomendado para ti'),
          subtitle: recommendations.subtitle || (isEnglish ? 'Picked from your current reading momentum' : 'Elegido desde tu impulso actual de lectura'),
          actionLabel: '',
          href: recommendations.href || '/manga-online',
          variant: 'poster',
          items: uniqueItems(recommendations.items || []).slice(0, GUI2_HOME_POSTER_LIMIT).map(mapPosterItem),
        }
      : null,
    freshPicks
      ? {
          key: 'fresh-manga-picks',
          title: freshPicks.title || (isEnglish ? 'Fresh Manga Picks' : 'Manga fresco para descubrir'),
          subtitle: freshPicks.subtitle || (isEnglish ? 'Recent chapter movement and broader manga discovery' : 'Movimiento reciente de capitulos y descubrimiento manga mas amplio'),
          actionLabel: '',
          href: freshPicks.href || '/manga-online',
          variant: 'poster',
          items: uniqueItems(freshPicks.items || []).slice(0, GUI2_HOME_POSTER_LIMIT).map(mapPosterItem),
        }
      : null,
    ...lowerRows.map((section) => ({
      key: section.key,
      title: section.title,
      subtitle: section.subtitle || '',
      actionLabel: '',
      href: section.href || '/manga-online',
      variant: 'poster',
      items: uniqueItems(section.items || []).slice(0, GUI2_HOME_POSTER_LIMIT).map(mapPosterItem),
    })),
  ].filter((section) => (section?.items?.length || 0) > 0)
}

export function getNextHomeHeroIndex(currentIndex, totalSlides) {
  if (Number(totalSlides || 0) <= 1) return 0
  return currentIndex >= totalSlides - 1 ? 0 : currentIndex + 1
}

function buildStartupAnimeFeaturedRows(items = [], isEnglish = false) {
  const shelfMap = new Map((Array.isArray(items) ? items : []).map((section) => [section?.key, section?.items || []]))
  return [
    {
      key: 'newly-trending',
      title: isEnglish ? 'Newly Trending Anime' : 'Anime en nueva tendencia',
      subtitle: isEnglish ? 'Fresh movement from AniList before it settles into the season.' : 'Movimiento fresco desde AniList antes de que la temporada se acomode.',
      href: '/anime-online',
      items: shelfMap.get('newly-trending') || [],
    },
    {
      key: 'popular-this-season',
      title: isEnglish ? 'Popular This Season' : 'Popular esta temporada',
      subtitle: isEnglish ? 'The current season with stronger shelf gravity and better breadth.' : 'La temporada actual con mas peso de catalogo y mejor amplitud.',
      href: '/anime-online',
      items: shelfMap.get('popular-this-season') || [],
    },
    {
      key: 'upcoming-watchlist',
      title: isEnglish ? 'Upcoming' : 'Proximamente',
      subtitle: isEnglish ? 'Future-facing releases that deserve space before they land.' : 'Lanzamientos futuros que merecen espacio antes de salir.',
      href: '/anime-online',
      items: shelfMap.get('upcoming') || [],
    },
  ].filter((section) => section.items.length > 0)
}

function buildStartupMangaFeaturedRows(items = [], isEnglish = false) {
  return (Array.isArray(items) ? items : []).map((section) => {
    if (section?.key === 'recent-manga-updates') {
      return {
        key: 'recent-manga-updates',
        title: isEnglish ? 'Recent Manga Updates' : 'Actualizaciones manga recientes',
        subtitle: isEnglish ? 'Fresh chapter movement before the deeper discovery rows arrive.' : 'Movimiento fresco de capitulos antes de que lleguen las filas de descubrimiento.',
        href: '/manga-online',
        items: section.items || [],
      }
    }
    if (section?.key === 'fresh-manga-picks') {
      return {
        key: 'fresh-manga-picks',
        title: isEnglish ? 'Fresh Manga Picks' : 'Manga fresco para descubrir',
        subtitle: isEnglish ? 'Recent chapter movement and broader manga discovery' : 'Movimiento reciente de capitulos y descubrimiento manga mas amplio',
        href: '/manga-online',
        items: section.items || [],
      }
    }
    if (section?.key === 'popular-manga-right-now') {
      return {
        key: 'popular-manga-right-now',
        title: isEnglish ? 'Popular Manga Right Now' : 'Manga popular ahora',
        subtitle: isEnglish ? 'Broader manga gravity that already feels alive on first reveal.' : 'Un pulso manga mas amplio que ya se siente vivo desde la primera apertura.',
        href: '/manga-online',
        items: section.items || [],
      }
    }
    return {
      key: section?.key || 'startup-manga-shelf',
      title: isEnglish ? 'Manga Picks' : 'Selecciones manga',
      subtitle: '',
      href: '/manga-online',
      items: section?.items || [],
    }
  }).filter((section) => section.items.length > 0)
}

export function buildGui2HomeDataFromStartupSnapshot({
  snapshot = null,
  isEnglish = false,
} = {}) {
  if (!snapshot) {
    return buildGui2HomeData({ dashboard: {}, isEnglish })
  }

  const startupAnimeItems = uniqueItems([
    ...(snapshot?.anime?.hero ? [snapshot.anime.hero] : []),
    ...((snapshot?.anime?.shelves || []).flatMap((section) => section?.items || [])),
  ])
  const startupMangaItems = uniqueItems([
    ...(snapshot?.manga?.hero ? [snapshot.manga.hero] : []),
    ...((snapshot?.manga?.shelves || []).flatMap((section) => section?.items || [])),
  ])

  const startupHomeData = buildGui2HomeData({
    dashboard: snapshot?.dashboard || {},
    trending: startupAnimeItems,
    featuredRows: buildStartupAnimeFeaturedRows(snapshot?.anime?.shelves, isEnglish),
    genreRows: [],
    mangaTrending: startupMangaItems,
    mangaRecentItems: snapshot?.manga?.recent || [],
    mangaFeaturedRows: buildStartupMangaFeaturedRows(snapshot?.manga?.shelves, isEnglish),
    mangaGenreRows: [],
    isEnglish,
  })

  const startupRecentUpdates = uniqueItems(snapshot?.anime?.recent || []).map((item, index) => {
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
  const startupMangaRecentUpdates = uniqueItems(snapshot?.manga?.recent || [])
    .slice(0, GUI2_HOME_RECENT_LIMIT)
    .map((item, index) => mapMangaRecentItem(item, index, isEnglish))

  return {
    ...startupHomeData,
    recentUpdates: startupRecentUpdates,
    featuredRecentSection: {
      ...startupHomeData.featuredRecentSection,
      items: startupRecentUpdates,
    },
    mangaFeaturedRecentSection: {
      ...startupHomeData.mangaFeaturedRecentSection,
      items: startupMangaRecentUpdates,
    },
  }
}

export function buildGui2HomeData({
  dashboard = {},
  trending = [],
  featuredRows = [],
  genreRows = [],
  mangaTrending = [],
  mangaRecentItems = [],
  mangaFeaturedRows = [],
  mangaGenreRows = [],
  isEnglish = false,
}) {
  const resolvedFeaturedRows = featuredRows.filter((row) => (row?.items?.length || 0) > 0)
  const resolvedGenreRows = genreRows.filter((row) => (row?.items?.length || 0) > 0)
  const resolvedMangaFeaturedRows = mangaFeaturedRows.filter((row) => (row?.items?.length || 0) > 0)
  const resolvedMangaGenreRows = mangaGenreRows.filter((row) => (row?.items?.length || 0) > 0)
  const featuredPool = uniqueItems(
    trending.length
      ? trending
      : resolvedFeaturedRows.flatMap((row) => row.items || []),
  )
  const mangaFeaturedPool = uniqueItems(
    mangaTrending.length
      ? mangaTrending
      : [
          ...resolvedMangaFeaturedRows.flatMap((row) => row.items || []),
          ...resolvedMangaGenreRows.flatMap((row) => row.items || []),
        ],
  )

  const heroSlides = featuredPool.slice(0, 5)
  const hero = heroSlides[0] || null
  const mangaHeroSlides = mangaFeaturedPool.slice(0, 5)
  const mangaHero = mangaHeroSlides[0] || null
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
  const mangaRecentSourcePool = uniqueItems(
    mangaRecentItems.length > 0
      ? mangaRecentItems
      : (
          dashboard?.recent_manga_updates
          || dashboard?.recent_manga
          || dashboard?.recent_manga_online
          || []
        ),
  )
  const mangaRecentUpdates = mangaRecentSourcePool
    .slice(0, GUI2_HOME_RECENT_LIMIT)
    .map((item, index) => mapMangaRecentItem(item, index, isEnglish))

  const fallbackFeaturedRows = resolvedFeaturedRows.length
    ? resolvedFeaturedRows
    : buildFallbackFeaturedRows(featuredPool, isEnglish)
  const hasPrimaryShelves = heroSlides.length > 0 || fallbackFeaturedRows.length > 0 || resolvedGenreRows.length > 0
  const animeSections = [
    ...(hasPrimaryShelves ? [{
      key: 'continue-watching',
      title: isEnglish ? 'Continue Watching' : 'Continuar viendo',
      subtitle: isEnglish ? 'Pick up what you already started' : 'Retoma lo que ya empezaste',
      actionLabel: '',
      pageSize: GUI2_HOME_CONTINUE_LIMIT,
      variant: 'landscape',
      items: continuePool.map((item, index) => mapContinueItem(item, index, isEnglish)),
    }] : []),
    ...fallbackFeaturedRows.map((section) => ({
      key: section.key,
      title: section.title,
      subtitle: section.subtitle || '',
      actionLabel: 'View All',
      href: section.href || '/anime-online',
      variant: 'poster',
      items: uniqueItems(section.items || []).slice(0, GUI2_HOME_POSTER_LIMIT).map(mapPosterItem),
    })),
    ...resolvedGenreRows.map((section) => ({
      key: section.key,
      title: section.title,
      subtitle: section.subtitle || '',
      actionLabel: 'View All',
      href: section.href || '/anime-online',
      variant: 'poster',
      items: uniqueItems(section.items || []).slice(0, GUI2_HOME_POSTER_LIMIT).map(mapPosterItem),
    })),
  ].filter((section) => section.items.length > 0)
  const mangaSections = buildMangaSections({
    dashboard,
    mangaFeaturedRows: resolvedMangaFeaturedRows,
    mangaGenreRows: resolvedMangaGenreRows,
    isEnglish,
  })

  return {
    hero: hero
      ? {
          id: hero?.id || getTitle(hero),
          title: getTitle(hero),
          banner: getBannerImage(hero),
          image: getPosterImage(hero),
          meta: buildHeroMeta(hero),
          summary: stripHtml(hero?.description || ''),
          selectedAnime: hero,
        }
      : null,
    heroSlides: heroSlides.map((item) => ({
      id: item?.id || getTitle(item),
      title: getTitle(item),
      banner: getBannerImage(item),
      image: getPosterImage(item),
      meta: buildHeroMeta(item),
      summary: stripHtml(item?.description || ''),
      selectedAnime: item,
    })),
    mangaHero: mangaHero
      ? {
          id: mangaHero?.id || getTitle(mangaHero),
          title: getTitle(mangaHero),
          banner: getBannerImage(mangaHero),
          image: getPosterImage(mangaHero),
          meta: buildMangaHeroMeta(mangaHero, isEnglish),
          summary: stripHtml(mangaHero?.description || ''),
          selectedAnime: mangaHero,
        }
      : null,
    mangaHeroSlides: mangaHeroSlides.map((item) => ({
      id: item?.id || getTitle(item),
      title: getTitle(item),
      banner: getBannerImage(item),
      image: getPosterImage(item),
      meta: buildMangaHeroMeta(item, isEnglish),
      summary: stripHtml(item?.description || ''),
      selectedAnime: item,
    })),
    recentUpdates,
    featuredRecentSection: {
      key: 'recently-updated',
      title: isEnglish ? 'Recently Updated' : 'Recientemente actualizado',
      subtitle: isEnglish ? 'Only anime with active AniList episode releases.' : 'Solo anime con episodios activos en AniList.',
      items: recentUpdates,
    },
    mangaFeaturedRecentSection: {
      key: 'recent-chapter-updates',
      title: isEnglish ? 'Recent Chapter Updates' : 'Actualizaciones de capitulos',
      subtitle: isEnglish ? 'Latest chapter movement across your manga flow.' : 'Movimiento reciente de capitulos dentro de tu flujo manga.',
      items: mangaRecentUpdates,
    },
    animeSections,
    mangaSections,
    sections: animeSections,
  }
}

export function hasPrimaryHomeCatalogContent(homeData = {}) {
  const animeCatalogReady = Boolean(
    homeData?.hero
    || (homeData?.animeSections || []).some((section) => section?.key !== 'continue-watching' && (section?.items?.length || 0) > 0)
  )
  const mangaCatalogReady = Boolean(
    homeData?.mangaHero
    || (homeData?.mangaSections || []).some((section) => section?.key !== 'continue-reading-manga' && (section?.items?.length || 0) > 0)
  )

  return animeCatalogReady && mangaCatalogReady
}
