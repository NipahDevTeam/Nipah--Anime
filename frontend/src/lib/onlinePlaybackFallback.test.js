import assert from 'node:assert/strict'

import {
  providerUsesExplicitEpisodeAudioVariant,
  shouldAllowAutomaticAudioFallback,
} from './onlinePlaybackFallback.js'

assert.equal(
  providerUsesExplicitEpisodeAudioVariant('animegg-en'),
  true,
  'AnimeGG should keep explicit episode audio variants enabled',
)

assert.equal(
  providerUsesExplicitEpisodeAudioVariant('animepahe-en'),
  false,
  'AnimePahe should not be treated as an explicit per-audio episode source',
)

assert.equal(
  shouldAllowAutomaticAudioFallback({
    sourceID: 'animepahe-en',
    supportsAudioVariants: true,
    currentAudio: 'sub',
    fallbackAudio: 'dub',
  }),
  false,
  'AnimePahe should not auto-retry playback with a duplicate audio fallback request',
)

assert.equal(
  shouldAllowAutomaticAudioFallback({
    sourceID: 'animegg-en',
    supportsAudioVariants: true,
    currentAudio: 'sub',
    fallbackAudio: 'dub',
  }),
  true,
  'AnimeGG should allow automatic fallback when the fallback changes the explicit episode variant',
)

console.log('online playback fallback tests passed')
