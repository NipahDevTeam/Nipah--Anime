import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../lib/i18n'
import { proxyImage, wails } from '../../lib/wails'
import { withGui2Prefix } from '../routeRegistry'

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

function detailValue(value, fallback = '-') {
  if (value == null || value === '') return fallback
  return String(value)
}

function translateStatus(status, isEnglish) {
  const map = isEnglish
    ? { completed: 'Completed', ongoing: 'Ongoing', releasing: 'Releasing', hiatus: 'Hiatus', cancelled: 'Cancelled' }
    : { completed: 'Completado', ongoing: 'En curso', releasing: 'En emision', hiatus: 'En pausa', cancelled: 'Cancelado' }

  return map[String(status || '').toLowerCase()] ?? status
}

function progressPercent(readCount, totalCount) {
  if (!totalCount) return 0
  return Math.max(0, Math.min(100, Math.round((readCount / totalCount) * 100)))
}

function characterRoleLabel(role, isEnglish) {
  if (role === 'MAIN') return isEnglish ? 'Main' : 'Principal'
  return isEnglish ? 'Supporting' : 'Secundario'
}

function formatChapterNumber(value) {
  if (value == null || value === '') return '?'
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return String(value)
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1)
}

function formatDate(value, locale) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale)
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
            return (
              <article key={`${character.id || character.name}-${character.role || ''}`} className="gui2-landing-character-card">
                {image ? (
                  <img src={proxyImage(image)} alt={character.name} className="gui2-landing-character-art" />
                ) : (
                  <div className="gui2-landing-character-art gui2-landing-character-art--placeholder">{character.name?.slice(0, 1) || '?'}</div>
                )}
                <div className="gui2-landing-character-copy">
                  <div className="gui2-landing-character-name">{character.name}</div>
                  <div className="gui2-landing-character-role">{characterRoleLabel(character.role, isEnglish)}</div>
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

function LocalMangaChapterRow({ chapter, isEnglish, isResume, onOpen }) {
  const hasProgress = chapter.progress_page > 0 && !chapter.read
  const progressValue = hasProgress && chapter.total_pages > 0
    ? Math.round((chapter.progress_page / chapter.total_pages) * 100)
    : 0
  const chapterDate = formatDate(chapter.uploaded_at, isEnglish ? 'en-US' : 'es-CL')

  return (
    <article
      className={`gui2-landing-chapter-row${chapter.read ? ' gui2-landing-chapter-row--completed' : ''}${isResume ? ' gui2-landing-chapter-row--resume' : ''}`}
      onClick={() => onOpen(chapter)}
    >
      <div className="gui2-landing-chapter-index">{formatChapterNumber(chapter.chapter_num)}</div>
      <div className="gui2-landing-chapter-main">
        <div className="gui2-landing-chapter-title">
          {chapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${formatChapterNumber(chapter.chapter_num)}`}
        </div>
        <div className="gui2-landing-chapter-subline">
          {chapterDate ? <span>{chapterDate}</span> : null}
          {chapter.read ? <span>{isEnglish ? 'Completed locally' : 'Leido localmente'}</span> : null}
          {hasProgress ? <span>{`${isEnglish ? 'Page' : 'Pagina'} ${chapter.progress_page}`}</span> : null}
        </div>
        {hasProgress ? (
          <div className="gui2-landing-chapter-progress">
            <div className="gui2-landing-chapter-progress-fill" style={{ width: `${progressValue}%` }} />
          </div>
        ) : null}
      </div>
      <div className="gui2-landing-chapter-col gui2-landing-chapter-col--released">{chapterDate || '-'}</div>
      <div className="gui2-landing-chapter-col gui2-landing-chapter-col--progress">
        {chapter.read ? (isEnglish ? 'Read' : 'Leido') : hasProgress ? `${progressValue}%` : isResume ? (isEnglish ? 'Continue' : 'Continuar') : (isEnglish ? 'Read now' : 'Leer')}
      </div>
      <div className="gui2-landing-chapter-col gui2-landing-chapter-col--source">{isEnglish ? 'Local Library' : 'Biblioteca local'}</div>
      <div className="gui2-landing-chapter-actions">
        <button
          className={`btn ${chapter.read ? 'btn-ghost' : 'btn-primary'} media-detail-primary-btn`}
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onOpen(chapter)
          }}
        >
          {chapter.read ? (isEnglish ? 'Read Again' : 'Leer de nuevo') : hasProgress ? (isEnglish ? 'Continue' : 'Continuar') : (isEnglish ? 'Read' : 'Leer')}
        </button>
      </div>
    </article>
  )
}

export default function Gui2MangaDetailRoute({ mediaID, preview = false }) {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const localPath = withGui2Prefix('/local', preview)
  const onlinePath = withGui2Prefix('/manga-online', preview)
  const numericID = Number(mediaID || 0)

  const mangaQuery = useQuery({
    queryKey: ['gui2-manga-detail', numericID],
    enabled: numericID > 0,
    queryFn: async () => {
      const data = await wails.getMangaDetail(numericID)
      if (!data) throw new Error(isEnglish ? 'Not found' : 'No encontrado')
      return data
    },
    staleTime: 60_000,
  })

  const metaQuery = useQuery({
    queryKey: ['gui2-manga-detail-anilist', Number(mangaQuery.data?.anilist_id || 0)],
    enabled: Number(mangaQuery.data?.anilist_id || 0) > 0,
    queryFn: () => wails.getAniListMangaByID(Number(mangaQuery.data?.anilist_id || 0)),
    staleTime: 10 * 60_000,
  })

  const manga = mangaQuery.data
  const detail = metaQuery.data
  const chapters = useMemo(
    () => [...(manga?.chapters ?? [])].sort((a, b) => Number(b.chapter_num ?? 0) - Number(a.chapter_num ?? 0)),
    [manga?.chapters],
  )
  const readCount = chapters.filter((chapter) => chapter.read).length
  const resumeChapter = chapters.find((chapter) => chapter.progress_page > 0 && !chapter.read) ?? null
  const nextChapter = resumeChapter ?? chapters.find((chapter) => !chapter.read) ?? chapters[0] ?? null
  const totalChapters = chapters.length || manga?.chapters_total || detail?.chapters || 0
  const progressValue = progressPercent(readCount, totalChapters)
  const title = manga?.display_title || manga?.title_english || getTitlePart(detail, 'title_english') || getTitlePart(detail, 'title_romaji') || 'Manga'
  const titleNative = getTitlePart(detail, 'title_native')
  const subtitle = manga?.title_romaji && manga.title_romaji !== title
    ? manga.title_romaji
    : (titleNative && titleNative !== title ? titleNative : '')
  const coverImage = manga?.cover_image || detail?.coverImage?.extraLarge || detail?.coverImage?.large || ''
  const bannerImage = manga?.banner_image || detail?.bannerImage || coverImage || ''
  const synopsis = stripHtml(manga?.synopsis_es || detail?.description || '')
  const heroFacts = [
    manga?.year > 0 ? String(manga.year) : (detail?.year ? String(detail.year) : null),
    totalChapters ? `${totalChapters} ${isEnglish ? 'chapters' : 'capitulos'}` : null,
    manga?.status || detail?.status ? translateStatus(manga?.status || detail?.status, isEnglish) : null,
    detail?.genres?.length ? detail.genres.slice(0, 3).join(' / ') : null,
  ].filter(Boolean)
  const characters = detail?.characters ?? []

  const releaseRows = [
    nextChapter ? { label: isEnglish ? 'Latest chapter' : 'Ultimo capitulo', value: nextChapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${formatChapterNumber(nextChapter.chapter_num)}` } : null,
    detail?.serialization ? { label: isEnglish ? 'Publication' : 'Publicacion', value: detail.serialization } : null,
    detail?.next_release_at ? { label: isEnglish ? 'Release schedule' : 'Calendario', value: formatDate(detail.next_release_at, isEnglish ? 'en-US' : 'es-CL') } : null,
  ].filter(Boolean)

  const detailRows = [
    { label: isEnglish ? 'Format' : 'Formato', value: detailValue(detail?.format || manga?.format || 'Manga') },
    { label: isEnglish ? 'Year' : 'Ano', value: detailValue(manga?.year || detail?.year) },
    { label: isEnglish ? 'Score' : 'Puntuacion', value: detailValue(detail?.score || detail?.averageScore, '-') },
    { label: isEnglish ? 'Progress' : 'Progreso', value: `${progressValue}%` },
  ]

  const moreInfoRows = [
    { label: isEnglish ? 'Read locally' : 'Leidos localmente', value: detailValue(readCount) },
    { label: isEnglish ? 'Chapters total' : 'Total capitulos', value: detailValue(totalChapters) },
    { label: isEnglish ? 'AniList ID' : 'AniList ID', value: detailValue(manga?.anilist_id || detail?.anilist_id) },
    { label: isEnglish ? 'MAL ID' : 'MAL ID', value: detailValue(manga?.mal_id || detail?.mal_id) },
  ]

  const buildSeedItem = () => ({
    anilist_id: Number(manga?.anilist_id || 0),
    canonical_title: title,
    canonical_title_english: manga?.title_english || title,
    canonical_title_native: titleNative || manga?.title_romaji || '',
    title_romaji: manga?.title_romaji || title,
    resolved_cover_url: manga?.cover_image || coverImage || '',
    resolved_banner_url: manga?.banner_image || bannerImage || '',
    resolved_description: synopsis || '',
    resolved_year: manga?.year || detail?.year || 0,
    year: manga?.year || detail?.year || 0,
    chapters_total: totalChapters,
  })

  const handleOpen = (chapter = null) => {
    navigate(onlinePath, {
      state: {
        preSearch: title,
        preferredAnilistID: Number(manga?.anilist_id || 0),
        seedItem: buildSeedItem(),
        ...(chapter?.id ? { autoReadChapterID: chapter.id } : {}),
      },
    })
  }

  if (mangaQuery.isLoading) {
    return (
      <div className="gui2-route-loading">
        <div className="gui2-loading-dots"><span /><span /><span /></div>
      </div>
    )
  }

  if (mangaQuery.isError || !manga) {
    return (
      <section className="gui2-empty-panel">
        <div className="gui2-empty-title">{mangaQuery.error?.message || (isEnglish ? 'Not found' : 'No encontrado')}</div>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(localPath)}>
          {isEnglish ? 'Back to Local' : 'Volver a Local'}
        </button>
      </section>
    )
  }

  const heroBackground = bannerImage ? proxyImage(bannerImage) : ''

  return (
    <div className="fade-in gui2-landing-page gui2-landing-page--manga">
      <section
        className="gui2-landing-hero"
        style={heroBackground ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.16) 0%, rgba(7,7,10,0.76) 44%, rgba(7,7,10,0.97) 82%, rgba(7,7,10,0.99) 100%), radial-gradient(circle at top right, rgba(184, 78, 49, 0.18) 0%, rgba(184, 78, 49, 0) 34%), url(${heroBackground})`,
        } : {}}
      >
        <div className="gui2-landing-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={() => navigate(localPath)}>
            {isEnglish ? 'Back to Local' : 'Volver a Local'}
          </button>
        </div>

        <div className="gui2-landing-hero-grid gui2-landing-hero-grid--manga">
          {coverImage ? (
            <div className="gui2-landing-cover-wrap">
              <img src={proxyImage(coverImage)} alt={title} className="gui2-landing-cover" />
            </div>
          ) : null}

          <div className="gui2-landing-copy">
            <div className="gui2-landing-kicker">{isEnglish ? 'Manga' : 'Manga'}</div>
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
              {nextChapter ? (
                <button className="btn btn-primary gui2-landing-primary-btn" type="button" onClick={() => handleOpen(nextChapter)}>
                  {resumeChapter ? (isEnglish ? 'Continue Reading' : 'Continuar leyendo') : (isEnglish ? 'Start Reading' : 'Empezar a leer')}
                </button>
              ) : null}
              <button className="btn btn-ghost gui2-landing-secondary-btn" type="button" onClick={() => handleOpen()}>
                {isEnglish ? 'Open in Manga Online' : 'Abrir en Manga Online'}
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
              <h3 className="gui2-landing-section-title">{isEnglish ? 'Release Info' : 'Informacion de lanzamiento'}</h3>
            </div>
            <LandingFactList rows={releaseRows} />
          </section>

          <LandingCharacterStrip
            characters={characters}
            title={isEnglish ? 'Characters' : 'Personajes'}
            actionLabel={isEnglish ? 'View all' : 'Ver todos'}
            emptyLabel={isEnglish ? 'No character metadata is available for this title yet.' : 'Todavia no hay metadatos de personajes para este titulo.'}
            isEnglish={isEnglish}
          />

          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head gui2-landing-section-head--split">
              <div>
                <h3 className="gui2-landing-section-title">{isEnglish ? 'Chapter Queue' : 'Cola de capitulos'}</h3>
                <p className="gui2-landing-section-copy">
                  {resumeChapter
                    ? `${isEnglish ? 'Resume directly from page' : 'Retoma directamente desde la pagina'} ${resumeChapter.progress_page || 1}.`
                    : (isEnglish ? 'Every local chapter is ready to open through Manga Online.' : 'Cada capitulo local esta listo para abrirse mediante Manga Online.')}
                </p>
              </div>
              {chapters.length > 0 ? <span className="media-detail-count-pill">{chapters.length}</span> : null}
            </div>

            {chapters.length ? (
              <div className="gui2-landing-chapter-table">
                <div className="gui2-landing-chapter-header">
                  <span>#</span>
                  <span>{isEnglish ? 'Chapter' : 'Capitulo'}</span>
                  <span>{isEnglish ? 'Released' : 'Publicado'}</span>
                  <span>{isEnglish ? 'Progress' : 'Progreso'}</span>
                  <span>{isEnglish ? 'Source' : 'Fuente'}</span>
                  <span>{isEnglish ? 'Action' : 'Accion'}</span>
                </div>
                <div className="gui2-landing-chapter-list">
                  {chapters.map((chapter) => (
                    <LocalMangaChapterRow
                      key={chapter.id}
                      chapter={chapter}
                      isEnglish={isEnglish}
                      isResume={chapter.id === resumeChapter?.id}
                      onOpen={handleOpen}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="gui2-inline-empty">{isEnglish ? 'No chapters were found in this folder.' : 'No se encontraron capitulos en esta carpeta.'}</div>
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
