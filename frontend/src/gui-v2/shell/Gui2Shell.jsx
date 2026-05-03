import { NavLink } from 'react-router-dom'
import NipahLogo from './NipahLogo'
import { getGui2Navigation } from '../routeRegistry'
import { useI18n } from '../../lib/i18n'

function getActiveNavKey(routeMeta) {
  const canonical = routeMeta?.canonicalPath || ''
  if (canonical.startsWith('/anime/')) return 'local'
  if (canonical.startsWith('/manga/')) return 'local'
  return routeMeta?.key || 'home'
}

function ShellIcon({ kind }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  switch (kind) {
    case 'home':
      return <svg {...common}><path d="M2.5 7.4 8 2.8l5.5 4.6" /><path d="M4.2 6.8v6h7.6v-6.1" /></svg>
    case 'anime':
      return <svg {...common}><rect x="2.5" y="3.5" width="11" height="8.8" rx="1.4" /><path d="m6.5 5.9 3 2.1-3 2.1Z" fill="currentColor" stroke="none" /></svg>
    case 'manga':
      return <svg {...common}><path d="M4 3.2h3.4v9.4H4z" /><path d="M8.6 3.2H12v9.4H8.6z" /></svg>
    case 'local':
      return <svg {...common}><rect x="3" y="3" width="10" height="10" rx="1.6" /><path d="M5.5 5.6h5M5.5 8h5M5.5 10.4h3.2" /></svg>
    case 'lists':
      return <svg {...common}><path d="M5.6 4h6M5.6 8h6M5.6 12h6" /><circle cx="3.3" cy="4" r=".65" fill="currentColor" stroke="none" /><circle cx="3.3" cy="8" r=".65" fill="currentColor" stroke="none" /><circle cx="3.3" cy="12" r=".65" fill="currentColor" stroke="none" /></svg>
    case 'downloads':
      return <svg {...common}><path d="M8 2.8v6.4" /><path d="m5.4 7.9 2.6 2.7 2.6-2.7" /><path d="M3.2 12.4h9.6" /></svg>
    case 'history':
      return <svg {...common}><path d="M2.8 8A5.2 5.2 0 1 0 4 4.7" /><path d="M2.8 2.8v2.7h2.7" /><path d="M8 5.1v3.3l2.2 1.2" /></svg>
    case 'settings':
      return <svg {...common}><circle cx="8" cy="8" r="2.1" /><path d="M8 2.8v1.3M8 11.9v1.3M13.2 8h-1.3M4.1 8H2.8M11.7 4.3l-.9.9M5.2 10.8l-.9.9M11.7 11.7l-.9-.9M5.2 5.2l-.9-.9" /></svg>
    case 'sources':
      return <svg {...common}><path d="M3.1 6.2 8 3.2l4.9 3-4.9 3z" /><path d="M3.1 9.8 8 12.8l4.9-3" /></svg>
    case 'tools':
      return <svg {...common}><path d="m5 11 6-6" /><path d="m4.2 6 2-2a1.5 1.5 0 0 1 2.1 2.1l-2 2" /><path d="m7.7 8.3 2 2a1.5 1.5 0 1 1-2.1 2.1l-2-2" /></svg>
    case 'help':
      return <svg {...common}><circle cx="8" cy="8" r="5.4" /><path d="M6.6 6.2A1.6 1.6 0 1 1 8 8.7v1" /><path d="M8 11.7h.01" /></svg>
    default:
      return <svg {...common}><circle cx="8" cy="8" r="5.2" /></svg>
  }
}

export default function Gui2Shell({ routeMeta, preview, children }) {
  const { lang, setLang } = useI18n()
  const navigation = getGui2Navigation(preview, lang)
  const activeKey = getActiveNavKey(routeMeta)
  const isEnglish = lang === 'en'
  const nextLang = isEnglish ? 'es' : 'en'
  const handleLanguageToggle = () => {
    void setLang(nextLang)
  }

  return (
    <div className={`gui2-shell${preview ? ' gui2-shell-preview' : ''}`} data-route={routeMeta.key}>
      <aside className="gui2-sidebar">
        <div className="gui2-brand">
          <div className="gui2-brand-lockup">
            <div className="gui2-brand-mark" aria-hidden="true">
              <NipahLogo className="gui2-brand-logo" />
            </div>
            <div className="gui2-brand-copy">
              <div className="gui2-brand-word">
                <span className="gui2-brand-word-accent">Nipah!</span>
                <span className="gui2-brand-word-main">Anime</span>
              </div>
              <div className="gui2-brand-subword">ANIME</div>
            </div>
          </div>
          <div className="gui2-brand-version">v1.5.0</div>
        </div>

        <nav className="gui2-nav">
          <div className="gui2-nav-group">
            <div className="gui2-nav-heading">{navigation.headings.library}</div>
            {navigation.primary.map((item) => (
              <NavLink key={item.key} to={item.to} end={item.key === 'home'} className={() => `gui2-nav-link${activeKey === item.key ? ' active' : ''}`} title={item.label}>
                <span className="gui2-nav-icon"><ShellIcon kind={item.icon} /></span>
                <span className="gui2-nav-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
          <div className="gui2-nav-footer">
            <div className="gui2-nav-heading">{navigation.headings.system}</div>
            {navigation.secondary.map((item) => (
              <NavLink key={item.key} to={item.to} className={() => `gui2-nav-link${activeKey === item.key ? ' active' : ''}`} title={item.label}>
                <span className="gui2-nav-icon"><ShellIcon kind={item.icon} /></span>
                <span className="gui2-nav-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </aside>

      <div className="gui2-main">
        <header className="gui2-topbar">
          <div className="gui2-topbar-actions">
            <button type="button" className="gui2-icon-button" aria-label={isEnglish ? 'Notifications' : 'Notificaciones'}><ShellIcon kind="history" /></button>
            <button type="button" className="gui2-icon-button" aria-label={isEnglish ? 'Settings' : 'Ajustes'}><ShellIcon kind="settings" /></button>
            <button
              type="button"
              className="gui2-lang-button"
              aria-label={isEnglish ? 'Switch language to Spanish' : 'Cambiar idioma a ingles'}
              title={isEnglish ? 'Switch to Spanish' : 'Cambiar a ingles'}
              onClick={handleLanguageToggle}
            >
              {lang.toUpperCase()}
            </button>
            <button type="button" className="gui2-user-chip" aria-label={isEnglish ? 'Profile' : 'Perfil'}>
              <span className="gui2-user-avatar">N</span>
              <span className="gui2-user-name">Nico</span>
            </button>
          </div>
        </header>

        <main className="gui2-content">
          <div className="gui2-content-frame">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
