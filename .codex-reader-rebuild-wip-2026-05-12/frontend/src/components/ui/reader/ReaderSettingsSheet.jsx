export default function ReaderSettingsSheet({
  isEnglish,
  readerSettings,
  qualityLabel,
  onClose,
  onSetReadingMode,
  onSetReadingDirection,
  onSetPageFit,
  onSetZoom,
  onSetEnhance,
  onSetBrightness,
  onSetContrast,
  onResetAdjustments,
  onSetAutoHideUI,
  onSetAutoHideDelaySec,
  ReaderIconButton,
  ReaderToggleButton,
  ReaderSliderRow,
}) {
  return (
    <aside className="reader-settings-panel" onClick={(event) => event.stopPropagation()}>
      <div className="reader-settings-head">
        <div>
          <h3>{isEnglish ? 'Reading Settings' : 'Ajustes de lectura'}</h3>
        </div>
        <ReaderIconButton icon="close" label={isEnglish ? 'Close settings' : 'Cerrar ajustes'} onClick={onClose} />
      </div>

      <div className="reader-settings-section">
        <div className="reader-settings-label">{isEnglish ? 'Reading Mode' : 'Modo de lectura'}</div>
        <div className="reader-settings-button-grid">
          <ReaderToggleButton active={readerSettings.readingMode === 'scroll'} icon="scroll" label="Scroll" onClick={() => onSetReadingMode('scroll')} />
          <ReaderToggleButton active={readerSettings.readingMode === 'paged'} icon="paged" label="Paged" onClick={() => onSetReadingMode('paged')} />
          <ReaderToggleButton active={readerSettings.readingMode === 'double'} icon="double" label="Double Page" onClick={() => onSetReadingMode('double')} />
        </div>
      </div>

      <div className="reader-settings-section">
        <div className="reader-settings-label">{isEnglish ? 'Reading Direction' : 'Direccion de lectura'}</div>
        <div className="reader-settings-button-grid two-up">
          <ReaderToggleButton active={readerSettings.readingDirection === 'ltr'} icon="chapter-next" label="Left to Right" onClick={() => onSetReadingDirection('ltr')} />
          <ReaderToggleButton active={readerSettings.readingDirection === 'rtl'} icon="chapter-prev" label="Right to Left" onClick={() => onSetReadingDirection('rtl')} />
        </div>
      </div>

      <div className="reader-settings-section">
        <div className="reader-settings-label">{isEnglish ? 'Page Fit' : 'Ajuste de pagina'}</div>
        <div className="reader-settings-button-grid reader-settings-button-grid--fit">
          <ReaderToggleButton active={readerSettings.pageFit === 'width'} icon="width" label="Fit Width" onClick={() => onSetPageFit('width')} />
          <ReaderToggleButton active={readerSettings.pageFit === 'height'} icon="height" label="Fit Height" onClick={() => onSetPageFit('height')} />
          <ReaderToggleButton active={readerSettings.pageFit === 'original'} icon="original" label="Original" onClick={() => onSetPageFit('original')} />
          <ReaderToggleButton active={readerSettings.pageFit === 'cover'} icon="cover" label="Cover" onClick={() => onSetPageFit('cover')} />
        </div>
      </div>

      <div className="reader-settings-section">
        <div className="reader-settings-label">Zoom</div>
        <ReaderSliderRow
          label="Zoom"
          icon="expand"
          value={readerSettings.zoomPercent}
          min={60}
          max={180}
          onChange={onSetZoom}
          suffix="%"
        />
      </div>

      <div className="reader-settings-section">
        <div className="reader-settings-label">{isEnglish ? 'Image' : 'Imagen'}</div>
        <div className="reader-settings-toggle-row">
          <div>
            <div className="reader-settings-toggle-title">Upscaler / Enhance <span className="reader-settings-ai-tag">AI</span></div>
            <div className="reader-settings-toggle-copy">{isEnglish ? 'Improve clarity and reduce noise' : 'Mejora claridad y reduce ruido'}</div>
          </div>
          <label className="reader-switch">
            <input type="checkbox" checked={readerSettings.enhance} onChange={(event) => onSetEnhance(event.target.checked)} />
            <span className="reader-switch-track" />
          </label>
        </div>
        <div className="reader-quality-chip">{qualityLabel}</div>
      </div>

      <div className="reader-settings-section">
        <div className="reader-settings-label">{isEnglish ? 'Adjustments' : 'Ajustes'}</div>
        <ReaderSliderRow label={isEnglish ? 'Brightness' : 'Brillo'} icon="sun" value={readerSettings.brightness} min={-40} max={40} onChange={onSetBrightness} suffix="%" />
        <ReaderSliderRow label={isEnglish ? 'Contrast' : 'Contraste'} icon="contrast" value={readerSettings.contrast} min={-40} max={40} onChange={onSetContrast} suffix="%" />
        <button type="button" className="reader-reset-btn" onClick={onResetAdjustments}>
          {isEnglish ? 'Reset Adjustments' : 'Restablecer ajustes'}
        </button>
      </div>

      <div className="reader-settings-section">
        <div className="reader-settings-label">{isEnglish ? 'Auto-Hide UI' : 'Ocultar interfaz'}</div>
        <div className="reader-settings-toggle-row">
          <div className="reader-settings-toggle-copy">{isEnglish ? 'Hide controls after inactivity' : 'Oculta controles tras inactividad'}</div>
          <label className="reader-switch">
            <input type="checkbox" checked={readerSettings.autoHideUI} onChange={(event) => onSetAutoHideUI(event.target.checked)} />
            <span className="reader-switch-track" />
          </label>
        </div>
        <label className="reader-delay-select-shell">
          <span>{isEnglish ? 'Delay' : 'Espera'}</span>
          <select value={readerSettings.autoHideDelaySec} onChange={(event) => onSetAutoHideDelaySec(Number(event.target.value))}>
            {[2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>{value} sec</option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  )
}
