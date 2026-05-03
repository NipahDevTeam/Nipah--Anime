export function extractAniListAnimeSearchMedia(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data?.Page?.media)) return payload.data.Page.media
  if (Array.isArray(payload?.Page?.media)) return payload.Page.media
  if (Array.isArray(payload?.media)) return payload.media
  return []
}
