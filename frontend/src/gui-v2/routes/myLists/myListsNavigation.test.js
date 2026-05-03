import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routePath = resolve(import.meta.dirname, '../Gui2MyListsRoute.jsx')
const route = readFileSync(routePath, 'utf8')

assert.ok(route.includes('handleOpenSelected'), 'my lists route should keep an explicit open action for the selected title')
assert.ok(route.includes('Open in Anime Online'), 'my lists route should expose a direct anime open action in the editor rail')
assert.ok(route.includes('Open in Manga Online'), 'my lists route should expose a direct manga open action in the editor rail')
assert.ok(route.includes('state: buildAnimeNavigationState(entry'), 'anime list open should use the instant AniList-seeded detail flow')
assert.ok(route.includes('state: buildMangaListNavigationState(entry)'), 'manga list open should keep the seeded canonical open flow')
assert.ok(route.includes('onDoubleClick={() => handleOpenEntry(entry, activeMediaType)}'), 'my lists rows should open the selected entry on double click without removing the explicit open button')

console.log('my lists navigation tests passed')
