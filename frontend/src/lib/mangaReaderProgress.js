const STORAGE_KEY = 'nipah:manga-reader-progress-v1'
const VIEW_MODE_KEY = 'nipah:manga-reader-view-mode'

function readStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {}
}

export function getProgressKey(sourceID, mangaID, chapterID) {
  return `${sourceID || 'senshimanga-es'}::${mangaID || ''}::${chapterID || ''}`
}

export function getMangaReaderProgress(sourceID, mangaID, chapterID) {
  return readStore()[getProgressKey(sourceID, mangaID, chapterID)] ?? null
}

export function saveMangaReaderProgress({
  sourceID,
  mangaID,
  chapterID,
  progressPage,
  totalPages,
  completed,
}) {
  if (!chapterID) return
  const store = readStore()
  const key = getProgressKey(sourceID, mangaID, chapterID)
  const previous = store[key] ?? {}
  store[key] = {
    ...previous,
    sourceID,
    mangaID,
    chapterID,
    progress_page: progressPage,
    total_pages: totalPages,
    completed: completed ?? previous.completed ?? false,
    updated_at: Date.now(),
  }
  writeStore(store)
}

export function getMangaReaderProgressMap(sourceID, mangaID, chapters = []) {
  const map = {}
  for (const chapter of chapters) {
    if (!chapter?.id) continue
    const progress = getMangaReaderProgress(sourceID, mangaID, chapter.id)
    if (progress) {
      map[chapter.id] = progress
    }
  }
  return map
}

export function markMangaReaderChapterCompleted(sourceID, mangaID, chapterID, totalPages = 0) {
  const previous = getMangaReaderProgress(sourceID, mangaID, chapterID) ?? {}
  const resolvedTotal = totalPages || previous.total_pages || previous.progress_page || 0
  saveMangaReaderProgress({
    sourceID,
    mangaID,
    chapterID,
    progressPage: resolvedTotal,
    totalPages: resolvedTotal,
    completed: true,
  })
}

export function markMangaReaderChaptersCompletedThrough(sourceID, mangaID, chapters = [], chapterNumber = 0) {
  const targetNumber = Number(chapterNumber) || 0
  if (targetNumber <= 0) return

  for (const chapter of chapters) {
    const currentNumber = Number(chapter?.number) || 0
    if (!chapter?.id || currentNumber <= 0 || currentNumber > targetNumber) continue
    markMangaReaderChapterCompleted(sourceID, mangaID, chapter.id, Number(chapter?.page_count) || 0)
  }
}

export function getMostRecentIncompleteChapterID(sourceID, mangaID, chapters = []) {
  const progressMap = getMangaReaderProgressMap(sourceID, mangaID, chapters)
  let latestChapterID = ''
  let latestUpdatedAt = 0

  for (const chapter of chapters) {
    const progress = progressMap[chapter?.id]
    if (!progress || progress.completed || progress.progress_page <= 0) continue
    if ((progress.updated_at ?? 0) >= latestUpdatedAt) {
      latestUpdatedAt = progress.updated_at ?? 0
      latestChapterID = chapter.id
    }
  }

  return latestChapterID
}

export function getSavedReaderViewMode() {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) || 'fit'
  } catch {
    return 'fit'
  }
}

export function saveReaderViewMode(mode) {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode)
  } catch {}
}
