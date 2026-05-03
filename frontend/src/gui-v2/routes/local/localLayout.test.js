import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cssPath = resolve(import.meta.dirname, '../../styles/gui2.css')
const localPagePath = resolve(import.meta.dirname, '../../../pages/Local.jsx')
const animeRoutePath = resolve(import.meta.dirname, '../Gui2AnimeDetailRoute.jsx')
const mangaRoutePath = resolve(import.meta.dirname, '../Gui2MangaDetailRoute.jsx')

const css = readFileSync(cssPath, 'utf8')
const localPage = readFileSync(localPagePath, 'utf8')
const animeRoute = readFileSync(animeRoutePath, 'utf8')
const mangaRoute = readFileSync(mangaRoutePath, 'utf8')

const activityButtonBlock = css.match(/\.gui2-localv2-activity-button\s*\{[^}]+\}/)
const selectBlock = css.match(/\.gui2-localv2-select\s*\{[^}]+\}/)
const optionBlock = css.match(/\.gui2-localv2-select option\s*\{[^}]+\}/)

assert.ok(activityButtonBlock, 'local activity button CSS block should exist')
assert.ok(selectBlock, 'local select CSS block should exist')
assert.ok(optionBlock, 'local select option CSS block should exist')

assert.ok(activityButtonBlock[0].includes('border: 0'), 'activity buttons should not show the browser border outline')
assert.ok(activityButtonBlock[0].includes('outline: none'), 'activity buttons should suppress the default outline treatment')
assert.ok(selectBlock[0].includes('color-scheme: dark'), 'local selects should opt into dark native dropdown chrome')
assert.ok(optionBlock[0].includes('background'), 'local select options should provide a dark dropdown surface')
assert.ok(optionBlock[0].includes('color'), 'local select options should provide visible dropdown text')
assert.ok(!localPage.includes("navigate('/sources')"), 'local library should not expose the hidden sources shortcut in the header action row')

assert.ok(animeRoute.includes('gui2-landing-page gui2-landing-page--anime'), 'local anime route should use the landing-page system')
assert.ok(mangaRoute.includes('gui2-landing-page gui2-landing-page--manga'), 'local manga route should use the landing-page system')
assert.ok(!animeRoute.includes('gui2-detail-page'), 'local anime route should not use the old gui2 detail page shell')
assert.ok(!mangaRoute.includes('gui2-detail-page'), 'local manga route should not use the old gui2 detail page shell')
assert.ok(!animeRoute.includes('Local anime landing'), 'local anime route should not inject the old local landing eyebrow copy')
assert.ok(!mangaRoute.includes('Local manga landing'), 'local manga route should not inject the old local landing eyebrow copy')
assert.ok(animeRoute.includes('buildEpisodeGroups'), 'local anime route should preserve subfolder grouping')
assert.ok(animeRoute.includes('folder_name'), 'local anime route should still read folder_name from episode payloads')

console.log('local layout tests passed')
