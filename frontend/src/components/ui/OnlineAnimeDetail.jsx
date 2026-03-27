import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { wails, proxyImage } from '../../lib/wails'
import { toastError, toastSuccess } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'
import IntegratedVideoPlayer from './IntegratedVideoPlayer'

const SOURCE_LABELS = {
  'jkanime-es': { name: 'JKAnime', color: '#c084fc', flag: 'ES' },
  'animeflv-es': { name: 'AnimeFLV', color: '#f97316', flag: 'ES' },
  'animeav1-es': { name: 'AnimeAV1', color: '#9333ea', flag: 'ES' },
  'animepahe-en': { name: 'AnimePahe', color: '#38bdf8', flag: 'EN' },
  'animeheaven-en': { name: 'AnimeHeaven', color: '#0ea5e9', flag: 'EN' },
  'animegg-en': { name: 'AnimeGG', color: '#6366f1', flag: 'EN' },
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

export default function OnlineAnimeDetail({ anime, onBack }) {
  const [episodes, setEpisodes] = useState(() => anime.prefetchedEpisodes ?? [])
  const [streaming, setStreaming] = useState(null)
  const [downloading, setDownloading] = useState(null)
  const [synopsis, setSynopsis] = useState('')
  const [playerMode, setPlayerMode] = useState('mpv')
  const [integratedPlayback, setIntegratedPlayback] = useState(null)
  const { t, lang } = useI18n()
  const isEnglish = lang === 'en'

  const source = SOURCE_LABELS[anime.source_id] ?? { name: anime.source_id, color: '#9090a8', flag: '' }
  const coverSrc = anime.cover_url ? proxyImage(anime.cover_url) : null
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
    mpvMode: 'MPV',
    integratedMode: isEnglish ? 'Integrated' : 'Integrado',
    mpvModeDesc: isEnglish ? 'Best compatibility with external playback and heavier hosts.' : 'Mejor compatibilidad con reproducción externa y hosts más pesados.',
    integratedModeDesc: isEnglish ? 'Opens the episode inside Nipah! using the built-in player.' : 'Abre el episodio dentro de Nipah! usando el reproductor integrado.',
    loadingEpisodes: isEnglish ? 'Loading episodes...' : 'Cargando episodios...',
    noEpisodesDesc: (name) => isEnglish ? `No episodes were found for this series on ${name}.` : `No se encontraron episodios para esta serie en ${name}.`,
    episodeDesc: anime.source_id === 'jkanime-es'
      ? (isEnglish ? 'Instant streaming and direct download from the same entry.' : 'Streaming inmediato y descarga directa desde la misma ficha.')
      : (isEnglish ? `Ready to stream from ${source.name}.` : `Listo para reproducirse desde ${source.name}.`),
    loading: isEnglish ? 'Loading...' : 'Cargando...',
    integratedNote: isEnglish ? 'Integrated playback works best with HLS and direct MP4/WebM streams.' : 'El reproductor integrado funciona mejor con HLS y streams MP4/WebM directos.',
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
    wails.getSettings()
      .then((settings) => {
        setPlayerMode(settings?.player === 'integrated' ? 'integrated' : 'mpv')
      })
      .catch(() => {})
  }, [])

  const episodesQuery = useQuery({
    queryKey: ['online-episodes', anime.source_id, anime.id, Number(anime.anilist_id || anime.anilistID || 0), Number(anime.episodes_watched || 0)],
    queryFn: async () => {
      const nextEpisodes = anime.prefetchedEpisodes?.length
        ? anime.prefetchedEpisodes
        : await wails.getOnlineEpisodes(anime.source_id, anime.id)

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
  })

  useEffect(() => {
    if (episodesQuery.data) {
      setEpisodes(episodesQuery.data)
    }
  }, [episodesQuery.data])

  useEffect(() => {
    if (anime.source_id !== 'jkanime-es') {
      setSynopsis(anime.description || anime.anilistDescription || '')
      return
    }
    wails.getAnimeSynopsis(anime.source_id, anime.id)
      .then((syn) => {
        setSynopsis(syn || anime.anilistDescription || anime.description || '')
      })
      .catch(() => {
        setSynopsis(anime.anilistDescription || anime.description || '')
      })
  }, [anime.id, anime.source_id, anime.anilistDescription, anime.description])

  const loading = episodesQuery.isLoading
  const error = episodesQuery.error?.message ?? null

  const handleStream = useCallback(async (ep) => {
    setStreaming(ep.id)
    try {
      const anilistID = Number(anime.anilist_id || anime.anilistID || 0)
      const malID = Number(anime.mal_id || anime.malID || 0)
      const playback = await wails.openOnlineEpisode(
        anime.source_id,
        ep.id,
        anime.id,
        anime.title,
        anime.cover_url ?? '',
        anilistID,
        malID,
        ep.number ?? 0,
        ep.title ?? `Episodio ${ep.number}`,
        '',
        playerMode,
      )

      if ((playback?.fallback_type === 'integrated' || playback?.player_type === 'integrated') && playback?.fallback_url) {
        setIntegratedPlayback({
          title: anime.title,
          subtitle: ep.title ?? `Ep. ${ep.number}`,
          url: playback.fallback_url,
          kind: playback.stream_kind ?? 'file',
          sourceLabel: source.name,
        })
        toastSuccess(ui.integratedOpen)
      }

      await wails.markOnlineWatched(
        anime.source_id,
        ep.id,
        anime.id,
        anime.title,
        anime.cover_url ?? '',
        anilistID,
        malID,
        ep.number ?? 0,
      )

      setEpisodes((prev) => prev.map((item) => (
        item.id === ep.id ? { ...item, watched: true } : item
      )))
      toastSuccess(ui.openingEpisode(ep.number))
    } catch (e) {
      const msg = e?.message ?? 'error desconocido'
      if (msg.includes('resolver') || msg.includes('embed') || msg.includes('stream')) {
        toastError(ui.resolveError)
      } else if (msg.includes('MPV') || msg.includes('player')) {
        toastError(ui.mpvMissing)
      } else {
        toastError(ui.playError(msg))
      }
    } finally {
      setStreaming(null)
    }
  }, [anime, playerMode, source.name, ui.integratedOpen, ui.mpvMissing, ui.openingEpisode, ui.playError, ui.resolveError])

  const handleDownload = useCallback(async (ep) => {
    setDownloading(ep.id)
    try {
      const links = await wails.getDownloadLinks(anime.source_id, ep.id)
      if (!links || links.length === 0) {
        toastError(t('No hay links de descarga disponibles para este episodio'))
        return
      }

      const link = links[0]
      await wails.startDownload(
        link.url,
        anime.title,
        ep.number ?? 0,
        ep.title ?? `Episodio ${ep.number}`,
        anime.cover_url ?? '',
      )
      toastSuccess(`${t('Descarga iniciada')}: Ep. ${ep.number} (${link.host})`)
    } catch (e) {
      const msg = e?.message ?? 'error desconocido'
      toastError(`${t('Error al descargar')}: ${msg}`)
    } finally {
      setDownloading(null)
    }
  }, [anime, t])

  return (
    <div className="fade-in anime-detail">
      <IntegratedVideoPlayer
        open={Boolean(integratedPlayback?.url)}
        title={integratedPlayback?.title}
        subtitle={integratedPlayback?.subtitle}
        streamURL={integratedPlayback?.url}
        streamKind={integratedPlayback?.kind}
        sourceLabel={integratedPlayback?.sourceLabel}
        onClose={() => setIntegratedPlayback(null)}
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
                <span className="detail-stat-value">{anime.source_id === 'jkanime-es' ? ui.streamingDownload : ui.streamingOnly}</span>
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
                {playerMode === 'integrated' ? ui.integratedModeDesc : ui.mpvModeDesc}
              </div>
            </div>
            <div className="episode-playback-switch">
              <button
                className={`episode-playback-pill${playerMode === 'mpv' ? ' active' : ''}`}
                onClick={() => setPlayerMode('mpv')}
                type="button"
              >
                {ui.mpvMode}
              </button>
              <button
                className={`episode-playback-pill${playerMode === 'integrated' ? ' active' : ''}`}
                onClick={() => setPlayerMode('integrated')}
                type="button"
              >
                {ui.integratedMode}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <>
            <div className="manga-skeleton-caption">{ui.loadingEpisodes}</div>
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
                      {anime.source_id === 'jkanime-es' ? (
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
