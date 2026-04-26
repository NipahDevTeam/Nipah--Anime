import assert from 'node:assert/strict'

import { buildMyListsOverviewCards, filterAndSortMangaEntries } from './myListsView.js'

function testFilterAndSortMangaEntries() {
  const entries = [
    { title: 'Chainsaw Man', title_english: 'Chainsaw Man', status: 'WATCHING', year: 2022, score: 8, chapters_read: 12, updated_at: '2026-04-11' },
    { title: 'Blue Lock', title_english: 'Blue Lock', status: 'PLANNING', year: 2021, score: 9, chapters_read: 0, updated_at: '2026-04-09' },
    { title: 'Vagabond', title_english: 'Vagabond', status: 'COMPLETED', year: 1998, score: 10, chapters_read: 30, updated_at: '2026-04-10' },
  ]

  const filtered = filterAndSortMangaEntries(entries, {
    query: 'man',
    status: 'WATCHING',
    sort: 'TITLE_ASC',
    year: '2022',
  })

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].title, 'Chainsaw Man')

  const sorted = filterAndSortMangaEntries(entries, { sort: 'PROGRESS_DESC' })
  assert.equal(sorted[0].title, 'Vagabond')
}

function testBuildMyListsOverviewCards() {
  const animeCards = buildMyListsOverviewCards({
    activeMediaType: 'anime',
    animeEntries: [
      { status: 'WATCHING', episodes_watched: 5 },
      { status: 'COMPLETED', episodes_watched: 12 },
    ],
    isEnglish: true,
  })

  assert.equal(animeCards[0].label, 'Watching')
  assert.equal(animeCards[2].value, '17')

  const mangaCards = buildMyListsOverviewCards({
    activeMediaType: 'manga',
    mangaEntries: [
      { status: 'WATCHING', chapters_read: 15 },
      { status: 'COMPLETED', chapters_read: 120 },
    ],
    filteredMangaEntries: [{}, {}],
    isEnglish: false,
  })

  assert.equal(mangaCards[0].label, 'Visibles ahora')
  assert.equal(mangaCards[0].value, '2')
  assert.equal(mangaCards[3].value, '135')
}

testFilterAndSortMangaEntries()
testBuildMyListsOverviewCards()
