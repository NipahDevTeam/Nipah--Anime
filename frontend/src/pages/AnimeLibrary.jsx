import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastError } from '../components/ui/Toast'
import TorrentSearch from '../components/ui/TorrentSearch'
import VirtualMediaGrid from '../components/ui/VirtualMediaGrid'
import BlurhashImage from '../components/ui/BlurhashImage'
import { useI18n } from '../lib/i18n'
import { EventsOn } from '../../wailsjs/runtime/runtime'

export default function AnimeLibrary({ embedded = false }) {
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [showTorrent, setShowTorrent] = useState(false)
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const isEnglish = lang === 'en'

  const {
    data: anime = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ['anime-library'],
    queryFn: async () => {
      const list = await wails.getAnimeList()
      return list ?? []
    },
    refetchInterval: embedded ? 2000 : false,
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
    } catch (error) {
      toastError(
        isEnglish
          ? `Scan error: ${error?.message ?? 'unknown error'}`
          : `Error al escanear: ${error?.message ?? 'error desconocido'}`
      )
    } finally {
      setScanning(false)
    }
  }, [isEnglish, refetch])

  useEffect(() => {
    if (!(typeof window !== 'undefined' && window?.runtime?.EventsOnMultiple)) {
      return undefined
    }
    const unsubscribe = EventsOn('library:anime-imported', () => {
      void refetch()
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [refetch])

  if (loading) {
    return (
      <div className="empty-state">
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
        </div>
      </div>
    )
  }

  return (
    <div className={`fade-in${embedded ? ' local-section-embedded' : ''}`}>
      {showTorrent && <TorrentSearch onClose={() => setShowTorrent(false)} />}

      <div className="section-header">
        <span className="section-title">
          Anime {anime.length > 0 && <span className="badge badge-muted" style={{ marginLeft: 8 }}>{anime.length}</span>}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {scanning ? t('Buscando...') : t('+ Agregar biblioteca')}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowTorrent(true)} style={{ color: 'var(--accent)' }}>
            {isEnglish ? 'Download anime' : 'Descargar anime'}
          </button>
        </div>
      </div>

      {scanResult && (
        <div className="scan-result-bar">
          {isEnglish ? (
            <>
              Scanned: <b>{scanResult.files_scanned}</b> files - <b>{scanResult.anime_episodes ?? scanResult.files_scanned}</b> episodes, <b>{scanResult.anime_found}</b> anime, <b>{scanResult.anime_enriched ?? 0}</b> enriched with AniList
            </>
          ) : (
            <>
              Escaneado: <b>{scanResult.files_scanned}</b> archivos - <b>{scanResult.anime_episodes ?? scanResult.files_scanned}</b> episodios, <b>{scanResult.anime_found}</b> anime, <b>{scanResult.anime_enriched ?? 0}</b> enriquecidos con AniList
            </>
          )}
        </div>
      )}

      {anime.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">{'>'}</div>
          <h2 className="empty-state-title">{isEnglish ? 'No anime yet' : 'Sin anime aun'}</h2>
          <p className="empty-state-desc">
            {isEnglish
              ? 'Add a folder to scan your local collection, or jump into online search when you want to watch immediately.'
              : 'Agrega una carpeta para escanear tu coleccion local, o entra al modo online si quieres ver algo al instante.'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
              {isEnglish ? '+ Add folder' : '+ Anadir carpeta'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowTorrent(true)} style={{ color: 'var(--accent)' }}>
              {isEnglish ? 'Download anime' : 'Descargar anime'}
            </button>
          </div>
        </div>
      ) : (
        <VirtualMediaGrid
          items={anime}
          virtualize
          itemContent={(item) => (
            <div key={item.id} className="media-card" onClick={() => navigate(`/anime/${item.id}`)}>
              {item.cover_image
                ? <BlurhashImage src={item.cover_image} blurhash={item.cover_blurhash} alt={item.display_title} imgClassName="media-card-cover" />
                : <div className="media-card-cover-placeholder">{isEnglish ? 'no cover' : 'sin portada'}</div>}
              <div className="media-card-overlay" />
              <div className="media-card-body">
                <div className="media-card-title">{item.display_title || (isEnglish ? 'Untitled' : 'Sin titulo')}</div>
                <div className="media-card-meta">
                  {item.year ? `${item.year} - ` : ''}
                  {item.episodes_total ? `${item.episodes_total} eps` : (isEnglish ? 'unknown eps' : 'eps desconocidos')}
                </div>
              </div>
            </div>
          )}
        />
      )}
    </div>
  )
}
