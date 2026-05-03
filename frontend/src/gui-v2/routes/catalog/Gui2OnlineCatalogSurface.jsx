function CatalogIcon({ kind }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.35,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  switch (kind) {
    case 'genre':
      return <svg {...common}><path d="M8 2.4 13.2 5.5 8 8.6 2.8 5.5 8 2.4Z" /><path d="M2.8 10.5 8 13.6l5.2-3.1" /></svg>
    case 'season':
      return <svg {...common}><rect x="2.7" y="3.1" width="10.6" height="10.2" rx="1.5" /><path d="M5.2 2.3v2M10.8 2.3v2M2.7 6.2h10.6" /></svg>
    case 'format':
      return <svg {...common}><rect x="2.6" y="3.2" width="4.4" height="4.4" rx="0.9" /><rect x="9" y="3.2" width="4.4" height="4.4" rx="0.9" /><rect x="2.6" y="9.3" width="4.4" height="4.4" rx="0.9" /><rect x="9" y="9.3" width="4.4" height="4.4" rx="0.9" /></svg>
    case 'status':
      return <svg {...common}><circle cx="8" cy="8" r="5.1" /><path d="M8 5.2v3.1l2.1 1.5" /></svg>
    case 'sort':
      return <svg {...common}><path d="M4 3.4v9.2" /><path d="m2.7 5 1.3-1.6L5.3 5" /><path d="M9 12.6V3.4" /><path d="m7.7 11 1.3 1.6 1.3-1.6" /><path d="M12.6 4.2h1.2M12.6 8h1.9M12.6 11.8h2.7" /></svg>
    case 'language':
      return <svg {...common}><path d="M3.1 4.2h5.4M5.8 4.2c0 3.9-1.3 6.4-3 8" /><path d="M3.3 9.1h4.8" /><path d="m9.5 11.8 1.6-4.8 1.6 4.8" /><path d="M10.2 9.9H12" /></svg>
    case 'results':
      return <svg {...common}><path d="M2.8 4.2h10.4M2.8 8h10.4M2.8 11.8h6.1" /></svg>
    case 'search':
      return <svg {...common}><circle cx="7" cy="7" r="3.8" /><path d="m10 10 3 3" /></svg>
    case 'bookmark':
      return <svg {...common}><path d="M5.1 2.8h5.8v10.1l-2.9-1.8-2.9 1.8Z" /></svg>
    case 'prev':
      return <svg {...common}><path d="m9.8 3.5-4.4 4.5 4.4 4.5" /></svg>
    case 'next':
      return <svg {...common}><path d="m6.2 3.5 4.4 4.5-4.4 4.5" /></svg>
    default:
      return <svg {...common}><circle cx="8" cy="8" r="5" /></svg>
  }
}

function PageArrowButton({ direction, onClick, disabled, label }) {
  return (
    <button
      type="button"
      className="gui2-catalog-page-arrow"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <CatalogIcon kind={direction} />
    </button>
  )
}

function PageChipButton({ page, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={`gui2-catalog-footer-pagechip${active ? ' active' : ''}`}
      onClick={() => onClick?.(page)}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
    >
      {page}
    </button>
  )
}

export function buildCatalogPageChips(currentPage, canNext) {
  const resolvedPage = Math.max(1, Number(currentPage) || 1)

  if (resolvedPage <= 2) {
    return [1, 2, 3]
  }

  if (!canNext) {
    return [Math.max(1, resolvedPage - 2), Math.max(1, resolvedPage - 1), resolvedPage]
  }

  return [resolvedPage - 1, resolvedPage, resolvedPage + 1]
}

export default function Gui2OnlineCatalogSurface({
  title,
  description,
  accentText = '',
  searchControl = null,
  sourceSummaryLabel,
  sourceSummaryValue,
  resultsSummary,
  pageSummary,
  topPagination = null,
  filters = [],
  activeFilters = [],
  onClearFilters = null,
  actionLabel = 'Clear Filters',
  bodyTitle,
  bodySubtitle,
  body = null,
  bottomPagination = null,
}) {
  return (
    <div className="gui2-catalog-page">
      <section className="gui2-catalog-shell">
        <header className="gui2-catalog-header">
          <div className="gui2-catalog-header-copy">
            <h1 className="gui2-catalog-title">{title}</h1>
            <p className="gui2-catalog-description">
              {description}
              {accentText ? <span className="gui2-catalog-description-accent"> {accentText}</span> : null}
            </p>
          </div>

          <div className="gui2-catalog-header-side">
            {searchControl ? <div className="gui2-catalog-query-row">{searchControl}</div> : null}

            <div className="gui2-catalog-status-strip">
              <div className="gui2-catalog-status-block">
                <span className="gui2-catalog-status-label">{sourceSummaryLabel}</span>
                <div className="gui2-catalog-status-value">{sourceSummaryValue}</div>
              </div>
              <div className="gui2-catalog-status-divider" aria-hidden="true" />
              <div className="gui2-catalog-status-block gui2-catalog-status-block-compact">
                <div className="gui2-catalog-status-value">{resultsSummary}</div>
              </div>
              <div className="gui2-catalog-status-divider" aria-hidden="true" />
              <div className="gui2-catalog-status-block gui2-catalog-status-block-inline">
                <div className="gui2-catalog-status-value">{pageSummary}</div>
                {topPagination}
              </div>
            </div>
          </div>
        </header>

        <section className="gui2-catalog-filterbar">
          {filters.map((filter) => (
            <div
              key={filter.key}
              className={`gui2-catalog-filter-cell${filter.alignEnd ? ' align-end' : ''}${filter.wide ? ' wide' : ''}`}
            >
              <div className="gui2-catalog-filter-labelrow">
                <span className="gui2-catalog-filter-icon"><CatalogIcon kind={filter.icon} /></span>
                <span className="gui2-catalog-filter-label">{filter.label}</span>
              </div>
              <div className="gui2-catalog-filter-control">{filter.control}</div>
            </div>
          ))}
        </section>

        {(activeFilters.length > 0 || onClearFilters) ? (
          <div className="gui2-catalog-activebar">
            <div className="gui2-catalog-activebar-copy">Active Filters:</div>
            <div className="gui2-catalog-activebar-tags">
              {activeFilters.map((item) => (
                <span key={`${item.label}-${item.value}`} className="gui2-catalog-active-tag">
                  <span className="gui2-catalog-active-tag-label">{item.label}:</span> {item.value}
                </span>
              ))}
            </div>
            {onClearFilters ? (
              <button type="button" className="gui2-catalog-clear-btn" onClick={onClearFilters}>
                {actionLabel}
              </button>
            ) : null}
          </div>
        ) : null}

        <section className="gui2-catalog-results-shell">
          <div className="gui2-catalog-results-head">
            <div className="gui2-catalog-results-copy">
              <div className="gui2-catalog-results-title">{bodyTitle}</div>
              {bodySubtitle ? <div className="gui2-catalog-results-subtitle">{bodySubtitle}</div> : null}
            </div>
          </div>

          {body}

          {bottomPagination ? (
            <div className="gui2-catalog-footer">
              {bottomPagination}
            </div>
          ) : null}
        </section>
      </section>
    </div>
  )
}

export function Gui2CatalogPaginationControls({
  onPrev,
  onNext,
  onJumpToPage,
  canPrev,
  canNext,
  currentPage,
  pageSizeLabel,
  prevLabel,
  nextLabel,
  busy = false,
}) {
  const pageChips = buildCatalogPageChips(currentPage, canNext)
    .filter((page, index, array) => Number.isFinite(page) && array.indexOf(page) === index)

  return (
    <>
      <div className="gui2-catalog-footer-pagination">
        <PageArrowButton direction="prev" onClick={onPrev} disabled={!canPrev || busy} label={prevLabel} />
        {pageChips.map((page) => (
          <PageChipButton
            key={page}
            page={page}
            active={page === currentPage}
            disabled={busy || page === currentPage || (page > currentPage && !canNext)}
            onClick={onJumpToPage}
          />
        ))}
        <span className="gui2-catalog-footer-ellipsis" aria-hidden="true">...</span>
        <PageArrowButton direction="next" onClick={onNext} disabled={!canNext || busy} label={nextLabel} />
      </div>
      <div className="gui2-catalog-pagesize">{pageSizeLabel}</div>
    </>
  )
}

export { CatalogIcon, PageArrowButton }
