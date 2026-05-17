import assert from 'node:assert/strict'

let buildLandingQueueWindow

try {
  ;({ buildLandingQueueWindow } = await import('./landingQueueWindowing.js'))
} catch (error) {
  assert.fail(`landing queue windowing module should load: ${error.message}`)
}

const shortItems = Array.from({ length: 8 }, (_, index) => ({ id: index + 1 }))
const shortWindow = buildLandingQueueWindow({
  items: shortItems,
  page: 1,
  pageSize: 12,
})

assert.equal(shortWindow.totalPages, 1)
assert.equal(shortWindow.currentPage, 1)
assert.equal(shortWindow.items.length, 8)
assert.deepEqual(shortWindow.pageChips, [1])
assert.equal(shortWindow.showPagination, false)

const longItems = Array.from({ length: 32 }, (_, index) => ({ id: index + 1 }))
const middleWindow = buildLandingQueueWindow({
  items: longItems,
  page: 2,
  pageSize: 12,
})

assert.equal(middleWindow.totalPages, 3)
assert.equal(middleWindow.currentPage, 2)
assert.deepEqual(
  middleWindow.items.map((item) => item.id),
  Array.from({ length: 12 }, (_, index) => index + 13),
)
assert.deepEqual(middleWindow.pageChips, [1, 2, 3])
assert.equal(middleWindow.showPagination, true)

const invalidInputsWindow = buildLandingQueueWindow({
  items: null,
  page: -5,
  pageSize: 0,
})

assert.equal(invalidInputsWindow.totalPages, 1)
assert.equal(invalidInputsWindow.currentPage, 1)
assert.deepEqual(invalidInputsWindow.items, [])
assert.deepEqual(invalidInputsWindow.pageChips, [1])
assert.equal(invalidInputsWindow.showPagination, false)

const startWindow = buildLandingQueueWindow({
  items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })),
  page: 1,
  pageSize: 10,
})

assert.equal(startWindow.totalPages, 5)
assert.deepEqual(startWindow.pageChips, [1, 2, 3])

const slidingWindow = buildLandingQueueWindow({
  items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })),
  page: 3,
  pageSize: 10,
})

assert.equal(slidingWindow.totalPages, 5)
assert.equal(slidingWindow.currentPage, 3)
assert.deepEqual(slidingWindow.pageChips, [2, 3, 4])

const endWindow = buildLandingQueueWindow({
  items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })),
  page: 5,
  pageSize: 10,
})

assert.equal(endWindow.totalPages, 5)
assert.equal(endWindow.currentPage, 5)
assert.deepEqual(endWindow.pageChips, [3, 4, 5])

const clampedWindow = buildLandingQueueWindow({
  items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })),
  page: 99,
  pageSize: 10,
})

assert.equal(clampedWindow.totalPages, 5)
assert.equal(clampedWindow.currentPage, 5)
assert.deepEqual(
  clampedWindow.items.map((item) => item.id),
  [41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
)
assert.deepEqual(clampedWindow.pageChips, [3, 4, 5])

const stringBackedWindow = buildLandingQueueWindow({
  items: Array.from({ length: 32 }, (_, index) => ({ id: index + 1 })),
  page: '2',
  pageSize: '12',
})

assert.equal(stringBackedWindow.totalPages, 3)
assert.equal(stringBackedWindow.currentPage, 2)
assert.deepEqual(
  stringBackedWindow.items.map((item) => item.id),
  Array.from({ length: 12 }, (_, index) => index + 13),
)
assert.deepEqual(stringBackedWindow.pageChips, [1, 2, 3])
assert.equal(stringBackedWindow.showPagination, true)

console.log('landing queue windowing tests passed')
