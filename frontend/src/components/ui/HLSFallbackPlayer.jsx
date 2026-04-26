import { useEffect, useRef } from 'react'
import Hls from 'hls.js'

export default function HLSFallbackPlayer({ open, title, streamURL, onClose }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (!open || !streamURL || !videoRef.current) return undefined

    const video = videoRef.current
    let hls = null

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })
      hls.loadSource(streamURL)
      hls.attachMedia(video)
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamURL
    }

    const playPromise = video.play()
    if (playPromise?.catch) playPromise.catch(() => {})

    return () => {
      if (hls) hls.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [open, streamURL])

  if (!open) return null

  return (
    <div className="hls-player-overlay" onClick={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="hls-player-shell">
        <div className="hls-player-header">
          <div className="hls-player-title">{title || 'HLS Player'}</div>
          <button className="btn btn-ghost" onClick={onClose} type="button">×</button>
        </div>
        <video ref={videoRef} className="hls-player-video" controls playsInline />
      </div>
    </div>
  )
}
