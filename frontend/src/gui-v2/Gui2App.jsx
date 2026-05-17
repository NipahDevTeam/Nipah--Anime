import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import Search from '../pages/Search'
import MangaSearch from '../pages/MangaSearch'
import Local from '../pages/Local'
import { ToastContainer } from '../components/ui/Toast'
import NowPlaying from '../components/ui/NowPlaying'
import Gui2Shell from './shell/Gui2Shell'
import { getGui2RouteMeta, getGui2RouteParams, isGui2PreviewPath } from './routeRegistry'
import Gui2HomeRoute from './routes/Gui2HomeRoute'
import Gui2HistoryRoute from './routes/Gui2HistoryRoute'
import Gui2AnimeDetailRoute from './routes/Gui2AnimeDetailRoute'
import Gui2MangaDetailRoute from './routes/Gui2MangaDetailRoute'
import Gui2MyListsRoute from './routes/Gui2MyListsRoute'
import Gui2SettingsRoute from './routes/Gui2SettingsRoute'
import { Gui2HelpRoute, Gui2SourcesRoute, Gui2ToolsRoute } from './routes/Gui2UtilityRoutes'

function getContentForPath(pathname, preview) {
  const meta = getGui2RouteMeta(pathname)
  const params = getGui2RouteParams(pathname)
  const canonical = meta.canonicalPath

  if (canonical === '/home') return <Gui2HomeRoute preview={preview} />
  if (canonical === '/anime-online') return <Search />
  if (canonical === '/manga-online') return <MangaSearch />
  if (canonical === '/local') return <Local />
  if (canonical === '/my-lists') return <Gui2MyListsRoute preview={preview} />
  if (canonical === '/history') return <Gui2HistoryRoute preview={preview} />
  if (canonical === '/settings') return <Gui2SettingsRoute />
  if (canonical === '/sources') return <Gui2SourcesRoute />
  if (canonical === '/tools') return <Gui2ToolsRoute />
  if (canonical === '/help') return <Gui2HelpRoute />
  if (canonical.startsWith('/anime/')) return <Gui2AnimeDetailRoute mediaID={params.id} preview={preview} />
  if (canonical.startsWith('/manga/')) return <Gui2MangaDetailRoute mediaID={params.id} preview={preview} />
  return <Gui2HomeRoute preview={preview} />
}

export default function Gui2App() {
  const location = useLocation()
  const { lang } = useI18n()
  const preview = isGui2PreviewPath(location.pathname)
  const routeMeta = useMemo(() => getGui2RouteMeta(location.pathname, lang), [lang, location.pathname])
  const content = useMemo(() => getContentForPath(location.pathname, preview), [location.pathname, preview])

  return (
    <Gui2Shell routeMeta={routeMeta} preview={preview}>
      {content}
      <NowPlaying />
      <ToastContainer />
    </Gui2Shell>
  )
}
