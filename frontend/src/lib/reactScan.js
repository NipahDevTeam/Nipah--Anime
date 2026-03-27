const WATCHED_COMPONENTS = new Set([
  'Home',
  'Search',
  'MangaSearch',
  'OnlineAnimeDetail',
  'MyLists',
])

export async function bootReactScan() {
  if (!import.meta.env.DEV || typeof window === 'undefined' || window.__nipahReactScanStarted) {
    return
  }

  window.__nipahReactScanStarted = true

  try {
    const { scan } = await import('react-scan')

    scan({
      enabled: true,
      showToolbar: true,
      animationSpeed: 'fast',
      log: false,
      onRender(_, renders) {
        const latest = renders?.[renders.length - 1]
        const name = latest?.componentName
        if (!name || !WATCHED_COMPONENTS.has(name)) return

        console.debug(`[react-scan] ${name}`, {
          count: latest.count,
          time: latest.time,
          unnecessary: latest.unnecessary,
        })
      },
    })

    console.info('[react-scan] watching Home, Search, MangaSearch, OnlineAnimeDetail, MyLists')
  } catch (error) {
    console.warn('[react-scan] failed to start', error)
  }
}
