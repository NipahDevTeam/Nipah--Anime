import { startTransition, useEffect, useState } from 'react'
import NipahLogo from '../../gui-v2/shell/NipahLogo'
import { wails } from '../../lib/wails'
import {
  STARTUP_BACKGROUND_DELAY_MS,
  runStartupWarmup,
  STARTUP_EXIT_MS,
  STARTUP_MIN_VISIBLE_MS,
  waitForStartupDelay,
} from './startupWarmup'

function BootOverlay({ phase }) {
  return (
    <div className={`gui2-boot-overlay${phase === 'exiting' ? ' is-exiting' : ''}`} aria-hidden="true">
      <div className="gui2-boot-stage">
        <div className="gui2-boot-grid" />
        <div className="gui2-boot-sweep" />
        <div className="gui2-boot-brand">
          <NipahLogo className="gui2-boot-logo" />
        </div>
      </div>
    </div>
  )
}

export default function NipahBootRoot({ children, queryClient }) {
  const [phase, setPhase] = useState('warming')
  const [appMounted, setAppMounted] = useState(false)

  useEffect(() => {
    let active = true
    let exitTimer = null

    document.body.classList.add('gui2-boot-active')

    ;(async () => {
      const startedAt = performance.now()
      const warmupPromise = runStartupWarmup(queryClient)
      await Promise.allSettled([
        waitForStartupDelay(STARTUP_MIN_VISIBLE_MS),
        warmupPromise,
      ])
      const warmup = await warmupPromise.catch(() => null)

      if (!active) return

      await Promise.resolve(wails.completeStartupLaunch?.()).catch(() => {})
      if (!active) return
      await waitForStartupDelay(220)

      console.info('[startup] warm boot complete', {
        sinceBootMs: Math.round(performance.now() - startedAt),
      })

      startTransition(() => {
        setAppMounted(true)
        setPhase('exiting')
      })

      exitTimer = window.setTimeout(() => {
        if (!active) return
        document.body.classList.remove('gui2-boot-active')
        setPhase('ready')

        void waitForStartupDelay(STARTUP_BACKGROUND_DELAY_MS)
          .then(() => {
            if (!active) return null
            return warmup?.startBackground?.()
          })
          .catch(() => {})
      }, STARTUP_EXIT_MS)
    })()

    return () => {
      active = false
      document.body.classList.remove('gui2-boot-active')
      if (exitTimer) {
        window.clearTimeout(exitTimer)
      }
    }
  }, [queryClient])

  return (
    <>
      {appMounted ? children : null}
      {phase !== 'ready' ? <BootOverlay phase={phase} /> : null}
    </>
  )
}
