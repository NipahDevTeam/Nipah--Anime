import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastError } from '../components/ui/Toast'

export default function MangaLibrary() {
  const [manga, setManga] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(() => {
    wails.getMangaList()
      .then(list => setManga(list ?? []))
      .catch(() => setManga([]))
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
      <div className="section-header">
        <span className="section-title">
          Manga {manga.length > 0 && <span className="badge badge-muted" style={{ marginLeft: 8 }}>{manga.length}</span>}
        </span>
        <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
          {scanning ? 'Escaneando...' : '+ Agregar carpeta'}
        </button>
      </div>

      {scanResult && (
        <div className="scan-result-bar">
          ✓ Escaneado: <b>{scanResult.files_scanned}</b> archivos —&nbsp;
          <b>{scanResult.manga_found}</b> manga, <b>{scanResult.manga_enriched ?? 0}</b> enriquecidos con MangaDex
        </div>
      )}

      {manga.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◫</div>
          <h2 className="empty-state-title">Sin manga aún</h2>
          <p className="empty-state-desc">
            Agrega una carpeta con tus archivos CBZ, CBR o PDF.
            Los metadatos en español se obtienen automáticamente de MangaDex.
          </p>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            Agregar carpeta
          </button>
        </div>
      ) : (
        <div className="media-grid">
          {manga.map(item => (
            <div key={item.id} className="media-card" onClick={() => navigate(`/manga/${item.id}`)}>
              {item.cover_image
                ? <img src={item.cover_image} alt={item.display_title} className="media-card-cover" />
                : <div className="media-card-cover-placeholder">sin portada</div>
              }
              <div className="media-card-overlay" />
              <div className="media-card-body">
                <div className="media-card-title">{item.display_title || 'Sin título'}</div>
                <div className="media-card-meta">
                  {item.year ? `${item.year} · ` : ''}
                  {item.chapters_total ? `${item.chapters_total} caps` : 'caps desconocidos'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
