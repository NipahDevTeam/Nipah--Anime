import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const stagePath = resolve(import.meta.dirname, './LandingRecommendationsStage.jsx')
const cssPath = resolve(import.meta.dirname, '../../../gui-v2/styles/gui2.css')
const stageSource = readFileSync(stagePath, 'utf8')
const cssSource = readFileSync(cssPath, 'utf8')

assert.ok(stageSource.includes('function RecommendationCard({ item, onSelectItem = null }) {'), 'recommendation stage should accept a shared click callback for interactive cards')
assert.ok(stageSource.includes("const isInteractive = typeof onSelectItem === 'function'"), 'recommendation stage should explicitly detect when cards should be interactive')
assert.ok(stageSource.includes('type="button"'), 'recommendation stage should render real buttons for interactive recommendation cards')
assert.ok(stageSource.includes('onClick={() => onSelectItem?.(item)}'), 'recommendation stage should forward the selected recommendation item through the shared callback')
assert.ok(stageSource.includes('onSelectItem={onSelectItem}'), 'recommendation stage should pass the click callback down to each recommendation card')
assert.ok(stageSource.includes('placeholderCount = 5'), 'recommendation stage should reserve five placeholders by default so the shelf footprint stays stable')
assert.ok(stageSource.includes('items.slice(0, 5)'), 'recommendation stage should clamp visible cards to five items')
assert.ok(stageSource.includes('const hasItems = visibleItems.length > 0'), 'recommendation stage should explicitly branch between recovered cards and an empty-state message')
assert.ok(stageSource.includes('className="media-detail-empty-copy gui2-landing-recommendations-empty"'), 'recommendation stage should show a single empty-state message when no recommendations are available')
assert.equal(stageSource.indexOf('PlaceholderCard('), -1, 'recommendation stage should not render synthetic placeholder cards once MAL response data is known')
assert.equal(stageSource.indexOf('gui2-landing-section-copy gui2-landing-section-copy--recommendations'), -1, 'recommendation stage should not render redundant helper copy above the recommendation shelf')
assert.ok(cssSource.includes('.gui2-landing-recommendations-grid {'), 'recommendation shelf should define explicit CSS for the card grid')
assert.ok(cssSource.includes('grid-template-columns: repeat(5, minmax(0, 1fr));'), 'recommendation shelf should still keep five fixed desktop tracks')
assert.ok(cssSource.includes('.gui2-landing-recommendation-card {'), 'recommendation shelf should keep explicit card styling control')
assert.ok(cssSource.includes('gap: 14px;'), 'recommendation shelf should tighten inter-card spacing for a lighter footprint')
assert.ok(cssSource.includes('.gui2-landing-recommendation-copy {') && cssSource.includes('padding: 0 1px;'), 'recommendation shelf should tighten poster-to-copy spacing slightly')
assert.ok(cssSource.includes('.gui2-landing-recommendation-title {') && cssSource.includes('font-size: 16px;'), 'recommendation shelf should slightly reduce title size without changing card count')
assert.ok(cssSource.includes('.gui2-landing-recommendation-subtitle {') && cssSource.includes('font-size: 12px;'), 'recommendation shelf should slightly reduce subtitle size without changing card count')

console.log('landing recommendations stage tests passed')
