export function isAniListUnavailableErrorMessage(errorLike) {
  const message = String(errorLike?.message ?? errorLike ?? '').toLowerCase()
  return message.includes('anilist api unavailable')
    || message.includes('metadata request failed: 429')
    || message.includes('too many requests')
    || message.includes('rate limit')
    || (message.includes('temporarily disabled') && message.includes('stability issues'))
    || (message.includes('anilist') && message.includes('timeout'))
    || (message.includes('anilist') && message.includes('timed out'))
    || message.includes('context deadline exceeded')
    || message.includes('client.timeout exceeded')
}

export function isAniListMetadataFallbackActive(status) {
  return status?.anilist_mode === 'degraded' && status?.fallback_provider === 'jikan'
}

export function getAniListMetadataFallbackActivationKey(status) {
  const activatedAtUnix = Number(status?.activated_at_unix || 0)
  if (activatedAtUnix > 0) return String(activatedAtUnix)
  if (isAniListMetadataFallbackActive(status)) return 'active'
  return ''
}
