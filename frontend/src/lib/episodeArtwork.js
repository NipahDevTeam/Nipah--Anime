import { resolveAniListToJKAnime } from './onlineAnimeResolver.js'
import { rememberRuntimeCache } from './wails.js'

export function mergeEpisodeArtworkByNumber(episodes = [], donorEpisodes = []) {
  const thumbByNumber = new Map(
    donorEpisodes
      .filter((ep) => ep?.thumbnail && Number(ep?.number) > 0)
      .map((ep) => [Number(ep.number), ep.thumbnail]),
  )

  return episodes.map((ep) => (
    ep?.thumbnail || !thumbByNumber.has(Number(ep?.number))
      ? ep
      : { ...ep, thumbnail: thumbByNumber.get(Number(ep.number)) }
  ))
}

export async function enrichEpisodesWithAnimePaheArtwork(anime, episodes, api, lang = 'en') {
  if (!Array.isArray(episodes) || episodes.length === 0) return episodes

  return rememberRuntimeCache(
    ['animepahe-episode-art', anime?.anilist_id || anime?.id || anime?.title || 'unknown'],
    24 * 60 * 60_000,
    async () => {
      const resolved = await resolveAniListToJKAnime(anime, api, 'animepahe-en', lang)
      if (!resolved?.hit?.id) return episodes
      const donorEpisodes = await api.getOnlineEpisodes('animepahe-en', resolved.hit.id, 3500)
      return mergeEpisodeArtworkByNumber(episodes, donorEpisodes)
    },
    {
      shouldCache: (value) => Array.isArray(value) && value.some((ep) => ep?.thumbnail),
    },
  )
}
