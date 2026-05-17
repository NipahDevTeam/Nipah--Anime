import assert from 'node:assert/strict'
import { getIntegratedPlaybackSupport } from './integratedVideoPlayerCompatibility.js'

assert.deepEqual(
  getIntegratedPlaybackSupport({
    streamKind: 'hls',
    streamURL: 'http://127.0.0.1:43212/proxy/media?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8',
  }),
  {
    normalizedKind: 'hls',
    supported: true,
    playbackMode: 'hls',
    reason: '',
  },
)

assert.deepEqual(
  getIntegratedPlaybackSupport({
    streamKind: 'file',
    streamURL: 'https://cdn.example/video.mp4',
  }),
  {
    normalizedKind: 'file',
    supported: true,
    playbackMode: 'native',
    reason: '',
  },
)

assert.deepEqual(
  getIntegratedPlaybackSupport({
    streamKind: 'file',
    streamURL: 'http://127.0.0.1:43212/proxy/media?url=https%3A%2F%2Fcdn.example%2Fepisode.webm',
    rawStreamURL: 'https://cdn.example/episode.webm?token=abc',
    proxyURL: 'http://127.0.0.1:43212/proxy/media?url=https%3A%2F%2Fcdn.example%2Fepisode.webm',
  }),
  {
    normalizedKind: 'file',
    supported: true,
    playbackMode: 'native',
    reason: '',
  },
)

assert.deepEqual(
  getIntegratedPlaybackSupport({
    streamKind: 'transcoded',
    streamURL: 'http://127.0.0.1:43212/proxy/transcode?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8',
  }),
  {
    normalizedKind: 'file',
    supported: true,
    playbackMode: 'native',
    reason: '',
  },
)

assert.deepEqual(
  getIntegratedPlaybackSupport({
    streamKind: 'dash',
    streamURL: 'https://cdn.example/manifest.mpd',
  }),
  {
    normalizedKind: 'dash',
    supported: false,
    playbackMode: 'unsupported',
    reason: 'This stream uses DASH, which the integrated player does not support yet.',
  },
)

assert.deepEqual(
  getIntegratedPlaybackSupport({
    streamKind: 'page',
    streamURL: 'https://provider.example/watch.php?id=77',
  }),
  {
    normalizedKind: 'page',
    supported: false,
    playbackMode: 'unsupported',
    reason: 'This source returned a web page instead of direct media, so it should open in MPV.',
  },
)

console.log('integrated video player compatibility tests passed')
