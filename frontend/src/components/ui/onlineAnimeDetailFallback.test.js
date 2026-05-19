import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const detailPath = resolve(import.meta.dirname, './OnlineAnimeDetail.jsx')
const detailSource = readFileSync(detailPath, 'utf8')

assert.ok(detailSource.includes('wails.getAnimeByMalID(currentMalID)'), 'online anime detail should fetch fallback detail by MAL id when AniList identity is unavailable')
assert.ok(detailSource.includes('metadataFallbackActive && currentMalID > 0'), 'online anime detail should only use the MAL-detail fallback when Jikan mode is active and a MAL id exists')
assert.ok(detailSource.includes('const detailQueryIdentity = useMemo(() => {'), 'online anime detail should derive a dedicated detail-query identity for fallback-backed titles')
assert.ok(detailSource.includes("queryKey: ['anime-detail-anilist-v3', detailQueryIdentity, lang]"), 'online anime detail should key detail caching by the resolved identity instead of only AniList id')
assert.ok(detailSource.includes('return `mal:${currentMalID}`'), 'online anime detail should isolate MAL-backed detail payloads into their own cache entries')
assert.ok(detailSource.includes("return `title:${anime.source_id}:${normalizedTitle}`"), 'online anime detail should isolate title-only fallback detail payloads when no AniList or MAL id is available')

console.log('online anime detail fallback tests passed')
