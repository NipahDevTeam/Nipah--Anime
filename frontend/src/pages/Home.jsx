import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MANGA_SOURCE_IDS, normalizeMangaSourceID } from '../lib/mangaSources'
import { proxyImage, wails } from '../lib/wails'
import { enrichJKAnimeHit } from '../lib/onlineAnimeResolver'
import { toastSuccess, toastError } from '../components/ui/Toast'
import { useI18n } from '../lib/i18n'

const SOURCE_COLORS = {
  'jkanime-es': '#c084fc',
  'animepahe-en': '#38bdf8',
  'mangaoni-es': '#52c07a',
  mangaoni: '#52c07a',
  'mangadex-es': '#f5a623',
  mangadex: '#f5a623',
}

const LIST_STATUS_PRIORITY = {
  WATCHING: 0,
  PLANNING: 1,
  ON_HOLD: 2,
  COMPLETED: 3,
}

function isMangaHistorySource(sourceID) {
  return MANGA_SOURCE_IDS.has(normalizeMangaSourceID(sourceID))
}

function getListStatusLabel(status, isEnglish = false) {
  switch (status) {
    case 'WATCHING': return isEnglish ? 'Watching' : 'Viendo'
    case 'PLANNING': return isEnglish ? 'Planning' : 'Planeado'
    case 'ON_HOLD': return isEnglish ? 'On Hold' : 'En pausa'
    case 'COMPLETED': return isEnglish ? 'Completed' : 'Completado'
    default: return status || ''
  }
}

function sortTrackedEntries(items) {
  return [...(items ?? [])].sort((a, b) => {
    const priorityDelta = (LIST_STATUS_PRIORITY[a.status] ?? 99) - (LIST_STATUS_PRIORITY[b.status] ?? 99)
    if (priorityDelta !== 0) return priorityDelta
    const aUpdated = new Date(a.updated_at ?? a.added_at ?? 0).getTime()
    const bUpdated = new Date(b.updated_at ?? b.added_at ?? 0).getTime()
    return bUpdated - aUpdated
  })
}

// Shared card components
// Shared card components
// Dashboard view
function OnlineHistoryCard({
  item,
  navigate,
  targetPath = '/search',
  chapterPrefix = 'Ep.',
  autoRead = false,
  onOpenAnime,
}) {
  const color = SOURCE_COLORS[item.source_id] ?? '#9090a8'

  return (
    <div
      className="dash-card dash-card-poster online-history-card"
      onClick={() => {
        if (targetPath === '/search' && onOpenAnime) {
          onOpenAnime(item)
          return
        }
        navigate(targetPath, {
          state: {
            autoOpen: {
              id: item.anime_id,
              title: item.anime_title,
              cover_url: item.cover_url,
              source_id: item.source_id,
              source_name: item.source_name,
            },
            ...(autoRead ? { autoReadChapterID: item.episode_id } : {}),
          }
        })
      }}
      title={`${item.anime_title} - Ep. ${item.episode_num ?? '?'}`}
    >
      <div className="dash-card-img-wrap">
        {item.cover_url
          ? <img src={proxyImage(item.cover_url)} alt={item.anime_title} className="dash-card-img" />
          : <div className="dash-card-img-placeholder" />
        }
        <div className="online-card-source-stripe" style={{ background: color }} />
      </div>
      <div className="dash-card-overlay" />
      <div className="dash-card-body">
        <div className="dash-card-title">{item.anime_title}</div>
        <div className="dash-card-meta">
          {chapterPrefix} {item.episode_num ?? '?'}
          {item.episode_title ? ` - ${item.episode_title}` : ''}
        </div>
        <div className="dash-card-meta" style={{ color, marginTop: 2 }}>
          {item.source_name}
        </div>
      </div>
    </div>
  )
}

function ProgressRing({ percent, size = 32 }) {
  const r = (size - 4) / 2
  const circ = 2 * Math.PI * r
  const filled = circ * (Math.min(percent, 100) / 100)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke="var(--accent)" strokeWidth={3}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
      />
    </svg>
  )
}

function ScrollRow({ title, subtitle, children, action }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null
  return (
    <div className="dash-row">
      <div className="dash-row-header">
        <span className="dash-row-title">{title}</span>
        {subtitle && <span className="dash-row-sub">{subtitle}</span>}
        {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
      </div>
      <div className="dash-scroll">{children}</div>
    </div>
  )
}

function DashHero({
  eyebrow,
  title,
  description,
  image,
  onClick,
  interactiveLabel,
}) {
  const interactive = typeof onClick === 'function'

  return (
    <section
      className={`dash-hero${interactive ? ' dash-hero-clickable' : ''}`}
      style={image ? { backgroundImage: `url(${image})` } : {}}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? interactiveLabel : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      } : undefined}
    >
      <div className="dash-hero-content">
        <span className="dash-hero-eyebrow">{eyebrow}</span>
        <h1 className="dash-hero-title">{title}</h1>
        <p className="dash-hero-desc">{description}</p>
      </div>
    </section>
  )
}

function DashSectionBar({ activeSection, onChange }) {
  return (
    <div className="dash-section-bar" role="tablist" aria-label="Dashboard sections">
      <button
        type="button"
        role="tab"
        aria-selected={activeSection === 'anime'}
        className={`dash-section-pill ${activeSection === 'anime' ? 'active' : ''}`}
        onClick={() => onChange('anime')}
      >
        Anime
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeSection === 'manga'}
        className={`dash-section-pill ${activeSection === 'manga' ? 'active' : ''}`}
        onClick={() => onChange('manga')}
      >
        Manga
      </button>
    </div>
  )
}

function ContinueCard({ item, onClick }) {
  return (
    <div className="dash-card dash-card-continue" onClick={onClick}>
      <div className="dash-card-img-wrap" style={{ width: 60, minWidth: 60, height: 80 }}>
        {item.cover_image
          ? <img src={item.cover_image} alt={item.anime_title} className="dash-card-img" />
          : <div className="dash-card-img-placeholder" />
        }
        <div className="dash-card-progress-ring">
          <ProgressRing percent={item.percent ?? 0} />
        </div>
      </div>
      <div className="dash-card-body">
        <div className="dash-card-title">{item.anime_title}</div>
        <div className="dash-card-meta">
          Ep. {item.episode_num ?? '?'}
          {item.percent != null && item.percent > 0 ? ` - ${Math.round(item.percent)}%` : ''}
        </div>
      </div>
      <div className="dash-card-play-btn">&gt;</div>
    </div>
  )
}

function TrackedListCard({ item, navigate, type = 'anime', isEnglish = false }) {
  const progressDone = type === 'manga' ? item.chapters_read : item.episodes_watched
  const progressTotal = type === 'manga' ? item.chapters_total : item.episodes_total
  const pct = progressTotal > 0
    ? Math.round((progressDone / progressTotal) * 100)
    : 0
  const unitLabel = type === 'manga' ? 'caps' : 'eps'
  const badgeText = getListStatusLabel(item.status, isEnglish)
  return (
    <div
      className="dash-card dash-card-poster"
      onClick={() => navigate(type === 'manga' ? '/manga-online' : '/search', {
        state: { preSearch: item.title, altSearch: item.title_english },
      })}
      title={item.title}
    >
      <div className="dash-card-img-wrap">
        {item.cover_image
          ? <img src={item.cover_image} alt={item.title} className="dash-card-img" />
          : <div className="dash-card-img-placeholder" />
        }
        {progressTotal > 0 && (
          <div className="dash-card-bar">
            <div className="dash-card-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="dash-card-overlay" />
      <div className="dash-card-body">
        <div className="dash-card-title">{item.title_english || item.title}</div>
        <div className="dash-card-meta">
          {progressDone}/{progressTotal || '?'} {unitLabel}
          {item.score > 0 ? ` - ${item.score}` : ''}
        </div>
        <div className="dash-card-meta">{badgeText}</div>
      </div>
    </div>
  )
}

function MediaCard({ item, onClick }) {
  const total = item.episodes_total
  const done  = item.watched_count
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0
  const unitLabel = item.unit_label || 'eps'
  return (
    <div className="dash-card dash-card-poster" onClick={onClick}>
      <div className="dash-card-img-wrap">
        {item.cover_image
          ? <img src={item.cover_image} alt={item.title} className="dash-card-img" />
          : <div className="dash-card-img-placeholder" />
        }
        {pct > 0 && (
          <div className="dash-card-bar">
            <div className="dash-card-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="dash-card-overlay" />
      <div className="dash-card-body">
        <div className="dash-card-title">{item.title}</div>
        <div className="dash-card-meta">
          {item.year ? `${item.year} - ` : ''}
          {total > 0 ? `${done}/${total}` : '?'} {unitLabel}
        </div>
      </div>
    </div>
  )
}

function WelcomePreviewCard({ tone = 'gold', title, meta, offset = '', wide = false }) {
  return (
    <div className={`welcome-preview-card ${tone} ${offset}${wide ? ' wide' : ''}`}>
      <div className="welcome-preview-card-art" />
      <div className="welcome-preview-card-copy">
        <div className="welcome-preview-card-title">{title}</div>
        <div className="welcome-preview-card-meta">{meta}</div>
      </div>
    </div>
  )
}

// Main Home component
// Main Home component
// Home page
export default function Home() {
  const [dash, setDash]             = useState(null)
  const [syncedManga, setSyncedManga] = useState([])
  const [loading, setLoading]       = useState(true)
  const { t, lang } = useI18n()
  const isEnglish = lang === 'en'
  const [editMode, setEditMode]     = useState(false)
  const [activeSection, setActiveSection] = useState('anime')
  const navigate = useNavigate()

  const load = useCallback(() => {
    Promise.all([
      wails.getDashboard(),
      wails.getMangaListAll().catch(() => []),
    ])
      .then(([dashboard, mangaList]) => {
        setDash(dashboard)
        setSyncedManga(mangaList ?? [])
      })
      .catch(() => {
        setDash(null)
        setSyncedManga([])
      })
      .finally(() => setLoading(false))
  }, [])

  const handleRemoveAnime = useCallback(async (sourceID, animeID) => {
    try {
      await wails.removeAnimeFromHistory(sourceID, animeID)
      load()
    } catch (e) {
      toastError(`${isEnglish ? 'Error removing from history' : 'Error al eliminar'}: ${e?.message ?? e}`)
    }
  }, [isEnglish, load])

  const openOnlineAnimeDirect = useCallback(async (item) => {
    const base = {
      id: item.anime_id ?? item.id,
      title: item.anime_title ?? item.title,
      title_english: item.title_english,
      anime_title: item.anime_title,
      cover_url: item.cover_url ?? item.cover_image,
      source_id: item.source_id,
      source_name: item.source_name,
      prefetchedEpisodes: item.prefetchedEpisodes,
    }

    try {
      const enriched = await enrichJKAnimeHit(base, wails, isEnglish ? 'en' : 'es')
      navigate('/search', { state: { selectedAnime: enriched } })
    } catch {
      navigate('/search', { state: { autoOpen: base } })
    }
  }, [isEnglish, navigate])


  useEffect(() => { load() }, [isEnglish, load])

  if (loading) return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )

  const stats = dash?.stats ?? {}
  const continueOnline = (dash?.continue_watching_online ?? []).filter(w => !isMangaHistorySource(w.source_id))
  const continueMangaOnline = (dash?.continue_watching_online ?? []).filter(w => isMangaHistorySource(w.source_id))
  const recentManga = dash?.recent_manga ?? []

  const watchingList   = dash?.watching_list ?? []
  const planningList   = dash?.planning_list ?? []
  const completedList  = dash?.completed_list ?? []
  const onHoldList     = dash?.on_hold_list ?? []
  const animeListHighlights = sortTrackedEntries([
    ...watchingList,
    ...planningList,
    ...onHoldList,
    ...completedList,
  ]).slice(0, 12)
  const mangaListHighlights = sortTrackedEntries(syncedManga).slice(0, 12)
  const totalTrackedAnime = watchingList.length + planningList.length + completedList.length + onHoldList.length

  const hasAnimeContent = continueOnline.length > 0 ||
    dash?.continue_watching?.length > 0 || dash?.recent_anime?.length > 0 ||
    dash?.completed_anime?.length > 0 || animeListHighlights.length > 0
  const hasMangaContent = continueMangaOnline.length > 0 || recentManga.length > 0 || mangaListHighlights.length > 0
  const hasContent = hasAnimeContent || hasMangaContent
  const animeHeroItem = continueOnline[0] ?? dash?.continue_watching?.[0] ?? dash?.recent_anime?.[0] ?? watchingList[0] ?? null
  const mangaHeroItem = continueMangaOnline[0] ?? mangaListHighlights[0] ?? recentManga[0] ?? null

  const animeHeroVisualItem = [
    animeHeroItem,
    ...(dash?.recent_anime ?? []),
    ...(dash?.completed_anime ?? []),
    ...watchingList,
  ].find(item => item?.banner_image || item?.cover_url || item?.cover_image) ?? animeHeroItem

  const animeHeroImage =
    animeHeroVisualItem?.banner_image ||
    animeHeroItem?.banner_image ||
    animeHeroVisualItem?.cover_url ||
    animeHeroItem?.cover_url ||
    animeHeroVisualItem?.cover_image ||
    animeHeroItem?.cover_image ||
    ''
  const mangaHeroImage = mangaHeroItem?.cover_url || mangaHeroItem?.cover_image || ''
  const animeHeroBackdrop = animeHeroImage ? proxyImage(animeHeroImage) : ''
  const mangaHeroBackdrop = mangaHeroImage ? proxyImage(mangaHeroImage) : ''

  const handleAnimeHeroClick = () => {
    if (!animeHeroItem) return

    if (animeHeroItem.source_id) {
      openOnlineAnimeDirect(animeHeroItem)
      return
    }

    if (animeHeroItem.anilist_id || animeHeroItem.mal_id) {
      navigate('/search', {
        state: {
          preSearch: animeHeroItem.title,
          altSearch: animeHeroItem.title_english,
        },
      })
      return
    }

    if (animeHeroItem.id) {
      navigate(`/anime/${animeHeroItem.id}`)
      return
    }

    if (animeHeroItem.title) {
      navigate('/search', {
        state: {
          preSearch: animeHeroItem.title,
          altSearch: animeHeroItem.title_english,
        },
      })
    }
  }

  const handleMangaHeroClick = () => {
    if (!mangaHeroItem) return

    if (mangaHeroItem.source_id) {
      navigate('/manga-online', {
        state: {
          autoOpen: {
            id: mangaHeroItem.anime_id,
            title: mangaHeroItem.anime_title,
            cover_url: mangaHeroItem.cover_url,
            source_id: mangaHeroItem.source_id,
            source_name: mangaHeroItem.source_name,
          },
          autoReadChapterID: mangaHeroItem.episode_id,
        },
      })
      return
    }

    if (mangaHeroItem.anilist_id || mangaHeroItem.mal_id || mangaHeroItem.title) {
      navigate('/manga-online', {
        state: {
          preSearch: mangaHeroItem.title,
          altSearch: mangaHeroItem.title_english,
        },
      })
      return
    }

    if (mangaHeroItem.id) {
      navigate(`/manga/${mangaHeroItem.id}`)
    }
  }

  // Truly new user: never watched anything, no stats at all
  const isNewUser = !dash || ((stats.watched ?? 0) === 0 && (stats.online_anime ?? 0) === 0 && (stats.anime ?? 0) === 0)

  if (isNewUser && !hasContent) return (
    <div className="fade-in dash-page">
      <section className="welcome-shell">
        <div className="welcome-shell-grid">
          <div className="welcome-copy">
            <span className="welcome-kicker">{isEnglish ? 'Start Here' : 'Empieza Aqui'}</span>
            <h1 className="welcome-title">
              {isEnglish ? <>Welcome to <span>Nipah!</span></> : <>Bienvenido a <span>Nipah!</span></>}
            </h1>
            <p className="welcome-lead">
              {isEnglish
                ? 'Watch anime, read manga, and keep your progress synced in one clean place.'
                : 'Mira anime, lee manga y manten tu progreso sincronizado en un solo lugar.'}
            </p>
            <p className="welcome-body">
              {isEnglish
                ? 'Use Discover to browse seasonal picks, open Anime Online when you already know what you want, and keep everything organized from My Lists.'
                : 'Usa Descubrir para explorar temporadas, abre Anime Online cuando ya sepas que quieres ver y organiza todo desde Mis Listas.'}
            </p>

            <div className="welcome-actions">
              <button className="btn btn-primary" onClick={() => navigate('/descubrir')}>
                {isEnglish ? 'Open Discover' : 'Abrir Descubrir'}
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/search')}>
                {isEnglish ? 'Open Anime Online' : 'Abrir Anime Online'}
              </button>
            </div>
          </div>

          <div className="welcome-preview" aria-hidden="true">
            <div className="welcome-preview-bg">NIPAH</div>
            <WelcomePreviewCard
              title="Anime Online"
              meta={isEnglish ? 'Find a title and start instantly' : 'Encuentra un titulo y empieza al instante'}
              tone="gold"
              offset="top-left"
              wide
            />
            <WelcomePreviewCard
              title={isEnglish ? 'My Lists' : 'Mis Listas'}
              meta={isEnglish ? 'Track anime and manga together' : 'Sigue anime y manga juntos'}
              tone="violet"
              offset="top-right"
            />
            <WelcomePreviewCard
              title={isEnglish ? 'Seasonal Picks' : 'Temporada'}
              meta={isEnglish ? 'Browse trending releases' : 'Explora estrenos en tendencia'}
              tone="crimson"
              offset="middle-left"
            />
            <WelcomePreviewCard
              title="Manga Online"
              meta={isEnglish ? 'Read and resume any chapter' : 'Lee y retoma cualquier capitulo'}
              tone="sky"
              offset="bottom-right"
            />
          </div>
        </div>

        <div className="welcome-guide">
          <div className="welcome-guide-card">
            <span className="welcome-guide-step">01</span>
            <div className="welcome-guide-title">{isEnglish ? 'Explore' : 'Explora'}</div>
            <p className="welcome-guide-copy">
              {isEnglish
                ? 'Use Discover to browse trending anime and new releases without leaving Home.'
                : 'Usa Descubrir para revisar anime en tendencia y nuevos lanzamientos sin salir de Inicio.'}
            </p>
          </div>
          <div className="welcome-guide-card">
            <span className="welcome-guide-step">02</span>
            <div className="welcome-guide-title">{isEnglish ? 'Watch or read' : 'Mira o lee'}</div>
            <p className="welcome-guide-copy">
              {isEnglish
                ? 'Open Anime Online or Manga Online, choose a source, and jump straight into episodes or chapters.'
                : 'Abre Anime Online o Manga Online, elige una fuente y entra directo a episodios o capitulos.'}
            </p>
          </div>
          <div className="welcome-guide-card">
            <span className="welcome-guide-step">03</span>
            <div className="welcome-guide-title">{isEnglish ? 'Keep everything synced' : 'Manten todo sincronizado'}</div>
            <p className="welcome-guide-copy">
              {isEnglish
                ? 'Your progress, lists, and connected AniList or MAL accounts stay organized automatically.'
                : 'Tu progreso, listas y cuentas conectadas de AniList o MAL se organizan automaticamente.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  )

  return (
    <div className="fade-in dash-page">
      <DashSectionBar activeSection={activeSection} onChange={setActiveSection} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {activeSection === 'anime' && (
          <>
            <DashHero
              eyebrow="Anime"
              title={animeHeroItem
                ? (isEnglish ? `Continue with ${animeHeroItem.anime_title || animeHeroItem.title_english || animeHeroItem.title}` : `Continua con ${animeHeroItem.anime_title || animeHeroItem.title_english || animeHeroItem.title}`)
                : (isEnglish ? 'Your anime home base' : 'Tu espacio principal de anime')}
              description={animeHeroItem
                ? (isEnglish ? 'Jump back into what you were watching, check your progress, and keep discovering series without losing momentum.' : 'Retoma rapido lo que estabas viendo, revisa tu progreso y vuelve a descubrir series sin perder el hilo.')
                : (isEnglish ? 'Use Home as your starting point to keep watching, check your lists, and return to the latest titles quickly.' : 'Usa Inicio como punto de entrada para seguir viendo, revisar tus listas y volver a lo mas reciente sin dar vueltas.')}
              image={animeHeroBackdrop}
              onClick={animeHeroItem ? handleAnimeHeroClick : undefined}
              interactiveLabel={animeHeroItem ? (isEnglish ? `Open ${animeHeroItem.anime_title || animeHeroItem.title_english || animeHeroItem.title}` : `Abrir ${animeHeroItem.anime_title || animeHeroItem.title_english || animeHeroItem.title}`) : undefined}
            />
            <div className="dash-action-row">
              <button className="btn btn-primary" onClick={() => navigate('/search')}>
                {isEnglish ? 'Search anime online' : 'Busca anime online'}
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/descubrir')}>
                {isEnglish ? 'Discover' : 'Descubrir'}
              </button>
            </div>
          </>
        )}

        {activeSection === 'manga' && (
          <>
            <DashHero
              eyebrow="Manga"
              title={mangaHeroItem
                ? (isEnglish ? `Keep reading ${mangaHeroItem.anime_title || mangaHeroItem.title}` : `Sigue leyendo ${mangaHeroItem.anime_title || mangaHeroItem.title}`)
                : (isEnglish ? 'Your manga home base' : 'Tu espacio principal de manga')}
              description={mangaHeroItem
                ? (isEnglish ? 'Manga reading now has its own space, so progress, chapters, and your reading library can stand on their own.' : 'Separamos la lectura del anime para que el progreso, los capitulos y tu biblioteca de manga respiren por cuenta propia.')
                : (isEnglish ? 'This is where your manga in progress and recent library live, with a cleaner view designed for reading.' : 'Aqui vivira tu manga en progreso y tu biblioteca reciente, con una vista mas limpia y pensada para lectura.')}
              image={mangaHeroBackdrop}
              onClick={mangaHeroItem ? handleMangaHeroClick : undefined}
              interactiveLabel={mangaHeroItem ? (isEnglish ? `Open ${mangaHeroItem.anime_title || mangaHeroItem.title}` : `Abrir ${mangaHeroItem.anime_title || mangaHeroItem.title}`) : undefined}
            />
            <div className="dash-action-row">
              <button className="btn btn-primary" onClick={() => navigate('/manga-online')}>
                {isEnglish ? 'Manga Online' : 'Manga online'}
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/manga')}>
                {isEnglish ? 'Manga library' : 'Biblioteca manga'}
              </button>
            </div>
          </>
        )}

        {/* Empty state for returning users with no content */}
        {!hasContent && (
          <div className="dash-empty-hint">
            <p>{isEnglish ? 'You have not watched any anime recently.' : 'No has visto ning?n anime recientemente.'}</p>
            <p>
              {isEnglish ? 'Fill your library using ' : 'Llena tu biblioteca usando '}<button className="dash-link-btn" onClick={() => navigate('/descubrir')}>{isEnglish ? 'Discover' : 'Descubrir'}</button>,
              {isEnglish ? 'or search for a specific anime in ' : 'o busca un anime espec?fico en '}<button className="dash-link-btn" onClick={() => navigate('/search')}>Anime Online</button>.
            </p>
          </div>
        )}

        {hasContent && activeSection === 'anime' && !hasAnimeContent && (
          <div className="dash-empty-hint">
            <p>{isEnglish ? 'There is no anime in progress right now.' : 'No hay anime en progreso ahora mismo.'}</p>
            <p>
              {isEnglish ? 'You can go back to ' : 'Puedes volver a '}<button className="dash-link-btn" onClick={() => navigate('/descubrir')}>{isEnglish ? 'Discover' : 'Descubrir'}</button>,
              {isEnglish ? 'or open ' : 'o abrir '}<button className="dash-link-btn" onClick={() => navigate('/search')}>Anime Online</button>.
            </p>
          </div>
        )}

        {hasContent && activeSection === 'manga' && !hasMangaContent && (
          <div className="dash-empty-hint">
            <p>{isEnglish ? 'There is no manga in progress right now.' : 'No hay manga en progreso ahora mismo.'}</p>
            <p>
              {isEnglish ? 'Find something new from ' : 'Busca algo nuevo desde '}<button className="dash-link-btn" onClick={() => navigate('/manga-online')}>{isEnglish ? 'Manga Online' : 'Manga online'}</button>.
            </p>
          </div>
        )}

        {/* Online - Continuar viendo */}
        {activeSection === 'anime' && continueOnline.length > 0 && (
          <ScrollRow
            title={t("Continuar viendo")}
            subtitle={`${continueOnline.length} ${t("en progreso")}`}
            action={
              <button className="btn btn-ghost"
                style={{ fontSize: 11, padding: '3px 10px', color: editMode ? 'var(--accent)' : 'var(--text-muted)' }}
                onClick={() => setEditMode(e => !e)}>
                {editMode ? t('Listo') : t('Editar')}
              </button>
            }
          >
            {continueOnline.map(item => (
              <div key={`${item.source_id}-${item.episode_id}`} style={{ position: 'relative', flexShrink: 0 }}>
                {editMode && (
                  <button onClick={() => handleRemoveAnime(item.source_id, item.anime_id)}
                    style={{
                      position: 'absolute', top: 6, right: 6, zIndex: 10,
                      background: '#b91c1c', border: 'none', borderRadius: '50%',
                      width: 22, height: 22, color: 'white', fontSize: 13,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', lineHeight: 1,
                    }}
                    title={isEnglish ? 'Remove' : 'Eliminar'}>?</button>
                )}
                <OnlineHistoryCard item={item} navigate={navigate} onOpenAnime={openOnlineAnimeDirect} />
              </div>
            ))}
          </ScrollRow>
        )}

        {/* Mis Listas - Watching */}
        {activeSection === 'manga' && continueMangaOnline.length > 0 && (
          <ScrollRow
            title={isEnglish ? 'Manga in progress' : 'Manga en progreso'}
            subtitle={isEnglish ? `${continueMangaOnline.length} reading now` : `${continueMangaOnline.length} leyendo ahora`}
          >
            {continueMangaOnline.map(item => (
              <OnlineHistoryCard
                key={`${item.source_id}-${item.episode_id}`}
                item={item}
                navigate={navigate}
                targetPath="/manga-online"
                chapterPrefix="Cap."
                autoRead
              />
            ))}
          </ScrollRow>
        )}

        {activeSection === 'manga' && mangaListHighlights.length > 0 && (
          <ScrollRow
            title={isEnglish ? 'Your manga' : 'Tu manga'}
            subtitle={isEnglish ? `${mangaListHighlights.length} highlights` : `${mangaListHighlights.length} destacado${mangaListHighlights.length !== 1 ? 's' : ''}`}
            action={<button className="btn btn-ghost btn-sm" onClick={() => navigate('/mis-listas')}>{isEnglish ? 'View list' : 'Ver lista'}</button>}
          >
            {mangaListHighlights.map(item => (
              <TrackedListCard
                key={`tracked-manga-${item.anilist_id || item.mal_id || item.id}`}
                item={item}
                navigate={navigate}
                type="manga"
                isEnglish={isEnglish}
              />
            ))}
          </ScrollRow>
        )}

        {activeSection === 'manga' && recentManga.length > 0 && (
          <ScrollRow
            title={isEnglish ? 'Recently added manga' : 'Manga agregado'}
            subtitle={isEnglish ? `${recentManga.length} in library` : `${recentManga.length} en biblioteca`}
          >
            {recentManga.map(item => (
              <MediaCard
                key={item.id}
                item={{
                  id: item.id,
                  title: item.title,
                  cover_image: item.cover_image,
                  year: item.year,
                  episodes_total: item.chapters_total,
                  watched_count: item.read_count,
                  unit_label: 'caps',
                }}
                onClick={() => navigate(`/manga/${item.id}`)}
              />
            ))}
          </ScrollRow>
        )}


        {activeSection === 'anime' && animeListHighlights.length > 0 && (
          <ScrollRow
            title={isEnglish ? 'Your list' : 'Tu lista'}
            subtitle={isEnglish ? `${totalTrackedAnime} synced anime` : `${totalTrackedAnime} anime sincronizado${totalTrackedAnime !== 1 ? 's' : ''}`}
            action={<button className="btn btn-ghost btn-sm" onClick={() => navigate('/mis-listas')}>{isEnglish ? 'View list' : 'Ver lista'}</button>}
          >
            {animeListHighlights.map(item => (
              <TrackedListCard
                key={`tracked-anime-${item.anilist_id || item.mal_id || item.id}`}
                item={item}
                navigate={navigate}
                type="anime"
                isEnglish={isEnglish}
              />
            ))}
          </ScrollRow>
        )}


        {/* Local - Continuar viendo */}
        {activeSection === 'anime' && dash.continue_watching?.length > 0 && (
          <ScrollRow title={t("Continuar viendo (local)")} subtitle={`${dash.continue_watching.length} ${t("en progreso")}`}>
            {(dash.continue_watching ?? []).map(item => (
              <ContinueCard key={item.episode_id} item={item}
                onClick={async () => {
                  try {
                    await wails.playEpisode(item.episode_id)
                    toastSuccess(isEnglish ? 'Opening in MPV...' : 'Abriendo en MPV...')
                  } catch (e) {
                    const msg = e?.message ?? String(e)
                    if (msg.includes('MPV') || msg.includes('player')) {
                      toastError(isEnglish ? 'MPV not found. Check the path in Settings.' : 'MPV no encontrado. Verifica la ruta en Ajustes.')
                    } else {
                      toastError(isEnglish ? `Could not play it: ${msg}` : `No se pudo reproducir: ${msg}`)
                    }
                  }
                }}
              />
            ))}
          </ScrollRow>
        )}

        {/* Local - Recientemente agregado */}
        {activeSection === 'anime' && dash.recent_anime?.length > 0 && (
          <ScrollRow title={t("Recientemente agregado")}>
            {(dash.recent_anime ?? []).map(item => (
              <MediaCard key={item.id} item={item}
                onClick={() => navigate(`/anime/${item.id}`)} />
            ))}
          </ScrollRow>
        )}

        {/* Local - Completados */}
        {activeSection === 'anime' && dash.completed_anime?.length > 0 && (
          <ScrollRow title={t("Completados")}>
            {(dash.completed_anime ?? []).map(item => (
              <MediaCard key={item.id} item={item}
                onClick={() => navigate(`/anime/${item.id}`)} />
            ))}
          </ScrollRow>
        )}
      </div>
    </div>
  )
}

