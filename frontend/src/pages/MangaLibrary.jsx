import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastError } from '../components/ui/Toast'
import VirtualMediaGrid from '../components/ui/VirtualMediaGrid'
import BlurhashImage from '../components/ui/BlurhashImage'
import { useI18n } from '../lib/i18n'

export default function MangaLibrary({ embedded = false }) {
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const navigate = useNavigate()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'

  const {
    data: manga = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ['manga-library'],
    queryFn: async () => {
      const list = await wails.getMangaList()
      return list ?? []
    },
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
  })

  const handleScan = useCallback(async () => {
    setScanning(true)
    setScanResult(null)
    try {
      const result = await wails.scanWithPicker()
      if (!result?.cancelled) {
        setScanResult(result)
        await refetch()
      }
    } catch (e) {
      toastError(isEnglish ? `Scan error: ${e?.message ?? 'unknown error'}` : `Error al escanear: ${e?.message ?? 'error desconocido'}`)
    } finally {
      setScanning(false)
    }
  }, [refetch, isEnglish])

  if (loading) return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )

  return (
    <div className={`fade-in${embedded ? ' local-section-embedded' : ''}`}>
      <div className="section-header">
        <span className="section-title">
          Manga {manga.length > 0 && <span className="badge badge-muted" style={{ marginLeft: 8 }}>{manga.length}</span>}
        </span>
        <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
          {scanning ? (isEnglish ? 'Scanning...' : 'Escaneando...') : (isEnglish ? '+ Add folder' : '+ Agregar carpeta')}
        </button>
      </div>

      {scanResult && (
        <div className="scan-result-bar">
          {isEnglish ? (
            <>
              Scanned: <b>{scanResult.files_scanned}</b> files - <b>{scanResult.manga_found}</b> manga, <b>{scanResult.manga_enriched ?? 0}</b> enriched with MangaDex
            </>
          ) : (
            <>
              Escaneado: <b>{scanResult.files_scanned}</b> archivos - <b>{scanResult.manga_found}</b> manga, <b>{scanResult.manga_enriched ?? 0}</b> enriquecidos con MangaDex
            </>
          )}
        </div>
      )}

      {manga.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">[]</div>
          <h2 className="empty-state-title">{isEnglish ? 'No manga yet' : 'Sin manga aun'}</h2>
          <p className="empty-state-desc">
            {isEnglish
              ? 'Add a folder with your CBZ, CBR or PDF files. Metadata is fetched automatically from MangaDex.'
              : 'Agrega una carpeta con tus archivos CBZ, CBR o PDF. Los metadatos en espanol se obtienen automaticamente de MangaDex.'}
          </p>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {isEnglish ? 'Add folder' : 'Agregar carpeta'}
          </button>
        </div>
      ) : (
        <VirtualMediaGrid
          items={manga}
          virtualize
          itemContent={(item) => (
            <div key={item.id} className="media-card" onClick={() => navigate(`/manga/${item.id}`)}>
              {item.cover_image
                ? <BlurhashImage src={item.cover_image} blurhash={item.cover_blurhash} alt={item.display_title} imgClassName="media-card-cover" />
                : <div className="media-card-cover-placeholder">{isEnglish ? 'no cover' : 'sin portada'}</div>
              }
              <div className="media-card-overlay" />
              <div className="media-card-body">
                <div className="media-card-title">{item.display_title || (isEnglish ? 'Untitled' : 'Sin titulo')}</div>
                <div className="media-card-meta">
                  {item.year ? `${item.year} · ` : ''}
                  {item.chapters_total ? `${item.chapters_total} ${isEnglish ? 'chs' : 'caps'}` : (isEnglish ? 'unknown chs' : 'caps desconocidos')}
                </div>
              </div>
            </div>
          )}
        />
      )}
    </div>
  )
}
