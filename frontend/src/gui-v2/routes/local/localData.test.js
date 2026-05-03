import assert from 'node:assert/strict'
import {
  GUI2_LOCAL_GRID_LIMIT,
  GUI2_LOCAL_RECENT_WINDOW_DAYS,
  buildGui2LocalActivity,
  buildGui2LocalCatalog,
  buildGui2LocalOverview,
} from './localData.js'

const now = new Date('2026-05-01T12:00:00.000Z')

const animeItems = [
  {
    id: 1,
    anilist_id: 101,
    display_title: 'Re:Zero',
    title_romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu',
    title_english: 'Re:Zero - Starting Life in Another World',
    cover_image: 'https://example.com/rezero.jpg',
    status: 'RELEASING',
    year: 2016,
    episodes_total: 16,
    added_at: '2026-04-30T05:00:00.000Z',
    updated_at: '2026-05-01T08:00:00.000Z',
  },
  {
    id: 2,
    anilist_id: 102,
    display_title: 'Frieren',
    title_romaji: 'Sousou no Frieren',
    title_english: 'Frieren: Beyond Journey\'s End',
    cover_image: 'https://example.com/frieren.jpg',
    status: 'FINISHED',
    year: 2024,
    episodes_total: 28,
    added_at: '2026-04-22T05:00:00.000Z',
    updated_at: '2026-04-24T05:00:00.000Z',
  },
]

const mangaItems = [
  {
    id: 7,
    anilist_id: 301,
    display_title: 'Berserk',
    title_romaji: 'Berserk',
    title_english: 'Berserk',
    cover_image: 'https://example.com/berserk.jpg',
    status: 'ONGOING',
    year: 1989,
    chapters_total: 42,
    added_at: '2026-04-29T05:00:00.000Z',
    updated_at: '2026-04-30T07:00:00.000Z',
  },
]

const downloadItems = [
  {
    id: 11,
    anime_title: 'Re:Zero',
    episode_num: 16,
    status: 'completed',
    file_size: 8 * 1024 * 1024 * 1024,
    created_at: '2026-04-28T02:00:00.000Z',
  },
]

const libraryPaths = [
  { id: 1, path: 'D:/Anime', type: 'anime' },
  { id: 2, path: 'D:/Manga', type: 'manga' },
  { id: 3, path: 'E:/Media', type: 'mixed' },
]

assert.equal(GUI2_LOCAL_GRID_LIMIT, 10)
assert.equal(GUI2_LOCAL_RECENT_WINDOW_DAYS, 7)

const overview = buildGui2LocalOverview({
  animeItems,
  mangaItems,
  downloadItems,
  libraryPaths,
  now,
  isEnglish: true,
})

assert.equal(overview.totalAnime.value, 2)
assert.equal(overview.totalManga.value, 1)
assert.equal(overview.recentlyAdded.value, 2)
assert.equal(overview.sources.value, 3)
assert.equal(overview.storageUsed.value, '8.00 GB')

const allCatalog = buildGui2LocalCatalog({
  animeItems,
  mangaItems,
  activeTab: 'all',
  sort: 'RECENT',
  query: '',
  isEnglish: true,
})

assert.equal(allCatalog.length, 3)
assert.equal(allCatalog[0].selectionKey, 'anime-1')
assert.equal(allCatalog[1].selectionKey, 'manga-7')
assert.equal(allCatalog[2].selectionKey, 'anime-2')
assert.ok(allCatalog.every((item) => typeof item.metaLine === 'string'))

const filteredCatalog = buildGui2LocalCatalog({
  animeItems,
  mangaItems,
  activeTab: 'all',
  sort: 'TITLE',
  query: 'berserk',
  isEnglish: true,
})

assert.equal(filteredCatalog.length, 1)
assert.equal(filteredCatalog[0].kind, 'manga')

const activity = buildGui2LocalActivity({
  animeItems,
  mangaItems,
  downloadItems,
  scanResult: {
    files_scanned: 128,
    anime_found: 2,
    manga_found: 1,
    scanned_path: 'D:/Anime',
  },
  now,
  isEnglish: true,
})

assert.equal(activity[0].kind, 'scan')
assert.match(activity[0].title, /Scan completed/i)
assert.equal(activity[1].selectionKey, 'anime-1')

console.log('local data tests passed')
