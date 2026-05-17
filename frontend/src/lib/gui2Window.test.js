import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'gui2Window.js'), 'utf8')

assert.ok(source.includes("import { Hide, WindowIsMaximised, WindowMinimise, WindowToggleMaximise } from '../../wailsjs/runtime/runtime'"), 'gui2 window adapter should import the Wails window runtime helpers')
assert.ok(source.includes('function isGui2WindowRuntimeReady()'), 'gui2 window adapter should guard runtime availability')
assert.ok(source.includes('export async function getGui2WindowState()'), 'gui2 window adapter should expose the current window state')
assert.ok(source.includes('export function minimiseGui2Window()'), 'gui2 window adapter should expose minimize behavior')
assert.ok(source.includes('export function toggleGui2WindowMaximise()'), 'gui2 window adapter should expose maximize toggle behavior')
assert.ok(source.includes('export function closeGui2Window()'), 'gui2 window adapter should expose close-window behavior')
assert.ok(source.includes('return { canManage: false, isMaximised: false }'), 'gui2 window adapter should fail soft in preview or browser-only contexts')

console.log('gui2 window adapter tests passed')
