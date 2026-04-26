export function buildHomeCommandDeckData({
  homeTab = 'anime',
  isEnglish = false,
  heroSlides = [],
  primaryAnimeRows = [],
  genreAnimeRows = [],
  continueTrackedAnime = [],
  plannedAnime = [],
  onHoldAnime = [],
  continueReadingCards = [],
  planningCards = [],
  recommendationCards = [],
  loadingMangaTab = false,
  homeAniListUnavailable = false,
}) {
  const sharedAction = homeTab === 'anime'
    ? (isEnglish ? 'Open Anime Online' : 'Abrir Anime Online')
    : (isEnglish ? 'Open Manga Online' : 'Abrir Manga Online')

  if (homeTab === 'manga') {
    return {
      kicker: isEnglish ? 'Your manga corner' : 'Tu rincon de manga',
      title: isEnglish ? 'Pick up your next chapter fast.' : 'Retoma tu siguiente capitulo rapido.',
      body: isEnglish
        ? 'Continue reading, jump into your saved queue, or open the online catalog without losing the quick local-first feel.'
        : 'Continua leyendo, vuelve a tu cola guardada o abre el catalogo online sin perder la rapidez local.',
      actions: [
        { id: 'online', label: sharedAction, href: '/manga-online' },
        { id: 'lists', label: isEnglish ? 'Open My Lists' : 'Abrir Mis Listas', href: '/my-lists' },
      ],
      pills: [
        isEnglish ? 'Stable Home -> Manga handoff' : 'Traspaso estable Inicio -> Manga',
        isEnglish ? 'Source-aware chapter loading' : 'Carga de capitulos por fuente',
      ],
      metrics: [
        {
          label: isEnglish ? 'Continue' : 'Continuar',
          value: continueReadingCards.length,
          detail: isEnglish ? 'ready to resume now' : 'listos para retomar',
        },
        {
          label: isEnglish ? 'Planned' : 'Planeado',
          value: planningCards.length,
          detail: isEnglish ? 'saved for later' : 'guardados para despues',
        },
        {
          label: isEnglish ? 'Recommendations' : 'Recomendaciones',
          value: recommendationCards.length,
          detail: loadingMangaTab
            ? (isEnglish ? 'loading shelves' : 'cargando estantes')
            : (isEnglish ? 'based on your reading' : 'segun lo que lees'),
        },
      ],
    }
  }

  const catalogRows = primaryAnimeRows.length + genreAnimeRows.length
  return {
    kicker: isEnglish ? 'Home command deck' : 'Centro de inicio',
    title: isEnglish ? 'Everything important is one click away.' : 'Todo lo importante esta a un clic.',
    body: homeAniListUnavailable
      ? (isEnglish
          ? 'Your local dashboard is still ready. Online recommendations are limited right now, but direct browsing remains available.'
          : 'Tu panel local sigue listo. Las recomendaciones online estan limitadas por ahora, pero la exploracion directa sigue disponible.')
      : (isEnglish
          ? 'Discover something new, jump back into your tracked shows, and keep the app feeling fast from the very first screen.'
          : 'Descubre algo nuevo, vuelve a tus series seguidas y mantén la app agil desde la primera pantalla.'),
    actions: [
      { id: 'online', label: sharedAction, href: '/search' },
      { id: 'lists', label: isEnglish ? 'Open My Lists' : 'Abrir Mis Listas', href: '/my-lists' },
    ],
    pills: [
      isEnglish ? 'Local-first dashboard' : 'Panel local primero',
      isEnglish ? 'Fast online jump-in' : 'Salto online rapido',
    ],
    metrics: [
      {
        label: isEnglish ? 'Featured' : 'Destacados',
        value: heroSlides.length,
        detail: isEnglish ? 'hero picks this week' : 'selecciones principales',
      },
      {
        label: isEnglish ? 'Watching' : 'Siguiendo',
        value: continueTrackedAnime.length,
        detail: isEnglish ? 'tracked right now' : 'siguiendo ahora',
      },
      {
        label: isEnglish ? 'Catalog rows' : 'Filas',
        value: catalogRows,
        detail: homeAniListUnavailable
          ? (isEnglish ? 'limited while AniList is down' : 'limitadas mientras AniList falla')
          : (isEnglish ? 'ready to browse' : 'listas para explorar'),
      },
      {
        label: isEnglish ? 'Queued' : 'En cola',
        value: plannedAnime.length + onHoldAnime.length,
        detail: isEnglish ? 'planned and on hold' : 'planeado y en pausa',
      },
    ],
  }
}
