import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const detailPath = resolve(import.meta.dirname, './OnlineMangaDetail.jsx')
const detailSource = readFileSync(detailPath, 'utf8')

const landingDetailsSidecardStart = detailSource.indexOf('<aside className="gui2-landing-sidecard">')
const landingDetailsPanelStart = detailSource.indexOf('<LandingMetaPanel title={isEnglish ? \'Details\' : \'Detalles\'} rows={detailRows} />')

assert.equal(landingDetailsSidecardStart, -1, 'gui-v2 manga landing hero should not render a duplicate Details sidecard above the chapter list')
assert.ok(landingDetailsPanelStart >= 0, 'gui-v2 manga landing should keep the lower Details panel in the aside')

console.log('online manga detail layout tests passed')
