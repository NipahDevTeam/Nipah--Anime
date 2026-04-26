import assert from 'node:assert/strict'

import {
  getMangaFallbackSearchCandidates,
  pickBestMangaSourceSearchMatch,
  scoreMangaSourceSearchMatch,
} from './mangaSourceFallback.js'

function testCandidateReuse() {
  const item = {
    title: 'Seed',
    search_candidates: ['The Martial God Who Regressed Back to Level 2', 'Martial God Regressed'],
  }

  const candidates = getMangaFallbackSearchCandidates(item)
  assert.deepEqual(candidates.slice(0, 2), [
    'The Martial God Who Regressed Back to Level 2',
    'Martial God Regressed',
  ])
}

function testBestHitSelection() {
  const needles = ['The Martial God Who Regressed Back to Level 2', 'Martial God Regressed']
  const hits = [
    { direct_source_id: 'weebcentral-en', direct_manga_id: 'wrong-one', direct_source_title: 'The Swordmaster Returns', year: 2023 },
    { direct_source_id: 'weebcentral-en', direct_manga_id: 'right-one', direct_source_title: 'The Martial God Who Regressed Back to Level 2', year: 2023 },
  ]

  const best = pickBestMangaSourceSearchMatch(hits, needles, 2023)
  assert.ok(best)
  assert.equal(best.hit.direct_manga_id, 'right-one')
  assert.ok(best.score > scoreMangaSourceSearchMatch(hits[0], needles, 2023))
}

testCandidateReuse()
testBestHitSelection()
