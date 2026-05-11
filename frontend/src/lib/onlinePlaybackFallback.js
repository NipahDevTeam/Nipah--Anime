function normalizeAudioFlavor(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return ''
  return text === 'dub' ? 'dub' : text === 'sub' ? 'sub' : ''
}

export function providerUsesExplicitEpisodeAudioVariant(sourceID) {
  return String(sourceID ?? '').trim().toLowerCase() === 'animegg-en'
}

export function shouldAllowAutomaticAudioFallback({
  sourceID,
  supportsAudioVariants,
  currentAudio,
  fallbackAudio,
}) {
  if (!supportsAudioVariants) return false
  if (!providerUsesExplicitEpisodeAudioVariant(sourceID)) return false

  const current = normalizeAudioFlavor(currentAudio)
  const fallback = normalizeAudioFlavor(fallbackAudio)
  return current !== '' && fallback !== '' && current !== fallback
}
