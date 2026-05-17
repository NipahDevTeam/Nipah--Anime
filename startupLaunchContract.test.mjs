import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, './app.go'), 'utf8')
const residentWindowSource = readFileSync(resolve(import.meta.dirname, './resident_window.go'), 'utf8')

assert.ok(
  source.includes('func (a *App) CompleteStartupLaunch() error {'),
  'app startup launch contract should live in app.go so boot reveal and native window restore stay aligned',
)

assert.ok(
  residentWindowSource.includes('appLaunchWidth             = 1120'),
  'startup bootstrap width should stay compact enough for a dedicated boot window while still giving the room composition enough space',
)

assert.ok(
  residentWindowSource.includes('appLaunchHeight            = 720'),
  'startup bootstrap height should stay compact enough for a dedicated boot window while still giving the room composition enough space',
)

assert.ok(
  source.includes('scheduleResidentWindowRestore(residentWindowRestoreDelay, func() {'),
  'startup launch should schedule post-reveal maximise through the resident window helper instead of forcing it inline',
)

assert.ok(
  !source.includes('time.Sleep(160 * time.Millisecond)'),
  'startup launch should not block the reveal path with a hard sleep once the frontend already owns boot timing',
)

console.log('startup launch contract tests passed')
