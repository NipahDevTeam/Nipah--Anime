import { useState, useCallback, useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Toast store — simple module-level state so any component can fire a toast
// ─────────────────────────────────────────────────────────────────────────────

let _listeners = []
let _idCounter = 0

export function toast(message, type = 'info', duration = 4000) {
  const id = ++_idCounter
  const entry = { id, message, type, duration }
  _listeners.forEach(fn => fn(entry))
  return id
}

export const toastError   = (msg) => toast(msg, 'error', 5000)
export const toastSuccess = (msg) => toast(msg, 'success', 3000)
export const toastInfo    = (msg) => toast(msg, 'info', 3000)

// ─────────────────────────────────────────────────────────────────────────────
// ToastContainer — mount once in Layout
// ─────────────────────────────────────────────────────────────────────────────

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    clearTimeout(timers.current[id])
    delete timers.current[id]
  }, [])

  useEffect(() => {
    const handler = (entry) => {
      setToasts(prev => [...prev.slice(-4), entry]) // max 5 visible
      timers.current[entry.id] = setTimeout(() => remove(entry.id), entry.duration)
    }
    _listeners.push(handler)
    return () => {
      _listeners = _listeners.filter(fn => fn !== handler)
    }
  }, [remove])

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => remove(t.id)}>
          <span className="toast-icon">
            {t.type === 'error' ? '✕' : t.type === 'success' ? '✓' : 'ℹ'}
          </span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
