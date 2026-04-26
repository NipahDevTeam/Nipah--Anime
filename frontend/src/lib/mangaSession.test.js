import assert from 'node:assert/strict'

import { buildMangaSessionBaseKey, createMangaSelectionSession, mergeMangaSessionMetadata } from './mangaSession.js'

function testCanonicalSessionKey() {
  const seed = {
    mode: 'canonical',
    anilist_id: 15125,
    title: 'Seed Title',
    canonical_title: 'Seed Title',
    default_source_id: 'weebcentral-en',
  }
  const enriched = {
    ...seed,
    title: 'Enriched Title',
    canonical_title: 'Enriched Title',
  }

  assert.equal(buildMangaSessionBaseKey(seed), 'canonical:15125')
  assert.equal(buildMangaSessionBaseKey(enriched), 'canonical:15125')

  const first = createMangaSelectionSession(seed, 1, 'en')
  const second = createMangaSelectionSession(seed, 2, 'en')

  assert.equal(first.sessionKey, 'canonical:15125:1')
  assert.equal(second.sessionKey, 'canonical:15125:2')
  assert.notEqual(first.sessionKey, second.sessionKey)
}

function testDirectSessionKey() {
  const session = createMangaSelectionSession({
    mode: 'direct',
    id: 'solo-leveling',
    direct_manga_id: 'solo-leveling',
    direct_source_id: 'weebcentral-en',
    title: 'Solo Leveling',
  }, 4, 'en')

  assert.equal(session.sessionKey, 'direct:weebcentral-en:solo-leveling:4')
  assert.equal(session.sessionPreferredSourceID, 'weebcentral-en')
}

function testMetadataMergePreservesIdentity() {
  const seeded = createMangaSelectionSession({
    mode: 'canonical',
    anilist_id: 11061,
    title: 'Seed',
    default_source_id: 'weebcentral-en',
  }, 7, 'en')

  const merged = mergeMangaSessionMetadata(seeded, {
    title: 'Death Note',
    canonical_title: 'Death Note',
    resolved_description: 'A notebook changes everything.',
    default_source_id: 'm440-es',
  })

  assert.equal(merged.sessionKey, seeded.sessionKey)
  assert.equal(merged.sessionPreferredSourceID, seeded.sessionPreferredSourceID)
  assert.equal(merged.title, 'Death Note')
  assert.equal(merged.default_source_id, 'm440-es')
}

testCanonicalSessionKey()
testDirectSessionKey()
testMetadataMergePreservesIdentity()
