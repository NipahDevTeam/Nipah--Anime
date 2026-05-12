export default function ReaderChapterBrowser({
  isEnglish,
  chapters,
  currentChapterID,
  currentPageLabel,
  onClose,
  onOpenChapter,
}) {
  return (
    <aside className="reader-chapter-browser" onClick={(event) => event.stopPropagation()}>
      <div className="reader-chapter-browser-head">
        <div>
          <h3>{isEnglish ? 'Chapter Browser' : 'Explorador de capitulos'}</h3>
          <p>{currentPageLabel}</p>
        </div>
        <button type="button" className="reader-browser-close" onClick={onClose}>X</button>
      </div>

      <div className="reader-chapter-browser-grid">
        {chapters.map((chapter, index) => {
          const active = chapter.id === currentChapterID
          return (
            <button
              key={chapter.id}
              type="button"
              className={`reader-chapter-browser-card${active ? ' is-active' : ''}`}
              onClick={() => onOpenChapter(chapter)}
            >
              <span className="reader-chapter-browser-index">{chapter.number || index + 1}</span>
              <span className="reader-chapter-browser-title">
                {chapter.title || `${isEnglish ? 'Chapter' : 'Capitulo'} ${chapter.number || index + 1}`}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
