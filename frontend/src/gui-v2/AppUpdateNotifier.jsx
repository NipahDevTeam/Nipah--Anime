import { useEffect, useRef } from 'react'
import { wails } from '../lib/wails'
import { useI18n } from '../lib/i18n'

export default function AppUpdateNotifier() {
  const { lang } = useI18n()
  const checkedRef = useRef(false)
  const notifiedVersionRef = useRef('')
  const isEnglish = lang === 'en'

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true

    let cancelled = false
    wails.checkForAppUpdate()
      .then((updateInfo) => {
        if (cancelled || !updateInfo?.available || !updateInfo?.latest_version) return
        if (notifiedVersionRef.current === updateInfo.latest_version) return
        notifiedVersionRef.current = updateInfo.latest_version
        return wails.notifyDesktop(
          'Nipah! Anime',
          isEnglish
            ? `Update available: v${updateInfo.latest_version}`
            : `Actualizacion disponible: v${updateInfo.latest_version}`,
        ).catch(() => {})
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [isEnglish])

  return null
}
