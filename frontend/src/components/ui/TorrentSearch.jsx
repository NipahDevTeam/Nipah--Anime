import { useState, useCallback, useEffect } from 'react'
import { wails } from '../../lib/wails'
import { toastError, toastSuccess } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'

const SPANISH_GROUPS = [
  'donatello','shiro','subsplease-es','subses','animeblue','fenix-fansub',
  'nkid','animeid','animelatino','español','castellano','latino','latam',
  'sub español','sub-español','multi-lang','multilang','multi lang',
]

const PT_GROUPS = [
  'pt-br','dublado','legendado','português','portugues',
  'dub pt','sub pt','audio pt','ptbr','yuri-fansub','livra',
]

const SOURCES = [
  { value: 'animetosho', label: 'AnimeTosho', note: 'Batches · AniList ID' },
  { value: 'nyaa',       label: 'Nyaa',       note: 'Episodios · Grupos ES/PT' },
]

function isES(title) {
  const t = (title ?? '').toLowerCase()
  return SPANISH_GROUPS.some(g => t.includes(g))
}

function isPT(title) {
  const t = (title ?? '').toLowerCase()
  return PT_GROUPS.some(g => t.includes(g))
}

export default function TorrentSearch({ onClose }) {
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [query, setQuery]       = useState('')
  const [source, setSource]     = useState('animetosho')
  const [filter, setFilter]     = useState('batch')
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [searched, setSearched] = useState(false)
  const [dlPath, setDlPath]     = useState('')

  useEffect(() => {
    wails.getDefaultDownloadPath()
      .then(p => setDlPath(p ?? ''))
      .catch(() => {})
  }, [])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setSearched(false)
    setResults([])
    try {
      const res = await wails.searchTorrents(query.trim(), source, 0)
      setResults(res ?? [])
    } catch (e) {
      toastError(`${isEnglish ? 'Search error' : 'Error al buscar'}: ${e?.message ?? (isEnglish ? 'unknown error' : 'error desconocido')}`)
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [query, source])

  const handleDownload = useCallback(async (magnet, title) => {
    try {
      await wails.openMagnet(magnet)
      toastSuccess(`${isEnglish ? 'Opening' : 'Abriendo'}: ${(title ?? '').slice(0, 40)}...`)
    } catch (e) {
      toastError(`${isEnglish ? 'Error opening magnet' : 'Error al abrir magnet'}: ${e?.message ?? (isEnglish ? 'unknown error' : 'error desconocido')}`)
    }
  }, [isEnglish])

  const filtered = (results ?? []).filter(r =>
    filter === 'all' ? true : filter === 'batch' ? r.is_batch : !r.is_batch
  )

  return (
    <div className="torrent-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="torrent-modal">
        {/* Header */}
        <div className="torrent-modal-header">
          <span className="torrent-modal-title">{isEnglish ? '⬇ Download Anime' : '⬇ Descargar Anime'}</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 18, padding: '2px 8px' }}>×</button>
        </div>

        {/* Download path */}
        <div className="torrent-dl-path">
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isEnglish ? '📁 Folder:' : '📁 Carpeta:'}</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>{dlPath || (isEnglish ? 'Auto' : 'Auto')}</span>
        </div>

        {/* Search bar */}
        <div className="torrent-search-bar">
          <input
            className="online-search-input"
            placeholder={isEnglish ? 'Search anime...' : 'Buscar anime...'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            autoFocus
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? (isEnglish ? 'Searching...' : 'Buscando...') : (isEnglish ? 'Search' : 'Buscar')}
          </button>
        </div>

        {/* Source selector */}
        <div className="torrent-sources">
          {SOURCES.map(s => (
            <button key={s.value}
              className={`btn ${source === s.value ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => { setSource(s.value); setResults([]); setSearched(false) }}>
              {s.label}
              <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>{s.note}</span>
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="torrent-results">
          {loading && (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
              </div>
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <p className="empty-state-desc">{isEnglish ? 'No results. Try the Japanese title or another provider.' : 'Sin resultados. Intenta el título en japonés o con otro proveedor.'}</p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <>
              {/* Filter tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {[[ 'batch', isEnglish ? 'Complete' : 'Completos' ],[ 'episodes', isEnglish ? 'Episodes' : 'Episodios' ],[ 'all', isEnglish ? 'All' : 'Todos' ]].map(([val, label]) => (
                  <button key={val}
                    className={`btn ${filter === val ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => setFilter(val)}>
                    {label}
                  </button>
                ))}
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', alignSelf: 'center' }}>
                  {filtered.length} {isEnglish ? `result${filtered.length !== 1 ? 's' : ''}` : `resultado${filtered.length !== 1 ? 's' : ''}`}
                </span>
              </div>

              {filtered.map((r, i) => (
                <div key={i} className={`torrent-row ${r.is_batch ? 'torrent-row-batch' : ''}`}>
                  <div className="torrent-row-info">
                    <div className="torrent-row-title">
                      {r.is_batch && (
                    <span className="badge badge-accent" style={{ marginRight: 4, fontSize: 10 }}>{isEnglish ? 'COMPLETE' : 'COMPLETO'}</span>
                      )}
                      {isES(r.title) && !isPT(r.title) && (
                        <span className="badge" style={{ marginRight: 4, fontSize: 10, background: '#dc2626', color: 'white' }}>
                          {(r.title ?? '').toLowerCase().includes('multi') ? 'MULTI' : 'ES'}
                        </span>
                      )}
                      {isPT(r.title) && (
                        <span className="badge" style={{ marginRight: 4, fontSize: 10, background: '#16a34a', color: 'white' }}>PT</span>
                      )}
                      {r.quality && (
                        <span className="badge badge-muted" style={{ marginRight: 4, fontSize: 10 }}>{r.quality}</span>
                      )}
                      {r.title ?? ''}
                    </div>
                    <div className="torrent-row-meta">
                      {r.group && <span style={{ color: 'var(--accent)' }}>[{r.group}]</span>}
                      {r.size && <span>{r.size}</span>}
                      {r.seeders > 0 && <span style={{ color: '#4ade80' }}>▲ {r.seeders}</span>}
                      {r.leechers > 0 && <span style={{ color: '#f87171' }}>▼ {r.leechers}</span>}
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{r.source}</span>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ flexShrink: 0, fontSize: 12, padding: '6px 14px' }}
                    onClick={() => handleDownload(r.magnet, r.title)}>
                    {isEnglish ? '⬇ Download' : '⬇ Descargar'}
                  </button>
                </div>
              ))}

              {filtered.length === 0 && (
                <div className="empty-state" style={{ padding: '16px 0' }}>
                  <p className="empty-state-desc">{isEnglish ? `There are no ${filter === 'batch' ? 'complete batches' : 'individual episodes'} for this anime.` : `No hay ${filter === 'batch' ? 'batches completos' : 'episodios individuales'} para este anime.`}</p>
                </div>
              )}
            </>
          )}

          {!loading && !searched && (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <div style={{ fontSize: 28 }}>🧲</div>
              <p className="empty-state-desc" style={{ marginTop: 8 }}>
                {isEnglish ? 'Search for an anime to see available torrents.' : 'Busca un anime para ver torrents disponibles.'}<br />
                {isEnglish ? 'Files are saved to your folder and appear in the library automatically.' : 'Los archivos se guardan en tu carpeta y aparecen en la biblioteca automáticamente.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
