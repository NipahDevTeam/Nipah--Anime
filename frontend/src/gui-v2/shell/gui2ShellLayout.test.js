import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const shellPath = resolve(import.meta.dirname, './Gui2Shell.jsx')
const cssPath = resolve(import.meta.dirname, '../styles/gui2.css')

const shellSource = readFileSync(shellPath, 'utf8')
const cssSource = readFileSync(cssPath, 'utf8')

assert.ok(shellSource.includes('gui2-topbar-actions'), 'shared shell should still render topbar actions')
assert.ok(shellSource.includes('gui2-shell-chrome'), 'shared shell should render a shell chrome wrapper')
assert.ok(shellSource.includes('Gui2WindowControls'), 'shared shell should render dedicated window controls')
assert.ok(shellSource.includes('onDoubleClick={handleShellChromeDoubleClick}'), 'shared shell should let the native chrome toggle maximise on titlebar double click')
assert.ok(!shellSource.includes('Busca anime, manga y titulos...'), 'shared shell should remove the dead search placeholder copy')
assert.ok(cssSource.includes('margin-left: auto;'), 'topbar actions should self-align after the search surface is removed')
assert.ok(cssSource.includes('--gui2-shell-safe-right'), 'shell should expose a dedicated desktop-safe right inset token')
assert.ok(cssSource.includes('padding: 0 var(--gui2-shell-safe-right) 0 18px;'), 'topbar should reserve a dedicated safe zone for the window control cluster')
assert.ok(cssSource.includes(".gui2-shell[data-shell-variant='immersive'] .gui2-topbar"), 'css should define immersive topbar chrome')
assert.ok(cssSource.includes('.gui2-window-controls'), 'css should define a dedicated window control cluster')
assert.ok(cssSource.includes('flex: 0 0 auto;'), 'window controls should reserve visible space in the shell chrome')
assert.ok(cssSource.includes('padding-right: 8px;'), 'window controls should keep endcap breathing room away from the frameless edge')
assert.ok(cssSource.includes(".gui2-shell[data-route='home'] .gui2-window-controls"), 'home shell should explicitly lift the window controls above the hero overlay')
assert.ok(cssSource.includes('--wails-draggable: drag;'), 'shell chrome should declare draggable regions for the frameless window')
assert.ok(cssSource.includes('--wails-draggable: no-drag;'), 'interactive shell surfaces should opt out of the draggable title region')

console.log('gui2 shell layout tests passed')
