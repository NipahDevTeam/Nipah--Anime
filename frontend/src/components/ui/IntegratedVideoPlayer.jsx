import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { wails } from '../../lib/wails'

function canUseHLS(kind, url) {
  return kind === 'hls' || (url ?? '').toLowerCase().includes('.m3u8')
}

export default function IntegratedVideoPlayer({
  open,
  title,
  subtitle = '',
  streamURL,
  rawStreamURL = '',
  proxyURL = '',
  streamHost = '',
  streamKind = 'file',
  sourceLabel = '',
  initialPositionSec = 0,
  onPlaybackUpdate,
  onPlaybackEnd,
  onUseExternalPlayer,
  onClose,
}) {
  const videoRef = useRef(null)
  const lastReportedRef = useRef(0)
  const seekAppliedRef = useRef(false)
  const startupTimerRef = useRef(null)
  const [error, setError] = useState('')
  const [awaitingInteraction, setAwaitingInteraction] = useState(false)
  const [showFallbackActions, setShowFallbackActions] = useState(false)

  const emitDiagnostic = (event, extra = {}) => {
    const payload = {
      event,
      title,
      subtitle,
      source_label: sourceLabel,
      stream_kind: streamKind,
      stream_url: streamURL,
      raw_stream_url: rawStreamURL,
      proxy_url: proxyURL || streamURL,
      stream_host: streamHost,
      ...extra,
    }
    console.info('[integrated-player]', payload)
    wails.recordIntegratedPlaybackDiagnostic(payload).catch(() => {})
  }

  useEffect(() => {
    if (!open || !streamURL || !videoRef.current) return undefined

    const video = videoRef.current
    const shouldUseHls = canUseHLS(streamKind, streamURL)
    let hls = null

    setError('')
    setAwaitingInteraction(false)
    setShowFallbackActions(false)
    lastReportedRef.current = 0
    seekAppliedRef.current = false
    emitDiagnostic('session_start', {
      hls_expected: shouldUseHls,
    })

    const attemptPlayback = (trigger = 'auto') => {
      const playPromise = video.play()
      if (playPromise?.catch) {
        playPromise.then(() => {
          setAwaitingInteraction(false)
          setShowFallbackActions(false)
          if (trigger !== 'auto') {
            setError('')
          }
          emitDiagnostic('play_started', { trigger })
        }).catch((playError) => {
          const message = playError?.message ?? String(playError ?? '')
          emitDiagnostic('play_rejected', {
            trigger,
            error_message: message,
          })
          setAwaitingInteraction(true)
          setShowFallbackActions(true)
          if (trigger === 'auto') {
            setError('Autoplay was blocked. Click play to start the episode inside Nipah!.')
          } else {
            setError(`Could not start playback: ${message}`)
          }
        })
        return
      }
      setAwaitingInteraction(false)
      emitDiagnostic('play_started', { trigger })
    }

    const reportProgress = (force = false) => {
      if (!video) return
      const position = Number.isFinite(video.currentTime) ? video.currentTime : 0
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      if (!force && Math.abs(position - lastReportedRef.current) < 5) return
      lastReportedRef.current = position
      onPlaybackUpdate?.(position, duration)
    }

    const clearStartupTimeout = () => {
      if (startupTimerRef.current) {
        clearTimeout(startupTimerRef.current)
        startupTimerRef.current = null
      }
    }

    const armStartupTimeout = () => {
      clearStartupTimeout()
      startupTimerRef.current = setTimeout(() => {
        if (video.readyState >= 2) return
        emitDiagnostic('startup_timeout', {
          ready_state: video.readyState,
          network_state: video.networkState,
        })
        setAwaitingInteraction(false)
        setShowFallbackActions(true)
        setError('This stream is taking too long to start inside Nipah!. You can try playing it again or open it in MPV.')
      }, 8000)
    }

    const handleLoadedMetadata = () => {
      clearStartupTimeout()
      setShowFallbackActions(false)
      emitDiagnostic('loadedmetadata', {
        duration_sec: Number.isFinite(video.duration) ? video.duration : 0,
      })
      if (seekAppliedRef.current) return
      seekAppliedRef.current = true
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      if (initialPositionSec > 1 && (!duration || initialPositionSec < duration - 1)) {
        video.currentTime = initialPositionSec
      }
    }

    const handleCanPlay = () => {
      clearStartupTimeout()
      setAwaitingInteraction(false)
      setShowFallbackActions(false)
      setError('')
      emitDiagnostic('canplay', {
        duration_sec: Number.isFinite(video.duration) ? video.duration : 0,
      })
    }

    const handleLoadedData = () => {
      clearStartupTimeout()
      emitDiagnostic('loadeddata', {
        ready_state: video.readyState,
      })
    }

    const handlePlaying = () => {
      clearStartupTimeout()
      setAwaitingInteraction(false)
      setShowFallbackActions(false)
      setError('')
      emitDiagnostic('playing', {
        ready_state: video.readyState,
      })
    }

    const handleWaiting = () => {
      emitDiagnostic('waiting', {
        ready_state: video.readyState,
        network_state: video.networkState,
      })
    }

    const handleStalled = () => {
      emitDiagnostic('stalled', {
        ready_state: video.readyState,
        network_state: video.networkState,
      })
      if (video.readyState < 2) {
        setShowFallbackActions(true)
        setError('This stream stalled before playback could begin. Try again or open it in MPV.')
      }
    }

    const handlePause = () => reportProgress(true)

    const handleEnded = () => {
      const position = Number.isFinite(video.currentTime) ? video.currentTime : 0
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      lastReportedRef.current = position
      emitDiagnostic('ended', {
        position_sec: position,
        duration_sec: duration,
      })
      onPlaybackEnd?.(position, duration)
    }

    const handleVideoError = () => {
      const mediaError = video.error
      clearStartupTimeout()
      setShowFallbackActions(true)
      emitDiagnostic('video_error', {
        error_code: mediaError?.code ?? 0,
        error_message: mediaError?.message ?? '',
      })
      setError('The integrated player could not start this stream. Try again or open it in MPV.')
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('loadeddata', handleLoadedData)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('stalled', handleStalled)
    video.addEventListener('timeupdate', reportProgress)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('error', handleVideoError)

    if (shouldUseHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        emitDiagnostic('hls_manifest_parsed', {
          levels: data?.levels?.length ?? 0,
        })
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        emitDiagnostic('hls_error', {
          fatal: Boolean(data?.fatal),
          error_type: data?.type ?? '',
          error_details: data?.details ?? '',
        })
        if (data?.fatal) {
          clearStartupTimeout()
          setShowFallbackActions(true)
          setError('The integrated player could not recover this stream. Try again or open it in MPV.')
        }
      })
      hls.loadSource(streamURL)
      hls.attachMedia(video)
    } else {
      video.src = streamURL
    }

    video.preload = 'auto'
    video.dataset.retryPlayback = '1'
    video.dataset.retryTrigger = 'manual'
    video.__nipahRetryPlay = () => {
      armStartupTimeout()
      attemptPlayback('manual')
    }
    armStartupTimeout()
    attemptPlayback('auto')

    return () => {
      clearStartupTimeout()
      emitDiagnostic('session_end', {
        last_position_sec: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        last_duration_sec: Number.isFinite(video.duration) ? video.duration : 0,
      })
      reportProgress(true)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('loadeddata', handleLoadedData)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('stalled', handleStalled)
      video.removeEventListener('timeupdate', reportProgress)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('error', handleVideoError)
      if (hls) hls.destroy()
      delete video.__nipahRetryPlay
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [initialPositionSec, onPlaybackEnd, onPlaybackUpdate, open, proxyURL, rawStreamURL, sourceLabel, streamHost, streamKind, streamURL, subtitle, title])

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
          {awaitingInteraction || showFallbackActions ? (
            <div className="integrated-player-retry">
              <div className="integrated-player-retry-actions">
                <button
                  className="btn btn-primary integrated-player-retry-btn"
                  onClick={() => {
                    const video = videoRef.current
                    if (video?.__nipahRetryPlay) {
                      video.__nipahRetryPlay()
                    }
                  }}
                  type="button"
                >
                  Click to play
                </button>
                <button
                  className="btn btn-ghost integrated-player-external-btn"
                  onClick={() => onUseExternalPlayer?.()}
                  type="button"
                >
                  Open in MPV
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="integrated-player-footer">
          <div className="integrated-player-note">
            {error || 'The integrated player works best with HLS and direct MP4/WebM streams.'}
          </div>
          {awaitingInteraction || showFallbackActions ? (
            <div className="integrated-player-footer-actions">
              <button
                className="btn btn-primary integrated-player-retry-btn"
                onClick={() => {
                  const video = videoRef.current
                  if (video?.__nipahRetryPlay) {
                    video.__nipahRetryPlay()
                  }
                }}
                type="button"
              >
                Click to play
              </button>
              <button
                className="btn btn-ghost integrated-player-external-btn"
                onClick={() => onUseExternalPlayer?.()}
                type="button"
              >
                Open in MPV
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
