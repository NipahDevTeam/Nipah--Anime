import assert from 'node:assert/strict'
import {
  GUI2_HOME_CONTINUE_LIMIT,
  GUI2_HOME_DISCOVERY_ROWS,
  GUI2_HOME_POSTER_LIMIT,
  buildGui2HomeData,
} from './homeData.js'

assert.equal(GUI2_HOME_POSTER_LIMIT, 10)
assert.equal(GUI2_HOME_CONTINUE_LIMIT, 6)

const aniListTrendingShape = [
  {
    id: 101,
    title: {
      english: 'Neon Requiem',
      romaji: 'Neon Requiem',
      native: 'ネオンレクイエム',
    },
    bannerImage: 'https://example.com/banner.jpg',
    coverImage: {
      large: 'https://example.com/cover.jpg',
      extraLarge: 'https://example.com/cover-xl.jpg',
    },
    description: 'A late-night thriller.',
    seasonYear: 2026,
    episodes: 12,
    genres: ['Action', 'Sci-Fi'],
  },
]

const homeData = buildGui2HomeData({
  dashboard: {},
  trending: aniListTrendingShape,
  isEnglish: true,
})

assert.equal(homeData.hero.title, 'Neon Requiem')
assert.equal(homeData.heroSlides[0].title, 'Neon Requiem')
assert.equal(typeof homeData.hero.title, 'string')
assert.equal(typeof homeData.heroSlides[0].title, 'string')

const continuePoolDashboard = {
  continue_watching_online: Array.from({ length: 8 }, (_, index) => ({
    episode_id: index + 1,
    anime_title: `Continue ${index + 1}`,
    cover_url: `https://example.com/${index + 1}.jpg`,
    episode_num: index + 1,
  })),
}

const continueLayoutData = buildGui2HomeData({
  dashboard: continuePoolDashboard,
  trending: aniListTrendingShape,
  isEnglish: true,
})

const continueSection = continueLayoutData.sections.find((section) => section.key === 'continue-watching')
assert.ok(continueSection)
assert.equal(continueSection.items.length, 8)
assert.equal(continueSection.pageSize, GUI2_HOME_CONTINUE_LIMIT)
assert.equal(continueSection.actionLabel, '')
assert.equal(continueSection.items[0].selectedAnime.episode_id, 1)
assert.equal(continueSection.items[0].selectedAnime.anime_title, 'Continue 1')

const startupOnlyContinueData = buildGui2HomeData({
  dashboard: continuePoolDashboard,
  trending: [],
  featuredRows: [],
  genreRows: [],
  isEnglish: true,
})

assert.equal(
  startupOnlyContinueData.sections.some((section) => section.key === 'continue-watching'),
  false,
  'GUI2 home should not let the continue-watching shelf become the only visible startup content before AniList shelves are ready',
)

const mixedContinueData = buildGui2HomeData({
  dashboard: {
    continue_watching_online: [
      {
        episode_id: 1,
        anime_title: 'Anime Continue 1',
        cover_url: 'https://example.com/anime-1.jpg',
        episode_num: 1,
        source_id: 'animeheaven-en',
      },
      {
        episode_id: 2,
        anime_title: 'Manga Continue 1',
        cover_url: 'https://example.com/manga-1.jpg',
        episode_num: 12,
        source_id: 'weebcentral-en',
      },
    ],
  },
  trending: aniListTrendingShape,
  isEnglish: true,
})

const mixedContinueSection = mixedContinueData.sections.find((section) => section.key === 'continue-watching')
assert.ok(mixedContinueSection)
assert.deepEqual(
  mixedContinueSection.items.map((item) => item.title),
  ['Anime Continue 1'],
)

const featuredRows = [
  {
    key: 'popular-now',
    title: 'Popular Now',
    href: '/anime-online',
    items: [
      {
        id: 201,
        title: { english: 'Airing Hero' },
        coverImage: { large: 'https://example.com/a.jpg' },
        seasonYear: 2026,
        status: 'RELEASING',
        nextAiringEpisode: { episode: 12 },
      },
      {
        id: 202,
        title: { english: 'Finished Hero' },
        coverImage: { large: 'https://example.com/b.jpg' },
        seasonYear: 2024,
        status: 'FINISHED',
      },
    ],
  },
  {
    key: 'trending-season',
    title: 'Trending This Season',
    href: '/anime-online',
    items: [
      {
        id: 203,
        title: { english: 'Current Favorite' },
        coverImage: { large: 'https://example.com/c.jpg' },
        seasonYear: 2026,
        status: 'RELEASING',
        nextAiringEpisode: { episode: 5 },
      },
    ],
  },
]

const recentUpdateData = buildGui2HomeData({
  dashboard: {
    recent_anime: [
      {
        id: 999,
        anime_title: 'Local History Title',
        cover_url: 'https://example.com/local.jpg',
        status: 'FINISHED',
      },
    ],
  },
  trending: aniListTrendingShape,
  featuredRows,
  genreRows: [],
  isEnglish: true,
})

assert.deepEqual(
  recentUpdateData.recentUpdates.map((item) => item.title),
  ['Airing Hero', 'Current Favorite'],
)
assert.ok(!recentUpdateData.recentUpdates.some((item) => item.title === 'Local History Title'))

const startupDashboardFallbackData = buildGui2HomeData({
  dashboard: {
    recent_anime: [
      {
        id: 401,
        anime_title: 'Local-Looking Dashboard Item',
        cover_url: 'https://example.com/local-dashboard.jpg',
        status: 'FINISHED',
      },
    ],
  },
  trending: [],
  featuredRows: [],
  genreRows: [],
  isEnglish: true,
})

assert.equal(startupDashboardFallbackData.hero, null)
assert.equal(startupDashboardFallbackData.sections.length, 0)
assert.equal(startupDashboardFallbackData.recentUpdates.length, 0)

const genreRows = GUI2_HOME_DISCOVERY_ROWS.slice(0, 4).map((row, rowIndex) => ({
  key: row.key,
  title: row.titleEn,
  subtitle: row.subtitleEn,
  href: '/anime-online',
  items: Array.from({ length: 12 }, (_, itemIndex) => ({
    id: rowIndex * 100 + itemIndex + 1,
    title: { english: `${row.titleEn} ${itemIndex + 1}` },
    coverImage: { large: `https://example.com/${row.key}-${itemIndex + 1}.jpg` },
    seasonYear: 2026,
    status: 'RELEASING',
    genres: [row.genre],
  })),
}))

const expandedHomeData = buildGui2HomeData({
  dashboard: continuePoolDashboard,
  trending: aniListTrendingShape,
  featuredRows,
  genreRows,
  isEnglish: true,
})

assert.ok(expandedHomeData.sections.length >= 1 + featuredRows.length + genreRows.length)
const popularNowSection = expandedHomeData.sections.find((section) => section.key === 'popular-now')
assert.ok(popularNowSection)
assert.equal(popularNowSection.items.length, GUI2_HOME_POSTER_LIMIT)
const genreSection = expandedHomeData.sections.find((section) => section.key === genreRows[0].key)
assert.ok(genreSection)
assert.equal(genreSection.items.length, GUI2_HOME_POSTER_LIMIT)

console.log('home data tests passed')
