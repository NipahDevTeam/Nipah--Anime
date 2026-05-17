import assert from 'node:assert/strict'
import {
  GUI2_HOME_CONTINUE_LIMIT,
  GUI2_HOME_DISCOVERY_ROWS,
  GUI2_HOME_POSTER_LIMIT,
  buildGui2HomeData,
  buildGui2HomeDataFromStartupSnapshot,
  hasPrimaryHomeCatalogContent,
} from './homeData.js'

assert.equal(GUI2_HOME_POSTER_LIMIT, 20)
assert.equal(GUI2_HOME_CONTINUE_LIMIT, 6)
assert.ok(GUI2_HOME_DISCOVERY_ROWS.length >= 10, 'home should expose a broader AniList genre tab set for the rebuilt shelves')
assert.ok(
  GUI2_HOME_DISCOVERY_ROWS.some((row) => row.key === 'adventure' && row.genre === 'Adventure'),
  'home discovery rows should include Adventure for richer lane filtering',
)
assert.ok(
  GUI2_HOME_DISCOVERY_ROWS.some((row) => row.key === 'comedy' && row.genre === 'Comedy'),
  'home discovery rows should include Comedy for livelier browse lanes',
)
assert.ok(
  GUI2_HOME_DISCOVERY_ROWS.some((row) => row.key === 'mystery' && row.genre === 'Mystery'),
  'home discovery rows should include Mystery for AniList shelf variety',
)
assert.ok(
  GUI2_HOME_DISCOVERY_ROWS.some((row) => row.key === 'supernatural' && row.genre === 'Supernatural'),
  'home discovery rows should include Supernatural for deeper Home browsing',
)

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

const startupSnapshotHomeData = buildGui2HomeDataFromStartupSnapshot({
  snapshot: {
    dashboard: {
      continue_watching_online: [
        {
          episode_id: 91,
          anime_title: 'Snapshot Continue',
          cover_url: 'https://example.com/snapshot-continue.jpg',
          episode_num: 4,
        },
      ],
    },
    anime: {
      hero: {
        id: 111,
        title: { english: 'Snapshot Hero' },
        bannerImage: 'https://example.com/snapshot-hero-banner.jpg',
        coverImage: { large: 'https://example.com/snapshot-hero-cover.jpg' },
        seasonYear: 2026,
        status: 'RELEASING',
        nextAiringEpisode: { episode: 7 },
      },
      recent: [
        {
          id: 112,
          title: { english: 'Snapshot Recent 1' },
          coverImage: { large: 'https://example.com/snapshot-recent-1.jpg' },
          status: 'RELEASING',
          nextAiringEpisode: { episode: 2 },
        },
        {
          id: 113,
          title: { english: 'Snapshot Recent 2' },
          coverImage: { large: 'https://example.com/snapshot-recent-2.jpg' },
          status: 'RELEASING',
          nextAiringEpisode: { episode: 5 },
        },
        {
          id: 114,
          title: { english: 'Snapshot Recent 3' },
          coverImage: { large: 'https://example.com/snapshot-recent-3.jpg' },
          status: 'RELEASING',
          nextAiringEpisode: { episode: 9 },
        },
      ],
      shelves: [
        {
          key: 'newly-trending',
          items: [
            {
              id: 115,
              title: { english: 'Snapshot Trending 1' },
              coverImage: { large: 'https://example.com/snapshot-trending-1.jpg' },
              status: 'RELEASING',
              nextAiringEpisode: { episode: 1 },
            },
          ],
        },
        {
          key: 'popular-this-season',
          items: [
            {
              id: 116,
              title: { english: 'Snapshot Popular 1' },
              coverImage: { large: 'https://example.com/snapshot-popular-1.jpg' },
              status: 'RELEASING',
              nextAiringEpisode: { episode: 3 },
            },
          ],
        },
      ],
    },
    manga: {
      hero: {
        id: 211,
        title: { english: 'Snapshot Manga Hero' },
        banner_url: 'https://example.com/snapshot-manga-hero-banner.jpg',
        cover_url: 'https://example.com/snapshot-manga-hero-cover.jpg',
        format: 'MANGA',
      },
      recent: [
        {
          id: 212,
          title: { english: 'Snapshot Chapter Update' },
          cover_url: 'https://example.com/snapshot-chapter-update.jpg',
          chapter_number: 44,
        },
      ],
      shelves: [
        {
          key: 'fresh-manga-picks',
          items: [
            {
              id: 213,
              title: { english: 'Snapshot Manga Shelf' },
              cover_url: 'https://example.com/snapshot-manga-shelf.jpg',
              format: 'MANGA',
            },
          ],
        },
      ],
    },
  },
  isEnglish: true,
})

assert.equal(startupSnapshotHomeData.hero?.title, 'Snapshot Hero')
assert.equal(startupSnapshotHomeData.mangaHero?.title, 'Snapshot Manga Hero')
assert.equal(startupSnapshotHomeData.featuredRecentSection.items.length, 3)
assert.equal(startupSnapshotHomeData.featuredRecentSection.items[0].title, 'Snapshot Recent 1')
assert.ok(startupSnapshotHomeData.animeSections.some((section) => section.key === 'newly-trending'))
assert.ok(startupSnapshotHomeData.animeSections.some((section) => section.key === 'popular-this-season'))
assert.ok(startupSnapshotHomeData.mangaSections.some((section) => section.key === 'fresh-manga-picks'))

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
assert.equal(
  hasPrimaryHomeCatalogContent(startupOnlyContinueData),
  false,
  'dashboard-only continue shelves should not be treated as real Home readiness because they override the richer startup snapshot too early',
)

const mangaContinueOnlyData = buildGui2HomeData({
  dashboard: {
    continue_watching_online: [
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
  mangaTrending: [],
  mangaRecentItems: [],
  mangaFeaturedRows: [],
  mangaGenreRows: [],
  isEnglish: true,
})

assert.equal(
  hasPrimaryHomeCatalogContent(mangaContinueOnlyData),
  false,
  'a lone manga continue-reading shelf must not make the route prefer live Home data over the boot snapshot',
)

const mangaCatalogReadyData = buildGui2HomeData({
  dashboard: {},
  trending: aniListTrendingShape,
  mangaTrending: [
    {
      anilist_id: 601,
      title_english: 'Catalog Manga Hero',
      banner_image: 'https://example.com/catalog-manga-hero-banner.jpg',
      cover_large: 'https://example.com/catalog-manga-hero-cover.jpg',
      format: 'MANGA',
      year: 2025,
    },
  ],
  mangaRecentItems: [
    {
      anilist_id: 602,
      title_english: 'Catalog Manga Recent',
      cover_large: 'https://example.com/catalog-manga-recent.jpg',
      chapter_number: 41,
    },
  ],
  mangaFeaturedRows: [
    {
      key: 'fresh-manga-picks',
      title: 'Fresh Manga Picks',
      subtitle: 'Ready now',
      href: '/manga-online',
      items: [
        {
          anilist_id: 603,
          title_english: 'Catalog Manga Shelf',
          cover_large: 'https://example.com/catalog-manga-shelf.jpg',
          format: 'MANGA',
          year: 2024,
        },
      ],
    },
  ],
  isEnglish: true,
})

assert.equal(
  hasPrimaryHomeCatalogContent(mangaCatalogReadyData),
  true,
  'real manga catalog hero/shelves should count as primary Home content so the route can safely switch off the boot snapshot',
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
    key: 'newly-trending',
    title: 'Newly Trending Anime',
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
    key: 'popular-this-season',
    title: 'Popular This Season',
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
  items: Array.from({ length: GUI2_HOME_POSTER_LIMIT }, (_, itemIndex) => ({
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
const trendingSection = expandedHomeData.sections.find((section) => section.key === 'newly-trending')
assert.ok(trendingSection)
assert.equal(trendingSection.items.length, featuredRows[0].items.length)
const genreSection = expandedHomeData.sections.find((section) => section.key === genreRows[0].key)
assert.ok(genreSection)
assert.equal(genreSection.items.length, genreRows[0].items.length)

const distinctShelfData = buildGui2HomeData({
  dashboard: continuePoolDashboard,
  trending: aniListTrendingShape,
  featuredRows: [
    {
      key: 'popular-this-season',
      title: 'Popular This Season',
      href: '/anime-online',
      items: [
        {
          id: 801,
          title: { english: 'Season Shelf Original' },
          coverImage: { large: 'https://example.com/season-1.jpg' },
          seasonYear: 2026,
          status: 'RELEASING',
        },
      ],
    },
    {
      key: 'upcoming-watchlist',
      title: 'Upcoming',
      href: '/anime-online',
      items: [
        {
          id: 901,
          title: { english: 'Upcoming Shelf Original' },
          coverImage: { large: 'https://example.com/upcoming-1.jpg' },
          seasonYear: 2027,
          status: 'NOT_YET_RELEASED',
        },
      ],
    },
  ],
  genreRows: [],
  isEnglish: true,
})

const seasonShelf = distinctShelfData.sections.find((section) => section.key === 'popular-this-season')
const upcomingShelf = distinctShelfData.sections.find((section) => section.key === 'upcoming-watchlist')
assert.ok(seasonShelf)
assert.ok(upcomingShelf)
assert.deepEqual(seasonShelf.items.map((item) => item.title), ['Season Shelf Original'])
assert.deepEqual(upcomingShelf.items.map((item) => item.title), ['Upcoming Shelf Original'])

assert.ok(expandedHomeData.featuredRecentSection, 'home data should expose the featured recently-updated section')
assert.ok(Array.isArray(expandedHomeData.animeSections), 'home data should separate anime sections')
assert.ok(Array.isArray(expandedHomeData.mangaSections), 'home data should separate manga sections')
assert.equal(expandedHomeData.featuredRecentSection.key, 'recently-updated')

const mangaDashboard = {
  continue_reading_online_manga: [
    {
      anilist_id: 6001,
      title: 'Continue Reading One',
      canonical_title: 'Continue Reading One',
      cover_url: 'https://example.com/manga-continue-1.jpg',
      chapter_number: 18,
      chapters_read: 18,
      chapters_total: 140,
      source_id: 'weebcentral-en',
    },
  ],
  recent_manga_updates: [
    {
      anilist_id: 6101,
      title: 'Recent Chapter One',
      canonical_title: 'Recent Chapter One',
      cover_url: 'https://example.com/manga-recent-1.jpg',
      chapter_number: 44,
      updated_at_relative: '2h ago',
    },
  ],
}

const mangaRecentUpdateItems = [
  {
    id: 7101,
    anilist_id: 7101,
    title: 'Recent Catalog Update',
    cover_url: 'https://example.com/manga-recent-catalog.jpg',
    banner_image: 'https://example.com/manga-recent-catalog-banner.jpg',
    relative_time: '15m ago',
  },
]

const mangaFeaturedRows = [
  {
    key: 'recommended-for-you',
    title: 'Recommended For You',
    href: '/manga-online',
    items: [
      {
        id: 6201,
        title: { english: 'Recommended Shelf One' },
        coverImage: { large: 'https://example.com/manga-rec-1.jpg' },
        format: 'MANGA',
        genres: ['Action'],
      },
    ],
  },
  {
    key: 'fresh-manga-picks',
    title: 'Fresh Manga Picks',
    href: '/manga-online',
    items: [
      {
        id: 6301,
        title: { english: 'Fresh Shelf One' },
        coverImage: { large: 'https://example.com/manga-fresh-1.jpg' },
        format: 'MANGA',
        genres: ['Drama'],
      },
    ],
  },
]

const mangaGenreRows = [
  {
    key: 'manga-action',
    title: 'Action Essentials',
    href: '/manga-online',
    items: [
      {
        id: 6401,
        title: { english: 'Action Lane One' },
        coverImage: { large: 'https://example.com/manga-action-1.jpg' },
        format: 'MANGA',
        genres: ['Action'],
      },
    ],
  },
  {
    key: 'manga-mystery',
    title: 'Mystery Signals',
    href: '/manga-online',
    items: [
      {
        id: 6501,
        title: { english: 'Mystery Lane One' },
        coverImage: { large: 'https://example.com/manga-mystery-1.jpg' },
        format: 'MANGA',
        genres: ['Mystery'],
      },
    ],
  },
]

const mangaTrendingShape = [
  {
    id: 6601,
    title: { english: 'Banner Priority Manga' },
    banner_url: 'https://example.com/manga-hero-banner.jpg',
    cover_url: 'https://example.com/manga-hero-cover.jpg',
    format: 'MANGA',
    year: 2018,
    chapters: 272,
    genres: ['Action', 'Drama'],
    description: 'A manga hero should lead with banner art.',
  },
]

const mangaHomeData = buildGui2HomeData({
  dashboard: mangaDashboard,
  trending: aniListTrendingShape,
  featuredRows,
  genreRows,
  mangaTrending: mangaTrendingShape,
  mangaRecentItems: mangaRecentUpdateItems,
  mangaFeaturedRows,
  mangaGenreRows,
  isEnglish: true,
})

assert.equal(mangaHomeData.mangaFeaturedRecentSection.key, 'recent-chapter-updates')
assert.deepEqual(
  mangaHomeData.mangaSections.slice(0, 3).map((section) => section.key),
  ['continue-reading-manga', 'recommended-for-you', 'fresh-manga-picks'],
)
assert.ok(mangaHomeData.mangaSections.length >= 5)
assert.equal(mangaHomeData.mangaFeaturedRecentSection.items[0].chapterLabel, 'New chapter')
assert.equal(mangaHomeData.mangaFeaturedRecentSection.items[0].ageLabel, '15m ago')
assert.ok(
  mangaHomeData.mangaSections.slice(3).some((section) => section.key === 'manga-action'),
)
assert.ok(
  mangaHomeData.mangaSections.slice(3).some((section) => section.key === 'manga-mystery'),
)
assert.equal(
  mangaHomeData.mangaHero.banner,
  'https://example.com/manga-hero-banner.jpg',
  'manga home hero should prefer banner_url when the current data source already provides banner art',
)
assert.equal(
  mangaHomeData.mangaHero.image,
  'https://example.com/manga-hero-cover.jpg',
  'manga home hero should still keep the dedicated cover art for the poster rail and copy block',
)
assert.equal(
  mangaHomeData.mangaHeroSlides[0].banner,
  'https://example.com/manga-hero-banner.jpg',
  'manga hero slides should keep the same banner-first contract as the visible hero',
)

const mangaRecentUpdatePriorityData = buildGui2HomeData({
  dashboard: {
    continue_reading_online_manga: mangaDashboard.continue_reading_online_manga,
    recent_manga: [],
  },
  trending: aniListTrendingShape,
  featuredRows,
  genreRows,
  mangaTrending: mangaTrendingShape,
  mangaRecentItems: mangaRecentUpdateItems,
  mangaFeaturedRows,
  mangaGenreRows,
  isEnglish: true,
})

assert.equal(
  mangaRecentUpdatePriorityData.mangaFeaturedRecentSection.items[0].title,
  'Recent Catalog Update',
  'manga recent rail should accept explicit recent-update items instead of depending on reading history',
)
assert.equal(
  mangaRecentUpdatePriorityData.mangaFeaturedRecentSection.items[0].chapterLabel,
  'New chapter',
  'manga recent rail should default to a neutral recent-update label when no precise chapter number is available',
)
assert.equal(
  mangaRecentUpdatePriorityData.mangaFeaturedRecentSection.items[0].ageLabel,
  '15m ago',
  'manga recent rail should preserve relative time labels from explicit recent-update sources',
)

console.log('home data tests passed')
