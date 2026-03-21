import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { wails } from '../lib/wails'
import { toastError } from '../components/ui/Toast'

function ChapterRow({ ch, onOpen }) {
  return (
    <div className={`episode-row ${ch.read ? 'episode-watched' : ''}`}>
      <div className="episode-num">
        {ch.read
          ? <span className="ep-watched-dot" title="Leído">✓</span>
          : <span className="ep-num-label">{ch.chapter_num ?? '?'}</span>
        }
      </div>

      <div className="episode-info">
        <div className="episode-title">
          {ch.title || `Capítulo ${ch.chapter_num ?? '?'}`}
        </div>
        {ch.progress_page > 0 && !ch.read && (
          <div className="episode-resume-label">
            En página {ch.progress_page}
          </div>
        )}
      </div>

      <button
        className="btn btn-primary episode-play-btn"
        onClick={() => onOpen(ch)}
      >
        {ch.progress_page > 0 && !ch.read ? '⟳ Continuar' : '📖 Leer'}
      </button>
    </div>
  )
}

export default function MangaDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [manga, setManga] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    wails.getMangaDetail(parseInt(id))
      .then(data => {
        if (!data) throw new Error('No encontrado')
        setManga(data)
      })
      .catch(e => setError(e?.message ?? 'Error al cargar'))
      .finally(() => setLoading(false))
  }, [id])

  const handleOpen = useCallback((ch) => {
    // Local CBZ/PDF reader not yet implemented — notify user
    toastError('Lector local próximamente. Usa Manga online para leer desde MangaDex.')
  }, [])

  if (loading) return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )

  if (error) return (
    <div className="empty-state">
      <p className="empty-state-desc" style={{ color: 'var(--red)' }}>{error}</p>
      <button className="btn btn-ghost" onClick={() => navigate('/manga')}>← Volver</button>
    </div>
  )

  if (!manga) return null

  const chapters = manga.chapters ?? []
  const readCount = chapters.filter(c => c.read).length

  return (
    <div className="fade-in anime-detail">
      {/* Hero */}
      <div className="detail-hero" style={manga.cover_image ? {
        backgroundImage: `linear-gradient(to bottom, rgba(10,10,14,0.3) 0%, rgba(10,10,14,1) 100%), url(${manga.cover_image})`
      } : {}}>
        <button className="btn btn-ghost detail-back" onClick={() => navigate('/manga')}>
          ← Volver
        </button>

        <div className="detail-hero-content">
          {manga.cover_image && (
            <img src={manga.cover_image} alt={manga.display_title} className="detail-cover" />
          )}
          <div className="detail-info">
            <h1 className="detail-title">{manga.display_title}</h1>
            {manga.title_romaji && manga.title_spanish && (
              <div className="detail-subtitle">{manga.title_romaji}</div>
            )}
            <div className="detail-tags">
              {manga.year > 0 && <span className="badge badge-muted">{manga.year}</span>}
              {manga.status && <span className="badge badge-muted">{translateStatus(manga.status)}</span>}
              {manga.chapters_total > 0 && (
                <span className="badge badge-muted">{manga.chapters_total} caps</span>
              )}
              {readCount > 0 && (
                <span className="badge badge-green">{readCount} leídos</span>
              )}
            </div>
            {manga.synopsis_es && (
              <p className="detail-synopsis">{manga.synopsis_es}</p>
            )}
          </div>
        </div>
      </div>

      {/* Chapter list */}
      <div className="episode-list-section">
        <div className="section-header">
          <span className="section-title">
            Capítulos
            {chapters.length > 0 && (
              <span className="badge badge-muted" style={{ marginLeft: 8 }}>
                {chapters.length}
              </span>
            )}
          </span>
          {readCount > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {readCount}/{chapters.length} leídos
            </span>
          )}
        </div>

        {chapters.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>
            No se encontraron capítulos en esta carpeta.
          </div>
        ) : (
          <div className="episode-list">
            {chapters.map(ch => (
              <ChapterRow key={ch.id} ch={ch} onOpen={handleOpen} />
            ))}
          </div>
        )}

        {/* Hint towards online reader */}
        {manga.mangadex_id && (
          <div style={{
            marginTop: 20,
            padding: '12px 14px',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <span>Este manga está disponible en MangaDex con capítulos en español.</span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, flexShrink: 0 }}
              onClick={() => navigate('/manga-online')}
            >
              Leer online →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function translateStatus(status) {
  const map = {
    completed: 'Completado', ongoing: 'En curso',
    hiatus: 'En pausa', cancelled: 'Cancelado',
  }
  return map[status?.toLowerCase()] ?? status
}
