import { buildOrderedMangaSearchCandidates } from './mangaSearchCandidates.js'

function firstNonEmptyString(values = []) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pickAniListTitle(title) {
  if (typeof title === 'string') return title.trim()
  if (!title || typeof title !== 'object') return ''

  return firstNonEmptyString([
    title.english,
    title.romaji,
    title.native,
    title.userPreferred,
  ])
}

function getPreferredAniListID(entry = {}) {
  const explicitAniListID = Number(entry.anilist_id || entry.anilistID || entry.AniListID || entry.idAniList || 0)
  if (explicitAniListID > 0) return explicitAniListID
  return entry?.source_id ? 0 : Number(entry.id || 0)
}

function hasDirectAnimeSourcePayload(entry = {}) {
  const sourceID = firstNonEmptyString([entry.source_id, entry.sourceID])
  const sourceAnimeID = entry.anime_id ?? entry.animeID ?? entry.id ?? ''
  return Boolean(sourceID && sourceAnimeID)
}

function buildAniListTitleObject(entry = {}) {
  const rawTitle = entry?.title
  const english = firstNonEmptyString([
    entry.title_english,
    entry.titleEnglish,
    rawTitle?.english,
    typeof rawTitle === 'string' ? rawTitle : '',
  ])
  const romaji = firstNonEmptyString([
    entry.title_romaji,
    entry.titleRomaji,
    rawTitle?.romaji,
    english,
    typeof rawTitle === 'string' ? rawTitle : '',
  ])
  const native = firstNonEmptyString([
    entry.title_native,
    entry.titleNative,
    rawTitle?.native,
  ])
  const userPreferred = firstNonEmptyString([
    rawTitle?.userPreferred,
    english,
    romaji,
    native,
    typeof rawTitle === 'string' ? rawTitle : '',
  ])

  return {
    english,
    romaji,
    native,
    userPreferred,
  }
}

function getPreferredDisplayAnimeTitle(entry = {}) {
  const title = buildAniListTitleObject(entry)
  return firstNonEmptyString([
    entry.anime_title,
    entry.display_title,
    entry.canonical_title,
    title.english,
    title.romaji,
    title.native,
    typeof entry.title === 'string' ? entry.title : '',
  ])
}

export function normalizeSelectedAnimePayload(anime, fallbackSourceID = '') {
  if (!anime) return anime

  const sourceID = anime.source_id || fallbackSourceID || ''
  const sourceAnimeID = anime.anime_id ?? anime.animeID ?? anime.id ?? ''
  const title = firstNonEmptyString([
    anime.anime_title,
    anime.title_english,
    anime.title_romaji,
    anime.title_native,
    pickAniListTitle(anime.title),
  ])
  const providerCoverURL = anime.cover_url || anime.cover_image || ''
  const anilistCoverURL = anime.anilistCoverImage || anime.coverImage?.extraLarge || anime.coverImage?.large || anime.coverImage?.medium || ''
  const preferAniListCover = ['animegg-en', 'animepahe-en'].includes(sourceID) && sourceID !== 'animekai-en'

  return {
    ...anime,
    source_id: sourceID,
    id: sourceAnimeID,
    anime_id: anime.anime_id ?? sourceAnimeID,
    title,
    anime_title: firstNonEmptyString([anime.anime_title, title]),
    cover_url: preferAniListCover
      ? (anilistCoverURL || providerCoverURL)
      : (providerCoverURL || anilistCoverURL),
  }
}

export function buildPendingAniListSelectedAnime(media = {}, fallbackSourceID = '', extra = {}) {
  const titleObject = buildAniListTitleObject(media)
  const title = firstNonEmptyString([
    media.anime_title,
    media.display_title,
    media.title_english,
    media.title_romaji,
    media.title_native,
    titleObject.english,
    titleObject.romaji,
    titleObject.native,
    titleObject.userPreferred,
    typeof media.title === 'string' ? media.title : '',
  ])
  const coverURL = media.anilistCoverImage
    || media.cover_large
    || media.cover_medium
    || media.coverLarge
    || media.coverMedium
    || media.coverImage?.extraLarge
    || media.coverImage?.large
    || media.coverImage?.medium
    || media.cover_url
    || media.cover_image
    || ''
  const anilistID = Number(
    media.anilist_id
    || media.anilistID
    || media.AniListID
    || media.idAniList
    || media.id
    || 0,
  )

  return {
    ...media,
    source_id: fallbackSourceID || media.source_id || '',
    id: 0,
    anime_id: 0,
    title: titleObject,
    title,
    anime_title: title,
    title_english: firstNonEmptyString([media.title_english, titleObject.english, title]),
    title_romaji: firstNonEmptyString([media.title_romaji, titleObject.romaji, title]),
    title_native: firstNonEmptyString([media.title_native, titleObject.native]),
    cover_url: coverURL,
    anilist_id: anilistID,
    mal_id: Number(media.mal_id || media.malID || media.idMal || 0),
    year: Number(media.year || media.seasonYear || media.startDate?.year || media.start_date?.year || 0),
    pending_resolve: true,
    anilistDescription: media.anilistDescription || media.description || '',
    anilistBannerImage: media.anilistBannerImage || media.bannerImage || media.banner_image || '',
    anilistCoverImage: media.anilistCoverImage || coverURL,
    source_resolve_error: '',
    ...extra,
  }
}

export function getInitialSelectedAnimePayload(locationState = null, fallbackSourceID = '') {
  if (locationState?.selectedAnime) {
    return normalizeSelectedAnimePayload(
      locationState.selectedAnime,
      locationState.selectedAnime?.source_id || fallbackSourceID,
    )
  }

  if (locationState?.seedAniListMedia) {
    return buildPendingAniListSelectedAnime(locationState.seedAniListMedia, fallbackSourceID)
  }

  return null
}

export function buildAnimeNavigationState(entry = {}, fallbackSourceID = '') {
  const preferredAnilistID = getPreferredAniListID(entry)
  const titleObject = buildAniListTitleObject(entry)
  const displayTitle = getPreferredDisplayAnimeTitle(entry)
  if (hasDirectAnimeSourcePayload(entry)) {
    return {
      selectedAnime: normalizeSelectedAnimePayload(entry, entry.source_id || fallbackSourceID),
      ...(preferredAnilistID > 0 ? { preferredAnilistID } : {}),
    }
  }

  return {
    seedAniListMedia: {
      ...entry,
      ...(preferredAnilistID > 0 ? { id: preferredAnilistID } : {}),
      anilist_id: preferredAnilistID > 0 ? preferredAnilistID : Number(entry.anilist_id || 0),
      title: titleObject,
      anime_title: firstNonEmptyString([entry.anime_title, displayTitle]),
      display_title: displayTitle,
      title_english: firstNonEmptyString([entry.title_english, titleObject.english, displayTitle]),
      title_romaji: firstNonEmptyString([entry.title_romaji, titleObject.romaji, displayTitle]),
      title_native: firstNonEmptyString([entry.title_native, titleObject.native]),
    },
    ...(preferredAnilistID > 0 ? { preferredAnilistID } : {}),
  }
}

export function buildAnimeListNavigationState(entry = {}) {
  return buildAnimeNavigationState({
    ...entry,
    title_english: firstNonEmptyString([
      entry.title_english,
      entry.titleEnglish,
      entry.title?.english,
    ]),
    title_romaji: firstNonEmptyString([
      entry.title_romaji,
      entry.titleRomaji,
      entry.title?.romaji,
    ]),
    title_native: firstNonEmptyString([
      entry.title_native,
      entry.titleNative,
      entry.title?.native,
    ]),
  })
}

export function buildMangaListNavigationState(entry = {}) {
  const title = firstNonEmptyString([
    entry.canonical_title,
    entry.title_english,
    entry.title_romaji,
    entry.title_native,
    entry.title,
  ])
  const searchCandidates = buildOrderedMangaSearchCandidates(entry)

  return {
    preSearch: title,
    altSearch: firstNonEmptyString([
      entry.title_english,
      entry.title_romaji,
      entry.title_native,
      entry.title,
    ]),
    preferredAnilistID: Number(entry.anilist_id || 0),
    searchCandidates,
    seedItem: {
      anilist_id: Number(entry.anilist_id || 0),
      canonical_title: title,
      canonical_title_english: entry.title_english || title,
      title_romaji: entry.title_romaji || title,
      title_native: entry.title_native || '',
      cover_url: entry.cover_image || entry.cover_url || '',
      resolved_cover_url: entry.cover_image || entry.cover_url || '',
      banner_url: entry.banner_image || entry.banner_url || '',
      resolved_banner_url: entry.banner_image || entry.banner_url || '',
      description: entry.description || entry.synopsis || '',
      resolved_description: entry.description || entry.synopsis || '',
      year: Number(entry.year || 0),
      resolved_year: Number(entry.year || 0),
      format: entry.format || entry.media_format || '',
      resolved_format: entry.format || entry.media_format || '',
      status: entry.status || '',
      resolved_status: entry.status || '',
      chapters_total: Number(entry.chapters_total || 0),
      chapters_read: Number(entry.chapters_read || 0),
      volumes_total: Number(entry.volumes_total || 0),
      volumes_read: Number(entry.volumes_read || 0),
      search_candidates: searchCandidates,
    },
  }
}
