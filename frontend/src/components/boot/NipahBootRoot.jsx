import { startTransition, useEffect, useState } from 'react'
import bootIllustration from '../../assets/boot/nipah-boot-cozy-host-transparent.png'
import { wails } from '../../lib/wails'
import {
  STARTUP_BACKGROUND_DELAY_MS,
  runStartupWarmup,
  STARTUP_EXIT_MS,
  STARTUP_MIN_VISIBLE_MS,
  STARTUP_REQUIRED_READY_RETRY_MS,
  STARTUP_REQUIRED_READY_TIMEOUT_MS,
  waitForStartupDelay,
} from './startupWarmup'
import { BOOT_CATCHPHRASE } from './bootStageModel'

function BootOverlay({ phase }) {
  return (
    <div className={`gui2-boot-overlay${phase === 'exiting' ? ' is-exiting' : ''}`} aria-hidden="true">
      <div className="gui2-boot-scene">
        <div className="gui2-boot-scene-lamp" />
        <div className="gui2-boot-scene-shelf" />
        <div className="gui2-boot-scene-desk" />
        <div className="gui2-boot-room" data-boot-copy={BOOT_CATCHPHRASE}>
          <div className="gui2-boot-room-glow gui2-boot-room-glow-left" />
          <div className="gui2-boot-room-glow gui2-boot-room-glow-right" />
          <div className="gui2-boot-chamber">
            <div className="gui2-boot-lamp-glow" />
            <div className="gui2-boot-illustration-wrap">
              <img className="gui2-boot-illustration" src={bootIllustration} alt="" />
            </div>
            <p className="gui2-boot-catchphrase">{BOOT_CATCHPHRASE}</p>
            <div className="gui2-boot-status">
              <span className="gui2-boot-status-track" aria-hidden="true">
                <span className="gui2-boot-status-ember" />
              </span>
            </div>
          </div>
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
    document.getElementById('boot-fallback')?.remove()

    ;(async () => {
      const startedAt = performance.now()
      const deadlineAt = startedAt + STARTUP_REQUIRED_READY_TIMEOUT_MS
      let warmup = null

      do {
        const warmupPromise = runStartupWarmup(queryClient)

        const waiters = [warmupPromise]
        if (!warmup) {
          waiters.push(waitForStartupDelay(STARTUP_MIN_VISIBLE_MS))
        }
        await Promise.allSettled(waiters)
        warmup = await warmupPromise.catch(() => null)

        if (!active || warmup?.ready === true) break
        if (performance.now() >= deadlineAt) break
        await waitForStartupDelay(STARTUP_REQUIRED_READY_RETRY_MS)
      } while (active)

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
