import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { wails } from '../lib/wails'
import { mirrorLocaleQueryCache } from './localeQueryCache.js'

const translations = {
  es: {
    'Inicio': 'Inicio',
    'Anime': 'Anime',
    'Manga': 'Manga',
    'Descubrir': 'Descubrir',
    'Anime online': 'Anime online',
    'Manga online': 'Manga online',
    'Ajustes': 'Ajustes',
    'BIBLIOTECA': 'BIBLIOTECA',
    'ONLINE': 'ONLINE',
    'APP': 'APP',
    'Anime local': 'Anime local',
    'Anime online (stat)': 'Anime online',
    'Manga local': 'Manga local',
    'Eps vistos': 'Eps vistos',
    'Continuar viendo': 'Continuar viendo',
    'Continuar viendo (online)': 'Continuar viendo (online)',
    'Continuar viendo (local)': 'Continuar viendo (local)',
    'Continuar leyendo': 'Continuar leyendo',
    'Continuar leyendo (online)': 'Continuar leyendo (online)',
    'Continuar leyendo (local)': 'Continuar leyendo (local)',
    'Historial reciente': 'Historial reciente',
    'Recientemente agregado': 'Recientemente agregado',
    'Completados': 'Completados',
    'en progreso': 'en progreso',
    'Series terminadas': 'Series terminadas',
    'Editar': 'Editar',
    'Listo': 'Listo',
    'Borrar historial': 'Borrar historial',
    'Borrando...': 'Borrando...',
    'Â¿Confirmar? Haz clic de nuevo': 'Â¿Confirmar? Haz clic de nuevo',
    'Buscar anime': 'Buscar anime',
    'Buscar manga': 'Buscar manga',
    'Bienvenido a': 'Bienvenido a',
    'Tu biblioteca personal de anime y manga en espaÃ±ol.': 'Tu biblioteca personal de anime y manga en espaÃ±ol.',
    'Biblioteca local': 'Biblioteca local',
    'Modo online': 'Modo online',
    '+ Agregar biblioteca': '+ Agregar biblioteca',
    'Buscar online': 'Buscar online',
    'Buscar anime en todas las fuentes...': 'Buscar anime en todas las fuentes...',
    'Buscar': 'Buscar',
    'Buscando...': 'Buscando...',
    'Resultados': 'Resultados',
    'Sin resultados': 'Sin resultados',
    'BÃºsqueda paralela en todas las fuentes': 'BÃºsqueda paralela en todas las fuentes',
    'Buscar manga en MangaDex...': 'Buscar manga en MangaDex...',
    'Leer manga online': 'Leer manga online',
    'CapÃ­tulos': 'CapÃ­tulos',
    'CapÃ­tulo': 'CapÃ­tulo',
    'ðŸ“– Leer': 'ðŸ“– Leer',
    'â† Resultados': 'â† Resultados',
    'No hay capÃ­tulos en este idioma. Prueba con otro idioma arriba.': 'No hay capÃ­tulos en este idioma. Prueba con otro idioma arriba.',
    'Episodios': 'Episodios',
    'Episodio': 'Episodio',
    'Ep.': 'Ep.',
    'Cap.': 'Cap.',
    'â–¶ Ver': 'â–¶ Ver',
    'â†© Ver de nuevo': 'â†© Ver de nuevo',
    'â† Volver': 'â† Volver',
    'Volver': 'Volver',
    'Abriendo en MPVâ€¦': 'Abriendo en MPVâ€¦',
    'Guardar ajustes': 'Guardar ajustes',
    'Guardando...': 'Guardando...',
    'Ajustes guardados correctamente': 'Ajustes guardados correctamente',
    'Idioma y regiÃ³n': 'Idioma y regiÃ³n',
    'ReproducciÃ³n': 'ReproducciÃ³n',
    'Lectura de manga': 'Lectura de manga',
    'Biblioteca': 'Biblioteca',
    'Carpetas registradas': 'Carpetas registradas',
    'Eliminar': 'Eliminar',
    'Agregar carpeta': 'Agregar carpeta',
    'sin portada': 'sin portada',
    'Sin tÃ­tulo': 'Sin tÃ­tulo',
    'caps desconocidos': 'caps desconocidos',
    'Mis Listas': 'Mis Listas',
    'Importar de MAL': 'Importar de MAL',
    'Importar desde MyAnimeList': 'Importar desde MyAnimeList',
    'mal_xml_label': 'Importar desde archivo XML (recomendado)',
    'mal_xml_desc': 'Exporta tu lista desde MAL (Perfil â†’ ConfiguraciÃ³n â†’ Exportar) y selecciona el archivo .xml descargado.',
    'mal_xml_button': 'Seleccionar archivo XML...',
    'mal_username_label': 'Importar por nombre de usuario',
    'mal_username_desc': 'Solo funciona con perfiles pÃºblicos de MyAnimeList.',
    'o': 'o',
    'Usuario de MAL': 'Usuario de MAL',
    'Importar': 'Importar',
    'Importando...': 'Importando...',
    'mal_importing_msg': 'Importando tu lista... esto puede tomar unos segundos.',
    'anime importados': 'anime importados',
    'Agregar anime': 'Agregar anime',
    'Agregar anime a tu lista': 'Agregar anime a tu lista',
    'Buscar anime en AniList...': 'Buscar anime en AniList...',
    'agregado': 'agregado',
    'Lista vacÃ­a': 'Lista vacÃ­a',
    'list_empty_desc': 'Agrega anime manualmente o importa desde MyAnimeList.',
    'TÃ­tulo': 'TÃ­tulo',
    'Progreso': 'Progreso',
    'Nota': 'Nota',
    'Estado': 'Estado',
    'Borrar lista': 'Borrar lista',
    'Lista borrada': 'Lista borrada',
    'Watching': 'Viendo',
    'Planning': 'Planeado',
    'Completed (list)': 'Completados',
    'On Hold': 'En pausa',
    'Descargas': 'Descargas',
    'Descargar': 'Descargar',
    'Descarga iniciada': 'Descarga iniciada',
    'Error al descargar': 'Error al descargar',
    'No hay links de descarga disponibles para este episodio': 'No hay links de descarga disponibles para este episodio',
    'Sin descargas': 'Sin descargas',
    'dl_empty_desc': 'Descarga episodios desde la secciÃ³n de Anime Online para verlos sin conexiÃ³n.',
    'Pendiente...': 'Pendiente...',
    'Completado': 'Completado',
    'Cancelado': 'Cancelado',
    'completados': 'completados',
    'Sin episodios': 'Sin episodios',
    'Selecciona un episodio para verlo en MPV.': 'Selecciona un episodio para verlo en MPV. Los streams se resuelven al momento.',
    'Ver de nuevo': 'Ver de nuevo',
    'Visto': 'Visto',
    'LeÃ­do': 'LeÃ­do',
    'Cargando pÃ¡ginas...': 'Cargando pÃ¡ginas...',
    'Reanudar en': 'Reanudar en',
    'âŸ³ Reanudar': 'âŸ³ Reanudar',
    'En pÃ¡gina': 'En pÃ¡gina',
    'update_section': 'Actualizaciones',
    'update_checking': 'Buscando actualizaciones...',
    'update_current': 'Estás al día',
    'update_available': 'Nueva versión disponible',
    'update_install': 'Instalar ahora',
    'update_open_release': 'Ver en GitHub',
    'update_check_again': 'Buscar de nuevo',
    'update_changelog': 'Novedades',
    'update_error': 'No se pudo verificar actualizaciones',
  },
  en: {
    'Inicio': 'Home',
    'Anime': 'Anime',
    'Manga': 'Manga',
    'Descubrir': 'Discover',
    'Anime online': 'Anime Online',
    'Manga online': 'Manga Online',
    'Ajustes': 'Settings',
    'BIBLIOTECA': 'LIBRARY',
    'ONLINE': 'ONLINE',
    'APP': 'APP',
    'Anime local': 'Local anime',
    'Anime online (stat)': 'Online anime',
    'Manga local': 'Local manga',
    'Eps vistos': 'Episodes watched',
    'Continuar viendo': 'Continue watching',
    'Continuar viendo (online)': 'Continue watching (online)',
    'Continuar viendo (local)': 'Continue watching (local)',
    'Continuar leyendo': 'Continue reading',
    'Continuar leyendo (online)': 'Continue reading (online)',
    'Continuar leyendo (local)': 'Continue reading (local)',
    'Historial reciente': 'Recent history',
    'Recientemente agregado': 'Recently added',
    'Completados': 'Completed',
    'en progreso': 'in progress',
    'Series terminadas': 'Finished series',
    'Editar': 'Edit',
    'Listo': 'Done',
    'Borrar historial': 'Clear history',
    'Borrando...': 'Clearing...',
    'Â¿Confirmar? Haz clic de nuevo': 'Confirm? Click again',
    'Buscar anime': 'Search anime',
    'Buscar manga': 'Search manga',
    'Bienvenido a': 'Welcome to',
    'Tu biblioteca personal de anime y manga en espaÃ±ol.': 'Your personal anime and manga library.',
    'Biblioteca local': 'Local library',
    'Modo online': 'Online mode',
    '+ Agregar biblioteca': '+ Add library',
    'Buscar online': 'Search online',
    'Buscar anime en todas las fuentes...': 'Search anime across all sources...',
    'Buscar': 'Search',
    'Buscando...': 'Searching...',
    'Resultados': 'Results',
    'Sin resultados': 'No results',
    'BÃºsqueda paralela en todas las fuentes': 'Parallel search across all sources',
    'Buscar manga en MangaDex...': 'Search manga on MangaDex...',
    'Leer manga online': 'Read manga online',
    'CapÃ­tulos': 'Chapters',
    'CapÃ­tulo': 'Chapter',
    'ðŸ“– Leer': 'ðŸ“– Read',
    'â† Resultados': 'â† Results',
    'No hay capÃ­tulos en este idioma. Prueba con otro idioma arriba.': 'No chapters available in this language. Try a different one above.',
    'Episodios': 'Episodes',
    'Episodio': 'Episode',
    'Ep.': 'Ep.',
    'Cap.': 'Ch.',
    'â–¶ Ver': 'â–¶ Watch',
    'â†© Ver de nuevo': 'â†© Watch again',
    'â† Volver': 'â† Back',
    'Volver': 'Back',
    'Abriendo en MPVâ€¦': 'Opening in MPVâ€¦',
    'Guardar ajustes': 'Save settings',
    'Guardando...': 'Saving...',
    'Ajustes guardados correctamente': 'Settings saved successfully',
    'Idioma y regiÃ³n': 'Language and region',
    'ReproducciÃ³n': 'Playback',
    'Lectura de manga': 'Manga reading',
    'Biblioteca': 'Library',
    'Carpetas registradas': 'Registered folders',
    'Eliminar': 'Remove',
    'Agregar carpeta': 'Add folder',
    'sin portada': 'no cover',
    'Sin tÃ­tulo': 'Untitled',
    'caps desconocidos': 'unknown episodes',
    'Mis Listas': 'My Lists',
    'Importar de MAL': 'Import from MAL',
    'Importar desde MyAnimeList': 'Import from MyAnimeList',
    'mal_xml_label': 'Import from XML file (recommended)',
    'mal_xml_desc': 'Export your list from MAL (Profile â†’ Settings â†’ Export) and select the downloaded .xml file.',
    'mal_xml_button': 'Select XML file...',
    'mal_username_label': 'Import by username',
    'mal_username_desc': 'Only works with public MyAnimeList profiles.',
    'o': 'or',
    'Usuario de MAL': 'MAL username',
    'Importar': 'Import',
    'Importando...': 'Importing...',
    'mal_importing_msg': 'Importing your list... this may take a few seconds.',
    'anime importados': 'anime imported',
    'Agregar anime': 'Add anime',
    'Agregar anime a tu lista': 'Add anime to your list',
    'Buscar anime en AniList...': 'Search anime on AniList...',
    'agregado': 'added',
    'Lista vacÃ­a': 'Empty list',
    'list_empty_desc': 'Add anime manually or import it from MyAnimeList.',
    'TÃ­tulo': 'Title',
    'Progreso': 'Progress',
    'Nota': 'Score',
    'Estado': 'Status',
    'Borrar lista': 'Clear list',
    'Lista borrada': 'List cleared',
    'Watching': 'Watching',
    'Planning': 'Planning',
    'Completed (list)': 'Completed',
    'On Hold': 'On Hold',
    'Descargas': 'Downloads',
    'Descargar': 'Download',
    'Descarga iniciada': 'Download started',
    'Error al descargar': 'Download error',
    'No hay links de descarga disponibles para este episodio': 'No download links are available for this episode',
    'Sin descargas': 'No downloads',
    'dl_empty_desc': 'Download episodes from Anime Online to watch them offline.',
    'Pendiente...': 'Pending...',
    'Completado': 'Completed',
    'Cancelado': 'Cancelled',
    'completados': 'completed',
    'Sin episodios': 'No episodes',
    'Selecciona un episodio para verlo en MPV.': 'Select an episode to watch it in MPV. Streams are resolved when opened.',
    'Ver de nuevo': 'Watch again',
    'Visto': 'Watched',
    'LeÃ­do': 'Read',
    'Cargando pÃ¡ginas...': 'Loading pages...',
    'Reanudar en': 'Resume at',
    'âŸ³ Reanudar': 'âŸ³ Resume',
    'En pÃ¡gina': 'On page',
    'update_section': 'Updates',
    'update_checking': 'Checking for updates...',
    'update_current': 'You are up to date',
    'update_available': 'New version available',
    'update_install': 'Install now',
    'update_open_release': 'View on GitHub',
    'update_check_again': 'Check again',
    'update_changelog': "What's new",
    'update_error': 'Could not check for updates',
  },
}

function getSystemLanguage() {
  if (typeof navigator === 'undefined') return 'en'
  const value = `${navigator.language || ''}`.toLowerCase()
  return value.startsWith('es') ? 'es' : 'en'
}

function looksMojibake(value) {
  return typeof value === 'string' && /Ã|Â|â€|â†|Å/.test(value)
}

function repairText(value) {
  if (typeof value !== 'string' || !looksMojibake(value)) return value
  let repaired = value
  for (let i = 0; i < 2; i += 1) {
    try {
      const bytes = Uint8Array.from([...repaired].map((char) => char.charCodeAt(0) & 0xff))
      const decoded = new TextDecoder('utf-8').decode(bytes)
      if (!decoded || decoded === repaired) break
      repaired = decoded
    } catch {
      break
    }
  }
  return repaired
}

function normalizeTranslations(input) {
  return Object.fromEntries(
    Object.entries(input).map(([lang, entries]) => [
      lang,
      Object.fromEntries(
        Object.entries(entries).map(([key, value]) => [repairText(key), repairText(value)])
      ),
    ])
  )
}

const normalizedTranslations = normalizeTranslations(translations)

const I18nContext = createContext({ t: (s) => s, lang: 'es', setLang: () => {} })

export function I18nProvider({ children }) {
  const queryClient = useQueryClient()
  const [lang, setLangState] = useState(getSystemLanguage())

  useEffect(() => {
    wails.getSettings().then((settings) => {
      if (settings?.language && (settings.language === 'es' || settings.language === 'en')) {
        setLangState(settings.language)
      }
    }).catch(() => {})
  }, [])

  const setLang = useCallback(async (newLang) => {
    const nextLang = newLang === 'en' ? 'en' : 'es'
    mirrorLocaleQueryCache(queryClient, lang, nextLang)
    setLangState(nextLang)
    try {
      await wails.saveSettings({ language: nextLang })
    } catch {}
  }, [lang, queryClient])

  const t = useCallback((key) => {
    const normalizedKey = repairText(key)
    return repairText(
      normalizedTranslations[lang]?.[normalizedKey]
      ?? normalizedTranslations.es?.[normalizedKey]
      ?? normalizedKey
    )
  }, [lang])

  return (
    <I18nContext.Provider value={{ t, lang, setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
