import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastSuccess, toastError } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '--'
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
          : <div className="dl-cover dl-cover-placeholder" />}
      </div>

      <div className="dl-info">
        <div className="dl-title">{item.anime_title}</div>
        <div className="dl-meta">
          {t('Episodio')} {item.episode_num}
          {item.episode_title && item.episode_title !== `Episodio ${item.episode_num}`
            ? ` - ${item.episode_title}` : ''}
        </div>
        {isActive && (
          <div className="dl-progress-bar">
            <div className="dl-progress-fill" style={{ width: `${item.progress ?? 0}%` }} />
          </div>
        )}
        <div className="dl-status-line">
          {isActive && (
            <span className="dl-status-text dl-status-active">
              {item.status === 'pending' ? t('Pendiente...') : `${Math.round(item.progress ?? 0)}% - ${formatSize(item.downloaded)} / ${formatSize(item.file_size)}`}
            </span>
          )}
          {isCompleted && (
            <span className="dl-status-text dl-status-done">
              Ready - {t('Completado')} - {formatSize(item.file_size)}
            </span>
          )}
          {isFailed && (
            <span className="dl-status-text dl-status-failed">
              Error - {item.error_msg || t('Error')}
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
            Play
          </button>
        )}
        {isActive && (
          <button className="btn btn-ghost btn-sm" onClick={() => onCancel(item.id)}>
            X
          </button>
        )}
        {!isActive && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onRemove(item.id)}
            style={{ color: 'var(--text-muted)' }}
          >
            Remove
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
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const isEnglish = lang === 'en'
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
    pollRef.current = setInterval(() => {
      wails.getDownloads().then((items) => {
        if (items) setDownloads(items)
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(pollRef.current)
  }, [load])

  const handlePlay = useCallback(async (id) => {
    try {
      await wails.playDownloadedEpisode(id)
      toastSuccess(t('Abriendo en MPV...'))
    } catch (error) {
      toastError(error?.message ?? t('Error'))
    }
  }, [t])

  const handleCancel = useCallback(async (id) => {
    try {
      await wails.cancelDownload(id)
      load()
    } catch (error) {
      toastError(error?.message ?? t('Error'))
    }
  }, [load, t])

  const handleRemove = useCallback(async (id) => {
    try {
      await wails.removeDownload(id, false)
      load()
    } catch (error) {
      toastError(error?.message ?? t('Error'))
    }
  }, [load, t])

  const activeCount = downloads.filter((item) => item.status === 'downloading' || item.status === 'pending').length
  const completedCount = downloads.filter((item) => item.status === 'completed').length
  const failedCount = downloads.filter((item) => item.status === 'failed').length

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
    <div className={`fade-in downloads-page${embedded ? ' local-section-embedded' : ''}`}>
      <section className="gui2-page-hero">
        <div>
          <div className="gui2-eyebrow">{isEnglish ? 'Queue and archive' : 'Cola y archivo'}</div>
          <h1 className="gui2-page-title">{isEnglish ? 'Downloads' : 'Descargas'}</h1>
          <p className="gui2-page-copy">
            {isEnglish
              ? 'Keep active transfers, ready episodes, and the local download folder in one broad desktop queue.'
              : 'Reune transferencias activas, episodios listos y la carpeta de descargas en una sola cola amplia de escritorio.'}
          </p>
        </div>
        <div className="gui2-action-row">
          {dlDir ? <button type="button" className="btn btn-ghost">{dlDir}</button> : null}
          <button type="button" className="btn btn-primary" onClick={() => navigate('/anime-online')}>
            {isEnglish ? 'Browse Anime Online' : 'Abrir Anime Online'}
          </button>
        </div>
      </section>

      <section className="settings-overview-strip">
        <article className="settings-overview-card">
          <span className="settings-overview-label">{isEnglish ? 'Active' : 'Activas'}</span>
          <strong className="settings-overview-value">{activeCount}</strong>
          <p className="settings-overview-copy">{isEnglish ? 'Current transfers still moving through the queue.' : 'Transferencias que siguen moviendose dentro de la cola.'}</p>
        </article>
        <article className="settings-overview-card">
          <span className="settings-overview-label">{isEnglish ? 'Ready' : 'Listas'}</span>
          <strong className="settings-overview-value">{completedCount}</strong>
          <p className="settings-overview-copy">{isEnglish ? 'Episodes already downloaded and ready to open.' : 'Episodios descargados y listos para abrir.'}</p>
        </article>
        <article className="settings-overview-card">
          <span className="settings-overview-label">{isEnglish ? 'Needs attention' : 'Pendientes'}</span>
          <strong className="settings-overview-value">{failedCount}</strong>
          <p className="settings-overview-copy">{isEnglish ? 'Failures stay visible so the queue never feels hidden.' : 'Los fallos quedan visibles para que la cola nunca se sienta escondida.'}</p>
        </article>
      </section>

      {downloads.length > 0 && (
        <div className="dl-stats">
          {activeCount > 0 && (
            <span className="dl-stat-badge dl-stat-active">
              Active: {activeCount} {t('en progreso')}
            </span>
          )}
          {completedCount > 0 && (
            <span className="dl-stat-badge dl-stat-done">
              Ready: {completedCount} {t('completados')}
            </span>
          )}
        </div>
      )}

      {downloads.length === 0 ? (
        <section className="gui2-table-shell">
          <div className="empty-state">
            <div className="empty-state-icon">↓</div>
            <h3 className="empty-state-title">{isEnglish ? 'Queue is clear' : t('Sin descargas')}</h3>
            <p className="empty-state-desc">{t('dl_empty_desc')}</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/anime-online')}>
              {isEnglish ? 'Find something to download' : 'Buscar algo para descargar'}
            </button>
          </div>
        </section>
      ) : (
        <div className="dl-list">
          {downloads.map((item) => (
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
