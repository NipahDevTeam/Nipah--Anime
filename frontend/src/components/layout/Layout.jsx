import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import NowPlaying from '../ui/NowPlaying'
import { ToastContainer, toastError } from '../ui/Toast'
import { useI18n } from '../../lib/i18n'
import { wails } from '../../lib/wails'

export default function Layout({ children }) {
  const location = useLocation()
  const { t, lang, setLang } = useI18n()
  const [updateInfo, setUpdateInfo] = useState(null)
  const [installingUpdate, setInstallingUpdate] = useState(false)

  const libraryItems = [
    { to: '/home', label: t('Inicio'), icon: '⌂' },
    { to: '/anime', label: t('Anime'), icon: '▶' },
    { to: '/manga', label: t('Manga'), icon: '▥' },
    { to: '/mis-listas', label: t('Mis Listas'), icon: '☰' },
    { to: '/descargas', label: t('Descargas'), icon: '⬇' },
  ]

  const onlineItems = [
    { to: '/descubrir', label: t('Descubrir'), icon: '✦' },
    { to: '/search', label: t('Anime online'), icon: '◉' },
    { to: '/manga-online', label: t('Manga online'), icon: '▣' },
  ]

  const settingsItems = [
    { to: '/settings', label: t('Ajustes'), icon: '⚙' },
  ]

  const allItems = [...libraryItems, ...onlineItems, ...settingsItems]
  const pageTitle = [...allItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => location.pathname.startsWith(item.to))?.label ?? 'Nipah!'

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
        // Silent on startup: update checks should never interrupt app launch.
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
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-logo-mark">N!</span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav-group">
            {libraryItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
                data-tooltip={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
              </NavLink>
            ))}
          </div>

          <div className="sidebar-divider" />

          <div className="sidebar-nav-group">
            {onlineItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
                data-tooltip={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
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
              data-tooltip={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
            </NavLink>
          ))}

          <div className="sidebar-lang">
            <button
              className={`sidebar-lang-btn${lang === 'es' ? ' active' : ''}`}
              onClick={() => setLang('es')}
              title="Español"
            >
              ES
            </button>
            <button
              className={`sidebar-lang-btn${lang === 'en' ? ' active' : ''}`}
              onClick={() => setLang('en')}
              title="English"
            >
              EN
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <span className="topbar-title">{pageTitle}</span>
        </header>
        <main className="app-content fade-in">{children}</main>
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
                      await wails.installLatestAppUpdate(updateInfo.download_url, updateInfo.asset_name)
                    } catch (error) {
                      toastError(`${lang === 'en' ? 'Update error' : 'Error al actualizar'}: ${error?.message ?? error}`)
                      setInstallingUpdate(false)
                    }
                  }}
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
