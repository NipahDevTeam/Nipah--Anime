import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastError, toastSuccess } from '../components/ui/Toast'
import BlurhashImage from '../components/ui/BlurhashImage'

function formatTime(seconds) {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function EpisodeRow({ ep, onPlay }) {
  const progress = ep.progress_s && ep.duration_s
    ? Math.min(100, (ep.progress_s / ep.duration_s) * 100)
    : 0

  return (
    <div className={`episode-row ${ep.watched ? 'episode-watched' : ''}`}>
      <div className="episode-num">
        {ep.watched
          ? <span className="ep-watched-dot" title="Visto">✓</span>
          : <span className="ep-num-label">{ep.episode_num ?? '?'}</span>
        }
      </div>

      <div className="episode-info">
        <div className="episode-title">
          {ep.title || `Episodio ${ep.episode_num ?? '?'}`}
        </div>
        {progress > 0 && !ep.watched && (
          <div className="episode-progress-bar">
            <div className="episode-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
        {ep.progress_s > 0 && !ep.watched && (
          <div className="episode-resume-label">Reanudar en {formatTime(ep.progress_s)}</div>
        )}
      </div>

      <button
        className="btn btn-primary episode-play-btn"
        onClick={() => onPlay(ep.id)}
      >
        {ep.progress_s > 0 && !ep.watched ? '⟳ Reanudar' : '▶ Ver'}
      </button>
    </div>
  )
}

export default function AnimeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [anime, setAnime] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [playing, setPlaying] = useState(null)
  const [synopsisES, setSynopsisES] = useState(null) // lazy-fetched Spanish synopsis

  const load = useCallback(() => {
    wails.getAnimeDetail(parseInt(id))
      .then(data => {
        if (!data) throw new Error('No encontrado')
        setAnime(data)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  // After anime loads: if no Spanish synopsis in DB, fetch from JKAnime lazily
  useEffect(() => {
    if (!anime) return
    if (anime.synopsis_es) return // already have it
    const title = anime.title_romaji || anime.display_title
    if (!title) return
    wails.fetchAnimeSynopsisES(anime.id, title)
      .then(syn => { if (syn) setSynopsisES(syn) })
      .catch(() => {})
  }, [anime])

  const handlePlay = useCallback(async (episodeID) => {
    setPlaying(episodeID)
    try {
      await wails.playEpisode(episodeID)
      toastSuccess('Abriendo en MPV…')
    } catch (e) {
      const msg = e?.message ?? String(e)
      if (msg.includes('MPV') || msg.includes('player') || msg.includes('not found')) {
        toastError('MPV no encontrado. Verifica la ruta en Ajustes.')
      } else if (msg.includes('episode') || msg.includes('not found')) {
        toastError('Episodio no encontrado. Intenta reescanear la biblioteca.')
      } else {
        toastError(`Error al reproducir: ${msg}`)
      }
      setPlaying(null)
    }
  }, [])

  if (loading) return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )

  if (error) return (
    <div className="empty-state">
      <p className="empty-state-desc" style={{ color: 'var(--red)' }}>{error}</p>
      <button className="btn btn-ghost" onClick={() => navigate('/anime')}>← Volver</button>
    </div>
  )

  if (!anime) return null

  const episodes = anime.episodes ?? []
  const watchedCount = episodes.filter(e => e.watched).length
  const synopsis = synopsisES || anime.synopsis_es || anime.synopsis

  return (
    <div className="fade-in anime-detail">
      {/* Banner / hero */}
      <div className="detail-hero" style={anime.cover_image ? {
        backgroundImage: `linear-gradient(to bottom, rgba(10,10,14,0) 0%, rgba(10,10,14,0.15) 40%, rgba(10,10,14,0.7) 75%, rgba(10,10,14,0.95) 100%), url(${anime.cover_image})`
      } : {}}>
        <button className="btn btn-ghost detail-back" onClick={() => navigate('/anime')}>
          ← Volver
        </button>

        <div className="detail-hero-content">
          {anime.cover_image && (
            <BlurhashImage src={anime.cover_image} blurhash={anime.cover_blurhash} alt={anime.display_title} imgClassName="detail-cover" />
          )}
          <div className="detail-info">
            <h1 className="detail-title">{anime.display_title}</h1>
            {anime.title_romaji && anime.title_spanish && (
              <div className="detail-subtitle">{anime.title_romaji}</div>
            )}
            <div className="detail-tags">
              {anime.year && <span className="badge badge-muted">{anime.year}</span>}
              {anime.status && <span className="badge badge-muted">{translateStatus(anime.status)}</span>}
              {anime.episodes_total > 0 && (
                <span className="badge badge-muted">{anime.episodes_total} eps</span>
              )}
              {watchedCount > 0 && (
                <span className="badge badge-green">{watchedCount} vistos</span>
              )}
            </div>
            {synopsis && (
              <p className="detail-synopsis">{stripHTML(synopsis)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Episode list */}
      <div className="episode-list-section">
        <div className="section-header">
          <span className="section-title">
            Episodios
            <span className="badge badge-muted" style={{ marginLeft: 8 }}>
              {episodes.length}
            </span>
          </span>
          {watchedCount > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {watchedCount}/{episodes.length} vistos
            </span>
          )}
        </div>

        {episodes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>
            No se encontraron episodios en esta carpeta.
          </div>
        ) : (
          <div className="episode-list">
            {episodes.map(ep => (
              <EpisodeRow
                key={ep.id}
                ep={ep}
                onPlay={handlePlay}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function translateStatus(status) {
  const map = {
    FINISHED: 'Finalizado',
    RELEASING: 'En emisión',
    NOT_YET_RELEASED: 'Próximamente',
    CANCELLED: 'Cancelado',
    HIATUS: 'En pausa',
  }
  return map[status] ?? status
}

function stripHTML(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim()
}
