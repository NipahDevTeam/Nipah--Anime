import assert from 'node:assert/strict'
import { isAniListUnavailableErrorMessage } from './anilistStatus.js'

assert.equal(
  isAniListUnavailableErrorMessage('metadata request failed:429 (Too Many Requests.)'),
  true,
  'AniList rate limit errors should be classified as temporary AniList unavailability',
)

assert.equal(
  isAniListUnavailableErrorMessage('AniList API unavailable: temporarily disabled due to severe stability issues'),
  true,
  'AniList upstream outage errors should still be classified as unavailable',
)

assert.equal(
  isAniListUnavailableErrorMessage('Search error: boom'),
  false,
  'Generic search errors should not be misclassified as AniList outages',
)

console.log('anilist status tests passed')
