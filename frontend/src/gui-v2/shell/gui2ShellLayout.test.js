import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const shellPath = resolve(import.meta.dirname, './Gui2Shell.jsx')
const cssPath = resolve(import.meta.dirname, '../styles/gui2.css')

const shellSource = readFileSync(shellPath, 'utf8')
const cssSource = readFileSync(cssPath, 'utf8')

assert.ok(shellSource.includes('gui2-topbar-actions'), 'shared shell should still render topbar actions')
assert.ok(!shellSource.includes('Busca anime, manga y titulos...'), 'shared shell should remove the dead search placeholder copy')
assert.ok(cssSource.includes('margin-left: auto;'), 'topbar actions should self-align after the search surface is removed')

console.log('gui2 shell layout tests passed')
