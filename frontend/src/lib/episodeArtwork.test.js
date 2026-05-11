import assert from 'node:assert/strict'
import { mergeEpisodeArtworkByNumber } from './episodeArtwork.js'

const merged = mergeEpisodeArtworkByNumber(
  [{ number: 1, title: 'Episode 1' }, { number: 2, title: 'Episode 2' }],
  [{ number: 1, thumbnail: 'https://cdn.example.com/1.jpg' }],
)

assert.equal(merged[0].thumbnail, 'https://cdn.example.com/1.jpg')
assert.equal(merged[1].thumbnail, undefined)

const preservesExisting = mergeEpisodeArtworkByNumber(
  [{ number: 1, title: 'Episode 1', thumbnail: 'https://already.local/1.jpg' }],
  [{ number: 1, thumbnail: 'https://cdn.example.com/1.jpg' }],
)

assert.equal(preservesExisting[0].thumbnail, 'https://already.local/1.jpg')

console.log('episode artwork tests passed')
