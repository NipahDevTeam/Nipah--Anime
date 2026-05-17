import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const shellSource = readFileSync(resolve(import.meta.dirname, 'Gui2Shell.jsx'), 'utf8')
const cssSource = readFileSync(resolve(import.meta.dirname, '../styles/gui2.css'), 'utf8')

assert.ok(shellSource.includes("data-shell-variant={routeMeta.shellVariant || 'standard'}"), 'shell should expose the route shell variant as a DOM attribute')
assert.ok(shellSource.includes('<Gui2WindowControls isEnglish={isEnglish} />'), 'shell should render the dedicated gui2 window controls cluster')
assert.ok(shellSource.includes('gui2-shell-chrome'), 'shell should render a dedicated shell chrome wrapper')
assert.ok(shellSource.includes('toggleGui2WindowMaximise'), 'shell chrome should be able to promote native titlebar behaviour such as double-click maximise')
assert.ok(cssSource.includes(".gui2-shell[data-shell-variant='immersive']"), 'css should define an immersive shell variant')
assert.ok(cssSource.includes(".gui2-shell[data-shell-variant='full-stage']"), 'css should define a full-stage shell variant bridge for reader and player surfaces')
assert.ok(cssSource.includes('.gui2-window-controls'), 'css should define the shell window-control cluster')
assert.ok(cssSource.includes('.gui2-window-control-close'), 'css should style the dedicated close control in the shell cluster')
assert.ok(cssSource.includes('--gui2-shell-safe-right'), 'css should define a reusable shell safe-right token for frameless desktop chrome')
assert.ok(cssSource.includes('--gui2-shell-density-shell-blur'), 'css should define a repeatable shell blur budget token')
assert.ok(cssSource.includes('--gui2-shell-density-topbar-fill'), 'css should define a topbar fill token for atmosphere scaling')
assert.ok(cssSource.includes('@media (max-width: 1440px)'), 'css should define a reduced-density shell budget for tighter laptop layouts')
assert.ok(cssSource.includes('.gui2-rail-brand'), 'css should expose a draggable rail brand surface for the frameless shell')
assert.ok(cssSource.includes('--wails-draggable: drag;'), 'css should mark draggable shell regions for Wails frameless mode')
assert.ok(cssSource.includes('--wails-draggable: no-drag;'), 'css should mark interactive shell regions as non-draggable')

console.log('gui2 shell chrome tests passed')
