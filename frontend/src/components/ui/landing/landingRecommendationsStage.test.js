import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const stagePath = resolve(import.meta.dirname, './LandingRecommendationsStage.jsx')
const stageSource = readFileSync(stagePath, 'utf8')

assert.ok(stageSource.includes('function RecommendationCard({ item, onSelectItem = null }) {'), 'recommendation stage should accept a shared click callback for interactive cards')
assert.ok(stageSource.includes("const isInteractive = typeof onSelectItem === 'function'"), 'recommendation stage should explicitly detect when cards should be interactive')
assert.ok(stageSource.includes('type="button"'), 'recommendation stage should render real buttons for interactive recommendation cards')
assert.ok(stageSource.includes('onClick={() => onSelectItem?.(item)}'), 'recommendation stage should forward the selected recommendation item through the shared callback')
assert.ok(stageSource.includes('onSelectItem={onSelectItem}'), 'recommendation stage should pass the click callback down to each recommendation card')

console.log('landing recommendations stage tests passed')
