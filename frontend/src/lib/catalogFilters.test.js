import assert from 'node:assert/strict'
import { buildAnimeCatalogFetchArgs, buildMangaCatalogFetchArgs } from './catalogFilters.js'

assert.deepEqual(
  buildAnimeCatalogFetchArgs({
    sort: 'SCORE_DESC',
    page: 3,
    genres: ['Comedy', 'Ecchi'],
    season: 'SPRING',
    year: 2025,
    format: 'TV',
    status: 'RELEASING',
  }),
  {
    sort: 'SCORE_DESC',
    page: 3,
    genres: 'Comedy,Ecchi',
    season: 'SPRING',
    year: 2025,
    format: 'TV',
    status: 'RELEASING',
  },
  'Anime Online catalog fetches should forward the full filter payload to the backend',
)

assert.deepEqual(
  buildMangaCatalogFetchArgs({
    sort: 'POPULARITY_DESC',
    page: 2,
    genres: ['Drama'],
    year: 2024,
    format: 'NOVEL',
    status: 'FINISHED',
  }),
  {
    sort: 'POPULARITY_DESC',
    page: 2,
    genres: 'Drama',
    year: 2024,
    format: 'NOVEL',
    status: 'FINISHED',
  },
  'Manga Online catalog fetches should forward the full filter payload to the backend',
)

console.log('catalog filter helper tests passed')
