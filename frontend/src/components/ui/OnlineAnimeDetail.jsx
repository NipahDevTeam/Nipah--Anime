import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { wails, proxyImage } from '../../lib/wails'
import { providerUsesExplicitEpisodeAudioVariant, shouldAllowAutomaticAudioFallback } from '../../lib/onlinePlaybackFallback'
import { toastError, toastSuccess } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'
import { extractAniListAnimeSearchMedia } from '../../lib/anilistSearch'
import { enrichEpisodesWithAnimePaheArtwork, hasZeroThumbnailCoverage, mergeEpisodeArtworkByNumber } from '../../lib/episodeArtwork'
import { pickEpisodeArtwork } from '../../lib/episodeArtworkPriority'
import IntegratedVideoPlayer from './IntegratedVideoPlayer'
import { perfEnd, perfMark } from '../../lib/perfTrace'
import { buildMotionVars } from '../../gui-v2/motion/gui2Motion'
import LandingRecommendationsStage from './landing/LandingRecommendationsStage'
import { buildLandingQueueWindow } from './landing/landingQueueWindowing'

const SOURCE_LABELS = {
  'jkanime-es': { name: 'JKAnime', color: '#c084fc', flag: 'ES' },
  'animeflv-es': { name: 'AnimeFLV', color: '#f97316', flag: 'ES' },
  'animeav1-es': { name: 'AnimeAV1', color: '#9333ea', flag: 'ES' },
  'animepahe-en': { name: 'AnimePahe', color: '#38bdf8', flag: 'EN' },
  'animekai-en': { name: 'AnimeKai', color: '#22c55e', flag: 'EN' },
  'animeheaven-en': { name: 'AnimeHeaven', color: '#0ea5e9', flag: 'EN' },
  'animegg-en': { name: 'AnimeGG', color: '#6366f1', flag: 'EN' },
}

function detectOnlineAudioFlavor(values = []) {
  for (const value of values) {
    const text = String(value ?? '').trim().toLowerCase()
    if (!text) continue
    if (/\bdub(?:bed)?\b/.test(text)) return 'dub'
    if (/\bsub(?:bed|titles?)?\b/.test(text)) return 'sub'
  }
  return ''
}

function getAnimeRecommendationTitle(item) {
  const media = item?.media || item?.node || item
  const directTitle = typeof item?.title === 'string' ? item.title : ''
  return String(
    directTitle
    || item?.name
    || item?.anime_title
    || media?.title?.english
    || media?.title?.romaji
    || media?.title?.native
    || '',
  ).trim()
}

function getAnimeRecommendationImage(item) {
  const media = item?.media || item?.node || item
  return String(
    media?.coverImage?.extraLarge
    || media?.coverImage?.large
    || media?.coverImage?.medium
    || item?.coverImage?.extraLarge
    || item?.coverImage?.large
    || item?.coverImage?.medium
    || media?.image
    || item?.image
    || '',
  ).trim()
}

function getAnimeRecommendationSubtitle(item) {
  const media = item?.media || item?.node || item
  const values = [
    media?.format,
    media?.status ? String(media.status).replaceAll('_', ' ') : '',
    item?.rating ? `${item.rating}` : '',
  ].filter(Boolean)
  return values.join(' · ')
}

function buildAnimeRecommendationNavigationEntry(item) {
  const media = item?.media || item?.node || item
  const anilistID = Number(media?.id || item?.anilist_id || item?.id || 0)
  const title = {
    english: typeof media?.title?.english === 'string' ? media.title.english : '',
    romaji: typeof media?.title?.romaji === 'string' ? media.title.romaji : '',
    native: typeof media?.title?.native === 'string' ? media.title.native : '',
  }
  const coverImage = media?.coverImage || item?.coverImage || null

  if (anilistID <= 0 && !title.english && !title.romaji && !title.native) return null

  return {
    ...media,
    id: anilistID > 0 ? anilistID : Number(media?.id || 0),
    anilist_id: anilistID,
    title,
    title_english: title.english,
    title_romaji: title.romaji,
    title_native: title.native,
    coverImage,
    cover_large: coverImage?.extraLarge || coverImage?.large || '',
    cover_medium: coverImage?.medium || '',
    banner_image: media?.bannerImage || item?.bannerImage || '',
    description: typeof media?.description === 'string' ? media.description : '',
    format: media?.format || item?.format || '',
    status: media?.status || item?.status || '',
    seasonYear: Number(media?.seasonYear || item?.seasonYear || 0),
  }
}

function EpisodeGridSkeleton({ count = 8 }) {
  return (
    <div className="episode-grid">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="episode-card episode-card-skeleton">
          <div className="skeleton-block episode-card-art" />
          <div className="episode-card-body">
            <div className="skeleton-block skeleton-line skeleton-line-xs" />
            <div className="skeleton-block skeleton-line skeleton-line-md" />
            <div className="skeleton-block skeleton-line skeleton-line-sm" />
            <div className="skeleton-inline-row">
              <span className="skeleton-inline-chip" />
              <span className="skeleton-inline-chip short" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function OnlineAnimeDetail({ anime, onBack, onAnimeChange = null, onRecommendationSelect = null }) {
  const [episodes, setEpisodes] = useState(() => anime.prefetchedEpisodes ?? [])
  const [streaming, setStreaming] = useState(null)
  const [downloading, setDownloading] = useState(null)
  const [synopsis, setSynopsis] = useState('')
  const [showFullSynopsis, setShowFullSynopsis] = useState(false)
  const [addingToList, setAddingToList] = useState(false)
  const [integratedPlayback, setIntegratedPlayback] = useState(null)
  const [pendingIntegratedEpisode, setPendingIntegratedEpisode] = useState(null)
  const [watchState, setWatchState] = useState('browse')
  const [streamFamily, setStreamFamily] = useState('online')
  const [playbackMode, setPlaybackMode] = useState('mpv')
  const [preferredAudio, setPreferredAudio] = useState('sub')
  const [desiredAudioFlavor, setDesiredAudioFlavor] = useState('sub')
  const [audioVariantSwitching, setAudioVariantSwitching] = useState(false)
  const [episodeFilter, setEpisodeFilter] = useState('unwatched')
  const [episodePage, setEpisodePage] = useState(1)
  const [providerCoverFailed, setProviderCoverFailed] = useState(false)
  const { t, lang } = useI18n()
  const autoVariantSyncKeyRef = useRef('')
  const artworkEnrichmentKeyRef = useRef('')
  const autoIntegratedLaunchKeyRef = useRef('')
  const shouldScrollToPlayerRef = useRef(false)
  const playerStageRef = useRef(null)
  const isEnglish = lang === 'en'
  const isResolvingSource = Boolean(anime.pending_resolve)
  const sourceAnimeID = String(anime.id ?? anime.anime_id ?? anime.animeID ?? '').trim()
  const currentAniListID = Number(anime.anilist_id || anime.anilistID || anime.AniListID || anime.idAniList || 0)
  const currentMalID = Number(anime.mal_id || anime.malID || anime.MalID || 0)
  const supportsDownloads = anime.source_id === 'jkanime-es' || anime.source_id === 'animepahe-en' || anime.source_id === 'animegg-en'
  const variantProbeEpisodeID = String(episodes?.[0]?.id ?? anime.prefetchedEpisodes?.[0]?.id ?? '').trim()

  const source = SOURCE_LABELS[anime.source_id] ?? { name: anime.source_id, color: '#9090a8', flag: '' }
  const coverSrc = providerCoverFailed ? null : (anime.anilistCoverImage || null)
  const backdropSrc = anime.anilistBannerImage || coverSrc || ''
  const handleProviderCoverError = useCallback(() => setProviderCoverFailed(true), [])

  useEffect(() => {
    setProviderCoverFailed(false)
  }, [anime.anilistBannerImage, anime.anilistCoverImage])

  const ui = {
    openingEpisode: (num) => isEnglish ? `Opening episode ${num ?? ''}...` : `Abriendo episodio ${num ?? ''}...`,
    resolveError: isEnglish ? 'Could not resolve the stream. The server may be down; try another episode.' : 'No se pudo resolver el stream. El servidor puede estar caído; intenta otro episodio.',
    mpvMissing: isEnglish ? 'MPV not found. Check the path in Settings.' : 'MPV no encontrado. Verifica la ruta en Ajustes.',
    playError: (msg) => isEnglish ? `Could not play it: ${msg}` : `No se pudo reproducir: ${msg}`,
    integratedOpen: isEnglish ? 'Opening in the integrated player...' : 'Abriendo en el reproductor integrado...',
    sourceLabel: isEnglish ? 'Source' : 'Fuente',
    availability: isEnglish ? 'Availability' : 'Disponibilidad',
    streamingDownload: isEnglish ? 'Streaming + download' : 'Streaming + descarga',
    streamingOnly: 'Streaming',
    playerMode: isEnglish ? 'Player' : 'Reproductor',
    challengeError: isEnglish
      ? 'This provider is asking for bot verification before playback. AnimeKai may need a real browser session to unlock the episode.'
      : 'Esta fuente esta pidiendo verificacion anti-bot antes de reproducir. AnimeKai puede necesitar una sesion real del navegador para desbloquear el episodio.',
    audioTrack: isEnglish ? 'Audio' : 'Audio',
    subtitles: isEnglish ? 'Subtitles' : 'Subtítulos',
    dubbed: isEnglish ? 'Dubbed' : 'Doblado',
    audioLoading: isEnglish ? 'Looking for available editions...' : 'Buscando ediciones disponibles...',
    audioNoVariant: (label) => isEnglish ? `No ${label.toLowerCase()} edition was found on this provider.` : `No se encontró la edición ${label.toLowerCase()} en esta fuente.`,
    audioSwitchHint: isEnglish ? 'Switch the provider edition above the episode list.' : 'Cambia la edición del proveedor encima de la lista de episodios.',
    mpvMode: 'MPV',
    integratedMode: isEnglish ? 'In-app' : 'Dentro de la app',
    mpvModeDesc: isEnglish ? 'Use the desktop player for the fastest handoff and the most forgiving provider compatibility.' : 'Usa el reproductor de escritorio para el traspaso mas rapido y la compatibilidad mas tolerante entre fuentes.',
    integratedModeDesc: isEnglish ? 'Keeps playback inside Nipah! with quick episode controls and a darker theater view.' : 'Mantiene la reproducción dentro de Nipah! con controles rápidos y una vista más cinemática.',
    preparingIntegrated: isEnglish ? 'Preparing the in-app stream...' : 'Preparando el stream dentro de la app...',
    loadingEpisodes: isEnglish ? 'Loading episodes...' : 'Cargando episodios...',
    resolvingSource: isEnglish ? 'Resolving source and preparing episodes...' : 'Resolviendo fuente y preparando episodios...',
    noEpisodesDesc: (name) => isEnglish ? `No episodes were found for this series on ${name}.` : `No se encontraron episodios para esta serie en ${name}.`,
    loading: isEnglish ? 'Loading...' : 'Cargando...',
    unwatchedEpisodes: isEnglish ? 'Show unwatched' : 'Ver no vistos',
    allEpisodes: isEnglish ? 'Show all episodes' : 'Ver todos los episodios',
    episodeFilterHint: isEnglish ? 'Keep the list focused on what is left or expand it when you want the full run.' : 'Deja la lista centrada en lo pendiente o muéstrala completa cuando quieras ver todo.',
    episodeFilterEmpty: isEnglish ? 'You are fully caught up here.' : 'Aquí ya estás completamente al día.',
    episodeFilterEmptyDesc: isEnglish ? 'Switch to all episodes if you want to revisit earlier ones.' : 'Cambia a todos los episodios si quieres volver a los anteriores.',
    castTitle: isEnglish ? 'Cast' : 'Personajes',
    castCopy: isEnglish ? 'AniList character metadata for a quick refresher before you hit play.' : 'Metadatos de personajes de AniList para ubicarse rápido antes de reproducir.',
    castLoading: isEnglish ? 'Loading cast...' : 'Cargando personajes...',
    castEmpty: isEnglish ? 'No character metadata is available for this title yet.' : 'Todavía no hay metadatos de personajes para este título.',
    supportingRole: isEnglish ? 'Supporting' : 'Secundario',
    mainRole: isEnglish ? 'Main' : 'Principal',
    watchNow: isEnglish ? 'Watch' : 'Ver',
    watchAgain: isEnglish ? 'Watch again' : 'Ver de nuevo',
    previousEpisode: isEnglish ? 'Previous episode' : 'Episodio anterior',
    nextEpisode: isEnglish ? 'Next episode' : 'Siguiente episodio',
    moreEpisodes: isEnglish ? 'More episodes' : 'Mas episodios',
    currentlyPlaying: isEnglish ? 'Now playing' : 'Reproduciendo',
    playThisEpisode: isEnglish ? 'Play this episode' : 'Reproducir este episodio',
    noArtwork: isEnglish ? 'No artwork' : 'Sin arte',
    watched: isEnglish ? 'Watched' : 'Visto',
    episode: isEnglish ? 'Episode' : 'Episodio',
    download: isEnglish ? 'Download' : 'Descargar',
    sourceAccess: isEnglish ? 'Streaming mode' : 'Modo de streaming',
    playbackMode: isEnglish ? 'Playback mode' : 'Modo de reproduccion',
    episodeQueue: isEnglish ? 'Episode queue' : 'Cola de episodios',
    episodeQueueCopy: isEnglish ? 'A cleaner list with quick playback actions and a stable desktop rhythm.' : 'Una lista mas limpia con acciones rapidas y un ritmo de escritorio estable.',
    continueLabel: isEnglish ? 'Continue watching' : 'Continuar viendo',
    fallbackCast: isEnglish ? 'Cast is still loading from AniList. The page stays usable in the meantime.' : 'El reparto sigue cargando desde AniList. La pagina se mantiene usable mientras tanto.',
    onlineStreaming: isEnglish ? 'Online Streaming' : 'Streaming online',
    torrentStreaming: isEnglish ? 'Torrent Streaming' : 'Streaming torrent',
    streamFamilyCopy: isEnglish ? 'Start with instant streaming now. Torrent support can join this landing later without changing the primary watch flow.' : 'Empieza con streaming instantaneo ahora. El soporte torrent puede sumarse a este landing despues sin cambiar el flujo principal de ver.',
    recommendationsTitle: isEnglish ? 'Keep watching' : 'Sigue viendo',
    recommendationsCopy: isEnglish ? 'A quieter lower shelf for what should naturally follow this title once the landing room is fully enriched.' : 'Una repisa inferior mas tranquila para lo que deberia seguir de forma natural a este titulo cuando el landing termine de enriquecerse.',
    recommendationsEmptyCopy: isEnglish ? 'Related anime will settle here as recommendation data and source enrichment finish wiring in.' : 'Los animes relacionados se acomodaran aqui cuando terminen de conectarse las recomendaciones y el enriquecimiento de fuentes.',
    readMore: isEnglish ? 'Read more' : 'Leer mas',
    readLess: isEnglish ? 'Show less' : 'Mostrar menos',
    torrentUnavailable: isEnglish ? 'Torrent streaming UI is ready, but the backend handoff still needs to land before playback can start here.' : 'La UI de streaming torrent ya esta lista, pero el backend todavia debe aterrizar antes de que la reproduccion pueda empezar aqui.',
    torrentQueueEmpty: isEnglish ? 'Torrent streaming is being wired in' : 'El streaming torrent se esta cableando',
    torrentQueueCopy: isEnglish ? 'This watch surface is already reserved for the torrent flow. Once the backend lands, the same room will promote integrated playback and queue navigation here.' : 'Esta superficie ya esta reservada para el flujo torrent. Cuando aterrice el backend, este mismo espacio promovera la reproduccion integrada y la navegacion por episodios aqui.',
  }

  const cleanSynopsis = synopsis ? synopsis.replace(/<[^>]+>/g, '').trim() : ''
  const synopsisPreview = useMemo(() => {
    const text = cleanSynopsis.trim()
    if (!text) return ''
    if (showFullSynopsis) return text
    const limit = watchState === 'watch' ? 140 : 220
    return text.length > limit ? `${text.slice(0, limit).trim()}…` : text
  }, [cleanSynopsis, showFullSynopsis, watchState])

  const extractEpisodeNumber = useCallback((value) => {
    if (!value) return null
    const match = String(value).match(/(?:episode|episodio|ep)[^\d]{0,4}(\d{1,4})/i)
      || String(value).match(/\/(?:episode|ep)[^\d]{0,4}(\d{1,4})/i)
      || String(value).match(/(?:^|[^\d])(\d{1,4})(?:$|[^\d])/)
    if (!match) return null
    const num = Number(match[1])
    return Number.isFinite(num) ? num : null
  }, [])

  const getAniListEpisodeThumbnail = useCallback((ep) => {
    const items = anime.anilistStreamingEpisodes ?? []
    if (!items.length) return ''
    const targetNumber = Number(ep.number)

    const direct = items.find((item) => extractEpisodeNumber(item.title) === targetNumber)
      || items.find((item) => extractEpisodeNumber(item.url) === targetNumber)
    if (direct?.thumbnail) return direct.thumbnail

    if (targetNumber > 0 && targetNumber <= items.length && items[targetNumber - 1]?.thumbnail) {
      return items[targetNumber - 1].thumbnail
    }

    return ''
  }, [anime.anilistStreamingEpisodes, extractEpisodeNumber])

  const getEpisodeArtwork = useCallback((ep) => {
    const anilistThumb = getAniListEpisodeThumbnail(ep)
    const resolvedArtwork = pickEpisodeArtwork({
      providerThumbnail: ep.thumbnail ? proxyImage(ep.thumbnail) : '',
      anilistThumbnail: anilistThumb,
      fallbackArtwork: backdropSrc,
    })
    return resolvedArtwork
  }, [backdropSrc, getAniListEpisodeThumbnail])

  useEffect(() => {
    const explicitAudio = anime?.audio_variant === 'dub' ? 'dub' : (anime?.audio_variant === 'sub' ? 'sub' : '')
    wails.getSettings()
      .then((settings) => {
        const value = String(settings?.preferred_audio ?? 'sub').trim().toLowerCase()
        const normalized = value === 'dub' ? 'dub' : 'sub'
        const preferredPlayer = String(settings?.player ?? 'mpv').trim().toLowerCase() === 'integrated' ? 'integrated' : 'mpv'
        setPreferredAudio(normalized)
        setDesiredAudioFlavor(explicitAudio || normalized)
        setPlaybackMode(preferredPlayer)
      })
      .catch(() => {
        setPreferredAudio('sub')
        setDesiredAudioFlavor(explicitAudio || 'sub')
        setPlaybackMode('mpv')
      })
  }, [anime?.audio_variant, anime])

  useEffect(() => {
    const explicitAudio = anime?.audio_variant === 'dub' ? 'dub' : (anime?.audio_variant === 'sub' ? 'sub' : '')
    setDesiredAudioFlavor(explicitAudio || preferredAudio)
  }, [anime.source_id, sourceAnimeID, anime.audio_variant, preferredAudio])

  const activeAudioVariant = desiredAudioFlavor === 'dub' ? 'dub' : 'sub'

  const animeDetailQuery = useQuery({
    queryKey: ['anime-detail-anilist-v3', currentAniListID, lang],
    queryFn: async () => {
      let detail = null

      if (currentAniListID > 0) {
        detail = await wails.getAniListAnimeByID(currentAniListID)
      } else if (anime.title) {
        const search = await wails.searchAniList(anime.title, lang)
        const firstHit = extractAniListAnimeSearchMedia(search)[0] ?? null
        const fallbackAniListID = Number(firstHit?.id || firstHit?.anilist_id || 0)
        if (fallbackAniListID > 0) {
          detail = await wails.getAniListAnimeByID(fallbackAniListID)
        }
      }

      if (!detail) return null
      const rawCharacters = Array.isArray(detail?.characters)
        ? detail.characters
        : Array.isArray(detail?.Characters)
          ? detail.Characters
          : []
      const nextAiringEpisode = detail?.nextAiringEpisode || detail?.next_airing_episode
      const startDate = detail?.startDate || detail?.start_date || null
      const endDate = detail?.endDate || detail?.end_date || null
      return {
        ...(detail ?? {}),
        countryOfOrigin: detail?.countryOfOrigin || detail?.country_of_origin || '',
        averageScore: Number(detail?.averageScore || detail?.average_score || detail?.score || 0),
        seasonYear: Number(detail?.seasonYear || detail?.season_year || 0),
        startDate,
        endDate,
        nextAiringEpisode: nextAiringEpisode ? {
          ...(nextAiringEpisode ?? {}),
          airingAt: Number(nextAiringEpisode?.airingAt || nextAiringEpisode?.airing_at || 0),
          episode: Number(nextAiringEpisode?.episode || 0),
        } : null,
        characters: rawCharacters.map((character) => ({
          id: character?.id ?? character?.ID ?? 0,
          name: character?.name ?? character?.Name ?? '',
          name_native: character?.name_native ?? character?.NameNative ?? '',
          role: character?.role ?? character?.Role ?? '',
          image: character?.image ?? character?.Image ?? '',
        })),
      }
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    enabled: currentAniListID > 0 || Boolean(anime.title),
  })

  const audioVariantProbeSources = new Set(['animegg-en', 'animepahe-en', 'animeav1-es'])
  const canProbeAudioVariants = audioVariantProbeSources.has(anime.source_id)
    && Boolean(sourceAnimeID)
    && Boolean(variantProbeEpisodeID)
    && !isResolvingSource

  const audioVariantsQuery = useQuery({
    queryKey: ['online-audio-variants', anime.source_id, sourceAnimeID, variantProbeEpisodeID],
    queryFn: async () => {
      const variants = await wails.getOnlineAudioVariants(anime.source_id, sourceAnimeID, variantProbeEpisodeID)
      return {
        sub: Boolean(variants?.sub ?? true),
        dub: Boolean(variants?.dub),
      }
    },
    staleTime: 20 * 60_000,
    gcTime: 45 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: canProbeAudioVariants,
  })

  const audioVariantAvailability = audioVariantsQuery.data ?? { sub: true, dub: false }
  const supportsAudioVariants = canProbeAudioVariants
    && !audioVariantsQuery.isLoading
    && Boolean(audioVariantAvailability?.sub)
    && Boolean(audioVariantAvailability?.dub)
  const useAnimeGGExplicitVariant = anime.source_id === 'animegg-en' && supportsAudioVariants && ['sub', 'dub'].includes(activeAudioVariant)

  const persistPreferredAudio = useCallback(async (targetAudio) => {
    const normalized = targetAudio === 'dub' ? 'dub' : 'sub'
    setPreferredAudio(normalized)
    const settings = await wails.getSettings().catch(() => ({}))
    await wails.saveSettings({
      ...settings,
      preferred_audio: normalized,
    }).catch(() => {})
  }, [])

  const persistPreferredPlayerMode = useCallback(async (targetMode) => {
    const normalized = targetMode === 'integrated' ? 'integrated' : 'mpv'
    setPlaybackMode(normalized)
    const settings = await wails.getSettings().catch(() => ({}))
    await wails.saveSettings({
      ...settings,
      player: normalized,
    }).catch(() => {})
  }, [])

  const handleAudioVariantChange = useCallback(async (targetAudio, options = {}) => {
    if (!supportsAudioVariants) return false
    const normalizedTarget = targetAudio === 'dub' ? 'dub' : 'sub'
    const previousAudio = desiredAudioFlavor === 'dub' ? 'dub' : 'sub'

    setDesiredAudioFlavor(normalizedTarget)
    setAudioVariantSwitching(true)

    try {
      await persistPreferredAudio(normalizedTarget)
      if (onAnimeChange) {
        onAnimeChange({
          ...anime,
          audio_variant: normalizedTarget,
        })
      }
      return true
    } catch (error) {
      if (!options.silent) {
        toastError(error?.message ?? ui.audioNoVariant(normalizedTarget === 'dub' ? ui.dubbed : ui.subtitles))
      }
      setDesiredAudioFlavor(previousAudio)
      return false
    } finally {
      setAudioVariantSwitching(false)
    }
  }, [anime, desiredAudioFlavor, onAnimeChange, persistPreferredAudio, supportsAudioVariants, ui])

  useEffect(() => {
    if (!supportsAudioVariants || !onAnimeChange || audioVariantSwitching) return
    const targetAudio = preferredAudio === 'dub' ? 'dub' : 'sub'
    const syncKey = `${anime.source_id}:${sourceAnimeID}:${targetAudio}`
    if (autoVariantSyncKeyRef.current === syncKey) return
    autoVariantSyncKeyRef.current = syncKey
    if (activeAudioVariant === targetAudio) return
    handleAudioVariantChange(targetAudio, { silent: true })
  }, [
    activeAudioVariant,
    audioVariantSwitching,
    anime.source_id,
    handleAudioVariantChange,
    onAnimeChange,
    preferredAudio,
    sourceAnimeID,
    supportsAudioVariants,
  ])

  useEffect(() => {
    if (supportsAudioVariants) return
    if (activeAudioVariant !== 'dub') return
    setDesiredAudioFlavor('sub')
  }, [activeAudioVariant, supportsAudioVariants])

  const episodesQuery = useQuery({
    queryKey: ['online-episodes', anime.source_id, sourceAnimeID, Number(anime.anilist_id || anime.anilistID || 0), Number(anime.episodes_watched || 0)],
    queryFn: async () => {
      const nextEpisodes = await wails.getOnlineEpisodes(anime.source_id, sourceAnimeID, 0)
      const hydratedEpisodes = Array.isArray(anime.prefetchedEpisodes) && anime.prefetchedEpisodes.length > 0
        ? mergeEpisodeArtworkByNumber(nextEpisodes ?? [], anime.prefetchedEpisodes)
        : (nextEpisodes ?? [])

      const watchedFloor = Number(anime.episodes_watched || 0)

      return hydratedEpisodes.map((ep) => ({
        ...ep,
        watched: Boolean(ep.watched) || ((Number(ep.number) || 0) > 0 && (Number(ep.number) || 0) <= watchedFloor),
      }))
    },
    placeholderData: anime.prefetchedEpisodes ?? [],
    staleTime: 15 * 60_000,
    gcTime: 45 * 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    enabled: Boolean(anime.source_id && sourceAnimeID && !isResolvingSource),
  })

  useEffect(() => {
    if (episodesQuery.data) {
      setEpisodes(episodesQuery.data)
    }
  }, [episodesQuery.data])

  useEffect(() => {
    if (!Array.isArray(anime.prefetchedEpisodes) || anime.prefetchedEpisodes.length === 0) return
    setEpisodes((current) => {
      if (!Array.isArray(current) || current.length === 0) return anime.prefetchedEpisodes
      return mergeEpisodeArtworkByNumber(current, anime.prefetchedEpisodes)
    })
  }, [anime.prefetchedEpisodes])

  useEffect(() => {
    if (!Array.isArray(episodes) || episodes.length === 0) return
    if (!hasZeroThumbnailCoverage(episodes)) return
    if (!anime?.title && !anime?.anilist_id && !anime?.anilistID) return

    const enrichmentKey = [
      anime?.source_id || '',
      sourceAnimeID,
      Number(anime?.anilist_id || anime?.anilistID || 0),
      episodes.length,
    ].join(':')

    if (artworkEnrichmentKeyRef.current === enrichmentKey) return
    artworkEnrichmentKeyRef.current = enrichmentKey

    let cancelled = false
    enrichEpisodesWithAnimePaheArtwork(anime, episodes, wails, lang === 'en' ? 'en' : 'es')
      .then((enriched) => {
        if (cancelled || !Array.isArray(enriched)) return
        setEpisodes((current) => mergeEpisodeArtworkByNumber(current, enriched))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [anime, episodes, lang, sourceAnimeID])

  useEffect(() => {
    setEpisodeFilter('unwatched')
  }, [anime.source_id, sourceAnimeID])

  useEffect(() => {
    setStreamFamily('online')
  }, [anime.source_id, sourceAnimeID])

  useEffect(() => {
    setEpisodePage(1)
  }, [episodeFilter, anime.source_id, sourceAnimeID])

  useEffect(() => {
    setShowFullSynopsis(false)
  }, [anime.source_id, sourceAnimeID])

  useEffect(() => {
    if (integratedPlayback?.url || pendingIntegratedEpisode) {
      setWatchState('watch')
      return
    }
    setWatchState('browse')
  }, [integratedPlayback?.url, pendingIntegratedEpisode])

  useEffect(() => {
    setIntegratedPlayback(null)
    setPendingIntegratedEpisode(null)
    autoIntegratedLaunchKeyRef.current = ''
    shouldScrollToPlayerRef.current = false
  }, [anime.source_id, sourceAnimeID])

  useEffect(() => {
    if (isResolvingSource || !sourceAnimeID || anime.source_id !== 'jkanime-es') {
      setSynopsis(anime.description || anime.anilistDescription || '')
      return
    }
    wails.getAnimeSynopsis(anime.source_id, sourceAnimeID)
      .then((syn) => {
        setSynopsis(syn || anime.anilistDescription || anime.description || '')
      })
      .catch(() => {
        setSynopsis(anime.anilistDescription || anime.description || '')
      })
  }, [sourceAnimeID, anime.source_id, anime.anilistDescription, anime.description, isResolvingSource])

  const loading = isResolvingSource || episodesQuery.isLoading
  const error = anime.source_resolve_error || episodesQuery.error?.message || null
  const selectedCharacters = animeDetailQuery.data?.characters ?? []
  const visibleEpisodes = useMemo(() => (
    episodeFilter === 'all'
      ? episodes
      : episodes.filter((ep) => !ep.watched)
  ), [episodeFilter, episodes])
  const episodeWindow = useMemo(() => buildLandingQueueWindow({
    items: visibleEpisodes,
    page: episodePage,
    pageSize: 12,
  }), [episodePage, visibleEpisodes])
  const pagedVisibleEpisodes = episodeWindow.items
  const nextUnwatchedEpisode = episodes.find((ep) => !ep.watched) ?? null
  const replayEpisode = episodes[0] ?? null
  const headlineFacts = [
    anime.year ? String(anime.year) : null,
    episodes.length > 0 ? `${episodes.length} ${t('Episodios')}` : null,
    animeDetailQuery.data?.status || anime.status ? String(animeDetailQuery.data?.status || anime.status).replaceAll('_', ' ') : null,
    animeDetailQuery.data?.genres?.length ? animeDetailQuery.data.genres.slice(0, 3).join(', ') : null,
  ].filter(Boolean)
  const airingRows = [
    animeDetailQuery.data?.status || anime.status ? { label: isEnglish ? 'Status' : 'Estado', value: String(animeDetailQuery.data?.status || anime.status).replaceAll('_', ' ') } : null,
    anime.year ? { label: isEnglish ? 'Year' : 'Ano', value: String(anime.year) } : null,
    episodes.length > 0 ? { label: t('Episodios'), value: String(episodes.length) } : null,
    animeDetailQuery.data?.score ? { label: isEnglish ? 'Score' : 'Puntuacion', value: String(animeDetailQuery.data.score) } : null,
    animeDetailQuery.data?.source ? { label: isEnglish ? 'Source' : 'Origen', value: animeDetailQuery.data.source } : null,
  ].filter(Boolean)
  const watchedCount = episodes.filter((ep) => ep.watched).length
  const progressValue = episodes.length > 0
    ? Math.max(0, Math.min(100, Math.round((watchedCount / episodes.length) * 100)))
    : 0
  useEffect(() => {
    if (!anime.perf_token) return
    if (isResolvingSource) {
      perfMark(anime.perf_token, 'detail-shell-ready', { source_id: anime.source_id || '' })
      return
    }
    if (episodes.length > 0) {
      perfEnd(anime.perf_token, 'detail-ready', { episodes: episodes.length, source_id: anime.source_id || '' })
      return
    }
    if (error) {
      perfEnd(anime.perf_token, 'detail-error', { error })
    }
  }, [anime.perf_token, anime.source_id, episodes.length, error, isResolvingSource])

  const handleIntegratedPlaybackUpdate = useCallback((positionSec, durationSec) => {
    setIntegratedPlayback((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        lastPositionSec: positionSec,
        lastDurationSec: durationSec,
      }
    })
    wails.updateOnlinePlaybackProgress(positionSec, durationSec).catch(() => {})
  }, [])

  const closeIntegratedPlayback = useCallback(async (completed = false, positionSec = null, durationSec = null) => {
    const playback = integratedPlayback
    setIntegratedPlayback(null)
    if (!playback) return

    const finalPosition = positionSec ?? playback.lastPositionSec ?? 0
    const finalDuration = durationSec ?? playback.lastDurationSec ?? 0

    try {
      await wails.finalizeOnlinePlayback(finalPosition, finalDuration, completed)
      if (completed && playback.episodeID) {
        setEpisodes((prev) => prev.map((item) => (
          item.id === playback.episodeID ? { ...item, watched: true } : item
        )))
      }
    } catch {
      // Keep the player flow smooth even if persistence fails.
    }
  }, [integratedPlayback])

  const handleIntegratedPlaybackEnd = useCallback((positionSec, durationSec) => {
    void closeIntegratedPlayback(true, positionSec, durationSec)
  }, [closeIntegratedPlayback])

  const launchEpisode = useCallback(async (ep, modeOverride = null, audioOverride = '') => {
    const openWithAudio = async (targetAudio, allowFallback) => {
      const effectiveMode = (modeOverride ?? playbackMode) === 'integrated' ? 'integrated' : 'mpv'
      const useExplicitVariant = providerUsesExplicitEpisodeAudioVariant(anime.source_id)
        && supportsAudioVariants
        && ['sub', 'dub'].includes(targetAudio)
      const effectiveEpisodeID = useExplicitVariant
        ? `${ep.id}::audio=${targetAudio}`
        : ep.id

      try {
        const playback = await wails.openOnlineEpisode(
          anime.source_id,
          effectiveEpisodeID,
          sourceAnimeID,
          anime.title,
          anime.cover_url ?? '',
          currentAniListID,
          currentMalID,
          ep.number ?? 0,
          ep.title ?? `Episodio ${ep.number}`,
          '',
          effectiveMode,
        )

        if ((playback?.fallback_type === 'integrated' || playback?.player_type === 'integrated') && playback?.fallback_url) {
          setIntegratedPlayback({
            title: anime.title,
            subtitle: ep.title ?? `Ep. ${ep.number}`,
            url: playback.fallback_url,
            rawStreamURL: playback.stream_url ?? '',
            proxyURL: playback.proxy_url ?? playback.fallback_url,
            streamHost: playback.stream_host ?? '',
            kind: playback.stream_kind ?? 'file',
            sourceLabel: source.name,
            episode: ep,
            episodeID: ep.id,
            lastPositionSec: Number(playback.resume_sec || 0),
            lastDurationSec: Number(playback.duration_sec || 0),
          })
          setPendingIntegratedEpisode(null)
          toastSuccess(ui.integratedOpen)
        }
        toastSuccess(ui.openingEpisode(ep.number))
        return true
      } catch (e) {
        const msg = typeof e === 'string'
          ? e
          : (e?.message || e?.toString?.() || 'error desconocido')
        const lower = String(msg).toLowerCase()

        if (allowFallback && supportsAudioVariants) {
          const fallbackAudio = targetAudio === 'dub' ? 'sub' : 'dub'
          const shouldRetryWithFallback = shouldAllowAutomaticAudioFallback({
            sourceID: anime.source_id,
            supportsAudioVariants,
            currentAudio: targetAudio,
            fallbackAudio,
          })
          const fallbackAllowed = fallbackAudio === 'dub'
            ? Boolean(audioVariantAvailability?.dub)
            : Boolean(audioVariantAvailability?.sub)
          if (shouldRetryWithFallback && fallbackAllowed) {
            toastError(
              targetAudio === 'dub'
                ? (isEnglish
                    ? 'Dubbed could not be displayed, falling back to Subtitles.'
                    : 'No se pudo reproducir el doblado, cambiando a Subtítulos.')
                : (isEnglish
                    ? 'Subtitles could not be displayed, falling back to Dubbed.'
                    : 'No se pudo reproducir subtitulado, cambiando a Doblado.'),
            )
            return openWithAudio(fallbackAudio, false)
          }
        }

        if (lower.includes('cloudflare') || lower.includes('challenge') || lower.includes('verification') || lower.includes('bot')) {
          toastError(ui.challengeError)
        } else if (lower.includes('resolver') || lower.includes('embed') || lower.includes('stream')) {
          toastError(ui.resolveError)
        } else if (msg.includes('requires MPV') || msg.includes('external player is unavailable')) {
          toastError(ui.mpvMissing)
        } else {
          toastError(ui.playError(msg))
        }
        if (effectiveMode === 'integrated') {
          setPendingIntegratedEpisode(null)
        }
        return false
      }
    }

    setStreaming(ep.id)
    try {
      const preferredLaunchAudio = audioOverride === 'dub'
        ? 'dub'
        : audioOverride === 'sub'
          ? 'sub'
          : activeAudioVariant
      await openWithAudio(preferredLaunchAudio, supportsAudioVariants)
    } finally {
      setStreaming(null)
    }
  }, [activeAudioVariant, anime, audioVariantAvailability?.dub, audioVariantAvailability?.sub, currentAniListID, currentMalID, isEnglish, playbackMode, source.name, sourceAnimeID, supportsAudioVariants, ui.challengeError, ui.integratedOpen, ui.mpvMissing, ui.openingEpisode, ui.playError, ui.resolveError])

  const handleStream = useCallback(async (ep) => {
    if (streamFamily === 'torrent') {
      toastError(ui.torrentUnavailable)
      return
    }
    await launchEpisode(ep)
  }, [launchEpisode, streamFamily, ui.torrentUnavailable])

  const handleStreamFamilyChange = useCallback(async (targetFamily) => {
    const normalized = targetFamily === 'torrent' ? 'torrent' : 'online'
    setStreamFamily(normalized)

    if (normalized !== 'online') {
      setPendingIntegratedEpisode(null)
      if (integratedPlayback?.url) {
        await closeIntegratedPlayback(false)
      }
    }
  }, [closeIntegratedPlayback, integratedPlayback?.url])

  const handlePlayerModeChange = useCallback(async (targetMode) => {
    const normalized = targetMode === 'integrated' ? 'integrated' : 'mpv'
    await persistPreferredPlayerMode(normalized)

    if (normalized === 'integrated') {
      if (integratedPlayback?.url || pendingIntegratedEpisode) return
      const episode = nextUnwatchedEpisode ?? replayEpisode
      if (!episode) return
      shouldScrollToPlayerRef.current = true
      setPendingIntegratedEpisode(episode)
      const launched = await launchEpisode(episode, 'integrated')
      if (!launched) {
        setPendingIntegratedEpisode(null)
      }
      return
    }

    setPendingIntegratedEpisode(null)
    if (integratedPlayback?.url) {
      await closeIntegratedPlayback(false)
    }
  }, [closeIntegratedPlayback, integratedPlayback?.url, launchEpisode, nextUnwatchedEpisode, pendingIntegratedEpisode, persistPreferredPlayerMode, replayEpisode])

  const handleUseExternalPlayer = useCallback(async () => {
    const playback = integratedPlayback
    if (!playback?.episode) return

    await closeIntegratedPlayback(false)
    await launchEpisode(playback.episode, 'mpv')
  }, [closeIntegratedPlayback, integratedPlayback, launchEpisode])

  const currentIntegratedEpisodeIndex = integratedPlayback?.episodeID
    ? episodes.findIndex((item) => item.id === integratedPlayback.episodeID)
    : -1
  const previousIntegratedEpisode = currentIntegratedEpisodeIndex > 0 ? episodes[currentIntegratedEpisodeIndex - 1] : null
  const nextIntegratedEpisode = currentIntegratedEpisodeIndex >= 0 ? episodes[currentIntegratedEpisodeIndex + 1] ?? null : null

  const handleIntegratedEpisodeJump = useCallback(async (targetEpisode) => {
    if (!targetEpisode) return
    await closeIntegratedPlayback(false)
    await launchEpisode(targetEpisode, 'integrated')
  }, [closeIntegratedPlayback, launchEpisode])

  const handleIntegratedAudioSwitch = useCallback(async (targetAudio) => {
    const playback = integratedPlayback
    if (!playback?.episode || audioVariantSwitching || !supportsAudioVariants) return
    const normalizedTarget = targetAudio === 'dub' ? 'dub' : 'sub'
    if (normalizedTarget === activeAudioVariant) return
    const switched = await handleAudioVariantChange(normalizedTarget)
    if (!switched) return
    await closeIntegratedPlayback(false)
    await launchEpisode(playback.episode, 'integrated', normalizedTarget)
  }, [activeAudioVariant, audioVariantSwitching, closeIntegratedPlayback, handleAudioVariantChange, integratedPlayback, launchEpisode, supportsAudioVariants])

  const handleDownload = useCallback(async (ep) => {
    setDownloading(ep.id)
    try {
      await persistPreferredAudio(activeAudioVariant)
      const effectiveEpisodeID = useAnimeGGExplicitVariant
        ? `${ep.id}::audio=${activeAudioVariant}`
        : ep.id
      const links = await wails.getDownloadLinks(anime.source_id, effectiveEpisodeID)
      if (!links || links.length === 0) {
        const message = t('No hay links de descarga disponibles para este episodio')
        toastError(message)
        await wails.notifyDesktop('Nipah! Anime', `Download failed: ${message}`).catch(() => {})
        return
      }

      const link = links[0]
      await wails.startDownload(
        link.url,
        anime.title,
        ep.number ?? 0,
        ep.title ?? `Episodio ${ep.number}`,
        anime.anilistCoverImage || anime.cover_url || '',
        link.referer ?? '',
        link.cookie ?? '',
      )
      toastSuccess(`${t('Descarga iniciada')}: Ep. ${ep.number} (${link.host})`)
    } catch (e) {
      const msg = e?.message ?? 'error desconocido'
      toastError(`${t('Error al descargar')}: ${msg}`)
      await wails.notifyDesktop('Nipah! Anime', `Download failed: ${msg}`).catch(() => {})
    } finally {
      setDownloading(null)
    }
  }, [activeAudioVariant, anime, persistPreferredAudio, t, useAnimeGGExplicitVariant])

  const animeDetail = animeDetailQuery.data
  const titleEnglish = animeDetail?.title_english || anime.title_english || anime.titleEnglish || anime.title || anime.anime_title || ''
  const titleNative = animeDetail?.title_native || anime.title_native || anime.titleNative || ''
  const canAddToList = currentAniListID > 0 && !anime.in_anime_list && !anime.in_list && !anime.anime_list_status
  const factsInline = headlineFacts.filter(Boolean)
  const airingInfoRows = [
    nextUnwatchedEpisode
      ? {
          label: isEnglish ? 'Next Episode' : 'Siguiente episodio',
          value: nextUnwatchedEpisode.title ?? `${t('Episodio')} ${nextUnwatchedEpisode.number}`,
          note: nextUnwatchedEpisode.number ? `${t('Episodio')} ${nextUnwatchedEpisode.number}` : '',
        }
      : replayEpisode
        ? {
            label: isEnglish ? 'Replay from' : 'Repetir desde',
            value: replayEpisode.title ?? `${t('Episodio')} ${replayEpisode.number}`,
            note: replayEpisode.number ? `${t('Episodio')} ${replayEpisode.number}` : '',
          }
        : null,
    animeDetail?.nextAiringEpisode?.airingAt ? { label: isEnglish ? 'Airing schedule' : 'Horario de estreno', value: new Date(animeDetail.nextAiringEpisode.airingAt * 1000).toLocaleString(isEnglish ? 'en-US' : 'es-CL') } : null,
    animeDetail?.nextAiringEpisode?.episode ? { label: isEnglish ? 'Upcoming' : 'Proximo', value: `${t('Episodio')} ${animeDetail.nextAiringEpisode.episode}` } : null,
    { label: isEnglish ? 'Watch on' : 'Ver en', value: source.name, note: supportsDownloads ? ui.streamingDownload : ui.streamingOnly },
  ].filter(Boolean)
  const detailRows = [
    { label: isEnglish ? 'Japanese title' : 'Titulo japones', value: titleNative || '-' },
    { label: isEnglish ? 'Also known as' : 'Tambien conocido como', value: titleEnglish || '-' },
    { label: isEnglish ? 'Source' : 'Fuente', value: source.name },
    { label: isEnglish ? 'Format' : 'Formato', value: String(animeDetail?.format || anime.format || anime.type || 'TV Series').replaceAll('_', ' ') },
    { label: isEnglish ? 'Season' : 'Temporada', value: animeDetail?.season && anime.year ? `${animeDetail.season} ${anime.year}` : anime.year ? String(anime.year) : '-' },
    { label: isEnglish ? 'Status' : 'Estado', value: String(animeDetail?.status || anime.status || '-').replaceAll('_', ' ') },
    { label: isEnglish ? 'Episodes' : 'Episodios', value: episodes.length ? String(episodes.length) : String(animeDetail?.episodes || '-') },
    { label: isEnglish ? 'Episode duration' : 'Duracion', value: animeDetail?.duration ? `${animeDetail.duration} min` : '-' },
    { label: isEnglish ? 'Rating' : 'Clasificacion', value: animeDetail?.rating || '-' },
    { label: isEnglish ? 'Studio' : 'Estudio', value: animeDetail?.studio || animeDetail?.studios?.[0]?.name || '-' },
  ]
  const moreInfoRows = [
    animeDetail?.startDate?.year ? { label: isEnglish ? 'Premiered' : 'Estreno', value: `${animeDetail.startDate.day || 1}/${animeDetail.startDate.month || 1}/${animeDetail.startDate.year}` } : null,
    animeDetail?.countryOfOrigin ? { label: isEnglish ? 'Country' : 'Pais', value: animeDetail.countryOfOrigin } : null,
    animeDetail?.source ? { label: isEnglish ? 'Origin' : 'Origen', value: animeDetail.source } : null,
    animeDetail?.averageScore ? { label: isEnglish ? 'Score' : 'Puntuacion', value: `${animeDetail.averageScore}` } : null,
    animeDetail?.genres?.length ? { label: isEnglish ? 'Genres' : 'Generos', value: animeDetail.genres.join(', ') } : null,
  ].filter(Boolean)
  const streamFamilyOptions = [
    { value: 'online', label: ui.onlineStreaming, active: streamFamily === 'online', disabled: false },
    { value: 'torrent', label: ui.torrentStreaming, active: streamFamily === 'torrent', disabled: false },
  ]
  const playbackModeOptions = [
    { value: 'mpv', label: ui.mpvMode, active: playbackMode === 'mpv' },
    { value: 'integrated', label: ui.integratedMode, active: playbackMode === 'integrated' },
  ]
  const explicitRecommendationItems = useMemo(() => {
    const rawGroups = [
      animeDetail?.recommendations,
      animeDetail?.related_recommendations,
    ]
    const normalized = rawGroups
      .flatMap((group) => Array.isArray(group) ? group : [])
      .map((item, index) => {
        const title = getAnimeRecommendationTitle(item)
        if (!title) return null

        const keyParts = [
          item?.id,
          item?.media?.id,
          item?.node?.id,
          item?.mal_id,
          item?.source_id,
          item?.slug,
          item?.url,
          title,
          index,
        ].filter(Boolean)

        return {
          key: keyParts.join(':'),
          title,
          image: getAnimeRecommendationImage(item),
          eyebrow: isEnglish ? 'Related anime' : 'Anime relacionado',
          subtitle: getAnimeRecommendationSubtitle(item),
          navigationEntry: buildAnimeRecommendationNavigationEntry(item),
        }
      })
      .filter(Boolean)

    return Array.from(new Map(normalized.map((item) => [item.key, item])).values()).slice(0, 6)
  }, [animeDetail?.recommendations, animeDetail?.related_recommendations])
  const recommendationItems = useMemo(() => {
    return explicitRecommendationItems.slice(0, 6)
  }, [explicitRecommendationItems])
  const activeWatchEpisode = integratedPlayback?.episode ?? pendingIntegratedEpisode
  const integratedEpisodeNumber = Number(activeWatchEpisode?.number || 0)
  const integratedPlayerTitle = anime.anime_title || anime.title
  const integratedPlayerEpisodeLabel = integratedEpisodeNumber > 0
    ? `${isEnglish ? 'Episode' : 'Episodio'} ${integratedEpisodeNumber}`
    : (activeWatchEpisode?.title || integratedPlayback?.subtitle || (isEnglish ? 'Episode' : 'Episodio'))
  const isWatchState = watchState === 'watch'
  const showIntegratedWatchState = isWatchState && Boolean(integratedPlayback?.url || pendingIntegratedEpisode)
  const heroPrimaryEpisode = nextUnwatchedEpisode ?? replayEpisode
  const heroPrimaryLabel = nextUnwatchedEpisode
    ? (watchedCount > 0
        ? ui.continueLabel
        : (isEnglish
            ? `Play S1 E${nextUnwatchedEpisode.number || 1}`
            : `Ver T1 E${nextUnwatchedEpisode.number || 1}`))
    : replayEpisode
      ? ui.watchAgain
      : ''

  useEffect(() => {
    if (playbackMode !== 'integrated') return
    if (streamFamily !== 'online') return
    if (integratedPlayback?.url || pendingIntegratedEpisode) return
    if (loading || isResolvingSource || error) return
    const episode = nextUnwatchedEpisode ?? replayEpisode
    if (!episode) return

    const autoLaunchKey = `${anime.source_id}:${sourceAnimeID}:${episode.id}:${playbackMode}`
    if (autoIntegratedLaunchKeyRef.current === autoLaunchKey) return
    autoIntegratedLaunchKeyRef.current = autoLaunchKey
    shouldScrollToPlayerRef.current = true
    setPendingIntegratedEpisode(episode)
    void launchEpisode(episode, 'integrated').then((launched) => {
      if (!launched) {
        setPendingIntegratedEpisode(null)
      }
    })
  }, [
    anime.source_id,
    error,
    integratedPlayback?.url,
    isResolvingSource,
    launchEpisode,
    loading,
    nextUnwatchedEpisode,
    pendingIntegratedEpisode,
    playbackMode,
    replayEpisode,
    sourceAnimeID,
    streamFamily,
  ])

  useEffect(() => {
    if (!showIntegratedWatchState) return
    if (!shouldScrollToPlayerRef.current) return
    const target = playerStageRef.current
    if (!target) return
    shouldScrollToPlayerRef.current = false
    let cancelled = false

    const runScroll = () => {
      if (cancelled) return
      const liveTarget = playerStageRef.current
      if (!liveTarget) return
      const scroller = liveTarget.closest('.gui2-content')
      if (scroller && 'scrollTo' in scroller) {
        const scrollerRect = scroller.getBoundingClientRect()
        const targetRect = liveTarget.getBoundingClientRect()
        const top = scroller.scrollTop + (targetRect.top - scrollerRect.top) - 24
        scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        return
      }
      liveTarget.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    const timeoutId = window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(runScroll)
      })
    }, 90)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [showIntegratedWatchState, integratedPlayback?.url, pendingIntegratedEpisode])

  useEffect(() => {
    if (episodeWindow.currentPage !== episodePage) {
      setEpisodePage(episodeWindow.currentPage)
    }
  }, [episodePage, episodeWindow.currentPage])

  const handleAddToList = useCallback(async () => {
    if (!canAddToList || addingToList) return
    setAddingToList(true)
    try {
      const result = await wails.addToAnimeList(
        currentAniListID,
        currentMalID,
        anime.anime_title || anime.title || titleEnglish,
        titleEnglish || anime.title || anime.anime_title || '',
        anime.anilistCoverImage || anime.cover_url || '',
        'WATCHING',
        watchedCount,
        Number(animeDetail?.episodes || episodes.length || 0),
        0,
        animeDetail?.status || anime.status || '',
        Number(anime.year || animeDetail?.seasonYear || 0),
      )
      if (result?.remote_failed > 0) {
        toastError(result.messages?.join(' ') || (isEnglish ? 'AniList sync failed' : 'Fallo la sincronizacion con AniList'))
      } else {
        toastSuccess(isEnglish ? 'Added to your anime list' : 'Agregado a tu lista de anime')
      }
      onAnimeChange?.({
        ...anime,
        in_anime_list: true,
        anime_list_status: 'WATCHING',
      })
    } catch (error) {
      toastError(`${isEnglish ? 'Could not add to your list' : 'No se pudo agregar a tu lista'}: ${error?.message ?? 'error'}`)
    } finally {
      setAddingToList(false)
    }
  }, [addingToList, anime, animeDetail?.episodes, animeDetail?.seasonYear, animeDetail?.status, canAddToList, currentAniListID, currentMalID, episodes.length, isEnglish, onAnimeChange, titleEnglish, watchedCount])

  return (
    <div
      className="fade-in media-detail-page media-detail-page--online gui2-landing-page gui2-landing-page--anime gui2-motion-enter"
      style={buildMotionVars('page')}
    >
      <section
        className={`gui2-landing-hero gui2-landing-hero-premium${watchState === 'watch' ? ' gui2-landing-hero--watch' : ''}`}
        style={backdropSrc ? {
          '--gui2-landing-backdrop-image': `url(${backdropSrc})`,
        } : undefined}
      >
        <div className="gui2-landing-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={onBack}>
            {isEnglish ? 'Back to catalog' : 'Volver al catalogo'}
          </button>
        </div>

        <div className={`gui2-landing-hero-grid gui2-landing-hero-grid--anime${coverSrc ? '' : ' gui2-landing-hero-grid--coverless'}${showIntegratedWatchState ? ' gui2-landing-hero-grid--watch' : ''}`}>
          {coverSrc ? (
            <div className={`gui2-landing-cover-wrap${showIntegratedWatchState ? ' gui2-landing-cover-wrap--watch' : ''}`}>
              <img src={coverSrc} alt={anime.title} className="gui2-landing-cover gui2-landing-cover--round" onError={handleProviderCoverError} />
            </div>
          ) : null}

          <div className="gui2-landing-copy">
            <div className="gui2-landing-kicker">{t('Anime')}</div>
            <h1 className="gui2-landing-title">{anime.anime_title || anime.title}</h1>
            {!showIntegratedWatchState && titleNative ? <div className="gui2-landing-subtitle">{titleNative}</div> : null}
            {!showIntegratedWatchState && factsInline.length > 0 ? (
              <div className="gui2-landing-facts-inline">
                {factsInline.map((fact, index) => (
                  <span key={`${fact}-${index}`} className="gui2-landing-inline-fact">{fact}</span>
                ))}
              </div>
            ) : null}
            {synopsisPreview ? (
              <div className="gui2-landing-story-wrap">
                <p className="gui2-landing-story">{synopsisPreview}</p>
                {cleanSynopsis.length > 220 ? (
                  <button
                    className="gui2-landing-story-toggle"
                    type="button"
                    onClick={() => setShowFullSynopsis((current) => !current)}
                  >
                    {showFullSynopsis ? ui.readLess : ui.readMore}
                  </button>
                ) : null}
              </div>
            ) : null}

            {!showIntegratedWatchState ? (
              <div className="gui2-landing-actions">
                {heroPrimaryEpisode ? (
                  <button className="btn btn-primary gui2-landing-primary-btn" type="button" onClick={() => handleStream(heroPrimaryEpisode)} disabled={streamFamily === 'torrent' || streaming === heroPrimaryEpisode.id}>
                    {heroPrimaryLabel}
                  </button>
                ) : null}
                {nextUnwatchedEpisode && watchedCount > 0 ? (
                  <button className="btn btn-ghost gui2-landing-secondary-btn" type="button" onClick={() => handleStream(nextUnwatchedEpisode)} disabled={streamFamily === 'torrent' || streaming === nextUnwatchedEpisode.id}>
                    {`${watchedCount}/${episodes.length} ${isEnglish ? 'watched' : 'vistos'}`}
                    <span className="gui2-landing-inline-progress">
                      <span className="gui2-landing-inline-progress-fill" style={{ width: `${progressValue}%` }} />
                    </span>
                  </button>
                ) : null}
                {canAddToList ? (
                  <button className="btn btn-ghost gui2-landing-secondary-btn" type="button" onClick={handleAddToList} disabled={addingToList}>
                    {addingToList ? (isEnglish ? 'Adding...' : 'Agregando...') : (isEnglish ? 'Add to List' : 'Agregar a lista')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

        </div>
      </section>

      <div className={`gui2-landing-workspace${isWatchState ? ' gui2-landing-workspace--watch' : ''}`}>
        <div className="gui2-landing-main">
          {showIntegratedWatchState ? (
            <>
              <AnimeLandingCharacterStrip
                characters={selectedCharacters}
                loading={animeDetailQuery.isLoading}
                loadingLabel={ui.castLoading}
                emptyLabel={ui.castEmpty}
                title={ui.castTitle}
                ui={ui}
                className="gui2-landing-watch-cast"
              />

              <section
                ref={playerStageRef}
                className={`gui2-online-player-page${isWatchState ? ' gui2-online-player-page--active' : ''}`}
              >
                {showIntegratedWatchState ? (
                  <>
                    <section className="gui2-landing-panel gui2-landing-watch-tools">
                      <div className="gui2-landing-section-head gui2-landing-section-head--split">
                        <h3 className="gui2-landing-section-title">{ui.episodeQueue}</h3>
                        <div className="gui2-landing-section-tools gui2-landing-section-tools--wrap">
                          <div className="gui2-landing-tool-group gui2-landing-tool-group--stream">
                            <span className="gui2-landing-tool-label">{ui.sourceAccess}</span>
                            <div className="gui2-landing-family-toggle" aria-label={ui.sourceAccess}>
                              {streamFamilyOptions.map((family) => (
                                <button
                                  key={family.value}
                                  type="button"
                                  className={`gui2-landing-family-btn${family.active ? ' active' : ''}`}
                                  disabled={family.disabled}
                                  onClick={() => handleStreamFamilyChange(family.value)}
                                >
                                  {family.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="gui2-landing-tool-group gui2-landing-tool-group--playback">
                            <span className="gui2-landing-tool-label">{ui.playbackMode}</span>
                            <div className="episode-playback-switch gui2-landing-playback-toggle" aria-label={ui.playbackMode}>
                              {playbackModeOptions.map((option) => (
                                <button
                                  key={option.value}
                                  className={`episode-playback-pill${option.active ? ' active' : ''}`}
                                  type="button"
                                  onClick={() => handlePlayerModeChange(option.value)}
                                  title={option.value === 'integrated' ? ui.integratedModeDesc : ui.mpvModeDesc}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {supportsAudioVariants ? (
                            <div className="episode-audio-toolbar episode-audio-toolbar--inline gui2-landing-audio-toolbar gui2-landing-tool-group">
                              <span className="episode-audio-toolbar-label">{ui.audioTrack}</span>
                              <div className="episode-playback-switch" style={{ flexShrink: 0 }}>
                                <button
                                  className={`episode-playback-pill${activeAudioVariant === 'sub' ? ' active' : ''}`}
                                  type="button"
                                  disabled={audioVariantSwitching}
                                  onClick={() => handleAudioVariantChange('sub')}
                                  title={audioVariantSwitching ? ui.audioLoading : ui.subtitles}
                                >
                                  {ui.subtitles}
                                </button>
                                <button
                                  className={`episode-playback-pill${activeAudioVariant === 'dub' ? ' active' : ''}`}
                                  type="button"
                                  disabled={audioVariantSwitching}
                                  onClick={() => handleAudioVariantChange('dub')}
                                  title={audioVariantSwitching ? ui.audioLoading : ui.dubbed}
                                >
                                  {ui.dubbed}
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {episodes.length > 0 ? <span className="gui2-landing-count">{visibleEpisodes.length}/{episodes.length}</span> : null}
                        </div>
                      </div>
                    </section>

                    <div className="gui2-online-player-copy">
                      <p className="gui2-online-player-episode">{ui.currentlyPlaying}</p>
                      <h2 className="gui2-online-player-title">{integratedPlayerEpisodeLabel}</h2>
                    </div>

                    {integratedPlayback?.url ? (
                      <IntegratedVideoPlayer
                        open={Boolean(integratedPlayback?.url)}
                        title={integratedPlayback?.title}
                        subtitle={integratedPlayback?.subtitle}
                        streamURL={integratedPlayback?.url}
                        rawStreamURL={integratedPlayback?.rawStreamURL}
                        proxyURL={integratedPlayback?.proxyURL}
                        streamHost={integratedPlayback?.streamHost}
                        streamKind={integratedPlayback?.kind}
                        sourceLabel={integratedPlayback?.sourceLabel}
                        initialPositionSec={integratedPlayback?.lastPositionSec ?? 0}
                        onPlaybackUpdate={handleIntegratedPlaybackUpdate}
                        onPlaybackEnd={handleIntegratedPlaybackEnd}
                        onUseExternalPlayer={handleUseExternalPlayer}
                        onPrev={previousIntegratedEpisode ? () => handleIntegratedEpisodeJump(previousIntegratedEpisode) : null}
                        prevLabel={ui.previousEpisode}
                        audioLabel={ui.audioTrack}
                        activeAudio={activeAudioVariant}
                        audioSwitching={audioVariantSwitching}
                        audioOptions={supportsAudioVariants ? [
                          { value: 'sub', label: ui.subtitles },
                          { value: 'dub', label: ui.dubbed },
                        ] : []}
                        onAudioChange={supportsAudioVariants ? handleIntegratedAudioSwitch : null}
                        presentation="gui2-page"
                        onClose={() => closeIntegratedPlayback(false)}
                      />
                    ) : (
                      <div className="gui2-online-player-loading">
                        <div className="gui2-online-player-loading-spinner" aria-hidden="true" />
                        <div className="gui2-online-player-loading-copy">{ui.preparingIntegrated}</div>
                      </div>
                    )}
                  </>
                ) : null}
              </section>

              <section className="gui2-landing-panel gui2-landing-watchnav">
                <div className="gui2-landing-section-head gui2-landing-section-head--split gui2-landing-watchnav-head">
                  <h3 className="gui2-landing-section-title">{ui.moreEpisodes}</h3>
                  {episodeWindow.showPagination ? (
                    <div className="gui2-landing-queue-pagination" aria-label={isEnglish ? 'Episode pages' : 'Paginas de episodios'}>
                      <button
                        type="button"
                        className="gui2-landing-pagechip"
                        onClick={() => setEpisodePage((page) => Math.max(1, page - 1))}
                        disabled={episodeWindow.currentPage <= 1}
                        aria-label={isEnglish ? 'Previous episode page' : 'Pagina anterior'}
                      >
                        {isEnglish ? 'Prev' : 'Anterior'}
                      </button>
                      {episodeWindow.pageChips.map((pageNumber) => (
                        <button
                          key={`episode-page-${pageNumber}`}
                          type="button"
                          className={`gui2-landing-pagechip${pageNumber === episodeWindow.currentPage ? ' active' : ''}`}
                          onClick={() => setEpisodePage(pageNumber)}
                          aria-current={pageNumber === episodeWindow.currentPage ? 'page' : undefined}
                        >
                          {pageNumber}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="gui2-landing-pagechip"
                        onClick={() => setEpisodePage((page) => Math.min(episodeWindow.totalPages, page + 1))}
                        disabled={episodeWindow.currentPage >= episodeWindow.totalPages}
                        aria-label={isEnglish ? 'Next episode page' : 'Pagina siguiente'}
                      >
                        {isEnglish ? 'Next' : 'Siguiente'}
                      </button>
                    </div>
                  ) : null}
                </div>
                {visibleEpisodes.length > 0 ? (
                  <div className="gui2-landing-watchnav-grid">
                    {pagedVisibleEpisodes.map((ep) => {
                      const artSrc = getEpisodeArtwork(ep)
                      const isActive = integratedPlayback?.episodeID === ep.id
                      return (
                        <OnlineEpisodeWatchCard
                          key={ep.id}
                          ep={ep}
                          artSrc={artSrc}
                          sourceName={source.name}
                          isActive={isActive}
                          onSelect={handleIntegratedEpisodeJump}
                          labels={ui}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="empty-state manga-filter-empty-state">
                    <div className="empty-state-title">{ui.episodeFilterEmpty}</div>
                    <p className="empty-state-desc">{ui.episodeFilterEmptyDesc}</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <section className="gui2-landing-panel gui2-landing-panel--progression">
                <AnimeLandingFactList rows={airingInfoRows} />
              </section>

              <AnimeLandingCharacterStrip
                characters={selectedCharacters}
                loading={animeDetailQuery.isLoading}
                loadingLabel={ui.castLoading}
                emptyLabel={ui.castEmpty}
                title={ui.castTitle}
                ui={ui}
              />

              <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head gui2-landing-section-head--split">
              <h3 className="gui2-landing-section-title">{ui.episodeQueue}</h3>
              <div className="gui2-landing-section-tools gui2-landing-section-tools--wrap">
                <div className="gui2-landing-tool-group gui2-landing-tool-group--stream">
                  <span className="gui2-landing-tool-label">{ui.sourceAccess}</span>
                  <div className="gui2-landing-family-toggle" aria-label={ui.sourceAccess}>
                    {streamFamilyOptions.map((family) => (
                      <button
                        key={family.value}
                        type="button"
                        className={`gui2-landing-family-btn${family.active ? ' active' : ''}`}
                        disabled={family.disabled}
                        onClick={() => handleStreamFamilyChange(family.value)}
                      >
                        {family.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gui2-landing-tool-group gui2-landing-tool-group--playback">
                  <span className="gui2-landing-tool-label">{ui.playbackMode}</span>
                  <div className="episode-playback-switch gui2-landing-playback-toggle" aria-label={ui.playbackMode}>
                    {playbackModeOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`episode-playback-pill${option.active ? ' active' : ''}`}
                        type="button"
                        onClick={() => handlePlayerModeChange(option.value)}
                        title={option.value === 'integrated' ? ui.integratedModeDesc : ui.mpvModeDesc}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {supportsAudioVariants ? (
                  <div className="episode-audio-toolbar episode-audio-toolbar--inline gui2-landing-audio-toolbar gui2-landing-tool-group">
                    <span className="episode-audio-toolbar-label">{ui.audioTrack}</span>
                    <div className="episode-playback-switch" style={{ flexShrink: 0 }}>
                      <button
                        className={`episode-playback-pill${activeAudioVariant === 'sub' ? ' active' : ''}`}
                        type="button"
                        disabled={audioVariantSwitching}
                        onClick={() => handleAudioVariantChange('sub')}
                        title={audioVariantSwitching ? ui.audioLoading : ui.subtitles}
                      >
                        {ui.subtitles}
                      </button>
                      <button
                        className={`episode-playback-pill${activeAudioVariant === 'dub' ? ' active' : ''}`}
                        type="button"
                        disabled={audioVariantSwitching}
                        onClick={() => handleAudioVariantChange('dub')}
                        title={audioVariantSwitching ? ui.audioLoading : ui.dubbed}
                      >
                        {ui.dubbed}
                      </button>
                    </div>
                  </div>
                ) : null}
                {episodes.length > 0 ? <span className="gui2-landing-count">{visibleEpisodes.length}/{episodes.length}</span> : null}
                <div className="manga-filter-toggle" role="tablist" aria-label={t('Episodios')}>
                  <button
                    type="button"
                    className={`manga-filter-toggle-btn${episodeFilter === 'unwatched' ? ' active' : ''}`}
                    onClick={() => setEpisodeFilter('unwatched')}
                  >
                    {ui.unwatchedEpisodes}
                  </button>
                  <button
                    type="button"
                    className={`manga-filter-toggle-btn${episodeFilter === 'all' ? ' active' : ''}`}
                    onClick={() => setEpisodeFilter('all')}
                  >
                    {ui.allEpisodes}
                  </button>
                </div>
              </div>
            </div>

            {loading ? <EpisodeGridSkeleton count={6} /> : null}

            {!loading && error ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-state-title">{ui.resolveError}</div>
                <p className="empty-state-desc">{String(error)}</p>
              </div>
            ) : null}

            {!loading && !error ? (
              streamFamily === 'torrent' ? (
                <div className="empty-state manga-filter-empty-state">
                  <div className="empty-state-title">{ui.torrentQueueEmpty}</div>
                  <p className="empty-state-desc">{ui.torrentQueueCopy}</p>
                </div>
              ) : visibleEpisodes.length > 0 ? (
                <div className="gui2-landing-episode-list gui2-landing-episodes-mediafirst">
                  {pagedVisibleEpisodes.map((ep) => {
                    const isStreaming = streaming === ep.id
                    const isDownloading = downloading === ep.id
                    const artSrc = getEpisodeArtwork(ep)
                    return (
                      <OnlineEpisodeRow
                        key={ep.id}
                        ep={ep}
                        totalEpisodes={episodes.length}
                        artSrc={artSrc}
                        sourceName={source.name}
                        supportsDownloads={supportsDownloads}
                        isStreaming={isStreaming}
                        isDownloading={isDownloading}
                        onWatch={handleStream}
                        onDownload={handleDownload}
                        labels={ui}
                      />
                    )
                  })}
                  {episodeWindow.showPagination ? (
                    <div className="gui2-landing-queue-pagination" aria-label={isEnglish ? 'Episode pages' : 'Paginas de episodios'}>
                      <button
                        type="button"
                        className="gui2-landing-pagechip"
                        onClick={() => setEpisodePage((page) => Math.max(1, page - 1))}
                        disabled={episodeWindow.currentPage <= 1}
                        aria-label={isEnglish ? 'Previous episode page' : 'Pagina anterior'}
                      >
                        {isEnglish ? 'Prev' : 'Anterior'}
                      </button>
                      {episodeWindow.pageChips.map((pageNumber) => (
                        <button
                          key={`episode-page-${pageNumber}`}
                          type="button"
                          className={`gui2-landing-pagechip${pageNumber === episodeWindow.currentPage ? ' active' : ''}`}
                          onClick={() => setEpisodePage(pageNumber)}
                          aria-current={pageNumber === episodeWindow.currentPage ? 'page' : undefined}
                        >
                          {pageNumber}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="gui2-landing-pagechip"
                        onClick={() => setEpisodePage((page) => Math.min(episodeWindow.totalPages, page + 1))}
                        disabled={episodeWindow.currentPage >= episodeWindow.totalPages}
                        aria-label={isEnglish ? 'Next episode page' : 'Pagina siguiente'}
                      >
                        {isEnglish ? 'Next' : 'Siguiente'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state manga-filter-empty-state">
                  <div className="empty-state-title">{ui.episodeFilterEmpty}</div>
                  <p className="empty-state-desc">{ui.episodeFilterEmptyDesc}</p>
                </div>
              )
            ) : null}
              </section>
            </>
          )}
        </div>

        {!showIntegratedWatchState ? (
          <aside className="gui2-landing-aside">
            <AnimeLandingMetaPanel title={isEnglish ? 'Details' : 'Detalles'} rows={detailRows} />
            <AnimeLandingMetaPanel title={isEnglish ? 'More Info' : 'Mas informacion'} rows={moreInfoRows} />
          </aside>
        ) : null}
      </div>

      <LandingRecommendationsStage
        title={ui.recommendationsTitle}
        copy={ui.recommendationsCopy}
        items={recommendationItems}
        onSelectItem={onRecommendationSelect}
        emptyCopy={ui.recommendationsEmptyCopy}
        placeholderCount={5}
      />
    </div>
  )

}

function AnimeLandingFactList({ rows }) {
  const items = rows.filter((row) => row?.label && row?.value)
  if (!items.length) return null
  return (
    <div className="gui2-landing-fact-band">
      {items.map((row) => (
        <div key={`${row.label}-${row.value}`} className="gui2-landing-fact-item">
          <span className="gui2-landing-fact-label">{row.label}</span>
          <strong className="gui2-landing-fact-value">{row.value}</strong>
          {row.note ? <span className="gui2-landing-fact-note">{row.note}</span> : null}
        </div>
      ))}
    </div>
  )
}

function AnimeLandingMetaPanel({ title, rows }) {
  const items = rows.filter((row) => row?.label && row?.value)
  if (!items.length) return null
  return (
    <section className="gui2-landing-panel gui2-landing-meta-panel">
      <div className="gui2-landing-section-head">
        <h3 className="gui2-landing-section-title">{title}</h3>
      </div>
      <div className="gui2-landing-meta-list">
        {items.map((row) => (
          <div key={`${title}-${row.label}`} className="gui2-landing-meta-row">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function AnimeLandingCharacterStrip({ characters, loading, loadingLabel, emptyLabel, title, ui, className = '' }) {
  return (
    <section className={`gui2-landing-panel${className ? ` ${className}` : ''}`}>
      <div className="gui2-landing-section-head">
        <h3 className="gui2-landing-section-title">{title}</h3>
      </div>
      {loading ? (
        <div className="media-detail-empty-copy">{loadingLabel}</div>
      ) : characters.length > 0 ? (
        <div className="gui2-landing-character-strip">
          {characters.map((character) => (
            <article key={`${character.id || character.name}-${character.role || ''}`} className="gui2-landing-character-card">
              {character.image ? (
                <img src={proxyImage(character.image)} alt={character.name} className="gui2-landing-character-art" />
              ) : (
                <div className="gui2-landing-character-art gui2-landing-character-art--placeholder">
                  {character.name?.slice(0, 1) || '?'}
                </div>
              )}
              <div className="gui2-landing-character-copy">
                <div className="gui2-landing-character-name">{character.name}</div>
                <div className="gui2-landing-character-role">
                  {character.role === 'MAIN' ? ui.mainRole : character.role === 'SUPPORTING' ? ui.supportingRole : character.role || ui.supportingRole}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="media-detail-empty-copy">{emptyLabel}</div>
      )}
    </section>
  )
}

function OnlineEpisodeWatchCard({ ep, artSrc, sourceName, isActive, onSelect, labels }) {
  return (
    <button
      type="button"
      className={`gui2-landing-watchcard${isActive ? ' active' : ''}`}
      onClick={() => !isActive && onSelect(ep)}
      aria-pressed={isActive}
      title={isActive ? labels.currentlyPlaying : labels.playThisEpisode}
    >
      <div className="gui2-landing-watchcard-media">
        {artSrc ? (
          <div
            className="gui2-landing-watchcard-thumb"
            style={{ backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.04) 0%, rgba(7,7,10,0.52) 100%), url(${artSrc})` }}
          />
        ) : (
          <div className="gui2-landing-watchcard-thumb gui2-landing-watchcard-thumb--placeholder">
            {labels.noArtwork}
          </div>
        )}
        <span className="gui2-landing-watchcard-number">
          {labels.episode} {ep.number || '?'}
        </span>
      </div>
      <div className="gui2-landing-watchcard-copy">
        <div className="gui2-landing-watchcard-title">
          {ep.title ?? `${labels.episode} ${ep.number}`}
        </div>
        <div className="gui2-landing-watchcard-meta">
          <span>{sourceName}</span>
          {ep.watched ? <span>{labels.watched}</span> : null}
          {isActive ? <span>{labels.currentlyPlaying}</span> : null}
        </div>
      </div>
    </button>
  )
}

function OnlineEpisodeRow({
  ep,
  totalEpisodes,
  artSrc,
  sourceName,
  supportsDownloads,
  isStreaming,
  isDownloading,
  onWatch,
  onDownload,
  labels,
}) {
  return (
    <article
      className={`gui2-landing-episode-row${ep.watched ? ' gui2-landing-episode-row--watched' : ''}`}
      onClick={() => !isStreaming && onWatch(ep)}
      style={{ cursor: isStreaming ? 'wait' : 'pointer' }}
    >
      <div className="gui2-landing-episode-media">
        {artSrc ? (
          <div
            className="gui2-landing-episode-thumb"
            style={{ backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.12) 0%, rgba(7,7,10,0.58) 100%), url(${artSrc})` }}
          />
        ) : (
          <div className="gui2-landing-episode-thumb gui2-landing-episode-thumb--placeholder">
            {labels.noArtwork}
          </div>
        )}
        <div className="gui2-landing-episode-number">{ep.number || '?'}</div>
      </div>

      <div className="gui2-landing-episode-copy">
        <div className="gui2-landing-episode-meta">
          <span>{sourceName}</span>
          <span>{totalEpisodes > 0 ? `${ep.number}/${totalEpisodes}` : ep.number}</span>
          {ep.watched ? <span>OK {labels.watched}</span> : null}
        </div>
        <div className="gui2-landing-episode-title">
          {ep.title ?? `${labels.episode} ${ep.number}`}
        </div>
        <div className="gui2-landing-episode-description">
          {supportsDownloads ? labels.streamingDownload : labels.streamingOnly}
        </div>
      </div>

      <div className="gui2-landing-episode-actions">
        {supportsDownloads ? (
          <button
            className="btn btn-ghost episode-dl-btn"
            onClick={(event) => {
              event.stopPropagation()
              onDownload(ep)
            }}
            disabled={isDownloading}
            title={labels.download}
          >
            {isDownloading
              ? <span className="btn-spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'rgba(245,166,35,0.25)', width: 14, height: 14 }} />
              : '↓'}
            {labels.download}
          </button>
        ) : null}

        <button
          className="btn btn-primary episode-play-btn"
          onClick={(event) => {
            event.stopPropagation()
            onWatch(ep)
          }}
          disabled={isStreaming}
        >
          {isStreaming
            ? <><span className="btn-spinner" style={{ borderTopColor: '#0a0a0e', borderColor: 'rgba(10,10,14,0.25)' }} /> {labels.loading}</>
            : ep.watched
              ? labels.watchAgain
              : labels.watchNow}
        </button>
      </div>
    </article>
  )
}

