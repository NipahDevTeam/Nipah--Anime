import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routePath = resolve(import.meta.dirname, '../Gui2MyListsRoute.jsx')
const cssPath = resolve(import.meta.dirname, '../../styles/gui2.css')

const route = readFileSync(routePath, 'utf8')
const css = readFileSync(cssPath, 'utf8')

assert.ok(route.includes('gui2-mylist-page'), 'my lists route should use the new mylist page shell')
assert.ok(route.includes('gui2-mylist-shell'), 'my lists route should render the new two-column shell')
assert.ok(route.includes('gui2-mylist-table'), 'my lists route should render the dense table contract from the source of truth')
assert.ok(route.includes('gui2-mylist-editor'), 'my lists route should render the editable detail rail')
assert.ok(route.includes('Save Changes'), 'my lists route should expose save changes action')
assert.ok(route.includes('Reset'), 'my lists route should expose reset action')
assert.ok(route.includes('handleSaveSelection'), 'my lists route should save selected entry edits explicitly')
assert.ok(route.includes('handleRemoveSelection'), 'my lists route should remove the selected entry from the editor rail')
assert.ok(route.includes('localStorage'), 'my lists route should persist lightweight editor-only fields like notes or tags')
assert.ok(!route.includes('gui2-status-grid'), 'my lists route should not keep the old status card grid anatomy')
assert.ok(!route.includes('gui2-dense-table'), 'my lists route should not keep the old dense table shell')

const requiredCssBlocks = [
  '.gui2-mylist-page',
  '.gui2-mylist-shell',
  '.gui2-mylist-table',
  '.gui2-mylist-row',
  '.gui2-mylist-editor',
  '.gui2-mylist-metrics',
]

for (const selector of requiredCssBlocks) {
  assert.ok(css.includes(selector), `css should define ${selector}`)
}

const editorFooterBlocks = [...css.matchAll(/^\s*\.gui2-mylist-editor-footer\s*\{[^}]+\}/gm)]
const editorFooterBlock = editorFooterBlocks.find((block) => block[0].includes('grid-template-columns'))
assert.ok(editorFooterBlock, 'css should define the my list editor footer block')
assert.ok(editorFooterBlock[0].includes('repeat(2, minmax(0, 1fr))'), 'editor footer should give the actions a roomier two-column grid')

console.log('my lists layout tests passed')
