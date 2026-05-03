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
