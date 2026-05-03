import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, './NipahBootRoot.jsx'), 'utf8')

assert.ok(source.includes('const [appMounted, setAppMounted] = useState(false)'), 'boot root should keep the app shell unmounted during warm startup')
assert.ok(source.includes('setAppMounted(true)'), 'boot root should only mount the app after warm launch completes')
assert.ok(source.includes('{appMounted ? children : null}'), 'boot root should not render the shell behind the boot window')
assert.ok(!source.includes('window.requestAnimationFrame(() => {\r\n          Promise.resolve(wails.completeStartupLaunch?.()).catch(() => {})'), 'boot root should not re-trigger startup launch after the shell is already mounted')

console.log('boot root tests passed')
