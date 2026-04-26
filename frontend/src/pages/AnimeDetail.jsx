import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastError, toastSuccess } from '../components/ui/Toast'
import BlurhashImage from '../components/ui/BlurhashImage'
import { useI18n } from '../lib/i18n'

function formatTime(seconds) {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatEpisodeLabel(value) {
  if (value == null) return '?'
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return String(value)
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1)
}

function sortEpisodes(episodes) {
  return [...episodes].sort((a, b) => {
    const aNum = Number(a.episode_num ?? 0)
    const bNum = Number(b.episode_num ?? 0)
    if (aNum !== bNum) return aNum - bNum
    return String(a.file_path ?? '').localeCompare(String(b.file_path ?? ''), undefined, { numeric: true, sensitivity: 'base' })
  })
}

function buildEpisodeGroups(episodes) {
  const rootEpisodes = []
  const folders = new Map()

  for (const episode of episodes) {
    const folderName = (episode.folder_name ?? '').trim()
    if (!folderName) {
      rootEpisodes.push(episode)
      continue
    }

    if (!folders.has(folderName)) {
      folders.set(folderName, [])
    }
    folders.get(folderName).push(episode)
  }

  return {
    rootEpisodes: sortEpisodes(rootEpisodes),
    folders: Array.from(folders.entries())
      .map(([name, items]) => ({
        name,
        episodes: sortEpisodes(items),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
  }
}

function EpisodeRow({ ep, onPlay, isEnglish }) {
  const progress = ep.progress_s && ep.duration_s
    ? Math.min(100, (ep.progress_s / ep.duration_s) * 100)
    : 0

  return (
    <div className={`episode-row ${ep.watched ? 'episode-watched' : ''}`}>
      <div className="episode-num">
        {ep.watched
          ? <span className="ep-watched-dot" title={isEnglish ? 'Watched' : 'Visto'}>OK</span>
          : <span className="ep-num-label">{formatEpisodeLabel(ep.episode_num)}</span>
        }
      </div>

      <div className="episode-info">
        <div className="episode-title">
          {ep.title || `${isEnglish ? 'Episode' : 'Episodio'} ${formatEpisodeLabel(ep.episode_num)}`}
        </div>
        {progress > 0 && !ep.watched && (
          <div className="episode-progress-bar">
            <div className="episode-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
        {ep.progress_s > 0 && !ep.watched && (
          <div className="episode-resume-label">
            {isEnglish ? 'Resume at' : 'Reanudar en'} {formatTime(ep.progress_s)}
          </div>
        )}
      </div>

      <button
        className="btn btn-primary episode-play-btn"
        onClick={() => onPlay(ep.id)}
      >
        {ep.progress_s > 0 && !ep.watched
          ? (isEnglish ? 'Resume' : 'Reanudar')
          : (isEnglish ? 'Watch' : 'Ver')}
      </button>
    </div>
  )
}

function FolderCard({ folder, onOpen, isEnglish }) {
  const watchedCount = folder.episodes.filter((episode) => episode.watched).length

  return (
    <button type="button" className="anime-folder-card" onClick={() => onOpen(folder.name)}>
      <div className="anime-folder-card-copy">
        <div className="anime-folder-card-title">{folder.name}</div>
        <div className="anime-folder-card-meta">
          {folder.episodes.length} {isEnglish ? 'episodes' : 'episodios'}
          {watchedCount > 0 ? ` · ${watchedCount} ${isEnglish ? 'watched' : 'vistos'}` : ''}
        </div>
      </div>
      <div className="anime-folder-card-arrow">{'>'}</div>
    </button>
  )
}

export default function AnimeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [anime, setAnime] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [synopsisES, setSynopsisES] = useState(null)
  const [activeFolder, setActiveFolder] = useState('')

  const text = useMemo(() => ({
    notFound: isEnglish ? 'Not found' : 'No encontrado',
    opening: isEnglish ? 'Opening in MPV...' : 'Abriendo en MPV...',
    mpvMissing: isEnglish ? 'MPV not found. Check the path in Settings.' : 'MPV no encontrado. Verifica la ruta en Ajustes.',
    episodeMissing: isEnglish ? 'Episode not found. Try rescanning the library.' : 'Episodio no encontrado. Intenta reescanear la biblioteca.',
    playbackError: isEnglish ? 'Playback error' : 'Error al reproducir',
    confirmDelete: isEnglish
      ? `Remove "${anime?.display_title ?? ''}" from the local library?\n\nThis only removes the entry inside Nipah. It does not delete your files or your remote AniList entry.`
      : `¿Quitar "${anime?.display_title ?? ''}" de la biblioteca local?\n\nEsto solo elimina la entrada dentro de Nipah. No borra tus archivos ni tu entrada remota de AniList.`,
    removed: isEnglish ? 'Anime removed from the local library.' : 'Anime eliminado de la biblioteca local.',
    removeFailed: isEnglish ? 'Could not remove it' : 'No se pudo eliminar',
    unknownError: isEnglish ? 'unknown error' : 'error desconocido',
    back: isEnglish ? 'Back' : 'Volver',
    removing: isEnglish ? 'Removing...' : 'Eliminando...',
    removeLocal: isEnglish ? 'Remove from Local' : 'Eliminar de Local',
    watched: isEnglish ? 'watched' : 'vistos',
    episodes: isEnglish ? 'Episodes' : 'Episodios',
    goBack: isEnglish ? 'Go Back' : 'Volver',
    noSubfolderEpisodes: isEnglish ? 'No episodes were found in this subfolder.' : 'No se encontraron episodios en esta subcarpeta.',
    noRootEpisodes: isEnglish ? 'No main episodes were found in this folder.' : 'No se encontraron episodios principales en esta carpeta.',
  }), [isEnglish, anime?.display_title])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    wails.getAnimeDetail(parseInt(id, 10))
      .then((data) => {
        if (!data) throw new Error(text.notFound)
        setAnime(data)
      })
      .catch((e) => setError(e?.message ?? text.notFound))
      .finally(() => setLoading(false))
  }, [id, text.notFound])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    setActiveFolder('')
  }, [anime?.id])

  useEffect(() => {
    if (!anime || anime.synopsis_es) return
    const title = anime.title_romaji || anime.display_title
    if (!title) return
    wails.fetchAnimeSynopsisES(anime.id, title)
      .then((syn) => { if (syn) setSynopsisES(syn) })
      .catch(() => {})
  }, [anime])

  const handlePlay = useCallback(async (episodeID) => {
    try {
      await wails.playEpisode(episodeID)
      toastSuccess(text.opening)
    } catch (e) {
      const msg = e?.message ?? String(e)
      if (msg.includes('MPV') || msg.includes('player') || msg.includes('not found')) {
        toastError(text.mpvMissing)
      } else if (msg.includes('episode') || msg.includes('not found')) {
        toastError(text.episodeMissing)
      } else {
        toastError(`${text.playbackError}: ${msg}`)
      }
    }
  }, [text])

  const handleDelete = useCallback(async () => {
    if (!anime || deleting) return
    const confirmed = window.confirm(text.confirmDelete)
    if (!confirmed) return

    setDeleting(true)
    try {
      await wails.deleteLocalAnime(anime.id)
      toastSuccess(text.removed)
      navigate('/local?tab=anime')
    } catch (e) {
      toastError(`${text.removeFailed}: ${e?.message ?? text.unknownError}`)
      setDeleting(false)
    }
  }, [anime, deleting, navigate, text])

  const episodes = anime?.episodes ?? []
  const watchedCount = episodes.filter((ep) => ep.watched).length
  const synopsis = synopsisES || anime?.synopsis_es || anime?.synopsis

  const episodeGroups = useMemo(() => buildEpisodeGroups(episodes), [episodes])
  const selectedFolder = episodeGroups.folders.find((folder) => folder.name === activeFolder) ?? null
  const visibleEpisodes = activeFolder ? (selectedFolder?.episodes ?? []) : episodeGroups.rootEpisodes

  if (loading) {
    return (
      <div className="empty-state">
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-state-desc" style={{ color: 'var(--red)' }}>{error}</p>
        <button className="btn btn-ghost" onClick={() => navigate('/local?tab=anime')}>{`< ${text.back}`}</button>
      </div>
    )
  }

  if (!anime) return null

  return (
    <div className="fade-in anime-detail">
      <div className="detail-hero" style={anime.cover_image ? {
        backgroundImage: `linear-gradient(to bottom, rgba(10,10,14,0) 0%, rgba(10,10,14,0.15) 40%, rgba(10,10,14,0.7) 75%, rgba(10,10,14,0.95) 100%), url(${anime.cover_image})`,
      } : {}}>
        <div className="detail-back" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/local?tab=anime')}>
            {`< ${text.back}`}
          </button>
          <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? text.removing : text.removeLocal}
          </button>
        </div>

        <div className="detail-hero-content">
          {anime.cover_image && (
            <BlurhashImage
              src={anime.cover_image}
              blurhash={anime.cover_blurhash}
              alt={anime.display_title}
              imgClassName="detail-cover"
            />
          )}
          <div className="detail-info">
            <h1 className="detail-title">{anime.display_title}</h1>
            {anime.title_romaji && anime.title_spanish && (
              <div className="detail-subtitle">{anime.title_romaji}</div>
            )}
            <div className="detail-tags">
              {anime.year && <span className="badge badge-muted">{anime.year}</span>}
              {anime.status && <span className="badge badge-muted">{translateStatus(anime.status, isEnglish)}</span>}
              {anime.episodes_total > 0 && (
                <span className="badge badge-muted">{anime.episodes_total} eps</span>
              )}
              {watchedCount > 0 && (
                <span className="badge badge-green">{watchedCount} {text.watched}</span>
              )}
            </div>
            {synopsis && (
              <p className="detail-synopsis">{stripHTML(synopsis)}</p>
            )}
          </div>
        </div>
      </div>

      <div className="episode-list-section">
        <div className="section-header">
          <div className="anime-folder-heading">
            {activeFolder ? (
              <button type="button" className="btn btn-ghost btn-sm anime-folder-back-btn" onClick={() => setActiveFolder('')}>
                {`< ${text.goBack}`}
              </button>
            ) : null}
            <span className="section-title">
              {activeFolder ? activeFolder : text.episodes}
              <span className="badge badge-muted" style={{ marginLeft: 8 }}>
                {visibleEpisodes.length}
              </span>
            </span>
          </div>
          <div className="anime-folder-toolbar">
            {watchedCount > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {watchedCount}/{episodes.length} {text.watched}
              </span>
            )}
          </div>
        </div>

        {!activeFolder && episodeGroups.folders.length > 0 ? (
          <div className="anime-folder-grid">
            {episodeGroups.folders.map((folder) => (
              <FolderCard key={folder.name} folder={folder} onOpen={setActiveFolder} isEnglish={isEnglish} />
            ))}
          </div>
        ) : null}

        {visibleEpisodes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>
            {activeFolder ? text.noSubfolderEpisodes : text.noRootEpisodes}
          </div>
        ) : (
          <div className="episode-list">
            {visibleEpisodes.map((ep) => (
              <EpisodeRow
                key={ep.id}
                ep={ep}
                onPlay={handlePlay}
                isEnglish={isEnglish}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function translateStatus(status, isEnglish) {
  const map = isEnglish ? {
    FINISHED: 'Finished',
    RELEASING: 'Releasing',
    NOT_YET_RELEASED: 'Upcoming',
    CANCELLED: 'Cancelled',
    HIATUS: 'Hiatus',
  } : {
    FINISHED: 'Finalizado',
    RELEASING: 'En emision',
    NOT_YET_RELEASED: 'Proximamente',
    CANCELLED: 'Cancelado',
    HIATUS: 'En pausa',
  }
  return map[status] ?? status
}

function stripHTML(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim()
}
