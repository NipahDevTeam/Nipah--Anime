import assert from 'node:assert/strict'
import {
  GUI2_HOME_HERO_FADE_MS,
  GUI2_HOME_HERO_ROTATE_MS,
  getNextHomeHeroIndex,
} from './homeData.js'

assert.equal(GUI2_HOME_HERO_ROTATE_MS, 7000)
assert.equal(GUI2_HOME_HERO_FADE_MS, 320)
assert.equal(getNextHomeHeroIndex(0, 4), 1)
assert.equal(getNextHomeHeroIndex(3, 4), 0)
assert.equal(getNextHomeHeroIndex(0, 1), 0)

console.log('home hero tests passed')
