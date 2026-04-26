const activePerfTraces = new Map()

function perfEnabled() {
  return typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)
}

export function perfStart(label, key = 'default', data = {}) {
  if (!perfEnabled()) return ''
  const token = `${label}:${key}`
  activePerfTraces.set(token, performance.now())
  console.debug(`[perf] ${label}:start`, { key, ...data })
  return token
}

export function perfMark(token, step, data = {}) {
  if (!perfEnabled() || !token) return
  const startedAt = activePerfTraces.get(token)
  const elapsedMs = typeof startedAt === 'number'
    ? Math.round(performance.now() - startedAt)
    : null
  console.debug(`[perf] ${token}:${step}`, elapsedMs == null ? data : { elapsed_ms: elapsedMs, ...data })
}

export function perfEnd(token, step = 'done', data = {}) {
  if (!perfEnabled() || !token) return
  const startedAt = activePerfTraces.get(token)
  const elapsedMs = typeof startedAt === 'number'
    ? Math.round(performance.now() - startedAt)
    : null
  activePerfTraces.delete(token)
  console.debug(`[perf] ${token}:${step}`, elapsedMs == null ? data : { elapsed_ms: elapsedMs, ...data })
}
