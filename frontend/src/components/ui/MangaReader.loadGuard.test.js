import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const componentPath = resolve(import.meta.dirname, './MangaReader.jsx')
const componentSource = readFileSync(componentPath, 'utf8')
const normalizedSource = componentSource.replace(/\s+/g, ' ')

assert.ok(
  componentSource.includes('const chapterLoadGeneration = useRef(0)'),
  'reader should track a chapter-load generation ref so stale async requests can be ignored',
)

assert.ok(
  componentSource.includes('const loadGeneration = ++chapterLoadGeneration.current'),
  'reader should capture a unique generation for each chapter/source load attempt',
)

assert.ok(
  componentSource.includes('const blockingPreloadResults = await Promise.allSettled(nextPages.slice(0, blockingPreloadCount).map(preloadReaderPage))'),
  'reader should await the first visible page preloads and capture their intrinsic metrics before revealing a paged chapter',
)

assert.ok(
  componentSource.includes('setPageIntrinsicSizes(blockingMetrics)'),
  'reader should seed visible page intrinsic sizes from the blocking preload results to avoid first-render layout snaps',
)

assert.ok(
  normalizedSource.includes('if (chapterLoadGeneration.current !== loadGeneration) return'),
  'reader should bail out when an older chapter load resolves after a newer one starts',
)

assert.ok(
  /\.catch\(\(e\)\s*=>\s*\{\s*if\s*\(chapterLoadGeneration\.current\s*!==\s*loadGeneration\)\s*return\s+setError\(/.test(componentSource),
  'reader should ignore stale load errors instead of surfacing them over the active chapter',
)

assert.ok(
  /\.finally\(\(\)\s*=>\s*\{\s*if\s*\(chapterLoadGeneration\.current\s*!==\s*loadGeneration\)\s*return\s+setLoading\(false\)/.test(componentSource),
  'reader should not let stale chapter loads clear the active loading state in finally',
)

assert.ok(
  componentSource.includes('createPortal(') || componentSource.includes('reader-settings-panel'),
  'reader rebuild should keep settings as an explicit overlay surface instead of an inline content column',
)

console.log('manga reader load guard tests passed')
