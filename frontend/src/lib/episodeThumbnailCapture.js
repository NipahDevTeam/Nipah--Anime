import Hls from 'hls.js'

function looksLikeHls(kind = '', url = '') {
  const normalizedKind = String(kind || '').trim().toLowerCase()
  const normalizedURL = String(url || '').trim().toLowerCase()
  return normalizedKind === 'hls' || normalizedURL.includes('.m3u8')
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
  })
}

function waitForEvent(target, eventName, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    let timeoutID = null
    const cleanup = () => {
      target.removeEventListener(eventName, handleResolve)
      target.removeEventListener('error', handleReject)
      if (timeoutID) {
        clearTimeout(timeoutID)
      }
    }
    const handleResolve = () => {
      cleanup()
      resolve()
    }
    const handleReject = (event) => {
      cleanup()
      reject(event instanceof Error ? event : new Error(`${eventName} failed`))
    }

    target.addEventListener(eventName, handleResolve, { once: true })
    target.addEventListener('error', handleReject, { once: true })
    if (timeoutMs > 0) {
      timeoutID = setTimeout(() => {
        cleanup()
        reject(new Error(`${eventName} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }
  })
}

function waitForAnyEvent(target, eventNames, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    let timeoutID = null
    const names = Array.isArray(eventNames) ? eventNames.filter(Boolean) : []
    const cleanup = () => {
      names.forEach((eventName) => {
        target.removeEventListener(eventName, handleResolve)
      })
      target.removeEventListener('error', handleReject)
      if (timeoutID) {
        clearTimeout(timeoutID)
      }
    }
    const handleResolve = () => {
      cleanup()
      resolve()
    }
    const handleReject = (event) => {
      cleanup()
      reject(event instanceof Error ? event : new Error('media loading failed'))
    }

    names.forEach((eventName) => {
      target.addEventListener(eventName, handleResolve, { once: true })
    })
    target.addEventListener('error', handleReject, { once: true })
    if (timeoutMs > 0) {
      timeoutID = setTimeout(() => {
        cleanup()
        reject(new Error(`media events timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }
  })
}

async function seekVideo(video, seconds) {
  const targetSeconds = Math.max(0, Number(seconds) || 0)
  if (!Number.isFinite(targetSeconds)) return
  if (Math.abs((video.currentTime || 0) - targetSeconds) < 0.2) return
  video.currentTime = targetSeconds
  await waitForEvent(video, 'seeked', 4000)
}

async function waitForRenderedFrame(video, timeoutMs = 1600) {
  if (!video) return
  if (typeof video.requestVideoFrameCallback === 'function') {
    await new Promise((resolve, reject) => {
      let timeoutID = null
      const done = () => {
        if (timeoutID) {
          clearTimeout(timeoutID)
        }
        resolve()
      }
      const fail = () => {
        if (timeoutID) {
          clearTimeout(timeoutID)
        }
        reject(new Error('video frame callback timed out'))
      }
      timeoutID = setTimeout(fail, Math.max(250, timeoutMs))
      video.requestVideoFrameCallback(() => {
        done()
      })
    }).catch(() => {})
    return
  }
  if (video.readyState >= 2) {
    await delay(180)
    return
  }
  await waitForAnyEvent(video, ['timeupdate', 'loadeddata', 'canplay'], timeoutMs).catch(() => {})
  await delay(120)
}

function collectFrameCandidates(duration, preferredSecond) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return []
  }
  const candidates = [
    preferredSecond,
    0.35,
    0.85,
    1.4,
    duration * 0.08,
    duration * 0.16,
    duration * 0.28,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0.08 && value < Math.max(0.12, duration - 0.08))

  return [...new Set(candidates.map((value) => Math.round(value * 10) / 10))]
}

export function isImageDataLikelyUsable(imageData) {
  const data = imageData?.data
  if (!data || typeof data.length !== 'number' || data.length < 16) {
    return false
  }

  let sampleCount = 0
  let totalLuminance = 0
  let totalLuminanceSq = 0
  let minLuminance = 255
  let maxLuminance = 0
  let darkSamples = 0
  let colorfulSamples = 0

  const pixelCount = Math.floor(data.length / 4)
  const pixelStep = Math.max(1, Math.floor(pixelCount / 400))
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += pixelStep) {
    const offset = pixelIndex * 4
    const alpha = data[offset + 3]
    if (alpha < 24) {
      continue
    }
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const luminance = (r * 0.2126) + (g * 0.7152) + (b * 0.0722)
    totalLuminance += luminance
    totalLuminanceSq += luminance * luminance
    minLuminance = Math.min(minLuminance, luminance)
    maxLuminance = Math.max(maxLuminance, luminance)
    if (luminance < 18) {
      darkSamples += 1
    }
    if ((Math.max(r, g, b) - Math.min(r, g, b)) > 14) {
      colorfulSamples += 1
    }
    sampleCount += 1
  }

  if (sampleCount < 8) {
    return false
  }

  const averageLuminance = totalLuminance / sampleCount
  const luminanceVariance = Math.max(0, (totalLuminanceSq / sampleCount) - (averageLuminance * averageLuminance))
  const darkRatio = darkSamples / sampleCount
  const dynamicRange = maxLuminance - minLuminance
  const colorfulRatio = colorfulSamples / sampleCount

  if (averageLuminance < 10) {
    return false
  }
  if (darkRatio > 0.985 && dynamicRange < 18) {
    return false
  }
  if (darkRatio > 0.94 && averageLuminance < 26 && colorfulRatio < 0.05) {
    return false
  }
  if (averageLuminance < 22 && luminanceVariance < 45 && colorfulRatio < 0.02) {
    return false
  }
  return true
}

function drawVideoFrame(video) {
  const width = Number(video?.videoWidth || 0)
  const height = Number(video?.videoHeight || 0)
  if (width <= 0 || height <= 0 || typeof document === 'undefined') {
    return ''
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return ''

  ctx.drawImage(video, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  if (!isImageDataLikelyUsable(imageData)) {
    return ''
  }
  return canvas.toDataURL('image/jpeg', 0.82)
}

export async function captureThumbnailFromPreparedStream({
  streamURL = '',
  streamKind = 'file',
  timeoutMs = 12000,
  captureAtSec = 1.2,
} = {}) {
  const targetURL = String(streamURL || '').trim()
  if (!targetURL || typeof document === 'undefined') return ''

  const video = document.createElement('video')
  video.muted = true
  video.defaultMuted = true
  video.autoplay = true
  video.preload = 'auto'
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  video.style.position = 'fixed'
  video.style.right = '0'
  video.style.bottom = '0'
  video.style.width = '160px'
  video.style.height = '90px'
  video.style.opacity = '0.001'
  video.style.pointerEvents = 'none'
  video.style.objectFit = 'cover'
  document.body.appendChild(video)

  let hls = null
  try {
    let manifestReady = Promise.resolve()
    if (looksLikeHls(streamKind, targetURL) && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })
      manifestReady = new Promise((resolve, reject) => {
        const handleParsed = () => {
          hls.off(Hls.Events.MANIFEST_PARSED, handleParsed)
          hls.off(Hls.Events.ERROR, handleError)
          resolve()
        }
        const handleError = (_event, data) => {
          if (!data?.fatal) return
          hls.off(Hls.Events.MANIFEST_PARSED, handleParsed)
          hls.off(Hls.Events.ERROR, handleError)
          reject(new Error(data?.details || 'hls manifest failed'))
        }
        hls.on(Hls.Events.MANIFEST_PARSED, handleParsed)
        hls.on(Hls.Events.ERROR, handleError)
      })
      hls.loadSource(targetURL)
      hls.attachMedia(video)
    } else {
      video.src = targetURL
    }

    await Promise.all([
      manifestReady.catch(() => {}),
      waitForAnyEvent(video, ['loadedmetadata', 'loadeddata', 'canplay'], timeoutMs),
    ])
    await video.play().catch(() => {})
    await waitForAnyEvent(video, ['playing', 'timeupdate', 'loadeddata', 'canplay'], Math.min(3200, timeoutMs)).catch(() => {})
    await waitForRenderedFrame(video, Math.min(2500, timeoutMs))

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const frameCandidates = collectFrameCandidates(duration, captureAtSec)
    if (frameCandidates.length > 0) {
      for (const second of frameCandidates) {
        await seekVideo(video, second).catch(() => {})
        await waitForRenderedFrame(video, 2200)
        const dataURL = drawVideoFrame(video)
        if (dataURL) {
          return dataURL
        }
      }
    } else {
      const warmupDelays = [220, 650, 1250, 2200]
      for (const waitMs of warmupDelays) {
        await delay(waitMs)
        await waitForRenderedFrame(video, 1200)
        const dataURL = drawVideoFrame(video)
        if (dataURL) {
          return dataURL
        }
      }
    }
    return ''
  } catch {
    return ''
  } finally {
    try {
      video.pause()
    } catch {}
    video.removeAttribute('src')
    try {
      video.load()
    } catch {}
    if (hls) {
      hls.destroy()
    }
    video.remove()
  }
}
