export function normalizeGui2Path(pathname = '/') {
  const raw = String(pathname || '/')
  const withoutPreviewPrefix = raw.startsWith('/__rebuild')
    ? raw.slice('/__rebuild'.length) || '/'
    : raw

  if (withoutPreviewPrefix === '/' || withoutPreviewPrefix === '/home') return '/home'
  if (withoutPreviewPrefix === '/search' || withoutPreviewPrefix === '/anime-online') return '/anime-online'
  if (withoutPreviewPrefix === '/anime') return '/anime-online'
  if (withoutPreviewPrefix === '/manga-online') return '/manga-online'
  if (withoutPreviewPrefix === '/manga') return '/manga-online'
  if (withoutPreviewPrefix === '/mis-listas' || withoutPreviewPrefix === '/my-lists') return '/my-lists'
  if (withoutPreviewPrefix === '/descargas' || withoutPreviewPrefix === '/downloads') return '/local'
  if (withoutPreviewPrefix === '/history') return '/history'
  if (withoutPreviewPrefix === '/local') return '/local'
  if (withoutPreviewPrefix === '/settings') return '/settings'
  if (withoutPreviewPrefix === '/sources') return '/sources'
  if (withoutPreviewPrefix === '/tools') return '/tools'
  if (withoutPreviewPrefix === '/help') return '/help'
  if (withoutPreviewPrefix.startsWith('/anime/')) return withoutPreviewPrefix
  if (withoutPreviewPrefix.startsWith('/manga/')) return withoutPreviewPrefix
  return '/home'
}

export function isGui2PreviewPath(pathname = '/') {
  return String(pathname || '/').startsWith('/__rebuild')
}

export function withGui2Prefix(pathname = '/home', preview = false) {
  return preview ? `/__rebuild${pathname}` : pathname
}

export function getGui2RouteParams(pathname = '/') {
  const canonicalPath = normalizeGui2Path(pathname)

  if (canonicalPath.startsWith('/anime/')) {
    return {
      mediaType: 'anime',
      id: canonicalPath.split('/')[2] || '',
    }
  }

  if (canonicalPath.startsWith('/manga/')) {
    return {
      mediaType: 'manga',
      id: canonicalPath.split('/')[2] || '',
    }
  }

  return {}
}

function getGui2Locale(lang = 'en') {
  return lang === 'es' ? 'es' : 'en'
}

function getGui2Copy(lang = 'en') {
  const locale = getGui2Locale(lang)
  return {
    headings: {
      library: locale === 'en' ? 'Library' : 'Biblioteca',
      system: locale === 'en' ? 'System' : 'Sistema',
    },
    primary: [
      { key: 'home', label: locale === 'en' ? 'Home' : 'Inicio', path: '/home', icon: 'home' },
      { key: 'anime-online', label: locale === 'en' ? 'Anime Online' : 'Anime Online', path: '/anime-online', icon: 'anime' },
      { key: 'manga-online', label: locale === 'en' ? 'Manga Online' : 'Manga Online', path: '/manga-online', icon: 'manga' },
      { key: 'local', label: locale === 'en' ? 'Local Library' : 'Biblioteca local', path: '/local', icon: 'local' },
      { key: 'my-lists', label: locale === 'en' ? 'My Lists' : 'Mis listas', path: '/my-lists', icon: 'lists' },
    ],
    secondary: [
      { key: 'settings', label: locale === 'en' ? 'Settings' : 'Ajustes', path: '/settings', icon: 'settings' },
    ],
    meta: {
      animeDetail: {
        title: locale === 'en' ? 'Anime Detail' : 'Detalle de anime',
        subtitle: locale === 'en' ? 'Media landing' : 'Vista de anime',
      },
      mangaDetail: {
        title: locale === 'en' ? 'Manga Detail' : 'Detalle de manga',
        subtitle: locale === 'en' ? 'Reading landing' : 'Vista de lectura',
      },
      map: {
        '/home': { key: 'home', title: locale === 'en' ? 'Home' : 'Inicio', subtitle: locale === 'en' ? 'Global interface' : 'Interfaz principal' },
        '/anime-online': { key: 'anime-online', title: locale === 'en' ? 'Anime Online' : 'Anime Online', subtitle: locale === 'en' ? 'Online catalog' : 'Catalogo online' },
        '/manga-online': { key: 'manga-online', title: locale === 'en' ? 'Manga Online' : 'Manga Online', subtitle: locale === 'en' ? 'Online catalog' : 'Catalogo online' },
        '/local': { key: 'local', title: locale === 'en' ? 'Local Library' : 'Biblioteca local', subtitle: locale === 'en' ? 'Stored media' : 'Contenido guardado' },
        '/my-lists': { key: 'my-lists', title: locale === 'en' ? 'My Lists' : 'Mis listas', subtitle: locale === 'en' ? 'Collections and sync' : 'Colecciones y sincronizacion' },
        '/history': { key: 'history', title: locale === 'en' ? 'History' : 'Historial', subtitle: locale === 'en' ? 'Recent playback' : 'Reproduccion reciente' },
        '/settings': { key: 'settings', title: locale === 'en' ? 'Settings' : 'Ajustes', subtitle: locale === 'en' ? 'Playback, sync, library' : 'Reproduccion, sync y biblioteca' },
        '/sources': { key: 'sources', title: locale === 'en' ? 'Sources' : 'Fuentes', subtitle: locale === 'en' ? 'Provider control' : 'Control de proveedores' },
        '/tools': { key: 'tools', title: locale === 'en' ? 'Tools' : 'Herramientas', subtitle: locale === 'en' ? 'Desktop actions' : 'Acciones del escritorio' },
        '/help': { key: 'help', title: locale === 'en' ? 'Help' : 'Ayuda', subtitle: locale === 'en' ? 'Guide and support' : 'Guia y soporte' },
      },
    },
  }
}

export function getGui2Navigation(preview = false, lang = 'en') {
  const copy = getGui2Copy(lang)
  return {
    headings: copy.headings,
    primary: copy.primary.map((item) => ({ ...item, to: withGui2Prefix(item.path, preview) })),
    secondary: copy.secondary.map((item) => ({ ...item, to: withGui2Prefix(item.path, preview) })),
  }
}

export function getGui2RouteMeta(pathname = '/', lang = 'en') {
  const normalized = normalizeGui2Path(pathname)
  const copy = getGui2Copy(lang)

  if (normalized.startsWith('/anime/')) {
    return { key: 'anime-detail', title: copy.meta.animeDetail.title, subtitle: copy.meta.animeDetail.subtitle, canonicalPath: normalized }
  }

  if (normalized.startsWith('/manga/')) {
    return { key: 'manga-detail', title: copy.meta.mangaDetail.title, subtitle: copy.meta.mangaDetail.subtitle, canonicalPath: normalized }
  }

  return {
    ...(copy.meta.map[normalized] || copy.meta.map['/home']),
    canonicalPath: normalized,
  }
}
