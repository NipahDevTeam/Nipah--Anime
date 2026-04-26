import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { wails } from '../../lib/wails'
import { toastError, toastSuccess } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'

const SPANISH_GROUPS = [
  'donatello', 'shiro', 'subsplease-es', 'subses', 'animeblue', 'fenix-fansub',
  'nkid', 'animeid', 'animelatino', 'español', 'castellano', 'latino', 'latam',
  'sub español', 'sub-español', 'multi-lang', 'multilang', 'multi lang',
]

const SOURCES = [
  { value: 'animetosho', label: 'AnimeTosho', noteEn: 'Batch-focused index', noteEs: 'Índice orientado a packs' },
  { value: 'nyaa', label: 'Nyaa', noteEn: 'Episode and fansub torrents', noteEs: 'Torrents de episodios y fansubs' },
]

function isES(title) {
  const t = (title ?? '').toLowerCase()
  return SPANISH_GROUPS.some((group) => t.includes(group))
}

function magnetResult(rawMagnet) {
  return {
    title: rawMagnet,
    magnet: rawMagnet,
    size: '',
    seeders: 0,
    leechers: 0,
    is_batch: false,
    quality: '',
    group: '',
    source: 'magnet',
    info_hash: '',
  }
}

function formatFolderPath(path) {
  const value = (path ?? '').trim()
  if (!value) return 'Auto'
  if (value.length <= 42) return value

  const normalized = value.replaceAll('\\', '/')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length >= 2) {
    return `.../${segments.slice(-2).join('/')}`
  }
  return `...${value.slice(-39)}`
}

export default function TorrentSearch({ onClose }) {
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('nyaa')
  const [filter, setFilter] = useState('batch')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [searched, setSearched] = useState(false)
  const [dlPath, setDlPath] = useState('')

  useEffect(() => {
    wails.getDefaultDownloadPath()
      .then((path) => setDlPath(path ?? ''))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed) return

    setLoading(true)
    setSearched(false)
    setResults([])

    try {
      if (trimmed.startsWith('magnet:?')) {
        setResults([magnetResult(trimmed)])
      } else {
        const response = await wails.searchTorrents(trimmed, source, 0)
        setResults(response ?? [])
      }
    } catch (e) {
      toastError(`${isEnglish ? 'Search error' : 'Error al buscar'}: ${e?.message ?? (isEnglish ? 'unknown error' : 'error desconocido')}`)
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [isEnglish, query, source])

  const handleDownload = useCallback(async (magnet, title) => {
    try {
      await wails.openMagnet(magnet)
      toastSuccess(`${isEnglish ? 'Opening magnet' : 'Abriendo magnet'}: ${(title ?? '').slice(0, 48)}...`)
    } catch (e) {
      toastError(`${isEnglish ? 'Error opening magnet' : 'Error al abrir magnet'}: ${e?.message ?? (isEnglish ? 'unknown error' : 'error desconocido')}`)
    }
  }, [isEnglish])

  const handleStream = useCallback(async (magnet, title) => {
    setStreaming(magnet)
    try {
      await wails.streamTorrentMagnet(magnet, title ?? '', 'mpv')
      toastSuccess(`${isEnglish ? 'Opening in MPV' : 'Abriendo en MPV'}: ${(title ?? '').slice(0, 48)}...`)
    } catch (e) {
      toastError(`${isEnglish ? 'Error streaming torrent' : 'Error al reproducir torrent'}: ${e?.message ?? (isEnglish ? 'unknown error' : 'error desconocido')}`)
    } finally {
      setStreaming('')
    }
  }, [isEnglish])

  const filtered = (results ?? []).filter((result) => {
    if (filter === 'all') return true
    if (filter === 'batch') return result.is_batch
    return !result.is_batch
  })

  const modal = (
    <div className="torrent-modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="torrent-modal torrent-modal-rich">
        <div className="torrent-modal-header torrent-rich-header">
          <div>
            <div className="torrent-rich-eyebrow">{isEnglish ? 'Torrent Hub' : 'Hub Torrent'}</div>
            <div className="torrent-modal-title">{isEnglish ? 'Stream or download anime torrents' : 'Reproduce o descarga anime por torrent'}</div>
            <div className="torrent-rich-copy">
              {isEnglish
                ? 'Search batches, open a raw magnet, or send a torrent directly to MPV with the local bridge.'
                : 'Busca packs, abre un magnet manual o manda un torrent directo a MPV usando el puente local.'}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} type="button" aria-label={isEnglish ? 'Close' : 'Cerrar'}>×</button>
        </div>

        <div className="torrent-rich-meta">
          <div className="torrent-rich-meta-card">
            <span className="torrent-rich-meta-label">{isEnglish ? 'Default folder' : 'Carpeta por defecto'}</span>
            <span className="torrent-rich-meta-value" title={dlPath || 'Auto'}>{formatFolderPath(dlPath)}</span>
          </div>
          <div className="torrent-rich-meta-card">
            <span className="torrent-rich-meta-label">{isEnglish ? 'Best use' : 'Uso ideal'}</span>
            <span className="torrent-rich-meta-value">{isEnglish ? 'Complete batches and archive fansubs' : 'Packs completos y fansubs de archivo'}</span>
          </div>
        </div>

        <div className="torrent-search-bar torrent-rich-search">
          <input
            className="online-search-input"
            placeholder={isEnglish ? 'Search anime or paste a magnet link...' : 'Busca anime o pega un magnet...'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
            autoFocus
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? (isEnglish ? 'Searching...' : 'Buscando...') : (isEnglish ? 'Search' : 'Buscar')}
          </button>
        </div>

        <div className="torrent-source-pills">
          {SOURCES.map((item) => (
            <button
              key={item.value}
              className={`torrent-source-pill${source === item.value ? ' active' : ''}`}
              onClick={() => {
                setSource(item.value)
                setResults([])
                setSearched(false)
              }}
              type="button"
            >
              <span className="torrent-source-pill-title">{item.label}</span>
              <span className="torrent-source-pill-copy">{isEnglish ? item.noteEn : item.noteEs}</span>
            </button>
          ))}
        </div>

        <div className="torrent-results">
          {loading ? (
            <div className="empty-state" style={{ padding: '36px 0' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
              </div>
            </div>
          ) : null}

          {!loading && !searched ? (
            <div className="torrent-empty-panel">
              <div className="torrent-empty-icon">◎</div>
              <div className="torrent-empty-title">{isEnglish ? 'Start with a title or a magnet' : 'Empieza con un título o un magnet'}</div>
              <div className="torrent-empty-copy">
                {isEnglish
                  ? 'Use AnimeTosho for cleaner complete packs, or Nyaa when you want episode-by-episode releases.'
                  : 'Usa AnimeTosho para packs más limpios, o Nyaa si buscas lanzamientos episodio por episodio.'}
              </div>
            </div>
          ) : null}

          {!loading && searched && results.length === 0 ? (
            <div className="torrent-empty-panel">
              <div className="torrent-empty-title">{isEnglish ? 'No torrents found' : 'No se encontraron torrents'}</div>
              <div className="torrent-empty-copy">
                {isEnglish
                  ? 'Try the romaji title, another source, or paste a direct magnet link.'
                  : 'Prueba con el título en romaji, otra fuente, o pega un magnet directo.'}
              </div>
            </div>
          ) : null}

          {!loading && results.length > 0 ? (
            <>
              <div className="torrent-toolbar">
                <div className="torrent-filter-pills">
                  {[
                    ['batch', isEnglish ? 'Complete' : 'Completos'],
                    ['episodes', isEnglish ? 'Episodes' : 'Episodios'],
                    ['all', isEnglish ? 'All' : 'Todos'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={`torrent-filter-pill${filter === value ? ' active' : ''}`}
                      onClick={() => setFilter(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="torrent-toolbar-copy">
                  {filtered.length} {isEnglish ? `result${filtered.length !== 1 ? 's' : ''}` : `resultado${filtered.length !== 1 ? 's' : ''}`}
                </div>
              </div>

              <div className="torrent-card-list">
                {filtered.map((result, index) => (
                  <div key={`${result.magnet}-${index}`} className={`torrent-card${result.is_batch ? ' is-batch' : ''}`}>
                    <div className="torrent-card-copy">
                      <div className="torrent-card-topline">
                        {result.is_batch ? <span className="badge badge-accent">{isEnglish ? 'COMPLETE' : 'COMPLETO'}</span> : null}
                        {isES(result.title) ? (
                          <span className="badge" style={{ background: '#dc2626', color: '#fff' }}>
                            {(result.title ?? '').toLowerCase().includes('multi') ? 'MULTI' : 'ES'}
                          </span>
                        ) : null}
                        {result.quality ? <span className="badge badge-muted">{result.quality}</span> : null}
                      </div>

                      <div className="torrent-card-title">{result.title ?? ''}</div>

                      <div className="torrent-card-meta">
                        {result.group ? <span>[{result.group}]</span> : null}
                        {result.size ? <span>{result.size}</span> : null}
                        {result.seeders > 0 ? <span className="up">▲ {result.seeders}</span> : null}
                        {result.leechers > 0 ? <span className="down">▼ {result.leechers}</span> : null}
                        <span>{result.source}</span>
                      </div>
                    </div>

                    <div className="torrent-card-actions">
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleStream(result.magnet, result.title)}
                        disabled={streaming === result.magnet}
                        type="button"
                      >
                        {streaming === result.magnet
                          ? (isEnglish ? 'Opening...' : 'Abriendo...')
                          : (isEnglish ? 'Open in MPV' : 'Abrir en MPV')}
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleDownload(result.magnet, result.title)}
                        type="button"
                      >
                        {isEnglish ? 'Download magnet' : 'Descargar magnet'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {filtered.length === 0 ? (
                <div className="torrent-empty-panel" style={{ marginTop: 12 }}>
                  <div className="torrent-empty-copy">
                    {isEnglish
                      ? `There are no ${filter === 'batch' ? 'complete batches' : 'single episode'} entries for this search.`
                      : `No hay entradas de ${filter === 'batch' ? 'packs completos' : 'episodios sueltos'} para esta búsqueda.`}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return modal
  }

  return createPortal(modal, document.body)
}
