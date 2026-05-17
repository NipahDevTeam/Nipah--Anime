import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, './OnlineAnimeDetail.jsx'), 'utf8')

assert.ok(
  source.includes('stream_candidates'),
  'online anime detail should capture alternate integrated playback candidates returned by the backend',
)

assert.ok(
  source.includes('handleIntegratedCompatibilityFailure'),
  'online anime detail should define an integrated compatibility fallback handler',
)

assert.ok(
  source.includes('lastCompatibilitySignature'),
  'online anime detail should remember the last unsupported codec signature so it can stop pointless repeated retries',
)

assert.ok(
  source.includes('onHlsCompatibilityFailure={handleIntegratedCompatibilityFailure}'),
  'online anime detail should wire integrated compatibility failures into the player component',
)

console.log('integrated player candidate fallback tests passed')
