import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { wails, proxyImage } from '../lib/wails'
import { useI18n } from '../lib/i18n'
import { toastSuccess, toastError } from '../components/ui/Toast'
import { filterAndSortMangaEntries } from '../lib/myListsView'

const STATUSES = ['WATCHING', 'PLANNING', 'COMPLETED', 'ON_HOLD', 'DROPPED']

const ANIME_STATUS_LABELS = {
  es: {
    WATCHING: 'Viendo',
    PLANNING: 'Planeado',
    COMPLETED: 'Completado',
    ON_HOLD: 'En pausa',
    DROPPED: 'Abandonado',
    ALL: 'Todos',
  },
  en: {
    WATCHING: 'Watching',
    PLANNING: 'Planning',
    COMPLETED: 'Completed',
    ON_HOLD: 'On Hold',
    DROPPED: 'Dropped',
    ALL: 'All',
  },
}

const MANGA_STATUS_LABELS = {
  es: {
    WATCHING: 'Leyendo',
    PLANNING: 'Planeado',
    COMPLETED: 'Completado',
    ON_HOLD: 'En pausa',
    DROPPED: 'Abandonado',
    ALL: 'Todos',
  },
  en: {
    WATCHING: 'Reading',
    PLANNING: 'Planning',
    COMPLETED: 'Completed',
    ON_HOLD: 'On Hold',
    DROPPED: 'Dropped',
    ALL: 'All',
  },
}

export default function MyLists() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const isEnglish = lang === 'en'

  const animeLabels = ANIME_STATUS_LABELS[lang] || ANIME_STATUS_LABELS.es
  const mangaLabels = MANGA_STATUS_LABELS[lang] || MANGA_STATUS_LABELS.es

  const [activeMediaType, setActiveMediaType] = useState('anime')
  const [animeEntries, setAnimeEntries] = useState([])
  const [animeCounts, setAnimeCounts] = useState({})
  const [mangaEntries, setMangaEntries] = useState([])
  const [mangaCounts, setMangaCounts] = useState({})
  const [loadingAnime, setLoadingAnime] = useState(true)
  const [loadingManga, setLoadingManga] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addResults, setAddResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [addStatus, setAddStatus] = useState('PLANNING')
  const [confirmClear, setConfirmClear] = useState(false)
  const [mangaSearch, setMangaSearch] = useState('')
  const [mangaStatusFilter, setMangaStatusFilter] = useState('ALL')
  const [mangaSort, setMangaSort] = useState('UPDATED_DESC')
  const [mangaYearFilter, setMangaYearFilter] = useState('ALL')

  const loadAnimeCounts = useCallback(async () => {
    try {
      const counts = await wails.getAnimeListCounts()
      setAnimeCounts(counts ?? {})
    } catch {
      setAnimeCounts({})
    }
  }, [])

  const loadAnimeEntries = useCallback(async () => {
    setLoadingAnime(true)
    try {
      const list = await wails.getAnimeListAll()
      setAnimeEntries(list ?? [])
    } catch {
      setAnimeEntries([])
    }
    setLoadingAnime(false)
  }, [])

  const loadMangaCounts = useCallback(async () => {
    try {
      const counts = await wails.getMangaListCounts()
      setMangaCounts(counts ?? {})
    } catch {
      setMangaCounts({})
    }
  }, [])

  const loadMangaEntries = useCallback(async () => {
    setLoadingManga(true)
    try {
      const list = await wails.getMangaListAll()
      setMangaEntries(list ?? [])
    } catch {
      setMangaEntries([])
    }
    setLoadingManga(false)
  }, [])

  useEffect(() => {
    loadAnimeCounts()
    loadAnimeEntries()
    loadMangaCounts()
    loadMangaEntries()
  }, [loadAnimeCounts, loadAnimeEntries, loadMangaCounts, loadMangaEntries])

  const activeEntries = activeMediaType === 'anime' ? animeEntries : mangaEntries
  const activeCounts = activeMediaType === 'anime' ? animeCounts : mangaCounts
  const activeLabels = activeMediaType === 'anime' ? animeLabels : mangaLabels
  const isLoading = activeMediaType === 'anime' ? loadingAnime : loadingManga
  const totalCount = Object.values(activeCounts).reduce((acc, value) => acc + value, 0)

  const sections = STATUSES
    .map((status) => ({
      status,
      label: activeLabels[status],
      items: activeEntries.filter((entry) => entry.status === status),
    }))
    .filter((section) => section.items.length > 0)

  const mainSections = sections.filter((section) => section.status !== 'DROPPED')
  const droppedSection = sections.find((section) => section.status === 'DROPPED')

  const mangaYearOptions = useMemo(() => {
    const years = [...new Set(
      mangaEntries
        .map((entry) => Number(entry.year) || 0)
        .filter((year) => year > 0),
    )]
    return years.sort((a, b) => b - a)
  }, [mangaEntries])

  const filteredMangaEntries = useMemo(() => filterAndSortMangaEntries(mangaEntries, {
    query: mangaSearch,
    status: mangaStatusFilter,
    sort: mangaSort,
    year: mangaYearFilter,
  }), [mangaEntries, mangaSearch, mangaSort, mangaStatusFilter, mangaYearFilter])

  const scrollToSection = (status) => {
    const el = document.getElementById(`my-list-section-${activeMediaType}-${status}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const reportSyncResult = useCallback((result) => {
    if (!result) return
    if (result.remote_failed > 0) {
      const message = result.messages?.length
        ? result.messages.join(' ')
        : (isEnglish
            ? 'Some changes could not be synced and were queued for retry.'
            : 'Algunos cambios no se pudieron sincronizar y quedaron en cola.')
      toastError(message)
    }
  }, [isEnglish])

  const refreshAnime = useCallback(() => {
    loadAnimeEntries()
    loadAnimeCounts()
  }, [loadAnimeCounts, loadAnimeEntries])

  const refreshManga = useCallback(() => {
    loadMangaEntries()
    loadMangaCounts()
  }, [loadMangaCounts, loadMangaEntries])

  const handleAnimeStatusChange = async (anilistID, newStatus) => {
    try {
      const result = await wails.updateAnimeListStatus(anilistID, newStatus)
      reportSyncResult(result)
      refreshAnime()
    } catch (e) {
      toastError('Error: ' + (e?.message || 'unknown'))
    }
  }

  const handleAnimeScoreChange = async (anilistID, score) => {
    try {
      setAnimeEntries((prev) => prev.map((entry) => (
        entry.anilist_id === anilistID ? { ...entry, score } : entry
      )))
      const result = await wails.updateAnimeListScore(anilistID, score)
      reportSyncResult(result)
    } catch {}
  }

  const handleAnimeProgressChange = async (anilistID, episodes) => {
    try {
      setAnimeEntries((prev) => prev.map((entry) => (
        entry.anilist_id === anilistID ? { ...entry, episodes_watched: episodes } : entry
      )))
      const result = await wails.updateAnimeListProgress(anilistID, episodes)
      reportSyncResult(result)
    } catch {}
  }

  const handleAnimeRemove = async (anilistID) => {
    try {
      if (!window.confirm(isEnglish ? 'Remove this anime from your local list?' : '¿Eliminar este anime de tu lista local?')) return
      const syncRemote = window.confirm(
        isEnglish
          ? 'Do you also want to remove it from AniList if it is connected?'
          : '¿Tambien quieres eliminarlo de AniList y MyAnimeList si estan conectados?',
      )
      const result = await wails.removeFromAnimeList(anilistID, syncRemote)
      reportSyncResult(result)
      refreshAnime()
    } catch {}
  }

  const handleMangaStatusChange = async (anilistID, newStatus) => {
    try {
      const result = await wails.updateMangaListStatus(anilistID, newStatus)
      reportSyncResult(result)
      refreshManga()
    } catch (e) {
      toastError('Error: ' + (e?.message || 'unknown'))
    }
  }

  const handleMangaScoreChange = async (anilistID, score) => {
    try {
      setMangaEntries((prev) => prev.map((entry) => (
        entry.anilist_id === anilistID ? { ...entry, score } : entry
      )))
      const result = await wails.updateMangaListScore(anilistID, score)
      reportSyncResult(result)
    } catch {}
  }

  const handleMangaProgressChange = async (anilistID, chapters) => {
    try {
      setMangaEntries((prev) => prev.map((entry) => (
        entry.anilist_id === anilistID ? { ...entry, chapters_read: chapters } : entry
      )))
      const result = await wails.updateMangaListProgress(anilistID, chapters)
      reportSyncResult(result)
    } catch {}
  }

  const handleMangaRemove = async (anilistID) => {
    try {
      if (!window.confirm(isEnglish ? 'Remove this manga from your local list?' : '¿Eliminar este manga de tu lista local?')) return
      const syncRemote = window.confirm(
        isEnglish
          ? 'Do you also want to remove it from AniList if it is connected?'
          : '¿Tambien quieres eliminarlo de AniList y MyAnimeList si estan conectados?',
      )
      const result = await wails.removeFromMangaList(anilistID, syncRemote)
      reportSyncResult(result)
      refreshManga()
    } catch {}
  }

  const handleClearList = async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }

    try {
      if (activeMediaType === 'anime') {
        await wails.clearAnimeList()
        refreshAnime()
      } else {
        await wails.clearMangaList()
        refreshManga()
      }
      toastSuccess(
        activeMediaType === 'anime'
          ? (isEnglish ? 'Anime list cleared' : 'Lista borrada')
          : (isEnglish ? 'Manga list cleared' : 'Lista de manga borrada'),
      )
    } catch {}

    setConfirmClear(false)
  }

  const handleSearchToAdd = async () => {
    if (!addQuery.trim()) return
    setSearching(true)
    try {
      const result = await wails.searchAniList(addQuery.trim(), lang)
      const media = result?.data?.Page?.media || []
      setAddResults(media)
    } catch {
      setAddResults([])
    }
    setSearching(false)
  }

  const handleAddAnime = async (anime) => {
    try {
      const result = await wails.addToAnimeList(
        anime.id,
        anime.idMal || 0,
        anime.title?.romaji || anime.title?.english || '',
        anime.title?.english || '',
        anime.coverImage?.large || anime.coverImage?.medium || '',
        addStatus,
        0,
        anime.episodes || 0,
        0,
        anime.status || '',
        anime.seasonYear || 0,
      )
      reportSyncResult(result)
      toastSuccess(`"${anime.title?.romaji || anime.title?.english}" ${t('agregado')}`)
      refreshAnime()
    } catch (e) {
      toastError('Error: ' + (e?.message || 'unknown'))
    }
  }

  return (
    <div className="my-lists-page fade-in">
      <div className="section-header">
        <span className="section-title">
          {t('Mis Listas')}
          {totalCount > 0 && <span className="badge badge-muted" style={{ marginLeft: 8 }}>{totalCount}</span>}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {activeMediaType === 'anime' && (
            <>
              <button className="btn btn-ghost" onClick={() => { setShowAdd(!showAdd) }}>
                + {t('Agregar anime')}
              </button>
            </>
          )}
          <button className="btn btn-danger" onClick={handleClearList}>
            {confirmClear
              ? (isEnglish ? 'Confirm. Click again' : 'Confirmar. Haz clic de nuevo')
              : (activeMediaType === 'anime' ? t('Borrar lista') : (isEnglish ? 'Clear manga list' : 'Borrar manga'))}
          </button>
        </div>
      </div>

      <div className="list-media-switch" role="tablist" aria-label={isEnglish ? 'List type' : 'Tipo de lista'}>
        <button
          type="button"
          className={`list-media-switch-btn${activeMediaType === 'anime' ? ' active' : ''}`}
          onClick={() => {
            setActiveMediaType('anime')
            setConfirmClear(false)
          }}
        >
          Anime
          <span className="list-media-switch-count">{Object.values(animeCounts).reduce((acc, value) => acc + value, 0)}</span>
        </button>
        <button
          type="button"
          className={`list-media-switch-btn${activeMediaType === 'manga' ? ' active' : ''}`}
          onClick={() => {
            setActiveMediaType('manga')
            setShowAdd(false)
            setConfirmClear(false)
          }}
        >
          Manga
          <span className="list-media-switch-count">{Object.values(mangaCounts).reduce((acc, value) => acc + value, 0)}</span>
        </button>
      </div>

      {activeMediaType === 'anime' && showAdd && (
        <div className="mal-import-panel">
          <div className="mal-import-header">
            <span>+ {t('Agregar anime a tu lista')}</span>
          </div>
          <div className="mal-import-form">
            <input
              type="text"
              className="input"
              placeholder={t('Buscar anime en AniList...')}
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchToAdd()}
            />
            <select className="input add-status-select" value={addStatus} onChange={(e) => setAddStatus(e.target.value)}>
              {STATUSES.map((status) => <option key={status} value={status}>{animeLabels[status]}</option>)}
            </select>
            <button className="btn btn-primary" onClick={handleSearchToAdd} disabled={searching}>
              {searching ? '...' : t('Buscar')}
            </button>
          </div>
          {addResults.length > 0 && (
            <div className="add-anime-results">
              {addResults.map((anime) => (
                <div key={anime.id} className="add-anime-item">
                  <img src={anime.coverImage?.medium || ''} alt={anime.title?.romaji} className="add-anime-cover" />
                  <div className="add-anime-info">
                    <div className="add-anime-title">{anime.title?.romaji || anime.title?.english}</div>
                    <div className="add-anime-meta">
                      {anime.seasonYear ? `${anime.seasonYear} · ` : ''}
                      {anime.episodes ? `${anime.episodes} eps` : ''}
                      {anime.averageScore ? ` · ${Number(anime.averageScore / 10).toFixed(1)}` : ''}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleAddAnime(anime)}>
                    + {animeLabels[addStatus]}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="list-overview-bar">
        <div className="list-overview-title-wrap">
          <div className="list-overview-title">{activeMediaType === 'anime' ? (isEnglish ? 'My Anime' : 'Mi Lista') : (isEnglish ? 'My Manga' : 'Mi Manga')}</div>
          {totalCount > 0 && <span className="badge badge-muted">{totalCount}</span>}
        </div>
        {droppedSection && (
          <button className="list-overview-link" onClick={() => scrollToSection('DROPPED')}>
            {activeLabels.DROPPED}
            <span className="list-tab-count">{droppedSection.items.length}</span>
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="empty-state">
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
          </div>
        </div>
      ) : activeEntries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">{activeMediaType === 'anime' ? 'A' : 'M'}</div>
          <h2 className="empty-state-title">{activeMediaType === 'anime' ? (isEnglish ? 'Empty list' : 'Lista vacia') : (isEnglish ? 'Empty manga list' : 'Lista de manga vacia')}</h2>
          <p className="empty-state-desc">
            {activeMediaType === 'anime'
              ? t('list_empty_desc')
              : (isEnglish ? 'Sync AniList to see your saved manga here.' : 'Sincroniza AniList para ver aqui tu manga guardado.')}
          </p>
        </div>
      ) : activeMediaType === 'manga' ? (
        <div className="my-list-manga-showcase">
          <div className="my-list-manga-toolbar">
            <input
              type="text"
              className="input my-list-manga-search"
              placeholder={isEnglish ? 'Search your manga...' : 'Busca en tu manga...'}
              value={mangaSearch}
              onChange={(e) => setMangaSearch(e.target.value)}
            />
            <select
              className="input my-list-manga-select"
              value={mangaSort}
              onChange={(e) => setMangaSort(e.target.value)}
            >
              <option value="UPDATED_DESC">{isEnglish ? 'Recently updated' : 'Actualizados recientemente'}</option>
              <option value="SCORE_DESC">{isEnglish ? 'Highest score' : 'Mayor nota'}</option>
              <option value="TITLE_ASC">{isEnglish ? 'Name A-Z' : 'Nombre A-Z'}</option>
              <option value="TITLE_DESC">{isEnglish ? 'Name Z-A' : 'Nombre Z-A'}</option>
              <option value="YEAR_DESC">{isEnglish ? 'Newest year' : 'Año más reciente'}</option>
              <option value="PROGRESS_DESC">{isEnglish ? 'Most progress' : 'Mayor progreso'}</option>
              <option value="ADDED_DESC">{isEnglish ? 'Recently added' : 'Agregados recientemente'}</option>
            </select>
            <select
              className="input my-list-manga-select"
              value={mangaStatusFilter}
              onChange={(e) => setMangaStatusFilter(e.target.value)}
            >
              <option value="ALL">{mangaLabels.ALL}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>{mangaLabels[status]}</option>
              ))}
            </select>
            <select
              className="input my-list-manga-select"
              value={mangaYearFilter}
              onChange={(e) => setMangaYearFilter(e.target.value)}
            >
              <option value="ALL">{isEnglish ? 'All years' : 'Todos los años'}</option>
              {mangaYearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div className="my-list-manga-header">
            <div className="my-list-manga-heading">
              <span className="my-list-manga-heading-title">{isEnglish ? 'Library' : 'Biblioteca'}</span>
              <span className="my-list-manga-heading-count">{filteredMangaEntries.length}</span>
            </div>
            <div className="my-list-manga-heading-copy">
              {isEnglish
                ? 'A full visual shelf for every manga, manhwa, and manhua in your list.'
                : 'Una estantería visual completa para todo manga, manhwa y manhua en tu lista.'}
            </div>
          </div>

          {filteredMangaEntries.length > 0 ? (
            <div className="my-list-manga-showcase-grid">
              {filteredMangaEntries.map((entry) => (
                <MangaListCard
                  key={`manga-catalog-${entry.anilist_id}`}
                  entry={entry}
                  labels={mangaLabels}
                  onStatusChange={handleMangaStatusChange}
                  onScoreChange={handleMangaScoreChange}
                  onProgressChange={handleMangaProgressChange}
                  onRemove={handleMangaRemove}
                  navigate={navigate}
                  t={t}
                  variant="showcase"
                />
              ))}
            </div>
          ) : (
            <div className="nipah-empty-panel">
              <div className="nipah-empty-title">{isEnglish ? 'No manga matches those filters' : 'No hay manga con esos filtros'}</div>
              <div className="nipah-empty-copy">
                {isEnglish
                  ? 'Try a different status, year, or search term to bring titles back into view.'
                  : 'Prueba otro estado, ano o termino de busqueda para volver a mostrar titulos.'}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="my-list-sections">
          {mainSections.map((section) => (
            <section
              key={`${activeMediaType}-${section.status}`}
              id={`my-list-section-${activeMediaType}-${section.status}`}
              className="my-list-section"
            >
              <div className="my-list-section-header">
                <div className="my-list-section-title-wrap">
                  <div className="my-list-section-title">{section.label}</div>
                  <div className="my-list-section-count">{section.items.length}</div>
                </div>
              </div>

              <div className="my-list-grid">
                {section.items.map((entry) => (
                  activeMediaType === 'anime' ? (
                    <AnimeListCard
                      key={`anime-${entry.anilist_id}`}
                      entry={entry}
                      labels={animeLabels}
                      onStatusChange={handleAnimeStatusChange}
                      onScoreChange={handleAnimeScoreChange}
                      onProgressChange={handleAnimeProgressChange}
                      onRemove={handleAnimeRemove}
                      navigate={navigate}
                      t={t}
                    />
                  ) : (
                    <MangaListCard
                      key={`manga-${entry.anilist_id}`}
                      entry={entry}
                      labels={mangaLabels}
                      onStatusChange={handleMangaStatusChange}
                      onScoreChange={handleMangaScoreChange}
                      onProgressChange={handleMangaProgressChange}
                      onRemove={handleMangaRemove}
                      navigate={navigate}
                      t={t}
                    />
                  )
                ))}
              </div>
            </section>
          ))}

          {droppedSection && (
            <section
              id={`my-list-section-${activeMediaType}-DROPPED`}
              className="my-list-section my-list-section-separated"
            >
              <div className="my-list-section-header">
                <div className="my-list-section-title-wrap">
                  <div className="my-list-section-title">{droppedSection.label}</div>
                  <div className="my-list-section-count">{droppedSection.items.length}</div>
                </div>
              </div>

              <div className="my-list-grid">
                {droppedSection.items.map((entry) => (
                  activeMediaType === 'anime' ? (
                    <AnimeListCard
                      key={`anime-dropped-${entry.anilist_id}`}
                      entry={entry}
                      labels={animeLabels}
                      onStatusChange={handleAnimeStatusChange}
                      onScoreChange={handleAnimeScoreChange}
                      onProgressChange={handleAnimeProgressChange}
                      onRemove={handleAnimeRemove}
                      navigate={navigate}
                      t={t}
                    />
                  ) : (
                    <MangaListCard
                      key={`manga-dropped-${entry.anilist_id}`}
                      entry={entry}
                      labels={mangaLabels}
                      onStatusChange={handleMangaStatusChange}
                      onScoreChange={handleMangaScoreChange}
                      onProgressChange={handleMangaProgressChange}
                      onRemove={handleMangaRemove}
                      navigate={navigate}
                      t={t}
                    />
                  )
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function AnimeListCard({ entry, labels, onStatusChange, onScoreChange, onProgressChange, onRemove, navigate, t }) {
  const [editingProgress, setEditingProgress] = useState(false)
  const [tempProgress, setTempProgress] = useState(entry.episodes_watched)
  const [editingScore, setEditingScore] = useState(false)
  const [tempScore, setTempScore] = useState(entry.score)

  const coverSrc = entry.cover_image ? proxyImage(entry.cover_image) : ''
  const displayTitle = entry.title_english || entry.title
  const progressLabel = `${entry.episodes_watched}${entry.episodes_total > 0 ? ` / ${entry.episodes_total}` : ''}`

  return (
    <article className="my-list-card">
      <button
        type="button"
        className="my-list-card-visual"
        onClick={() => navigate('/search', {
          state: {
            preSearch: entry.title,
            altSearch: entry.title_english,
            preferredAnilistID: entry.anilist_id,
          },
        })}
      >
        <div className="my-list-card-art-wrap">
          {coverSrc ? <img src={coverSrc} alt={entry.title} className="my-list-card-art" /> : <div className="my-list-card-art my-list-card-art-placeholder" />}
          <div className="my-list-card-overlay" />
          <div className="my-list-card-topline">
            {entry.year > 0 && <span className="my-list-card-pill">{entry.year}</span>}
            {entry.score > 0 && <span className="my-list-card-pill accent">{entry.score}</span>}
          </div>
          <div className="my-list-card-copy">
            <div className="my-list-card-title">{displayTitle}</div>
            {entry.title_english && entry.title_english !== entry.title && (
              <div className="my-list-card-subtitle">{entry.title}</div>
            )}
            <div className="my-list-card-meta">
              <span>{progressLabel}</span>
              {entry.airing_status ? <span>{entry.airing_status}</span> : null}
            </div>
          </div>
        </div>
      </button>

      <div className="my-list-card-controls">
        <div className="my-list-card-control-group">
          <span className="my-list-control-label">{t('Progreso')}</span>
          {editingProgress ? (
            <input
              type="number"
              className="input my-list-number-input"
              value={tempProgress}
              min={0}
              max={entry.episodes_total || 9999}
              onChange={(e) => setTempProgress(parseInt(e.target.value, 10) || 0)}
              onBlur={() => {
                onProgressChange(entry.anilist_id, tempProgress)
                setEditingProgress(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onProgressChange(entry.anilist_id, tempProgress)
                  setEditingProgress(false)
                }
              }}
              autoFocus
            />
          ) : (
            <button type="button" className="my-list-inline-btn" onClick={() => setEditingProgress(true)}>
              {progressLabel}
            </button>
          )}
        </div>

        <div className="my-list-card-control-group">
          <span className="my-list-control-label">{t('Nota')}</span>
          {editingScore ? (
            <input
              type="number"
              className="input my-list-number-input"
              value={tempScore}
              min={0}
              max={10}
              step={1}
              onChange={(e) => setTempScore(parseFloat(e.target.value) || 0)}
              onBlur={() => {
                onScoreChange(entry.anilist_id, tempScore)
                setEditingScore(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onScoreChange(entry.anilist_id, tempScore)
                  setEditingScore(false)
                }
              }}
              autoFocus
            />
          ) : (
            <button type="button" className="my-list-inline-btn" onClick={() => setEditingScore(true)}>
              {entry.score > 0 ? `${entry.score}` : '-'}
            </button>
          )}
        </div>

        <div className="my-list-card-actions">
          <select className="input my-list-status-select" value={entry.status} onChange={(e) => onStatusChange(entry.anilist_id, e.target.value)}>
            {Object.entries(labels).filter(([key]) => key !== 'ALL').map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm my-list-remove-btn" onClick={() => onRemove(entry.anilist_id)} title={t('Eliminar')}>
            X
          </button>
        </div>
      </div>
    </article>
  )
}

function MangaListCard({ entry, labels, onStatusChange, onScoreChange, onProgressChange, onRemove, navigate, t, variant = 'default' }) {
  const [editingProgress, setEditingProgress] = useState(false)
  const [tempProgress, setTempProgress] = useState(entry.chapters_read)
  const [editingScore, setEditingScore] = useState(false)
  const [tempScore, setTempScore] = useState(entry.score)

  const coverSrc = entry.cover_image ? proxyImage(entry.cover_image) : ''
  const displayTitle = entry.title_english || entry.title
  const chapterLabel = `${entry.chapters_read}${entry.chapters_total > 0 ? ` / ${entry.chapters_total}` : ''}`
  const volumeLabel = entry.volumes_total > 0 || entry.volumes_read > 0
    ? `${entry.volumes_read}${entry.volumes_total > 0 ? ` / ${entry.volumes_total}` : ''} vol`
    : ''

  return (
    <article className={`my-list-card${variant === 'showcase' ? ' my-list-card-showcase' : ''}`}>
      <button
        type="button"
        className="my-list-card-visual"
        onClick={() => navigate('/manga-online', {
          state: {
            preSearch: entry.title,
            altSearch: entry.title_english,
            preferredAnilistID: entry.anilist_id,
          },
        })}
      >
        <div className="my-list-card-art-wrap">
          {coverSrc ? <img src={coverSrc} alt={entry.title} className="my-list-card-art" /> : <div className="my-list-card-art my-list-card-art-placeholder" />}
          <div className="my-list-card-overlay" />
          <div className="my-list-card-topline">
            {entry.year > 0 && <span className="my-list-card-pill">{entry.year}</span>}
            {entry.score > 0 && <span className="my-list-card-pill accent">{entry.score}</span>}
          </div>
          <div className="my-list-card-copy">
            <div className="my-list-card-title">{displayTitle}</div>
            {entry.title_english && entry.title_english !== entry.title && (
              <div className="my-list-card-subtitle">{entry.title}</div>
            )}
            <div className="my-list-card-meta">
              <span>{chapterLabel} caps</span>
              {volumeLabel ? <span>{volumeLabel}</span> : null}
            </div>
          </div>
        </div>
      </button>

      <div className="my-list-card-controls">
        <div className="my-list-card-control-group">
          <span className="my-list-control-label">{t('Progreso')}</span>
          {editingProgress ? (
            <input
              type="number"
              className="input my-list-number-input"
              value={tempProgress}
              min={0}
              max={entry.chapters_total || 9999}
              onChange={(e) => setTempProgress(parseInt(e.target.value, 10) || 0)}
              onBlur={() => {
                onProgressChange(entry.anilist_id, tempProgress)
                setEditingProgress(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onProgressChange(entry.anilist_id, tempProgress)
                  setEditingProgress(false)
                }
              }}
              autoFocus
            />
          ) : (
            <button type="button" className="my-list-inline-btn" onClick={() => setEditingProgress(true)}>
              {chapterLabel}
            </button>
          )}
        </div>

        <div className="my-list-card-control-group">
          <span className="my-list-control-label">{t('Nota')}</span>
          {editingScore ? (
            <input
              type="number"
              className="input my-list-number-input"
              value={tempScore}
              min={0}
              max={10}
              step={1}
              onChange={(e) => setTempScore(parseFloat(e.target.value) || 0)}
              onBlur={() => {
                onScoreChange(entry.anilist_id, tempScore)
                setEditingScore(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onScoreChange(entry.anilist_id, tempScore)
                  setEditingScore(false)
                }
              }}
              autoFocus
            />
          ) : (
            <button type="button" className="my-list-inline-btn" onClick={() => setEditingScore(true)}>
              {entry.score > 0 ? `${entry.score}` : '-'}
            </button>
          )}
        </div>

        <div className="my-list-card-actions">
          <select className="input my-list-status-select" value={entry.status} onChange={(e) => onStatusChange(entry.anilist_id, e.target.value)}>
            {Object.entries(labels).filter(([key]) => key !== 'ALL').map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm my-list-remove-btn" onClick={() => onRemove(entry.anilist_id)} title={t('Eliminar')}>
            X
          </button>
        </div>
      </div>
    </article>
  )
}
