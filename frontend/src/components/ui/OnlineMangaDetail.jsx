import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildMotionVars } from '../../gui-v2/motion/gui2Motion'
import { proxyImage, wails } from '../../lib/wails'
import { getMangaSourceMeta } from '../../lib/mangaSources'
import LandingRecommendationsStage from './landing/LandingRecommendationsStage'
import { buildLandingQueueWindow } from './landing/landingQueueWindowing'

function formatDetailDate(value, locale) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale)
}

function formatAniListDateValue(value, locale) {
  if (!value?.year) return ''
  const month = Number(value.month || 1)
  const day = Number(value.day || 1)
  const date = new Date(value.year, month - 1, day)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale)
}

function detailValue(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function detailRowsToGrid(rows) {
  return rows.filter((row) => row?.label && row?.value)
}

function normalizeChapterNumber(value) {
  const numericValue =
    typeof value === 'string'
      ? Number(value.trim())
      : value

  return Number.isFinite(numericValue) ? numericValue : null
}

function getChapterSortValue(chapter) {
  const chapterNumber = normalizeChapterNumber(chapter?.number)
  if (chapterNumber !== null) return chapterNumber

  const uploadedAt = chapter?.uploaded_at ? new Date(chapter.uploaded_at).getTime() : Number.NaN
  if (Number.isFinite(uploadedAt)) return uploadedAt

  return Number.NEGATIVE_INFINITY
}

function getRecommendationTitle(item) {
  if (!item || typeof item !== 'object') return ''

  if (typeof item.title === 'string' && item.title.trim()) return item.title.trim()
  if (typeof item.name === 'string' && item.name.trim()) return item.name.trim()

  const nestedTitle = item.title && typeof item.title === 'object'
    ? item.title.english || item.title.romaji || item.title.native
    : ''

  if (typeof nestedTitle === 'string' && nestedTitle.trim()) return nestedTitle.trim()
  if (typeof item.canonical_title === 'string' && item.canonical_title.trim()) return item.canonical_title.trim()

  return ''
}

function getRecommendationDiscriminator(item) {
  if (!item || typeof item !== 'object') return ''

  const discriminator = item?.source_id
    || item?.format
    || item?.status
    || item?.siteUrl
    || item?.site_url
    || item?.url
    || item?.slug
    || item?.canonical_title
    || item?.name

  return typeof discriminator === 'string' || typeof discriminator === 'number'
    ? String(discriminator).trim()
    : ''
}

function getRecommendationImage(item) {
  if (!item || typeof item !== 'object') return ''
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

function getRecommendationSubtitle(item) {
  if (!item || typeof item !== 'object') return ''
  const media = item?.media || item?.node || item
  const parts = [
    media?.format || item?.format || '',
    media?.status || item?.status ? String(media?.status || item?.status).replaceAll('_', ' ') : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function buildMangaRecommendationNavigationEntry(item) {
  if (!item || typeof item !== 'object') return null

  const media = item?.media || item?.node || item
  const titleEnglish = typeof media?.title?.english === 'string' ? media.title.english : ''
  const titleRomaji = typeof media?.title?.romaji === 'string' ? media.title.romaji : ''
  const titleNative = typeof media?.title?.native === 'string' ? media.title.native : ''
  const title = getRecommendationTitle(item)
  const anilistID = Number(media?.id || item?.anilist_id || item?.id || 0)
  const coverImage = media?.coverImage || item?.coverImage || null

  if (anilistID <= 0 && !title) return null

  return {
    ...media,
    anilist_id: anilistID,
    title,
    title_english: titleEnglish || title,
    title_romaji: titleRomaji || title,
    title_native: titleNative,
    cover_image: coverImage?.extraLarge || coverImage?.large || coverImage?.medium || '',
    banner_image: media?.bannerImage || item?.bannerImage || '',
    description: typeof media?.description === 'string' ? media.description : '',
    year: Number(media?.seasonYear || item?.seasonYear || media?.startDate?.year || item?.startDate?.year || 0),
    format: media?.format || item?.format || '',
    status: media?.status || item?.status || '',
    chapters_total: Number(media?.chapters || item?.chapters || 0),
  }
}

function LandingFactList({ rows }) {
  const items = detailRowsToGrid(rows)
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

function LandingMetaPanel({ title, rows }) {
  const items = detailRowsToGrid(rows)
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

function LandingCharacterStrip({ characters, emptyLabel, title }) {
  return (
    <section className="gui2-landing-panel">
      <div className="gui2-landing-section-head">
        <h3 className="gui2-landing-section-title">{title}</h3>
      </div>
      {characters.length > 0 ? (
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
                <div className="gui2-landing-character-role">{character.role || ''}</div>
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

function OnlineMangaSourceButton({ item, active, busy, onClick, ui }) {
  const sourceMeta = getMangaSourceMeta(item.source_id)
  const statusLabel = item.status === 'ready'
    ? ui.sourceReady
    : item.status === 'loading'
      ? ui.sourceLoading
      : item.status === 'not_found' || item.status === 'unresolved' || item.status === 'error'
        ? ui.sourceRetry
        : ui.sourceOpen

  return (
    <button
      type="button"
      className={`gui2-landing-source-btn${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={busy}
    >
      <span className="gui2-landing-source-name">{item.source_name || sourceMeta.label}</span>
      <span className="gui2-landing-source-status">{statusLabel}</span>
    </button>
  )
}

function OnlineMangaChapterRow({ chapter, isEnglish, isResume, onOpen, ui }) {
  const isLocked = Boolean(chapter.locked)
  const hasProgress = chapter.progress_page > 0 && !chapter.completed
  const progressValue = hasProgress && chapter.total_pages > 0
    ? Math.round((chapter.progress_page / chapter.total_pages) * 100)
    : 0
  const chapterDate = formatDetailDate(chapter.uploaded_at, isEnglish ? 'en-US' : 'es-CL')

  return (
    <article
      className={`gui2-landing-chapter-row${chapter.completed ? ' gui2-landing-chapter-row--completed' : ''}${isResume ? ' gui2-landing-chapter-row--resume' : ''}${isLocked ? ' gui2-landing-chapter-row--locked' : ''}`}
      onClick={() => {
        if (!isLocked) onOpen(chapter)
      }}
    >
      <div className="gui2-landing-chapter-index">{chapter.number || '?'}</div>
      <div className="gui2-landing-chapter-main">
        <div className="gui2-landing-chapter-title">
          {chapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${chapter.number || '?'}`}
        </div>
        <div className="gui2-landing-chapter-subline">
          {chapterDate ? <span>{chapterDate}</span> : null}
          {isLocked ? <span>{chapter.price > 0 ? ui.coinLabel(chapter.price) : ui.locked}</span> : null}
          {chapter.completed ? <span>{ui.completed}</span> : null}
        </div>
        {hasProgress ? (
          <div className="gui2-landing-chapter-progress">
            <div className="gui2-landing-chapter-progress-fill" style={{ width: `${progressValue}%` }} />
          </div>
        ) : null}
      </div>
      <div className="gui2-landing-chapter-col gui2-landing-chapter-col--released">{chapterDate || '-'}</div>
      <div className="gui2-landing-chapter-col gui2-landing-chapter-col--progress">
        {chapter.completed ? ui.read : hasProgress ? `${progressValue}%` : isResume ? ui.continue : ui.readNow}
      </div>
      <div className="gui2-landing-chapter-col gui2-landing-chapter-col--source">{chapter.source_name || ''}</div>
      <div className="gui2-landing-chapter-actions">
        <button
          className={`btn ${isLocked ? 'btn-ghost' : isResume ? 'btn-primary' : chapter.completed ? 'btn-ghost' : 'btn-primary'} media-detail-primary-btn`}
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            if (!isLocked) onOpen(chapter)
          }}
          disabled={isLocked}
        >
          {isLocked ? ui.locked : chapter.completed ? ui.read : isResume ? ui.continue : ui.readNow}
        </button>
      </div>
    </article>
  )
}

export default function OnlineMangaDetail({
  selected,
  detail,
  selectedCover,
  selectedBanner,
  selectedDescription,
  selectedCharacters,
  selectedFacts,
  selectedReadingRows,
  sourceCards,
  activeSourceID,
  activeSourceQuery,
  onSelectSource,
  onBack,
  backLabel,
  canAddToList,
  addingToList,
  onAddToList,
  isEnglish,
  ui,
  chapters,
  visibleChapters,
  canShowChapters,
  chapterFilter,
  onChapterFilterChange,
  sourceIsLoading,
  sourceIsHydrating,
  activeSourceMatch,
  sourceError,
  onRetrySource,
  resumeChapterID,
  onOpenChapter,
  chapterSectionCopy,
  onRecommendationSelect = null,
}) {
  const [chapterPage, setChapterPage] = useState(1)
  const activeSourceLabel = getMangaSourceMeta(activeSourceID).label
  const progressBase = chapters.length || selected?.chapters_total || detail?.chapters || 0
  const progressCount = chapters.filter((chapter) => chapter.completed).length
  const progressValue = progressBase > 0
    ? Math.max(0, Math.min(100, Math.round((progressCount / progressBase) * 100)))
    : 0
  const resumeChapter = resumeChapterID
    ? chapters.find((chapter) => chapter.id === resumeChapterID) || null
    : null
  const latestChapter = useMemo(() => (
    chapters.reduce((latest, chapter) => {
      if (!latest) return chapter
      return getChapterSortValue(chapter) > getChapterSortValue(latest) ? chapter : latest
    }, null)
  ), [chapters])
  const heading = selected.canonical_title || selected.title
  const subheading = detail?.title_native || detail?.canonical_title_native || selected?.canonical_title_native || ''
  const storyCopy = selectedDescription || detail?.resolved_description || ''
  const genres = Array.isArray(detail?.genres) ? detail.genres : []
  const heroFacts = [
    ...selectedFacts,
    selected?.resolved_status || selected?.status || detail?.status ? String(selected?.resolved_status || selected?.status || detail?.status).replaceAll('_', ' ') : null,
  ].filter(Boolean)
  const publicationDate = formatAniListDateValue(detail?.startDate, isEnglish ? 'en-US' : 'es-CL')
  const releaseRows = [
    latestChapter ? { label: isEnglish ? 'Latest chapter' : 'Ultimo capitulo', value: latestChapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${latestChapter.number || '?'}` } : null,
    resumeChapter ? { label: isEnglish ? 'Resume from' : 'Continuar desde', value: `${resumeChapter.number || '?'} · ${activeSourceLabel}` } : null,
    detail?.serialization ? { label: isEnglish ? 'Publication' : 'Publicacion', value: detail.serialization } : null,
    publicationDate ? { label: isEnglish ? 'Started' : 'Inicio', value: publicationDate } : null,
    detail?.next_release_at ? { label: isEnglish ? 'Release schedule' : 'Calendario', value: formatDetailDate(detail.next_release_at, isEnglish ? 'en-US' : 'es-CL') } : null,
    ...selectedReadingRows.map((row) => ({ label: row.label, value: row.value })),
  ]
  const detailRows = [
    { label: isEnglish ? 'Japanese title' : 'Titulo japones', value: subheading || '-' },
    { label: isEnglish ? 'Also known as' : 'Tambien conocido como', value: detail?.title_english || selected?.canonical_title_english || heading },
    { label: isEnglish ? 'Source' : 'Fuente', value: activeSourceLabel },
    { label: isEnglish ? 'Format' : 'Formato', value: detailValue(detail?.format || selected?.resolved_format || selected?.format) },
    { label: isEnglish ? 'Status' : 'Estado', value: detailValue(detail?.status || selected?.resolved_status || selected?.status).replaceAll('_', ' ') },
    { label: isEnglish ? 'Chapters' : 'Capitulos', value: detailValue(chapters.length || detail?.chapters || selected?.chapters_total) },
    { label: isEnglish ? 'Year' : 'Ano', value: detailValue(detail?.seasonYear || detail?.publication_year || selected?.resolved_year || selected?.year) },
    { label: isEnglish ? 'Publisher' : 'Editorial', value: detailValue(detail?.publisher || detail?.studios?.[0]?.name, '-') },
  ]
  const moreInfoRows = [
    genres.length > 0 ? { label: isEnglish ? 'Genres' : 'Generos', value: genres.join(', ') } : null,
    detail?.demographic ? { label: isEnglish ? 'Demographic' : 'Demografia', value: detail.demographic } : null,
    (detail?.countryOfOrigin || detail?.country_of_origin) ? { label: isEnglish ? 'Country' : 'Pais', value: detail.countryOfOrigin || detail.country_of_origin } : null,
    (detail?.averageScore || detail?.average_score) ? { label: isEnglish ? 'Rating' : 'Puntuacion', value: `${detail.averageScore || detail.average_score}` } : null,
  ]
  const explicitRecommendationItems = useMemo(() => {
    const localSources = [
      detail?.recommendations,
      detail?.recommendedMedia,
      detail?.relatedRecommendations,
      detail?.related_recommendations,
      selected?.recommendations,
      selected?.recommendedMedia,
    ].filter(Array.isArray)

    const seen = new Set()
    return localSources
      .flat()
      .map((item) => {
        const title = getRecommendationTitle(item)
        const discriminator = getRecommendationDiscriminator(item)
        const key = String(item?.id || item?.anilist_id || item?.mal_id || `${title}::${discriminator}`).trim()
        if (!title || !key || seen.has(key)) return null
        seen.add(key)
        return {
          key,
          title,
          image: getRecommendationImage(item),
          eyebrow: isEnglish ? 'Related manga' : 'Manga relacionado',
          subtitle: getRecommendationSubtitle(item),
          navigationEntry: buildMangaRecommendationNavigationEntry(item),
        }
      })
      .filter(Boolean)
      .slice(0, 6)
  }, [detail, isEnglish, selected])
  const recommendationItems = useMemo(() => {
    return explicitRecommendationItems.slice(0, 6)
  }, [explicitRecommendationItems])
  const recommendationsTitle = ui.recommendationsTitle || (isEnglish ? 'Keep reading' : 'Sigue leyendo')
  const recommendationsCopy = ui.recommendationsCopy || (isEnglish
    ? 'A calmer lower shelf for what should naturally follow this series once the reading room is fully enriched.'
    : 'Una repisa inferior mas tranquila para lo que deberia seguir de forma natural a esta serie cuando el espacio de lectura termine de enriquecerse.')
  const recommendationsEmptyCopy = ui.recommendationsEmptyCopy || (isEnglish
    ? 'Related manga will settle here as recommendation data and source enrichment finish wiring in.'
    : 'Los mangas relacionados se acomodaran aqui cuando terminen de conectarse las recomendaciones y el enriquecimiento de fuentes.')
  const chapterWindow = useMemo(() => buildLandingQueueWindow({
    items: visibleChapters,
    page: chapterPage,
    pageSize: 16,
  }), [chapterPage, visibleChapters])
  const pagedVisibleChapters = chapterWindow.items
  const visibleChapterDatasetIdentity = useMemo(
    () => [
      activeSourceID || '',
      chapterFilter,
      visibleChapters.map((chapter) => String(chapter?.id || chapter?.number || '')).join('|'),
    ].join('::'),
    [activeSourceID, chapterFilter, visibleChapters],
  )

  useEffect(() => {
    setChapterPage(1)
  }, [visibleChapterDatasetIdentity])

  useEffect(() => {
    if (chapterPage !== chapterWindow.currentPage) {
      setChapterPage(chapterWindow.currentPage)
    }
  }, [chapterPage, chapterWindow.currentPage])

  return (
    <div
      className="fade-in media-detail-page media-detail-page--online gui2-landing-page gui2-landing-page--manga gui2-motion-enter"
      style={buildMotionVars('page')}
    >
      <section
        className="gui2-landing-hero gui2-manga-landing-hero-premium"
        style={selectedBanner ? {
          '--gui2-landing-backdrop-image': `url(${selectedBanner})`,
        } : undefined}
      >
        <div className="gui2-landing-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={onBack}>
            {backLabel}
          </button>
        </div>

        <div className={`gui2-landing-hero-grid gui2-landing-hero-grid--manga${selectedCover ? '' : ' gui2-landing-hero-grid--coverless'}`}>
          {selectedCover ? (
            <div className="gui2-landing-cover-wrap">
              <img src={selectedCover} alt={heading} className="gui2-landing-cover" />
            </div>
          ) : null}

          <div className="gui2-landing-copy">
            <div className="gui2-landing-kicker">{ui.mangaOnline}</div>
            <h1 className="gui2-landing-title">{heading}</h1>
            {subheading ? <div className="gui2-landing-subtitle">{subheading}</div> : null}
            {heroFacts.length > 0 ? (
              <div className="gui2-landing-facts-inline">
                {heroFacts.map((fact, index) => (
                  <span key={`${fact}-${index}`} className="gui2-landing-inline-fact">{fact}</span>
                ))}
              </div>
            ) : null}
            {storyCopy ? <p className="gui2-landing-story">{storyCopy}</p> : null}

            <div className="gui2-landing-actions">
              {visibleChapters[0] ? (
                <button className="btn btn-primary gui2-landing-primary-btn" type="button" onClick={() => onOpenChapter(visibleChapters[0])}>
                  {ui.readNow}
                </button>
              ) : null}
              {resumeChapter ? (
                <button className="btn btn-ghost gui2-landing-secondary-btn" type="button" onClick={() => onOpenChapter(resumeChapter)}>
                  {ui.continue}
                  <span className="gui2-landing-inline-progress">
                    <span className="gui2-landing-inline-progress-fill" style={{ width: `${progressValue}%` }} />
                  </span>
                </button>
              ) : null}
              {canAddToList ? (
                <button className="btn btn-ghost gui2-landing-secondary-btn" type="button" onClick={onAddToList} disabled={addingToList}>
                  {addingToList ? ui.adding : ui.addToList}
                </button>
              ) : null}
            </div>
          </div>

        </div>
      </section>

      <div className="gui2-landing-workspace">
        <div className="gui2-landing-main">
          <section className="gui2-landing-panel gui2-landing-panel--progression">
            <LandingFactList rows={releaseRows} />
          </section>

          <LandingCharacterStrip
            characters={selectedCharacters}
            emptyLabel={ui.chapterSidebarEmpty}
            title={isEnglish ? 'Characters' : 'Personajes'}
          />

          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head gui2-landing-section-head--split">
              <div>
                <h3 className="gui2-landing-section-title">{ui.chapters}</h3>
                <p className="gui2-landing-section-copy">{chapterSectionCopy}</p>
              </div>
              <div className="gui2-landing-section-tools gui2-landing-section-tools--wrap">
                <div className="gui2-landing-source-stack gui2-landing-source-stack--inline">
                  {sourceCards.map((item) => (
                    <OnlineMangaSourceButton
                      key={`header-${item.source_id}`}
                      item={item}
                      active={item.source_id === activeSourceID}
                      busy={activeSourceQuery.isFetching && item.source_id === activeSourceID}
                      onClick={() => onSelectSource(item.source_id)}
                      ui={ui}
                    />
                  ))}
                </div>
                {chapters.length > 0 ? <span className="gui2-landing-count">{visibleChapters.length}/{chapters.length}</span> : null}
                {canShowChapters ? (
                  <div className="manga-filter-toggle" role="tablist" aria-label={ui.chapters}>
                    <button type="button" className={`manga-filter-toggle-btn${chapterFilter === 'unread' ? ' active' : ''}`} onClick={() => onChapterFilterChange('unread')}>{ui.unreadChapters}</button>
                    <button type="button" className={`manga-filter-toggle-btn${chapterFilter === 'all' ? ' active' : ''}`} onClick={() => onChapterFilterChange('all')}>{ui.allChapters}</button>
                  </div>
                ) : null}
              </div>
            </div>

            {sourceIsLoading ? (
              <>
                <div className="manga-skeleton-caption">
                  {selected.mode === 'canonical' ? ui.resolvingSource : ui.loadingChapters}
                </div>
                <div className="manga-chapter-grid">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="manga-chapter-card manga-chapter-card-skeleton">
                      <div className="skeleton-block manga-chapter-skeleton-number" />
                      <div className="manga-chapter-body">
                        <div className="skeleton-block skeleton-line skeleton-line-xs" />
                        <div className="skeleton-block skeleton-line skeleton-line-md" />
                        <div className="skeleton-block skeleton-line skeleton-line-sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {!sourceIsLoading && (activeSourceMatch?.status === 'not_found' || activeSourceMatch?.status === 'unresolved' || activeSourceMatch?.status === 'error') ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-state-title">{ui.sourceRetry}</div>
                <p className="empty-state-desc">
                  {activeSourceMatch?.status === 'unresolved'
                    ? ui.sourceUnresolved
                    : activeSourceMatch?.status === 'error'
                      ? `${ui.sourceError} ${sourceError ?? ''}`.trim()
                      : ui.sourceNotFound}
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={onRetrySource}>
                    {ui.sourceRetry}
                  </button>
                </div>
              </div>
            ) : null}

            {!sourceIsLoading && !sourceIsHydrating && activeSourceMatch?.status === 'ready' && chapters.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-state-title">{ui.noChapters}</div>
                <p className="empty-state-desc">{ui.noChaptersDesc}</p>
              </div>
            ) : null}

            {canShowChapters ? (
              visibleChapters.length > 0 ? (
                <div className="gui2-landing-chapter-table gui2-manga-landing-chapters-editorial">
                  <div className="gui2-landing-chapter-header">
                    <span>#</span>
                    <span>{isEnglish ? 'Chapter' : 'Capitulo'}</span>
                    <span>{isEnglish ? 'Released' : 'Publicado'}</span>
                    <span>{isEnglish ? 'Progress' : 'Progreso'}</span>
                    <span>{isEnglish ? 'Source' : 'Fuente'}</span>
                    <span>{isEnglish ? 'Action' : 'Accion'}</span>
                  </div>
                  <div className="gui2-landing-chapter-list">
                    {pagedVisibleChapters.map((chapter) => (
                      <OnlineMangaChapterRow
                        key={chapter.id}
                        chapter={chapter}
                        isEnglish={isEnglish}
                        isResume={chapter.id === resumeChapterID}
                        onOpen={onOpenChapter}
                        ui={ui}
                      />
                    ))}
                  </div>
                  {chapterWindow.showPagination ? (
                    <div
                      className="gui2-landing-queue-pagination gui2-landing-queue-pagination--editorial"
                      aria-label={isEnglish ? 'Chapter pages' : 'Paginas de capitulos'}
                    >
                      <button
                        type="button"
                        className="gui2-landing-pagechip"
                        onClick={() => setChapterPage((page) => Math.max(1, page - 1))}
                        disabled={chapterWindow.currentPage <= 1}
                        aria-label={isEnglish ? 'Previous chapter page' : 'Pagina anterior'}
                      >
                        {isEnglish ? 'Prev' : 'Anterior'}
                      </button>
                      {chapterWindow.pageChips.map((pageNumber) => (
                        <button
                          key={`chapter-page-${pageNumber}`}
                          type="button"
                          className={`gui2-landing-pagechip${pageNumber === chapterWindow.currentPage ? ' active' : ''}`}
                          onClick={() => setChapterPage(pageNumber)}
                          aria-current={pageNumber === chapterWindow.currentPage ? 'page' : undefined}
                        >
                          {pageNumber}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="gui2-landing-pagechip"
                        onClick={() => setChapterPage((page) => Math.min(chapterWindow.totalPages, page + 1))}
                        disabled={chapterWindow.currentPage >= chapterWindow.totalPages}
                        aria-label={isEnglish ? 'Next chapter page' : 'Pagina siguiente'}
                      >
                        {isEnglish ? 'Next' : 'Siguiente'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state manga-filter-empty-state">
                  <div className="empty-state-title">{ui.chapterFilterEmpty}</div>
                  <p className="empty-state-desc">{ui.chapterFilterEmptyDesc}</p>
                </div>
              )
            ) : null}
          </section>
        </div>

        <aside className="gui2-landing-aside">
          <LandingMetaPanel title={isEnglish ? 'Details' : 'Detalles'} rows={detailRows} />
          <LandingMetaPanel title={isEnglish ? 'More Info' : 'Mas informacion'} rows={moreInfoRows} />
        </aside>
      </div>

      <LandingRecommendationsStage
        title={recommendationsTitle}
        copy={recommendationsCopy}
        items={recommendationItems}
        onSelectItem={onRecommendationSelect}
        emptyCopy={recommendationsEmptyCopy}
        placeholderCount={4}
      />
    </div>
  )
}
