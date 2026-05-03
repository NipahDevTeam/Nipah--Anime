import { useState, useEffect, useCallback } from 'react'
import { wails } from '../lib/wails'
import { toastSuccess, toastError } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'
import UpdateChecker from '../components/ui/UpdateChecker'

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reusable setting row components
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingRow({ label, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-label-wrap">
        <span className="setting-label">{label}</span>
        {description && <span className="setting-desc">{description}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function SettingSelect({ value, onChange, options }) {
  return (
    <select className="setting-select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function SettingToggle({ value, onChange }) {
  return (
    <button
      className={`setting-toggle ${value ? 'on' : 'off'}`}
      onClick={() => onChange(!value)}
    >
      <span className="setting-toggle-knob" />
    </button>
  )
}

function SettingInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      className="setting-input"
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}

function SectionHeader({ title, subtitle }) {
  return (
    <div className="setting-section-header">
      <span className="setting-section-title">{title}</span>
      {subtitle && <span className="setting-section-sub">{subtitle}</span>}
    </div>
  )
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Main Settings page
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function Settings() {
  const { t, lang } = useI18n()
  const isEnglish = lang === 'en'
  const [settings, setSettings]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [mpvOk, setMpvOk]         = useState(null)
  const [libPaths, setLibPaths]   = useState([])
  const [animeImportDir, setAnimeImportDir] = useState('')
  const [authStatus, setAuthStatus] = useState({ anilist: { logged_in: false }, mal: { logged_in: false } })
  const [authLoading, setAuthLoading] = useState('')
  const [syncing, setSyncing]     = useState('')
  const [remoteSyncStatus, setRemoteSyncStatus] = useState({ pending_count: 0, failed_count: 0, by_provider: {}, errors: [] })
  const [retryingRemote, setRetryingRemote] = useState('')

  const refreshAuth = useCallback(() => {
    wails.getAuthStatus().then(setAuthStatus).catch(() => {})
  }, [])

  const refreshRemoteSyncStatus = useCallback(() => {
    wails.getRemoteListSyncStatus().then((status) => {
      setRemoteSyncStatus(status ?? { pending_count: 0, failed_count: 0, by_provider: {}, errors: [] })
    }).catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([wails.getSettings(), wails.isMPVAvailable(), wails.getLibraryPaths(), wails.getAnimeImportDir(), wails.getAuthStatus(), wails.getRemoteListSyncStatus()])
      .then(([s, ok, paths, importDir, auth, remoteStatus]) => {
        setSettings({
          ...s,
          player: 'mpv',
        })
        setMpvOk(ok)
        setLibPaths(paths ?? [])
        setAnimeImportDir(importDir ?? '')
        setAuthStatus(auth ?? { anilist: { logged_in: false }, mal: { logged_in: false } })
        setRemoteSyncStatus(remoteStatus ?? { pending_count: 0, failed_count: 0, by_provider: {}, errors: [] })
      })
      .catch(() => toastError(isEnglish ? 'Could not load settings.' : 'No se pudieron cargar los ajustes'))
      .finally(() => setLoading(false))
  }, [])

  const handleRemovePath = useCallback(async (id) => {
    try {
      await wails.removeLibraryPath(id)
      setLibPaths(prev => prev.filter(p => p.id !== id))
      toastSuccess(isEnglish ? 'Folder removed from the library' : 'Carpeta eliminada de la biblioteca')
    } catch (e) {
      toastError(`${isEnglish ? 'Could not remove it' : 'No se pudo eliminar'}: ${e?.message ?? e}`)
    }
  }, [isEnglish])

  const handleChooseImportDir = useCallback(async () => {
    try {
      const path = await wails.pickFolder()
      if (!path) return
      await wails.setAnimeImportDir(path)
      setAnimeImportDir(path)
      setSettings((prev) => (prev ? { ...prev, anime_import_path: path } : prev))
      setLibPaths(await wails.getLibraryPaths())
      toastSuccess(isEnglish ? 'Anime import folder updated' : 'Carpeta de importación actualizada')
    } catch (e) {
      toastError(`${isEnglish ? 'Could not update the import folder' : 'No se pudo actualizar la carpeta de importación'}: ${e?.message ?? e}`)
    }
  }, [isEnglish])

  const handleScanImportDir = useCallback(async () => {
    if (!animeImportDir) return
    try {
      const result = await wails.scanLibrary(animeImportDir)
      toastSuccess(
        isEnglish
          ? `Import folder scanned: ${result?.anime_found ?? 0} anime, ${result?.anime_episodes ?? 0} episodes`
          : `Carpeta escaneada: ${result?.anime_found ?? 0} anime, ${result?.anime_episodes ?? 0} episodios`,
      )
    } catch (e) {
      toastError(`${isEnglish ? 'Import scan failed' : 'Falló el escaneo de importación'}: ${e?.message ?? e}`)
    }
  }, [animeImportDir, isEnglish])

  const set = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: String(value) }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!settings) return
    setSaving(true)
    try {
      await wails.saveSettings(settings)
      // Recheck MPV after saving path change
      const ok = await wails.isMPVAvailable()
      setMpvOk(ok)
      toastSuccess(t('Ajustes guardados correctamente'))
    } catch (e) {
      toastError(`${isEnglish ? 'Error saving settings' : 'Error al guardar'}: ${e?.message ?? e}`)
    } finally {
      setSaving(false)
    }
  }, [isEnglish, settings, t])

  if (loading) return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )

  if (!settings) return (
    <div className="empty-state">
      <p className="empty-state-desc" style={{ color: 'var(--red)' }}>
        {isEnglish ? 'Could not load settings.' : 'No se pudieron cargar los ajustes.'}
      </p>
    </div>
  )

  const boolVal = (key) => settings[key] === 'true'
  const providerCounts = remoteSyncStatus?.by_provider ?? {}
  const connectedProviders = [
    authStatus.anilist?.logged_in ? 'AniList' : null,
    authStatus.mal?.logged_in ? 'MyAnimeList' : null,
  ].filter(Boolean)
  const mpvOnlyLabel = isEnglish ? 'MPV only for now' : 'Solo MPV por ahora'
  const mpvOnlyDescription = isEnglish
    ? 'MPV is temporarily the only playback mode while we finish stabilizing the in-app player.'
    : 'MPV es temporalmente el unico modo de reproduccion mientras terminamos de estabilizar el reproductor interno.'
  const settingsSummaryCards = [
    {
      label: isEnglish ? 'Playback' : 'Reproduccion',
      value: 'MPV',
      copy: mpvOnlyDescription,
    },
    {
      label: isEnglish ? 'Library' : 'Biblioteca',
      value: animeImportDir ? (isEnglish ? 'Ready' : 'Lista') : (isEnglish ? 'Unset' : 'Sin ruta'),
      copy: isEnglish ? 'Import folders and automatic scanning live under one broader library block.' : 'Importacion y escaneo automatico viven bajo un mismo bloque de biblioteca.',
    },
    {
      label: isEnglish ? 'Sync' : 'Sync',
      value: connectedProviders.length > 0 ? connectedProviders.join(' / ') : (isEnglish ? 'Idle' : 'Sin conectar'),
      copy: isEnglish ? 'Remote list sync stays visible without overwhelming the route.' : 'La sincronizacion remota sigue visible sin invadir toda la ruta.',
    },
  ]
  const settingsSections = [
    { id: 'settings-language', label: isEnglish ? 'General' : 'General' },
    { id: 'settings-playback', label: isEnglish ? 'Playback' : 'Reproduccion' },
    { id: 'settings-reading', label: isEnglish ? 'Reading' : 'Lectura' },
    { id: 'settings-library', label: isEnglish ? 'Library' : 'Biblioteca' },
    { id: 'settings-accounts', label: isEnglish ? 'Accounts' : 'Cuentas' },
    { id: 'settings-updates', label: isEnglish ? 'Updates' : 'Actualizaciones' },
  ]
  const scrollToSettingsSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="fade-in settings-page">
      <section className="nipah-hero-band settings-hero">
        <div className="nipah-hero-copy">
          <div className="nipah-hero-kicker">{isEnglish ? 'System preferences' : 'Preferencias del sistema'}</div>
          <h1 className="nipah-hero-title">
            {isEnglish ? 'Tune playback, sync, and your local library' : 'Ajusta reproduccion, sincronizacion y tu biblioteca local'}
          </h1>
          <p className="nipah-hero-text">
            {isEnglish
              ? 'Everything important now lives in a cleaner desktop control center: player behavior, account sync, import folders, and update checks.'
              : 'Todo lo importante ahora vive en un centro de control mas limpio: reproduccion, cuentas, carpetas de importacion y actualizaciones.'}
          </p>
        </div>
        <div className="settings-hero-focus">
          <span className="settings-hero-focus-kicker">{isEnglish ? 'System state' : 'Estado del sistema'}</span>
          <strong className="settings-hero-focus-title">
            {connectedProviders.length > 0 ? connectedProviders.join(' / ') : (isEnglish ? 'Ready for tuning' : 'Lista para ajustar')}
          </strong>
          <div className="settings-hero-focus-copy">
            {mpvOk
              ? (isEnglish ? 'MPV is ready, library import is configured, and the route can now spend more space on the controls that actually matter.' : 'MPV esta listo, la importacion local esta configurada y la ruta ya puede dedicar mas espacio a los controles que de verdad importan.')
              : (isEnglish ? 'Playback fallback still needs attention, but the rest of the control center is ready to configure.' : 'La ruta alternativa de reproduccion aun necesita atencion, pero el resto del centro de control ya se puede configurar.')}
          </div>
          <div className="settings-hero-focus-meta">
            <span>MPV {mpvOk ? (isEnglish ? 'Ready' : 'Listo') : (isEnglish ? 'Missing' : 'Falta')}</span>
            <span>{isEnglish ? 'Queue' : 'Cola'} {remoteSyncStatus?.pending_count ?? 0}</span>
            <span>{isEnglish ? 'Paths' : 'Rutas'} {libPaths.length}</span>
          </div>
        </div>
      </section>

      <section className="settings-overview-strip">
        {settingsSummaryCards.map((item) => (
          <article key={item.label} className="settings-overview-card">
            <span className="settings-overview-label">{item.label}</span>
            <strong className="settings-overview-value">{item.value}</strong>
            <p className="settings-overview-copy">{item.copy}</p>
          </article>
        ))}
      </section>

      <div className="settings-layout">
        <aside className="settings-nav-rail">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="settings-nav-btn"
              onClick={() => scrollToSettingsSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </aside>

        <div className="settings-main-column">

      <section className="settings-cluster" id="settings-language">
      <SectionHeader title={t("Idioma y región")} />
      <div className="setting-group">
        <SettingRow
          label={t("Idioma y región")}
          description={isEnglish ? 'Language used throughout the app' : 'Idioma usado en la aplicación'}
        >
          <SettingSelect
            value={settings.language ?? 'es'}
            onChange={v => set('language', v)}
            options={[
              { value: 'es', label: 'Español' },              { value: 'en', label: 'English' },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={isEnglish ? 'Preferred audio' : 'Audio preferido'}
          description={isEnglish ? 'Default audio preference for online playback' : 'Subtítulos o doblado por defecto'}
        >
          <SettingSelect
            value={settings.preferred_audio ?? 'sub'}
            onChange={v => set('preferred_audio', v)}
            options={[
              { value: 'sub', label: isEnglish ? 'Subtitles' : 'Subtítulos' },
              { value: 'dub', label: isEnglish ? 'Dubbed' : 'Doblado' },
            ]}
          />
        </SettingRow>
      </div>
      </section>

      <section className="settings-cluster" id="settings-playback">
      <SectionHeader
        title={t("Reproducción")}
        subtitle={isEnglish ? 'MPV and video quality settings' : 'Configuración de MPV y calidad de video'}
      />
      <div className="setting-group">
        <SettingRow
          label={isEnglish ? 'MPV status' : 'Estado de MPV'}
          description={isEnglish ? 'MPV must be installed to play video' : 'MPV debe estar instalado para reproducir video'}
        >
          <span className={`badge ${mpvOk ? 'badge-green' : 'badge-muted'}`}
            style={{ fontSize: 11, padding: '4px 10px' }}>
            {mpvOk ? (isEnglish ? 'Detected' : 'Detectado') : (isEnglish ? 'Not found' : 'No encontrado')}
          </span>
        </SettingRow>

        <SettingRow
          label={isEnglish ? 'MPV path' : 'Ruta de MPV'}
          description={
            mpvOk
              ? (isEnglish ? 'MPV was detected automatically. Change it only if you use a custom install.' : 'MPV detectado automáticamente. Solo cambia si tienes una instalación personalizada.')
              : (isEnglish ? 'MPV was not found. Download it from mpv.io or enter the full executable path.' : 'MPV no encontrado. Descárgalo desde mpv.io o especifica la ruta completa al ejecutable.')
          }
        >
          <SettingInput
            value={settings.mpv_path ?? ''}
            onChange={v => set('mpv_path', v)}
            placeholder={isEnglish ? 'Leave empty for automatic detection' : 'Dejar vacío para detectar automáticamente'}
          />
        </SettingRow>

        {!mpvOk && (
          <div className="setting-notice">
            {isEnglish ? (
              <>
                <b>MPV is not installed or could not be found.</b> MPV is the only playback path exposed in this build while the in-app player is being stabilized.
                Download it from <a href="https://mpv.io" target="_blank" rel="noreferrer"
                  style={{ color: 'var(--accent)' }}>mpv.io</a> and install it normally.
                On Windows, you can also specify the full path to the `.exe` above.
              </>
            ) : (
              <>
                <b>MPV no esta instalado o no se encontro.</b> MPV es la unica ruta de reproduccion expuesta en esta build mientras estabilizamos el reproductor interno.
                Descárgalo desde <a href="https://mpv.io" target="_blank" rel="noreferrer"
                  style={{ color: 'var(--accent)' }}>mpv.io</a> e instálalo normalmente.
                En Windows, también puedes especificar la ruta completa al .exe arriba.
              </>
            )}
          </div>
        )}

        <SettingRow
          label={isEnglish ? 'Preferred player' : 'Reproductor preferido'}
          description={mpvOnlyDescription}
        >
          <span className="badge badge-muted" style={{ fontSize: 11, padding: '4px 10px' }}>
            {mpvOnlyLabel}
          </span>
        </SettingRow>
        <div className="setting-notice">
          {isEnglish
            ? 'The in-app player is hidden for now, so every provider opens through MPV until that path is fully stabilized.'
            : 'El reproductor interno queda oculto por ahora, asi que todas las fuentes se abren con MPV hasta que esa ruta quede totalmente estabilizada.'}
        </div>

        <SettingRow
          label={isEnglish ? 'Preferred quality' : 'Calidad preferida'}
          description={isEnglish ? 'Default stream quality for online playback' : 'Calidad de stream usada por defecto al ver online'}
        >
          <SettingSelect
            value={settings.preferred_quality ?? '1080p'}
            onChange={v => set('preferred_quality', v)}
            options={[
              { value: '1080p', label: '1080p (Full HD)' },
              { value: '720p',  label: '720p (HD)' },
              { value: '480p',  label: '480p' },
              { value: '360p',  label: isEnglish ? '360p (Low bandwidth)' : '360p (Bajo consumo)' },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Anime4K"
          description={isEnglish ? 'Optional MPV shader preset for sharper anime playback. This does not apply to the in-app player.' : 'Preset opcional de shaders para ver anime con más nitidez en MPV. No aplica al reproductor dentro de la app.'}
        >
          <SettingSelect
            value={settings.anime4k_level ?? 'off'}
            onChange={v => set('anime4k_level', v)}
            options={[
              { value: 'off', label: isEnglish ? 'Off' : 'Desactivado' },
              { value: 'medium', label: isEnglish ? 'Medium' : 'Medio' },
              { value: 'high', label: isEnglish ? 'High' : 'Alto' },
            ]}
          />
        </SettingRow>
      </div>
      </section>

      <section className="settings-cluster" id="settings-reading">
      <SectionHeader title={t("Lectura de manga")} />
      <div className="setting-group">
        <SettingRow
          label={isEnglish ? 'Reading direction' : 'Dirección de lectura'}
          description={isEnglish ? 'LTR for webtoons/manhwa, RTL for Japanese manga' : 'LTR para webtoons / manhwa, RTL para manga japonés'}
        >
          <SettingSelect
            value={settings.manga_reading_direction ?? 'ltr'}
            onChange={v => set('manga_reading_direction', v)}
            options={[
              { value: 'ltr', label: isEnglish ? 'Left to right (Webtoon)' : 'Izquierda a derecha (Webtoon)' },
              { value: 'rtl', label: isEnglish ? 'Right to left (JP Manga)' : 'Derecha a izquierda (Manga JP)' },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={isEnglish ? 'Data saver' : 'Ahorro de datos'}
          description={isEnglish ? 'Use compressed images in the online reader (~40% less data)' : 'Usa imágenes comprimidas en el lector online (~40% menos datos)'}
        >
          <SettingToggle
            value={boolVal('data_saver')}
            onChange={v => set('data_saver', v)}
          />
        </SettingRow>
      </div>
      </section>

      <section className="settings-cluster" id="settings-library">
      <SectionHeader title={t("Biblioteca")} />
      <div className="setting-group">
        <SettingRow
          label={isEnglish ? 'Scan on startup' : 'Escanear al iniciar'}
          description={isEnglish ? 'Automatically detect new files when the app opens' : 'Detecta nuevos archivos automáticamente al abrir la app'}
        >
          <SettingToggle
            value={boolVal('auto_scan_on_startup')}
            onChange={v => set('auto_scan_on_startup', v)}
          />
        </SettingRow>

        <SettingRow
          label={isEnglish ? 'Anime import folder' : 'Carpeta de importación de anime'}
          description={isEnglish ? 'Drop episodes here from outside the app. They are scanned into Local Anime, while Downloads remains history-only.' : 'Copia episodios aquí desde fuera de la app. Se escanean dentro de Anime local, mientras Descargas queda solo como historial.'}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" type="button" onClick={handleChooseImportDir}>
              {isEnglish ? 'Choose folder' : 'Elegir carpeta'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={handleScanImportDir} disabled={!animeImportDir}>
              {isEnglish ? 'Scan now' : 'Escanear ahora'}
            </button>
          </div>
        </SettingRow>
        <div className="setting-notice" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {(isEnglish ? 'Current folder: ' : 'Carpeta actual: ') + (animeImportDir || (isEnglish ? 'No import folder configured yet.' : 'Aún no hay carpeta de importación configurada.'))}
        </div>
      </div>

      {/* Library paths list */}
      {libPaths.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: 12, color: 'var(--text-muted)',
            padding: '0 14px 8px', letterSpacing: '0.04em'
          }}>
            {isEnglish ? 'Registered folders' : 'Carpetas registradas'}
          </div>
          <div className="setting-group">
            {libPaths.map(lp => (
              <div key={lp.id} className="setting-row">
                <div className="setting-label-wrap" style={{ minWidth: 0 }}>
                  <span className="setting-label" style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    maxWidth: 420,
                  }}>
                    {lp.path}
                  </span>
                  <span className="setting-desc">{lp.type}</span>
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, color: 'var(--red)', borderColor: 'rgba(224,82,82,0.3)' }}
                  onClick={() => handleRemovePath(lp.id)}
                >
                  {isEnglish ? 'Remove' : 'Eliminar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      </section>

      <section className="settings-cluster" id="settings-accounts">
      <SectionHeader
        title={t("Cuentas vinculadas")}
        subtitle={isEnglish ? 'Connect your accounts to sync anime and manga lists' : 'Conecta tus cuentas para sincronizar listas de anime y manga'}
      />
      <div className="setting-group">
        {/* AniList */}
        <SettingRow
          label="AniList"
          description={
            authStatus.anilist?.logged_in
              ? `${isEnglish ? 'Connected as' : 'Conectado como'} ${authStatus.anilist.username}`
              : (isEnglish ? 'Sync your anime and manga list from AniList' : 'Sincroniza tu lista de anime y manga desde AniList')
          }
        >
          {authStatus.anilist?.logged_in ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {authStatus.anilist.avatar && (
                <img
                  src={authStatus.anilist.avatar}
                  alt=""
                  style={{ width: 24, height: 24, borderRadius: '50%' }}
                />
              )}
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '4px 10px' }}
                disabled={syncing === 'anilist'}
                onClick={async () => {
                  setSyncing('anilist')
                  try {
                    const res = await wails.syncAniListLists()
                    toastSuccess(isEnglish ? `Synced: ${res.anime_count} anime, ${res.manga_count} manga` : `Sincronizado: ${res.anime_count} anime, ${res.manga_count} manga`)
                    refreshRemoteSyncStatus()
                  } catch (e) {
                    toastError(`${isEnglish ? 'Sync error' : 'Error al sincronizar'}: ${e?.message ?? e}`)
                  } finally {
                    setSyncing('')
                  }
                }}
              >
                {syncing === 'anilist' ? (isEnglish ? 'Syncing...' : 'Sincronizando...') : (isEnglish ? 'Sync' : 'Sincronizar')}
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red)', borderColor: 'rgba(224,82,82,0.3)' }}
                onClick={async () => {
                  await wails.logout('anilist')
                  refreshAuth()
                  refreshRemoteSyncStatus()
                  toastSuccess(isEnglish ? 'AniList disconnected' : 'AniList desconectado')
                }}
              >
                {isEnglish ? 'Disconnect' : 'Desconectar'}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              disabled={authLoading === 'anilist'}
              onClick={async () => {
                setAuthLoading('anilist')
                try {
                  await wails.loginAniList()
                  refreshAuth()
                  refreshRemoteSyncStatus()
                  toastSuccess(isEnglish ? 'AniList connected' : 'AniList conectado')
                } catch (e) {
                  toastError(`${isEnglish ? 'AniList connection error' : 'Error al conectar AniList'}: ${e?.message ?? e}`)
                } finally {
                  setAuthLoading('')
                }
              }}
            >
              {authLoading === 'anilist' ? (isEnglish ? 'Connecting...' : 'Conectando...') : (isEnglish ? 'Connect AniList' : 'Conectar AniList')}
            </button>
          )}
        </SettingRow>

        {false && (
        <SettingRow
          label="MyAnimeList"
          description={
            authStatus.mal?.logged_in
              ? `${isEnglish ? 'Connected as' : 'Conectado como'} ${authStatus.mal.username}`
              : (isEnglish ? 'Sync your anime and manga list from MAL' : 'Sincroniza tu lista de anime y manga desde MAL')
          }
        >
          {authStatus.mal?.logged_in ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {authStatus.mal.avatar && (
                <img
                  src={authStatus.mal.avatar}
                  alt=""
                  style={{ width: 24, height: 24, borderRadius: '50%' }}
                />
              )}
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '4px 10px' }}
                disabled={syncing === 'mal'}
                onClick={async () => {
                  setSyncing('mal')
                  try {
                    const res = await wails.syncMALLists()
                    toastSuccess(isEnglish ? `Synced: ${res.anime_count} anime, ${res.manga_count} manga` : `Sincronizado: ${res.anime_count} anime, ${res.manga_count} manga`)
                    refreshRemoteSyncStatus()
                  } catch (e) {
                    toastError(`${isEnglish ? 'Sync error' : 'Error al sincronizar'}: ${e?.message ?? e}`)
                  } finally {
                    setSyncing('')
                  }
                }}
              >
                {syncing === 'mal' ? (isEnglish ? 'Syncing...' : 'Sincronizando...') : (isEnglish ? 'Sync' : 'Sincronizar')}
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red)', borderColor: 'rgba(224,82,82,0.3)' }}
                onClick={async () => {
                  await wails.logout('mal')
                  refreshAuth()
                  refreshRemoteSyncStatus()
                  toastSuccess(isEnglish ? 'MAL disconnected' : 'MAL desconectado')
                }}
              >
                {isEnglish ? 'Disconnect' : 'Desconectar'}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              disabled={authLoading === 'mal'}
              onClick={async () => {
                setAuthLoading('mal')
                try {
                  await wails.loginMAL()
                  refreshAuth()
                  refreshRemoteSyncStatus()
                  toastSuccess(isEnglish ? 'MAL connected' : 'MAL conectado')
                } catch (e) {
                  toastError(`${isEnglish ? 'MAL connection error' : 'Error al conectar MAL'}: ${e?.message ?? e}`)
                } finally {
                  setAuthLoading('')
                }
              }}
            >
              {authLoading === 'mal' ? (isEnglish ? 'Connecting...' : 'Conectando...') : (isEnglish ? 'Connect MyAnimeList' : 'Conectar MyAnimeList')}
            </button>
          )}
        </SettingRow>
        )}

        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {isEnglish
            ? 'AniList sync is currently supported. MyAnimeList is deprecated for this release.'
            : 'La sincronizacion con AniList es la soportada en esta version. MyAnimeList queda deprecado por ahora.'}
        </div>
      </div>
      </section>

      <section className="settings-cluster" id="settings-updates">
      <SectionHeader title={t('update_section')} />
      <UpdateChecker t={t} isEnglish={isEnglish} />

      <div className="setting-group">
        <SettingRow
          label={isEnglish ? 'Sync status' : 'Estado de sincronizacion'}
          description={isEnglish
            ? `Pending: ${remoteSyncStatus?.pending_count ?? 0} - Failed: ${remoteSyncStatus?.failed_count ?? 0}`
            : `Pendientes: ${remoteSyncStatus?.pending_count ?? 0} - Fallidos: ${remoteSyncStatus?.failed_count ?? 0}`}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              disabled={retryingRemote === 'all'}
              onClick={async () => {
                setRetryingRemote('all')
                try {
                  const result = await wails.retryRemoteListSync('')
                  if (result?.remote_failed > 0) {
                    toastError(result.messages?.join(' ') || (isEnglish ? 'Some changes are still queued.' : 'Algunos cambios siguen en cola.'))
                  } else {
                    toastSuccess(isEnglish ? `Retries completed: ${result?.remote_succeeded ?? 0}` : `Reintentos completados: ${result?.remote_succeeded ?? 0}`)
                  }
                } catch (e) {
                  toastError(`${isEnglish ? 'Retry error' : 'Error al reintentar'}: ${e?.message ?? e}`)
                } finally {
                  refreshRemoteSyncStatus()
                  setRetryingRemote('')
                }
              }}
            >
              {retryingRemote === 'all' ? (isEnglish ? 'Retrying...' : 'Reintentando...') : (isEnglish ? 'Retry all' : 'Reintentar todo')}
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              disabled={retryingRemote === 'anilist' || !authStatus.anilist?.logged_in}
              onClick={async () => {
                setRetryingRemote('anilist')
                try {
                  const result = await wails.retryRemoteListSync('anilist')
                  if (result?.remote_failed > 0) {
                    toastError(result.messages?.join(' ') || (isEnglish ? 'AniList still has errors.' : 'AniList sigue con errores.'))
                  } else {
                    toastSuccess(isEnglish ? `AniList retried: ${result?.remote_succeeded ?? 0}` : `AniList reintentado: ${result?.remote_succeeded ?? 0}`)
                  }
                } catch (e) {
                  toastError(`${isEnglish ? 'AniList error' : 'Error AniList'}: ${e?.message ?? e}`)
                } finally {
                  refreshRemoteSyncStatus()
                  setRetryingRemote('')
                }
              }}
            >
              {retryingRemote === 'anilist' ? 'AniList...' : `AniList (${providerCounts.anilist?.failed ?? 0})`}
            </button>
            {false && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              disabled={retryingRemote === 'mal' || !authStatus.mal?.logged_in}
              onClick={async () => {
                setRetryingRemote('mal')
                try {
                  const result = await wails.retryRemoteListSync('mal')
                  if (result?.remote_failed > 0) {
                    toastError(result.messages?.join(' ') || (isEnglish ? 'MAL still has errors.' : 'MAL sigue con errores.'))
                  } else {
                    toastSuccess(isEnglish ? `MAL retried: ${result?.remote_succeeded ?? 0}` : `MAL reintentado: ${result?.remote_succeeded ?? 0}`)
                  }
                } catch (e) {
                  toastError(`${isEnglish ? 'MAL error' : 'Error MAL'}: ${e?.message ?? e}`)
                } finally {
                  refreshRemoteSyncStatus()
                  setRetryingRemote('')
                }
              }}
            >
              {retryingRemote === 'mal' ? 'MAL...' : `MAL (${providerCounts.mal?.failed ?? 0})`}
            </button>
            )}
          </div>
        </SettingRow>
        {(remoteSyncStatus?.errors?.length ?? 0) > 0 && (
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {remoteSyncStatus.errors.slice(0, 3).map((item) => (
              <div key={`${item.provider}-${item.id}`}>
                {item.provider.toUpperCase()} {item.media_type}: {item.last_error}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-save-row">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ minWidth: 140 }}
        >
          {saving ? t('Guardando...') : t('Guardar ajustes')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Nipah! Anime
        </span>
      </div>
      </section>

        </div>

        <aside className="settings-side-column">
          <section className="settings-brand-card">
            <span className="settings-brand-kicker">{isEnglish ? 'Nipah! desktop' : 'Nipah! escritorio'}</span>
            <strong className="settings-brand-title">{isEnglish ? 'Keep the system broad, calm, and tuned for media-first flows.' : 'Manten el sistema amplio, sereno y ajustado para flujos centrados en medios.'}</strong>
            <p className="settings-brand-copy">
              {isEnglish
                ? 'This route should feel like a product control center, not a maintenance form. Accounts, playback, and library actions stay visible without taking over the page.'
                : 'Esta ruta debe sentirse como un centro de control del producto, no como un formulario de mantenimiento. Cuentas, reproduccion y biblioteca siguen visibles sin apoderarse de la pagina.'}
            </p>
          </section>

          <section className="nipah-side-panel settings-side-panel">
            <div className="nipah-side-panel-head">
              <div>
                <div className="nipah-side-panel-title">{isEnglish ? 'Runtime snapshot' : 'Estado rapido'}</div>
                <div className="nipah-side-panel-copy">
                  {isEnglish ? 'A tighter read on playback, library, and reading defaults while you tune the app.' : 'Una lectura mas cerrada de reproduccion, biblioteca y lectura mientras ajustas la app.'}
                </div>
              </div>
            </div>
            <div className="settings-side-list">
              <div className="settings-side-list-item">
                <span>{isEnglish ? 'Preferred player' : 'Reproductor preferido'}</span>
                <strong>MPV</strong>
              </div>
              <div className="settings-side-list-item">
                <span>{isEnglish ? 'Video quality' : 'Calidad de video'}</span>
                <strong>{settings.preferred_quality ?? '1080p'}</strong>
              </div>
              <div className="settings-side-list-item">
                <span>{isEnglish ? 'Reader direction' : 'Direccion de lectura'}</span>
                <strong>{settings.manga_reading_direction === 'rtl' ? 'RTL' : 'LTR'}</strong>
              </div>
              <div className="settings-side-list-item">
                <span>{isEnglish ? 'Auto scan' : 'Escaneo automatico'}</span>
                <strong>{boolVal('auto_scan_on_startup') ? (isEnglish ? 'On' : 'Activo') : (isEnglish ? 'Off' : 'Inactivo')}</strong>
              </div>
            </div>
          </section>

          <section className="nipah-side-panel settings-side-panel">
            <div className="nipah-side-panel-head">
              <div>
                <div className="nipah-side-panel-title">{isEnglish ? 'Connected services' : 'Servicios conectados'}</div>
                <div className="nipah-side-panel-copy">
                  {connectedProviders.length > 0
                    ? connectedProviders.join(' / ')
                    : (isEnglish ? 'No active connections yet.' : 'Todavia no hay conexiones activas.')}
                </div>
              </div>
            </div>
            <div className="settings-side-list">
              <div className="settings-side-list-item">
                <span>AniList</span>
                <strong>{authStatus.anilist?.logged_in ? (isEnglish ? 'Connected' : 'Conectado') : (isEnglish ? 'Idle' : 'Sin conectar')}</strong>
              </div>
              <div className="settings-side-list-item">
                <span>{isEnglish ? 'Pending sync items' : 'Pendientes de sync'}</span>
                <strong>{remoteSyncStatus?.pending_count ?? 0}</strong>
              </div>
              <div className="settings-side-list-item">
                <span>{isEnglish ? 'Failed sync items' : 'Fallidos'}</span>
                <strong>{remoteSyncStatus?.failed_count ?? 0}</strong>
              </div>
              <div className="settings-side-list-item">
                <span>{isEnglish ? 'Import folder' : 'Carpeta importacion'}</span>
                <strong>{animeImportDir ? (isEnglish ? 'Ready' : 'Lista') : (isEnglish ? 'Unset' : 'No definida')}</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

