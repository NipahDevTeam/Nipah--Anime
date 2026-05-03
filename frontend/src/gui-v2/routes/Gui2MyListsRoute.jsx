import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toastError, toastSuccess } from '../../components/ui/Toast'
import { useI18n } from '../../lib/i18n'
import { extractAniListAnimeSearchMedia } from '../../lib/anilistSearch'
import { buildAnimeNavigationState, buildMangaListNavigationState } from '../../lib/mediaNavigation'
import { proxyImage, wails } from '../../lib/wails'
import { withGui2Prefix } from '../routeRegistry'

const EDITOR_META_PREFIX = 'nipah-my-lists-meta'
const MEDIA_TABS = ['anime', 'manga']
const STATUS_ORDER = ['ALL', 'WATCHING', 'COMPLETED', 'PLANNING', 'DROPPED', 'ON_HOLD']
const PAGE_SIZE_OPTIONS = [25, 50, 100]

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
  if (mediaType === 'anime') {
    const format = entry?.media_format || 'TV'
    const subtitle = entry?.title ? entry.title : ''
    return [format, subtitle].filter(Boolean).join(' • ')
  }

  const format = entry?.media_format || 'Manga'
  const subtitle = entry?.title ? entry.title : ''
  return [format, subtitle].filter(Boolean).join(' • ')
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

function buildEditorStorageKey(mediaType, anilistID) {
  return `${EDITOR_META_PREFIX}:${mediaType}:${Number(anilistID || 0)}`
}

function formatDateInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function readEditorMeta(mediaType, entry) {
  if (typeof localStorage === 'undefined' || !entry?.anilist_id) {
    return {
      startedOn: formatDateInput(entry?.updated_at || entry?.added_at || ''),
      notes: '',
      tags: [],
    }
  }

  try {
    const raw = localStorage.getItem(buildEditorStorageKey(mediaType, entry.anilist_id))
    if (!raw) {
      return {
        startedOn: formatDateInput(entry?.updated_at || entry?.added_at || ''),
        notes: '',
        tags: [],
      }
    }

    const parsed = JSON.parse(raw)
    return {
      startedOn: typeof parsed.startedOn === 'string' ? parsed.startedOn : formatDateInput(entry?.updated_at || entry?.added_at || ''),
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((item) => String(item)).filter(Boolean) : [],
    }
  } catch {
    return {
      startedOn: formatDateInput(entry?.updated_at || entry?.added_at || ''),
      notes: '',
      tags: [],
    }
  }
}

function writeEditorMeta(mediaType, anilistID, payload) {
  if (typeof localStorage === 'undefined' || !anilistID) return
  localStorage.setItem(buildEditorStorageKey(mediaType, anilistID), JSON.stringify(payload))
}

function normalizeTagInput(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function clampNumber(value, min, max) {
  const numeric = Number(value || 0)
  if (Number.isNaN(numeric)) return min
  return Math.max(min, Math.min(max, numeric))
}

function MyListMetric({ label, value }) {
  return (
    <article className="gui2-mylist-metric">
      <span className="gui2-mylist-metric-label">{label}</span>
      <strong className="gui2-mylist-metric-value">{value}</strong>
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
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [selectedKey, setSelectedKey] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addStatus, setAddStatus] = useState('PLANNING')
  const [addResults, setAddResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [draftStatus, setDraftStatus] = useState('WATCHING')
  const [draftProgress, setDraftProgress] = useState(0)
  const [draftScore, setDraftScore] = useState(0)
  const [draftStartedOn, setDraftStartedOn] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [draftTags, setDraftTags] = useState([])
  const [tagInput, setTagInput] = useState('')
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
  const animeCount = Object.values(animeCounts).reduce((sum, value) => sum + Number(value || 0), 0)
  const mangaCount = Object.values(mangaCounts).reduce((sum, value) => sum + Number(value || 0), 0)
  const pendingSyncCount = Number(syncStatus?.pending_count || 0)
  const failedSyncCount = Number(syncStatus?.failed_count || 0)

  const filteredEntries = useMemo(() => {
    const term = String(deferredQuery || '').trim().toLowerCase()
    return activeEntries
      .filter((entry) => {
        if (statusFilter !== 'ALL' && entry.status !== statusFilter) return false
        if (!term) return true
        return [
          entry.title,
          entry.title_english,
          entry.status,
          entry.year,
        ].filter(Boolean).join(' ').toLowerCase().includes(term)
      })
      .sort((a, b) => {
        const aTime = new Date(a.updated_at || a.added_at || 0).getTime()
        const bTime = new Date(b.updated_at || b.added_at || 0).getTime()
        return bTime - aTime
      })
  }, [activeEntries, deferredQuery, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredEntries.slice(start, start + pageSize)
  }, [filteredEntries, pageSize, safePage])

  useEffect(() => {
    setPage(1)
  }, [activeMediaType, deferredQuery, statusFilter, pageSize])

  useEffect(() => {
    if (!pageEntries.length) {
      setSelectedKey('')
      return
    }
    if (!pageEntries.some((entry) => `${activeMediaType}-${entry.anilist_id}` === selectedKey)) {
      setSelectedKey(`${activeMediaType}-${pageEntries[0].anilist_id}`)
    }
  }, [activeMediaType, pageEntries, selectedKey])

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
    setDraftNotes(stored.notes || '')
    setDraftTags(stored.tags || [])
    setTagInput('')
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
      navigate(animeOnlinePath, {
        state: buildAnimeNavigationState(entry),
      })
      return
    }

    navigate(mangaOnlinePath, {
      state: buildMangaListNavigationState(entry),
    })
  }

  const handleOpenSelected = () => {
    if (!selectedEntry) return
    handleOpenEntry(selectedEntry, activeMediaType)
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
      writeEditorMeta(activeMediaType, selectedEntry.anilist_id, { startedOn: '', notes: '', tags: [] })
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
        notes: draftNotes,
        tags: draftTags,
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
    setDraftNotes(stored.notes || '')
    setDraftTags(stored.tags || [])
    setTagInput('')
  }

  const handleAddTags = () => {
    if (!tagInput.trim()) return
    const nextTags = [...new Set([...draftTags, ...normalizeTagInput(tagInput)])]
    setDraftTags(nextTags)
    setTagInput('')
  }

  const metricItems = [
    { label: isEnglish ? 'Total Entries' : 'Entradas totales', value: activeTotal },
    { label: labels.WATCHING, value: Number(activeCounts.WATCHING || 0) },
    { label: labels.COMPLETED, value: Number(activeCounts.COMPLETED || 0) },
    { label: labels.PLANNING, value: Number(activeCounts.PLANNING || 0) },
    { label: labels.ON_HOLD, value: Number(activeCounts.ON_HOLD || 0) },
    { label: labels.DROPPED, value: Number(activeCounts.DROPPED || 0) },
  ]

  const showFrom = filteredEntries.length === 0 ? 0 : ((safePage - 1) * pageSize) + 1
  const showTo = Math.min(filteredEntries.length, safePage * pageSize)
  const pageChips = [
    safePage > 1 ? safePage - 1 : null,
    safePage,
    safePage < totalPages ? safePage + 1 : null,
  ].filter((item, index, array) => Number.isFinite(item) && array.indexOf(item) === index)

  return (
    <div className="gui2-mylist-page">
      <header className="gui2-mylist-header">
        <div className="gui2-mylist-header-copy">
          <h1 className="gui2-mylist-title">{isEnglish ? 'My Lists' : 'Mis listas'}</h1>
          <p className="gui2-mylist-subtitle">
            {isEnglish
              ? 'Track, organize, and manage all your anime and manga in one place.'
              : 'Organiza y administra todo tu anime y manga en un solo lugar.'}
          </p>
        </div>

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
              }}
            >
              {tab === 'anime' ? 'Anime' : 'Manga'}
            </button>
          ))}
        </div>
      </header>

      <section className="gui2-mylist-toolbar">
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

      <section className="gui2-mylist-metrics">
        {metricItems.map((metric) => (
          <MyListMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </section>

      <div className="gui2-mylist-shell">
        <section className="gui2-mylist-table-wrap">
          <div className="gui2-mylist-table-head">
            <span>{isEnglish ? 'Title' : 'Titulo'}</span>
            <span>{isEnglish ? 'Status' : 'Estado'}</span>
            <span>{isEnglish ? 'Progress' : 'Progreso'}</span>
            <span>{isEnglish ? 'Score' : 'Puntuacion'}</span>
            <span>{isEnglish ? 'Year' : 'Ano'}</span>
            <span>{isEnglish ? 'More' : 'Mas'}</span>
          </div>

          <div className="gui2-mylist-table">
            {loading ? (
              <div className="gui2-inline-empty">{isEnglish ? 'Loading your lists...' : 'Cargando tus listas...'}</div>
            ) : pageEntries.length ? pageEntries.map((entry) => (
              <button
                key={`${activeMediaType}-${entry.anilist_id}`}
                type="button"
                className={`gui2-mylist-row${selectedEntry?.anilist_id === entry.anilist_id ? ' active' : ''}`}
                onClick={() => setSelectedKey(`${activeMediaType}-${entry.anilist_id}`)}
                onDoubleClick={() => handleOpenEntry(entry, activeMediaType)}
              >
                <span className="gui2-mylist-row-title">
                  {entry.cover_image ? (
                    <img src={proxyImage(entry.cover_image)} alt="" className="gui2-mylist-row-cover" />
                  ) : (
                    <span className="gui2-mylist-row-cover gui2-mylist-row-cover-fallback">{entryTitle(entry).slice(0, 1)}</span>
                  )}
                  <span className="gui2-mylist-row-copy">
                    <strong>{entryTitle(entry)}</strong>
                    <small>{entryStudioOrFormat(entry, activeMediaType)}</small>
                  </span>
                </span>
                <span className="gui2-mylist-row-status" style={{ color: STATUS_ACCENTS[entry.status] || 'var(--gui2-text)' }}>
                  {labels[entry.status] || entry.status}
                </span>
                <span className="gui2-mylist-row-progress">
                  <span className="gui2-mylist-row-progress-label">{progressLabel(entry, activeMediaType)}</span>
                  <span className="gui2-mylist-row-progressbar">
                    <span className="gui2-mylist-row-progressfill" style={{ width: `${progressPercent(entry, activeMediaType)}%`, backgroundColor: STATUS_ACCENTS[entry.status] || '#f0b14d' }} />
                  </span>
                </span>
                <span className="gui2-mylist-row-score">
                  {Number(entry.score || 0) > 0 ? `${Number(entry.score).toFixed(1)}` : '-'}
                  <span className="gui2-mylist-row-star">★</span>
                </span>
                <span className="gui2-mylist-row-year">{entry.year || '-'}</span>
                <span className="gui2-mylist-row-more">⋮</span>
              </button>
            )) : (
              <div className="gui2-inline-empty">{isEnglish ? 'No entries match the current filters.' : 'No hay elementos para los filtros actuales.'}</div>
            )}
          </div>

          <div className="gui2-mylist-table-footer">
            <div className="gui2-mylist-table-summary">
              {isEnglish
                ? `Showing ${showFrom}-${showTo} of ${filteredEntries.length} entries`
                : `Mostrando ${showFrom}-${showTo} de ${filteredEntries.length} entradas`}
            </div>
            <div className="gui2-mylist-footer-actions">
              <div className="gui2-mylist-pagination">
                <button type="button" className="gui2-mylist-page-btn" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  ‹
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
                  ›
                </button>
              </div>
              <label className="gui2-mylist-rows">
                <span>{isEnglish ? 'Rows per page:' : 'Filas por pagina:'}</span>
                <select className="gui2-mylist-inline-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) || 25)}>
                  {PAGE_SIZE_OPTIONS.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        <aside className="gui2-mylist-editor">
          {selectedEntry ? (
            <>
              <div className="gui2-mylist-editor-visual">
                {selectedEntry.cover_image ? (
                  <img src={proxyImage(selectedEntry.cover_image)} alt={entryTitle(selectedEntry)} className="gui2-mylist-editor-image" />
                ) : (
                  <div className="gui2-mylist-editor-image gui2-mylist-editor-image-fallback">{entryTitle(selectedEntry).slice(0, 1)}</div>
                )}
                <button type="button" className="gui2-mylist-editor-close" onClick={() => setSelectedKey('')} aria-label={isEnglish ? 'Clear selection' : 'Quitar seleccion'}>
                  ×
                </button>
              </div>

              <div className="gui2-mylist-editor-header">
                <h2 className="gui2-mylist-editor-title">{entryTitle(selectedEntry)}</h2>
                <div className="gui2-mylist-editor-meta">
                  {[selectedEntry.year, entryCount(selectedEntry, activeMediaType) ? `${entryCount(selectedEntry, activeMediaType)} ${activeMediaType === 'anime' ? (isEnglish ? 'Episodes' : 'Episodios') : (isEnglish ? 'Chapters' : 'Capitulos')}` : '', entryStudioOrFormat(selectedEntry, activeMediaType).split(' • ')[0]].filter(Boolean).join('   |   ')}
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
                    <button type="button" className="gui2-mylist-stepper-btn" onClick={() => setDraftProgress((value) => clampNumber(value - 1, 0, entryCount(selectedEntry, activeMediaType) || 9999))}>−</button>
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
                    <span className="gui2-mylist-score-star">★</span>
                  </div>
                </div>

                <label className="gui2-mylist-field">
                  <span>{isEnglish ? 'Started On' : 'Empezado el'}</span>
                  <input type="date" className="gui2-mylist-editor-input" value={draftStartedOn} onChange={(event) => setDraftStartedOn(event.target.value)} />
                </label>

                <label className="gui2-mylist-field">
                  <span>{isEnglish ? 'Notes' : 'Notas'}</span>
                  <textarea
                    className="gui2-mylist-editor-notes"
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    placeholder={isEnglish ? 'Add a note for this entry.' : 'Agrega una nota para esta entrada.'}
                  />
                </label>

                <div className="gui2-mylist-field">
                  <span>{isEnglish ? 'Tags' : 'Etiquetas'}</span>
                  <div className="gui2-mylist-tags-row">
                    {draftTags.length ? draftTags.map((tag) => (
                      <button key={tag} type="button" className="gui2-mylist-tag" onClick={() => setDraftTags((current) => current.filter((item) => item !== tag))}>
                        {tag} <span aria-hidden="true">×</span>
                      </button>
                    )) : (
                      <span className="gui2-mylist-tag-empty">{isEnglish ? '+ Add tags' : '+ Agregar etiquetas'}</span>
                    )}
                  </div>
                  <div className="gui2-mylist-tag-inputrow">
                    <input
                      type="text"
                      className="gui2-mylist-editor-input"
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      placeholder={isEnglish ? 'Type a tag and press add' : 'Escribe una etiqueta y agrégala'}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleAddTags()
                        }
                      }}
                    />
                    <button type="button" className="btn btn-ghost" onClick={handleAddTags}>
                      {isEnglish ? 'Add' : 'Agregar'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="gui2-mylist-editor-footer">
                <button type="button" className="btn btn-primary" onClick={handleSaveSelection} disabled={saving}>
                  {saving ? (isEnglish ? 'Saving...' : 'Guardando...') : (isEnglish ? 'Save Changes' : 'Guardar cambios')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleOpenSelected}>
                  {activeMediaType === 'anime'
                    ? (isEnglish ? 'Open in Anime Online' : 'Abrir en Anime Online')
                    : (isEnglish ? 'Open in Manga Online' : 'Abrir en Manga Online')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleResetSelection}>
                  {isEnglish ? 'Reset' : 'Restablecer'}
                </button>
                <button type="button" className="btn btn-ghost gui2-mylist-remove-btn" onClick={handleRemoveSelection}>
                  {isEnglish ? 'Remove' : 'Eliminar'}
                </button>
              </div>
            </>
          ) : (
            <div className="gui2-inline-empty">
              {isEnglish ? 'Select a title from the list to edit it here.' : 'Selecciona un titulo de la lista para editarlo aqui.'}
            </div>
          )}
        </aside>
      </div>

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
