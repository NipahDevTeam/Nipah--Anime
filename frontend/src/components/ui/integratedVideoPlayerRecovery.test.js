import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, './IntegratedVideoPlayer.jsx'), 'utf8')

assert.ok(
  source.includes('hls.startLoad()'),
  'integrated player should attempt HLS network recovery before giving up on fatal stream errors',
)

assert.ok(
  source.includes('hls.recoverMediaError()'),
  'integrated player should attempt HLS media recovery before surfacing a fatal playback failure',
)

assert.ok(
  source.includes('hls.swapAudioCodec()'),
  'integrated player should escalate repeated HLS media recovery by swapping the audio codec before giving up',
)

assert.ok(
  source.includes('video_error_during_hls_recovery'),
  'integrated player should ignore transient native video errors while an HLS recovery attempt is already in flight',
)

assert.ok(
  source.includes('onHlsCompatibilityFailure'),
  'integrated player should expose a compatibility failure hook so the parent view can try a fallback stream before giving up',
)

assert.ok(
  source.includes('mime_type: data?.mimeType ??'),
  'integrated player should record HLS mime type details so live diagnostics can identify unsupported codec paths',
)

assert.ok(
  source.includes('isUnsupportedHlsCompatibilityFailure'),
  'integrated player should classify unsupported codec failures before attempting generic media recovery',
)

assert.ok(
  source.includes('hls_compatibility_failure'),
  'integrated player should emit a dedicated diagnostic when the webview rejects a stream codec',
)

console.log('integrated video player recovery tests passed')
