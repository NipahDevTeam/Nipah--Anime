export default function ReaderStageHeader({
  title,
  chapterTitle,
  chapterID,
  chapters,
  isEnglish,
  currentPageLabel,
  qualityLabel,
  bookmarkActive,
  onBack,
  onSelectChapter,
  onOpenChapterBrowser,
  onSetReadingMode,
  readingMode,
  prevChapter,
  nextChapter,
  onOpenPreviousChapter,
  onOpenNextChapter,
  transitioningChapter,
  onToggleBookmark,
  onReloadChapter,
  onToggleFullscreen,
  isFullscreen,
  onToggleSettings,
  settingsOpen,
  ReaderIcon,
  ReaderIconButton,
  ReaderToggleButton,
}) {
  return (
    <header className="reader-topbar-v2">
      <div className="reader-topbar-left">
        <ReaderIconButton
          icon="back"
          label={isEnglish ? 'Back to chapter list' : 'Volver a la lista'}
          onClick={onBack}
        />
        <div className="reader-title-stack">
          <div className="reader-series-title">{title}</div>
          <div className="reader-chapter-line">
            <span>{chapterTitle}</span>
            {chapters.length > 0 ? (
              <label className="reader-chapter-select-shell">
                <select
                  className="reader-chapter-select"
                  value={chapterID}
                  onChange={(event) => onSelectChapter(event.target.value)}
                >
                  {chapters.map((chapter, index) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${chapter.number || index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className="reader-inline-browser-btn"
              onClick={onOpenChapterBrowser}
            >
              <ReaderIcon kind="chapters" />
              <span>{isEnglish ? 'Browse' : 'Explorar'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="reader-topbar-center">
        <div className="reader-topbar-status">
          <span className="reader-status-chip">{currentPageLabel}</span>
          <span className="reader-status-chip">{qualityLabel}</span>
        </div>
      </div>

      <div className="reader-topbar-right">
        <div className="reader-toggle-group">
          <ReaderToggleButton active={readingMode === 'scroll'} icon="scroll" label="Scroll" onClick={() => onSetReadingMode('scroll')} />
          <ReaderToggleButton active={readingMode === 'paged'} icon="paged" label="Paged" onClick={() => onSetReadingMode('paged')} />
          <ReaderToggleButton active={readingMode === 'double'} icon="double" label="Double Page" onClick={() => onSetReadingMode('double')} />
        </div>

        <div className="reader-chapter-jump-group">
          <button type="button" className="reader-chapter-btn" onClick={onOpenPreviousChapter} disabled={!prevChapter}>
            <ReaderIcon kind="chapter-prev" />
            <span>{isEnglish ? 'Prev Chapter' : 'Capitulo previo'}</span>
          </button>
          <button type="button" className="reader-chapter-btn" onClick={onOpenNextChapter} disabled={!nextChapter || Boolean(transitioningChapter)}>
            <span>{transitioningChapter ? (isEnglish ? 'Loading...' : 'Cargando...') : (isEnglish ? 'Next Chapter' : 'Siguiente capitulo')}</span>
            <ReaderIcon kind="chapter-next" />
          </button>
        </div>

        <div className="reader-icon-strip">
          <ReaderIconButton
            icon={bookmarkActive ? 'bookmark-filled' : 'bookmark'}
            active={bookmarkActive}
            label={bookmarkActive ? (isEnglish ? 'Remove bookmark' : 'Quitar marcador') : (isEnglish ? 'Bookmark current page' : 'Guardar marcador')}
            onClick={onToggleBookmark}
          />
          <ReaderIconButton icon="reload" label={isEnglish ? 'Reload chapter pages' : 'Recargar paginas'} onClick={onReloadChapter} />
          <ReaderIconButton icon="fullscreen" label={isFullscreen ? (isEnglish ? 'Exit fullscreen' : 'Salir de pantalla completa') : (isEnglish ? 'Fullscreen' : 'Pantalla completa')} onClick={onToggleFullscreen} />
          <ReaderIconButton icon="settings" active={settingsOpen} label={isEnglish ? 'Reading settings' : 'Ajustes de lectura'} onClick={onToggleSettings} />
        </div>
      </div>
    </header>
  )
}
