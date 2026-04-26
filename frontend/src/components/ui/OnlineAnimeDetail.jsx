import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { wails, proxyImage } from '../../lib/wails'
import { toastError, toastSuccess } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'
import IntegratedVideoPlayer from './IntegratedVideoPlayer'
import { perfEnd, perfMark } from '../../lib/perfDebug'

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
  const [playerMode] = useState('mpv')
  const [integratedPlayback, setIntegratedPlayback] = useState(null)
  const [preferredAudio, setPreferredAudio] = useState('sub')
  const [desiredAudioFlavor, setDesiredAudioFlavor] = useState('sub')
  const [audioVariantSwitching, setAudioVariantSwitching] = useState(false)
  const { t, lang } = useI18n()
  const autoVariantSyncKeyRef = useRef('')
  const isEnglish = lang === 'en'
  const isResolvingSource = Boolean(anime.pending_resolve)
  const sourceAnimeID = String(anime.id ?? anime.anime_id ?? anime.animeID ?? '').trim()
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
    integratedMode: isEnglish ? 'Integrated (WIP)' : 'Integrado (WIP)',
    mpvModeDesc: isEnglish ? 'Best compatibility with external playback and heavier hosts.' : 'Mejor compatibilidad con reproducción externa y hosts más pesados.',
    integratedModeDesc: isEnglish ? 'Work in progress. Temporarily unavailable until in-app playback is stable.' : 'Trabajo en progreso. Temporalmente no disponible hasta que la reproducción dentro de la app sea estable.',
    loadingEpisodes: isEnglish ? 'Loading episodes...' : 'Cargando episodios...',
    resolvingSource: isEnglish ? 'Resolving source and preparing episodes...' : 'Resolviendo fuente y preparando episodios...',
    noEpisodesDesc: (name) => isEnglish ? `No episodes were found for this series on ${name}.` : `No se encontraron episodios para esta serie en ${name}.`,
    episodeDesc: anime.source_id === 'jkanime-es'
      ? (isEnglish ? 'Instant streaming and direct download from the same entry.' : 'Streaming inmediato y descarga directa desde la misma ficha.')
      : (isEnglish ? `Ready to stream from ${source.name}.` : `Listo para reproducirse desde ${source.name}.`),
    loading: isEnglish ? 'Loading...' : 'Cargando...',
    integratedNote: isEnglish ? 'Integrated player is currently marked as WIP and temporarily unavailable while we stabilize it.' : 'El reproductor integrado está marcado como WIP y temporalmente no disponible mientras lo estabilizamos.',
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
    enabled: Boolean(
      anime.source_id === 'animegg-en' &&
      sourceAnimeID &&
      variantProbeEpisodeID &&
      !isResolvingSource
    ),
  })

  const audioVariantAvailability = audioVariantsQuery.data ?? { sub: true, dub: false }
  const supportsAudioVariants = anime.source_id === 'animegg-en'
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
    if (!supportsAudioVariants) return
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
    } catch (error) {
      if (!options.silent) {
        toastError(error?.message ?? ui.audioNoVariant(normalizedTarget === 'dub' ? ui.dubbed : ui.subtitles))
      }
      setDesiredAudioFlavor(previousAudio)
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

  const launchEpisode = useCallback(async (ep, modeOverride = null) => {
    const openWithAudio = async (targetAudio, allowFallback) => {
      const effectiveMode = modeOverride || playerMode
      const useExplicitVariant = anime.source_id === 'animegg-en' && supportsAudioVariants && ['sub', 'dub'].includes(targetAudio)
      const effectiveEpisodeID = useExplicitVariant
        ? `${ep.id}::audio=${targetAudio}`
        : ep.id

      try {
        const anilistID = Number(anime.anilist_id || anime.anilistID || 0)
        const malID = Number(anime.mal_id || anime.malID || 0)
        const playback = await wails.openOnlineEpisode(
          anime.source_id,
          effectiveEpisodeID,
          sourceAnimeID,
          anime.title,
          anime.cover_url ?? '',
          anilistID,
          malID,
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
      await openWithAudio(activeAudioVariant, supportsAudioVariants)
    } finally {
      setStreaming(null)
    }
  }, [activeAudioVariant, anime, audioVariantAvailability?.dub, audioVariantAvailability?.sub, isEnglish, playerMode, source.name, sourceAnimeID, supportsAudioVariants, ui.challengeError, ui.integratedOpen, ui.mpvMissing, ui.openingEpisode, ui.playError, ui.resolveError])

  const handleStream = useCallback(async (ep) => {
    await launchEpisode(ep)
  }, [launchEpisode])

  const handleUseExternalPlayer = useCallback(async () => {
    const playback = integratedPlayback
    if (!playback?.episode) return

    await closeIntegratedPlayback(false)
    await launchEpisode(playback.episode, 'mpv')
  }, [closeIntegratedPlayback, integratedPlayback, launchEpisode])

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

  return (
    <div className="fade-in anime-detail">
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
        onClose={() => closeIntegratedPlayback(false)}
      />

      <div
        className="detail-hero"
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

            <div className="detail-tags" style={{ marginBottom: 12 }}>
              <span
                className="badge"
                style={{
                  background: source.color + '22',
                  color: source.color,
                  border: `1px solid ${source.color}55`,
                }}
              >
                {source.name}
              </span>
              {source.flag ? <span className="badge badge-muted">{source.flag}</span> : null}
              {anime.year ? <span className="badge badge-muted">{anime.year}</span> : null}
              {episodes.length > 0 ? (
                <span className="badge badge-muted">
                  {episodes.length} {t('Episodios').toLowerCase()}
                </span>
              ) : null}
            </div>

            <h1 className="detail-title">{anime.title}</h1>

            {cleanSynopsis ? (
              <p className="detail-synopsis" style={{ marginTop: 10, WebkitLineClamp: 5 }}>
                {cleanSynopsis}
              </p>
            ) : null}

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

      <div className="episode-list-section">
        <div className="episode-section-head">
          <div>
            <div className="episode-section-kicker">{t('Anime online')}</div>
            <span className="section-title">
              {t('Episodios')}
              {episodes.length > 0 ? <span className="badge badge-muted" style={{ marginLeft: 8 }}>{episodes.length}</span> : null}
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
                >
                  {ui.mpvMode}
                </button>
                <button
                  className="episode-playback-pill episode-playback-pill-wip"
                  type="button"
                  disabled
                  title={ui.integratedModeDesc}
                >
                  {ui.integratedMode}
                </button>
            </div>
          </div>
        </div>

        {supportsAudioVariants ? (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
            padding: '10px 12px',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(255,255,255,0.02)',
          }}>
              <div>
                <div className="detail-stat-label" style={{ marginBottom: 4 }}>{ui.audioTrack}</div>
                <div className="episode-playback-desc" style={{ margin: 0 }}>
                  {audioVariantSwitching || audioVariantsQuery.isLoading ? ui.audioLoading : ui.audioSwitchHint}
                </div>
              </div>
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

        {!loading && episodes.length > 0 ? (
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
                            : `▶ ${playerMode === 'integrated' ? ui.integratedMode : (isEnglish ? 'Watch' : 'Ver')}`}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        <div className="episode-player-note">{ui.integratedNote}</div>
      </div>
    </div>
  )
}
