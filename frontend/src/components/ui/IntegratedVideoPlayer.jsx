import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

function canUseHLS(kind, url) {
  return kind === 'hls' || (url ?? '').toLowerCase().includes('.m3u8')
}

export default function IntegratedVideoPlayer({
  open,
  title,
  subtitle = '',
  streamURL,
  streamKind = 'file',
  sourceLabel = '',
  onClose,
}) {
  const videoRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !streamURL || !videoRef.current) return undefined

    const video = videoRef.current
    const shouldUseHls = canUseHLS(streamKind, streamURL)
    let hls = null

    setError('')

    if (shouldUseHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          setError('No se pudo reproducir este stream en el reproductor integrado.')
        }
      })
      hls.loadSource(streamURL)
      hls.attachMedia(video)
    } else {
      video.src = streamURL
    }

    const playPromise = video.play()
    if (playPromise?.catch) {
      playPromise.catch(() => {})
    }

    return () => {
      if (hls) hls.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [open, streamKind, streamURL])

  if (!open) return null

  return (
    <div className="integrated-player-overlay" onClick={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="integrated-player-shell">
        <div className="integrated-player-header">
          <div className="integrated-player-copy">
            <div className="integrated-player-eyebrow">
              {sourceLabel || 'Integrated player'}
              <span className="integrated-player-sep">·</span>
              {streamKind === 'hls' ? 'HLS' : 'Direct stream'}
            </div>
            <div className="integrated-player-title">{title || 'Integrated player'}</div>
            {subtitle ? <div className="integrated-player-subtitle">{subtitle}</div> : null}
          </div>
          <button className="btn btn-ghost" onClick={onClose} type="button">×</button>
        </div>

        <div className="integrated-player-stage">
          <video ref={videoRef} className="integrated-player-video" controls playsInline />
        </div>

        <div className="integrated-player-footer">
          <div className="integrated-player-note">
            {error || 'The integrated player works best with HLS and direct MP4/WebM streams.'}
          </div>
        </div>
      </div>
    </div>
  )
}
