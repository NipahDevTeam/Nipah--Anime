import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const shellPath = resolve(import.meta.dirname, './Gui2Shell.jsx')
const cssPath = resolve(import.meta.dirname, '../styles/gui2.css')

const shellSource = readFileSync(shellPath, 'utf8')
const cssSource = readFileSync(cssPath, 'utf8')

assert.ok(shellSource.includes('gui2-smart-rail'), 'shell should render the smart rail root')
assert.ok(shellSource.includes('gui2-rail-link'), 'shell should render compact rail links')
assert.ok(shellSource.includes('gui2-rail-flyout'), 'shell should render hover/focus flyout labels')
assert.ok(cssSource.includes('--gui2-rail-w'), 'css should expose the new rail width token')
assert.ok(cssSource.includes('.gui2-rail-link.active'), 'css should style the active rail slot')
assert.ok(cssSource.includes('.gui2-rail-flyout'), 'css should style the floating label pill')
assert.ok(shellSource.includes('gui2-rail-brand'), 'rail should keep a compact brand block at the top')
assert.ok(shellSource.includes("import appIconToolbar from '../../assets/branding/app-icon-toolbar.png'"), 'rail should import the committed toolbar identity artwork')
assert.ok(shellSource.includes('<img className="gui2-rail-logo" src={appIconToolbar} alt="" />'), 'rail should render the toolbar identity artwork as the visible brand mark')
assert.ok(!shellSource.includes('gui2-rail-brand-copy'), 'rail should not keep the old text-heavy brand copy block')
assert.ok(cssSource.includes('.gui2-rail-link.active::after'), 'active rail slots should render a dedicated edge accent')
assert.ok(cssSource.includes('--gui2-shell-density-rail-fill'), 'css should expose a transparent rail fill token for density scaling')
assert.ok(cssSource.includes('background: var(--gui2-shell-density-rail-fill);'), 'rail surface should use the shared transparent fill token instead of a hard boxed shell')
assert.ok(cssSource.includes('.gui2-rail-link:hover .gui2-rail-icon,'), 'rail hover feedback should move to the icon so only the active slot keeps the boxed shell emphasis')
assert.ok(cssSource.includes('.gui2-rail-link:hover::before,\n.gui2-rail-link:focus-visible::before {\n  opacity: 0;'), 'non-active rail items should not draw the same boxed shell as the active slot')
assert.ok(cssSource.includes('margin-top: auto;'), 'system actions should stay anchored to the bottom of the rail')
assert.ok(cssSource.includes('--gui2-rail-w-immersive'), 'css should expose an immersive rail width token')
assert.ok(cssSource.includes(".gui2-shell[data-shell-variant='immersive'] .gui2-sidebar"), 'css should restyle the rail for immersive routes')
assert.ok(cssSource.includes(".gui2-shell[data-shell-variant='full-stage'] .gui2-sidebar"), 'css should expose the full-stage shell bridge for reader-like surfaces')
assert.ok(cssSource.includes('.gui2-rail-brand-mark {\n  width: 58px;\n  height: 58px;\n  display: grid;\n  place-items: center;\n  border-radius: 0;\n  background: none;\n  box-shadow: none;'), 'rail brand mark should remove the boxed shell so the toolbar identity artwork reads clearly')
assert.ok(cssSource.includes('.gui2-rail-logo {\n  width: 42px;\n  height: 48px;\n  display: block;\n  object-fit: contain;'), 'rail logo should scale the toolbar identity artwork up while preserving its proportions')
assert.ok(cssSource.includes('.gui2-window-control-close'), 'css should style the shell hide-to-tray control')

console.log('gui2 smart rail tests passed')
