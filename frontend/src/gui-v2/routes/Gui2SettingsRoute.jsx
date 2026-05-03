import { useCallback, useEffect, useMemo, useState } from 'react'
import { toastError, toastSuccess } from '../../components/ui/Toast'
import { useI18n } from '../../lib/i18n'
import { wails } from '../../lib/wails'
import {
  getSavedReaderSettings,
  normalizeReaderSettings,
  saveReaderSettings,
} from '../../components/ui/mangaReaderLayout'

function SettingsIcon({ kind }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 18 18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  switch (kind) {
    case 'playback':
      return <svg {...common}><rect x="2.8" y="3.2" width="12.4" height="11.6" rx="1.6" /><path d="m7.2 6.6 4.2 2.2-4.2 2.2z" fill="currentColor" stroke="none" /></svg>
    case 'library':
      return <svg {...common}><path d="M2.6 5.2h4.6l1.2 1.6h7v6.4H2.6z" /><path d="M2.6 5.2V4.4h4.5" /></svg>
    case 'sync':
      return <svg {...common}><path d="M6 12.5A3.7 3.7 0 1 1 6.7 5.2a4.5 4.5 0 0 1 8.1 2.3A2.7 2.7 0 0 1 14 12.7H6.8" /><path d="m7.3 10.6 1.9 1.9 1.9-1.9" /><path d="M9.2 7.8v4.5" /></svg>
    case 'updates':
      return <svg {...common}><path d="M9 2.8v7.5" /><path d="m5.9 7.8 3.1 3.1 3.1-3.1" /><path d="M3.2 14.2h11.6" /></svg>
    case 'general':
      return <svg {...common}><circle cx="9" cy="9" r="2.2" /><path d="M9 2.9v1.5M9 13.6v1.5M15.1 9h-1.5M4.4 9H2.9M13.2 4.8l-1 1M5.8 12.2l-1 1M13.2 13.2l-1-1M5.8 5.8l-1-1" /></svg>
    case 'reading':
      return <svg {...common}><path d="M4.2 3.2h4.2v11.6H4.2z" /><path d="M9.6 3.2h4.2v11.6H9.6z" /></svg>
    case 'accounts':
      return <svg {...common}><circle cx="9" cy="6.2" r="2.3" /><path d="M4.4 14.2c.9-2 2.6-3.1 4.6-3.1s3.7 1.1 4.6 3.1" /></svg>
    default:
      return <svg {...common}><circle cx="9" cy="9" r="6" /></svg>
  }
}

function SettingsSectionButton({ active, icon, label, onClick }) {
  return (
    <button
      type="button"
      className={`gui2-settingsv2-nav-btn${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <span className="gui2-settingsv2-nav-icon"><SettingsIcon kind={icon} /></span>
      <span>{label}</span>
    </button>
  )
}

function SettingsSelect({ value, onChange, options }) {
  return (
    <label className="gui2-settingsv2-select-shell">
      <select value={value} onChange={(event) => onChange(event.target.value)} className="gui2-settingsv2-select">
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function SettingsToggle({ checked, onChange }) {
  return (
    <label className="gui2-settingsv2-switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="gui2-settingsv2-switch-track" />
    </label>
  )
}

function SettingsRow({ title, description, children, stacked = false }) {
  return (
    <div className={`gui2-settingsv2-row${stacked ? ' is-stacked' : ''}`}>
      <div className="gui2-settingsv2-row-copy">
        <div className="gui2-settingsv2-row-title">{title}</div>
        {description ? <div className="gui2-settingsv2-row-description">{description}</div> : null}
      </div>
      <div className="gui2-settingsv2-row-control">
        {children}
      </div>
    </div>
  )
}

function SettingsGroup({ id, title, children }) {
  return (
    <section id={id} className="gui2-settingsv2-group">
      <div className="gui2-settingsv2-group-title">{title}</div>
      <div className="gui2-settingsv2-group-body">{children}</div>
    </section>
  )
}

function SettingsOverviewCard({ icon, label, value, accent }) {
  return (
    <article className="gui2-settingsv2-overview-card">
      <div className="gui2-settingsv2-overview-icon"><SettingsIcon kind={icon} /></div>
      <div className="gui2-settingsv2-overview-copy">
        <div className="gui2-settingsv2-overview-label">{label}</div>
        <div className={`gui2-settingsv2-overview-value${accent ? ` ${accent}` : ''}`}>{value}</div>
      </div>
    </article>
  )
}

export default function Gui2SettingsRoute() {
  const { lang, setLang } = useI18n()
  const isEnglish = lang === 'en'
  const [settings, setSettings] = useState(null)
  const [readerSettings, setReaderSettings] = useState(() => getSavedReaderSettings())
  const [mpvOk, setMpvOk] = useState(true)
  const [libPaths, setLibPaths] = useState([])
  const [animeImportDir, setAnimeImportDir] = useState('')
  const [libraryStats, setLibraryStats] = useState({ anime: 0, manga: 0, episodes: 0, chapters: 0 })
  const [authStatus, setAuthStatus] = useState({ anilist: { logged_in: false } })
  const [remoteSyncStatus, setRemoteSyncStatus] = useState({ pending_count: 0, failed_count: 0, by_provider: {}, errors: [] })
  const [updateStatus, setUpdateStatus] = useState({ state: 'idle', label: isEnglish ? 'Checking not started' : 'Sin revisar' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [activeNav, setActiveNav] = useState('general')

  const refreshRemoteSyncStatus = useCallback(() => {
    return wails.getRemoteListSyncStatus()
      .then((status) => {
        setRemoteSyncStatus(status ?? { pending_count: 0, failed_count: 0, by_provider: {}, errors: [] })
      })
      .catch(() => {})
  }, [])

  const refreshAuth = useCallback(() => {
    return wails.getAuthStatus()
      .then((status) => {
        setAuthStatus(status ?? { anilist: { logged_in: false } })
      })
      .catch(() => {})
  }, [])

  const refreshLibraryStats = useCallback(() => {
    return Promise.all([wails.getLibraryPaths(), wails.getAnimeImportDir(), wails.getLibraryStats()])
      .then(([paths, importDir, stats]) => {
        setLibPaths(paths ?? [])
        setAnimeImportDir(importDir ?? '')
        setLibraryStats(stats ?? { anime: 0, manga: 0, episodes: 0, chapters: 0 })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      wails.getSettings(),
      wails.isMPVAvailable(),
      wails.getLibraryPaths(),
      wails.getAnimeImportDir(),
      wails.getLibraryStats(),
      wails.getAuthStatus(),
      wails.getRemoteListSyncStatus(),
    ])
      .then(([rawSettings, mpvAvailable, paths, importDir, stats, auth, remoteStatus]) => {
        if (!active) return
        setSettings({ ...rawSettings, theme: 'dark' })
        setReaderSettings(getSavedReaderSettings())
        setMpvOk(Boolean(mpvAvailable))
        setLibPaths(paths ?? [])
        setAnimeImportDir(importDir ?? '')
        setLibraryStats(stats ?? { anime: 0, manga: 0, episodes: 0, chapters: 0 })
        setAuthStatus(auth ?? { anilist: { logged_in: false } })
        setRemoteSyncStatus(remoteStatus ?? { pending_count: 0, failed_count: 0, by_provider: {}, errors: [] })
      })
      .catch(() => {
        if (!active) return
        toastError(isEnglish ? 'Could not load settings.' : 'No se pudieron cargar los ajustes.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [isEnglish])

  const setSetting = useCallback((key, value) => {
    setSettings((current) => (current ? { ...current, [key]: String(value) } : current))
  }, [])

  const setReaderSetting = useCallback((key, value) => {
    setReaderSettings((current) => normalizeReaderSettings({ ...current, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!settings) return
    setSaving(true)
    try {
      await wails.saveSettings({ ...settings, theme: 'dark' })
      if (settings.language === 'en' || settings.language === 'es') {
        await setLang(settings.language)
      }
      saveReaderSettings(readerSettings)
      const ok = await wails.isMPVAvailable()
      setMpvOk(Boolean(ok))
      toastSuccess(isEnglish ? 'Settings saved.' : 'Ajustes guardados.')
    } catch (error) {
      toastError(`${isEnglish ? 'Could not save settings' : 'No se pudieron guardar los ajustes'}: ${error?.message ?? error}`)
    } finally {
      setSaving(false)
    }
  }, [isEnglish, readerSettings, setLang, settings])

  const handleChooseImportDir = useCallback(async () => {
    try {
      const path = await wails.pickFolder()
      if (!path) return
      await wails.setAnimeImportDir(path)
      setAnimeImportDir(path)
      setSettings((current) => (current ? { ...current, anime_import_path: path } : current))
      await refreshLibraryStats()
      toastSuccess(isEnglish ? 'Library folder updated.' : 'Carpeta de biblioteca actualizada.')
    } catch (error) {
      toastError(`${isEnglish ? 'Could not update the folder' : 'No se pudo actualizar la carpeta'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refreshLibraryStats])

  const handleScanWithPicker = useCallback(async () => {
    try {
      const result = await wails.scanWithPicker()
      if (result?.cancelled) return
      await refreshLibraryStats()
      toastSuccess(
        isEnglish
          ? `Scanned ${result?.files_scanned ?? 0} files.`
          : `Se escanearon ${result?.files_scanned ?? 0} archivos.`,
      )
    } catch (error) {
      toastError(`${isEnglish ? 'Library scan failed' : 'Falló el escaneo de biblioteca'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refreshLibraryStats])

  const handleRemoveLibraryPath = useCallback(async (id) => {
    try {
      await wails.removeLibraryPath(id)
      await refreshLibraryStats()
      toastSuccess(isEnglish ? 'Folder removed.' : 'Carpeta eliminada.')
    } catch (error) {
      toastError(`${isEnglish ? 'Could not remove the folder' : 'No se pudo eliminar la carpeta'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refreshLibraryStats])

  const handleAniListConnect = useCallback(async () => {
    try {
      await wails.loginAniList()
      await refreshAuth()
      await refreshRemoteSyncStatus()
      toastSuccess(isEnglish ? 'AniList connected.' : 'AniList conectado.')
    } catch (error) {
      toastError(`${isEnglish ? 'AniList connection failed' : 'Falló la conexión con AniList'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refreshAuth, refreshRemoteSyncStatus])

  const handleAniListDisconnect = useCallback(async () => {
    try {
      await wails.logout('anilist')
      await refreshAuth()
      await refreshRemoteSyncStatus()
      toastSuccess(isEnglish ? 'AniList disconnected.' : 'AniList desconectado.')
    } catch (error) {
      toastError(`${isEnglish ? 'AniList disconnect failed' : 'No se pudo desconectar AniList'}: ${error?.message ?? error}`)
    }
  }, [isEnglish, refreshAuth, refreshRemoteSyncStatus])

  const handleAniListSync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await wails.syncAniListLists()
      await refreshRemoteSyncStatus()
      toastSuccess(
        isEnglish
          ? `Synced ${result?.anime_count ?? 0} anime and ${result?.manga_count ?? 0} manga.`
          : `Se sincronizaron ${result?.anime_count ?? 0} anime y ${result?.manga_count ?? 0} manga.`,
      )
    } catch (error) {
      toastError(`${isEnglish ? 'AniList sync failed' : 'Falló la sincronización con AniList'}: ${error?.message ?? error}`)
    } finally {
      setSyncing(false)
    }
  }, [isEnglish, refreshRemoteSyncStatus])

  const handleRetryAniListSync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await wails.retryRemoteListSync('anilist')
      await refreshRemoteSyncStatus()
      if ((result?.remote_failed ?? 0) > 0) {
        toastError(result?.messages?.join(' ') || (isEnglish ? 'Some AniList items are still queued.' : 'Algunos elementos de AniList siguen en cola.'))
      } else {
        toastSuccess(isEnglish ? 'AniList retry completed.' : 'Reintento de AniList completado.')
      }
    } catch (error) {
      toastError(`${isEnglish ? 'AniList retry failed' : 'Falló el reintento de AniList'}: ${error?.message ?? error}`)
    } finally {
      setSyncing(false)
    }
  }, [isEnglish, refreshRemoteSyncStatus])

  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdates(true)
    try {
      const update = await wails.checkForAppUpdate()
      if (update?.available) {
        setUpdateStatus({
          state: 'available',
          label: isEnglish ? `Update ${update.latest_version} available` : `Actualización ${update.latest_version} disponible`,
        })
        toastSuccess(isEnglish ? `Update available: ${update.latest_version}` : `Actualización disponible: ${update.latest_version}`)
      } else {
        setUpdateStatus({
          state: 'current',
          label: isEnglish ? "You're up to date" : 'Está todo actualizado',
        })
        toastSuccess(isEnglish ? 'App is up to date.' : 'La app está actualizada.')
      }
    } catch (error) {
      setUpdateStatus({
        state: 'error',
        label: isEnglish ? 'Could not check updates' : 'No se pudieron revisar actualizaciones',
      })
      toastError(`${isEnglish ? 'Update check failed' : 'Falló la revisión de actualizaciones'}: ${error?.message ?? error}`)
    } finally {
      setCheckingUpdates(false)
    }
  }, [isEnglish])

  const sections = useMemo(() => ([
    { id: 'general', icon: 'general', label: isEnglish ? 'General' : 'General' },
    { id: 'playback', icon: 'playback', label: isEnglish ? 'Playback' : 'Reproducción' },
    { id: 'reading', icon: 'reading', label: isEnglish ? 'Reading' : 'Lectura' },
    { id: 'library', icon: 'library', label: isEnglish ? 'Library' : 'Biblioteca' },
    { id: 'accounts', icon: 'accounts', label: isEnglish ? 'Accounts' : 'Cuentas' },
    { id: 'updates', icon: 'updates', label: isEnglish ? 'Updates' : 'Actualizaciones' },
  ]), [isEnglish])

  const summaryCards = useMemo(() => {
    const libraryCount = libPaths.length > 0 ? `${libPaths.length} ${isEnglish ? 'libraries added' : 'bibliotecas añadidas'}` : (isEnglish ? 'No folders yet' : 'Sin carpetas')
    const syncValue = authStatus.anilist?.logged_in
      ? (isEnglish ? 'AniList connected' : 'AniList conectado')
      : (isEnglish ? 'AniList not connected' : 'AniList sin conectar')
    const updateValue = updateStatus.state === 'idle'
      ? (isEnglish ? 'Check status manually' : 'Revísalo manualmente')
      : updateStatus.label

    return [
      {
        icon: 'playback',
        label: isEnglish ? 'Playback' : 'Reproducción',
        value: mpvOk ? (isEnglish ? 'MPV is active' : 'MPV está activo') : (isEnglish ? 'MPV needs attention' : 'MPV necesita atención'),
        accent: mpvOk ? 'is-positive' : '',
      },
      {
        icon: 'library',
        label: isEnglish ? 'Library' : 'Biblioteca',
        value: libraryCount,
        accent: libPaths.length > 0 ? 'is-gold' : '',
      },
      {
        icon: 'sync',
        label: 'Sync',
        value: syncValue,
        accent: authStatus.anilist?.logged_in ? 'is-positive' : '',
      },
      {
        icon: 'updates',
        label: isEnglish ? 'Updates' : 'Actualizaciones',
        value: updateValue,
        accent: updateStatus.state === 'available' ? 'is-gold' : updateStatus.state === 'current' ? 'is-positive' : '',
      },
    ]
  }, [authStatus.anilist?.logged_in, isEnglish, libPaths.length, mpvOk, updateStatus])

  const scrollToSection = useCallback((id) => {
    setActiveNav(id)
    document.getElementById(`gui2-settingsv2-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (loading || !settings) {
    return (
      <div className="empty-state">
        <div className="gui2-loading-dots"><span /><span /><span /></div>
      </div>
    )
  }

  const remoteErrors = remoteSyncStatus?.errors ?? []
  const aniListConnected = Boolean(authStatus.anilist?.logged_in)
  const anime4kEnabled = (settings.anime4k_level ?? 'off') !== 'off'

  return (
    <div className="gui2-settingsv2">
      <header className="gui2-settingsv2-header">
        <h1 className="gui2-settingsv2-title">{isEnglish ? 'Settings' : 'Ajustes'}</h1>
        <p className="gui2-settingsv2-copy">
          {isEnglish
            ? 'Customize your experience and manage your preferences.'
            : 'Personaliza tu experiencia y administra tus preferencias.'}
        </p>
      </header>

      <section className="gui2-settingsv2-overview">
        {summaryCards.map((card) => (
          <SettingsOverviewCard key={card.label} icon={card.icon} label={card.label} value={card.value} accent={card.accent} />
        ))}
      </section>

      <section className="gui2-settingsv2-workspace">
        <aside className="gui2-settingsv2-nav">
          {sections.map((section) => (
            <SettingsSectionButton
              key={section.id}
              active={activeNav === section.id}
              icon={section.icon}
              label={section.label}
              onClick={() => scrollToSection(section.id)}
            />
          ))}
        </aside>

        <div className="gui2-settingsv2-panel">
          <div className="gui2-settingsv2-panel-header">{isEnglish ? 'General' : 'General'}</div>

          <SettingsGroup id="gui2-settingsv2-general" title={isEnglish ? 'Preferences' : 'Preferencias'}>
            <SettingsRow
              title={isEnglish ? 'Language' : 'Idioma'}
              description={isEnglish ? 'Choose your preferred language.' : 'Elige tu idioma preferido.'}
            >
              <SettingsSelect
                value={settings.language ?? 'es'}
                onChange={(value) => setSetting('language', value)}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'es', label: 'Español' },
                ]}
              />
            </SettingsRow>

            <SettingsRow
              title={isEnglish ? 'Video Quality (Streaming)' : 'Calidad de video (streaming)'}
              description={isEnglish ? 'Default streaming quality for online playback.' : 'Calidad de streaming por defecto para reproducción online.'}
            >
              <SettingsSelect
                value={settings.preferred_quality ?? '1080p'}
                onChange={(value) => setSetting('preferred_quality', value)}
                options={[
                  { value: '1080p', label: 'Auto (1080p)' },
                  { value: '720p', label: '720p (HD)' },
                  { value: '480p', label: '480p' },
                  { value: '360p', label: '360p' },
                ]}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup id="gui2-settingsv2-playback" title={isEnglish ? 'Playback' : 'Reproducción'}>
            <SettingsRow
              title="MPV Player"
              description={isEnglish ? 'External playback fallback used for tougher providers and Anime4K.' : 'Ruta de reproducción externa usada para proveedores más difíciles y Anime4K.'}
              stacked
            >
              <div className="gui2-settingsv2-inline-status">
                <span className={`gui2-settingsv2-status${mpvOk ? ' is-positive' : ''}`}>
                  {mpvOk ? (isEnglish ? 'MPV is active' : 'MPV está activo') : (isEnglish ? 'MPV not found' : 'MPV no encontrado')}
                </span>
              </div>
              <input
                className="gui2-settingsv2-input"
                value={settings.mpv_path ?? ''}
                onChange={(event) => setSetting('mpv_path', event.target.value)}
                placeholder={isEnglish ? 'Leave empty for automatic detection' : 'Déjalo vacío para detección automática'}
              />
            </SettingsRow>

            <SettingsRow
              title={isEnglish ? 'Preferred Player' : 'Reproductor preferido'}
              description={isEnglish ? 'Choose between the in-app player and external MPV.' : 'Elige entre el reproductor integrado y MPV externo.'}
            >
              <SettingsSelect
                value={settings.player ?? 'mpv'}
                onChange={(value) => setSetting('player', value)}
                options={[
                  { value: 'integrated', label: isEnglish ? 'In-app Player' : 'Reproductor integrado' },
                  { value: 'mpv', label: 'MPV' },
                ]}
              />
            </SettingsRow>

            <SettingsRow
              title="Anime4K"
              description={isEnglish ? 'Sharper anime playback for MPV sessions.' : 'Más nitidez para sesiones anime con MPV.'}
            >
              <div className="gui2-settingsv2-inline-controls">
                <SettingsToggle
                  checked={anime4kEnabled}
                  onChange={(enabled) => setSetting('anime4k_level', enabled ? 'medium' : 'off')}
                />
                {anime4kEnabled ? (
                  <SettingsSelect
                    value={settings.anime4k_level ?? 'medium'}
                    onChange={(value) => setSetting('anime4k_level', value)}
                    options={[
                      { value: 'medium', label: isEnglish ? 'Medium' : 'Medio' },
                      { value: 'high', label: isEnglish ? 'High' : 'Alto' },
                    ]}
                  />
                ) : null}
              </div>
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup id="gui2-settingsv2-reading" title={isEnglish ? 'Reading' : 'Lectura'}>
            <SettingsRow
              title={isEnglish ? 'Reading Direction' : 'Dirección de lectura'}
              description={isEnglish ? 'Default direction for manga reading.' : 'Dirección por defecto para la lectura de manga.'}
            >
              <SettingsSelect
                value={settings.manga_reading_direction ?? 'rtl'}
                onChange={(value) => setSetting('manga_reading_direction', value)}
                options={[
                  { value: 'rtl', label: isEnglish ? 'Right to Left' : 'Derecha a izquierda' },
                  { value: 'ltr', label: isEnglish ? 'Left to Right' : 'Izquierda a derecha' },
                ]}
              />
            </SettingsRow>

            <SettingsRow
              title={isEnglish ? 'Image Enhancement (Reader)' : 'Mejora de imagen (lector)'}
              description={isEnglish ? 'Improve clarity for the manga reader experience.' : 'Mejora la claridad de la experiencia de lectura.'}
            >
              <SettingsToggle
                checked={readerSettings.enhance}
                onChange={(checked) => setReaderSetting('enhance', checked)}
              />
            </SettingsRow>

            <SettingsRow
              title={isEnglish ? 'Default Reader Mode' : 'Modo de lector por defecto'}
              description={isEnglish ? 'Choose how manga chapters open by default.' : 'Elige cómo se abren los capítulos por defecto.'}
            >
              <SettingsSelect
                value={readerSettings.readingMode}
                onChange={(value) => setReaderSetting('readingMode', value)}
                options={[
                  { value: 'scroll', label: isEnglish ? 'Vertical Scroll' : 'Scroll vertical' },
                  { value: 'paged', label: isEnglish ? 'Paged' : 'Paginado' },
                  { value: 'double', label: isEnglish ? 'Double Page' : 'Doble página' },
                ]}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup id="gui2-settingsv2-library" title={isEnglish ? 'Library' : 'Biblioteca'}>
            <SettingsRow
              title={isEnglish ? 'Library Folders' : 'Carpetas de biblioteca'}
              description={isEnglish ? 'Manage folders used for local anime and manga.' : 'Administra las carpetas usadas para anime y manga local.'}
              stacked
            >
              <div className="gui2-settingsv2-inline-spread">
                <span className="gui2-settingsv2-status is-gold">
                  {libPaths.length > 0
                    ? `${libPaths.length} ${isEnglish ? 'folders added' : 'carpetas añadidas'}`
                    : (isEnglish ? 'No folders added yet' : 'Aún no hay carpetas')}
                </span>
                <div className="gui2-settingsv2-button-row">
                  <button type="button" className="gui2-settingsv2-ghost-btn" onClick={handleChooseImportDir}>
                    {isEnglish ? 'Manage Folders' : 'Administrar carpetas'}
                  </button>
                  <button type="button" className="gui2-settingsv2-ghost-btn" onClick={handleScanWithPicker}>
                    {isEnglish ? 'Scan Library' : 'Escanear biblioteca'}
                  </button>
                </div>
              </div>
              <div className="gui2-settingsv2-library-list">
                {libPaths.map((path) => (
                  <div key={path.id} className="gui2-settingsv2-library-item">
                    <div className="gui2-settingsv2-library-copy">
                      <strong>{path.path}</strong>
                      <span>{path.kind === 'anime' ? 'Anime' : 'Manga'}</span>
                    </div>
                    <button type="button" className="gui2-settingsv2-text-btn" onClick={() => handleRemoveLibraryPath(path.id)}>
                      {isEnglish ? 'Remove' : 'Eliminar'}
                    </button>
                  </div>
                ))}
                <div className="gui2-settingsv2-library-item is-static">
                  <div className="gui2-settingsv2-library-copy">
                    <strong>{animeImportDir || (isEnglish ? 'No import folder configured' : 'No hay carpeta de importación')}</strong>
                    <span>{isEnglish ? 'Import folder' : 'Carpeta de importación'}</span>
                  </div>
                </div>
              </div>
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup id="gui2-settingsv2-accounts" title={isEnglish ? 'Accounts' : 'Cuentas'}>
            <SettingsRow
              title="AniList"
              description={isEnglish ? 'Sync your lists, progress, and ratings.' : 'Sincroniza tus listas, progreso y puntuaciones.'}
              stacked
            >
              <div className="gui2-settingsv2-inline-spread">
                <div className="gui2-settingsv2-account-summary">
                  <span className={`gui2-settingsv2-status${aniListConnected ? ' is-positive' : ''}`}>
                    {aniListConnected
                      ? `${isEnglish ? 'Connected' : 'Conectado'}${authStatus.anilist?.username ? ` · ${authStatus.anilist.username}` : ''}`
                      : (isEnglish ? 'Not connected' : 'Sin conectar')}
                  </span>
                  <span className="gui2-settingsv2-account-sync">
                    {isEnglish ? 'Pending sync' : 'Sync pendiente'}: {remoteSyncStatus?.pending_count ?? 0}
                  </span>
                </div>
                <div className="gui2-settingsv2-button-row">
                  {aniListConnected ? (
                    <>
                      <button type="button" className="gui2-settingsv2-ghost-btn" onClick={handleAniListSync} disabled={syncing}>
                        {syncing ? (isEnglish ? 'Syncing...' : 'Sincronizando...') : (isEnglish ? 'Sync Now' : 'Sincronizar')}
                      </button>
                      <button type="button" className="gui2-settingsv2-ghost-btn" onClick={handleRetryAniListSync} disabled={syncing}>
                        {isEnglish ? 'Retry Failed' : 'Reintentar fallidos'}
                      </button>
                      <button type="button" className="gui2-settingsv2-text-btn" onClick={handleAniListDisconnect}>
                        {isEnglish ? 'Disconnect' : 'Desconectar'}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="gui2-settingsv2-primary-btn" onClick={handleAniListConnect}>
                      {isEnglish ? 'Connect' : 'Conectar'}
                    </button>
                  )}
                </div>
              </div>
              {remoteErrors.length > 0 ? (
                <div className="gui2-settingsv2-error-list">
                  {remoteErrors.slice(0, 3).map((item) => (
                    <div key={`${item.provider}-${item.id}`}>{item.provider.toUpperCase()} · {item.media_type} · {item.last_error}</div>
                  ))}
                </div>
              ) : null}
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup id="gui2-settingsv2-updates" title={isEnglish ? 'Updates' : 'Actualizaciones'}>
            <SettingsRow
              title={isEnglish ? 'Update Checker' : 'Revisión de actualizaciones'}
              description={isEnglish ? 'Check the app for new desktop builds.' : 'Revisa si existen nuevas versiones de escritorio.'}
            >
              <div className="gui2-settingsv2-inline-spread">
                <span className={`gui2-settingsv2-status${updateStatus.state === 'current' ? ' is-positive' : updateStatus.state === 'available' ? ' is-gold' : ''}`}>
                  {updateStatus.state === 'idle'
                    ? (isEnglish ? 'Not checked yet' : 'Aún no revisado')
                    : updateStatus.label}
                </span>
                <button type="button" className="gui2-settingsv2-ghost-btn" onClick={handleCheckUpdates} disabled={checkingUpdates}>
                  {checkingUpdates ? (isEnglish ? 'Checking...' : 'Revisando...') : (isEnglish ? 'Check for Updates' : 'Buscar actualizaciones')}
                </button>
              </div>
            </SettingsRow>
          </SettingsGroup>

          <footer className="gui2-settingsv2-footer">
            <button type="button" className="gui2-settingsv2-save-btn" onClick={handleSave} disabled={saving}>
              {saving ? (isEnglish ? 'Saving...' : 'Guardando...') : (isEnglish ? 'Save Settings' : 'Guardar ajustes')}
            </button>
            <span className="gui2-settingsv2-footer-note">
              {isEnglish ? 'Your changes will be applied automatically.' : 'Tus cambios se aplicarán automáticamente.'}
            </span>
          </footer>
        </div>
      </section>
    </div>
  )
}
