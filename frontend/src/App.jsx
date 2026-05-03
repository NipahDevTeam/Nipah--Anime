import { useEffect } from 'react'
import Gui2App from './gui-v2/Gui2App'

function StartupBeacon() {
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const sinceBoot = typeof window.__nipahBootAt === 'number'
        ? Math.round(performance.now() - window.__nipahBootAt)
        : null
      console.info('[startup] app shell painted', {
        sinceBootMs: sinceBoot,
      })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return null
}

export default function App() {
  return (
    <>
      <StartupBeacon />
      <Gui2App />
    </>
  )
}
