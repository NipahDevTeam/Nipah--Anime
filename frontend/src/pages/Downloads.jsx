import { useState, useEffect, useCallback, useRef } from 'react'
import { wails } from '../lib/wails'
import { toastSuccess, toastError } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function DownloadRow({ item, onPlay, onCancel, onRemove }) {
  const { t } = useI18n()
  const isActive = item.status === 'downloading' || item.status === 'pending'
  const isCompleted = item.status === 'completed'
  const isFailed = item.status === 'failed'

  return (
    <div className={`dl-row ${item.status}`}>
      <div className="dl-cover-wrap">
        {item.cover_url
          ? <img src={item.cover_url} alt={item.anime_title} className="dl-cover" />
          : <div className="dl-cover dl-cover-placeholder" />
        }
      </div>

      <div className="dl-info">
        <div className="dl-title">{item.anime_title}</div>
        <div className="dl-meta">
          {t('Episodio')} {item.episode_num}
          {item.episode_title && item.episode_title !== `Episodio ${item.episode_num}`
            ? ` — ${item.episode_title}` : ''}
        </div>
        {isActive && (
          <div className="dl-progress-bar">
            <div className="dl-progress-fill" style={{ width: `${item.progress ?? 0}%` }} />
          </div>
        )}
        <div className="dl-status-line">
          {isActive && (
            <span className="dl-status-text dl-status-active">
              {item.status === 'pending' ? t('Pendiente...') : `${Math.round(item.progress ?? 0)}% · ${formatSize(item.downloaded)} / ${formatSize(item.file_size)}`}
            </span>
          )}
          {isCompleted && (
            <span className="dl-status-text dl-status-done">
              ✓ {t('Completado')} · {formatSize(item.file_size)}
            </span>
          )}
          {isFailed && (
            <span className="dl-status-text dl-status-failed">
              ✗ {item.error_msg || t('Error')}
            </span>
          )}
          {item.status === 'cancelled' && (
            <span className="dl-status-text dl-status-cancelled">{t('Cancelado')}</span>
          )}
        </div>
      </div>

      <div className="dl-actions">
        {isCompleted && (
          <button className="btn btn-primary btn-sm" onClick={() => onPlay(item.id)}>
            ▶ {t('Ver')}
          </button>
        )}
        {isActive && (
          <button className="btn btn-ghost btn-sm" onClick={() => onCancel(item.id)}>
            ✕
          </button>
        )}
        {!isActive && (
          <button className="btn btn-ghost btn-sm" onClick={() => onRemove(item.id)}
            style={{ color: 'var(--text-muted)' }}>
            🗑
          </button>
        )}
      </div>
    </div>
  )
}

export default function Downloads({ embedded = false }) {
  const [downloads, setDownloads] = useState([])
  const [loading, setLoading] = useState(true)
  const [dlDir, setDlDir] = useState('')
  const { t } = useI18n()
  const pollRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const [items, dir] = await Promise.all([
        wails.getDownloads(),
        wails.getDownloadDir(),
      ])
      setDownloads(items ?? [])
      setDlDir(dir ?? '')
    } catch {
      setDownloads([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Poll for progress updates while downloads are active
    pollRef.current = setInterval(() => {
      wails.getDownloads().then(items => {
        if (items) setDownloads(items)
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(pollRef.current)
  }, [load])

  const handlePlay = useCallback(async (id) => {
    try {
      await wails.playDownloadedEpisode(id)
      toastSuccess(t('Abriendo en MPV…'))
    } catch (e) {
      toastError(e?.message ?? t('Error'))
    }
  }, [t])

  const handleCancel = useCallback(async (id) => {
    try {
      await wails.cancelDownload(id)
      load()
    } catch (e) {
      toastError(e?.message ?? t('Error'))
    }
  }, [load, t])

  const handleRemove = useCallback(async (id) => {
    try {
      await wails.removeDownload(id, false)
      load()
    } catch (e) {
      toastError(e?.message ?? t('Error'))
    }
  }, [load, t])

  const activeCount = downloads.filter(d => d.status === 'downloading' || d.status === 'pending').length
  const completedCount = downloads.filter(d => d.status === 'completed').length

  if (loading) return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )

  return (
    <div className={`fade-in downloads-page${embedded ? ' local-section-embedded' : ''}`}>
      <div className="dl-header">
        <h2 className="page-title">{t('Descargas')}</h2>
        {dlDir && (
          <div className="dl-dir-info">
            📁 {dlDir}
          </div>
        )}
      </div>

      {/* Stats */}
      {downloads.length > 0 && (
        <div className="dl-stats">
          {activeCount > 0 && (
            <span className="dl-stat-badge dl-stat-active">
              ⬇ {activeCount} {t('en progreso')}
            </span>
          )}
          {completedCount > 0 && (
            <span className="dl-stat-badge dl-stat-done">
              ✓ {completedCount} {t('completados')}
            </span>
          )}
        </div>
      )}

      {/* List */}
      {downloads.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 60 }}>
          <div className="empty-state-icon">⬇</div>
          <h3 className="empty-state-title">{t('Sin descargas')}</h3>
          <p className="empty-state-desc">
            {t('dl_empty_desc')}
          </p>
        </div>
      ) : (
        <div className="dl-list">
          {downloads.map(item => (
            <DownloadRow
              key={item.id}
              item={item}
              onPlay={handlePlay}
              onCancel={handleCancel}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
