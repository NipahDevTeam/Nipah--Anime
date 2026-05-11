import assert from 'node:assert/strict'
import { buildMotionVars, buildStaggerDelayMs } from './gui2Motion.js'

assert.deepEqual(buildMotionVars('page'), {
  '--gui2-enter-ms': '220ms',
  '--gui2-shift-y': '10px',
})

assert.equal(buildStaggerDelayMs(0, 24), 0)
assert.equal(buildStaggerDelayMs(3, 24), 72)
assert.equal(buildStaggerDelayMs(99, 24), 168)

console.log('gui2 motion tests passed')
