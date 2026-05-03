import { proxyImage } from '../../lib/wails'
import { getMangaSourceMeta } from '../../lib/mangaSources'

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

function LandingFactList({ rows }) {
  const items = detailRowsToGrid(rows)
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

function LandingCharacterStrip({ characters, emptyLabel, title, actionLabel }) {
  return (
    <section className="gui2-landing-panel">
      <div className="gui2-landing-section-head">
        <h3 className="gui2-landing-section-title">{title}</h3>
        {characters.length > 0 ? <span className="gui2-landing-section-link">{actionLabel}</span> : null}
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
}) {
  const activeSourceLabel = getMangaSourceMeta(activeSourceID).label
  const progressBase = chapters.length || selected?.chapters_total || detail?.chapters || 0
  const progressCount = chapters.filter((chapter) => chapter.completed).length
  const progressValue = progressBase > 0
    ? Math.max(0, Math.min(100, Math.round((progressCount / progressBase) * 100)))
    : 0
  const resumeChapter = resumeChapterID
    ? chapters.find((chapter) => chapter.id === resumeChapterID) || null
    : null
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
    resumeChapter ? { label: isEnglish ? 'Latest chapter' : 'Ultimo capitulo', value: resumeChapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${resumeChapter.number || '?'}` } : null,
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

  return (
    <div className="fade-in media-detail-page media-detail-page--online gui2-landing-page gui2-landing-page--manga">
      <section
        className="gui2-landing-hero"
        style={selectedBanner ? {
          backgroundImage: `linear-gradient(180deg, rgba(7,7,10,0.16) 0%, rgba(7,7,10,0.76) 44%, rgba(7,7,10,0.97) 82%, rgba(7,7,10,0.99) 100%), radial-gradient(circle at top right, rgba(184, 78, 49, 0.18) 0%, rgba(184, 78, 49, 0) 34%), url(${selectedBanner})`,
        } : {}}
      >
        <div className="gui2-landing-toolbar">
          <button className="btn btn-ghost media-detail-back-btn" onClick={onBack}>
            {backLabel}
          </button>
        </div>

        <div className="gui2-landing-hero-grid gui2-landing-hero-grid--manga">
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
          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head">
              <h3 className="gui2-landing-section-title">{isEnglish ? 'Release Info' : 'Informacion de lanzamiento'}</h3>
            </div>
            <LandingFactList rows={releaseRows} />
          </section>

          <LandingCharacterStrip
            characters={selectedCharacters}
            emptyLabel={ui.chapterSidebarEmpty}
            title={isEnglish ? 'Characters' : 'Personajes'}
            actionLabel={isEnglish ? 'View all' : 'Ver todos'}
          />

          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head gui2-landing-section-head--split">
              <div>
                <h3 className="gui2-landing-section-title">{ui.chapters}</h3>
                <p className="gui2-landing-section-copy">{chapterSectionCopy}</p>
              </div>
              <div className="gui2-landing-section-tools">
                {chapters.length > 0 ? <span className="media-detail-count-pill">{visibleChapters.length}/{chapters.length}</span> : null}
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
                    {visibleChapters.map((chapter) => (
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
          <section className="gui2-landing-panel">
            <div className="gui2-landing-section-head">
              <h3 className="gui2-landing-section-title">{ui.sourceTabsTitle}</h3>
            </div>
            <div className="gui2-landing-source-stack">
              {sourceCards.map((item) => (
                <OnlineMangaSourceButton
                  key={`aside-${item.source_id}`}
                  item={item}
                  active={item.source_id === activeSourceID}
                  busy={activeSourceQuery.isFetching && item.source_id === activeSourceID}
                  onClick={() => onSelectSource(item.source_id)}
                  ui={ui}
                />
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
