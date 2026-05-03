import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { wails, proxyImage } from '../../lib/wails'
import { toastError, toastSuccess } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'
import { extractAniListAnimeSearchMedia } from '../../lib/anilistSearch'
import IntegratedVideoPlayer from './IntegratedVideoPlayer'
import { perfEnd, perfMark } from '../../lib/perfTrace'

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

export default function OnlineAnimeDetail({ anime, onBack, onAnimeChange = null }) {
  const [episodes, setEpisodes] = useState(() => anime.prefetchedEpisodes ?? [])
  const [streaming, setStreaming] = useState(null)
  const [downloading, setDownloading] = useState(null)
  const [synopsis, setSynopsis] = useState('')
  const [addingToList, setAddingToList] = useState(false)
  const [integratedPlayback, setIntegratedPlayback] = useState(null)
  const [preferredAudio, setPreferredAudio] = useState('sub')
  const [desiredAudioFlavor, setDesiredAudioFlavor] = useState('sub')
  const [audioVariantSwitching, setAudioVariantSwitching] = useState(false)
  const [episodeFilter, setEpisodeFilter] = useState('unwatched')
  const { t, lang } = useI18n()
  const autoVariantSyncKeyRef = useRef('')
  const isEnglish = lang === 'en'
  const isResolvingSource = Boolean(anime.pending_resolve)
  const sourceAnimeID = String(anime.id ?? anime.anime_id ?? anime.animeID ?? '').trim()
  const currentAniListID = Number(anime.anilist_id || anime.anilistID || anime.AniListID || anime.idAniList || 0)
  const currentMalID = Number(anime.mal_id || anime.malID || anime.MalID || 0)
  const preferAniListCover = ['animegg-en', 'animepahe-en'].includes(anime.source_id)
  const supportsDownloads = anime.source_id === 'jkanime-es' || anime.source_id === 'animepahe-en' || anime.source_id === 'animegg-en'
  const variantProbeEpisodeID = String(episodes?.[0]?.id ?? anime.prefetchedEpisodes?.[0]?.id ?? '').trim()

  const source = SOURCE_LABELS[anime.source_id] ?? { name: anime.source_id, color: '#9090a8', flag: '' }
  const sourceCover = anime.cover_url ? proxyImage(anime.cover_url) : null
  const coverSrc = preferAniListCover
    ? (anime.anilistCoverImage || sourceCover || null)
    : (sourceCover || anime.anilistCoverImage || null)
  const backdropSrc = anime.anilistBannerImage || anime.anilistCoverImage || coverSrc || ''

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
    mpvModeDesc: isEnglish ? 'Temporarily the only playback mode while the in-app player is being stabilized.' : 'Temporalmente el unico modo de reproduccion mientras estabilizamos el reproductor interno.',
    integratedModeDesc: isEnglish ? 'Keeps playback inside Nipah! with quick episode controls and a darker theater view.' : 'Mantiene la reproducción dentro de Nipah! con controles rápidos y una vista más cinemática.',
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
    noArtwork: isEnglish ? 'No artwork' : 'Sin arte',
    watched: isEnglish ? 'Watched' : 'Visto',
    episode: isEnglish ? 'Episode' : 'Episodio',
    download: isEnglish ? 'Download' : 'Descargar',
    sourceAccess: isEnglish ? 'Source access' : 'Acceso a fuente',
    playbackMode: isEnglish ? 'Playback mode' : 'Modo de reproduccion',
    episodeQueue: isEnglish ? 'Episode queue' : 'Cola de episodios',
    episodeQueueCopy: isEnglish ? 'A cleaner list with quick playback actions and a stable desktop rhythm.' : 'Una lista mas limpia con acciones rapidas y un ritmo de escritorio estable.',
    continueLabel: isEnglish ? 'Continue watching' : 'Continuar viendo',
    fallbackCast: isEnglish ? 'Cast is still loading from AniList. The page stays usable in the meantime.' : 'El reparto sigue cargando desde AniList. La pagina se mantiene usable mientras tanto.',
  }

  const cleanSynopsis = synopsis ? synopsis.replace(/<[^>]+>/g, '').trim() : ''

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
    if (ep.thumbnail) return proxyImage(ep.thumbnail)
    const anilistThumb = getAniListEpisodeThumbnail(ep)
    if (anilistThumb) return anilistThumb
    return backdropSrc
  }, [backdropSrc, getAniListEpisodeThumbnail])

  useEffect(() => {
    const explicitAudio = anime?.audio_variant === 'dub' ? 'dub' : (anime?.audio_variant === 'sub' ? 'sub' : '')
    wails.getSettings()
      .then((settings) => {
        const value = String(settings?.preferred_audio ?? 'sub').trim().toLowerCase()
        const normalized = value === 'dub' ? 'dub' : 'sub'
        setPreferredAudio(normalized)
        setDesiredAudioFlavor(explicitAudio || normalized)
      })
      .catch(() => {
        setPreferredAudio('sub')
        setDesiredAudioFlavor(explicitAudio || 'sub')
      })
  }, [anime?.audio_variant, anime])

  useEffect(() => {
    const explicitAudio = anime?.audio_variant === 'dub' ? 'dub' : (anime?.audio_variant === 'sub' ? 'sub' : '')
    setDesiredAudioFlavor(explicitAudio || preferredAudio)
  }, [anime.source_id, sourceAnimeID, anime.audio_variant, preferredAudio])

  const activeAudioVariant = desiredAudioFlavor === 'dub' ? 'dub' : 'sub'

  const animeDetailQuery = useQuery({
    queryKey: ['anime-detail-anilist', currentAniListID, anime.title, lang],
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
      const nextEpisodes = anime.prefetchedEpisodes?.length
        ? anime.prefetchedEpisodes
        : await wails.getOnlineEpisodes(anime.source_id, sourceAnimeID)

      const watchedFloor = Number(anime.episodes_watched || 0)

      return (nextEpisodes ?? []).map((ep) => ({
        ...ep,
        watched: Boolean(ep.watched) || ((Number(ep.number) || 0) > 0 && (Number(ep.number) || 0) <= watchedFloor),
      }))
    },
    placeholderData: anime.prefetchedEpisodes ?? [],
    staleTime: 15 * 60_000,
    gcTime: 45 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: Boolean(anime.source_id && sourceAnimeID && !isResolvingSource),
  })

  useEffect(() => {
    if (episodesQuery.data) {
      setEpisodes(episodesQuery.data)
    }
  }, [episodesQuery.data])

  useEffect(() => {
    setEpisodeFilter('unwatched')
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
  const resumeEpisode = episodes.find((ep) => !ep.watched) ?? episodes[0] ?? null
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
  const progressValue = episodes.length > 0
    ? Math.max(0, Math.min(100, Math.round(((episodes.length - visibleEpisodes.length) / episodes.length) * 100)))
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

  const launchEpisode = useCallback(async (ep, modeOverride = null, audioOverride = '') => {
    const openWithAudio = async (targetAudio, allowFallback) => {
      const effectiveMode = modeOverride === 'integrated' ? 'integrated' : 'mpv'
      const useExplicitVariant = anime.source_id === 'animegg-en' && supportsAudioVariants && ['sub', 'dub'].includes(targetAudio)
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
          const fallbackAllowed = fallbackAudio === 'dub'
            ? Boolean(audioVariantAvailability?.dub)
            : Boolean(audioVariantAvailability?.sub)
          if (fallbackAllowed) {
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
  }, [activeAudioVariant, anime, audioVariantAvailability?.dub, audioVariantAvailability?.sub, currentAniListID, currentMalID, isEnglish, source.name, sourceAnimeID, supportsAudioVariants, ui.challengeError, ui.integratedOpen, ui.mpvMissing, ui.openingEpisode, ui.playError, ui.resolveError])

  const handleStream = useCallback(async (ep) => {
    await launchEpisode(ep)
  }, [launchEpisode])

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
  const watchedCount = episodes.filter((ep) => ep.watched).length
  const canAddToList = currentAniListID > 0 && !anime.in_anime_list && !anime.in_list && !anime.anime_list_status
  const factsInline = headlineFacts.filter(Boolean)
  const airingInfoRows = [
    resumeEpisode ? { label: isEnglish ? 'Next Episode' : 'Siguiente episodio', value: resumeEpisode.title ?? `${t('Episodio')} ${resumeEpisode.number}`, note: resumeEpisode.number ? `${t('Episodio')} ${resumeEpisode.number}` : '' } : null,
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
  const integratedEpisodeNumber = Number(integratedPlayback?.episode?.number || 0)
  const integratedPlayerTitle = anime.anime_title || anime.title
  const integratedPlayerEpisodeLabel = integratedEpisodeNumber > 0
    ? `${isEnglish ? 'Episode' : 'Episodio'} ${integratedEpisodeNumber}`
    : (integratedPlayback?.subtitle || (isEnglish ? 'Episode' : 'Episodio'))

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

  if (integratedPlayback?.url) {
    return (
      <div
        className="gui2-online-player-page"
        style={backdropSrc ? { '--gui2-online-player-backdrop': `url(${backdropSrc})` } : undefined}
      >
        <div className="gui2-online-player-copy">
          <h1 className="gui2-online-player-title">{integratedPlayerTitle}</h1>
          <p className="gui2-online-player-episode">{integratedPlayerEpisodeLabel}</p>
        </div>

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
          onPlaybackEnd={(positionSec, durationSec) => closeIntegratedPlayback(true, positionSec, durationSec)}
          onUseExternalPlayer={handleUseExternalPlayer}
          onPrev={previousIntegratedEpisode ? () => handleIntegratedEpisodeJump(previousIntegratedEpisode) : null}
          onNext={nextIntegratedEpisode ? () => handleIntegratedEpisodeJump(nextIntegratedEpisode) : null}
          prevLabel={ui.previousEpisode}
          nextLabel={ui.nextEpisode}
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
      </div>
    )
  }

  return (
    <div className="fade-in media-detail-page media-detail-page--online gui2-landing-page gui2-landing-page--anime">
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
        onPlaybackEnd={(positionSec, durationSec) => closeIntegratedPlayback(true, positionSec, durationSec)}
        onUseExternalPlayer={handleUseExternalPlayer}
        onPrev={previousIntegratedEpisode ? () => handleIntegratedEpisodeJump(previousIntegratedEpisode) : null}
        onNext={nextIntegratedEpisode ? () => handleIntegratedEpisodeJump(nextIntegratedEpisode) : null}
        prevLabel={ui.previousEpisode}
        nextLabel={ui.nextEpisode}
        audioLabel={ui.audioTrack}
        activeAudio={activeAudioVariant}
        audioSwitching={audioVariantSwitching}
        audioOptions={supportsAudioVariants ? [
          { value: 'sub', label: ui.subtitles },
          { value: 'dub', label: ui.dubbed },
        ] : []}
        onAudioChange={supportsAudioVariants ? handleIntegratedAudioSwitch : null}
        onClose={() => closeIntegratedPlayback(false)}
      />

      <section
        className="gui2-landing-hero"
        style={backdropSrc ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.16) 0%, rgba(7,7,10,0.76) 44%, rgba(7,7,10,0.97) 82%, rgba(7,7,10,0.99) 100%), radial-gradient(circle at top right, rgba(63, 116, 189, 0.2) 0%, rgba(63, 116, 189, 0) 34%), url(${backdropSrc})`,
        } : {}}
      >
        <div className="gui2-landing-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={onBack}>
            {isEnglish ? 'Back to catalog' : 'Volver al catalogo'}
          </button>
        </div>

        <div className="gui2-landing-hero-grid gui2-landing-hero-grid--anime">
          {coverSrc ? (
            <div className="gui2-landing-cover-wrap">
              <img src={coverSrc} alt={anime.title} className="gui2-landing-cover gui2-landing-cover--round" />
            </div>
          ) : null}

          <div className="gui2-landing-copy">
            <div className="gui2-landing-kicker">{t('Anime')}</div>
            <h1 className="gui2-landing-title">{anime.anime_title || anime.title}</h1>
            {titleNative ? <div className="gui2-landing-subtitle">{titleNative}</div> : null}
            {factsInline.length > 0 ? (
              <div className="gui2-landing-facts-inline">
                {factsInline.map((fact, index) => (
                  <span key={`${fact}-${index}`} className="gui2-landing-inline-fact">{fact}</span>
                ))}
              </div>
            ) : null}
            {cleanSynopsis ? <p className="gui2-landing-story">{cleanSynopsis}</p> : null}

            <div className="gui2-landing-actions">
              {episodes[0] && !resumeEpisode ? (
                <button className="btn btn-primary gui2-landing-primary-btn" type="button" onClick={() => handleStream(episodes[0])} disabled={streaming === episodes[0].id}>
                  {isEnglish ? `Play S1 E${episodes[0].number || 1}` : `Ver T1 E${episodes[0].number || 1}`}
                </button>
              ) : null}
              {resumeEpisode ? (
                <button className="btn btn-ghost gui2-landing-secondary-btn" type="button" onClick={() => handleStream(resumeEpisode)} disabled={streaming === resumeEpisode.id}>
                  {ui.continueLabel}
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
          </div>

        </div>
      </section>

      <div className="gui2-landing-workspace">
        <div className="gui2-landing-main">
          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head">
              <h3 className="gui2-landing-section-title">{isEnglish ? 'Airing Info' : 'Informacion de emision'}</h3>
            </div>
            <AnimeLandingFactList rows={airingInfoRows} />
          </section>

          <AnimeLandingCharacterStrip
            characters={selectedCharacters}
            loading={animeDetailQuery.isLoading}
            loadingLabel={ui.castLoading}
            emptyLabel={ui.castEmpty}
            title={ui.castTitle}
            actionLabel={isEnglish ? 'View all' : 'Ver todos'}
            ui={ui}
          />

          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head gui2-landing-section-head--split">
              <h3 className="gui2-landing-section-title">{ui.episodeQueue}</h3>
              <div className="gui2-landing-section-tools gui2-landing-section-tools--wrap">
                {supportsAudioVariants ? (
                  <div className="episode-audio-toolbar episode-audio-toolbar--inline gui2-landing-audio-toolbar">
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
                {episodes.length > 0 ? <span className="media-detail-count-pill">{visibleEpisodes.length}/{episodes.length}</span> : null}
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
              visibleEpisodes.length > 0 ? (
                <div className="gui2-landing-episode-list">
                  {visibleEpisodes.map((ep) => {
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
                </div>
              ) : (
                <div className="empty-state manga-filter-empty-state">
                  <div className="empty-state-title">{ui.episodeFilterEmpty}</div>
                  <p className="empty-state-desc">{ui.episodeFilterEmptyDesc}</p>
                </div>
              )
            ) : null}
          </section>
        </div>

        <aside className="gui2-landing-aside">
          <AnimeLandingMetaPanel title={isEnglish ? 'Details' : 'Detalles'} rows={detailRows} />
          <AnimeLandingMetaPanel title={isEnglish ? 'More Info' : 'Mas informacion'} rows={moreInfoRows} />

          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head">
              <h3 className="gui2-landing-section-title">{ui.playbackMode}</h3>
            </div>
            <div className="gui2-landing-setting-block">
              <div className="manga-filter-toggle" role="tablist" aria-label={ui.playbackMode}>
                <button
                  type="button"
                  className="manga-filter-toggle-btn active"
                  disabled
                >
                  {ui.mpvMode}
                </button>
              </div>
              <p className="gui2-landing-setting-copy">
                {ui.mpvModeDesc}
              </p>
            </div>

            <div className="gui2-landing-source-inline">{source.name}</div>
          </section>
        </aside>
      </div>
    </div>
  )

  return (
    <div className="fade-in media-detail-page media-detail-page--online">
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
        onPlaybackEnd={(positionSec, durationSec) => closeIntegratedPlayback(true, positionSec, durationSec)}
        onUseExternalPlayer={handleUseExternalPlayer}
        onPrev={previousIntegratedEpisode ? () => handleIntegratedEpisodeJump(previousIntegratedEpisode) : null}
        onNext={nextIntegratedEpisode ? () => handleIntegratedEpisodeJump(nextIntegratedEpisode) : null}
        prevLabel={ui.previousEpisode}
        nextLabel={ui.nextEpisode}
        audioLabel={ui.audioTrack}
        activeAudio={activeAudioVariant}
        audioSwitching={audioVariantSwitching}
        audioOptions={supportsAudioVariants ? [
          { value: 'sub', label: ui.subtitles },
          { value: 'dub', label: ui.dubbed },
        ] : []}
        onAudioChange={supportsAudioVariants ? handleIntegratedAudioSwitch : null}
        onClose={() => closeIntegratedPlayback(false)}
      />

      <section
        className="media-detail-hero online-detail-hero-shell"
        style={backdropSrc ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.18) 0%, rgba(7,7,10,0.72) 40%, rgba(7,7,10,0.94) 78%, rgba(7,7,10,0.98) 100%), radial-gradient(circle at top right, rgba(245,166,35,0.14) 0%, rgba(245,166,35,0) 34%), url(${backdropSrc})`,
        } : {}}
      >
        <div className="media-detail-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={onBack}>
            {`< ${t('Volver')}`}
          </button>
          {resumeEpisode ? (
            <div className="media-detail-toolbar-actions">
              <button className="btn btn-primary media-detail-primary-btn" type="button" onClick={() => handleStream(resumeEpisode)}>
                {ui.watchNow}
              </button>
            </div>
          ) : null}
        </div>

        <div className="media-detail-hero-grid online-detail-hero-grid">
          {coverSrc ? (
            <div className="media-detail-cover-wrap online-detail-cover-wrap">
              <img src={coverSrc} alt={anime.title} className="media-detail-cover" />
            </div>
          ) : null}

          <div className="media-detail-hero-copy online-detail-copy">
            <div className="media-detail-kicker">{source.name}{source.flag ? ` / ${source.flag}` : ''}</div>
            <h1 className="media-detail-title">{anime.title}</h1>
            {headlineFacts.length > 0 ? (
              <div className="media-detail-facts-strip">
                {headlineFacts.map((fact) => <span key={fact} className="media-detail-fact-chip">{fact}</span>)}
              </div>
            ) : null}
            {cleanSynopsis ? (
              <div className="media-detail-story-block">
                <div className="media-detail-story-label">{isEnglish ? 'Story' : 'Historia'}</div>
                <p className="media-detail-synopsis">{cleanSynopsis}</p>
              </div>
            ) : null}

            <div className="online-detail-action-row">
              {resumeEpisode ? (
                <button className="btn btn-primary media-detail-primary-btn" type="button" onClick={() => handleStream(resumeEpisode)}>
                  {ui.continueLabel}
                </button>
              ) : null}
              <button className="btn btn-primary media-detail-secondary-btn" type="button" disabled>
                {ui.mpvMode}
              </button>
            </div>

            <div className="online-detail-stat-grid">
              <div className="detail-stat-card">
                <span className="detail-stat-label">{ui.sourceLabel}</span>
                <span className="detail-stat-value">{source.name}</span>
              </div>
              <div className="detail-stat-card">
                <span className="detail-stat-label">{t('Episodios')}</span>
                <span className="detail-stat-value">{episodes.length || '-'}</span>
              </div>
              <div className="detail-stat-card">
                <span className="detail-stat-label">{ui.availability}</span>
                <span className="detail-stat-value">{supportsDownloads ? ui.streamingDownload : ui.streamingOnly}</span>
              </div>
            </div>
          </div>

          <aside className="media-detail-aside online-detail-hero-aside">
            <section className="media-detail-panel">
              <div className="media-detail-panel-title">{isEnglish ? 'Airing information' : 'Informacion de emision'}</div>
              <div className="media-detail-fact-list">
                {airingRows.map((row) => (
                  <div key={row.label} className="media-detail-fact-row">
                    <span className="media-detail-fact-label">{row.label}</span>
                    <span className="media-detail-fact-value">{row.value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="media-detail-panel">
              <div className="media-detail-panel-title">{ui.castTitle}</div>
              <p className="media-detail-panel-copy">{ui.castCopy}</p>
              {animeDetailQuery.isLoading ? (
                <div className="media-detail-empty-copy">{ui.fallbackCast}</div>
              ) : selectedCharacters.length > 0 ? (
                <div className="media-detail-cast-list">
                  {selectedCharacters.map((character) => (
                    <article key={`${character.id || character.name}-${character.role || ''}`} className="media-detail-cast-card">
                      {character.image ? <img src={proxyImage(character.image)} alt={character.name} className="media-detail-cast-avatar" /> : <div className="media-detail-cast-avatar media-detail-cast-avatar-placeholder">{character.name?.slice(0, 1) || '?'}</div>}
                      <div className="media-detail-cast-body">
                        <div className="media-detail-cast-role">{character.role === 'MAIN' ? ui.mainRole : character.role === 'SUPPORTING' ? ui.supportingRole : character.role || ui.supportingRole}</div>
                        <div className="media-detail-cast-name">{character.name}</div>
                        {character.name_native ? <div className="media-detail-cast-native">{character.name_native}</div> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="media-detail-empty-copy">{ui.castEmpty}</div>
              )}
            </section>
          </aside>
        </div>
      </section>

      <div className="media-detail-content-grid online-detail-workspace">
        <div className="media-detail-main">
          <section className="media-detail-panel media-detail-progress-panel online-detail-progress-panel">
            <div className="media-detail-progress-head">
              <div>
                <div className="media-detail-panel-title">{ui.continueLabel}</div>
                <p className="media-detail-panel-copy">
                  {episodes.length > 0
                    ? `${episodes.length - visibleEpisodes.length}/${episodes.length} ${isEnglish ? 'episodes watched' : 'episodios vistos'}`
                    : ui.loadingEpisodes}
                </p>
              </div>
              <div className="media-detail-progress-value">{progressValue}%</div>
            </div>
            <div className="media-detail-progress-track">
              <div className="media-detail-progress-fill" style={{ width: `${progressValue}%` }} />
            </div>
            {resumeEpisode ? (
              <div className="media-detail-resume-card online-detail-resume-card">
                <div className="media-detail-resume-copy">
                  <div className="media-detail-resume-label">{ui.continueLabel}</div>
                  <div className="media-detail-resume-title">
                    {resumeEpisode.title ?? `${t('Episodio')} ${resumeEpisode.number}`}
                  </div>
                  <div className="media-detail-resume-meta">{source.name}</div>
                </div>
                <button className="btn btn-primary media-detail-primary-btn" type="button" onClick={() => handleStream(resumeEpisode)}>
                  {ui.watchNow}
                </button>
              </div>
            ) : null}
          </section>

          <section className="media-detail-panel">
            <div className="media-detail-tab-strip online-detail-tab-strip">
              <button type="button" className="media-detail-tab-btn active">{t('Episodios')}</button>
              {supportsAudioVariants ? (
                <button type="button" className="media-detail-tab-btn" disabled>{ui.audioTrack}</button>
              ) : null}
            </div>

            <div className="online-detail-control-grid">
              <div className="online-detail-control-card">
                <div className="detail-stat-label">{ui.playerMode}</div>
                <div className="episode-playback-desc">{ui.mpvModeDesc}</div>
                <div className="online-detail-inline-actions">
                  <button className="btn btn-primary media-detail-secondary-btn" type="button" disabled>
                    {ui.mpvMode}
                  </button>
                </div>
              </div>

              {supportsAudioVariants ? (
                <div className="online-detail-control-card">
                  <div className="detail-stat-label">{ui.audioTrack}</div>
                  <div className="episode-playback-desc">
                    {audioVariantSwitching || audioVariantsQuery.isLoading ? ui.audioLoading : ui.audioSwitchHint}
                  </div>
                  <div className="online-detail-inline-actions">
                    <button className={`btn ${activeAudioVariant === 'sub' ? 'btn-primary' : 'btn-ghost'} media-detail-secondary-btn`} type="button" disabled={audioVariantSwitching} onClick={() => handleAudioVariantChange('sub')}>
                      {ui.subtitles}
                    </button>
                    <button className={`btn ${activeAudioVariant === 'dub' ? 'btn-primary' : 'btn-ghost'} media-detail-secondary-btn`} type="button" disabled={audioVariantSwitching} onClick={() => handleAudioVariantChange('dub')}>
                      {ui.dubbed}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="media-detail-section-head">
              <div className="media-detail-panel-title">
                {t('Episodios')}
                {episodes.length > 0 ? <span className="media-detail-count-pill">{visibleEpisodes.length}/{episodes.length}</span> : null}
              </div>
              <div className="media-detail-panel-copy">{ui.episodeFilterHint}</div>
            </div>

            <div className="manga-chapter-toolbar online-detail-filter-toolbar">
              <div className="manga-chapter-toolbar-copy">
                <span className="manga-chapter-toolbar-title">{ui.episodeQueue}</span>
              </div>
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

            {loading ? (
              <>
                <div className="manga-skeleton-caption">{isResolvingSource ? ui.resolvingSource : ui.loadingEpisodes}</div>
                <EpisodeGridSkeleton count={8} />
              </>
            ) : null}

            {error ? (
              <div className="online-detail-error">{error}</div>
            ) : null}

            {!loading && !error && episodes.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-state-title">{t('Sin episodios')}</div>
                <p className="empty-state-desc">{ui.noEpisodesDesc(source.name)}</p>
              </div>
            ) : null}

            {!loading && episodes.length > 0 ? (
              visibleEpisodes.length > 0 ? (
                <div className="online-episode-row-list">
                  {visibleEpisodes.map((ep) => {
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
                </div>
              ) : (
                <div className="empty-state manga-filter-empty-state">
                  <div className="empty-state-title">{ui.episodeFilterEmpty}</div>
                  <p className="empty-state-desc">{ui.episodeFilterEmptyDesc}</p>
                </div>
              )
            ) : null}
          </section>
        </div>

      </div>
    </div>
  )

  return (
    <div className="fade-in media-detail-page media-detail-page--online">
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
        onPlaybackEnd={(positionSec, durationSec) => closeIntegratedPlayback(true, positionSec, durationSec)}
        onUseExternalPlayer={handleUseExternalPlayer}
        onPrev={previousIntegratedEpisode ? () => handleIntegratedEpisodeJump(previousIntegratedEpisode) : null}
        onNext={nextIntegratedEpisode ? () => handleIntegratedEpisodeJump(nextIntegratedEpisode) : null}
        prevLabel={ui.previousEpisode}
        nextLabel={ui.nextEpisode}
        audioLabel={ui.audioTrack}
        activeAudio={activeAudioVariant}
        audioSwitching={audioVariantSwitching}
        audioOptions={supportsAudioVariants ? [
          { value: 'sub', label: ui.subtitles },
          { value: 'dub', label: ui.dubbed },
        ] : []}
        onAudioChange={supportsAudioVariants ? handleIntegratedAudioSwitch : null}
        onClose={() => closeIntegratedPlayback(false)}
      />

      <div
        className="detail-hero media-detail-hero"
        style={backdropSrc ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.22) 0%, rgba(7,7,10,0.6) 32%, rgba(7,7,10,0.88) 72%, rgba(7,7,10,0.98) 100%), radial-gradient(circle at top right, rgba(245,166,35,0.22) 0%, rgba(245,166,35,0) 32%), url(${backdropSrc})`,
        } : {}}
      >
        <button className="btn btn-ghost detail-back" onClick={onBack}>
          ← {t('Volver')}
        </button>

        <div className="detail-hero-content">
          {coverSrc ? <img src={coverSrc} alt={anime.title} className="detail-cover" /> : null}

          <div className="detail-info">
            <div className="detail-kicker">
              {source.name} {source.flag ? `· ${source.flag}` : ''}
            </div>

            {headlineFacts.length > 0 ? (
              <div className="media-detail-facts-strip" style={{ marginBottom: 12 }}>
                {headlineFacts.map((fact) => <span key={fact} className="media-detail-fact-chip">{fact}</span>)}
              </div>
            ) : null}

            <h1 className="detail-title">{anime.title}</h1>

            {cleanSynopsis ? (
              <p className="detail-synopsis" style={{ marginTop: 10, WebkitLineClamp: 5 }}>
                {cleanSynopsis}
              </p>
            ) : null}

            <div className="online-detail-action-row">
              {resumeEpisode ? (
                <button className="btn btn-primary media-detail-primary-btn" type="button" onClick={() => handleStream(resumeEpisode)}>
                  {ui.watchNow}
                </button>
              ) : null}
              <button className="btn btn-primary media-detail-secondary-btn" type="button" disabled>{ui.mpvMode}</button>
              <button className="btn btn-ghost media-detail-secondary-btn" type="button" disabled>
                {source.name}
              </button>
            </div>

            <div className="detail-stat-row">
              <div className="detail-stat-card">
                <span className="detail-stat-label">{ui.sourceLabel}</span>
                <span className="detail-stat-value">{source.name}</span>
              </div>
              <div className="detail-stat-card">
                <span className="detail-stat-label">{t('Episodios')}</span>
                <span className="detail-stat-value">{episodes.length || '—'}</span>
              </div>
              <div className="detail-stat-card">
                <span className="detail-stat-label">{ui.availability}</span>
                <span className="detail-stat-value">{supportsDownloads ? ui.streamingDownload : ui.streamingOnly}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="media-detail-content-grid">
        <div className="media-detail-main">
      <div className="episode-list-section media-detail-panel">
        {resumeEpisode ? (
          <div className="media-detail-resume-card online-detail-resume-card">
            <div className="media-detail-resume-copy">
              <div className="media-detail-resume-label">{isEnglish ? 'Continue watching' : 'Continuar viendo'}</div>
              <div className="media-detail-resume-title">
                {resumeEpisode.title ?? `${t('Episodio')} ${resumeEpisode.number}`}
              </div>
              <div className="media-detail-resume-meta">{source.name}</div>
            </div>
            <button className="btn btn-primary media-detail-primary-btn" type="button" onClick={() => handleStream(resumeEpisode)}>
              {ui.watchNow}
            </button>
          </div>
        ) : null}

        <div className="media-detail-tab-strip">
          <button type="button" className="media-detail-tab-btn active">{t('Episodios')}</button>
          <button type="button" className="media-detail-tab-btn" disabled>{ui.castTitle}</button>
          <button type="button" className="media-detail-tab-btn" disabled>{isEnglish ? 'Related' : 'Relacionados'}</button>
          <button type="button" className="media-detail-tab-btn" disabled>{isEnglish ? 'More info' : 'Mas info'}</button>
        </div>

        <div className="episode-section-head">
          <div>
            <div className="episode-section-kicker">{t('Anime online')}</div>
            <span className="section-title">
              {t('Episodios')}
              {episodes.length > 0 ? <span className="badge badge-muted" style={{ marginLeft: 8 }}>{visibleEpisodes.length}/{episodes.length}</span> : null}
            </span>
          </div>
          <div className="episode-playback-control">
            <div className="episode-playback-copy">
              <div className="episode-playback-label">{ui.playerMode}</div>
              <div className="episode-playback-desc">
                {ui.mpvModeDesc}
              </div>
            </div>
            <div className="episode-playback-switch">
              <button
                className="episode-playback-pill active"
                type="button"
                disabled
              >
                {ui.mpvMode}
              </button>
            </div>
          </div>
        </div>

        <div className="manga-chapter-toolbar">
          <div className="manga-chapter-toolbar-copy">
            <span className="manga-chapter-toolbar-title">{t('Episodios')}</span>
            <span className="manga-chapter-toolbar-note">{ui.episodeFilterHint}</span>
          </div>
          <div className="episode-toolbar-actions">
            {supportsAudioVariants ? (
              <div className="episode-audio-toolbar episode-audio-toolbar--inline">
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

        {loading ? (
          <>
            <div className="manga-skeleton-caption">{isResolvingSource ? ui.resolvingSource : ui.loadingEpisodes}</div>
            <EpisodeGridSkeleton count={8} />
          </>
        ) : null}

        {error ? (
          <div style={{
            padding: '12px 14px',
            background: 'rgba(224,82,82,0.08)',
            border: '1px solid rgba(224,82,82,0.2)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            marginTop: 8,
          }}>
            {error}
          </div>
        ) : null}

        {!loading && !error && episodes.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <div className="empty-state-title">{t('Sin episodios')}</div>
            <p className="empty-state-desc">{ui.noEpisodesDesc(source.name)}</p>
          </div>
        ) : null}

        {false ? (
          <div className="episode-grid">
            {episodes.map((ep) => {
              const isStreaming = streaming === ep.id
              const isDownloading = downloading === ep.id
              const artSrc = getEpisodeArtwork(ep)
              return (
                <div
                  key={ep.id}
                  className={`episode-card${ep.watched ? ' episode-watched' : ''}`}
                  onClick={() => !isStreaming && handleStream(ep)}
                  style={{ cursor: isStreaming ? 'wait' : 'pointer' }}
                >
                  <div
                    className="episode-card-art"
                    style={artSrc ? { backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.06) 0%, rgba(7,7,10,0.72) 100%), url(${artSrc})` } : undefined}
                  >
                    <div className="episode-card-art-badge">
                      {ep.watched ? `✓ ${t('Visto')}` : `${t('Episodio')} ${ep.number}`}
                    </div>
                  </div>

                  <div className="episode-card-body">
                    <div className="episode-card-meta">
                      <span>{source.name}</span>
                      <span>{episodes.length > 0 ? `${ep.number}/${episodes.length}` : ep.number}</span>
                    </div>

                    <div className="episode-card-title">
                      {ep.title ?? `${t('Episodio')} ${ep.number}`}
                    </div>

                    <div className="episode-card-desc">{ui.episodeDesc}</div>

                    <div className="episode-card-actions">
                      {supportsDownloads ? (
                        <button
                          className="btn btn-ghost episode-dl-btn"
                          onClick={(event) => { event.stopPropagation(); handleDownload(ep) }}
                          disabled={isDownloading}
                          title={t('Descargar')}
                        >
                          {isDownloading
                            ? <span className="btn-spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'rgba(245,166,35,0.25)', width: 14, height: 14 }} />
                            : '⬇'}
                          {t('Descargar')}
                        </button>
                      ) : null}

                      <button
                        className="btn btn-primary episode-play-btn"
                        onClick={(event) => { event.stopPropagation(); handleStream(ep) }}
                        disabled={isStreaming}
                      >
                          {isStreaming
                            ? <><span className="btn-spinner" style={{ borderTopColor: '#0a0a0e', borderColor: 'rgba(10,10,14,0.25)' }} /> {ui.loading}</>
                            : ep.watched
                              ? `↩ ${isEnglish ? 'Watch again' : 'Ver de nuevo'}`
                            : `▶ ${isEnglish ? 'Watch' : 'Ver'}`}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {!loading && episodes.length > 0 ? (
          <>
            <div className="manga-character-panel anime-cast-inline-panel media-detail-legacy-cast-panel">
              <div className="manga-character-panel-head">
                <div className="episode-section-kicker">{ui.castTitle}</div>
                <p className="episode-section-copy">{ui.castCopy}</p>
              </div>

              {animeDetailQuery.isLoading ? (
                <div className="manga-character-empty">{ui.castLoading}</div>
              ) : selectedCharacters.length > 0 ? (
                <div className="manga-character-list">
                  {selectedCharacters.map((character) => (
                    <article key={`${character.id || character.name}-${character.role || ''}`} className="manga-character-card">
                      {character.image ? <img src={proxyImage(character.image)} alt={character.name} className="manga-character-avatar" /> : <div className="manga-character-avatar manga-character-avatar-placeholder">{character.name?.slice(0, 1) || '?'}</div>}
                      <div className="manga-character-body">
                        <div className="manga-character-role">{character.role === 'MAIN' ? ui.mainRole : character.role === 'SUPPORTING' ? ui.supportingRole : character.role || ui.supportingRole}</div>
                        <div className="manga-character-name">{character.name}</div>
                        {character.name_native ? <div className="manga-character-native">{character.name_native}</div> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="manga-character-empty">{ui.castEmpty}</div>
              )}
            </div>

            {visibleEpisodes.length > 0 ? (
                <div className="anime-episode-grid">
                  {visibleEpisodes.map((ep) => {
                    const isStreaming = streaming === ep.id
                    const isDownloading = downloading === ep.id
                    const artSrc = getEpisodeArtwork(ep)
                    return (
                      <div
                        key={ep.id}
                        className={`anime-episode-card${ep.watched ? ' anime-episode-watched' : ''}`}
                        onClick={() => !isStreaming && handleStream(ep)}
                        style={{ cursor: isStreaming ? 'wait' : 'pointer' }}
                      >
                        <div className="anime-episode-num">
                          <span className="anime-episode-num-label">{ep.number || '?'}</span>
                        </div>
                        <div className="anime-episode-body">
                          <div className="anime-episode-meta">
                            <span>{source.name}</span>
                            <span>{episodes.length > 0 ? `${ep.number}/${episodes.length}` : ep.number}</span>
                            {ep.watched ? <span>OK {t('Visto')}</span> : null}
                          </div>

                          <div className="anime-episode-title">
                            {ep.title ?? `${t('Episodio')} ${ep.number}`}
                          </div>

                          <div className="anime-episode-desc">
                            {supportsDownloads ? ui.streamingDownload : ui.streamingOnly}
                          </div>
                        </div>
                        {artSrc ? (
                          <div className="anime-episode-thumb" style={{ backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.08) 0%, rgba(7,7,10,0.56) 100%), url(${artSrc})` }} />
                        ) : null}
                        <div className="anime-episode-actions">
                          {supportsDownloads ? (
                            <button
                              className="btn btn-ghost episode-dl-btn"
                              onClick={(event) => { event.stopPropagation(); handleDownload(ep) }}
                              disabled={isDownloading}
                              title={t('Descargar')}
                            >
                              {isDownloading
                                ? <span className="btn-spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'rgba(245,166,35,0.25)', width: 14, height: 14 }} />
                                : 'â¬‡'}
                              {t('Descargar')}
                            </button>
                          ) : null}

                          <button
                            className="btn btn-primary episode-play-btn"
                            onClick={(event) => { event.stopPropagation(); handleStream(ep) }}
                            disabled={isStreaming}
                          >
                            {isStreaming
                              ? <><span className="btn-spinner" style={{ borderTopColor: '#0a0a0e', borderColor: 'rgba(10,10,14,0.25)' }} /> {ui.loading}</>
                              : ep.watched
                                ? ui.watchAgain
                                : ui.watchNow}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="empty-state manga-filter-empty-state">
                  <div className="empty-state-title">{ui.episodeFilterEmpty}</div>
                  <p className="empty-state-desc">{ui.episodeFilterEmptyDesc}</p>
                </div>
              )}
          </>
        ) : null}

      </div>
        </div>

        <aside className="media-detail-aside">
          <section className="media-detail-panel">
            <div className="media-detail-panel-title">{isEnglish ? 'Airing information' : 'Informacion'}</div>
            <div className="media-detail-fact-list">
              {airingRows.map((row) => (
                <div key={row.label} className="media-detail-fact-row">
                  <span className="media-detail-fact-label">{row.label}</span>
                  <span className="media-detail-fact-value">{row.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="media-detail-panel">
            <div className="media-detail-panel-title">{ui.castTitle}</div>
            <p className="media-detail-panel-copy">{ui.castCopy}</p>
            {animeDetailQuery.isLoading ? (
              <div className="media-detail-empty-copy">{ui.castLoading}</div>
            ) : selectedCharacters.length > 0 ? (
              <div className="media-detail-cast-list">
                {selectedCharacters.map((character) => (
                  <article key={`${character.id || character.name}-${character.role || ''}`} className="media-detail-cast-card">
                    {character.image ? <img src={proxyImage(character.image)} alt={character.name} className="media-detail-cast-avatar" /> : <div className="media-detail-cast-avatar media-detail-cast-avatar-placeholder">{character.name?.slice(0, 1) || '?'}</div>}
                    <div className="media-detail-cast-body">
                      <div className="media-detail-cast-role">{character.role === 'MAIN' ? ui.mainRole : character.role === 'SUPPORTING' ? ui.supportingRole : character.role || ui.supportingRole}</div>
                      <div className="media-detail-cast-name">{character.name}</div>
                      {character.name_native ? <div className="media-detail-cast-native">{character.name_native}</div> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="media-detail-empty-copy">{ui.castEmpty}</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function AnimeLandingFactList({ rows }) {
  const items = rows.filter((row) => row?.label && row?.value)
  if (!items.length) return null
  return (
    <div className="gui2-landing-fact-grid">
      {items.map((row) => (
        <div key={`${row.label}-${row.value}`} className="gui2-landing-fact-card">
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

function AnimeLandingCharacterStrip({ characters, loading, loadingLabel, emptyLabel, title, actionLabel, ui }) {
  return (
    <section className="gui2-landing-panel">
      <div className="gui2-landing-section-head">
        <h3 className="gui2-landing-section-title">{title}</h3>
        {characters.length > 0 ? <span className="gui2-landing-section-link">{actionLabel}</span> : null}
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
