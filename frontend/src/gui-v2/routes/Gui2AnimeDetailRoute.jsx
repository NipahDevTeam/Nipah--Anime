import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toastError, toastSuccess } from '../../components/ui/Toast'
import { useI18n } from '../../lib/i18n'
import { proxyImage, wails } from '../../lib/wails'
import { withGui2Prefix } from '../routeRegistry'

function formatEpisodeLabel(value) {
  if (value == null) return '?'
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return String(value)
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1)
}

function formatTime(seconds) {
  if (!seconds) return ''
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function stripHtml(html = '') {
  return String(html)
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

function sortEpisodes(episodes = []) {
  return [...episodes].sort((a, b) => {
    const aNum = Number(a.episode_num ?? 0)
    const bNum = Number(b.episode_num ?? 0)
    if (aNum !== bNum) return aNum - bNum
    return String(a.file_path ?? '').localeCompare(String(b.file_path ?? ''), undefined, { numeric: true, sensitivity: 'base' })
  })
}

function buildEpisodeGroups(episodes = []) {
  const rootEpisodes = []
  const folders = new Map()

  for (const episode of episodes) {
    const folderName = String(episode.folder_name || '').trim()
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
      .map(([name, items]) => ({ name, episodes: sortEpisodes(items) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
  }
}

function progressPercent(completed, total) {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
}

function detailValue(value, fallback = '-') {
  if (value == null || value === '') return fallback
  return String(value)
}

function getTitlePart(detail, key) {
  if (!detail) return ''
  return detail[key] || detail?.title?.[key.replace('title_', '')] || detail?.title?.[key]
}

function LandingFactList({ rows }) {
  return (
    <div className="gui2-landing-fact-grid">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="gui2-landing-fact-card">
          <span className="gui2-landing-fact-label">{row.label}</span>
          <strong className="gui2-landing-fact-value">{row.value}</strong>
        </div>
      ))}
    </div>
  )
}

function LandingMetaPanel({ title, rows }) {
  return (
    <section className="gui2-landing-panel gui2-landing-meta-panel">
      <div className="gui2-landing-section-head">
        <h3 className="gui2-landing-section-title">{title}</h3>
      </div>
      <div className="gui2-landing-meta-list">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="gui2-landing-meta-row">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function LandingCharacterStrip({ characters, title, actionLabel, emptyLabel, isEnglish }) {
  return (
    <section className="gui2-landing-panel">
      <div className="gui2-landing-section-head">
        <h3 className="gui2-landing-section-title">{title}</h3>
        {characters.length > 0 ? <span className="gui2-landing-section-link">{actionLabel}</span> : null}
      </div>
      {characters.length > 0 ? (
        <div className="gui2-landing-character-strip">
          {characters.slice(0, 6).map((character) => {
            const image = character.image || character.image_url || ''
            const role = character.role === 'MAIN'
              ? (isEnglish ? 'Main' : 'Principal')
              : (isEnglish ? 'Supporting' : 'Secundario')
            return (
              <article key={`${character.id || character.name}-${character.role || ''}`} className="gui2-landing-character-card">
                {image ? (
                  <img src={proxyImage(image)} alt={character.name} className="gui2-landing-character-art" />
                ) : (
                  <div className="gui2-landing-character-art gui2-landing-character-art--placeholder">{character.name?.slice(0, 1) || '?'}</div>
                )}
                <div className="gui2-landing-character-copy">
                  <div className="gui2-landing-character-name">{character.name}</div>
                  <div className="gui2-landing-character-role">{role}</div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="gui2-inline-empty">{emptyLabel}</div>
      )}
    </section>
  )
}

function LocalAnimeEpisodeRow({ episode, totalEpisodes, artwork, sourceName, onWatch, isEnglish }) {
  const hasProgress = episode.progress_s > 0 && !episode.watched
  const progressValue = hasProgress && episode.duration_s > 0
    ? Math.round((episode.progress_s / episode.duration_s) * 100)
    : 0

  return (
    <article className={`gui2-landing-episode-row${episode.watched ? ' gui2-landing-episode-row--watched' : ''}`} onClick={() => onWatch(episode)} style={{ cursor: 'pointer' }}>
      <div className="gui2-landing-episode-media">
        {artwork ? (
          <div className="gui2-landing-episode-thumb" style={{ backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.1) 0%, rgba(7,7,10,0.52) 100%), url(${artwork})` }} />
        ) : (
          <div className="gui2-landing-episode-thumb gui2-landing-episode-thumb--placeholder">{isEnglish ? 'No artwork' : 'Sin arte'}</div>
        )}
        <div className="gui2-landing-episode-number">{`${isEnglish ? 'Ep' : 'Ep'} ${formatEpisodeLabel(episode.episode_num)}`}</div>
      </div>

      <div className="gui2-landing-episode-copy">
        <div className="gui2-landing-episode-meta">
          <span>{sourceName}</span>
          <span>{`${isEnglish ? 'Episode' : 'Episodio'} ${formatEpisodeLabel(episode.episode_num)} / ${totalEpisodes}`}</span>
          <span>{episode.watched ? (isEnglish ? 'Watched' : 'Visto') : hasProgress ? `${progressValue}%` : (isEnglish ? 'Ready' : 'Listo')}</span>
        </div>
        <div className="gui2-landing-episode-title">{episode.title || `${isEnglish ? 'Episode' : 'Episodio'} ${formatEpisodeLabel(episode.episode_num)}`}</div>
        <div className="gui2-landing-episode-description">
          {hasProgress
            ? `${isEnglish ? 'Resume at' : 'Retomar en'} ${formatTime(episode.progress_s)}`
            : episode.watched
              ? (isEnglish ? 'Completed in your local library.' : 'Completado en tu biblioteca local.')
              : (isEnglish ? 'Stored locally and ready for playback.' : 'Guardado localmente y listo para reproducir.')}
        </div>
      </div>

      <div className="gui2-landing-episode-actions">
        <button
          type="button"
          className={`btn ${hasProgress ? 'btn-ghost' : 'btn-primary'} media-detail-primary-btn`}
          onClick={(event) => {
            event.stopPropagation()
            onWatch(episode)
          }}
        >
          {hasProgress ? (isEnglish ? 'Continue' : 'Continuar') : episode.watched ? (isEnglish ? 'Watch Again' : 'Ver de nuevo') : (isEnglish ? 'Watch' : 'Ver')}
        </button>
      </div>
    </article>
  )
}

function LocalAnimeFolderCard({ folder, onOpen, isEnglish }) {
  const watchedCount = folder.episodes.filter((episode) => episode.watched).length

  return (
    <button type="button" className="gui2-local-folder-card" onClick={() => onOpen(folder.name)}>
      <div className="gui2-local-folder-copy">
        <div className="gui2-local-folder-title">{folder.name}</div>
        <div className="gui2-local-folder-meta">
          {folder.episodes.length} {isEnglish ? 'episodes' : 'episodios'}
          <span>{watchedCount}/{folder.episodes.length} {isEnglish ? 'watched' : 'vistos'}</span>
        </div>
      </div>
      <div className="gui2-local-folder-arrow" aria-hidden="true">{'>'}</div>
    </button>
  )
}

export default function Gui2AnimeDetailRoute({ mediaID, preview = false }) {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [activeFolder, setActiveFolder] = useState('')
  const localPath = withGui2Prefix('/local', preview)
  const numericID = Number(mediaID || 0)

  const animeQuery = useQuery({
    queryKey: ['gui2-anime-detail', numericID],
    enabled: numericID > 0,
    queryFn: async () => {
      const data = await wails.getAnimeDetail(numericID)
      if (!data) throw new Error(isEnglish ? 'Not found' : 'No encontrado')
      return data
    },
    staleTime: 60_000,
  })

  const metaQuery = useQuery({
    queryKey: ['gui2-anime-detail-anilist', Number(animeQuery.data?.anilist_id || 0)],
    enabled: Number(animeQuery.data?.anilist_id || 0) > 0,
    queryFn: () => wails.getAniListAnimeByID(Number(animeQuery.data?.anilist_id || 0)),
    staleTime: 10 * 60_000,
  })

  const synopsisQuery = useQuery({
    queryKey: ['gui2-anime-detail-synopsis-es', numericID, animeQuery.data?.title_romaji || animeQuery.data?.display_title || ''],
    enabled: numericID > 0 && Boolean(animeQuery.data?.title_romaji || animeQuery.data?.display_title),
    queryFn: () => wails.fetchAnimeSynopsisES(numericID, animeQuery.data?.title_romaji || animeQuery.data?.display_title || ''),
    staleTime: 60 * 60_000,
  })

  const anime = animeQuery.data
  const detail = metaQuery.data

  const episodes = useMemo(() => sortEpisodes(anime?.episodes ?? []), [anime?.episodes])
  const episodeGroups = useMemo(() => buildEpisodeGroups(episodes), [episodes])
  const selectedFolder = episodeGroups.folders.find((folder) => folder.name === activeFolder) ?? null
  const visibleEpisodes = activeFolder ? (selectedFolder?.episodes ?? []) : episodeGroups.rootEpisodes
  const watchedCount = episodes.filter((episode) => episode.watched).length
  const resumeEpisode = episodes.find((episode) => episode.progress_s > 0 && !episode.watched) ?? null
  const nextEpisode = resumeEpisode ?? episodes.find((episode) => !episode.watched) ?? episodes[0] ?? null
  const progressValue = progressPercent(watchedCount, episodes.length || anime?.episodes_total || detail?.episodes || 0)
  const synopsis = stripHtml(synopsisQuery.data || anime?.synopsis_es || detail?.description || '')
  const title = anime?.display_title || anime?.title_english || getTitlePart(detail, 'title_english') || getTitlePart(detail, 'title_romaji') || 'Anime'
  const titleNative = getTitlePart(detail, 'title_native')
  const subtitle = anime?.title_romaji && anime.title_romaji !== title
    ? anime.title_romaji
    : (titleNative && titleNative !== title ? titleNative : '')
  const coverImage = anime?.cover_image || detail?.cover_large || detail?.coverImage?.extraLarge || detail?.coverImage?.large || ''
  const bannerImage = anime?.banner_image || detail?.banner_image || detail?.bannerImage || coverImage || ''
  const heroFacts = [
    anime?.year > 0 ? String(anime.year) : null,
    (anime?.episodes_total || detail?.episodes) ? `${anime?.episodes_total || detail?.episodes} ${isEnglish ? 'episodes' : 'episodios'}` : null,
    anime?.status || detail?.status ? translateStatus(anime?.status || detail?.status, isEnglish) : null,
    (detail?.genres || anime?.genres)?.length ? (detail?.genres || anime?.genres).slice(0, 3).join(' / ') : null,
  ].filter(Boolean)
  const characters = detail?.characters ?? []

  const airingInfoRows = [
    { label: isEnglish ? 'Status' : 'Estado', value: detailValue(translateStatus(anime?.status || detail?.status, isEnglish)) },
    { label: isEnglish ? 'Episodes ready' : 'Episodios listos', value: detailValue(episodes.length || anime?.episodes_total || detail?.episodes) },
    nextEpisode ? { label: isEnglish ? 'Next up' : 'Siguiente', value: `${isEnglish ? 'Episode' : 'Episodio'} ${formatEpisodeLabel(nextEpisode.episode_num)}` } : null,
    resumeEpisode ? { label: isEnglish ? 'Resume at' : 'Retomar en', value: formatTime(resumeEpisode.progress_s) } : null,
  ].filter(Boolean)

  const detailRows = [
    { label: isEnglish ? 'Format' : 'Formato', value: detailValue(detail?.format || 'TV Series') },
    { label: isEnglish ? 'Year' : 'Ano', value: detailValue(anime?.year || detail?.year) },
    { label: isEnglish ? 'Score' : 'Puntuacion', value: detailValue(detail?.score || detail?.average_score, '-') },
    { label: isEnglish ? 'Progress' : 'Progreso', value: `${progressValue}%` },
  ]

  const moreInfoRows = [
    { label: isEnglish ? 'Watched locally' : 'Vistos', value: detailValue(watchedCount) },
    { label: isEnglish ? 'Episodes total' : 'Total episodios', value: detailValue(anime?.episodes_total || detail?.episodes) },
    { label: isEnglish ? 'AniList ID' : 'AniList ID', value: detailValue(anime?.anilist_id || detail?.anilist_id) },
    { label: isEnglish ? 'MAL ID' : 'MAL ID', value: detailValue(anime?.mal_id || detail?.mal_id) },
  ]

  useEffect(() => {
    setActiveFolder('')
  }, [numericID])

  const handlePlay = async (episode) => {
    try {
      await wails.playEpisode(episode.id)
      toastSuccess(isEnglish ? 'Opening in MPV...' : 'Abriendo en MPV...')
    } catch (error) {
      const message = error?.message ?? String(error)
      if (message.toLowerCase().includes('mpv') || message.toLowerCase().includes('player') || message.toLowerCase().includes('not found')) {
        toastError(isEnglish ? 'MPV not found. Check the path in Settings.' : 'MPV no encontrado. Revisa la ruta en Ajustes.')
        return
      }
      toastError(`${isEnglish ? 'Playback error' : 'Error al reproducir'}: ${message}`)
    }
  }

  const handleDelete = async () => {
    if (!anime) return
    const confirmed = window.confirm(
      isEnglish
        ? `Remove "${anime.display_title || title}" from the local library?\n\nThis only removes the entry inside Nipah.`
        : `Quitar "${anime.display_title || title}" de la biblioteca local?\n\nEsto solo elimina la entrada dentro de Nipah.`,
    )
    if (!confirmed) return

    try {
      await wails.deleteLocalAnime(anime.id)
      toastSuccess(isEnglish ? 'Anime removed from local.' : 'Anime eliminado del local.')
      navigate(localPath)
    } catch (error) {
      toastError(`${isEnglish ? 'Could not remove it' : 'No se pudo eliminar'}: ${error?.message ?? 'unknown error'}`)
    }
  }

  if (animeQuery.isLoading) {
    return (
      <div className="gui2-route-loading">
        <div className="gui2-loading-dots"><span /><span /><span /></div>
      </div>
    )
  }

  if (animeQuery.isError || !anime) {
    return (
      <section className="gui2-empty-panel">
        <div className="gui2-empty-title">{animeQuery.error?.message || (isEnglish ? 'Not found' : 'No encontrado')}</div>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(localPath)}>
          {isEnglish ? 'Back to Local' : 'Volver a Local'}
        </button>
      </section>
    )
  }

  const heroBackground = bannerImage ? proxyImage(bannerImage) : ''

  return (
    <div className="fade-in gui2-landing-page gui2-landing-page--anime">
      <section
        className="gui2-landing-hero"
        style={heroBackground ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.16) 0%, rgba(7,7,10,0.76) 44%, rgba(7,7,10,0.97) 82%, rgba(7,7,10,0.99) 100%), radial-gradient(circle at top right, rgba(63, 116, 189, 0.2) 0%, rgba(63, 116, 189, 0) 34%), url(${heroBackground})`,
        } : {}}
      >
        <div className="gui2-landing-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={() => navigate(localPath)}>
            {isEnglish ? 'Back to Local' : 'Volver a Local'}
          </button>
        </div>

        <div className="gui2-landing-hero-grid gui2-landing-hero-grid--anime">
          {coverImage ? (
            <div className="gui2-landing-cover-wrap">
              <img src={proxyImage(coverImage)} alt={title} className="gui2-landing-cover gui2-landing-cover--round" />
            </div>
          ) : null}

          <div className="gui2-landing-copy">
            <div className="gui2-landing-kicker">{isEnglish ? 'Anime' : 'Anime'}</div>
            <h1 className="gui2-landing-title">{title}</h1>
            {subtitle ? <div className="gui2-landing-subtitle">{subtitle}</div> : null}
            {heroFacts.length ? (
              <div className="gui2-landing-facts-inline">
                {heroFacts.map((fact, index) => (
                  <span key={`${fact}-${index}`} className="gui2-landing-inline-fact">{fact}</span>
                ))}
              </div>
            ) : null}
            {synopsis ? <p className="gui2-landing-story">{synopsis}</p> : null}

            <div className="gui2-landing-actions">
              {nextEpisode ? (
                <button className="btn btn-primary gui2-landing-primary-btn" type="button" onClick={() => handlePlay(nextEpisode)}>
                  {resumeEpisode ? (isEnglish ? 'Continue Watching' : 'Continuar viendo') : (isEnglish ? 'Start Watching' : 'Empezar a ver')}
                </button>
              ) : null}
              <button className="btn btn-ghost gui2-landing-secondary-btn" type="button" onClick={handleDelete}>
                {isEnglish ? 'Remove from Library' : 'Eliminar de la biblioteca'}
              </button>
            </div>
          </div>

          <aside className="gui2-landing-sidecard">
            <h3 className="gui2-landing-sidecard-title">{isEnglish ? 'Details' : 'Detalles'}</h3>
            <div className="gui2-landing-sidecard-list">
              {detailRows.map((row) => (
                <div key={`detail-${row.label}`} className="gui2-landing-sidecard-row">
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <div className="gui2-landing-workspace">
        <div className="gui2-landing-main">
          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head">
              <h3 className="gui2-landing-section-title">{isEnglish ? 'Airing Info' : 'Informacion de emision'}</h3>
            </div>
            <LandingFactList rows={airingInfoRows} />
          </section>

          <LandingCharacterStrip
            characters={characters}
            title={isEnglish ? 'Cast' : 'Personajes'}
            actionLabel={isEnglish ? 'View all' : 'Ver todos'}
            emptyLabel={isEnglish ? 'No cast metadata is available for this title yet.' : 'Todavia no hay metadatos de personajes para este titulo.'}
            isEnglish={isEnglish}
          />

          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head gui2-landing-section-head--split">
              <div>
                <h3 className="gui2-landing-section-title">
                  {activeFolder || (isEnglish ? 'Episode Queue' : 'Cola de episodios')}
                </h3>
                <p className="gui2-landing-section-copy">
                  {activeFolder
                    ? (isEnglish ? 'This subfolder keeps its own episode run intact.' : 'Esta subcarpeta conserva su propia secuencia de episodios.')
                    : resumeEpisode
                      ? `${isEnglish ? 'Resume from' : 'Retomar desde'} ${formatTime(resumeEpisode.progress_s)}`
                      : (isEnglish ? 'Every local episode is ready for playback.' : 'Todos los episodios locales estan listos para reproducir.')}
                </p>
              </div>
              <div className="gui2-landing-section-tools gui2-landing-section-tools--wrap">
                {activeFolder ? (
                  <button type="button" className="btn btn-ghost" onClick={() => setActiveFolder('')}>
                    {isEnglish ? 'Show all folders' : 'Ver todas las carpetas'}
                  </button>
                ) : null}
                {episodes.length > 0 ? <span className="media-detail-count-pill">{activeFolder ? visibleEpisodes.length : episodes.length}</span> : null}
              </div>
            </div>

            {!activeFolder && episodeGroups.folders.length > 0 ? (
              <div className="gui2-local-folder-grid">
                {episodeGroups.folders.map((folder) => (
                  <LocalAnimeFolderCard key={folder.name} folder={folder} onOpen={setActiveFolder} isEnglish={isEnglish} />
                ))}
              </div>
            ) : null}

            {visibleEpisodes.length ? (
              <div className="gui2-landing-episode-list">
                {visibleEpisodes.map((episode) => (
                  <LocalAnimeEpisodeRow
                    key={episode.id}
                    episode={episode}
                    totalEpisodes={visibleEpisodes.length}
                    artwork={heroBackground}
                    sourceName={activeFolder || (isEnglish ? 'Local Library' : 'Biblioteca local')}
                    onWatch={handlePlay}
                    isEnglish={isEnglish}
                  />
                ))}
              </div>
            ) : (
              <div className="gui2-inline-empty">
                {activeFolder
                  ? (isEnglish ? 'No episodes were found in this subfolder.' : 'No se encontraron episodios en esta subcarpeta.')
                  : (isEnglish ? 'No episodes were found in this folder.' : 'No se encontraron episodios en esta carpeta.')}
              </div>
            )}
          </section>
        </div>

        <aside className="gui2-landing-aside">
          <LandingMetaPanel title={isEnglish ? 'Details' : 'Detalles'} rows={detailRows} />
          <LandingMetaPanel title={isEnglish ? 'More Info' : 'Mas informacion'} rows={moreInfoRows} />
        </aside>
      </div>
    </div>
  )
}
