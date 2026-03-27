import { useState, useEffect, useCallback, useRef } from 'react'
import { wails } from '../../lib/wails'
import { toastError } from './Toast'

export default function UpdateChecker({ t, isEnglish }) {
  const [status, setStatus]         = useState('idle')
  const [info, setInfo]             = useState(null)
  const [platform, setPlatform]     = useState('windows')
  const [installing, setInstalling] = useState(false)
  const checkedRef = useRef(false)
  const notifiedVersionRef = useRef('')

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true
    setStatus('checking')
    Promise.all([wails.checkForAppUpdate(), wails.getPlatform()])
      .then(([updateInfo, os]) => {
        setPlatform(os)
        setInfo(updateInfo)
        setStatus(updateInfo?.available ? 'available' : 'current')
        if (updateInfo?.available && updateInfo?.latest_version && notifiedVersionRef.current !== updateInfo.latest_version) {
          notifiedVersionRef.current = updateInfo.latest_version
          wails.notifyDesktop(
            'Nipah! Anime',
            isEnglish
              ? `Update available: v${updateInfo.latest_version}`
              : `Actualizacion disponible: v${updateInfo.latest_version}`
          ).catch(() => {})
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  const recheck = useCallback(() => {
    setStatus('checking')
    setInfo(null)
    Promise.all([wails.checkForAppUpdate(), wails.getPlatform()])
      .then(([updateInfo, os]) => {
        setPlatform(os)
        setInfo(updateInfo)
        setStatus(updateInfo?.available ? 'available' : 'current')
        if (updateInfo?.available && updateInfo?.latest_version && notifiedVersionRef.current !== updateInfo.latest_version) {
          notifiedVersionRef.current = updateInfo.latest_version
          wails.notifyDesktop(
            'Nipah! Anime',
            isEnglish
              ? `Update available: v${updateInfo.latest_version}`
              : `Actualizacion disponible: v${updateInfo.latest_version}`
          ).catch(() => {})
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  const handleInstall = useCallback(async () => {
    if (!info) return
    setInstalling(true)
    try {
      await wails.installLatestAppUpdate(info.download_url, info.asset_name, info.latest_version)
    } catch (e) {
      toastError((isEnglish ? 'Install error' : 'Error al instalar') + ': ' + (e?.message ?? e))
      setInstalling(false)
    }
  }, [info, isEnglish])

  const isLinux = platform === 'linux'

  return (
    <div className="setting-group">
      <div className="setting-row">
        <div className="setting-label-wrap">
          <span className="setting-label">
            {status === 'checking' && t('update_checking')}
            {status === 'current'  && t('update_current')}
            {status === 'available' && t('update_available')}
            {status === 'error'    && t('update_error')}
            {status === 'idle'     && t('update_checking')}
          </span>
          {info && (
            <span className="setting-desc">
              {'v' + info.current_version}
              {status === 'available' && (' > v' + info.latest_version)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status === 'available' && !isLinux && (
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '4px 12px' }}
              disabled={installing}
              onClick={handleInstall}
            >
              {installing ? (isEnglish ? 'Installing...' : 'Instalando...') : t('update_install')}
            </button>
          )}
          {status === 'available' && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => wails.openURL(info.html_url)}
            >
              {t('update_open_release')}
            </button>
          )}
          {(status === 'current' || status === 'error') && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={recheck}
            >
              {t('update_check_again')}
            </button>
          )}
        </div>
      </div>

      {status === 'available' && info?.changelog && (
        <div style={{ padding: '8px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            {t('update_changelog')}
          </div>
          <pre style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 120,
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            borderRadius: 6,
            padding: '8px 10px',
            margin: 0,
          }}>
            {info.changelog.length > 600
              ? info.changelog.slice(0, 600) + '...'
              : info.changelog}
          </pre>
          {isLinux && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              {isEnglish
                ? 'Download the new .deb or .AppImage from the release page above.'
                : 'Descarga el nuevo .deb o .AppImage desde la pagina de la version arriba.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
