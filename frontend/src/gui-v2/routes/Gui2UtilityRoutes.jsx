import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../lib/i18n'
import { toastError, toastSuccess } from '../../components/ui/Toast'
import { wails } from '../../lib/wails'
import { MANGA_SOURCE_OPTIONS } from '../../lib/mangaSources'

export function Gui2SourcesRoute() {
  const providerCards = useMemo(() => ([
    { title: 'JKAnime', type: 'Anime', detail: 'Spanish anime source used by online playback flows.' },
    { title: 'AnimeFLV', type: 'Anime', detail: 'Alternate Spanish anime source for catalog and streaming.' },
    { title: 'AnimeAV1', type: 'Anime', detail: 'Fallback anime source for broader lookup coverage.' },
    { title: 'AnimePahe', type: 'Anime', detail: 'English anime source kept available for source switching.' },
    { title: 'AnimeHeaven', type: 'Anime', detail: 'English streaming source preserved in the rebuild shell.' },
    { title: 'AnimeGG', type: 'Anime', detail: 'Anime source kept for search and provider fallback.' },
    ...MANGA_SOURCE_OPTIONS.map((item) => ({ title: item.label, type: 'Manga', detail: `Manga provider id: ${item.value}` })),
  ]), [])

  return (
    <div className="gui2-stack-page">
      <section className="gui2-page-hero">
        <div>
          <div className="gui2-eyebrow">Providers</div>
          <h1 className="gui2-page-title">Sources</h1>
          <p className="gui2-page-copy">A board-aligned control surface for the provider families preserved by the rebuild.</p>
        </div>
      </section>
      <div className="gui2-card-grid gui2-card-grid-three">
        {providerCards.map((item) => (
          <article key={`${item.type}-${item.title}`} className="gui2-info-card">
            <div className="gui2-info-card-kicker">{item.type}</div>
            <h2 className="gui2-info-card-title">{item.title}</h2>
            <p className="gui2-info-card-copy">{item.detail}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

export function Gui2ToolsRoute() {
  const { lang } = useI18n()
  const isEnglish = lang === 'en'
  const [scanning, setScanning] = useState(false)
  const [checking, setChecking] = useState(false)

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await wails.scanWithPicker()
      if (!result?.cancelled) {
        toastSuccess(isEnglish ? `Scanned ${result.files_scanned || 0} files.` : `Scanned ${result.files_scanned || 0} files.`)
      }
    } catch (error) {
      toastError(`${isEnglish ? 'Scan failed' : 'Scan failed'}: ${error?.message ?? error}`)
    } finally {
      setScanning(false)
    }
  }, [isEnglish])

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true)
    try {
      const update = await wails.checkForAppUpdate()
      if (update?.available) {
        toastSuccess(isEnglish ? `Update available: v${update.latest_version}` : `Update available: v${update.latest_version}`)
      } else {
        toastSuccess(isEnglish ? 'App is already up to date.' : 'App is already up to date.')
      }
    } catch (error) {
      toastError(`${isEnglish ? 'Update check failed' : 'Update check failed'}: ${error?.message ?? error}`)
    } finally {
      setChecking(false)
    }
  }, [isEnglish])

  return (
    <div className="gui2-stack-page">
      <section className="gui2-page-hero">
        <div>
          <div className="gui2-eyebrow">Desktop actions</div>
          <h1 className="gui2-page-title">Tools</h1>
          <p className="gui2-page-copy">Direct desktop actions kept visible in the new shell instead of being buried in rescue layers.</p>
        </div>
      </section>
      <div className="gui2-card-grid gui2-card-grid-two">
        <article className="gui2-info-card">
          <div className="gui2-info-card-kicker">Library</div>
          <h2 className="gui2-info-card-title">Scan Media</h2>
          <p className="gui2-info-card-copy">Open the native folder picker and scan new local media into the library.</p>
          <div className="gui2-action-row">
            <button type="button" className="btn btn-primary" onClick={handleScan} disabled={scanning}>{scanning ? 'Scanning...' : 'Scan Library'}</button>
          </div>
        </article>
        <article className="gui2-info-card">
          <div className="gui2-info-card-kicker">Release</div>
          <h2 className="gui2-info-card-title">Check Updates</h2>
          <p className="gui2-info-card-copy">Trigger the release check without opening the old settings card stack.</p>
          <div className="gui2-action-row">
            <button type="button" className="btn btn-primary" onClick={handleCheckUpdate} disabled={checking}>{checking ? 'Checking...' : 'Check Now'}</button>
          </div>
        </article>
      </div>
    </div>
  )
}

export function Gui2HelpRoute() {
  return (
    <div className="gui2-stack-page">
      <section className="gui2-page-hero">
        <div>
          <div className="gui2-eyebrow">Support</div>
          <h1 className="gui2-page-title">Help</h1>
          <p className="gui2-page-copy">A compact guide to the rebuilt desktop shell and the main media workflows it preserves.</p>
        </div>
      </section>
      <div className="gui2-card-grid gui2-card-grid-two">
        <article className="gui2-info-card">
          <div className="gui2-info-card-kicker">Playback</div>
          <h2 className="gui2-info-card-title">Anime and video</h2>
          <p className="gui2-info-card-copy">Use Anime Online for provider-backed playback, Local Library for stored episodes, and History to resume recent sessions quickly.</p>
        </article>
        <article className="gui2-info-card">
          <div className="gui2-info-card-kicker">Reading</div>
          <h2 className="gui2-info-card-title">Manga and sync</h2>
          <p className="gui2-info-card-copy">Use Manga Online for source-backed chapters, My Lists for status management, and Settings for sync and reader defaults.</p>
        </article>
      </div>
    </div>
  )
}

export function Gui2SettingsSupportRail() {
  const authQuery = useQuery({
    queryKey: ['gui2-auth-status'],
    queryFn: async () => wails.getAuthStatus(),
    staleTime: 30_000,
  })

  const syncQuery = useQuery({
    queryKey: ['gui2-sync-status'],
    queryFn: async () => wails.getRemoteListSyncStatus(),
    staleTime: 30_000,
  })

  const auth = authQuery.data ?? { anilist: { logged_in: false }, mal: { logged_in: false } }
  const sync = syncQuery.data ?? { pending_count: 0, failed_count: 0 }

  return (
    <section className="gui2-side-rail">
      <article className="gui2-side-card">
        <div className="gui2-side-card-title">Connected Services</div>
        <div className="gui2-side-kv"><span>AniList</span><strong>{auth.anilist?.logged_in ? 'Connected' : 'Idle'}</strong></div>
        <div className="gui2-side-kv"><span>Pending Sync</span><strong>{sync.pending_count ?? 0}</strong></div>
        <div className="gui2-side-kv"><span>Failed Sync</span><strong>{sync.failed_count ?? 0}</strong></div>
      </article>
    </section>
  )
}
