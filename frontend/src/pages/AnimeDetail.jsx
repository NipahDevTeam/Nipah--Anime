import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { proxyImage, wails } from '../lib/wails'
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

function translateStatus(status, isEnglish) {
  const map = isEnglish ? {
    FINISHED: 'Finished',
    RELEASING: 'Currently airing',
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

function stripHTML(str = '') {
  return String(str).replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function progressPercent(watchedCount, totalCount) {
  if (!totalCount) return 0
  return Math.max(0, Math.min(100, Math.round((watchedCount / totalCount) * 100)))
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
    <button type="button" className="media-detail-folder-card" onClick={() => onOpen(folder.name)}>
      <div className="media-detail-folder-copy">
        <div className="media-detail-folder-title">{folder.name}</div>
        <div className="media-detail-folder-meta">
          {folder.episodes.length} {isEnglish ? 'episodes' : 'episodios'}
          {watchedCount > 0 ? ` · ${watchedCount} ${isEnglish ? 'watched' : 'vistos'}` : ''}
        </div>
      </div>
      <div className="media-detail-folder-arrow">{'>'}</div>
    </button>
  )
}

function DetailInfoCard({ title, rows }) {
  if (!rows?.length) return null

  return (
    <section className="media-detail-panel">
      <div className="media-detail-panel-title">{title}</div>
      <div className="media-detail-fact-list">
        {rows.map((row) => (
          <div key={row.label} className="media-detail-fact-row">
            <span className="media-detail-fact-label">{row.label}</span>
            <span className="media-detail-fact-value">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function CharacterPanel({ title, subtitle, characters = [], loading, emptyLabel }) {
  return (
    <section className="media-detail-panel">
      <div className="media-detail-panel-title">{title}</div>
      {subtitle ? <p className="media-detail-panel-copy">{subtitle}</p> : null}

      {loading ? (
        <div className="media-detail-empty-copy">{emptyLabel.loading}</div>
      ) : characters.length > 0 ? (
        <div className="media-detail-cast-list">
          {characters.map((character) => (
            <article key={`${character.id || character.name}-${character.role || ''}`} className="media-detail-cast-card">
              {character.image ? (
                <img src={proxyImage(character.image)} alt={character.name} className="media-detail-cast-avatar" />
              ) : (
                <div className="media-detail-cast-avatar media-detail-cast-avatar-placeholder">
                  {character.name?.slice(0, 1) || '?'}
                </div>
              )}
              <div className="media-detail-cast-body">
                <div className="media-detail-cast-role">{character.role === 'MAIN' ? emptyLabel.mainRole : emptyLabel.supportingRole}</div>
                <div className="media-detail-cast-name">{character.name}</div>
                {character.name_native ? <div className="media-detail-cast-native">{character.name_native}</div> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="media-detail-empty-copy">{emptyLabel.empty}</div>
      )}
    </section>
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
      : `Quitar "${anime?.display_title ?? ''}" de la biblioteca local?\n\nEsto solo elimina la entrada dentro de Nipah. No borra tus archivos ni tu entrada remota de AniList.`,
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
    continueWatching: isEnglish ? 'Continue watching' : 'Continuar viendo',
    startWatching: isEnglish ? 'Start watching' : 'Empezar a ver',
    localCollection: isEnglish ? 'Local collection' : 'Coleccion local',
    libraryStatus: isEnglish ? 'Library status' : 'Estado local',
    airingInfo: isEnglish ? 'Airing information' : 'Informacion',
    castTitle: isEnglish ? 'Cast' : 'Personajes',
    castCopy: isEnglish ? 'AniList cast data kept close to the episode queue.' : 'Datos de personajes de AniList junto a la cola de episodios.',
    castLoading: isEnglish ? 'Loading cast...' : 'Cargando personajes...',
    castEmpty: isEnglish ? 'No cast metadata is available for this title yet.' : 'Todavia no hay metadatos de personajes para este titulo.',
    supportingRole: isEnglish ? 'Supporting' : 'Secundario',
    mainRole: isEnglish ? 'Main' : 'Principal',
    folders: isEnglish ? 'Folders' : 'Carpetas',
    libraryProgress: isEnglish ? 'Library progress' : 'Progreso local',
    episodesReady: isEnglish ? 'Episodes ready' : 'Episodios listos',
    resumeAt: isEnglish ? 'Resume at' : 'Retomar en',
    foldersAvailable: isEnglish ? 'Folders available' : 'Carpetas detectadas',
    source: isEnglish ? 'Source' : 'Origen',
    score: isEnglish ? 'Score' : 'Puntuacion',
    format: isEnglish ? 'Format' : 'Formato',
    synopsisLabel: isEnglish ? 'Story' : 'Historia',
  }), [anime?.display_title, isEnglish])

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

  const aniListDetailQuery = useQuery({
    queryKey: ['local-anime-detail-anilist', Number(anime?.anilist_id || 0)],
    enabled: Number(anime?.anilist_id || 0) > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => wails.getAniListAnimeByID(Number(anime?.anilist_id || 0)),
  })

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
  const synopsis = stripHTML(synopsisES || anime?.synopsis_es || anime?.synopsis || aniListDetailQuery.data?.description || '')
  const episodeGroups = useMemo(() => buildEpisodeGroups(episodes), [episodes])
  const selectedFolder = episodeGroups.folders.find((folder) => folder.name === activeFolder) ?? null
  const visibleEpisodes = activeFolder ? (selectedFolder?.episodes ?? []) : episodeGroups.rootEpisodes
  const foldersCount = episodeGroups.folders.length
  const resumeEpisode = episodes.find((ep) => ep.progress_s > 0 && !ep.watched) ?? null
  const nextEpisode = resumeEpisode ?? episodes.find((ep) => !ep.watched) ?? episodes[0] ?? null
  const heroBackdrop = anime?.banner_image || aniListDetailQuery.data?.banner_image || anime?.cover_image || ''
  const characters = aniListDetailQuery.data?.characters ?? []
  const progressValue = progressPercent(watchedCount, episodes.length)

  const airingRows = [
    anime?.status || aniListDetailQuery.data?.status ? { label: text.airingInfo === 'Airing information' ? 'Status' : 'Estado', value: translateStatus(anime?.status || aniListDetailQuery.data?.status, isEnglish) } : null,
    anime?.year || aniListDetailQuery.data?.year ? { label: isEnglish ? 'Year' : 'Ano', value: String(anime?.year || aniListDetailQuery.data?.year) } : null,
    anime?.episodes_total || aniListDetailQuery.data?.episodes ? { label: text.episodes, value: String(anime?.episodes_total || aniListDetailQuery.data?.episodes) } : null,
    aniListDetailQuery.data?.score ? { label: text.score, value: String(aniListDetailQuery.data.score) } : null,
    aniListDetailQuery.data?.source ? { label: text.source, value: aniListDetailQuery.data.source } : null,
  ].filter(Boolean)

  const libraryRows = [
    { label: text.libraryProgress, value: `${watchedCount}/${episodes.length || 0}` },
    { label: text.foldersAvailable, value: String(foldersCount) },
    nextEpisode ? { label: text.episodesReady, value: `${isEnglish ? 'Ep.' : 'Ep.'} ${formatEpisodeLabel(nextEpisode.episode_num)}` } : null,
    resumeEpisode ? { label: text.resumeAt, value: formatTime(resumeEpisode.progress_s) } : null,
  ].filter(Boolean)

  const headlineFacts = [
    anime?.year || aniListDetailQuery.data?.year ? String(anime?.year || aniListDetailQuery.data?.year) : null,
    anime?.episodes_total || aniListDetailQuery.data?.episodes ? `${anime?.episodes_total || aniListDetailQuery.data?.episodes} ${isEnglish ? 'Episodes' : 'Episodios'}` : null,
    anime?.status || aniListDetailQuery.data?.status ? translateStatus(anime?.status || aniListDetailQuery.data?.status, isEnglish) : null,
    aniListDetailQuery.data?.genres?.length ? aniListDetailQuery.data.genres.slice(0, 3).join(', ') : null,
  ].filter(Boolean)

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
    <div className="fade-in media-detail-page media-detail-page--local">
      <section
        className="media-detail-hero"
        style={heroBackdrop ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.18) 0%, rgba(7,7,10,0.72) 40%, rgba(7,7,10,0.94) 78%, rgba(7,7,10,0.98) 100%), radial-gradient(circle at top right, rgba(245,166,35,0.14) 0%, rgba(245,166,35,0) 34%), url(${heroBackdrop})`,
        } : {}}
      >
        <div className="media-detail-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={() => navigate('/local?tab=anime')}>
            {`< ${text.back}`}
          </button>
          <div className="media-detail-toolbar-actions">
            {nextEpisode ? (
              <button className="btn btn-primary media-detail-primary-btn" onClick={() => handlePlay(nextEpisode.id)}>
                {resumeEpisode ? text.continueWatching : text.startWatching}
              </button>
            ) : null}
            <button className="btn btn-ghost media-detail-danger-btn" onClick={handleDelete} disabled={deleting}>
              {deleting ? text.removing : text.removeLocal}
            </button>
          </div>
        </div>

        <div className="media-detail-hero-grid">
          {anime.cover_image ? (
            <BlurhashImage
              src={anime.cover_image}
              blurhash={anime.cover_blurhash}
              alt={anime.display_title}
              imgClassName="media-detail-cover"
            />
          ) : null}

          <div className="media-detail-hero-copy">
            <div className="media-detail-kicker">{text.localCollection}</div>
            <h1 className="media-detail-title">{anime.display_title}</h1>
            {anime.title_romaji && anime.title_romaji !== anime.display_title ? (
              <div className="media-detail-subtitle">{anime.title_romaji}</div>
            ) : null}
            {headlineFacts.length > 0 ? (
              <div className="media-detail-facts-strip">
                {headlineFacts.map((fact) => <span key={fact} className="media-detail-fact-chip">{fact}</span>)}
              </div>
            ) : null}
            {synopsis ? (
              <div className="media-detail-story-block">
                <div className="media-detail-story-label">{text.synopsisLabel}</div>
                <p className="media-detail-synopsis">{synopsis}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="media-detail-content-grid">
        <div className="media-detail-main">
          <section className="media-detail-panel media-detail-progress-panel">
            <div className="media-detail-progress-head">
              <div>
                <div className="media-detail-panel-title">{text.libraryProgress}</div>
                <p className="media-detail-panel-copy">
                  {watchedCount}/{episodes.length || 0} {text.watched}
                </p>
              </div>
              <div className="media-detail-progress-value">{progressValue}%</div>
            </div>
            <div className="media-detail-progress-track">
              <div className="media-detail-progress-fill" style={{ width: `${progressValue}%` }} />
            </div>
            {nextEpisode ? (
              <div className="media-detail-resume-card">
                <div className="media-detail-resume-copy">
                  <div className="media-detail-resume-label">{resumeEpisode ? text.continueWatching : text.startWatching}</div>
                  <div className="media-detail-resume-title">
                    {nextEpisode.title || `${isEnglish ? 'Episode' : 'Episodio'} ${formatEpisodeLabel(nextEpisode.episode_num)}`}
                  </div>
                  {resumeEpisode?.progress_s ? (
                    <div className="media-detail-resume-meta">{text.resumeAt} {formatTime(resumeEpisode.progress_s)}</div>
                  ) : null}
                </div>
                <button className="btn btn-primary media-detail-primary-btn" onClick={() => handlePlay(nextEpisode.id)}>
                  {resumeEpisode ? text.continueWatching : text.startWatching}
                </button>
              </div>
            ) : null}
          </section>

          <section className="media-detail-panel">
            <div className="media-detail-section-head">
              <div className="media-detail-panel-title">
                {activeFolder ? activeFolder : text.episodes}
                <span className="media-detail-count-pill">{visibleEpisodes.length}</span>
              </div>
              {activeFolder ? (
                <button type="button" className="btn btn-ghost media-detail-inline-btn" onClick={() => setActiveFolder('')}>
                  {`< ${text.goBack}`}
                </button>
              ) : (
                watchedCount > 0 ? <div className="media-detail-panel-note">{watchedCount}/{episodes.length} {text.watched}</div> : null
              )}
            </div>

            {!activeFolder && episodeGroups.folders.length > 0 ? (
              <div className="media-detail-folder-grid">
                {episodeGroups.folders.map((folder) => (
                  <FolderCard key={folder.name} folder={folder} onOpen={setActiveFolder} isEnglish={isEnglish} />
                ))}
              </div>
            ) : null}

            {visibleEpisodes.length === 0 ? (
              <div className="media-detail-empty-copy">
                {activeFolder ? text.noSubfolderEpisodes : text.noRootEpisodes}
              </div>
            ) : (
              <div className="episode-list media-detail-episode-list">
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
          </section>
        </div>

        <aside className="media-detail-aside">
          <DetailInfoCard title={text.libraryStatus} rows={libraryRows} />
          <DetailInfoCard title={text.airingInfo} rows={airingRows} />
          <CharacterPanel
            title={text.castTitle}
            subtitle={text.castCopy}
            characters={characters}
            loading={aniListDetailQuery.isLoading}
            emptyLabel={{
              loading: text.castLoading,
              empty: text.castEmpty,
              mainRole: text.mainRole,
              supportingRole: text.supportingRole,
            }}
          />
        </aside>
      </div>
    </div>
  )
}
