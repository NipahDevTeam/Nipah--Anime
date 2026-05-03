import { useEffect, useRef, useState } from 'react'

export function useStableLoadingGate(active, options = {}) {
  const {
    delayMs = 120,
    minVisibleMs = 320,
  } = options

  const [visible, setVisible] = useState(Boolean(active))
  const shownAtRef = useRef(Boolean(active) ? Date.now() : 0)
  const delayTimerRef = useRef(null)
  const hideTimerRef = useRef(null)

  useEffect(() => {
    const clearTimers = () => {
      if (delayTimerRef.current) {
        window.clearTimeout(delayTimerRef.current)
        delayTimerRef.current = null
      }
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }

    if (active) {
      if (visible) {
        if (!shownAtRef.current) shownAtRef.current = Date.now()
        return clearTimers
      }

      clearTimers()
      delayTimerRef.current = window.setTimeout(() => {
        shownAtRef.current = Date.now()
        setVisible(true)
      }, Math.max(0, delayMs))

      return clearTimers
    }

    clearTimers()
    if (!visible) return clearTimers

    const elapsed = shownAtRef.current ? Date.now() - shownAtRef.current : minVisibleMs
    const remaining = Math.max(0, minVisibleMs - elapsed)

    hideTimerRef.current = window.setTimeout(() => {
      shownAtRef.current = 0
      setVisible(false)
    }, remaining)

    return clearTimers
  }, [active, delayMs, minVisibleMs, visible])

  return visible
}
