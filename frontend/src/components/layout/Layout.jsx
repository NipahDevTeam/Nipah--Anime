import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import NowPlaying from '../ui/NowPlaying'
import { ToastContainer, toastError } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'
import { wails } from '../../lib/wails'

function SidebarIcon({ kind }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  switch (kind) {
    case 'home':
      return <svg {...common}><path d="M2.5 7.2 8 2.8l5.5 4.4" /><path d="M4 6.8V13h8V6.8" /></svg>
    case 'anime':
      return <svg {...common}><circle cx="8" cy="8" r="5.5" /><path d="m6.8 5.9 3.1 2.1-3.1 2.1z" fill="currentColor" stroke="none" /></svg>
    case 'manga':
      return <svg {...common}><path d="M3.5 3.5h4.2v9H3.5z" /><path d="M8.3 3.5h4.2v9H8.3z" /><path d="M7.7 4.4h.6M7.7 11.6h.6" /></svg>
    case 'lists':
      return <svg {...common}><path d="M5.5 4h7" /><path d="M5.5 8h7" /><path d="M5.5 12h7" /><circle cx="3.2" cy="4" r=".7" fill="currentColor" stroke="none" /><circle cx="3.2" cy="8" r=".7" fill="currentColor" stroke="none" /><circle cx="3.2" cy="12" r=".7" fill="currentColor" stroke="none" /></svg>
    case 'download':
      return <svg {...common}><path d="M8 3.2v6.3" /><path d="m5.8 7.8 2.2 2.2 2.2-2.2" /><path d="M3.5 12.6h9" /></svg>
    case 'anime-online':
      return <svg {...common}><rect x="2.5" y="3.5" width="11" height="8" rx="1.8" /><path d="M6.8 6.1 9.9 8 6.8 9.9z" fill="currentColor" stroke="none" /></svg>
    case 'manga-online':
      return <svg {...common}><path d="M4 3.5h3.8v9H4z" /><path d="M8.2 3.5H12v9H8.2z" /><path d="M4 4.7c.9-.4 1.8-.6 2.7-.6" /><path d="M8.2 4.7c.9-.4 1.8-.6 2.7-.6" /></svg>
    case 'settings':
      return <svg {...common}><circle cx="8" cy="8" r="2.1" /><path d="M8 2.8v1.3M8 11.9v1.3M13.2 8h-1.3M4.1 8H2.8M11.7 4.3l-.9.9M5.2 10.8l-.9.9M11.7 11.7l-.9-.9M5.2 5.2l-.9-.9" /></svg>
    default:
      return <span style={{ fontSize: 12, fontWeight: 700 }}>{kind?.slice?.(0, 1) || '?'}</span>
  }
}

export default function Layout({ children }) {
  const location = useLocation()
  const { t, lang, setLang } = useI18n()
  const [updateInfo, setUpdateInfo] = useState(null)
  const [installingUpdate, setInstallingUpdate] = useState(false)

  const libraryItems = [
    { to: '/home', label: t('Inicio'), icon: 'home' },
    { to: '/anime', label: t('Anime'), icon: 'anime' },
    { to: '/manga', label: t('Manga'), icon: 'manga' },
    { to: '/mis-listas', label: t('Mis Listas'), icon: 'lists' },
    { to: '/descargas', label: t('Descargas'), icon: 'download' },
  ]

  const onlineItems = [
    { to: '/search', label: t('Anime online'), icon: 'anime-online' },
    { to: '/manga-online', label: t('Manga online'), icon: 'manga-online' },
  ]

  const settingsItems = [
    { to: '/settings', label: t('Ajustes'), icon: 'settings' },
  ]

  const allItems = [...libraryItems, ...onlineItems, ...settingsItems]
  const pageTitle = [...allItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => location.pathname.startsWith(item.to))?.label ?? 'Nipah!'

  const pageGroup = location.pathname.startsWith('/search') ||
    location.pathname.startsWith('/manga-online')
    ? (lang === 'en' ? 'Online' : 'Online')
    : (lang === 'en' ? 'Library' : 'Biblioteca')

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      if (typeof window.__nipahBootAt !== 'number') return
      console.info('[startup] layout ready', {
        route: location.pathname,
        sinceBootMs: Math.round(performance.now() - window.__nipahBootAt),
      })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [location.pathname])

  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      try {
        const info = await wails.checkForAppUpdate()
        if (!active) return
        if (info?.available) {
          setUpdateInfo(info)
        }
      } catch {
        // Update checks should never interrupt startup.
      }
    }, 2200)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])

  const publishedDate = updateInfo?.published_at
    ? new Date(updateInfo.published_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : ''

  return (
    <div className="app-layout">
      <div className="app-ambient app-ambient-left" aria-hidden="true" />
      <div className="app-ambient app-ambient-right" aria-hidden="true" />

      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-brand">
            <span className="sidebar-logo-mark">N!</span>
            <div className="sidebar-brand-copy">
              <div className="sidebar-brand-title">Nipah! Anime</div>
              <div className="sidebar-brand-subtitle">
                {lang === 'en' ? 'Watch, read, track' : 'Mira, lee, sigue'}
              </div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">{lang === 'en' ? 'Library' : 'Biblioteca'}</div>
          <div className="sidebar-nav-group">
            {libraryItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
              >
                <span className="nav-icon"><SidebarIcon kind={item.icon} /></span>
                <span className="sidebar-nav-text">{item.label}</span>
              </NavLink>
            ))}
          </div>

          <div className="sidebar-divider" />

          <div className="sidebar-section-label">{lang === 'en' ? 'Online' : 'Online'}</div>
          <div className="sidebar-nav-group">
            {onlineItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
              >
                <span className="nav-icon"><SidebarIcon kind={item.icon} /></span>
                <span className="sidebar-nav-text">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="sidebar-bottom">
          {settingsItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon"><SidebarIcon kind={item.icon} /></span>
              <span className="sidebar-nav-text">{item.label}</span>
            </NavLink>
          ))}

          <div className="sidebar-lang">
            <button
              className={`sidebar-lang-btn${lang === 'es' ? ' active' : ''}`}
              onClick={() => setLang('es')}
              title="Espanol"
              type="button"
            >
              ES
            </button>
            <button
              className={`sidebar-lang-btn${lang === 'en' ? ' active' : ''}`}
              onClick={() => setLang('en')}
              title="English"
              type="button"
            >
              EN
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-copy">
            <span className="topbar-kicker">{pageGroup}</span>
            <span className="topbar-title">{pageTitle}</span>
          </div>
          <div className="topbar-actions">
            <div className="topbar-chip">
              Nipah! Anime
            </div>
          </div>
        </header>

        <main className="app-content fade-in">
          <div className="app-content-inner">{children}</div>
        </main>

        {updateInfo && (
          <div className="update-modal-overlay">
            <div className="update-modal">
              <div className="update-modal-header">
                <div>
                  <div className="update-modal-kicker">
                    {lang === 'en' ? 'Update available' : 'Actualizacion disponible'}
                  </div>
                  <div className="update-modal-title">
                    {updateInfo.release_name || `v${updateInfo.latest_version}`}
                  </div>
                  <div className="update-modal-meta">
                    {lang === 'en'
                      ? `Current v${updateInfo.current_version} · Latest v${updateInfo.latest_version}${publishedDate ? ` · ${publishedDate}` : ''}`
                      : `Actual v${updateInfo.current_version} · Nueva v${updateInfo.latest_version}${publishedDate ? ` · ${publishedDate}` : ''}`}
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                  onClick={() => setUpdateInfo(null)}
                  type="button"
                >
                  {lang === 'en' ? 'Later' : 'Luego'}
                </button>
              </div>

              <div className="update-modal-body">
                <div className="update-modal-section-title">
                  {lang === 'en' ? 'Changelog' : 'Cambios'}
                </div>
                <pre className="update-modal-changelog">
                  {updateInfo.changelog?.trim() || (lang === 'en'
                    ? 'No changelog was provided in this release.'
                    : 'Esta version no incluye changelog en GitHub.')}
                </pre>
              </div>

              <div className="update-modal-actions">
                {!updateInfo.install_ready && (
                  <span className="update-modal-note">
                    {lang === 'en'
                      ? 'No Windows installer asset was found in this release.'
                      : 'No se encontro un instalador de Windows en esta version.'}
                  </span>
                )}
                <button
                  className="btn btn-primary"
                  disabled={installingUpdate || !updateInfo.install_ready}
                  onClick={async () => {
                    setInstallingUpdate(true)
                    try {
                      await wails.installLatestAppUpdate(
                        updateInfo.download_url,
                        updateInfo.asset_name,
                        updateInfo.latest_version,
                      )
                    } catch (error) {
                      toastError(`${lang === 'en' ? 'Update error' : 'Error al actualizar'}: ${error?.message ?? error}`)
                      setInstallingUpdate(false)
                    }
                  }}
                  type="button"
                >
                  {installingUpdate
                    ? (lang === 'en' ? 'Preparing installer...' : 'Preparando instalador...')
                    : (lang === 'en' ? 'Install update' : 'Instalar actualizacion')}
                </button>
              </div>
            </div>
          </div>
        )}

        <NowPlaying />
        <ToastContainer />
      </div>
    </div>
  )
}
