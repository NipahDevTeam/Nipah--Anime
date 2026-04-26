import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import AnimeLibrary from './AnimeLibrary'
import MangaLibrary from './MangaLibrary'
import Downloads from './Downloads'

const TABS = ['anime', 'manga', 'downloads']

export default function Local() {
  const { lang } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = (searchParams.get('tab') || '').toLowerCase()
  const activeTab = TABS.includes(requestedTab) ? requestedTab : 'anime'
  const isEnglish = lang === 'en'

  const setTab = (tab) => {
    setSearchParams(tab === 'anime' ? {} : { tab })
  }

  return (
    <div className="local-page fade-in">
      <section className="local-tabs-shell">
        <div className="local-tabs" role="tablist" aria-label={isEnglish ? 'Local sections' : 'Secciones locales'}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'anime'}
            className={`local-tab${activeTab === 'anime' ? ' active' : ''}`}
            onClick={() => setTab('anime')}
          >
            {isEnglish ? 'Anime' : 'Anime'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'manga'}
            className={`local-tab${activeTab === 'manga' ? ' active' : ''}`}
            onClick={() => setTab('manga')}
          >
            {isEnglish ? 'Manga' : 'Manga'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'downloads'}
            className={`local-tab${activeTab === 'downloads' ? ' active' : ''}`}
            onClick={() => setTab('downloads')}
          >
            {isEnglish ? 'Downloads' : 'Descargas'}
          </button>
        </div>

        <div className="local-tab-panel" role="tabpanel">
          {activeTab === 'anime' ? <AnimeLibrary embedded /> : null}
          {activeTab === 'manga' ? <MangaLibrary embedded /> : null}
          {activeTab === 'downloads' ? <Downloads embedded /> : null}
        </div>
      </section>
    </div>
  )
}
