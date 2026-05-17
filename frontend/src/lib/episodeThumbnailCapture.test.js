import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isImageDataLikelyUsable } from './episodeThumbnailCapture.js'

const solidBlack = {
  data: new Uint8ClampedArray(Array.from({ length: 16 * 4 }, (_, index) => (
    index % 4 === 3 ? 255 : 0
  ))),
}

const brightFrame = {
  data: new Uint8ClampedArray(Array.from({ length: 16 * 4 }, (_, index) => {
    const channel = index % 4
    if (channel === 3) return 255
    return channel === 0 ? 190 : 140
  })),
}

assert.equal(isImageDataLikelyUsable(solidBlack), false, 'solid black frames should be rejected before persistence')
assert.equal(isImageDataLikelyUsable(brightFrame), true, 'real colorful frames should be accepted for persistence')

const captureSource = readFileSync(resolve(import.meta.dirname, './episodeThumbnailCapture.js'), 'utf8')
assert.equal(captureSource.includes("video.style.left = '-99999px'"), false, 'thumbnail capture should not hide the probe video far off-screen where Wails may stop compositing frames')
assert.equal(captureSource.includes("video.style.width = '1px'"), false, 'thumbnail capture should not shrink the probe video to a 1px target where frame capture becomes unreliable')
assert.ok(captureSource.includes("video.style.opacity = '0.001'"), 'thumbnail capture should keep the probe video effectively invisible while still renderable inside the viewport')

console.log('episode thumbnail capture tests passed')
