import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(import.meta.dirname, 'MangaSearch.jsx')
const source = readFileSync(sourcePath, 'utf8')

function extractFunction(name) {
  const signature = `function ${name}(`
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `Expected ${name} to exist in MangaSearch.jsx`)
  const bodyStart = source.indexOf('{', start)
  assert.notEqual(bodyStart, -1, `Expected ${name} to have a function body`)

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }

  throw new Error(`Could not parse ${name} from MangaSearch.jsx`)
}

const helperFactory = new Function(`
${extractFunction('getMangaSourceResolutionGeneration')}
${extractFunction('invalidateMangaSourceResolutionGeneration')}
${extractFunction('createMangaSourceResolutionSnapshot')}
${extractFunction('isMangaSourceResolutionSnapshotCurrent')}
${extractFunction('buildStaleMangaSourceResolutionResult')}
${extractFunction('resolveMangaSourceResultIfCurrent')}
${extractFunction('resetMangaSourceSessionStateForSourceSwitch')}
${extractFunction('buildMangaActiveSourceQueryKey')}
${extractFunction('buildMangaActiveSourceSessionQueryKey')}
return {
  getMangaSourceResolutionGeneration,
  invalidateMangaSourceResolutionGeneration,
  createMangaSourceResolutionSnapshot,
  isMangaSourceResolutionSnapshotCurrent,
  buildStaleMangaSourceResolutionResult,
  resolveMangaSourceResultIfCurrent,
  resetMangaSourceSessionStateForSourceSwitch,
  buildMangaActiveSourceQueryKey,
  buildMangaActiveSourceSessionQueryKey,
}
`)

const {
  getMangaSourceResolutionGeneration,
  invalidateMangaSourceResolutionGeneration,
  createMangaSourceResolutionSnapshot,
  isMangaSourceResolutionSnapshotCurrent,
  buildStaleMangaSourceResolutionResult,
  resolveMangaSourceResultIfCurrent,
  resetMangaSourceSessionStateForSourceSwitch,
  buildMangaActiveSourceQueryKey,
  buildMangaActiveSourceSessionQueryKey,
} = helperFactory()

{
  const generations = {}
  const snapshot = createMangaSourceResolutionSnapshot(generations, 'session-1', 'source-a')
  const freshResult = { selection_key: 'session-1', source: { source_id: 'source-a' }, chapters: [{ id: '1' }] }

  assert.equal(getMangaSourceResolutionGeneration(generations, 'session-1'), 0, 'new sessions should start at generation 0')
  assert.equal(isMangaSourceResolutionSnapshotCurrent(generations, snapshot), true, 'new snapshot should be current before a switch')
  assert.deepEqual(resolveMangaSourceResultIfCurrent(generations, snapshot, freshResult), freshResult, 'current source results should still be accepted')

  invalidateMangaSourceResolutionGeneration(generations, 'session-1')

  assert.equal(getMangaSourceResolutionGeneration(generations, 'session-1'), 1, 'switching sources should bump the session generation')
  assert.equal(isMangaSourceResolutionSnapshotCurrent(generations, snapshot), false, 'older snapshots should become stale after a switch')
  assert.deepEqual(
    resolveMangaSourceResultIfCurrent(generations, snapshot, freshResult),
    buildStaleMangaSourceResolutionResult('session-1'),
    'stale source completions should be discarded instead of reusing their chapters',
  )
}

{
  assert.deepEqual(
    buildMangaActiveSourceSessionQueryKey('session-1'),
    ['manga-active-source', 'session-1'],
    'full session teardown should still target the session-wide active-source cache key',
  )

  assert.deepEqual(
    buildMangaActiveSourceQueryKey('session-1', 'source-a', 'es'),
    ['manga-active-source', 'session-1', 'source-a', 'es'],
    'source switching should target only the active source query entry being replaced',
  )
}

{
  const previousState = {
    'session-1': {
      'source-a': { source_id: 'source-a', status: 'loading', source_manga_id: 'alpha' },
      'source-b': { source_id: 'source-b', status: 'ready', source_manga_id: 'beta' },
    },
    'session-2': {
      'source-z': { source_id: 'source-z', status: 'ready', source_manga_id: 'zeta' },
    },
  }

  assert.deepEqual(
    resetMangaSourceSessionStateForSourceSwitch(previousState, 'session-1', 'source-a'),
    {
      'session-1': {
        'source-b': { source_id: 'source-b', status: 'ready', source_manga_id: 'beta' },
      },
      'session-2': {
        'source-z': { source_id: 'source-z', status: 'ready', source_manga_id: 'zeta' },
      },
    },
    'switching sources should hard-reset only the previous source entry for the active session',
  )
}

console.log('manga search source switching tests passed')
