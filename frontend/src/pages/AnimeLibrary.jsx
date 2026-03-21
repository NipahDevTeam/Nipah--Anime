import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastError } from '../components/ui/Toast'
import TorrentSearch from '../components/ui/TorrentSearch'
import { useI18n } from '../lib/i18n'

export default function AnimeLibrary() {
  const [anime, setAnime]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [scanning, setScanning]     = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [showTorrent, setShowTorrent] = useState(false)
  const navigate = useNavigate()
  const { t } = useI18n()

  const load = useCallback(() => {
    wails.getAnimeList()
      .then(list => setAnime(list ?? []))
      .catch(() => setAnime([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleScan = useCallback(async () => {
    setScanning(true)
    setScanResult(null)
    try {
      const result = await wails.scanWithPicker()
      if (!result?.cancelled) {
        setScanResult(result)
        load()
      }
    } catch (e) {
      toastError(`Error al escanear: ${e?.message ?? 'error desconocido'}`)
    } finally {
      setScanning(false)
    }
  }, [load])

  if (loading) return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )

  return (
    <div className="fade-in">
      {showTorrent && <TorrentSearch onClose={() => setShowTorrent(false)} />}

      <div className="section-header">
        <span className="section-title">
          Anime {anime.length > 0 && <span className="badge badge-muted" style={{ marginLeft: 8 }}>{anime.length}</span>}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {scanning ? t('Buscando...') : t('+ Agregar biblioteca')}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowTorrent(true)}
            style={{ color: 'var(--accent)' }}>
            ⬇ Descargar anime
          </button>
        </div>
      </div>

      {scanResult && (
        <div className="scan-result-bar">
          ✓ Escaneado: <b>{scanResult.files_scanned}</b> archivos —&nbsp;
          <b>{scanResult.anime_found}</b> anime, <b>{scanResult.anime_enriched ?? 0}</b> enriquecidos con AniList
        </div>
      )}

      {anime.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▶</div>
          <h2 className="empty-state-title">Sin anime aún</h2>
          <p className="empty-state-desc">
            {t('Modo online')}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
              + Añadir carpeta
            </button>
            <button className="btn btn-ghost" onClick={() => setShowTorrent(true)}
              style={{ color: 'var(--accent)' }}>
              ⬇ Descargar anime
            </button>
          </div>
        </div>
      ) : (
        <div className="media-grid">
          {anime.map(item => (
            <div key={item.id} className="media-card" onClick={() => navigate(`/anime/${item.id}`)}>
              {item.cover_image
                ? <img src={item.cover_image} alt={item.display_title} className="media-card-cover" />
                : <div className="media-card-cover-placeholder">sin portada</div>
              }
              <div className="media-card-overlay" />
              <div className="media-card-body">
                <div className="media-card-title">{item.display_title || 'Sin título'}</div>
                <div className="media-card-meta">
                  {item.year ? `${item.year} · ` : ''}
                  {item.episodes_total ? `${item.episodes_total} eps` : 'eps desconocidos'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
