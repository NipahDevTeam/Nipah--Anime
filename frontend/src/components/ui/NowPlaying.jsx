import { useState, useEffect, useCallback } from 'react'
import { wails } from '../../lib/wails'

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function NowPlaying() {
  const [state, setState] = useState({ active: false })
  const [seeking, setSeeking] = useState(false)
  const [seekValue, setSeekValue] = useState(0)

  // Poll playback state every second
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const s = await wails.getPlaybackState()
        setState(s)
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

  const handleSeekEnd = useCallback(async (e) => {
    const val = parseFloat(e.target.value)
    setSeeking(false)
    try { await wails.seekTo(val) } catch {}
  }, [])

  if (!state.active) return null

  const position = seeking ? seekValue : (state.position_sec || 0)
  const duration = state.duration_sec || 1
  const percent = (position / duration) * 100

  return (
    <div className="now-playing-bar">
      {/* Left — episode info */}
      <div className="np-info">
        <div className="np-anime-title">{state.anime_title || '—'}</div>
        <div className="np-episode-title">
          {state.episode_num ? `Ep. ${state.episode_num}` : ''}
          {state.episode_title ? ` — ${state.episode_title}` : ''}
        </div>
      </div>

      {/* Centre — progress */}
      <div className="np-centre">
        <div className="np-controls">
          <button
            className="np-btn"
            onClick={handlePause}
            title={state.paused ? 'Reanudar' : 'Pausar'}
          >
            {state.paused ? '▶' : '⏸'}
          </button>
          <button className="np-btn np-btn-stop" onClick={handleStop} title="Detener">
            ■
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
            onChange={e => setSeekValue(parseFloat(e.target.value))}
            onMouseUp={handleSeekEnd}
          />
          <span className="np-time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right — percent watched */}
      <div className="np-right">
        <span className="np-percent">{Math.round(state.percent || 0)}%</span>
        {state.percent >= 85 && (
          <span className="badge badge-green" style={{ fontSize: 9 }}>Visto</span>
        )}
      </div>
    </div>
  )
}
