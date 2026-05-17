import { useEffect, useState } from 'react'
import { closeGui2Window, getGui2WindowState, minimiseGui2Window, toggleGui2WindowMaximise } from '../../lib/gui2Window'

function WindowControlIcon({ kind }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 12 12',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  if (kind === 'minimise') return <svg {...common}><path d="M2 9h8" /></svg>
  if (kind === 'maximise') return <svg {...common}><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg>
  if (kind === 'restore') return <svg {...common}><path d="M4 2.5h4a1 1 0 0 1 1 1v4" /><path d="M8 4H4a1 1 0 0 0-1 1v4" /></svg>
  return <svg {...common}><path d="M3 3l6 6" /><path d="M9 3 3 9" /></svg>
}

export default function Gui2WindowControls({ isEnglish = true }) {
  const [isMaximised, setIsMaximised] = useState(false)

  useEffect(() => {
    let active = true
    void getGui2WindowState().then((state) => {
      if (active) setIsMaximised(Boolean(state.isMaximised))
    })
    return () => {
      active = false
    }
  }, [])

  const handleToggleMaximise = async () => {
    toggleGui2WindowMaximise()
    const state = await getGui2WindowState()
    setIsMaximised(Boolean(state.isMaximised))
  }

  return (
    <div className="gui2-window-controls" aria-label={isEnglish ? 'Window controls' : 'Controles de ventana'}>
      <button
        type="button"
        className="gui2-window-control"
        aria-label={isEnglish ? 'Minimise window' : 'Minimizar ventana'}
        onClick={() => minimiseGui2Window()}
      >
        <WindowControlIcon kind="minimise" />
      </button>
      <button
        type="button"
        className="gui2-window-control"
        aria-label={isMaximised ? (isEnglish ? 'Restore window' : 'Restaurar ventana') : (isEnglish ? 'Maximise window' : 'Maximizar ventana')}
        onClick={handleToggleMaximise}
      >
        <WindowControlIcon kind={isMaximised ? 'restore' : 'maximise'} />
      </button>
      <button
        type="button"
        className="gui2-window-control gui2-window-control-close"
        aria-label={isEnglish ? 'Close window' : 'Cerrar ventana'}
        onClick={() => closeGui2Window()}
      >
        <WindowControlIcon kind="hide" />
      </button>
    </div>
  )
}
