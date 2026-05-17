import { Hide, WindowIsMaximised, WindowMinimise, WindowToggleMaximise } from '../../wailsjs/runtime/runtime'

function isGui2WindowRuntimeReady() {
  return typeof window !== 'undefined' && Boolean(window.runtime)
}

export async function getGui2WindowState() {
  if (!isGui2WindowRuntimeReady()) {
    return { canManage: false, isMaximised: false }
  }

  try {
    return {
      canManage: true,
      isMaximised: await WindowIsMaximised(),
    }
  } catch {
    return { canManage: false, isMaximised: false }
  }
}

export function minimiseGui2Window() {
  if (!isGui2WindowRuntimeReady()) return false
  WindowMinimise()
  return true
}

export function toggleGui2WindowMaximise() {
  if (!isGui2WindowRuntimeReady()) return false
  WindowToggleMaximise()
  return true
}

export function closeGui2Window() {
  if (!isGui2WindowRuntimeReady()) return false
  Hide()
  return true
}
