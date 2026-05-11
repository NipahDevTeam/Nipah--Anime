const MOTION_PRESETS = {
  page: { durationMs: 220, shiftY: 10 },
  section: { durationMs: 200, shiftY: 8 },
  card: { durationMs: 180, shiftY: 6 },
}

export function buildMotionVars(kind = 'section') {
  const preset = MOTION_PRESETS[kind] || MOTION_PRESETS.section
  return {
    '--gui2-enter-ms': `${preset.durationMs}ms`,
    '--gui2-shift-y': `${preset.shiftY}px`,
  }
}

export function buildStaggerDelayMs(index = 0, stepMs = 24, maxDelayMs = 168) {
  return Math.min(Math.max(0, Number(index) || 0) * stepMs, maxDelayMs)
}
