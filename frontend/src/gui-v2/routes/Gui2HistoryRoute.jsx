import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildAnimeNavigationState } from '../../lib/mediaNavigation'
import { proxyImage, wails } from '../../lib/wails'
import { useI18n } from '../../lib/i18n'
import { toastError, toastSuccess } from '../../components/ui/Toast'

export default function Gui2HistoryRoute({ preview = false }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { lang } = useI18n()
  const isEnglish = lang === 'en'

  const historyQuery = useQuery({
    queryKey: ['gui2-watch-history'],
    queryFn: async () => wails.getWatchHistory(60),
    staleTime: 10_000,
  })

  const history = historyQuery.data ?? []
  const toSearch = useCallback((item) => {
    const fallbackSourceID = isEnglish ? 'animeheaven-en' : 'animeav1-es'
    navigate(preview ? '/__rebuild/anime-online' : '/anime-online', {
      state: buildAnimeNavigationState(item, fallbackSourceID),
    })
  }, [isEnglish, navigate, preview])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['gui2-watch-history'] })
  }, [queryClient])

  const handleRemove = useCallback(async (item) => {
    try {
      await wails.removeAnimeFromHistory(item.source_id, item.anime_id)
      toastSuccess(isEnglish ? 'History item removed.' : 'History item removed.')
      refresh()
    } catch (error) {
      toastError(`${isEnglish ? 'Could not remove item' : 'Could not remove item'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refresh])

  const handleClear = useCallback(async () => {
    try {
      await wails.clearWatchHistory()
      toastSuccess(isEnglish ? 'History cleared.' : 'History cleared.')
      refresh()
    } catch (error) {
      toastError(`${isEnglish ? 'Could not clear history' : 'Could not clear history'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refresh])

  return (
    <div className="gui2-stack-page">
      <section className="gui2-page-hero">
        <div>
          <div className="gui2-eyebrow">{isEnglish ? 'Playback history' : 'Historial de reproduccion'}</div>
          <h1 className="gui2-page-title">{isEnglish ? 'History' : 'Historial'}</h1>
          <p className="gui2-page-copy">
            {isEnglish
              ? 'Keep recent sessions close so resuming an episode feels instant from the desktop shell.'
              : 'Mantiene tus sesiones recientes cerca para retomar un episodio al instante desde el shell de escritorio.'}
          </p>
        </div>
        <div className="gui2-action-row">
          <button type="button" className="btn btn-ghost" onClick={() => refresh()}>{isEnglish ? 'Refresh' : 'Actualizar'}</button>
          <button type="button" className="btn btn-primary" onClick={handleClear} disabled={history.length === 0}>{isEnglish ? 'Clear History' : 'Limpiar historial'}</button>
        </div>
      </section>

      <section className="gui2-table-shell">
        <div className="gui2-table-header gui2-table-header-history">
          <span>{isEnglish ? 'Title' : 'Title'}</span>
          <span>{isEnglish ? 'Episode' : 'Episode'}</span>
          <span>{isEnglish ? 'Source' : 'Source'}</span>
          <span>{isEnglish ? 'Actions' : 'Actions'}</span>
        </div>
        <div className="gui2-table-body">
          {history.map((item) => (
            <div key={`${item.source_id}-${item.episode_id}`} className="gui2-history-row">
              <button type="button" className="gui2-history-card" onClick={() => toSearch(item)}>
                <div className="gui2-history-thumb">
                  {item.cover_url ? <img src={proxyImage(item.cover_url)} alt={item.anime_title} className="gui2-history-thumb-image" /> : null}
                </div>
                <div className="gui2-history-copy">
                  <strong>{item.anime_title}</strong>
                  <span>{item.watched_at ? new Date(item.watched_at).toLocaleDateString() : ''}</span>
                </div>
              </button>
              <div className="gui2-table-cell">{item.episode_title || `${isEnglish ? 'Episode' : 'Episode'} ${item.episode_num ?? '?'}`}</div>
              <div className="gui2-table-cell">{item.source_name || item.source_id}</div>
              <div className="gui2-table-actions">
                <button type="button" className="btn btn-ghost" onClick={() => toSearch(item)}>{isEnglish ? 'Resume' : 'Resume'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => handleRemove(item)}>{isEnglish ? 'Remove' : 'Remove'}</button>
              </div>
            </div>
          ))}
          {history.length === 0 ? (
            <div className="empty-state">
              <h2 className="empty-state-title">{isEnglish ? 'No history yet' : 'Todavia no hay historial'}</h2>
              <p className="empty-state-desc">
                {isEnglish ? 'Recent sessions will appear here once playback starts.' : 'Las sesiones recientes apareceran aqui una vez que empiece la reproduccion.'}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
