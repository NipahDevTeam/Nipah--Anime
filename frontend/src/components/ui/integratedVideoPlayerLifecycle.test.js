import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const playerSource = readFileSync(resolve(import.meta.dirname, './IntegratedVideoPlayer.jsx'), 'utf8')
const detailSource = readFileSync(resolve(import.meta.dirname, './OnlineAnimeDetail.jsx'), 'utf8')

assert.equal(
  playerSource.includes('initialPositionSec, onPlaybackEnd, onPlaybackUpdate, open, proxyURL, rawStreamURL, sourceLabel, streamHost, streamKind, streamURL, subtitle, title'),
  false,
  'integrated player effect should not depend on resume progress or parent callback identities that change during playback',
)

assert.equal(
  detailSource.includes('onPlaybackEnd={(positionSec, durationSec) => closeIntegratedPlayback(true, positionSec, durationSec)}'),
  false,
  'online anime detail should pass a stable playback-end callback so the integrated player session is not recreated on every parent render',
)

console.log('integrated video player lifecycle tests passed')
