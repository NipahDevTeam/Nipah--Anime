import { createPortal } from 'react-dom'
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toastError, toastSuccess } from '../../components/ui/Toast'
import { useI18n } from '../../lib/i18n'
import { extractAniListAnimeSearchMedia } from '../../lib/anilistSearch'
import { buildAnimeNavigationState, buildMangaListNavigationState } from '../../lib/mediaNavigation'
import { proxyImage, wails } from '../../lib/wails'
import { withGui2Prefix } from '../routeRegistry'

const MEDIA_TABS = ['anime', 'manga']
const STATUS_ORDER = ['ALL', 'WATCHING', 'COMPLETED', 'PLANNING', 'DROPPED', 'ON_HOLD']
const SORT_OPTIONS = [
  'LAST_UPDATED',
  'LAST_ADDED',
  'TITLE',
  'SCORE',
  'PROGRESS',
  'START_DATE',
  'COMPLETED_DATE',
  'RELEASE_DATE',
  'AVERAGE_SCORE',
  'POPULARITY',
]

const STATUS_LABELS = {
  anime: {
    es: { ALL: 'Todo', WATCHING: 'Watching', COMPLETED: 'Completed', PLANNING: 'Planned', DROPPED: 'Dropped', ON_HOLD: 'On Hold' },
    en: { ALL: 'All', WATCHING: 'Watching', COMPLETED: 'Completed', PLANNING: 'Planned', DROPPED: 'Dropped', ON_HOLD: 'On Hold' },
  },
  manga: {
    es: { ALL: 'Todo', WATCHING: 'Reading', COMPLETED: 'Completed', PLANNING: 'Planned', DROPPED: 'Dropped', ON_HOLD: 'On Hold' },
    en: { ALL: 'All', WATCHING: 'Reading', COMPLETED: 'Completed', PLANNING: 'Planned', DROPPED: 'Dropped', ON_HOLD: 'On Hold' },
  },
}

const STATUS_ACCENTS = {
  WATCHING: '#f0b14d',
  COMPLETED: '#8cc46c',
  PLANNING: '#d5d8df',
  DROPPED: '#f05d5d',
  ON_HOLD: '#76afff',
}

function getLabels(lang, mediaType) {
  return STATUS_LABELS[mediaType]?.[lang] || STATUS_LABELS[mediaType]?.es || STATUS_LABELS.anime.en
}

function entryTitle(entry) {
  return entry?.title_english || entry?.title || 'Untitled'
}

function entryMeta(entry, mediaType) {
  const format = entry?.media_format || (mediaType === 'anime' ? 'TV' : 'Manga')
  const year = entry?.year || entry?.publication_year || ''
  return [format, year].filter(Boolean).join(' · ')
}

function entryCount(entry, mediaType) {
  return mediaType === 'anime' ? Number(entry?.episodes_total || 0) : Number(entry?.chapters_total || 0)
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

function currentDateInput() {
  return new Date().toISOString().slice(0, 10)
}

function formatDateInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function defaultStartedDate(entry) {
  return formatDateInput(entry?.started_at || entry?.updated_at || entry?.added_at || '') || currentDateInput()
}

function defaultCompletedDate(entry) {
  return formatDateInput(entry?.completed_at || '')
}

function compareDate(a, b) {
  const aTime = new Date(a || 0).getTime()
  const bTime = new Date(b || 0).getTime()
  return bTime - aTime
}

function sortEntries(entries, sortBy, mediaType) {
  const next = [...entries]
  next.sort((a, b) => {
    switch (sortBy) {
      case 'TITLE':
        return entryTitle(a).localeCompare(entryTitle(b))
      case 'SCORE':
        return Number(b?.score || 0) - Number(a?.score || 0)
      case 'PROGRESS':
        return entryProgressValue(b, mediaType) - entryProgressValue(a, mediaType)
      case 'START_DATE':
        return compareDate(a?.started_at, b?.started_at)
      case 'COMPLETED_DATE':
        return compareDate(a?.completed_at, b?.completed_at)
      case 'RELEASE_DATE':
        return Number(b?.year || b?.publication_year || 0) - Number(a?.year || a?.publication_year || 0)
      case 'AVERAGE_SCORE':
        return Number(b?.average_score || 0) - Number(a?.average_score || 0)
      case 'POPULARITY':
        return Number(b?.popularity || 0) - Number(a?.popularity || 0)
      case 'LAST_ADDED':
        return compareDate(a?.added_at, b?.added_at)
      case 'LAST_UPDATED':
      default:
        return compareDate(a?.updated_at || a?.added_at, b?.updated_at || b?.added_at)
    }
  })
  return next
}

function MyListMetric({ label, value }) {
  return (
    <article className="gui2-mylist-metric">
      <span className="gui2-mylist-metric-label">{label}</span>
      <strong className="gui2-mylist-metric-value">{value}</strong>
    </article>
  )
}

function MyListCard({ entry, mediaType, labels, onOpen, onEdit }) {
  const title = entryTitle(entry)
  const statusColor = STATUS_ACCENTS[entry.status] || '#d9dee8'

  return (
    <button type="button" className="gui2-mylist-card" onClick={() => onOpen(entry, mediaType)} title={title}>
      <div className="gui2-mylist-card-art">
        {entry.cover_image ? (
          <img src={proxyImage(entry.cover_image)} alt={title} className="gui2-mylist-card-image" />
        ) : (
          <div className="gui2-mylist-card-fallback">{title.slice(0, 1)}</div>
        )}
        <button
          type="button"
          className="gui2-mylist-card-edit gui2-mylist-card-edit-icon"
          aria-label="Edit entry"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onEdit(entry)
          }}
        >
          ✎
        </button>
        <div className="gui2-mylist-card-overlay" />
      </div>
      <div className="gui2-mylist-card-body">
        <div className="gui2-mylist-card-title">{title}</div>
        <div className="gui2-mylist-card-meta">{entryMeta(entry, mediaType)}</div>
        <div className="gui2-mylist-card-pillrow">
          <span className="gui2-mylist-card-pill" style={{ color: statusColor, borderColor: `${statusColor}55`, background: `${statusColor}12` }}>
            {labels[entry.status] || entry.status}
          </span>
          <span className="gui2-mylist-card-pill">{Number(entry.score || 0) > 0 ? `${Number(entry.score).toFixed(1)} ★` : '—'}</span>
        </div>
        <div className="gui2-mylist-card-progress">
          <span>{progressLabel(entry, mediaType)}</span>
          <span>{progressPercent(entry, mediaType)}%</span>
        </div>
      </div>
    </button>
  )
}

function MyListGrid({ entries, mediaType, labels, onOpen, onEdit }) {
  return (
    <div className="gui2-mylist-status-shelf-grid">
      {entries.map((entry) => (
        <MyListCard
          key={`${mediaType}-${entry.anilist_id}`}
          entry={entry}
          mediaType={mediaType}
          labels={labels}
          onOpen={onOpen}
          onEdit={onEdit}
        />
      ))}
    </div>
  )
}

function MyListCollection({ groupedEntries, statusFilter, labels, activeMediaType, onOpen, onEdit }) {
  if (statusFilter !== 'ALL') {
    return (
      <div className="gui2-mylist-status-shelf-grid">
        {(groupedEntries[statusFilter] || []).map((entry) => (
          <MyListCard
            key={`${activeMediaType}-${entry.anilist_id}`}
            entry={entry}
            mediaType={activeMediaType}
            labels={labels}
            onOpen={onOpen}
            onEdit={onEdit}
          />
        ))}
      </div>
    )
  }

  return (
    <>
      {STATUS_ORDER.filter((status) => status !== 'ALL').map((status) => {
        const entries = groupedEntries[status] || []
        if (!entries.length) return null
        return (
          <section key={status} className="gui2-mylist-status-shelf">
            <div className="gui2-mylist-status-shelf-head">
              <h3>{labels[status] || status}</h3>
              <span>{entries.length}</span>
            </div>
            <MyListGrid entries={entries} mediaType={activeMediaType} labels={labels} onOpen={onOpen} onEdit={onEdit} />
          </section>
        )
      })}
    </>
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
  const [sortBy, setSortBy] = useState('LAST_UPDATED')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addStatus, setAddStatus] = useState('PLANNING')
  const [addResults, setAddResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState(null)
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
      const [entries, counts] = await Promise.all([wails.getAnimeListAll(), wails.getAnimeListCounts()])
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
      const [entries, counts] = await Promise.all([wails.getMangaListAll(), wails.getMangaListCounts()])
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

  useEffect(() => {
    if (!selectedEntry) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedEntry])

  const activeEntries = activeMediaType === 'anime' ? animeEntries : mangaEntries
  const activeCounts = activeMediaType === 'anime' ? animeCounts : mangaCounts
  const loading = activeMediaType === 'anime' ? loadingAnime : loadingManga
  const pendingSyncCount = Number(syncStatus?.pending_count || 0)
  const failedSyncCount = Number(syncStatus?.failed_count || 0)

  const filteredEntries = useMemo(() => {
    const term = String(deferredQuery || '').trim().toLowerCase()
    const base = activeEntries.filter((entry) => {
      if (statusFilter !== 'ALL' && entry.status !== statusFilter) return false
      if (!term) return true
      return [entry.title, entry.title_english, entry.status, entry.year].filter(Boolean).join(' ').toLowerCase().includes(term)
    })
    return sortEntries(base, sortBy, activeMediaType)
  }, [activeEntries, activeMediaType, deferredQuery, sortBy, statusFilter])

  const groupedEntries = useMemo(() => (
    STATUS_ORDER.reduce((acc, status) => {
      if (status === 'ALL') return acc
      acc[status] = filteredEntries.filter((entry) => entry.status === status)
      return acc
    }, {})
  ), [filteredEntries])

  const metricItems = [
    { label: isEnglish ? 'Total Entries' : 'Entradas totales', value: Object.values(activeCounts).reduce((sum, value) => sum + Number(value || 0), 0) },
    { label: labels.WATCHING, value: Number(activeCounts.WATCHING || 0) },
    { label: labels.COMPLETED, value: Number(activeCounts.COMPLETED || 0) },
    { label: labels.PLANNING, value: Number(activeCounts.PLANNING || 0) },
  ]

  const sortLabels = {
    TITLE: isEnglish ? 'Title' : 'Titulo',
    SCORE: isEnglish ? 'Score' : 'Puntuacion',
    PROGRESS: isEnglish ? 'Progress' : 'Progreso',
    LAST_UPDATED: isEnglish ? 'Last Updated' : 'Ultima actualizacion',
    LAST_ADDED: isEnglish ? 'Last Added' : 'Ultimo agregado',
    START_DATE: isEnglish ? 'Start Date' : 'Fecha de inicio',
    COMPLETED_DATE: isEnglish ? 'Completed Date' : 'Fecha de termino',
    RELEASE_DATE: isEnglish ? 'Release Date' : 'Fecha de estreno',
    AVERAGE_SCORE: isEnglish ? 'Average Score' : 'Promedio',
    POPULARITY: isEnglish ? 'Popularity' : 'Popularidad',
  }

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

  const openEditor = (entry) => {
    setSelectedEntry(entry)
    setDraftStatus(entry.status || 'PLANNING')
    setDraftProgress(entryProgressValue(entry, activeMediaType))
    setDraftScore(Number(entry.score || 0))
    setDraftStartedOn(defaultStartedDate(entry))
    setDraftCompletedOn(defaultCompletedDate(entry))
  }

  const handleOpenEntry = (entry, mediaType = activeMediaType) => {
    if (!entry) return
    if (mediaType === 'anime') {
      navigate(animeOnlinePath, { state: buildAnimeNavigationState(entry) })
      return
    }
    navigate(mangaOnlinePath, { state: buildMangaListNavigationState(entry) })
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

  const handleRemoveSelection = async () => {
    if (!selectedEntry) return
    const syncRemote = window.confirm(
      isEnglish ? 'Also remove it from AniList if connected?' : 'Tambien quieres eliminarlo de AniList si esta conectado?',
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
      setSelectedEntry(null)
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

      if (draftProgress !== entryProgressValue(selectedEntry, activeMediaType)) {
        const result = activeMediaType === 'anime'
          ? await wails.updateAnimeListProgress(selectedEntry.anilist_id, draftProgress)
          : await wails.updateMangaListProgress(selectedEntry.anilist_id, draftProgress)
        reportSyncResult(result)
      }

      if (Number(draftScore || 0) !== Number(selectedEntry.score || 0)) {
        const result = activeMediaType === 'anime'
          ? await wails.updateAnimeListScore(selectedEntry.anilist_id, Number(draftScore || 0))
          : await wails.updateMangaListScore(selectedEntry.anilist_id, Number(draftScore || 0))
        reportSyncResult(result)
      }

      toastSuccess(isEnglish ? 'Changes saved.' : 'Cambios guardados.')
      await refreshActive()
      setSelectedEntry(null)
    } catch (error) {
      toastError(error?.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const handleResetSelection = () => {
    if (!selectedEntry) return
    setDraftStatus(selectedEntry.status || 'PLANNING')
    setDraftProgress(entryProgressValue(selectedEntry, activeMediaType))
    setDraftScore(Number(selectedEntry.score || 0))
    setDraftStartedOn(defaultStartedDate(selectedEntry))
    setDraftCompletedOn(defaultCompletedDate(selectedEntry))
  }

  const editorOverlay = selectedEntry ? createPortal(
    <div className="gui2-mylist-editor-backdrop" onClick={() => setSelectedEntry(null)}>
      <aside className="gui2-mylist-editor-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="gui2-mylist-editor-image-backdrop">
          {selectedEntry.cover_image ? <img src={proxyImage(selectedEntry.cover_image)} alt="" className="gui2-mylist-editor-image-backdrop-media" /> : null}
        </div>
        <div className="gui2-mylist-editor-hero">
          {selectedEntry.cover_image ? (
            <img src={proxyImage(selectedEntry.cover_image)} alt={entryTitle(selectedEntry)} className="gui2-mylist-editor-image" />
          ) : (
            <div className="gui2-mylist-editor-image gui2-mylist-editor-image-fallback">{entryTitle(selectedEntry).slice(0, 1)}</div>
          )}
          <button type="button" className="gui2-mylist-editor-close" onClick={() => setSelectedEntry(null)} aria-label="Close">X</button>
        </div>
        <div className="gui2-mylist-editor-header">
          <h2 className="gui2-mylist-editor-title">{entryTitle(selectedEntry)}</h2>
          <div className="gui2-mylist-editor-meta">{entryMeta(selectedEntry, activeMediaType)}</div>
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
          <label className="gui2-mylist-field">
            <span>{isEnglish ? 'Progress' : 'Progreso'}</span>
            <input
              type="number"
              className="gui2-mylist-editor-input"
              value={draftProgress}
              min="0"
              max={entryCount(selectedEntry, activeMediaType) || 9999}
              onChange={(event) => setDraftProgress(Math.max(0, Number(event.target.value || 0)))}
            />
          </label>
          <label className="gui2-mylist-field">
            <span>{isEnglish ? 'Score' : 'Puntuacion'}</span>
            <input
              type="number"
              className="gui2-mylist-editor-input"
              value={draftScore}
              min="0"
              max="10"
              step="0.5"
              onChange={(event) => setDraftScore(Number(event.target.value || 0))}
            />
          </label>
          <label className="gui2-mylist-field">
            <span>{isEnglish ? 'Started On' : 'Empezado el'}</span>
            <input type="date" className="gui2-mylist-editor-input" value={draftStartedOn} onChange={(event) => setDraftStartedOn(event.target.value)} />
          </label>
          <label className="gui2-mylist-field">
            <span>{isEnglish ? 'Completed On' : 'Completado el'}</span>
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
      </aside>
    </div>,
    document.body,
  ) : null

  return (
    <div className="gui2-mylist-page gui2-mylist-page-premium">
      <section className="gui2-mylist-switchline gui2-lists-hero gui2-lists-hero-premium gui2-motion-enter" role="tablist" aria-label={isEnglish ? 'Media type' : 'Tipo de medio'}>
        {MEDIA_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`gui2-mylist-media-tab${activeMediaType === tab ? ' active' : ''}`}
            onClick={() => {
              setActiveMediaType(tab)
              setSelectedEntry(null)
              setShowAddPanel(false)
              setShowActions(false)
            }}
          >
            {tab === 'anime' ? 'Anime' : 'Manga'}
          </button>
        ))}
      </section>

      <section className="gui2-mylist-toolbar gui2-lists-shell-premium gui2-motion-enter">
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
            <span className="gui2-mylist-search-icon">⌕</span>
            <input
              type="text"
              className="gui2-mylist-search-input"
              placeholder={isEnglish ? 'Search your lists...' : 'Buscar en tus listas...'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="gui2-mylist-sort-wrap">
            <button type="button" className="gui2-mylist-sort-trigger" onClick={() => setSortMenuOpen((value) => !value)}>
              {sortLabels[sortBy]}
            </button>
            {sortMenuOpen ? (
              <div className="gui2-mylist-sort-menu">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`gui2-mylist-sort-item${sortBy === option ? ' active' : ''}`}
                    onClick={() => {
                      setSortBy(option)
                      setSortMenuOpen(false)
                    }}
                  >
                    {sortLabels[option]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="gui2-mylist-actions-menu-wrap">
            <button type="button" className="gui2-mylist-actions-toggle" onClick={() => setShowActions((value) => !value)} aria-label={isEnglish ? 'List actions' : 'Acciones de lista'}>
              <span />
              <span />
              <span />
            </button>
            {showActions ? (
              <div className="gui2-mylist-actions-menu">
                {activeMediaType === 'anime' ? (
                  <button type="button" className="gui2-mylist-actions-item" onClick={() => { setShowAddPanel((value) => !value); setShowActions(false) }}>
                    {showAddPanel ? (isEnglish ? 'Hide Add Anime' : 'Ocultar agregar anime') : (isEnglish ? 'Add Anime' : 'Agregar anime')}
                  </button>
                ) : null}
                <button type="button" className="gui2-mylist-actions-item" onClick={() => { handleSyncAniList(); setShowActions(false) }}>
                  {isEnglish ? 'Sync AniList' : 'Sincronizar AniList'}
                </button>
                <button type="button" className="gui2-mylist-actions-item" onClick={() => { handleRetrySync(); setShowActions(false) }} disabled={pendingSyncCount === 0 && failedSyncCount === 0}>
                  {isEnglish ? 'Retry Queue' : 'Reintentar cola'}
                </button>
                <button type="button" className="gui2-mylist-actions-item danger" onClick={() => { handleClearList(); setShowActions(false) }}>
                  {activeMediaType === 'anime' ? (isEnglish ? 'Clear Anime List' : 'Borrar anime') : (isEnglish ? 'Clear Manga List' : 'Borrar manga')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {showAddPanel && activeMediaType === 'anime' ? (
        <section className="gui2-mylist-add-panel gui2-lists-shell-premium">
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
            {addResults.length ? addResults.slice(0, 8).map((item) => {
              const title = item.title?.english || item.title?.romaji || item.title?.native || 'Anime'
              return (
                <article key={item.id} className="gui2-mylist-add-result">
                  {item.coverImage?.large ? (
                    <img src={proxyImage(item.coverImage.large)} alt={title} className="gui2-mylist-add-result-image" />
                  ) : (
                    <div className="gui2-mylist-add-result-image gui2-mylist-add-result-image-fallback">{title.slice(0, 1)}</div>
                  )}
                  <div className="gui2-mylist-add-result-copy">
                    <div className="gui2-mylist-add-result-title">{title}</div>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={() => handleAddAnime(item)}>
                    + {getLabels(lang, 'anime')[addStatus]}
                  </button>
                </article>
              )
            }) : (
              <div className="gui2-inline-empty">
                {searching
                  ? (isEnglish ? 'Searching AniList...' : 'Buscando en AniList...')
                  : (isEnglish ? 'Search for a title to add it directly into your list.' : 'Busca un titulo para agregarlo directamente a tu lista.')}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="gui2-mylist-metrics gui2-motion-enter">
        {metricItems.map((metric) => (
          <MyListMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </section>

      <div className="gui2-mylist-grid-shell gui2-lists-shelf gui2-motion-enter">
        {loading ? (
          <div className="gui2-inline-empty">{isEnglish ? 'Loading your lists...' : 'Cargando tus listas...'}</div>
        ) : filteredEntries.length ? (
          <MyListCollection
            groupedEntries={groupedEntries}
            statusFilter={statusFilter}
            labels={labels}
            activeMediaType={activeMediaType}
            onOpen={handleOpenEntry}
            onEdit={openEditor}
          />
        ) : (
          <div className="gui2-inline-empty">{isEnglish ? 'No entries match the current filters.' : 'No hay elementos para los filtros actuales.'}</div>
        )}
      </div>

      {(pendingSyncCount > 0 || failedSyncCount > 0) ? (
        <div className="gui2-inline-status">
          {isEnglish
            ? `Remote sync queue: ${pendingSyncCount} pending / ${failedSyncCount} failed.`
            : `Cola remota: ${pendingSyncCount} pendientes / ${failedSyncCount} fallidos.`}
        </div>
      ) : null}

      {editorOverlay}
    </div>
  )
}
