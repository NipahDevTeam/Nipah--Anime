import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toastError, toastSuccess } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'
import { proxyImage, wails } from '../lib/wails'
import { buildGui2LocalCatalog, formatGui2LocalStorage } from '../gui-v2/routes/local/localData'

const LOCAL_TABS = ['all', 'anime', 'manga', 'downloads']

function getQueueActionLabel(item, isEnglish) {
  const status = String(item?.status || '').toLowerCase()
  if (status === 'completed') return isEnglish ? 'Play Episode' : 'Ver episodio'
  if (status === 'downloading' || status === 'pending') return isEnglish ? 'Cancel Transfer' : 'Cancelar transferencia'
  return isEnglish ? 'Remove Entry' : 'Eliminar entrada'
}

function LocalMediaCard({ item, isEnglish, onOpen }) {
  const subtitle = item.subtitle && item.subtitle !== item.title ? item.subtitle : ''
  return (
    <button type="button" className="gui2-localv2-card" onClick={() => onOpen(item)}>
      <div className="gui2-localv2-card-cover-wrap">
        {item.cover ? (
          <img src={proxyImage(item.cover)} alt={item.title} className="gui2-localv2-card-cover" />
        ) : (
          <div className="gui2-localv2-card-cover gui2-localv2-card-cover-fallback">{item.title.slice(0, 1)}</div>
        )}
      </div>
      <div className="gui2-localv2-card-body">
        <div className="gui2-localv2-card-title">{item.title}</div>
        {subtitle ? <div className="gui2-localv2-card-subtitle">{subtitle}</div> : null}
        <div className="gui2-localv2-card-meta">{item.metaLine}</div>
        <div className="gui2-localv2-card-footer">
          <span>{item.typeLabel}</span>
          <span>{item.countLabel}</span>
        </div>
        <div className="gui2-localv2-card-actionhint">{isEnglish ? 'Open' : 'Abrir'}</div>
      </div>
    </button>
  )
}

function LocalDownloadCard({ item, isEnglish, onPrimaryAction }) {
  const progress = Math.max(0, Math.min(100, Number(item.progress || 0)))
  return (
    <article className="gui2-localv2-card gui2-localv2-card--download">
      <div className="gui2-localv2-card-cover-wrap">
        {item.cover ? (
          <img src={proxyImage(item.cover)} alt={item.title} className="gui2-localv2-card-cover" />
        ) : (
          <div className="gui2-localv2-card-cover gui2-localv2-card-cover-fallback">{item.title.slice(0, 1)}</div>
        )}
      </div>
      <div className="gui2-localv2-card-body">
        <div className="gui2-localv2-card-title">{item.title}</div>
        <div className="gui2-localv2-card-subtitle">{item.subtitle}</div>
        <div className="gui2-localv2-card-meta">{item.metaLine}</div>
        <div className="gui2-localv2-card-progressbar" aria-hidden="true">
          <div className="gui2-localv2-card-progressfill" style={{ width: `${progress}%` }} />
        </div>
        <div className="gui2-localv2-card-footer">
          <span>{item.statusLabel}</span>
          <span>{item.fileSize ? formatGui2LocalStorage(item.fileSize) : item.countLabel}</span>
        </div>
        <button type="button" className="btn btn-ghost gui2-localv2-card-action" onClick={() => onPrimaryAction(item)}>
          {getQueueActionLabel(item, isEnglish)}
        </button>
      </div>
    </article>
  )
}

export default function Local() {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const deferredQuery = useDeferredValue(query)

  const requestedTab = (searchParams.get('tab') || '').toLowerCase()
  const activeTab = LOCAL_TABS.includes(requestedTab) ? requestedTab : 'all'

  const localQuery = useQuery({
    queryKey: ['gui2-local-workspace'],
    queryFn: async () => {
      const [anime, manga, downloads] = await Promise.all([
        wails.getAnimeList(),
        wails.getMangaList(),
        wails.getDownloads(),
      ])

      return {
        anime: anime ?? [],
        manga: manga ?? [],
        downloads: downloads ?? [],
      }
    },
    staleTime: 30_000,
    refetchInterval: 5_000,
  })

  const animeItems = localQuery.data?.anime ?? []
  const mangaItems = localQuery.data?.manga ?? []
  const downloadItems = localQuery.data?.downloads ?? []

  const catalogItems = useMemo(() => buildGui2LocalCatalog({
    animeItems,
    mangaItems,
    downloadItems,
    activeTab,
    sort: 'RECENT',
    query: deferredQuery,
    isEnglish,
  }), [animeItems, mangaItems, downloadItems, activeTab, deferredQuery, isEnglish])

  const handleScanFolder = useCallback(async () => {
    setBusyAction('scan')
    try {
      const result = await wails.scanWithPicker()
      if (!result?.cancelled) {
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
      await wails.scanLibrary(path)
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

  const handleOpenMediaItem = useCallback((item) => {
    if (!item) return
    if (item.kind === 'anime') navigate(`/anime/${item.id}`)
    if (item.kind === 'manga') navigate(`/manga/${item.id}`)
  }, [navigate])

  const handleQueuePrimaryAction = useCallback(async (item) => {
    const status = String(item?.status || '').toLowerCase()
    if (status === 'completed') {
      await handlePlayDownload(item.id)
      return
    }
    if (status === 'downloading' || status === 'pending') {
      await handleCancelDownload(item.id)
      return
    }
    await handleRemoveDownload(item.id)
  }, [handleCancelDownload, handlePlayDownload, handleRemoveDownload])

  const setTab = useCallback((nextTab) => {
    setSearchParams(nextTab === 'all' ? {} : { tab: nextTab })
  }, [setSearchParams])

  const queryPlaceholder = activeTab === 'downloads'
    ? (isEnglish ? 'Search your queue...' : 'Buscar en la cola...')
    : (isEnglish ? 'Search your library...' : 'Buscar en tu biblioteca...')

  const stageMeta = localQuery.isLoading
    ? (isEnglish ? 'Loading local library...' : 'Cargando biblioteca local...')
    : activeTab === 'downloads'
      ? `${catalogItems.length} ${isEnglish ? 'queue items' : 'elementos en cola'}`
      : `${catalogItems.length} ${isEnglish ? 'titles' : 'titulos'}`

  return (
    <div className="gui2-localv2-page fade-in">
      <section className="gui2-localv2-hero">
        <h1 className="gui2-localv2-title">{isEnglish ? 'Local Library' : 'Biblioteca local'}</h1>

        <div className="gui2-localv2-hero-tools">
          <label className="gui2-localv2-search">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="gui2-localv2-search-icon">
              <path d="M8.5 3.75a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5Zm0-1.25a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm5.2 10.32 3.02 3.02-.88.88-3.02-3.02.88-.88Z" fill="currentColor" />
            </svg>
            <input
              type="text"
              className="gui2-localv2-search-input"
              placeholder={queryPlaceholder}
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
          </div>
        </div>
      </section>

      <section className="gui2-localv2-workspace">
        <header className="gui2-localv2-toolbar">
          <div className="gui2-localv2-tabs">
            <button type="button" className={`gui2-localv2-tab${activeTab === 'all' ? ' is-active' : ''}`} onClick={() => setTab('all')}>{isEnglish ? 'All' : 'Todo'}</button>
            <button type="button" className={`gui2-localv2-tab${activeTab === 'anime' ? ' is-active' : ''}`} onClick={() => setTab('anime')}>Anime</button>
            <button type="button" className={`gui2-localv2-tab${activeTab === 'manga' ? ' is-active' : ''}`} onClick={() => setTab('manga')}>Manga</button>
            <button type="button" className={`gui2-localv2-tab${activeTab === 'downloads' ? ' is-active' : ''}`} onClick={() => setTab('downloads')}>
              {isEnglish ? 'Queue' : 'Cola'}
            </button>
          </div>
          <div className="gui2-localv2-library-meta">{stageMeta}</div>
        </header>

        {localQuery.isLoading ? (
          <div className="gui2-inline-empty">{isEnglish ? 'Loading local library...' : 'Cargando biblioteca local...'}</div>
        ) : !catalogItems.length ? (
          <div className="gui2-inline-empty">{isEnglish ? 'Nothing matched this view yet.' : 'Todavia no hay resultados para esta vista.'}</div>
        ) : (
          <div className="gui2-localv2-grid">
            {catalogItems.map((item) => (
              item.kind === 'download'
                ? <LocalDownloadCard key={item.selectionKey} item={item} isEnglish={isEnglish} onPrimaryAction={handleQueuePrimaryAction} />
                : <LocalMediaCard key={item.selectionKey} item={item} isEnglish={isEnglish} onOpen={handleOpenMediaItem} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
