import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { wails } from '../../lib/wails'
import { getAniListMetadataFallbackActivationKey, isAniListMetadataFallbackActive } from '../../lib/anilistStatus'

const DISMISS_STORAGE_KEY = 'metadata-fallback-overlay:dismissed-activation'

function readDismissedActivation() {
  if (typeof sessionStorage === 'undefined') return ''
  try {
    return sessionStorage.getItem(DISMISS_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function writeDismissedActivation(value) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, value)
  } catch {
    // Ignore session storage failures and keep the overlay visible.
  }
}

export default function MetadataFallbackOverlay() {
  const metadataStatusQuery = useQuery({
    queryKey: ['metadata-source-status'],
    queryFn: () => wails.getMetadataSourceStatus(),
    staleTime: 15_000,
    refetchInterval: 45_000,
    retry: 1,
  })

  const status = metadataStatusQuery.data ?? null
  const fallbackActive = isAniListMetadataFallbackActive(status)
  const activatedAtUnix = Number(status?.activated_at_unix || 0)
  const activationKey = useMemo(
    () => getAniListMetadataFallbackActivationKey(status),
    [activatedAtUnix, status?.anilist_mode, status?.fallback_provider],
  )
  const [dismissedActivation, setDismissedActivation] = useState(() => readDismissedActivation())

  useEffect(() => {
    if (!fallbackActive) {
      setDismissedActivation(readDismissedActivation())
    }
  }, [fallbackActive])

  if (!fallbackActive || !activationKey || dismissedActivation === activationKey) {
    return null
  }

  const handleDismiss = () => {
    writeDismissedActivation(activationKey)
    setDismissedActivation(activationKey)
  }

  return (
    <aside className="metadata-fallback-overlay" role="status" aria-live="polite">
      <div className="metadata-fallback-overlay__eyebrow">Temporary AniList issue</div>
      <p className="metadata-fallback-overlay__message">
        AniList API is currently unstable; Jikan API is currently active. AniList tracking is not enabled right now!
      </p>
      <button type="button" className="metadata-fallback-overlay__dismiss" onClick={handleDismiss}>
        Dismiss
      </button>
    </aside>
  )
}
