import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toastError, toastSuccess } from '../../components/ui/Toast'
import { useI18n } from '../../lib/i18n'
import { extractAniListAnimeSearchMedia } from '../../lib/anilistSearch'
import { buildAnimeNavigationState, buildMangaListNavigationState } from '../../lib/mediaNavigation'
import { proxyImage, wails } from '../../lib/wails'
import { buildMotionVars, buildStaggerDelayMs } from '../motion/gui2Motion'
import { withGui2Prefix } from '../routeRegistry'

const EDITOR_META_PREFIX = 'nipah-my-lists-meta'
const MEDIA_TABS = ['anime', 'manga']
const STATUS_ORDER = ['ALL', 'WATCHING', 'COMPLETED', 'PLANNING', 'DROPPED', 'ON_HOLD']
const PAGE_SIZE_OPTIONS = [24, 36, 48]

const STATUS_LABELS = {
  anime: {
    es: {
      ALL: 'Todo',
      WATCHING: 'Watching',
      COMPLETED: 'Completed',
      PLANNING: 'Planned',
      DROPPED: 'Dropped',
      ON_HOLD: 'On Hold',
    },
    en: {
      ALL: 'All',
      WATCHING: 'Watching',
      COMPLETED: 'Completed',
      PLANNING: 'Planned',
      DROPPED: 'Dropped',
      ON_HOLD: 'On Hold',
    },
  },
  manga: {
    es: {
      ALL: 'Todo',
      WATCHING: 'Reading',
      COMPLETED: 'Completed',
      PLANNING: 'Planned',
      DROPPED: 'Dropped',
      ON_HOLD: 'On Hold',
    },
    en: {
      ALL: 'All',
      WATCHING: 'Reading',
      COMPLETED: 'Completed',
      PLANNING: 'Planned',
      DROPPED: 'Dropped',
      ON_HOLD: 'On Hold',
    },
  },
}

const STATUS_ACCENTS = {
  WATCHING: '#f0b14d',
  COMPLETED: '#8cc46c',
  PLANNING: '#d5d8df',
  DROPPED: '#f05d5d',
  ON_HOLD: '#76afff',
}

const SORT_OPTIONS = [
  { value: 'UPDATED_DESC', label: { en: 'Last Updated', es: 'Ultima actualizacion' } },
  { value: 'TITLE_ASC', label: { en: 'Title', es: 'Titulo' } },
  { value: 'SCORE_DESC', label: { en: 'Score', es: 'Puntuacion' } },
  { value: 'PROGRESS_DESC', label: { en: 'Progress', es: 'Progreso' } },
  { value: 'ADDED_DESC', label: { en: 'Last Added', es: 'Ultimo agregado' } },
  { value: 'STARTED_DESC', label: { en: 'Start Date', es: 'Fecha de inicio' } },
  { value: 'COMPLETED_DESC', label: { en: 'Completed Date', es: 'Fecha de finalizacion' } },
  { value: 'RELEASE_DESC', label: { en: 'Release Date', es: 'Fecha de estreno' } },
  { value: 'AVERAGE_SCORE_DESC', label: { en: 'Average Score', es: 'Puntuacion media' } },
  { value: 'POPULARITY_DESC', label: { en: 'Popularity', es: 'Popularidad' } },
]

function getLabels(lang, mediaType) {
  return STATUS_LABELS[mediaType]?.[lang] || STATUS_LABELS[mediaType]?.es || STATUS_LABELS.anime.en
}

function entryTitle(entry) {
  return entry?.title_english || entry?.title || 'Untitled'
}

function entrySecondaryTitle(entry) {
  if (entry?.title_english && entry?.title && entry.title_english !== entry.title) return entry.title
  return ''
}

function entryStudioOrFormat(entry, mediaType) {
  const format = entry?.media_format || (mediaType === 'anime' ? 'TV' : 'Manga')
  const subtitle = entry?.title ? entry.title : ''
  return [format, subtitle].filter(Boolean).join(' | ')
}

function entryCount(entry, mediaType) {
  return mediaType === 'anime' ? Number(entry?.episodes_total || 0) : Number(entry?.chapters_total || 0)
}

function preferHighQualityCover(url) {
  const value = String(url || '')
  if (!value) return ''
  return value
    .replace('/medium/', '/large/')
    .replace('/small/', '/large/')
    .replace(/(\bsize=)(medium|small)\b/i, '$1large')
}

function entryProgressValue(entry, mediaType) {
  return mediaType === 'anime' ? Number(entry?.episodes_watched || 0) : Number(entry?.chapters_read || 0)
}

function progressLabel(entry, mediaType) {
  const progress = entryProgressValue(entry, mediaType)
  const total = entryCount(entry, mediaType)
  return `${progress} / ${total || '-'}`
}

function progressPercent(entry, mediaType) {
  const total = entryCount(entry, mediaType)
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((entryProgressValue(entry, mediaType) / total) * 100)))
}

function buildEditorStorageKey(mediaType, anilistID) {
  return `${EDITOR_META_PREFIX}:${mediaType}:${Number(anilistID || 0)}`
}

function formatDateInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1901) return ''
  return date.toISOString().slice(0, 10)
}

function currentDateInput() {
  return new Date().toISOString().slice(0, 10)
}

function readEditorMeta(mediaType, entry) {
  const fallback = {
    startedOn: formatDateInput(
      entry?.started_at
      || entry?.start_date
      || entry?.startedAt
      || entry?.updated_at
      || entry?.added_at
      || '',
    ) || currentDateInput(),
    completedOn: '',
  }

  if (typeof localStorage === 'undefined' || !entry?.anilist_id) return fallback

  try {
    const raw = localStorage.getItem(buildEditorStorageKey(mediaType, entry.anilist_id))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return {
      startedOn: typeof parsed.startedOn === 'string' ? parsed.startedOn : fallback.startedOn,
      completedOn: typeof parsed.completedOn === 'string' ? parsed.completedOn : '',
    }
  } catch {
    return fallback
  }
}

function writeEditorMeta(mediaType, anilistID, payload) {
  if (typeof localStorage === 'undefined' || !anilistID) return
  localStorage.setItem(buildEditorStorageKey(mediaType, anilistID), JSON.stringify(payload))
}

function clampNumber(value, min, max) {
  const numeric = Number(value || 0)
  if (Number.isNaN(numeric)) return min
  return Math.max(min, Math.min(max, numeric))
}

function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
}

function MyListCard({ entry, mediaType, labels, isEnglish, isActive, onOpen, onEdit }) {
  const score = Number(entry.score || 0)
  const accent = STATUS_ACCENTS[entry.status] || '#f0b14d'
  const meta = [
    entry.year || '',
    entryStudioOrFormat(entry, mediaType).split(' | ')[0],
    progressLabel(entry, mediaType),
  ].filter(Boolean).join(' | ')

  return (
    <article className={`gui2-mylist-card${isActive ? ' active' : ''}`}>
      <button type="button" className="gui2-mylist-card-hitarea" onClick={onOpen} title={entryTitle(entry)}>
        <div className="gui2-mylist-card-art">
          {entry.cover_image ? (
            <img src={proxyImage(entry.cover_image)} alt={entryTitle(entry)} className="gui2-mylist-card-image" />
          ) : (
            <div className="gui2-mylist-card-image gui2-mylist-card-image-fallback">{entryTitle(entry).slice(0, 1)}</div>
          )}
          <div className="gui2-mylist-card-image-shade" />
          <span className="gui2-mylist-card-edit-icon" aria-hidden="true">✎</span>
          <span className="gui2-mylist-card-status" style={{ color: accent }}>
            {labels[entry.status] || entry.status}
          </span>
          <span className="gui2-mylist-card-score">
            {score > 0 ? score.toFixed(1) : '-'} <span aria-hidden="true">*</span>
          </span>
        </div>
        <div className="gui2-mylist-card-copy">
          <strong className="gui2-mylist-card-title">{entryTitle(entry)}</strong>
          <span className="gui2-mylist-card-meta">{meta}</span>
          <span className="gui2-mylist-card-progressbar">
            <span className="gui2-mylist-card-progressfill" style={{ width: `${progressPercent(entry, mediaType)}%`, backgroundColor: accent }} />
          </span>
        </div>
      </button>
      <button
        type="button"
        className="gui2-mylist-card-edit"
        aria-label={isEnglish ? 'Edit' : 'Editar'}
        onClick={(event) => {
          event.stopPropagation()
          event.preventDefault()
          onEdit()
        }}
      />
    </article>
  )
}

function AddAnimeResult({ item, label, onAdd }) {
  const title = item.title?.english || item.title?.romaji || item.title?.native || 'Anime'
  const subtitle = item.title?.romaji && item.title?.romaji !== title ? item.title.romaji : ''

  return (
    <article className="gui2-mylist-add-result">
      {item.coverImage?.large ? (
        <img src={proxyImage(item.coverImage.large)} alt={title} className="gui2-mylist-add-result-image" />
      ) : (
        <div className="gui2-mylist-add-result-image gui2-mylist-add-result-image-fallback">{title.slice(0, 1)}</div>
      )}
      <div className="gui2-mylist-add-result-copy">
        <div className="gui2-mylist-add-result-title">{title}</div>
        {subtitle ? <div className="gui2-mylist-add-result-subtitle">{subtitle}</div> : null}
      </div>
      <button type="button" className="btn btn-primary" onClick={() => onAdd(item)}>
        {label}
      </button>
    </article>
  )
}

function Gui2MyListsCoverDriven(props) {
  const {
    isEnglish,
    lang,
    activeMediaType,
    setActiveMediaType,
    setShowAddPanel,
    setShowActions,
    setSelectedKey,
    labels,
    statusFilter,
    setStatusFilter,
    query,
    setQuery,
    showActions,
    showSortMenu,
    setShowSortMenu,
    sortKey,
    sortLabel,
    setSortKey,
    pendingSyncCount,
    failedSyncCount,
    handleSyncAniList,
    handleRetrySync,
    handleClearList,
    showAddPanel,
    addQuery,
    setAddQuery,
    addStatus,
    setAddStatus,
    deferredAddQuery,
    searching,
    handleSearchToAdd,
    addResults,
    handleAddAnime,
    activeCounts,
    activeTotal,
    filteredEntries,
    groupedEntries,
    loading,
    pageEntries,
    selectedEntry,
    handleOpenEntry,
    setPage,
    safePage,
    totalPages,
    pageChips,
    pageSize,
    setPageSize,
    showFrom,
    showTo,
    saving,
    draftStatus,
    setDraftStatus,
    draftProgress,
    setDraftProgress,
    draftScore,
    setDraftScore,
    draftStartedOn,
    setDraftStartedOn,
    draftCompletedOn,
    setDraftCompletedOn,
    handleSaveSelection,
    handleResetSelection,
    handleRemoveSelection,
  } = props
  const selectedEntryCover = selectedEntry?.cover_image ? proxyImage(preferHighQualityCover(selectedEntry.cover_image)) : ''

  useEffect(() => {
    if (!selectedEntry || typeof document === 'undefined') return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedEntry])

  const editorOverlay = selectedEntry && typeof document !== 'undefined'
    ? createPortal(
      <>
        <button
          type="button"
          className="gui2-mylist-editor-backdrop"
          aria-label={isEnglish ? 'Close editor' : 'Cerrar editor'}
          onClick={() => setSelectedKey('')}
        />

        <aside className={`gui2-mylist-editor-drawer${selectedEntry ? ' open' : ''}`}>
          <div className="gui2-mylist-editor">
            <div className="gui2-mylist-editor-visual">
              {selectedEntryCover ? (
                <>
                  <div className="gui2-mylist-editor-image-backdrop" style={{ backgroundImage: `url("${selectedEntryCover.replace(/"/g, '\\"')}")` }} />
                  <img src={selectedEntryCover} alt={entryTitle(selectedEntry)} className="gui2-mylist-editor-image" />
                </>
              ) : (
                <div className="gui2-mylist-editor-image gui2-mylist-editor-image-fallback">{entryTitle(selectedEntry).slice(0, 1)}</div>
              )}
              <button type="button" className="gui2-mylist-editor-close" onClick={() => setSelectedKey('')} aria-label={isEnglish ? 'Close editor' : 'Cerrar editor'}>
                X
              </button>
            </div>

            <div className="gui2-mylist-editor-header">
              <h2 className="gui2-mylist-editor-title">{entryTitle(selectedEntry)}</h2>
              <div className="gui2-mylist-editor-meta">
                {[
                  selectedEntry.year,
                  entryCount(selectedEntry, activeMediaType) ? `${entryCount(selectedEntry, activeMediaType)} ${activeMediaType === 'anime' ? (isEnglish ? 'Episodes' : 'Episodios') : (isEnglish ? 'Chapters' : 'Capitulos')}` : '',
                  entryStudioOrFormat(selectedEntry, activeMediaType).split(' | ')[0],
                ].filter(Boolean).join(' | ')}
              </div>
            </div>

            <div className="gui2-mylist-editor-fields">
              <label className="gui2-mylist-field">
                <span>{isEnglish ? 'Status' : 'Estado'}</span>
                <select className="gui2-mylist-editor-select" value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}>
                  {STATUS_ORDER.filter((status) => status !== 'ALL').map((status) => (
                    <option key={status} value={status}>{labels[status]}</option>
                  ))}
                </select>
              </label>

              <div className="gui2-mylist-field">
                <span>{isEnglish ? 'Progress' : 'Progreso'}</span>
                <div className="gui2-mylist-stepper">
                  <button type="button" className="gui2-mylist-stepper-btn" onClick={() => setDraftProgress((value) => clampNumber(value - 1, 0, entryCount(selectedEntry, activeMediaType) || 9999))}>-</button>
                  <input
                    type="number"
                    className="gui2-mylist-stepper-input"
                    value={draftProgress}
                    min="0"
                    max={entryCount(selectedEntry, activeMediaType) || 9999}
                    onChange={(event) => setDraftProgress(clampNumber(event.target.value, 0, entryCount(selectedEntry, activeMediaType) || 9999))}
                  />
                  <button type="button" className="gui2-mylist-stepper-btn" onClick={() => setDraftProgress((value) => clampNumber(value + 1, 0, entryCount(selectedEntry, activeMediaType) || 9999))}>+</button>
                  <span className="gui2-mylist-stepper-total">/ {entryCount(selectedEntry, activeMediaType) || '-'}</span>
                </div>
                <div className="gui2-mylist-editor-progressbar">
                  <div className="gui2-mylist-editor-progressfill" style={{ width: `${entryCount(selectedEntry, activeMediaType) ? Math.round((draftProgress / entryCount(selectedEntry, activeMediaType)) * 100) : 0}%` }} />
                </div>
              </div>

              <div className="gui2-mylist-field">
                <span>{isEnglish ? 'Score' : 'Puntuacion'}</span>
                <div className="gui2-mylist-score-row">
                  <select className="gui2-mylist-editor-select" value={draftScore} onChange={(event) => setDraftScore(Number(event.target.value || 0))}>
                    {Array.from({ length: 11 }).map((_, index) => (
                      <option key={index} value={index}>{index === 0 ? '-' : index.toFixed(1)}</option>
                    ))}
                  </select>
                  <span className="gui2-mylist-score-star">*</span>
                </div>
              </div>

              <label className="gui2-mylist-field">
                <span>{isEnglish ? 'Started On' : 'Empezado el'}</span>
                <input type="date" className="gui2-mylist-editor-input" value={draftStartedOn} onChange={(event) => setDraftStartedOn(event.target.value)} />
              </label>

              <label className="gui2-mylist-field">
                <span>{isEnglish ? 'Completed On' : 'Finalizado el'}</span>
                <input type="date" className="gui2-mylist-editor-input" value={draftCompletedOn} onChange={(event) => setDraftCompletedOn(event.target.value)} />
              </label>
            </div>

            <div className="gui2-mylist-editor-footer">
              <button type="button" className="btn btn-primary" onClick={handleSaveSelection} disabled={saving}>
                {saving ? (isEnglish ? 'Saving...' : 'Guardando...') : (isEnglish ? 'Save Changes' : 'Guardar cambios')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleResetSelection}>
                {isEnglish ? 'Reset' : 'Restablecer'}
              </button>
              <button type="button" className="btn btn-ghost gui2-mylist-remove-btn" onClick={handleRemoveSelection}>
                {isEnglish ? 'Remove' : 'Eliminar'}
              </button>
            </div>
          </div>
        </aside>
      </>,
      document.body,
    )
    : null

  return (
    <div className="gui2-mylist-page gui2-motion-enter" style={buildMotionVars('page')}>
      <header
        className="gui2-mylist-switchline gui2-lists-hero gui2-lists-hero-premium gui2-motion-enter"
        style={{ ...buildMotionVars('section'), animationDelay: `${buildStaggerDelayMs(0, 30)}ms` }}
      >
        <div className="gui2-mylist-tabline" role="tablist" aria-label={isEnglish ? 'Media type' : 'Tipo de medio'}>
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`gui2-mylist-media-tab${activeMediaType === tab ? ' active' : ''}`}
              onClick={() => {
                setActiveMediaType(tab)
                setShowAddPanel(false)
                setShowActions(false)
                setShowSortMenu(false)
                setSelectedKey('')
              }}
            >
              {tab === 'anime' ? 'Anime' : 'Manga'}
            </button>
          ))}
        </div>
      </header>

      <section
        className="gui2-mylist-toolbar gui2-motion-enter"
        style={{ ...buildMotionVars('section'), animationDelay: `${buildStaggerDelayMs(1, 30)}ms` }}
      >
        <div className="gui2-mylist-status-tabs">
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              type="button"
              className={`gui2-mylist-status-tab${statusFilter === status ? ' active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              {labels[status]}
            </button>
          ))}
        </div>

        <div className="gui2-mylist-toolbar-actions">
          <div className="gui2-mylist-search">
            <span className="gui2-mylist-search-icon">Q</span>
            <input
              type="text"
              className="gui2-mylist-search-input"
              placeholder={isEnglish ? 'Search your lists...' : 'Buscar en tus listas...'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="gui2-mylist-sort-wrap">
            <button
              type="button"
              className="gui2-mylist-sort-toggle"
              onClick={() => setShowSortMenu((value) => !value)}
              aria-label={isEnglish ? 'Sort list' : 'Ordenar lista'}
            >
              <span className="gui2-mylist-sort-icon" aria-hidden="true">↕</span>
              <span className="gui2-mylist-sort-label">{sortLabel}</span>
            </button>

            {showSortMenu ? (
              <div className="gui2-mylist-sort-menu">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`gui2-mylist-sort-item${sortKey === option.value ? ' active' : ''}`}
                    onClick={() => {
                      setShowSortMenu(false)
                      setSortKey(option.value)
                    }}
                  >
                    {isEnglish ? option.label.en : option.label.es}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="gui2-mylist-actions-menu-wrap">
            <button
              type="button"
              className="gui2-mylist-actions-toggle"
              onClick={() => setShowActions((value) => !value)}
              aria-label={isEnglish ? 'List actions' : 'Acciones de lista'}
            >
              <span />
              <span />
              <span />
            </button>

            {showActions ? (
              <div className="gui2-mylist-actions-menu">
                {activeMediaType === 'anime' ? (
                  <button
                    type="button"
                    className="gui2-mylist-actions-item"
                    onClick={() => {
                      setShowAddPanel((value) => !value)
                      setShowActions(false)
                    }}
                  >
                    {showAddPanel ? (isEnglish ? 'Hide Add Anime' : 'Ocultar agregar anime') : (isEnglish ? 'Add Anime' : 'Agregar anime')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="gui2-mylist-actions-item"
                  onClick={() => {
                    handleSyncAniList()
                    setShowActions(false)
                  }}
                >
                  {isEnglish ? 'Sync AniList' : 'Sincronizar AniList'}
                </button>
                <button
                  type="button"
                  className="gui2-mylist-actions-item"
                  onClick={() => {
                    handleRetrySync()
                    setShowActions(false)
                  }}
                  disabled={pendingSyncCount === 0 && failedSyncCount === 0}
                >
                  {isEnglish ? 'Retry Queue' : 'Reintentar cola'}
                </button>
                <button
                  type="button"
                  className="gui2-mylist-actions-item danger"
                  onClick={() => {
                    handleClearList()
                    setShowActions(false)
                  }}
                >
                  {activeMediaType === 'anime' ? (isEnglish ? 'Clear Anime List' : 'Borrar anime') : (isEnglish ? 'Clear Manga List' : 'Borrar manga')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {showAddPanel && activeMediaType === 'anime' ? (
        <section className="gui2-mylist-add-panel">
          <div className="gui2-mylist-add-controls">
            <input
              type="text"
              className="gui2-mylist-search-input"
              placeholder={isEnglish ? 'Search AniList...' : 'Buscar en AniList...'}
              value={addQuery}
              onChange={(event) => setAddQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSearchToAdd()
              }}
            />
            <select className="gui2-mylist-inline-select" value={addStatus} onChange={(event) => setAddStatus(event.target.value)}>
              {STATUS_ORDER.filter((status) => status !== 'ALL').map((status) => (
                <option key={status} value={status}>{getLabels(lang, 'anime')[status]}</option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" onClick={handleSearchToAdd} disabled={!deferredAddQuery.trim() || searching}>
              {searching ? (isEnglish ? 'Searching...' : 'Buscando...') : (isEnglish ? 'Search' : 'Buscar')}
            </button>
          </div>
          <div className="gui2-mylist-add-results">
            {addResults.length ? addResults.slice(0, 8).map((item) => (
              <AddAnimeResult
                key={item.id}
                item={item}
                label={`+ ${getLabels(lang, 'anime')[addStatus]}`}
                onAdd={handleAddAnime}
              />
            )) : (
              <div className="gui2-inline-empty">
                {searching
                  ? (isEnglish ? 'Searching AniList...' : 'Buscando en AniList...')
                  : (isEnglish ? 'Search for a title to add it directly into your list.' : 'Busca un titulo para agregarlo directamente a tu lista.')}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <div
        className="gui2-mylist-grid-shell gui2-lists-shelf gui2-motion-enter gui2-lists-shell-premium"
        style={{ ...buildMotionVars('section'), animationDelay: `${buildStaggerDelayMs(2, 30)}ms` }}
      >
        <section className="gui2-mylist-grid-wrap">
          <div
            key={`${activeMediaType}-${statusFilter}`}
            className="gui2-mylist-content-stage gui2-motion-enter"
            style={buildMotionVars('section')}
          >
            <div className="gui2-mylist-grid-meta">
              <span>{isEnglish ? `${filteredEntries.length} entries` : `${filteredEntries.length} entradas`}</span>
              <span>{labels.WATCHING}: {Number(activeCounts.WATCHING || 0)} | {labels.COMPLETED}: {Number(activeCounts.COMPLETED || 0)} | {isEnglish ? 'Total' : 'Total'}: {activeTotal}</span>
            </div>

            {loading ? (
              <div className="gui2-inline-empty">{isEnglish ? 'Loading your lists...' : 'Cargando tus listas...'}</div>
            ) : statusFilter === 'ALL' ? (
              <div className="gui2-mylist-status-shelves">
                {groupedEntries.length ? groupedEntries.map((section, index) => (
                  <section
                    key={section.status}
                    className="gui2-mylist-status-shelf gui2-motion-enter"
                    style={{ ...buildMotionVars('card'), animationDelay: `${buildStaggerDelayMs(index, 24)}ms` }}
                  >
                    <header className="gui2-mylist-status-shelf-head">
                      <h2 className="gui2-mylist-status-shelf-title">{section.label}</h2>
                      <span className="gui2-mylist-status-shelf-count">{section.entries.length}</span>
                    </header>
                    <div className="gui2-mylist-status-shelf-grid">
                      {section.entries.map((entry) => (
                        <MyListCard
                          key={`${activeMediaType}-${section.status}-${entry.anilist_id}`}
                          entry={entry}
                          mediaType={activeMediaType}
                          labels={labels}
                          isEnglish={isEnglish}
                          isActive={selectedEntry?.anilist_id === entry.anilist_id}
                          onOpen={() => handleOpenEntry(entry, activeMediaType)}
                          onEdit={() => setSelectedKey(`${activeMediaType}-${entry.anilist_id}`)}
                        />
                      ))}
                    </div>
                  </section>
                )) : (
                  <div className="gui2-inline-empty">{isEnglish ? 'No entries match the current filters.' : 'No hay elementos para los filtros actuales.'}</div>
                )}
              </div>
            ) : (
              <>
                <div className="gui2-mylist-grid">
                  {pageEntries.length ? pageEntries.map((entry) => (
                    <MyListCard
                      key={`${activeMediaType}-${entry.anilist_id}`}
                      entry={entry}
                      mediaType={activeMediaType}
                      labels={labels}
                      isEnglish={isEnglish}
                      isActive={selectedEntry?.anilist_id === entry.anilist_id}
                      onOpen={() => handleOpenEntry(entry, activeMediaType)}
                      onEdit={() => setSelectedKey(`${activeMediaType}-${entry.anilist_id}`)}
                    />
                  )) : (
                    <div className="gui2-inline-empty">{isEnglish ? 'No entries match the current filters.' : 'No hay elementos para los filtros actuales.'}</div>
                  )}
                </div>

                <div className="gui2-mylist-grid-footer">
                  <div className="gui2-mylist-table-summary">
                    {isEnglish
                      ? `Showing ${showFrom}-${showTo} of ${filteredEntries.length} entries`
                      : `Mostrando ${showFrom}-${showTo} de ${filteredEntries.length} entradas`}
                  </div>
                  <div className="gui2-mylist-footer-actions">
                    <div className="gui2-mylist-pagination">
                      <button type="button" className="gui2-mylist-page-btn" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                        {'<'}
                      </button>
                      {pageChips.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={`gui2-mylist-page-chip${item === safePage ? ' active' : ''}`}
                          onClick={() => setPage(item)}
                        >
                          {item}
                        </button>
                      ))}
                      <button type="button" className="gui2-mylist-page-btn" disabled={safePage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                        {'>'}
                      </button>
                    </div>
                    <label className="gui2-mylist-rows">
                      <span>{isEnglish ? 'Cards per page:' : 'Tarjetas por pagina:'}</span>
                      <select className="gui2-mylist-inline-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) || 24)}>
                        {PAGE_SIZE_OPTIONS.map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {editorOverlay}

      {(pendingSyncCount > 0 || failedSyncCount > 0) ? (
        <div className="gui2-inline-status">
          {isEnglish
            ? `Remote sync queue: ${pendingSyncCount} pending / ${failedSyncCount} failed.`
            : `Cola remota: ${pendingSyncCount} pendientes / ${failedSyncCount} fallidos.`}
        </div>
      ) : null}
    </div>
  )
}

export default function Gui2MyListsRoute({ preview = false }) {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [activeMediaType, setActiveMediaType] = useState('anime')
  const [animeEntries, setAnimeEntries] = useState([])
  const [animeCounts, setAnimeCounts] = useState({})
  const [mangaEntries, setMangaEntries] = useState([])
  const [mangaCounts, setMangaCounts] = useState({})
  const [loadingAnime, setLoadingAnime] = useState(true)
  const [loadingManga, setLoadingManga] = useState(true)
  const [syncStatus, setSyncStatus] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [sortKey, setSortKey] = useState('UPDATED_DESC')
  const [pageSize, setPageSize] = useState(24)
  const [page, setPage] = useState(1)
  const [selectedKey, setSelectedKey] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addStatus, setAddStatus] = useState('PLANNING')
  const [addResults, setAddResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [draftStatus, setDraftStatus] = useState('WATCHING')
  const [draftProgress, setDraftProgress] = useState(0)
  const [draftScore, setDraftScore] = useState(0)
  const [draftStartedOn, setDraftStartedOn] = useState('')
  const [draftCompletedOn, setDraftCompletedOn] = useState('')
  const [saving, setSaving] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const deferredAddQuery = useDeferredValue(addQuery)
  const animeOnlinePath = withGui2Prefix('/anime-online', preview)
  const mangaOnlinePath = withGui2Prefix('/manga-online', preview)
  const labels = getLabels(lang, activeMediaType)

  const loadAnime = async () => {
    setLoadingAnime(true)
    try {
      const [entries, counts] = await Promise.all([
        wails.getAnimeListAll(),
        wails.getAnimeListCounts(),
      ])
      setAnimeEntries(entries ?? [])
      setAnimeCounts(counts ?? {})
    } catch {
      setAnimeEntries([])
      setAnimeCounts({})
    } finally {
      setLoadingAnime(false)
    }
  }

  const loadManga = async () => {
    setLoadingManga(true)
    try {
      const [entries, counts] = await Promise.all([
        wails.getMangaListAll(),
        wails.getMangaListCounts(),
      ])
      setMangaEntries(entries ?? [])
      setMangaCounts(counts ?? {})
    } catch {
      setMangaEntries([])
      setMangaCounts({})
    } finally {
      setLoadingManga(false)
    }
  }

  const loadSyncMeta = async () => {
    try {
      setSyncStatus(await wails.getRemoteListSyncStatus())
    } catch {
      setSyncStatus(null)
    }
  }

  useEffect(() => {
    loadAnime()
    loadManga()
    loadSyncMeta()
  }, [])

  const activeEntries = activeMediaType === 'anime' ? animeEntries : mangaEntries
  const activeCounts = activeMediaType === 'anime' ? animeCounts : mangaCounts
  const activeTotal = Object.values(activeCounts).reduce((sum, value) => sum + Number(value || 0), 0)
  const loading = activeMediaType === 'anime' ? loadingAnime : loadingManga
  const pendingSyncCount = Number(syncStatus?.pending_count || 0)
  const failedSyncCount = Number(syncStatus?.failed_count || 0)
  const sortLabel = (SORT_OPTIONS.find((option) => option.value === sortKey)?.label?.[lang] || SORT_OPTIONS[0].label[lang] || SORT_OPTIONS[0].label.en)

  const filteredEntries = useMemo(() => {
    const term = String(deferredQuery || '').trim().toLowerCase()
    return activeEntries
      .filter((entry) => {
        if (statusFilter !== 'ALL' && entry.status !== statusFilter) return false
        if (!term) return true
        return [entry.title, entry.title_english, entry.status, entry.year].filter(Boolean).join(' ').toLowerCase().includes(term)
      })
      .sort((a, b) => {
        const metaA = readEditorMeta(activeMediaType, a)
        const metaB = readEditorMeta(activeMediaType, b)
        const progressA = entryProgressValue(a, activeMediaType)
        const progressB = entryProgressValue(b, activeMediaType)
        switch (sortKey) {
          case 'TITLE_ASC':
            return compareText(a.title_english || a.title, b.title_english || b.title)
          case 'SCORE_DESC':
            return (Number(b.score) || 0) - (Number(a.score) || 0) || compareText(a.title_english || a.title, b.title_english || b.title)
          case 'PROGRESS_DESC':
            return progressB - progressA || compareText(a.title_english || a.title, b.title_english || b.title)
          case 'ADDED_DESC':
            return toTimestamp(b.added_at) - toTimestamp(a.added_at)
          case 'STARTED_DESC':
            return toTimestamp(metaB.startedOn) - toTimestamp(metaA.startedOn)
          case 'COMPLETED_DESC':
            return toTimestamp(metaB.completedOn) - toTimestamp(metaA.completedOn)
          case 'RELEASE_DESC':
            return (Number(b.year) || 0) - (Number(a.year) || 0) || compareText(a.title_english || a.title, b.title_english || b.title)
          case 'AVERAGE_SCORE_DESC':
            return (Number(b.average_score || b.averageScore) || 0) - (Number(a.average_score || a.averageScore) || 0)
              || (Number(b.year) || 0) - (Number(a.year) || 0)
          case 'POPULARITY_DESC':
            return (Number(b.popularity) || 0) - (Number(a.popularity) || 0)
              || (Number(b.year) || 0) - (Number(a.year) || 0)
          case 'UPDATED_DESC':
          default:
            return toTimestamp(b.updated_at || b.added_at) - toTimestamp(a.updated_at || a.added_at)
        }
      })
  }, [activeEntries, activeMediaType, deferredQuery, sortKey, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const groupedEntries = useMemo(() => (
    statusFilter === 'ALL'
      ? STATUS_ORDER
        .filter((status) => status !== 'ALL')
        .map((status) => ({
          status,
          label: labels[status],
          entries: filteredEntries.filter((entry) => entry.status === status),
        }))
        .filter((section) => section.entries.length)
      : []
  ), [filteredEntries, labels, statusFilter])

  const pageEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredEntries.slice(start, start + pageSize)
  }, [filteredEntries, pageSize, safePage])

  useEffect(() => {
    setPage(1)
  }, [activeMediaType, deferredQuery, sortKey, statusFilter, pageSize])

  useEffect(() => {
    if (!filteredEntries.length) {
      setSelectedKey('')
      return
    }
    if (!filteredEntries.some((entry) => `${activeMediaType}-${entry.anilist_id}` === selectedKey)) {
      setSelectedKey('')
    }
  }, [activeMediaType, filteredEntries, selectedKey])

  const selectedEntry = pageEntries.find((entry) => `${activeMediaType}-${entry.anilist_id}` === selectedKey)
    || filteredEntries.find((entry) => `${activeMediaType}-${entry.anilist_id}` === selectedKey)
    || null

  useEffect(() => {
    if (!selectedEntry) return
    const stored = readEditorMeta(activeMediaType, selectedEntry)
    setDraftStatus(selectedEntry.status || 'PLANNING')
    setDraftProgress(entryProgressValue(selectedEntry, activeMediaType))
    setDraftScore(Number(selectedEntry.score || 0))
    setDraftStartedOn(stored.startedOn || '')
    setDraftCompletedOn(stored.completedOn || '')
  }, [activeMediaType, selectedEntry])

  const reportSyncResult = (result) => {
    if (!result) return
    if (result.remote_failed > 0) {
      toastError(result.messages?.length ? result.messages.join(' ') : (isEnglish ? 'Some sync updates were queued for retry.' : 'Algunas actualizaciones quedaron en cola para reintento.'))
    }
  }

  const refreshActive = async () => {
    if (activeMediaType === 'anime') {
      await loadAnime()
    } else {
      await loadManga()
    }
    await loadSyncMeta()
  }

  const handleSyncAniList = async () => {
    try {
      await wails.syncAniListLists()
      toastSuccess(isEnglish ? 'AniList sync requested.' : 'Sincronizacion AniList solicitada.')
      await loadAnime()
      await loadManga()
      await loadSyncMeta()
    } catch (error) {
      toastError(error?.message || 'Unknown error')
    }
  }

  const handleRetrySync = async () => {
    try {
      const result = await wails.retryRemoteListSync('anilist')
      reportSyncResult(result)
      await loadSyncMeta()
      toastSuccess(isEnglish ? 'Retry queued.' : 'Reintento enviado.')
    } catch (error) {
      toastError(error?.message || 'Unknown error')
    }
  }

  const handleClearList = async () => {
    const confirmed = window.confirm(
      activeMediaType === 'anime'
        ? (isEnglish ? 'Clear the anime list?' : 'Borrar la lista de anime?')
        : (isEnglish ? 'Clear the manga list?' : 'Borrar la lista de manga?'),
    )
    if (!confirmed) return

    try {
      if (activeMediaType === 'anime') {
        await wails.clearAnimeList()
        await loadAnime()
      } else {
        await wails.clearMangaList()
        await loadManga()
      }
      setSelectedKey('')
      toastSuccess(isEnglish ? 'List cleared.' : 'Lista borrada.')
      await loadSyncMeta()
    } catch (error) {
      toastError(error?.message || 'Unknown error')
    }
  }

  const handleSearchToAdd = async () => {
    if (!deferredAddQuery.trim()) return
    setSearching(true)
    try {
      const result = await wails.searchAniList(deferredAddQuery.trim(), lang)
      startTransition(() => {
        setAddResults(extractAniListAnimeSearchMedia(result))
      })
    } catch {
      startTransition(() => setAddResults([]))
    } finally {
      setSearching(false)
    }
  }

  const handleAddAnime = async (anime) => {
    try {
      const result = await wails.addToAnimeList(
        anime.id,
        anime.idMal || 0,
        anime.title?.romaji || anime.title?.english || '',
        anime.title?.english || '',
        anime.coverImage?.large || anime.coverImage?.medium || '',
        addStatus,
        0,
        anime.episodes || 0,
        0,
        anime.status || '',
        anime.seasonYear || 0,
      )
      reportSyncResult(result)
      toastSuccess(`"${anime.title?.romaji || anime.title?.english || 'Anime'}" ${isEnglish ? 'added to your list.' : 'agregado a tu lista.'}`)
      setShowAddPanel(false)
      setAddQuery('')
      setAddResults([])
      await loadAnime()
      await loadSyncMeta()
    } catch (error) {
      toastError(error?.message || 'Unknown error')
    }
  }

  const handleOpenEntry = (entry, mediaType = activeMediaType) => {
    if (!entry) return
    if (mediaType === 'anime') {
      navigate(animeOnlinePath, { state: buildAnimeNavigationState(entry) })
      return
    }
    navigate(mangaOnlinePath, { state: buildMangaListNavigationState(entry) })
  }

  const handleRemoveSelection = async () => {
    if (!selectedEntry) return
    const syncRemote = window.confirm(
      isEnglish
        ? 'Also remove it from AniList if connected?'
        : 'Tambien quieres eliminarlo de AniList si esta conectado?',
    )

    try {
      if (activeMediaType === 'anime') {
        const result = await wails.removeFromAnimeList(selectedEntry.anilist_id, syncRemote)
        reportSyncResult(result)
        await loadAnime()
      } else {
        const result = await wails.removeFromMangaList(selectedEntry.anilist_id, syncRemote)
        reportSyncResult(result)
        await loadManga()
      }
      writeEditorMeta(activeMediaType, selectedEntry.anilist_id, { startedOn: '', completedOn: '' })
      setSelectedKey('')
      await loadSyncMeta()
    } catch (error) {
      toastError(error?.message || 'Unknown error')
    }
  }

  const handleSaveSelection = async () => {
    if (!selectedEntry) return
    setSaving(true)
    try {
      if (draftStatus !== (selectedEntry.status || 'PLANNING')) {
        const result = activeMediaType === 'anime'
          ? await wails.updateAnimeListStatus(selectedEntry.anilist_id, draftStatus)
          : await wails.updateMangaListStatus(selectedEntry.anilist_id, draftStatus)
        reportSyncResult(result)
      }

      const currentProgress = entryProgressValue(selectedEntry, activeMediaType)
      if (draftProgress !== currentProgress) {
        const result = activeMediaType === 'anime'
          ? await wails.updateAnimeListProgress(selectedEntry.anilist_id, draftProgress)
          : await wails.updateMangaListProgress(selectedEntry.anilist_id, draftProgress)
        reportSyncResult(result)
      }

      const currentScore = Number(selectedEntry.score || 0)
      if (Number(draftScore || 0) !== currentScore) {
        const result = activeMediaType === 'anime'
          ? await wails.updateAnimeListScore(selectedEntry.anilist_id, Number(draftScore || 0))
          : await wails.updateMangaListScore(selectedEntry.anilist_id, Number(draftScore || 0))
        reportSyncResult(result)
      }

      writeEditorMeta(activeMediaType, selectedEntry.anilist_id, {
        startedOn: draftStartedOn,
        completedOn: draftCompletedOn,
      })

      toastSuccess(isEnglish ? 'Changes saved.' : 'Cambios guardados.')
      await refreshActive()
    } catch (error) {
      toastError(error?.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const handleResetSelection = () => {
    if (!selectedEntry) return
    const stored = readEditorMeta(activeMediaType, selectedEntry)
    setDraftStatus(selectedEntry.status || 'PLANNING')
    setDraftProgress(entryProgressValue(selectedEntry, activeMediaType))
    setDraftScore(Number(selectedEntry.score || 0))
    setDraftStartedOn(stored.startedOn || '')
    setDraftCompletedOn(stored.completedOn || '')
  }

  const showFrom = filteredEntries.length === 0 ? 0 : ((safePage - 1) * pageSize) + 1
  const showTo = Math.min(filteredEntries.length, safePage * pageSize)
  const pageChips = [
    safePage > 1 ? safePage - 1 : null,
    safePage,
    safePage < totalPages ? safePage + 1 : null,
  ].filter((item, index, array) => Number.isFinite(item) && array.indexOf(item) === index)

  return (
    <Gui2MyListsCoverDriven
      isEnglish={isEnglish}
      lang={lang}
      activeMediaType={activeMediaType}
      setActiveMediaType={setActiveMediaType}
      setShowAddPanel={setShowAddPanel}
      setShowActions={setShowActions}
      setSelectedKey={setSelectedKey}
      labels={labels}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      query={query}
      setQuery={setQuery}
      showActions={showActions}
      showSortMenu={showSortMenu}
      setShowSortMenu={setShowSortMenu}
      sortKey={sortKey}
      sortLabel={sortLabel}
      setSortKey={setSortKey}
      pendingSyncCount={pendingSyncCount}
      failedSyncCount={failedSyncCount}
      handleSyncAniList={handleSyncAniList}
      handleRetrySync={handleRetrySync}
      handleClearList={handleClearList}
      showAddPanel={showAddPanel}
      addQuery={addQuery}
      setAddQuery={setAddQuery}
      addStatus={addStatus}
      setAddStatus={setAddStatus}
      deferredAddQuery={deferredAddQuery}
      searching={searching}
      handleSearchToAdd={handleSearchToAdd}
      addResults={addResults}
      handleAddAnime={handleAddAnime}
      activeCounts={activeCounts}
      activeTotal={activeTotal}
      filteredEntries={filteredEntries}
      groupedEntries={groupedEntries}
      loading={loading}
      pageEntries={pageEntries}
      selectedEntry={selectedEntry}
      handleOpenEntry={handleOpenEntry}
      setPage={setPage}
      safePage={safePage}
      totalPages={totalPages}
      pageChips={pageChips}
      pageSize={pageSize}
      setPageSize={setPageSize}
      showFrom={showFrom}
      showTo={showTo}
      saving={saving}
      draftStatus={draftStatus}
      setDraftStatus={setDraftStatus}
      draftProgress={draftProgress}
      setDraftProgress={setDraftProgress}
      draftScore={draftScore}
      setDraftScore={setDraftScore}
      draftStartedOn={draftStartedOn}
      setDraftStartedOn={setDraftStartedOn}
      draftCompletedOn={draftCompletedOn}
      setDraftCompletedOn={setDraftCompletedOn}
      handleSaveSelection={handleSaveSelection}
      handleResetSelection={handleResetSelection}
      handleRemoveSelection={handleRemoveSelection}
    />
  )
}