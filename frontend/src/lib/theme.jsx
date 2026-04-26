import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { wails } from './wails'

const ThemeContext = createContext({
  theme: 'dark',
  setTheme: () => {},
  isDarkTheme: true,
})

function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark'
}

function applyTheme(theme) {
  const normalized = normalizeTheme(theme)
  document.documentElement.dataset.theme = normalized
  document.body.dataset.theme = normalized
  document.documentElement.style.colorScheme = normalized
  document.body.style.colorScheme = normalized
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('dark')

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    let active = true
    wails.getSettings()
      .then((settings) => {
        if (!active) return
        setThemeState(normalizeTheme(settings?.theme))
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])

  const setTheme = useCallback(async (nextTheme) => {
    const normalized = normalizeTheme(nextTheme)
    setThemeState(normalized)
    try {
      await wails.saveSettings({ theme: normalized })
    } catch (error) {
      console.warn('[theme] could not persist theme', error)
    }
  }, [])

  const value = useMemo(() => ({
    theme,
    setTheme,
    isDarkTheme: theme === 'dark',
  }), [setTheme, theme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
