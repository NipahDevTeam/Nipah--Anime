import assert from 'node:assert/strict'
import {
  buildPreferredSourceSettingsPatch,
  getPreferredSourceSettingKey,
  resolveSavedOnlineSourcePreference,
} from './onlineSourcePreferences.js'

assert.equal(getPreferredSourceSettingKey('anime', 'es'), 'preferred_anime_source_es')
assert.equal(getPreferredSourceSettingKey('anime', 'en'), 'preferred_anime_source_en')
assert.equal(getPreferredSourceSettingKey('manga', 'es'), 'preferred_manga_source_es')
assert.equal(getPreferredSourceSettingKey('manga', 'en'), 'preferred_manga_source_en')

assert.equal(
  resolveSavedOnlineSourcePreference({
    mediaType: 'anime',
    lang: 'en',
    settings: { preferred_anime_source_en: 'animepahe-en' },
    fallbackSourceID: 'animeheaven-en',
    normalizeSourceID: (value) => value,
  }),
  'animepahe-en',
)

assert.equal(
  resolveSavedOnlineSourcePreference({
    mediaType: 'anime',
    lang: 'es',
    settings: {},
    fallbackSourceID: 'animeav1-es',
    normalizeSourceID: (value) => value,
  }),
  'animeav1-es',
)

assert.equal(
  resolveSavedOnlineSourcePreference({
    mediaType: 'manga',
    lang: 'en',
    settings: { preferred_manga_source_en: 'weebcentral' },
    fallbackSourceID: 'weebcentral-en',
    normalizeSourceID: (value) => (value === 'weebcentral' ? 'weebcentral-en' : value),
  }),
  'weebcentral-en',
)

assert.deepEqual(
  buildPreferredSourceSettingsPatch('anime', 'es', 'animeav1-es'),
  { preferred_anime_source_es: 'animeav1-es' },
)

assert.deepEqual(
  buildPreferredSourceSettingsPatch('manga', 'en', 'weebcentral-en'),
  { preferred_manga_source_en: 'weebcentral-en' },
)

console.log('online source preferences tests passed')
