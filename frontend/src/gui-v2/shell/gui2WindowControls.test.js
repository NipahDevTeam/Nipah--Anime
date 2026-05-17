import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'Gui2WindowControls.jsx'), 'utf8')

assert.ok(source.includes("import { closeGui2Window, getGui2WindowState, minimiseGui2Window, toggleGui2WindowMaximise } from '../../lib/gui2Window'"), 'window controls should use the gui2 window adapter')
assert.ok(source.includes("aria-label={isEnglish ? 'Minimise window' : 'Minimizar ventana'}"), 'window controls should expose a localized minimise label')
assert.ok(source.includes("aria-label={isMaximised ? (isEnglish ? 'Restore window' : 'Restaurar ventana') : (isEnglish ? 'Maximise window' : 'Maximizar ventana')}"), 'window controls should expose a localized maximize/restore label')
assert.ok(source.includes("aria-label={isEnglish ? 'Close window' : 'Cerrar ventana'}"), 'window controls should expose the close-window label')
assert.ok(source.includes('className="gui2-window-controls"'), 'window controls should render a dedicated shell control cluster')

console.log('gui2 window controls tests passed')
