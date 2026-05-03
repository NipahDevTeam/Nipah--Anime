import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../lib/i18n'
import { wails } from '../../lib/wails'

function formatTime(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function ControlIcon({ kind }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  if (kind === 'play') {
    return <svg {...common}><path d="m5.3 3.8 6 4.2-6 4.2z" fill="currentColor" stroke="none" /></svg>
  }

  if (kind === 'pause') {
    return <svg {...common}><path d="M5.2 4.2v7.6" /><path d="M10.8 4.2v7.6" /></svg>
  }

  return <svg {...common}><path d="M5.3 5.1h5.4v5.8H5.3z" fill="currentColor" stroke="none" /></svg>
}

export default function NowPlaying() {
  const { lang } = useI18n()
  const [state, setState] = useState({ active: false })
  const [seeking, setSeeking] = useState(false)
  const [seekValue, setSeekValue] = useState(0)

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const nextState = await wails.getPlaybackState()
        setState(nextState)
      } catch {
        setState({ active: false })
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handlePause = useCallback(async () => {
    try { await wails.pauseResume() } catch {}
  }, [])

  const handleStop = useCallback(async () => {
    try { await wails.stopPlayback() } catch {}
  }, [])

  const handleSeekStart = useCallback(() => {
    setSeeking(true)
    setSeekValue(state.position_sec || 0)
  }, [state.position_sec])

  const handleSeekEnd = useCallback(async (event) => {
    const nextValue = parseFloat(event.target.value)
    setSeeking(false)
    try { await wails.seekTo(nextValue) } catch {}
  }, [])

  if (!state.active) return null

  const position = seeking ? seekValue : (state.position_sec || 0)
  const duration = state.duration_sec || 1

  return (
    <div className="now-playing-bar">
      <div className="np-info">
        <div className="np-anime-title">{state.anime_title || 'Nipah! Anime'}</div>
        <div className="np-episode-title">
          {state.episode_num ? `Ep. ${state.episode_num}` : (lang === 'en' ? 'Now playing' : 'Reproduciendo')}
          {state.episode_title ? ` - ${state.episode_title}` : ''}
        </div>
      </div>

      <div className="np-centre">
        <div className="np-controls">
          <button
            className="np-btn np-btn-primary"
            onClick={handlePause}
            title={state.paused ? (lang === 'en' ? 'Resume' : 'Reanudar') : (lang === 'en' ? 'Pause' : 'Pausar')}
            type="button"
          >
            <ControlIcon kind={state.paused ? 'play' : 'pause'} />
          </button>
          <button
            className="np-btn np-btn-stop"
            onClick={handleStop}
            title={lang === 'en' ? 'Stop' : 'Detener'}
            type="button"
          >
            <ControlIcon kind="stop" />
          </button>
        </div>

        <div className="np-progress-row">
          <span className="np-time">{formatTime(position)}</span>
          <input
            className="np-scrubber"
            type="range"
            min={0}
            max={duration}
            step={1}
            value={position}
            onMouseDown={handleSeekStart}
            onChange={(event) => setSeekValue(parseFloat(event.target.value))}
            onMouseUp={handleSeekEnd}
          />
          <span className="np-time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="np-right">
        <span className="np-percent">{Math.round(state.percent || 0)}%</span>
        {state.percent >= 85 && (
          <span className="badge badge-green" style={{ fontSize: 9 }}>
            {lang === 'en' ? 'Watched' : 'Visto'}
          </span>
        )}
      </div>
    </div>
  )
}
