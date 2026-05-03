import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { proxyImage, wails } from '../lib/wails'
import { toastError } from '../components/ui/Toast'
import BlurhashImage from '../components/ui/BlurhashImage'
import { useI18n } from '../lib/i18n'

function stripHTML(str = '') {
  return String(str).replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function translateStatus(status, isEnglish) {
  const map = isEnglish
    ? { completed: 'Completed', ongoing: 'Ongoing', hiatus: 'Hiatus', cancelled: 'Cancelled' }
    : { completed: 'Completado', ongoing: 'En curso', hiatus: 'En pausa', cancelled: 'Cancelado' }
  return map[status?.toLowerCase()] ?? status
}

function progressPercent(readCount, totalCount) {
  if (!totalCount) return 0
  return Math.max(0, Math.min(100, Math.round((readCount / totalCount) * 100)))
}

function DetailInfoCard({ title, rows, children = null }) {
  if ((!rows || rows.length === 0) && !children) return null
  return (
    <section className="media-detail-panel">
      <div className="media-detail-panel-title">{title}</div>
      {rows?.length ? (
        <div className="media-detail-fact-list">
          {rows.map((row) => (
            <div key={row.label} className="media-detail-fact-row">
              <span className="media-detail-fact-label">{row.label}</span>
              <span className="media-detail-fact-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function CharacterPanel({ title, subtitle, characters = [], loading, labels }) {
  return (
    <section className="media-detail-panel">
      <div className="media-detail-panel-title">{title}</div>
      {subtitle ? <p className="media-detail-panel-copy">{subtitle}</p> : null}

      {loading ? (
        <div className="media-detail-empty-copy">{labels.loading}</div>
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
                <div className="media-detail-cast-role">{character.role === 'MAIN' ? labels.mainRole : labels.supportingRole}</div>
                <div className="media-detail-cast-name">{character.name}</div>
                {character.name_native ? <div className="media-detail-cast-native">{character.name_native}</div> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="media-detail-empty-copy">{labels.empty}</div>
      )}
    </section>
  )
}

function ChapterRow({ ch, onOpen, isEnglish }) {
  return (
    <div className={`episode-row ${ch.read ? 'episode-watched' : ''}`}>
      <div className="episode-num">
        {ch.read
          ? <span className="ep-watched-dot" title={isEnglish ? 'Read' : 'Leido'}>OK</span>
          : <span className="ep-num-label">{ch.chapter_num ?? '?'}</span>
        }
      </div>

      <div className="episode-info">
        <div className="episode-title">
          {ch.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${ch.chapter_num ?? '?'}`}
        </div>
        {ch.progress_page > 0 && !ch.read ? (
          <div className="episode-resume-label">
            {isEnglish ? 'Page' : 'Pagina'} {ch.progress_page}
          </div>
        ) : null}
      </div>

      <button
        className="btn btn-primary episode-play-btn"
        onClick={() => onOpen(ch)}
      >
        {ch.progress_page > 0 && !ch.read
          ? (isEnglish ? 'Continue' : 'Continuar')
          : (isEnglish ? 'Read' : 'Leer')}
      </button>
    </div>
  )
}

export default function MangaDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [manga, setManga] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const text = useMemo(() => ({
    notFound: isEnglish ? 'Not found' : 'No encontrado',
    loadError: isEnglish ? 'Could not load this manga.' : 'No se pudo cargar este manga.',
    back: isEnglish ? 'Back' : 'Volver',
    localCollection: isEnglish ? 'Local collection' : 'Coleccion local',
    continueReading: isEnglish ? 'Continue reading' : 'Continuar leyendo',
    startReading: isEnglish ? 'Start reading' : 'Empezar a leer',
    chapters: isEnglish ? 'Chapters' : 'Capitulos',
    read: isEnglish ? 'read' : 'leidos',
    readingStatus: isEnglish ? 'Reading status' : 'Estado de lectura',
    sourceInfo: isEnglish ? 'Source access' : 'Acceso a fuente',
    castTitle: isEnglish ? 'Cast' : 'Personajes',
    castCopy: isEnglish ? 'AniList character context for the library version.' : 'Contexto de personajes de AniList para la version local.',
    castLoading: isEnglish ? 'Loading cast...' : 'Cargando personajes...',
    castEmpty: isEnglish ? 'No character metadata is available for this title yet.' : 'Todavia no hay metadatos de personajes para este titulo.',
    mainRole: isEnglish ? 'Main' : 'Principal',
    supportingRole: isEnglish ? 'Supporting' : 'Secundario',
    chaptersReady: isEnglish ? 'Chapters ready' : 'Capitulos listos',
    sourceLabel: isEnglish ? 'Source' : 'Origen',
    synopsisLabel: isEnglish ? 'Story' : 'Historia',
    readOnline: isEnglish ? 'Read online' : 'Leer online',
    localReaderPending: isEnglish ? 'The local reader is coming soon. Use Manga Online for now.' : 'El lector local llegara pronto. Usa Manga Online por ahora.',
    noChapters: isEnglish ? 'No chapters were found in this folder.' : 'No se encontraron capitulos en esta carpeta.',
  }), [isEnglish])

  useEffect(() => {
    wails.getMangaDetail(parseInt(id, 10))
      .then((data) => {
        if (!data) throw new Error(text.notFound)
        setManga(data)
      })
      .catch((e) => setError(e?.message ?? text.loadError))
      .finally(() => setLoading(false))
  }, [id, text.loadError, text.notFound])

  const mangaMetaQuery = useQuery({
    queryKey: ['local-manga-detail-anilist', Number(manga?.anilist_id || 0)],
    enabled: Number(manga?.anilist_id || 0) > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => wails.getAniListMangaByID(Number(manga?.anilist_id || 0)),
  })

  const handleOpen = useCallback(() => {
    toastError(text.localReaderPending)
  }, [text.localReaderPending])

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
        <button className="btn btn-ghost" onClick={() => navigate('/local?tab=manga')}>{`< ${text.back}`}</button>
      </div>
    )
  }

  if (!manga) return null

  const chapters = manga.chapters ?? []
  const readCount = chapters.filter((chapter) => chapter.read).length
  const resumeChapter = chapters.find((chapter) => chapter.progress_page > 0 && !chapter.read) ?? null
  const nextChapter = resumeChapter ?? chapters.find((chapter) => !chapter.read) ?? chapters[0] ?? null
  const detail = mangaMetaQuery.data
  const heroBackdrop = detail?.banner_image || manga.banner_image || manga.cover_image || ''
  const title = manga.display_title || detail?.title_english || detail?.title_romaji || 'Manga'
  const subtitle = manga.title_romaji && manga.title_romaji !== title ? manga.title_romaji : (detail?.title_romaji && detail.title_romaji !== title ? detail.title_romaji : '')
  const synopsis = stripHTML(manga.synopsis_es || detail?.description || '')
  const progressValue = progressPercent(readCount, chapters.length || manga.chapters_total || detail?.chapters || 0)
  const characters = detail?.characters ?? []

  const headlineFacts = [
    manga.year > 0 ? String(manga.year) : (detail?.year ? String(detail.year) : null),
    (manga.chapters_total || detail?.chapters) ? `${manga.chapters_total || detail?.chapters} ${text.chapters}` : null,
    manga.status || detail?.status ? translateStatus(manga.status || detail?.status, isEnglish) : null,
    detail?.genres?.length ? detail.genres.slice(0, 3).join(', ') : null,
  ].filter(Boolean)

  const readingRows = [
    { label: text.chapters, value: String(chapters.length || manga.chapters_total || detail?.chapters || 0) },
    { label: text.readingStatus, value: `${readCount}/${chapters.length || manga.chapters_total || detail?.chapters || 0}` },
    resumeChapter ? { label: isEnglish ? 'Resume on' : 'Retomar en', value: `${text.chapters.slice(0, -1)} ${resumeChapter.chapter_num ?? '?'}` } : null,
    detail?.volumes ? { label: isEnglish ? 'Volumes' : 'Volumenes', value: String(detail.volumes) } : null,
  ].filter(Boolean)

  const sourceRows = [
    { label: text.sourceLabel, value: manga.mangadex_id ? 'MangaDex' : '-' },
    { label: isEnglish ? 'Status' : 'Estado', value: translateStatus(manga.status || detail?.status || '', isEnglish) || '-' },
    manga.year > 0 || detail?.year ? { label: isEnglish ? 'Year' : 'Ano', value: String(manga.year || detail?.year) } : null,
  ].filter(Boolean)

  return (
    <div className="fade-in media-detail-page media-detail-page--local">
      <section
        className="media-detail-hero"
        style={heroBackdrop ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.18) 0%, rgba(7,7,10,0.72) 40%, rgba(7,7,10,0.94) 78%, rgba(7,7,10,0.98) 100%), radial-gradient(circle at top right, rgba(245,166,35,0.14) 0%, rgba(245,166,35,0) 34%), url(${heroBackdrop})`,
        } : {}}
      >
        <div className="media-detail-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={() => navigate('/local?tab=manga')}>
            {`< ${text.back}`}
          </button>
          <div className="media-detail-toolbar-actions">
            {nextChapter ? (
              <button className="btn btn-primary media-detail-primary-btn" onClick={() => handleOpen(nextChapter)}>
                {resumeChapter ? text.continueReading : text.startReading}
              </button>
            ) : null}
            {manga.mangadex_id ? (
              <button className="btn btn-ghost media-detail-secondary-btn" onClick={() => navigate('/manga-online')}>
                {text.readOnline}
              </button>
            ) : null}
          </div>
        </div>

        <div className="media-detail-hero-grid">
          {manga.cover_image ? (
            <BlurhashImage
              src={manga.cover_image}
              blurhash={manga.cover_blurhash}
              alt={title}
              imgClassName="media-detail-cover"
            />
          ) : null}

          <div className="media-detail-hero-copy">
            <div className="media-detail-kicker">{text.localCollection}</div>
            <h1 className="media-detail-title">{title}</h1>
            {subtitle ? <div className="media-detail-subtitle">{subtitle}</div> : null}
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
                <div className="media-detail-panel-title">{text.readingStatus}</div>
                <p className="media-detail-panel-copy">
                  {readCount}/{chapters.length || manga.chapters_total || detail?.chapters || 0} {text.read}
                </p>
              </div>
              <div className="media-detail-progress-value">{progressValue}%</div>
            </div>
            <div className="media-detail-progress-track">
              <div className="media-detail-progress-fill" style={{ width: `${progressValue}%` }} />
            </div>
            {nextChapter ? (
              <div className="media-detail-resume-card">
                <div className="media-detail-resume-copy">
                  <div className="media-detail-resume-label">{resumeChapter ? text.continueReading : text.startReading}</div>
                  <div className="media-detail-resume-title">
                    {nextChapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${nextChapter.chapter_num ?? '?'}`}
                  </div>
                  {resumeChapter?.progress_page ? (
                    <div className="media-detail-resume-meta">
                      {isEnglish ? 'Page' : 'Pagina'} {resumeChapter.progress_page}
                    </div>
                  ) : null}
                </div>
                <button className="btn btn-primary media-detail-primary-btn" onClick={() => handleOpen(nextChapter)}>
                  {resumeChapter ? text.continueReading : text.startReading}
                </button>
              </div>
            ) : null}
          </section>

          <section className="media-detail-panel">
            <div className="media-detail-section-head">
              <div className="media-detail-panel-title">
                {text.chapters}
                <span className="media-detail-count-pill">{chapters.length}</span>
              </div>
              {readCount > 0 ? <div className="media-detail-panel-note">{readCount}/{chapters.length} {text.read}</div> : null}
            </div>

            {chapters.length === 0 ? (
              <div className="media-detail-empty-copy">{text.noChapters}</div>
            ) : (
              <div className="episode-list media-detail-episode-list">
                {chapters.map((chapter) => (
                  <ChapterRow key={chapter.id} ch={chapter} onOpen={handleOpen} isEnglish={isEnglish} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="media-detail-aside">
          <DetailInfoCard title={text.readingStatus} rows={readingRows} />
          <DetailInfoCard title={text.sourceInfo} rows={sourceRows}>
            {manga.mangadex_id ? (
              <button className="btn btn-ghost media-detail-secondary-btn media-detail-full-btn" onClick={() => navigate('/manga-online')}>
                {text.readOnline}
              </button>
            ) : null}
          </DetailInfoCard>
          <CharacterPanel
            title={text.castTitle}
            subtitle={text.castCopy}
            characters={characters}
            loading={mangaMetaQuery.isLoading}
            labels={{
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
