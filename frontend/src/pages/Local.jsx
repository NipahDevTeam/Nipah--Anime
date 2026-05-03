import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toastError, toastSuccess } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'
import { proxyImage, wails } from '../lib/wails'
import {
  buildGui2LocalActivity,
  buildGui2LocalCatalog,
  buildGui2LocalOverview,
  formatGui2LocalStorage,
} from '../gui-v2/routes/local/localData'

const LOCAL_TABS = ['all', 'anime', 'manga', 'downloads']
const LOCAL_STATUS_FILTERS = ['all', 'active', 'completed']

function stripHTML(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatDateTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function buildCommonPath(paths = []) {
  const cleaned = paths.filter(Boolean).map((path) => String(path).replace(/\\/g, '/'))
  if (!cleaned.length) return ''
  const parts = cleaned.map((path) => path.split('/'))
  const shared = []
  const shortest = Math.min(...parts.map((path) => path.length))

  for (let index = 0; index < shortest; index += 1) {
    const candidate = parts[0][index]
    if (parts.every((path) => path[index] === candidate)) {
      shared.push(candidate)
    } else {
      break
    }
  }

  return shared.join('/')
}

function getAnimeSelectionState(detail) {
  const episodes = detail?.episodes ?? []
  const watchedCount = episodes.filter((episode) => episode.watched).length
  const resumeEpisode = episodes.find((episode) => episode.progress_s > 0 && !episode.watched) ?? null
  const nextEpisode = resumeEpisode ?? episodes.find((episode) => !episode.watched) ?? episodes[0] ?? null
  const sourcePath = buildCommonPath(episodes.map((episode) => episode.file_path))
  return { episodes, watchedCount, resumeEpisode, nextEpisode, sourcePath }
}

function getMangaSelectionState(detail) {
  const chapters = detail?.chapters ?? []
  const readCount = chapters.filter((chapter) => chapter.read).length
  const resumeChapter = chapters.find((chapter) => chapter.progress_page > 0 && !chapter.read) ?? null
  const nextChapter = resumeChapter ?? chapters.find((chapter) => !chapter.read) ?? chapters[0] ?? null
  const sourcePath = buildCommonPath(chapters.map((chapter) => chapter.file_path))
  return { chapters, readCount, resumeChapter, nextChapter, sourcePath }
}

function formatMediaStatus(status, isEnglish) {
  const mediaMap = isEnglish
    ? { FINISHED: 'Completed', RELEASING: 'Airing', NOT_YET_RELEASED: 'Upcoming', HIATUS: 'Hiatus', CANCELLED: 'Cancelled', ONGOING: 'Ongoing' }
    : { FINISHED: 'Completado', RELEASING: 'En emision', NOT_YET_RELEASED: 'Proximo', HIATUS: 'En pausa', CANCELLED: 'Cancelado', ONGOING: 'En curso' }

  const downloadMap = isEnglish
    ? { pending: 'Pending', downloading: 'Downloading', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled' }
    : { pending: 'Pendiente', downloading: 'Descargando', completed: 'Listo', failed: 'Fallido', cancelled: 'Cancelado' }

  return mediaMap[String(status || '').toUpperCase()] || downloadMap[String(status || '').toLowerCase()] || status || '-'
}

function LocalStatCard({ label, value, meta }) {
  return (
    <article className="gui2-localv2-stat">
      <span className="gui2-localv2-stat-label">{label}</span>
      <strong className="gui2-localv2-stat-value">{value}</strong>
      {meta ? <span className="gui2-localv2-stat-meta">{meta}</span> : null}
    </article>
  )
}

function LocalMediaCard({ item, selected, onSelect }) {
  return (
    <button type="button" className={`gui2-localv2-card${selected ? ' is-selected' : ''}`} onClick={() => onSelect(item.selectionKey)}>
      <div className="gui2-localv2-card-cover-wrap">
        {item.cover ? (
          <img src={proxyImage(item.cover)} alt={item.title} className="gui2-localv2-card-cover" />
        ) : (
          <div className="gui2-localv2-card-cover gui2-localv2-card-cover-fallback">{item.title.slice(0, 1)}</div>
        )}
      </div>
      <div className="gui2-localv2-card-body">
        <div className="gui2-localv2-card-title">{item.title}</div>
        <div className="gui2-localv2-card-subtitle">{item.metaLine}</div>
        <div className="gui2-localv2-card-footer">
          <span>{item.typeLabel}</span>
          <span>{item.countLabel}</span>
        </div>
      </div>
    </button>
  )
}

function LocalMediaRow({ item, selected, onSelect }) {
  return (
    <button type="button" className={`gui2-localv2-row${selected ? ' is-selected' : ''}`} onClick={() => onSelect(item.selectionKey)}>
      <div className="gui2-localv2-row-leading">
        {item.cover ? (
          <img src={proxyImage(item.cover)} alt={item.title} className="gui2-localv2-row-cover" />
        ) : (
          <div className="gui2-localv2-row-cover gui2-localv2-row-cover-fallback">{item.title.slice(0, 1)}</div>
        )}
        <div className="gui2-localv2-row-copy">
          <strong>{item.title}</strong>
          <span>{item.subtitle || item.metaLine}</span>
        </div>
      </div>
      <span>{item.typeLabel}</span>
      <span>{item.countLabel}</span>
      <span>{item.statusLabel}</span>
      <span>{item.year || '--'}</span>
    </button>
  )
}

function LocalActivityItem({ item, onSelect }) {
  const interactive = Boolean(item.selectionKey)
  const content = (
    <>
      <div className="gui2-localv2-activity-kind">{item.kind}</div>
      <div className="gui2-localv2-activity-title">{item.title}</div>
      <div className="gui2-localv2-activity-copy">{item.copy}</div>
      <div className="gui2-localv2-activity-meta">{item.meta}</div>
    </>
  )

  if (!interactive) {
    return <article className="gui2-localv2-activity-item">{content}</article>
  }

  return (
    <button type="button" className="gui2-localv2-activity-item gui2-localv2-activity-button" onClick={() => onSelect(item.selectionKey)}>
      {content}
    </button>
  )
}

function LocalPanelRows({ title, rows }) {
  if (!rows.length) return null
  return (
    <section className="gui2-localv2-panel-section">
      <div className="gui2-localv2-panel-title">{title}</div>
      <div className="gui2-localv2-fact-list">
        {rows.map((row) => (
          <div key={row.label} className="gui2-localv2-fact-row">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function LocalSelectionPanel({
  selectedItem,
  selectedDetail,
  selectedMeta,
  detailLoading,
  activeTab,
  isEnglish,
  onPrimaryAction,
  onOpenDetails,
  onSecondaryAction,
  onDangerAction,
  dangerLabel,
}) {
  if (!selectedItem) {
    return (
      <section className="gui2-localv2-panel gui2-localv2-panel-empty">
        <div className="gui2-inline-empty">{isEnglish ? 'Select something from the library to inspect it here.' : 'Selecciona algo de la biblioteca para verlo aqui.'}</div>
      </section>
    )
  }

  if (activeTab === 'downloads') {
    const isReady = String(selectedItem.status || '').toLowerCase() === 'completed'
    const isActive = String(selectedItem.status || '').toLowerCase() === 'downloading' || String(selectedItem.status || '').toLowerCase() === 'pending'
    return (
      <section className="gui2-localv2-panel">
        <div className="gui2-localv2-panel-hero">
          {selectedItem.cover ? (
            <img src={proxyImage(selectedItem.cover)} alt={selectedItem.title} className="gui2-localv2-panel-cover" />
          ) : (
            <div className="gui2-localv2-panel-cover gui2-localv2-panel-cover-fallback">D</div>
          )}
          <div className="gui2-localv2-panel-copy">
            <div className="gui2-localv2-panel-heading">{selectedItem.title}</div>
            <div className="gui2-localv2-panel-subheading">{selectedItem.subtitle}</div>
            <div className="gui2-localv2-panel-meta-line">{selectedItem.metaLine}</div>
          </div>
        </div>
        <div className="gui2-localv2-panel-actions">
          <button type="button" className="btn btn-primary" onClick={onPrimaryAction}>
            {isReady ? (isEnglish ? 'Play Episode' : 'Ver episodio') : isActive ? (isEnglish ? 'Cancel Transfer' : 'Cancelar transferencia') : (isEnglish ? 'Open Queue' : 'Abrir cola')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDangerAction}>{isEnglish ? 'Remove' : 'Eliminar'}</button>
        </div>
      </section>
    )
  }

  const title = selectedItem.title
  const subtitle = selectedItem.subtitle || (selectedMeta?.title_romaji && selectedMeta.title_romaji !== selectedItem.title ? selectedMeta.title_romaji : '')
  const synopsis = stripHTML(selectedDetail?.synopsis_es || selectedDetail?.synopsis || selectedMeta?.description || '')
  const banner = selectedMeta?.banner_image || selectedItem.banner || ''

  const animeState = selectedItem.kind === 'anime' ? getAnimeSelectionState(selectedDetail) : null
  const mangaState = selectedItem.kind === 'manga' ? getMangaSelectionState(selectedDetail) : null
  const itemCount = selectedItem.kind === 'anime'
    ? (selectedDetail?.episodes_total || selectedItem.count)
    : (selectedDetail?.chapters_total || selectedItem.count)
  const progressCount = selectedItem.kind === 'anime'
    ? animeState?.watchedCount || 0
    : mangaState?.readCount || 0
  const progressLabel = selectedItem.kind === 'anime'
    ? `${progressCount}/${itemCount} ${isEnglish ? 'watched' : 'vistos'}`
    : `${progressCount}/${itemCount} ${isEnglish ? 'read' : 'leidos'}`
  const infoRows = selectedItem.kind === 'anime'
    ? [
        { label: isEnglish ? 'Episodes' : 'Episodios', value: String(itemCount || 0) },
        { label: isEnglish ? 'Progress' : 'Progreso', value: progressLabel },
        animeState?.nextEpisode ? { label: isEnglish ? 'Next up' : 'Siguiente', value: `${isEnglish ? 'Episode' : 'Episodio'} ${animeState.nextEpisode.episode_num ?? '?'}` } : null,
        selectedItem.year ? { label: isEnglish ? 'Year' : 'Ano', value: String(selectedItem.year) } : null,
      ].filter(Boolean)
    : [
        { label: isEnglish ? 'Chapters' : 'Capitulos', value: String(itemCount || 0) },
        { label: isEnglish ? 'Progress' : 'Progreso', value: progressLabel },
        mangaState?.nextChapter ? { label: isEnglish ? 'Next up' : 'Siguiente', value: `${isEnglish ? 'Chapter' : 'Capitulo'} ${mangaState.nextChapter.chapter_num ?? '?'}` } : null,
        selectedItem.year ? { label: isEnglish ? 'Year' : 'Ano', value: String(selectedItem.year) } : null,
      ].filter(Boolean)
  const fileRows = selectedItem.kind === 'anime'
    ? [
        animeState?.sourcePath ? { label: isEnglish ? 'Folder path' : 'Ruta', value: animeState.sourcePath } : null,
        selectedMeta?.genres?.length ? { label: isEnglish ? 'Genres' : 'Generos', value: selectedMeta.genres.slice(0, 3).join(', ') } : null,
        selectedMeta?.score ? { label: isEnglish ? 'Score' : 'Puntuacion', value: String(selectedMeta.score) } : null,
      ].filter(Boolean)
    : [
        mangaState?.sourcePath ? { label: isEnglish ? 'Folder path' : 'Ruta', value: mangaState.sourcePath } : null,
        selectedMeta?.status ? { label: isEnglish ? 'Status' : 'Estado', value: formatMediaStatus(selectedMeta.status, isEnglish) } : null,
        selectedMeta?.chapters ? { label: isEnglish ? 'Catalog chapters' : 'Capitulos catalogo', value: String(selectedMeta.chapters) } : null,
      ].filter(Boolean)

  return (
    <section className="gui2-localv2-panel">
      <div className="gui2-localv2-panel-hero">
        {selectedItem.cover ? (
          <img src={proxyImage(selectedItem.cover)} alt={title} className="gui2-localv2-panel-cover" />
        ) : (
          <div className="gui2-localv2-panel-cover gui2-localv2-panel-cover-fallback">{title.slice(0, 1)}</div>
        )}
        <div className="gui2-localv2-panel-copy">
          <div className="gui2-localv2-panel-heading">{title}</div>
          {subtitle ? <div className="gui2-localv2-panel-subheading">{subtitle}</div> : null}
          <div className="gui2-localv2-panel-meta-line">{selectedItem.metaLine}</div>
          <div className="gui2-localv2-panel-status">{formatMediaStatus(selectedItem.status, isEnglish)}</div>
        </div>
      </div>

      {banner ? <div className="gui2-localv2-panel-banner" style={{ backgroundImage: `url(${proxyImage(banner)})` }} /> : null}

      <div className="gui2-localv2-panel-actions">
        <button type="button" className="btn btn-primary" onClick={onPrimaryAction}>
          {selectedItem.kind === 'anime'
            ? (animeState?.resumeEpisode ? (isEnglish ? 'Continue Watching' : 'Continuar viendo') : (isEnglish ? 'Start Watching' : 'Empezar a ver'))
            : (mangaState?.resumeChapter ? (isEnglish ? 'Continue Reading' : 'Continuar leyendo') : (isEnglish ? 'Open Details' : 'Abrir detalles'))}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onOpenDetails}>
          {isEnglish ? 'Open Details' : 'Abrir detalles'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onSecondaryAction}>
          {selectedItem.kind === 'anime' ? (isEnglish ? 'Anime Online' : 'Anime Online') : (isEnglish ? 'Manga Online' : 'Manga Online')}
        </button>
        {dangerLabel ? <button type="button" className="btn btn-ghost gui2-localv2-danger" onClick={onDangerAction}>{dangerLabel}</button> : null}
      </div>

      {detailLoading ? (
        <div className="gui2-inline-empty">{isEnglish ? 'Loading item details...' : 'Cargando detalles...'}</div>
      ) : (
        <>
          <LocalPanelRows title={isEnglish ? 'Information' : 'Informacion'} rows={infoRows} />
          <LocalPanelRows title={isEnglish ? 'Files & Source' : 'Archivos y fuente'} rows={fileRows} />
          {synopsis ? (
            <section className="gui2-localv2-panel-section">
              <div className="gui2-localv2-panel-title">{isEnglish ? 'Synopsis' : 'Sinopsis'}</div>
              <p className="gui2-localv2-panel-story">{synopsis}</p>
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}

export default function Local() {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('RECENT')
  const [statusFilter, setStatusFilter] = useState('all')
  const [viewMode, setViewMode] = useState('grid')
  const [scanResult, setScanResult] = useState(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const deferredQuery = useDeferredValue(query)

  const requestedTab = (searchParams.get('tab') || '').toLowerCase()
  const activeTab = LOCAL_TABS.includes(requestedTab) ? requestedTab : 'all'

  const localQuery = useQuery({
    queryKey: ['gui2-local-workspace'],
    queryFn: async () => {
      const [anime, manga, downloads, libraryPaths] = await Promise.all([
        wails.getAnimeList(),
        wails.getMangaList(),
        wails.getDownloads(),
        wails.getLibraryPaths(),
      ])

      return {
        anime: anime ?? [],
        manga: manga ?? [],
        downloads: downloads ?? [],
        libraryPaths: libraryPaths ?? [],
      }
    },
    staleTime: 30_000,
    refetchInterval: 5_000,
  })

  const animeItems = localQuery.data?.anime ?? []
  const mangaItems = localQuery.data?.manga ?? []
  const downloadItems = localQuery.data?.downloads ?? []
  const libraryPaths = localQuery.data?.libraryPaths ?? []
  const now = useMemo(() => new Date(), [localQuery.dataUpdatedAt, scanResult])

  const overview = useMemo(() => buildGui2LocalOverview({
    animeItems,
    mangaItems,
    downloadItems,
    libraryPaths,
    now,
    isEnglish,
  }), [animeItems, mangaItems, downloadItems, libraryPaths, now, isEnglish])

  const baseCatalogItems = useMemo(() => buildGui2LocalCatalog({
    animeItems,
    mangaItems,
    downloadItems,
    activeTab,
    sort,
    query: deferredQuery,
    isEnglish,
  }), [animeItems, mangaItems, downloadItems, activeTab, sort, deferredQuery, isEnglish])

  const catalogItems = useMemo(() => {
    if (statusFilter === 'all' || activeTab === 'downloads') return baseCatalogItems
    return baseCatalogItems.filter((item) => {
      const status = String(item.status || '').toUpperCase()
      if (statusFilter === 'active') {
        return status === 'RELEASING' || status === 'ONGOING'
      }
      return status === 'FINISHED' || status === 'COMPLETED'
    })
  }, [baseCatalogItems, statusFilter, activeTab])

  const activityItems = useMemo(() => buildGui2LocalActivity({
    animeItems,
    mangaItems,
    downloadItems,
    scanResult,
    now,
    isEnglish,
  }), [animeItems, mangaItems, downloadItems, scanResult, now, isEnglish])

  useEffect(() => {
    if (!catalogItems.length) {
      if (selectedKey) setSelectedKey('')
      return
    }

    if (!catalogItems.some((item) => item.selectionKey === selectedKey)) {
      setSelectedKey(catalogItems[0].selectionKey)
    }
  }, [catalogItems, selectedKey])

  const selectedItem = catalogItems.find((item) => item.selectionKey === selectedKey) ?? null

  const selectedDetailQuery = useQuery({
    queryKey: ['gui2-local-selection-detail', selectedItem?.kind, selectedItem?.id],
    enabled: Boolean(selectedItem && selectedItem.kind !== 'download'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: () => selectedItem?.kind === 'anime'
      ? wails.getAnimeDetail(selectedItem.id)
      : wails.getMangaDetail(selectedItem.id),
  })

  const selectedMetaQuery = useQuery({
    queryKey: ['gui2-local-selection-meta', selectedItem?.kind, selectedItem?.anilistID],
    enabled: Boolean(selectedItem && selectedItem.kind !== 'download' && selectedItem.anilistID),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => selectedItem?.kind === 'anime'
      ? wails.getAniListAnimeByID(selectedItem.anilistID)
      : wails.getAniListMangaByID(selectedItem.anilistID),
  })

  const handleScanFolder = useCallback(async () => {
    setBusyAction('scan')
    try {
      const result = await wails.scanWithPicker()
      if (!result?.cancelled) {
        setScanResult(result)
        await localQuery.refetch()
        toastSuccess(isEnglish ? 'Library scan completed.' : 'Escaneo completado.')
      }
    } catch (error) {
      toastError(isEnglish ? `Scan error: ${error?.message ?? 'unknown error'}` : `Error al escanear: ${error?.message ?? 'error desconocido'}`)
    } finally {
      setBusyAction('')
    }
  }, [isEnglish, localQuery])

  const handleAddFolder = useCallback(async () => {
    setBusyAction('add-folder')
    try {
      const path = await wails.pickFolder()
      if (!path) return
      const result = await wails.scanLibrary(path)
      setScanResult({ ...(result ?? {}), scanned_path: path })
      await localQuery.refetch()
      toastSuccess(isEnglish ? 'Folder added to the local library.' : 'Carpeta agregada a la biblioteca local.')
    } catch (error) {
      toastError(isEnglish ? `Could not add the folder: ${error?.message ?? 'unknown error'}` : `No se pudo agregar la carpeta: ${error?.message ?? 'error desconocido'}`)
    } finally {
      setBusyAction('')
    }
  }, [isEnglish, localQuery])

  const handlePlayDownload = useCallback(async (id) => {
    try {
      await wails.playDownloadedEpisode(id)
      toastSuccess(isEnglish ? 'Opening in MPV...' : 'Abriendo en MPV...')
    } catch (error) {
      toastError(error?.message ?? (isEnglish ? 'Unknown error' : 'Error desconocido'))
    }
  }, [isEnglish])

  const handleCancelDownload = useCallback(async (id) => {
    try {
      await wails.cancelDownload(id)
      await localQuery.refetch()
    } catch (error) {
      toastError(error?.message ?? (isEnglish ? 'Unknown error' : 'Error desconocido'))
    }
  }, [isEnglish, localQuery])

  const handleRemoveDownload = useCallback(async (id) => {
    try {
      await wails.removeDownload(id, false)
      await localQuery.refetch()
    } catch (error) {
      toastError(error?.message ?? (isEnglish ? 'Unknown error' : 'Error desconocido'))
    }
  }, [isEnglish, localQuery])

  const handlePrimaryAction = useCallback(async () => {
    if (!selectedItem) return

    if (selectedItem.kind === 'download') {
      if (String(selectedItem.status || '').toLowerCase() === 'completed') {
        await handlePlayDownload(selectedItem.id)
      } else if (String(selectedItem.status || '').toLowerCase() === 'downloading' || String(selectedItem.status || '').toLowerCase() === 'pending') {
        await handleCancelDownload(selectedItem.id)
      } else {
        navigate('/local?tab=downloads')
      }
      return
    }

    if (selectedItem.kind === 'anime') {
      const detail = selectedDetailQuery.data
      const { nextEpisode } = getAnimeSelectionState(detail)
      if (!nextEpisode) return
      try {
        await wails.playEpisode(nextEpisode.id)
        toastSuccess(isEnglish ? 'Opening in MPV...' : 'Abriendo en MPV...')
      } catch (error) {
        toastError(error?.message ?? (isEnglish ? 'Could not start playback.' : 'No se pudo iniciar la reproduccion.'))
      }
      return
    }

    navigate(`/manga/${selectedItem.id}`)
  }, [handleCancelDownload, handlePlayDownload, isEnglish, navigate, selectedDetailQuery.data, selectedItem])

  const handleOpenDetails = useCallback(() => {
    if (!selectedItem) return
    if (selectedItem.kind === 'anime') navigate(`/anime/${selectedItem.id}`)
    else if (selectedItem.kind === 'manga') navigate(`/manga/${selectedItem.id}`)
    else navigate('/local?tab=downloads')
  }, [navigate, selectedItem])

  const handleSecondaryAction = useCallback(() => {
    if (!selectedItem || selectedItem.kind === 'download') return
    navigate(selectedItem.kind === 'anime' ? '/anime-online' : '/manga-online')
  }, [navigate, selectedItem])

  const handleDangerAction = useCallback(async () => {
    if (!selectedItem) return

    if (selectedItem.kind === 'download') {
      await handleRemoveDownload(selectedItem.id)
      return
    }

    if (selectedItem.kind !== 'anime') return

    try {
      await wails.deleteLocalAnime(selectedItem.id)
      toastSuccess(isEnglish ? 'Anime removed from the local library.' : 'Anime eliminado de la biblioteca local.')
      await localQuery.refetch()
    } catch (error) {
      toastError(error?.message ?? (isEnglish ? 'Could not remove it.' : 'No se pudo eliminar.'))
    }
  }, [handleRemoveDownload, isEnglish, localQuery, selectedItem])

  const setTab = useCallback((nextTab) => {
    setSearchParams(nextTab === 'all' ? {} : { tab: nextTab })
  }, [setSearchParams])

  const handleActivitySelect = useCallback((nextSelectionKey) => {
    if (!nextSelectionKey) return
    const [kind] = String(nextSelectionKey).split('-')
    if (kind === 'download' && activeTab !== 'downloads') {
      setTab('downloads')
    } else if ((kind === 'anime' || kind === 'manga') && activeTab !== 'all' && kind !== activeTab) {
      setTab(kind)
    }
    setSelectedKey(nextSelectionKey)
  }, [activeTab, setTab])

  const footerPaths = libraryPaths.map((path) => path.path).filter(Boolean)
  const dangerLabel = selectedItem?.kind === 'anime'
    ? (isEnglish ? 'Remove from Library' : 'Eliminar de la biblioteca')
    : selectedItem?.kind === 'download'
      ? (isEnglish ? 'Remove' : 'Eliminar')
      : ''

  return (
    <div className="gui2-localv2-page fade-in">
      <section className="gui2-localv2-hero">
        <div className="gui2-localv2-heading">
          <h1 className="gui2-localv2-title">{isEnglish ? 'Local' : 'Local'}</h1>
          <p className="gui2-localv2-copy">{isEnglish ? 'Manage your local anime and manga collection.' : 'Administra tu coleccion local de anime y manga.'}</p>
        </div>

        <div className="gui2-localv2-hero-tools">
          <label className="gui2-localv2-search">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="gui2-localv2-search-icon">
              <path d="M8.5 3.75a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5Zm0-1.25a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm5.2 10.32 3.02 3.02-.88.88-3.02-3.02.88-.88Z" fill="currentColor" />
            </svg>
            <input
              type="text"
              className="gui2-localv2-search-input"
              placeholder={activeTab === 'downloads'
                ? (isEnglish ? 'Search your queue...' : 'Buscar en la cola...')
                : (isEnglish ? 'Search your library...' : 'Buscar en tu biblioteca...')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="gui2-localv2-search-shortcut">Ctrl K</span>
          </label>

          <div className="gui2-localv2-action-row">
            <button type="button" className="btn btn-ghost" onClick={handleScanFolder} disabled={busyAction === 'scan'}>
              {busyAction === 'scan' ? (isEnglish ? 'Scanning...' : 'Escaneando...') : (isEnglish ? 'Scan Folder' : 'Escanear carpeta')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleAddFolder} disabled={busyAction === 'add-folder'}>
              {busyAction === 'add-folder' ? (isEnglish ? 'Adding...' : 'Agregando...') : (isEnglish ? 'Add Folder' : 'Agregar carpeta')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/settings')}>
              {isEnglish ? 'Library Settings' : 'Ajustes'}
            </button>
          </div>
        </div>
      </section>

      <section className="gui2-localv2-overview">
        <LocalStatCard {...overview.totalAnime} />
        <LocalStatCard {...overview.totalManga} />
        <LocalStatCard {...overview.recentlyAdded} />
        <LocalStatCard {...overview.storageUsed} />
        <LocalStatCard {...overview.sources} />
      </section>

      <section className="gui2-localv2-workspace">
        <header className="gui2-localv2-toolbar">
          <div className="gui2-localv2-tabs">
            <button type="button" className={`gui2-localv2-tab${activeTab === 'all' ? ' is-active' : ''}`} onClick={() => setTab('all')}>{isEnglish ? 'All' : 'Todo'}</button>
            <button type="button" className={`gui2-localv2-tab${activeTab === 'anime' ? ' is-active' : ''}`} onClick={() => setTab('anime')}>Anime</button>
            <button type="button" className={`gui2-localv2-tab${activeTab === 'manga' ? ' is-active' : ''}`} onClick={() => setTab('manga')}>Manga</button>
            <button type="button" className={`gui2-localv2-tab gui2-localv2-tab-secondary${activeTab === 'downloads' ? ' is-active' : ''}`} onClick={() => setTab('downloads')}>
              {isEnglish ? 'Queue' : 'Cola'}
            </button>
          </div>

          <div className="gui2-localv2-controls">
            <label className="gui2-localv2-control">
              <span>{isEnglish ? 'Sort by:' : 'Orden:'}</span>
              <select className="gui2-localv2-select" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="RECENT">{isEnglish ? 'Recently Added' : 'Recientes'}</option>
                <option value="TITLE">{isEnglish ? 'Title' : 'Titulo'}</option>
                <option value="YEAR">{isEnglish ? 'Year' : 'Ano'}</option>
                <option value="COUNT">{activeTab === 'manga' ? (isEnglish ? 'Chapter Count' : 'Capitulos') : activeTab === 'downloads' ? (isEnglish ? 'Progress' : 'Progreso') : (isEnglish ? 'Episode Count' : 'Episodios')}</option>
              </select>
            </label>
            {activeTab !== 'downloads' ? (
              <label className="gui2-localv2-control">
                <span>{isEnglish ? 'Filter' : 'Filtro'}</span>
                <select className="gui2-localv2-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {LOCAL_STATUS_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {value === 'all'
                        ? (isEnglish ? 'All Statuses' : 'Todos')
                        : value === 'active'
                          ? (isEnglish ? 'Active / Airing' : 'Activos')
                          : (isEnglish ? 'Completed' : 'Completados')}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="gui2-localv2-view-toggle" role="tablist" aria-label={isEnglish ? 'View mode' : 'Modo de vista'}>
              <button type="button" className={`gui2-localv2-view-btn${viewMode === 'grid' ? ' is-active' : ''}`} onClick={() => setViewMode('grid')}>{isEnglish ? 'Grid' : 'Grid'}</button>
              <button type="button" className={`gui2-localv2-view-btn${viewMode === 'list' ? ' is-active' : ''}`} onClick={() => setViewMode('list')}>{isEnglish ? 'List' : 'Lista'}</button>
            </div>
          </div>
        </header>

        <div className="gui2-localv2-content">
          <section className="gui2-localv2-library">
            <div className="gui2-localv2-countline">
              {localQuery.isLoading
                ? (isEnglish ? 'Loading local library...' : 'Cargando biblioteca local...')
                : `${catalogItems.length} ${isEnglish ? 'titles' : 'titulos'}`}
            </div>

            {localQuery.isLoading ? (
              <div className="gui2-inline-empty">{isEnglish ? 'Loading local library...' : 'Cargando biblioteca local...'}</div>
            ) : !catalogItems.length ? (
              <div className="gui2-inline-empty">{isEnglish ? 'Nothing matched this view yet.' : 'Todavia no hay resultados para esta vista.'}</div>
            ) : viewMode === 'grid' ? (
              <div className="gui2-localv2-grid">
                {catalogItems.map((item) => (
                  <LocalMediaCard key={item.selectionKey} item={item} selected={item.selectionKey === selectedKey} onSelect={setSelectedKey} />
                ))}
              </div>
            ) : (
              <div className="gui2-localv2-list">
                <div className="gui2-localv2-list-head">
                  <span>{isEnglish ? 'Title' : 'Titulo'}</span>
                  <span>{isEnglish ? 'Type' : 'Tipo'}</span>
                  <span>{activeTab === 'downloads' ? (isEnglish ? 'Progress' : 'Progreso') : (isEnglish ? 'Count' : 'Cantidad')}</span>
                  <span>{isEnglish ? 'Status' : 'Estado'}</span>
                  <span>{isEnglish ? 'Year' : 'Ano'}</span>
                </div>
                {catalogItems.map((item) => (
                  <LocalMediaRow key={item.selectionKey} item={item} selected={item.selectionKey === selectedKey} onSelect={setSelectedKey} />
                ))}
              </div>
            )}
          </section>

          <LocalSelectionPanel
            selectedItem={selectedItem}
            selectedDetail={selectedDetailQuery.data}
            selectedMeta={selectedMetaQuery.data}
            detailLoading={selectedDetailQuery.isLoading}
            activeTab={activeTab}
            isEnglish={isEnglish}
            onPrimaryAction={handlePrimaryAction}
            onOpenDetails={handleOpenDetails}
            onSecondaryAction={handleSecondaryAction}
            onDangerAction={handleDangerAction}
            dangerLabel={dangerLabel}
          />

          <aside className="gui2-localv2-activity">
            <div className="gui2-localv2-panel-title">{isEnglish ? 'Recent Activity' : 'Actividad reciente'}</div>
            <div className="gui2-localv2-activity-list">
              {activityItems.map((item, index) => (
                <LocalActivityItem key={`${item.kind}-${item.selectionKey || index}-${item.title}`} item={item} onSelect={handleActivitySelect} />
              ))}
            </div>
          </aside>
        </div>

        <footer className="gui2-localv2-footer">
          <div className="gui2-localv2-footer-paths">
            <span>{isEnglish ? 'Library locations:' : 'Ubicaciones:'}</span>
            {footerPaths.length ? footerPaths.join('   ') : (isEnglish ? 'No folders registered yet.' : 'Aun no hay carpetas registradas.')}
          </div>
          <div className="gui2-localv2-footer-status">
            {isEnglish ? 'Scan Status:' : 'Estado del escaneo:'} {busyAction ? (isEnglish ? 'Working' : 'Trabajando') : (isEnglish ? 'Idle' : 'Inactivo')}
            {selectedItem?.kind === 'download' ? ` · ${formatGui2LocalStorage(selectedItem.fileSize)}` : ''}
          </div>
        </footer>
      </section>
    </div>
  )
}
