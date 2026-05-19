import { proxyImage } from '../../../lib/wails'

function RecommendationCard({ item, onSelectItem = null }) {
  const imageSrc = item?.image ? proxyImage(item.image) : ''
  const eyebrow = item?.eyebrow || ''
  const subtitle = item?.subtitle || ''
  const isInteractive = typeof onSelectItem === 'function'
  const cardContent = (
    <>
      <div className="gui2-landing-recommendation-artwrap">
        {imageSrc ? (
          <img src={imageSrc} alt={item.title} className="gui2-landing-recommendation-art" />
        ) : (
          <div className="gui2-landing-recommendation-art gui2-landing-recommendation-art--placeholder" aria-hidden="true">
            {item.title?.slice(0, 1) || '?'}
          </div>
        )}
      </div>
      <div className="gui2-landing-recommendation-copy">
        {eyebrow ? <div className="gui2-landing-recommendation-eyebrow">{eyebrow}</div> : null}
        <h4 className="gui2-landing-recommendation-title">{item.title}</h4>
        {subtitle ? <p className="gui2-landing-recommendation-subtitle">{subtitle}</p> : null}
      </div>
    </>
  )

  if (isInteractive) {
    return (
      <button
        type="button"
        className="gui2-landing-recommendation-card gui2-landing-recommendation-card--button"
        onClick={() => onSelectItem?.(item)}
      >
        {cardContent}
      </button>
    )
  }

  return <article className="gui2-landing-recommendation-card">{cardContent}</article>
}

export default function LandingRecommendationsStage({
  title,
  items,
  emptyCopy,
  placeholderCount = 5,
  onSelectItem = null,
}) {
  const visibleItems = Array.isArray(items) ? items.slice(0, 5) : []
  const hasItems = visibleItems.length > 0

  return (
    <section className="gui2-landing-recommendations">
      <div className="gui2-landing-section-head gui2-landing-section-head--stacked">
        <h3 className="gui2-landing-section-title">{title}</h3>
      </div>

      {hasItems ? (
        <div className="gui2-landing-recommendations-grid">
          {visibleItems.map((item) => <RecommendationCard key={item.key} item={item} onSelectItem={onSelectItem} />)}
        </div>
      ) : (
        <div className="media-detail-empty-copy gui2-landing-recommendations-empty">{emptyCopy}</div>
      )}
    </section>
  )
}
