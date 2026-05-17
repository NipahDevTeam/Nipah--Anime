export function pickEpisodeArtwork({
  providerThumbnail = '',
  anilistThumbnail = '',
  cachedThumbnail = '',
  fallbackArtwork = '',
} = {}) {
  return (
    String(providerThumbnail || '').trim()
    || String(anilistThumbnail || '').trim()
    || String(cachedThumbnail || '').trim()
    || String(fallbackArtwork || '').trim()
    || ''
  )
}
